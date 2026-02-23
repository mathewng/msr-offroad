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
 * Object pool for reusing Float64Array buffers to reduce GC pressure
 */
class BufferPool {
    private static pools = new Map<number, Float64Array[]>();

    static get(size: number): Float64Array {
        const pool = this.pools.get(size);
        if (pool && pool.length > 0) {
            return pool.pop()!;
        }
        return new Float64Array(size);
    }

    static release(buffer: Float64Array): void {
        const size = buffer.length;
        if (!this.pools.has(size)) {
            this.pools.set(size, []);
        }
        buffer.fill(0); // Clear for reuse
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
     */
    public train(observations: number[] | Int32Array, iterations: number = 100, tolerance: number = 0) {
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
                const logLikelihood = this.computeForward(obs, alpha);

                // Likelihood became zero or invalid
                if (logLikelihood === -Infinity) break;

                // Convergence Check
                if (tolerance > 0 && iter > 0) {
                    if (Math.abs(logLikelihood - oldLogLikelihood) < tolerance) {
                        // console.log(`Converged at iteration ${iter} with log-likelihood ${logLikelihood}`);
                        break;
                    }
                }
                oldLogLikelihood = logLikelihood;

                // 2. E-Step Part B: Backward Pass (compute beta)
                this.computeBackward(obs, beta);

                // 3. E-Step Part C: Consolidation & Accumulation
                // Reset accumulators
                accumA.fill(0);
                accumB.fill(0);
                denomA.fill(0);
                denomB.fill(0);

                for (let t = 0; t < T - 1; t++) {
                    let jointDenom = 0;
                    const tOff = t * N;
                    const ntOff = (t + 1) * N;
                    const oCurr = obs[t]!;
                    const oNext = obs[t + 1]!;

                    // Compute joint denominator for scaling xi and gamma
                    for (let i = 0; i < N; i++) {
                        const alphaVal = alpha[tOff + i]!;
                        const iOff = i * N;
                        for (let j = 0; j < N; j++) {
                            const emissionProb = oNext === -1 ? 1.0 : this.B[j * M + oNext]!;
                            jointDenom += alphaVal * this.A[iOff + j]! * emissionProb * beta[ntOff + j]!;
                        }
                    }

                    if (jointDenom === 0) jointDenom = 1e-20;
                    const invJointDenom = 1.0 / jointDenom;

                    for (let i = 0; i < N; i++) {
                        const alphaVal = alpha[tOff + i]!;
                        const iOff = i * N;
                        let gamma_ti = 0;

                        // Calculate xi_t(i, j) and accumulate into A's numerator and gamma_t(i)
                        for (let j = 0; j < N; j++) {
                            const emissionProb = oNext === -1 ? 1.0 : this.B[j * M + oNext]!;
                            const xi_tij = alphaVal * this.A[iOff + j]! * emissionProb * beta[ntOff + j]! * invJointDenom;
                            accumA[iOff + j]! += xi_tij;
                            gamma_ti += xi_tij;
                        }

                        // Re-estimate Initial Probabilities (pi) using gamma_0
                        if (t === 0) this.pi[i] = gamma_ti;

                        // Accumulate for transition denominator and emission re-estimation
                        denomA[i]! += gamma_ti;
                        if (oCurr !== -1) {
                            accumB[i * M + oCurr]! += gamma_ti;
                            denomB[i]! += gamma_ti;
                        }
                    }
                }

                // Handle the terminal state T-1 for B accumulation
                let terminalDenom = 0;
                const lastOff = (T - 1) * N;
                for (let i = 0; i < N; i++) terminalDenom += alpha[lastOff + i]!;
                if (terminalDenom === 0) terminalDenom = 1e-20;
                const invTerminalDenom = 1.0 / terminalDenom;
                const oLast = obs[T - 1]!;

                for (let i = 0; i < N; i++) {
                    const gamma_Ti = alpha[lastOff + i]! * invTerminalDenom;
                    if (oLast !== -1) {
                        accumB[i * M + oLast]! += gamma_Ti;
                        denomB[i]! += gamma_Ti;
                    }
                }

                // 4. M-Step: Maximum Likelihood Re-estimation
                const epsilon = 1e-10;
                for (let i = 0; i < N; i++) {
                    const iOff = i * N;
                    // Add epsilon for smoothing to avoid zero probabilities
                    const invDenomA = 1.0 / (denomA[i]! + (N * epsilon));
                    for (let j = 0; j < N; j++) {
                        this.A[iOff + j] = (accumA[iOff + j]! + epsilon) * invDenomA;
                    }

                    const iOffB = i * M;
                    // Add epsilon for smoothing to avoid zero probabilities
                    const invDenomB = 1.0 / (denomB[i]! + (M * epsilon));
                    for (let k = 0; k < M; k++) {
                        this.B[iOffB + k] = (accumB[iOffB + k]! + epsilon) * invDenomB;
                    }
                }

                // Sync the transposed copy
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
     * Uses scaling/normalization at each step to avoid numerical underflow.
     * Returns the total log-likelihood of the observations.
     */
    private computeForward(obs: Int32Array, alpha: Float64Array): number {
        const T = obs.length;
        const N = this.numStates;
        const M = this.numObservations;
        let logLikelihood = 0;

        const o0 = obs[0]!;
        let rowSum0 = 0;
        for (let i = 0; i < N; i++) {
            // If the first observation is missing, treat the emission probability as 1.0
            const emissionProb = o0 === -1 ? 1.0 : this.B[i * M + o0]!;
            const val = this.pi[i]! * emissionProb;
            alpha[i] = val;
            rowSum0 += val;
        }

        if (rowSum0 <= 0) return -Infinity;

        const invRowSum0 = 1.0 / rowSum0;
        for (let i = 0; i < N; i++) alpha[i]! *= invRowSum0;
        logLikelihood += Math.log(rowSum0);

        for (let t = 1; t < T; t++) {
            const tOff = t * N;
            const ptOff = (t - 1) * N;
            const ot = obs[t]!;
            let rowSum = 0;

            for (let j = 0; j < N; j++) {
                let sum = 0;
                const jOff = j * N;
                // Cache-friendly: At is transposed, so we access sequentially
                for (let i = 0; i < N; i++) {
                    sum += alpha[ptOff + i]! * this.At[jOff + i]!;
                }
                // If the observation is missing, treat the emission probability as 1.0
                const emissionProb = ot === -1 ? 1.0 : this.B[j * M + ot]!;
                const val = sum * emissionProb;
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
     * Calculates beta (backward variables): probability of partial sequence Ot+1..OT
     * given state i at time t.
     */
    private computeBackward(obs: Int32Array, beta: Float64Array) {
        const T = obs.length;
        const N = this.numStates;
        const M = this.numObservations;

        const lastOff = (T - 1) * N;
        for (let i = 0; i < N; i++) beta[lastOff + i] = 1;

        for (let t = T - 2; t >= 0; t--) {
            const tOff = t * N;
            const ntOff = (t + 1) * N;
            const onext = obs[t + 1]!;
            let rowSum = 0;

            for (let i = 0; i < N; i++) {
                let sum = 0;
                const iOff = i * N;
                for (let j = 0; j < N; j++) {
                    // If the next observation is missing, treat the emission probability as 1.0
                    const emissionProb = onext === -1 ? 1.0 : this.B[j * M + onext]!;
                    sum += this.A[iOff + j]! * emissionProb * beta[ntOff + j]!;
                }
                beta[tOff + i] = sum;
                rowSum += sum;
            }

            // Normalization to maintain numerical stability
            if (rowSum === 0) rowSum = 1e-20;
            const invRowSum = 1.0 / rowSum;
            for (let i = 0; i < N; i++) beta[tOff + i]! *= invRowSum;
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
     * 1. Runs the Forward Algorithm to find the state distribution for the
     *    most recent observation.
     * 2. Iteratively multiplies the distribution by the transition matrix (A).
     * 3. Projects the state distribution onto the observation space using (B).
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
                    for (let i = 0; i < N; i++) {
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
                    for (let k = 0; k < M; k++) {
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
