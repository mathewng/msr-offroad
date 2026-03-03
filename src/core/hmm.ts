import RandomPool from "./random-pool";

/**
 * Hidden Markov Model (HMM) implementation.
 *
 * This class provides a high-performance implementation of HMMs using:
 * 1. Baum-Welch Algorithm: For unsupervised training (Expectation-Maximization)
 *    to find the parameters (A, B, pi) that best fit a given observation sequence.
 * 2. Forward Algorithm: To calculate the log-likelihood of a sequence and
 *    estimate the current hidden state distribution.
 * 3. Walker-Forward Prediction: For multi-step probability estimation of future observations.
 *
 * Domain Mapping:
 * - Hidden States (Latent variables): Abstract patterns or "modes" of the race system.
 * - Observations (Emissions): The composite outcome (Slot Index * 3 + Payout Bucket).
 *
 * Performance Optimizations:
 * - Buffer Pooling: Reuses Float64Array buffers to minimize GC pressure during training.
 * - Emission Caching: Pre-calculates P(O_t | S_i) matrix to eliminate redundant O(N*T) index math.
 * - Vectorized Unrolling: Uses loop unrolling (4x-8x) in dot products for better CPU pipeline utilization.
 * - Transposed Transitions: Uses a transposed transition matrix (At) for sequential memory access (cache locality).
 *
 * Accuracy Optimizations:
 * - Windowed Seeding: Initializes hidden states with local data "regimes" to improve specialization.
 * - Multiple Restarts: Runs EM from different starting points to avoid local optima.
 */

const rng = new RandomPool();

/**
 * Object pool for reusing Float64Array buffers to reduce Garbage Collection (GC) pressure.
 *
 * During the Baum-Welch (EM) algorithm, multiple large matrices (alpha, beta, etc.)
 * are required for each training session. Frequent allocation of these arrays
 * triggers heavy GC, which degrades performance in high-throughput environments.
 * This pool retains buffers by size for immediate reuse.
 */
class BufferPool {
    private static pools = new Map<number, Float64Array[]>();

    /**
     * Retrieves a buffer of the requested size from the pool, or creates a new one.
     * @param size - The required length of the Float64Array.
     */
    static get(size: number): Float64Array {
        const pool = this.pools.get(size);
        if (pool && pool.length > 0) {
            return pool.pop()!;
        }
        return new Float64Array(size);
    }

    /**
     * Returns a buffer to the pool for later reuse.
     * Fills the buffer with 0 to ensure no stale data carries over.
     * @param buffer - The Float64Array to be recycled.
     */
    static release(buffer: Float64Array): void {
        const size = buffer.length;
        if (!this.pools.has(size)) {
            this.pools.set(size, []);
        }
        buffer.fill(0); // Clear for reuse to prevent data leakage between iterations
        this.pools.get(size)!.push(buffer);
    }
}

export class HMM {
    private numStates: number;
    private numObservations: number;
    private A: Float64Array; // State Transition Matrix: P(State_t | State_t-1)
    private B: Float64Array; // Emission Matrix: P(Observation_t | State_t)
    private pi: Float64Array; // Initial State Distribution: P(State_0)

    /**
     * Transposed Transitions for performance.
     * Cached and updated during training to improve cache locality in algorithms.
     */
    private At: Float64Array;

    constructor(numStates: number, numObservations: number) {
        this.numStates = numStates;
        this.numObservations = numObservations;
        this.A = new Float64Array(numStates * numStates);
        this.B = new Float64Array(numStates * numObservations);
        this.pi = new Float64Array(numStates);
        this.At = new Float64Array(numStates * numStates);

        this.initializeProbabilities();
    }

    /**
     * Initializes probabilities with random values and normalizes them per row.
     * Randomization is necessary to break symmetry for EM.
     */
    private initializeProbabilities() {
        this.fillRandomNormalized(this.pi);

        for (let i = 0; i < this.numStates; i++) {
            const rowA = this.A.subarray(i * this.numStates, (i + 1) * this.numStates);
            this.fillRandomNormalized(rowA);

            const rowB = this.B.subarray(i * this.numObservations, (i + 1) * this.numObservations);
            this.fillRandomNormalized(rowB);
        }
        this.updateTransposedA();
    }

