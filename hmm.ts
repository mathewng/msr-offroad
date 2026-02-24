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
 * - Uses object pooling for memory management to reduce GC pressure
 * - Transposed transition matrix (At) improves cache locality in forward/backward algorithms
 * - Scaling/normalization prevents numerical underflow during probability calculations
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
     * Seeding: Intelligently initializes the emission matrix (B) based on global data.
     *
     * To accelerate convergence and prevent the EM algorithm from getting stuck in
     * poor local optima, we seed each hidden state with the global observation
     * frequencies, perturbed by random noise. This ensures:
     * 1. Each state begins with a realistic (though non-specific) emission distribution.
     * 2. Every state starts slightly differently, allowing the EM algorithm to
     *    specialize them into different clusters/regimes during training.
     *
     * @param observations - Representative data used to calculate global frequencies.
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
     * High-level training method that supports multiple restarts.
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
     * @returns The final log-likelihood of the best model found.
     */
    public train(observations: number[] | Int32Array, iterations: number = 100, restarts: number = 3, tolerance: number = 0, smoothing: number = 1e-6): number {
        const obs = observations instanceof Int32Array ? observations : new Int32Array(observations);

        let bestLogLikelihood = -Infinity;
        const bestA = new Float64Array(this.A.length);
        const bestB = new Float64Array(this.B.length);
        const bestPi = new Float64Array(this.pi.length);

        for (let r = 0; r < restarts; r++) {
            // 1. Initialize parameters for this restart
            if (r > 0) {
                // If we've already initialized from data once, reuse that logic but
                // it will generate different random perturbations for each restart.
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

        return bestLogLikelihood;
    }

    /**
     * Performs a single session of Baum-Welch (EM) optimization.
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
                // 0. Pre-calculate emission probabilities for this iteration
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

                    // Compute jointDenom and cache rowDots
                    let jointDenom = 0;
                    for (let i = 0; i < N; i++) {
                        const iOff = i * N;
                        let dot = 0;
                        let j = 0;
                        // Unroll by 2 for N=6 compatibility
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

                        let j = 0;
                        const limit = N - (N % 2);
                        for (; j < limit; j += 2) {
                            accumA[iOff + j]! += alphaScaled * this.A[iOff + j]! * bBeta[j]!;
                            accumA[iOff + j + 1]! += alphaScaled * this.A[iOff + j + 1]! * bBeta[j + 1]!;
                        }
                        for (; j < N; j++) {
                            accumA[iOff + j]! += alphaScaled * this.A[iOff + j]! * bBeta[j]!;
                        }

                        // gamma_ti = P(state_t = i | O, model) = alpha_t(i) * sum_j(A(i,j)*B*beta) / jointDenom
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
     * 1. Filtering: Runs the Forward Algorithm to find the posterior state distribution
     *    given all known observations O_1...O_T.
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
