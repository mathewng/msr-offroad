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
        const frequencies = new Float64Array(this.numObservations);
        let totalCount = 0;

        // Calculate global observation frequency (Prior probability)
        for (let t = 0; t < obs.length; t++) {
            const o = obs[t]!;
            if (o !== -1) {
                frequencies[o]!++;
                totalCount++;
            }
        }

        if (totalCount === 0) return;

        // Normalize frequencies
        const invTotal = 1.0 / totalCount;
        for (let k = 0; k < this.numObservations; k++) frequencies[k]! *= invTotal;

        // Seed each state's emission matrix (B) with randomized frequencies
        for (let i = 0; i < this.numStates; i++) {
            const offset = i * this.numObservations;
            let rowSum = 0;

            for (let k = 0; k < this.numObservations; k++) {
                // Perturb the global frequency by 50-100% per observation per state
                // This ensures each worker starts with a unique view of the clusters
                const randomShift = 0.5 + rng.next(); // 0.5 to 1.5
                const val = (frequencies[k]! * randomShift) + 1e-10;
                this.B[offset + k] = val;
                rowSum += val;
            }

            // Normalize the row (sum P(O|S) = 1.0)
            const invRowSum = 1.0 / rowSum;
            for (let k = 0; k < this.numObservations; k++) {
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
     * Trains the model using the Baum-Welch (EM) algorithm.
     *
     * @param observations - The sequence of observed results.
     * @param iterations - Maximum number of EM iterations (epochs).
     * @param tolerance - Log-likelihood improvement threshold for early stopping.
     * @param smoothing - Laplace smoothing constant (pseudocount) to prevent zero probabilities and improve generalization.
     */
    public train(observations: number[] | Int32Array, iterations: number = 100, tolerance: number = 0, smoothing: number = 1e-6) {
        const obs = observations instanceof Int32Array ? observations : new Int32Array(observations);
        const T = obs.length;
        if (T < 2) return;

        const N = this.numStates;
        const M = this.numObservations;

        // Use buffer pool to avoid garbage collection overhead
        const alpha = BufferPool.get(T * N);
        const beta = BufferPool.get(T * N);
        const accumA = BufferPool.get(N * N);
        const accumB = BufferPool.get(N * M);
        const denomA = BufferPool.get(N);
        const denomB = BufferPool.get(N);

        try {
            let oldLogLikelihood = -Infinity;
            this.updateTransposedA();

            for (let iter = 0; iter < iterations; iter++) {
                // 1. E-Step Part A: Forward Pass (compute alpha)
                // alpha[t][i] = P(O_1...O_t, state_t = i | model)
                const logLikelihood = this.computeForward(obs, alpha);

                // Likelihood became zero or invalid (numerical failure)
                if (logLikelihood === -Infinity) break;

                // Convergence Check: Stop if the log-likelihood improvement is below threshold
                if (tolerance > 0 && iter > 0) {
                    if (Math.abs(logLikelihood - oldLogLikelihood) < tolerance) {
                        break;
                    }
                }
                oldLogLikelihood = logLikelihood;

                // 2. E-Step Part B: Backward Pass (compute beta)
                // beta[t][i] = P(O_t+1...O_T | state_t = i, model)
                this.computeBackward(obs, beta);

                // 3. E-Step Part C: Accumulation of Statistics
                // We calculate expectations of transitions (xi) and state occupancies (gamma)
                // without allocating massive O(T*N*N) buffers by accumulating on-the-fly.
                accumA.fill(0);
                accumB.fill(0);
                denomA.fill(0);
                denomB.fill(0);

                for (let t = 0; t < T - 1; t++) {
                    const tOff = t * N;
                    const ntOff = (t + 1) * N;
                    const oCurr = obs[t]!;
                    const oNext = obs[t + 1]!;

                    // Compute normalization factor (joint probability P(O | model)) for this timestep
                    let jointDenom = 0;
                    for (let i = 0; i < N; i++) {
                        const alphaVal = alpha[tOff + i]!;
                        const iOff = i * N;
                        for (let j = 0; j < N; j++) {
                            const emissionProb = oNext === -1 ? 1.0 : this.B[j * M + oNext]!;
                            jointDenom += alphaVal * this.A[iOff + j]! * emissionProb * beta[ntOff + j]!;
                        }
                    }
                    const invJointDenom = jointDenom === 0 ? 1e20 : 1.0 / jointDenom;

                    // Accumulate transition counts (A) and emission counts (B)
                    for (let i = 0; i < N; i++) {
                        const alphaVal = alpha[tOff + i]!;
                        const iOff = i * N;
                        let gamma_ti = 0; // P(state_t = i | O, model)

                        for (let j = 0; j < N; j++) {
                            const emissionProb = oNext === -1 ? 1.0 : this.B[j * M + oNext]!;
                            // xi_tij = P(state_t = i, state_t+1 = j | O, model)
                            const xi_tij = alphaVal * this.A[iOff + j]! * emissionProb * beta[ntOff + j]! * invJointDenom;
                            accumA[iOff + j]! += xi_tij;
                            gamma_ti += xi_tij;
                        }

                        // Pi re-estimation (initial state distribution)
                        if (t === 0) this.pi[i] = gamma_ti;

                        // Accumulate for transition denominator and emission numerator/denominator
                        denomA[i]! += gamma_ti;
                        if (oCurr !== -1) {
                            accumB[i * M + oCurr]! += gamma_ti;
                            denomB[i]! += gamma_ti;
                        }
                    }
                }

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
            BufferPool.release(accumA);
            BufferPool.release(accumB);
            BufferPool.release(denomA);
            BufferPool.release(denomB);
        }
    }

    /**
     * Calculates alpha (forward variables): probability of partial sequence O1..Ot
     * ending in state i.
     *
     * Numerical Stability:
     * Standard HMM calculations involve repeated multiplication of probabilities,
     * leading to geometric decay and floating-point underflow (values becoming 0).
     * We solve this by normalizing the alpha vector at each timestep 't' such that
     * sum(alpha_t) = 1.0. The log of each scaling factor is summed to yield the
     * total log-likelihood of the observation sequence.
     *
     * @returns Total log-likelihood of the observations.
     */
    private computeForward(obs: Int32Array, alpha: Float64Array): number {
        const T = obs.length;
        const N = this.numStates;
        const M = this.numObservations;
        let logLikelihood = 0;

        // Initialization Step (t=0)
        const o0 = obs[0]!;
        let rowSum0 = 0;
        for (let i = 0; i < N; i++) {
            // Missing observation (-1) handling: P(O|S) = 1.0
            const emissionProb = o0 === -1 ? 1.0 : this.B[i * M + o0]!;
            const val = this.pi[i]! * emissionProb;
            alpha[i] = val;
            rowSum0 += val;
        }

        if (rowSum0 <= 0) return -Infinity; // Impossible sequence

        // Scale alpha_0 and record log-scaling factor
        const invRowSum0 = 1.0 / rowSum0;
        for (let i = 0; i < N; i++) alpha[i]! *= invRowSum0;
        logLikelihood += Math.log(rowSum0);

        // Induction Step (t > 0)
        for (let t = 1; t < T; t++) {
            const tOff = t * N;
            const ptOff = (t - 1) * N;
            const ot = obs[t]!;
            let rowSum = 0;

            for (let j = 0; j < N; j++) {
                let sum = 0;
                const jOff = j * N;
                // Cache-friendly: At is transposed, so we access sequentially [j*N + i]
                // which corresponds to A[i][j]. This improves SIMD and cache locality.
                let i = 0;
                const limit = N - (N % 8);
                for (; i < limit; i += 8) {
                    sum += alpha[ptOff + i]! * this.At[jOff + i]! +
                           alpha[ptOff + i + 1]! * this.At[jOff + i + 1]! +
                           alpha[ptOff + i + 2]! * this.At[jOff + i + 2]! +
                           alpha[ptOff + i + 3]! * this.At[jOff + i + 3]! +
                           alpha[ptOff + i + 4]! * this.At[jOff + i + 4]! +
                           alpha[ptOff + i + 5]! * this.At[jOff + i + 5]! +
                           alpha[ptOff + i + 6]! * this.At[jOff + i + 6]! +
                           alpha[ptOff + i + 7]! * this.At[jOff + i + 7]!;
                }
                for (; i < N; i++) {
                    sum += alpha[ptOff + i]! * this.At[jOff + i]!;
                }
                const emissionProb = ot === -1 ? 1.0 : this.B[j * M + ot]!;
                const val = sum * emissionProb;
                alpha[tOff + j] = val;
                rowSum += val;
            }

            if (rowSum <= 0) return -Infinity;

            // Scale alpha_t and record log-scaling factor
            const invRowSum = 1.0 / rowSum;
            for (let i = 0; i < N; i++) alpha[tOff + i]! *= invRowSum;
            logLikelihood += Math.log(rowSum);
        }
        return logLikelihood;
    }

    /**
     * Calculates beta (backward variables): probability of partial sequence Ot+1..OT
     * given state i at time t.
     *
     * Numerical Stability:
     * Like computeForward, beta is scaled at each timestep. While beta doesn't
     * directly yield log-likelihood, using the same scaling factors as alpha
     * ensures that alpha[t][i] * beta[t][i] remains proportional to the
     * posterior probability of being in state i at time t.
     */
    private computeBackward(obs: Int32Array, beta: Float64Array) {
        const T = obs.length;
        const N = this.numStates;
        const M = this.numObservations;

        // Initialization Step (t=T-1)
        const lastOff = (T - 1) * N;
        for (let i = 0; i < N; i++) beta[lastOff + i] = 1;

        const bBeta = BufferPool.get(N);
        try {
            // Induction Step (t < T-1)
            for (let t = T - 2; t >= 0; t--) {
                const tOff = t * N;
                const ntOff = (t + 1) * N;
                const onext = obs[t + 1]!;
                let rowSum = 0;

                // Pre-calculate the emission-scaled beta for this time step
                if (onext === -1) {
                    for (let j = 0; j < N; j++) bBeta[j] = beta[ntOff + j]!;
                } else {
                    for (let j = 0; j < N; j++) {
                        bBeta[j] = this.B[j * M + onext]! * beta[ntOff + j]!;
                    }
                }

                for (let i = 0; i < N; i++) {
                    let sum = 0;
                    const iOff = i * N;

                    // Vectorized/Unrolled dot product: sum += A[i] * (B * beta[t+1])
                    let j = 0;
                    const limit = N - (N % 8);
                    for (; j < limit; j += 8) {
                        sum += this.A[iOff + j]! * bBeta[j]! +
                               this.A[iOff + j + 1]! * bBeta[j + 1]! +
                               this.A[iOff + j + 2]! * bBeta[j + 2]! +
                               this.A[iOff + j + 3]! * bBeta[j + 3]! +
                               this.A[iOff + j + 4]! * bBeta[j + 4]! +
                               this.A[iOff + j + 5]! * bBeta[j + 5]! +
                               this.A[iOff + j + 6]! * bBeta[j + 6]! +
                               this.A[iOff + j + 7]! * bBeta[j + 7]!;
                    }
                    for (; j < N; j++) {
                        sum += this.A[iOff + j]! * bBeta[j]!;
                    }

                    beta[tOff + i] = sum;
                    rowSum += sum;
                }

                // Normalization to maintain parity with forward scaling
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
                try {
                    this.updateTransposedA();
                    this.computeForward(obs, alpha);

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