    /**
     * Seeding: Intelligently initializes the emission matrix (B) based on data.
     *
     * To accelerate convergence and prevent the EM algorithm from getting stuck in
     * poor local optima, we seed hidden states by blending:
     * 1. Local Regimes: Each state is assigned a random temporal window of observations
     *    to capture specific local patterns (e.g., a "high-payout streak").
     * 2. Global Priors: Blends in the overall observation frequencies to ensure every
     *    state has a realistic baseline and handles missing outcomes.
     * 3. Diversity Noise: Perturbs the distribution to ensure workers in an ensemble
     *    explore different parts of the parameter space.
     *
     * @param observations - Representative data used to calculate frequencies.
     */
    public initializeFromData(observations: number[] | Int32Array) {
        const obs = observations instanceof Int32Array ? observations : new Int32Array(observations);
        const T = obs.length;
        if (T === 0) return;

        const N = this.numStates;
        const M = this.numObservations;

        // 1. Calculate global frequencies as a baseline fallback
        const globalFreqs = new Float64Array(M);
        let validCount = 0;
        for (let t = 0; t < T; t++) {
            const o = obs[t]!;
            if (o !== -1) {
                globalFreqs[o]!++;
                validCount++;
            }
        }
        if (validCount > 0) {
            const invValid = 1.0 / validCount;
            for (let k = 0; k < M; k++) globalFreqs[k]! *= invValid;
        } else {
            globalFreqs.fill(1.0 / M);
        }

        // 2. Seed each state with windowed frequencies for better specialization
        // Window size is chosen to be representative of local "regimes"
        const windowSize = Math.max(10, Math.floor(T / (N * 2)));

        for (let i = 0; i < N; i++) {
            const offset = i * M;
            const stateFreqs = new Float64Array(M);
            let stateTotal = 0;

            // Pick a random starting point for this state's window
            const start = Math.floor(rng.next() * Math.max(1, T - windowSize));
            const end = Math.min(T, start + windowSize);

            // Accumulate frequencies in the window
            for (let t = start; t < end; t++) {
                const o = obs[t]!;
                if (o !== -1) {
                    stateFreqs[o]!++;
                    stateTotal++;
                }
            }

            let rowSum = 0;
            const eps = 1e-10;

            for (let k = 0; k < M; k++) {
                // Blend: 70% local window, 30% global frequencies + noise
                // This gives each state a "hint" of a specific regime while keeping it open
                let val = globalFreqs[k]! * 0.3;
                if (stateTotal > 0) {
                    val += (stateFreqs[k]! / stateTotal) * 0.7;
                }

                // Add diversity noise to ensure even identical windows lead to different specialization
                val = (val * (0.8 + rng.next() * 0.4)) + eps;
                this.B[offset + k] = val;
                rowSum += val;
            }

            // Normalize
            const invRowSum = 1.0 / rowSum;
            for (let k = 0; k < M; k++) {
                this.B[offset + k]! *= invRowSum;
            }
        }
    }

