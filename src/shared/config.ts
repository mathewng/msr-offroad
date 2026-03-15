import type { BacktestConfig } from "./types";
import { EQUAL_SLOT_PROBABILITY } from "./utils";

/**
 * Common configuration defaults shared across different strategies.
 * These parameters control the HMM training and ensemble behavior.
 */
const BASE_CONFIG: Omit<BacktestConfig, "betLimit" | "scoreWeights" | "minScoreThreshold" | "relativeThreshold"> = {
    // Number of HMM models to train in the ensemble. Higher = more stable predictions.
    ensembleSize: 256,

    // Maximum iterations for the Baum-Welch training algorithm.
    trainingIterations: 10_000,

    // Number of HMM training sessions with different initializations per model.
    trainingRestarts: 8,

    // Convergence cutoff for training. Smaller values yield more precise fits but take longer.
    convergenceTolerance: 5e-3,

    // Number of CPU cores to use for parallel training.
    maxWorkers: 4,

    // Number of hidden states in the HMM.
    hmmStates: 7,

    // Observation space: round (1–3) × 6 slots × 3 buckets = 54.
    // Encoding: (round - 1) * 18 + (slot - 1) * 3 + bucket. Gives HMM round-specific structure.
    hmmObservations: 54,

    // Number of races to process in a single walk-forward training window.
    chunkSize: 1,

    // Default baseline win rates. These are fallback values.
    empiricalWinRates: {
        1: EQUAL_SLOT_PROBABILITY,
        2: EQUAL_SLOT_PROBABILITY,
        3: EQUAL_SLOT_PROBABILITY,
        4: EQUAL_SLOT_PROBABILITY,
        5: EQUAL_SLOT_PROBABILITY,
        6: EQUAL_SLOT_PROBABILITY,
    },

    // The weight of the prior (fictitious sample size) for smoothing.
    // Higher values make the model stickier to historical averages.
    priorWeight: 1,

    // Laplace smoothing constant for HMM re-estimation.
    // Prevents zero-probability transitions and improves generalization.
    hmmSmoothing: 1e-4,

    // Warm-start perturbation: when using seed params, scale factor for random noise (e.g. 0.5 = ±50%).
    perturbAmount: 0.5,
};

/**
 * Strategy: HIGHEST YIELD
 * Goal: Maximize total net profit.
 *
 * This strategy is more aggressive, placing up to 3 bets per race
 */
export const CONFIG_HIGHEST_YIELD: BacktestConfig = {
    ...BASE_CONFIG,

    chunkSize: 6,

    betLimit: 3,

    scoreWeights: {
        historical: 0.81,
        hmm: 0.19,
    },

    minScoreThreshold: 0,
    relativeThreshold: 0,
};

/**
 * Strategy: CONFIG_BET2
 * Goal: Variation of CONFIG_HIGHEST_YIELD but with maximum 2 bets per race
 */
export const CONFIG_BET2: BacktestConfig = {
    ...BASE_CONFIG,

    chunkSize: 2,

    betLimit: 2,

    scoreWeights: {
        historical: 0.3,
        hmm: 0.7,
    },

    minScoreThreshold: 0,
    relativeThreshold: 0,
};

/**
 * Strategy: EFFICIENCY
 * Goal: Maximize ROI (Return on Investment) and Precision.
 *
 * This strategy is highly selective, only betting on the single highest-confidence
 * slot when the HMM sequence and historical data strongly align.
 */
export const CONFIG_EFFICIENCY: BacktestConfig = {
    ...BASE_CONFIG,

    chunkSize: 6,

    betLimit: 1,

    scoreWeights: {
        historical: 0.88,
        hmm: 0.12,
    },

    minScoreThreshold: 0,
    relativeThreshold: 0,
};

/**
 * Default configuration used for generic tasks and optimization.
 */
export const CONFIG = CONFIG_HIGHEST_YIELD;