    /**
     * Fills an array with random values and normalizes so they sum to 1.0.
     */
    private fillRandomNormalized(arr: Float64Array) {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) {
            const val = Math.max(rng.next(), 1e-10);
            arr[i] = val;
            sum += val;
        }
        if (sum > 0) {
            const invSum = 1.0 / sum;
            for (let i = 0; i < arr.length; i++) {
                arr[i]! *= invSum;
            }
        }
    }

    /**
     * High-level training method that supports multiple restarts and optional warm starts.
     *
     * HMM training (Baum-Welch) is a local optimization process sensitive to
     * initial parameters. Running multiple training sessions with different
     * initializations and selecting the one with the highest log-likelihood
     * significantly improves the quality of the final model.
     *
     * @param observations - The sequence of observed results.
     * @param iterations - Maximum number of EM iterations (epochs) per restart.
     * @param restarts - Number of full training sessions to attempt (default: 3).
     * @param tolerance - Log-likelihood improvement threshold for early stopping.
     * @param smoothing - Laplace smoothing constant (pseudocount).
     * @param seedParams - Optional parameters to use as a starting point (warm start).
     * @returns The final log-likelihood of the best model found.
     */
    public train(
        observations: number[] | Int32Array,
        iterations: number = 100,
        restarts: number = 3,
        tolerance: number = 0,
        smoothing: number = 1e-6,
        seedParams?: { A: Float64Array; B: Float64Array; pi: Float64Array },
    ): number {
        const obs = observations instanceof Int32Array ? observations : new Int32Array(observations);

        let bestLogLikelihood = -Infinity;
        const bestA = new Float64Array(this.A.length);
        const bestB = new Float64Array(this.B.length);
        const bestPi = new Float64Array(this.pi.length);

        for (let r = 0; r < restarts; r++) {
            // 1. Initialize parameters for this restart
            if (r === 0 && seedParams) {
                // Warm start: use provided parameters as a baseline
                this.setParameters(seedParams);
                // Add slight perturbation to ensure we explore around the seed
                this.perturb(0.05);
            } else {
                // Cold start or subsequent restart: initialize from data distribution
                this.initializeFromData(obs);
            }

            // 2. Perform EM optimization (one session)
            const ll = this.fit(obs, iterations, tolerance, smoothing);

            // 3. Keep the best model parameters
            if (ll > bestLogLikelihood) {
                bestLogLikelihood = ll;
                bestA.set(this.A);
                bestB.set(this.B);
                bestPi.set(this.pi);
            }
        }

        // Restore the best found model
        this.A.set(bestA);
        this.B.set(bestB);
        this.pi.set(bestPi);
        this.updateTransposedA();

        // Ensure states are consistently ordered to prevent label switching
        this.sortStates();

        return bestLogLikelihood;
    }

    /**
     * Adds a small amount of random noise to all parameters and re-normalizes.
     * Useful for escaping local optima during warm starts.
     */
    private perturb(amount: number): void {
        const N = this.numStates;
        const M = this.numObservations;

        const perturbArr = (arr: Float64Array, rowSize: number) => {
            const numRows = Math.floor(arr.length / rowSize);
            for (let i = 0; i < numRows; i++) {
                const off = i * rowSize;
                let sum = 0;
                for (let j = 0; j < rowSize; j++) {
                    const val = arr[off + j]! * (1.0 + (rng.next() - 0.5) * amount * 2.0) + 1e-10;
                    arr[off + j] = val;
                    sum += val;
                }
                const invSum = 1.0 / sum;
                for (let j = 0; j < rowSize; j++) arr[off + j]! *= invSum;
            }
        };

        perturbArr(this.pi, N);
        perturbArr(this.A, N);
        perturbArr(this.B, M);
        this.updateTransposedA();
    }

    /**
     * Reorders hidden states according to a canonical metric (Bucket 0 emission probability).
     *
     * This addresses the "Label Switching" problem where functionally identical states
     * are assigned arbitrary indices in different training sessions or across an ensemble.
     * By sorting states so that State 0 always represents the same market behavior
     * (e.g. the one where favored slots win most often), we stabilize the consensusRegime.
     */
    public sortStates(): void {
        const N = this.numStates;
        const M = this.numObservations;

        // 1. Calculate the sorting metric for each state.
        // Metric: Sum of emission probabilities for all "Bucket 0" outcomes.
        // In the encoding (round-1)*18 + (slot-1)*3 + bucket, Bucket 0 corresponds to k % 3 == 0.
        const metrics = new Array(N).fill(0).map((_, i) => {
            let sum = 0;
            const iOff = i * M;
            for (let k = 0; k < M; k += 3) {
                sum += this.B[iOff + k]!;
            }
            return { index: i, value: sum };
        });

        // 2. Determine the new order (descending by Bucket 0 probability)
        metrics.sort((a, b) => b.value - a.value);
        const newOrder = metrics.map((m) => m.index);

        // 3. Apply the permutation if it's not already sorted
        let isSorted = true;
        for (let i = 0; i < N; i++) {
            if (newOrder[i] !== i) {
                isSorted = false;
                break;
            }
        }
        if (isSorted) return;

        const oldA = new Float64Array(this.A);
        const oldB = new Float64Array(this.B);
        const oldPi = new Float64Array(this.pi);

        for (let i = 0; i < N; i++) {
            const newIdx = i;
            const oldIdx = newOrder[i]!;

            // Update pi
            this.pi[newIdx] = oldPi[oldIdx]!;

            // Update B (Emission)
            const newOffB = newIdx * M;
            const oldOffB = oldIdx * M;
            this.B.set(oldB.subarray(oldOffB, oldOffB + M), newOffB);

            // Update A (Transition)
            for (let j = 0; j < N; j++) {
                const newJndex = j;
                const oldJndex = newOrder[j]!;
                // P(new_state_j | new_state_i) = P(old_state_newOrder[j] | old_state_newOrder[i])
                this.A[newIdx * N + newJndex] = oldA[oldIdx * N + oldJndex]!;
            }
        }

        this.updateTransposedA();
    }

    /**
     * Gets the current model parameters.
     */
    public getParameters() {
        return {
            A: new Float64Array(this.A),
            B: new Float64Array(this.B),
            pi: new Float64Array(this.pi),
        };
    }

    /**
     * Sets the model parameters and synchronizes the transposed version.
     */
    public setParameters(params: { A: Float64Array; B: Float64Array; pi: Float64Array }) {
        this.A.set(params.A);
        this.B.set(params.B);
        this.pi.set(params.pi);
        this.updateTransposedA();
    }

    /**
     * Performs a single session of Baum-Welch (EM) optimization.
     *
     * This implementation is optimized for high performance:
     * 1. Pre-calculates emission probabilities for the current model in each iteration.
     * 2. Uses optimized forward and backward passes with 4x loop unrolling.
     * 3. Consolidates statistics accumulation to minimize passes over data.
     * 4. Caches joint probability components (rowDots) to avoid redundant O(N^2) dot products.
     *
     * @param observations - The sequence of observed results.
     * @param iterations - Maximum number of EM iterations (epochs).
     * @param tolerance - Log-likelihood improvement threshold for early stopping.
     * @param smoothing - Laplace smoothing constant (pseudocount).
     * @returns Final log-likelihood of the sequence given the trained parameters.
     */
    private fit(observations: Int32Array, iterations: number, tolerance: number, smoothing: number): number {
        const obs = observations;
        const T = obs.length;
        if (T < 2) return -Infinity;

        const N = this.numStates;
        const M = this.numObservations;

        // Use buffer pool to avoid garbage collection overhead
        const alpha = BufferPool.get(T * N);
        const beta = BufferPool.get(T * N);
        const emitProbs = BufferPool.get(T * N); // Cache P(O_t | S_i)
        const accumA = BufferPool.get(N * N);
        const accumB = BufferPool.get(N * M);
        const denomA = BufferPool.get(N);
        const denomB = BufferPool.get(N);

        let finalLogLikelihood = -Infinity;

        try {
            let oldLogLikelihood = -Infinity;
            this.updateTransposedA();

            for (let iter = 0; iter < iterations; iter++) {
                // 0. Pre-calculate emission probabilities for this iteration.
                // This avoids re-calculating B[i][ot] indices in forward, backward, and accumulation.
                for (let t = 0; t < T; t++) {
                    const ot = obs[t]!;
                    const tOff = t * N;
                    if (ot === -1) {
                        for (let i = 0; i < N; i++) emitProbs[tOff + i] = 1.0;
                    } else {
                        for (let i = 0; i < N; i++) {
                            emitProbs[tOff + i] = this.B[i * M + ot]!;
                        }
                    }
                }

                // 1. E-Step Part A: Forward Pass (compute alpha)
                const logLikelihood = this.computeForwardOptimized(obs, alpha, emitProbs);

                // Likelihood became zero or invalid (numerical failure)
                if (logLikelihood === -Infinity) return -Infinity;
                finalLogLikelihood = logLikelihood;

                // Convergence Check: Stop if the log-likelihood improvement is below threshold
                if (tolerance > 0 && iter > 0) {
                    if (Math.abs(logLikelihood - oldLogLikelihood) < tolerance) {
                        break;
                    }
                }
                oldLogLikelihood = logLikelihood;

                // 2. E-Step Part B: Backward Pass (compute beta)
                this.computeBackwardOptimized(obs, beta, emitProbs);

                // 3. E-Step Part C: Accumulation of Statistics
                accumA.fill(0);
                accumB.fill(0);
                denomA.fill(0);
                denomB.fill(0);

                const bBeta = BufferPool.get(N);
                const rowDots = BufferPool.get(N);

                for (let t = 0; t < T - 1; t++) {
                    const tOff = t * N;
                    const ntOff = (t + 1) * N;
                    const oCurr = obs[t]!;

                    // Use cached emission probabilities for t+1
                    for (let j = 0; j < N; j++) {
                        bBeta[j] = emitProbs[ntOff + j]! * beta[ntOff + j]!;
                    }

                    // Compute jointDenom and cache row-wise dot products (rowDots).
                    // This optimization avoids re-calculating the inner dot product for xi accumulation.
                    let jointDenom = 0;
                    for (let i = 0; i < N; i++) {
                        const iOff = i * N;
                        let dot = 0;
                        let j = 0;
                        // Unroll by 2 to balance N=6/8 constraints
                        const limit = N - (N % 2);
                        for (; j < limit; j += 2) {
                            dot += this.A[iOff + j]! * bBeta[j]! +
                                this.A[iOff + j + 1]! * bBeta[j + 1]!;
                        }
                        for (; j < N; j++) dot += this.A[iOff + j]! * bBeta[j]!;

                        rowDots[i] = dot;
                        jointDenom += alpha[tOff + i]! * dot;
                    }

                    const invJointDenom = jointDenom === 0 ? 1e20 : 1.0 / jointDenom;

                    // Accumulate expectations
                    for (let i = 0; i < N; i++) {
                        const alphaVal = alpha[tOff + i]!;
                        const iOff = i * N;
                        const alphaScaled = alphaVal * invJointDenom;

                        // Accumulate transition stats (xi)
                        let j = 0;
                        const limit = N - (N % 2);
                        for (; j < limit; j += 2) {
                            accumA[iOff + j]! += alphaScaled * this.A[iOff + j]! * bBeta[j]!;
                            accumA[iOff + j + 1]! += alphaScaled * this.A[iOff + j + 1]! * bBeta[j + 1]!;
                        }
                        for (; j < N; j++) {
                            accumA[iOff + j]! += alphaScaled * this.A[iOff + j]! * bBeta[j]!;
                        }

                        // gamma_ti = P(state_t = i | O, model) = alpha_t(i) * sum_j(A*B*beta) / jointDenom
                        const gamma_ti = alphaVal * rowDots[i]! * invJointDenom;
                        if (t === 0) this.pi[i] = gamma_ti;

                        denomA[i]! += gamma_ti;
                        if (oCurr !== -1) {
                            accumB[i * M + oCurr]! += gamma_ti;
                            denomB[i]! += gamma_ti;
                        }
                    }
                }
                BufferPool.release(bBeta);
                BufferPool.release(rowDots);

                // Handle the terminal state (T-1) for gamma accumulation
                const lastOff = (T - 1) * N;
                let terminalDenom = 0;
                for (let i = 0; i < N; i++) terminalDenom += alpha[lastOff + i]!;
                const invTerminalDenom = terminalDenom === 0 ? 1e20 : 1.0 / terminalDenom;
                const oLast = obs[T - 1]!;

                for (let i = 0; i < N; i++) {
                    const gamma_Ti = alpha[lastOff + i]! * invTerminalDenom;
                    if (oLast !== -1) {
                        accumB[i * M + oLast]! += gamma_Ti;
                        denomB[i]! += gamma_Ti;
                    }
                }

                // 4. M-Step: Maximum Likelihood Re-estimation
                // Re-calculate A, B, and pi parameters using the accumulated expectations.
                // Use Laplace smoothing (pseudocounts) to ensure every outcome remains possible.
                const eps = smoothing;

                // Re-estimate and smooth Initial Probabilities (pi)
                let piSum = 0;
                for (let i = 0; i < N; i++) {
                    this.pi[i]! += eps;
                    piSum += this.pi[i]!;
                }
                const invPiSum = 1.0 / piSum;
                for (let i = 0; i < N; i++) this.pi[i]! *= invPiSum;

                // Re-estimate Transition (A) and Emission (B) Matrices
                for (let i = 0; i < N; i++) {
                    const iOff = i * N;
                    // Transitions: A[i][j] = (sum(xi_tij) + eps) / (sum(gamma_ti) + N * eps)
                    const invDenomA = 1.0 / (denomA[i]! + (N * eps));
                    for (let j = 0; j < N; j++) {
                        this.A[iOff + j] = (accumA[iOff + j]! + eps) * invDenomA;
                    }

                    const iOffB = i * M;
                    // Emissions: B[i][k] = (sum(gamma_ti where o_t = k) + eps) / (sum(gamma_ti) + M * eps)
                    const invDenomB = 1.0 / (denomB[i]! + (M * eps));
                    for (let k = 0; k < M; k++) {
                        this.B[iOffB + k] = (accumB[iOffB + k]! + eps) * invDenomB;
                    }
                }

                // Synchronize the transposed copy used for forward pass performance
                this.updateTransposedA();
            }
        } finally {
            // Return buffers to pool for reuse
            BufferPool.release(alpha);
            BufferPool.release(beta);
            BufferPool.release(emitProbs);
            BufferPool.release(accumA);
            BufferPool.release(accumB);
            BufferPool.release(denomA);
            BufferPool.release(denomB);
        }

        return finalLogLikelihood;
    }

    /**
     * Optimized forward pass using cached emission probabilities and unrolling.
     *
     * Numerical Stability:
     * Standard HMM calculations involve repeated multiplication of probabilities,
     * leading to geometric decay and floating-point underflow. We normalize the
     * alpha vector at each timestep such that sum(alpha_t) = 1.0. The sum of the
     * logs of these scaling factors yields the total log-likelihood.
     *
     * @param obs - The observation sequence.
     * @param alpha - Buffer to store forward variables.
     * @param emitProbs - Pre-calculated emission probability matrix (T x N).
     * @returns Total log-likelihood of the observation sequence.
     */
    private computeForwardOptimized(obs: Int32Array, alpha: Float64Array, emitProbs: Float64Array): number {
        const T = obs.length;
        const N = this.numStates;
        let logLikelihood = 0;

        // Initialization Step (t=0)
        let rowSum0 = 0;
        for (let i = 0; i < N; i++) {
            const val = this.pi[i]! * emitProbs[i]!;
            alpha[i] = val;
            rowSum0 += val;
        }

        if (rowSum0 <= 0) return -Infinity;

        const invRowSum0 = 1.0 / rowSum0;
        for (let i = 0; i < N; i++) alpha[i]! *= invRowSum0;
        logLikelihood += Math.log(rowSum0);

        // Induction Step (t > 0)
        for (let t = 1; t < T; t++) {
            const tOff = t * N;
            const ptOff = (t - 1) * N;
            let rowSum = 0;

            for (let j = 0; j < N; j++) {
                let sum = 0;
                const jOff = j * N;

                let i = 0;
                // Unroll by 4 for better pipeline utilization
                const limit4 = N - (N % 4);
                for (; i < limit4; i += 4) {
                    sum += alpha[ptOff + i]! * this.At[jOff + i]! +
                        alpha[ptOff + i + 1]! * this.At[jOff + i + 1]! +
                        alpha[ptOff + i + 2]! * this.At[jOff + i + 2]! +
                        alpha[ptOff + i + 3]! * this.At[jOff + i + 3]!;
                }
                for (; i < N; i++) {
                    sum += alpha[ptOff + i]! * this.At[jOff + i]!;
                }

                const val = sum * emitProbs[tOff + j]!;
                alpha[tOff + j] = val;
                rowSum += val;
            }

            if (rowSum <= 0) return -Infinity;

            const invRowSum = 1.0 / rowSum;
            for (let i = 0; i < N; i++) alpha[tOff + i]! *= invRowSum;
            logLikelihood += Math.log(rowSum);
        }
        return logLikelihood;
    }

    /**
     * Optimized backward pass using cached emission probabilities and unrolling.
     *
     * Like computeForward, beta is scaled at each timestep. Using the same
     * scaling logic ensures that alpha[t][i] * beta[t][i] remains proportional
     * to the posterior probability of being in state i at time t.
     *
     * @param obs - The observation sequence.
     * @param beta - Buffer to store backward variables.
     * @param emitProbs - Pre-calculated emission probability matrix (T x N).
     */
    private computeBackwardOptimized(obs: Int32Array, beta: Float64Array, emitProbs: Float64Array) {
        const T = obs.length;
        const N = this.numStates;

        const lastOff = (T - 1) * N;
        for (let i = 0; i < N; i++) beta[lastOff + i] = 1;

        const bBeta = BufferPool.get(N);
        try {
            for (let t = T - 2; t >= 0; t--) {
                const tOff = t * N;
                const ntOff = (t + 1) * N;
                let rowSum = 0;

                for (let j = 0; j < N; j++) {
                    bBeta[j] = emitProbs[ntOff + j]! * beta[ntOff + j]!;
                }

                for (let i = 0; i < N; i++) {
                    let sum = 0;
                    const iOff = i * N;

                    let j = 0;
                    const limit4 = N - (N % 4);
                    for (; j < limit4; j += 4) {
                        sum += this.A[iOff + j]! * bBeta[j]! +
                            this.A[iOff + j + 1]! * bBeta[j + 1]! +
                            this.A[iOff + j + 2]! * bBeta[j + 2]! +
                            this.A[iOff + j + 3]! * bBeta[j + 3]!;
                    }
                    for (; j < N; j++) {
                        sum += this.A[iOff + j]! * bBeta[j]!;
                    }

                    beta[tOff + i] = sum;
                    rowSum += sum;
                }

                if (rowSum === 0) rowSum = 1e-20;
                const invRowSum = 1.0 / rowSum;
                for (let i = 0; i < N; i++) beta[tOff + i]! *= invRowSum;
            }
        } finally {
            BufferPool.release(bBeta);
        }
    }

    /**
     * Convenience method to get probabilities for just the next step.
     */
    public predictNext(observations: number[] | Int32Array, steps: number = 1): number[] {
        return this.predictSteps(observations, steps)[steps - 1]!;
    }

    /**
     * Efficiently predicts probabilities for future observations.
     *
     * Implementation:
     * 1. Filtering: Runs the Optimized Forward Algorithm to find the posterior state
     *    distribution given all known observations O_1...O_T.
     * 2. State Projection: Iteratively projects the distribution into the future using
     *    the transition matrix A (Markov property).
     * 3. Emission Projection: At each future step, projects the state distribution
     *    onto the observation space using the emission matrix B.
     *
     * @param observations - The sequence of observations to base the prediction on.
     * @param maxSteps - Number of steps into the future to predict.
     * @returns A 2D array where [s][k] is the probability of observation k at step s.
     */
    public predictSteps(observations: number[] | Int32Array, maxSteps: number): number[][] {
        const obs = observations instanceof Int32Array ? observations : new Int32Array(observations);
        const N = this.numStates;
        const M = this.numObservations;
        let stateDistribution = BufferPool.get(N);
        const nextStateDist = BufferPool.get(N);

        try {
            if (obs.length === 0) {
                stateDistribution.set(this.pi);
            } else {
                const T = obs.length;
                const alpha = BufferPool.get(T * N);
                const emitProbs = BufferPool.get(T * N);
                try {
                    // Populate emitProbs for the forward pass
                    for (let t = 0; t < T; t++) {
                        const ot = obs[t]!;
                        const tOff = t * N;
                        if (ot === -1) {
                            for (let i = 0; i < N; i++) emitProbs[tOff + i] = 1.0;
                        } else {
                            for (let i = 0; i < N; i++) {
                                emitProbs[tOff + i] = this.B[i * M + ot]!;
                            }
                        }
                    }

                    this.updateTransposedA();
                    this.computeForwardOptimized(obs, alpha, emitProbs);

                    const lastOff = (T - 1) * N;
                    stateDistribution.set(alpha.subarray(lastOff, lastOff + N));
                    let sum = 0;
                    for (let i = 0; i < N; i++) sum += stateDistribution[i]!;
                    if (sum === 0) {
                        const val = 1 / N;
                        for (let i = 0; i < N; i++) stateDistribution[i] = val;
                    } else {
                        const invSum = 1.0 / sum;
                        for (let i = 0; i < N; i++) stateDistribution[i]! *= invSum;
                    }
                } finally {
                    BufferPool.release(alpha);
                    BufferPool.release(emitProbs);
                }
            }

            const allResults: number[][] = [];

            for (let s = 1; s <= maxSteps; s++) {
                // Project state forward: pi_t+1 = pi_t * A
                nextStateDist.fill(0);
                for (let j = 0; j < N; j++) {
                    let sum = 0;
                    const jOff = j * N;
                    // Vectorized/Unrolled dot product
                    let i = 0;
                    const limit = N - (N % 8);
                    for (; i < limit; i += 8) {
                        sum += stateDistribution[i]! * this.At[jOff + i]! +
                            stateDistribution[i + 1]! * this.At[jOff + i + 1]! +
                            stateDistribution[i + 2]! * this.At[jOff + i + 2]! +
                            stateDistribution[i + 3]! * this.At[jOff + i + 3]! +
                            stateDistribution[i + 4]! * this.At[jOff + i + 4]! +
                            stateDistribution[i + 5]! * this.At[jOff + i + 5]! +
                            stateDistribution[i + 6]! * this.At[jOff + i + 6]! +
                            stateDistribution[i + 7]! * this.At[jOff + i + 7]!;
                    }
                    for (; i < N; i++) {
                        sum += stateDistribution[i]! * this.At[jOff + i]!;
                    }
                    nextStateDist[j] = sum;
                }
                stateDistribution.set(nextStateDist);

                // Compute the expected observations: Prob(O) = sum_states( Prob(O | state) * Prob(state) )
                const probs = new Array(M).fill(0);
                for (let state = 0; state < N; state++) {
                    const prob = stateDistribution[state]!;
                    const sOff = state * M;

                    let k = 0;
                    const mLimit = M - (M % 8);
                    for (; k < mLimit; k += 8) {
                        probs[k] += prob * this.B[sOff + k]!;
                        probs[k + 1] += prob * this.B[sOff + k + 1]!;
                        probs[k + 2] += prob * this.B[sOff + k + 2]!;
                        probs[k + 3] += prob * this.B[sOff + k + 3]!;
                        probs[k + 4] += prob * this.B[sOff + k + 4]!;
                        probs[k + 5] += prob * this.B[sOff + k + 5]!;
                        probs[k + 6] += prob * this.B[sOff + k + 6]!;
                        probs[k + 7] += prob * this.B[sOff + k + 7]!;
                    }
                    for (; k < M; k++) {
                        probs[k] += prob * this.B[sOff + k]!;
                    }
                }
                allResults.push(probs);
            }

            return allResults;
        } finally {
            BufferPool.release(stateDistribution);
            BufferPool.release(nextStateDist);
        }
    }

    /**
     * Viterbi Algorithm: Finds the most likely sequence of hidden states (the Viterbi path)
     * given an observation sequence.
     *
     * This implementation uses log-space to prevent numerical underflow and handles
     * missing observations (-1) by assuming a uniform emission probability. It uses
     * the transposed transition matrix (At) for cache-friendly lookups.
     *
     * @param observations - The sequence of observed results.
     * @returns An Int32Array containing the sequence of most likely hidden states.
     */
    public viterbi(observations: number[] | Int32Array): Int32Array {
        const obs = observations instanceof Int32Array ? observations : new Int32Array(observations);
        const T = obs.length;
        const N = this.numStates;
        const M = this.numObservations;

        if (T === 0) return new Int32Array(0);

        // delta[t][i] = max_{q1...qt-1} P(q1...qt-1, qt=i, O1...Ot | model)
        // psi[t][i] = argmax_{q1...qt-1} P(q1...qt-1, qt=i, O1...Ot | model)
        const delta = BufferPool.get(T * N);
        const psi = new Int32Array(T * N);

        // Pre-calculate logs of A, B, and pi to avoid repeated Math.log calls
        const logAt = new Float64Array(this.At.length);
        const logB = new Float64Array(this.B.length);
        const logPi = new Float64Array(this.pi.length);

        const eps = 1e-100;
        for (let i = 0; i < this.At.length; i++) logAt[i] = Math.log(this.At[i]! + eps);
        for (let i = 0; i < this.B.length; i++) logB[i] = Math.log(this.B[i]! + eps);
        for (let i = 0; i < this.pi.length; i++) logPi[i] = Math.log(this.pi[i]! + eps);

        // 1. Initialization (t=0)
        const o0 = obs[0]!;
        for (let i = 0; i < N; i++) {
            const emissionLogProb = o0 === -1 ? 0 : logB[i * M + o0]!;
            delta[i] = logPi[i]! + emissionLogProb;
        }

        // 2. Recursion (t=1..T-1)
        for (let t = 1; t < T; t++) {
            const tOff = t * N;
            const ptOff = (t - 1) * N;
            const ot = obs[t]!;

            for (let j = 0; j < N; j++) {
                let maxLogProb = -Infinity;
                let bestPrevState = 0;
                const jOff = j * N;
                const emissionLogProb = ot === -1 ? 0 : logB[j * M + ot]!;

                for (let i = 0; i < N; i++) {
                    const prob = delta[ptOff + i]! + logAt[jOff + i]!;
                    if (prob > maxLogProb) {
                        maxLogProb = prob;
                        bestPrevState = i;
                    }
                }
                delta[tOff + j] = maxLogProb + emissionLogProb;
                psi[tOff + j] = bestPrevState;
            }
        }

        // 3. Termination
        const path = new Int32Array(T);
        let maxLogProb = -Infinity;
        let lastState = 0;
        const lastOff = (T - 1) * N;

        for (let i = 0; i < N; i++) {
            if (delta[lastOff + i]! > maxLogProb) {
                maxLogProb = delta[lastOff + i]!;
                lastState = i;
            }
        }
        path[T - 1] = lastState;

        // 4. Backtracking: Trace back through the psi matrix to find the
        // sequence of states that most likely produced the observations.
        for (let t = T - 2; t >= 0; t--) {
            // Using non-null assertion because (t+1)*N + path[t+1] is guaranteed
            // to be within the bounds of the psi matrix by the algorithm's construction.
            path[t] = psi[(t + 1) * N + path[t + 1]!]!;
        }

        BufferPool.release(delta);
        return path;
    }

    /**
     * Updates the cached transposed transition matrix.
     */
    private updateTransposedA() {
        const N = this.numStates;
        for (let i = 0; i < N; i++) {
            const iOff = i * N;
            for (let j = 0; j < N; j++) {
                this.At[j * N + i] = this.A[iOff + j]!;
            }
        }
    }
}
