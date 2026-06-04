import type { BacktestConfig } from "./types";
import { EQUAL_SLOT_PROBABILITY } from "./utils";

/**
 * Common configuration defaults shared across different strategies.
 * These parameters control the HMM training and ensemble behavior.
 */
const BASE_CONFIG: Omit<BacktestConfig, "betLimit" | "scoreWeights" | "minScoreThreshold" | "relativeThreshold"> = {
    // Number of HMM models to train in the ensemble. Higher = more stable predictions.
    ensembleSize: 100,

    // Maximum iterations for the Baum-Welch training algorithm.
    trainingIterations: 10_000,

    // Number of HMM training sessions with different initializations per model.
    trainingRestarts: 3,

    // Convergence cutoff for training. Smaller values yield more precise fits but take longer.
    convergenceTolerance: 5e-2,

    // Number of CPU cores to use for parallel training.
    maxWorkers: 4,

    // Number of hidden states in the HMM.
    hmmStates: 8,

    // Observation space: round (1–3) × 6 slots × 3 buckets = 54.
    // Encoding: (round - 1) * 18 + (slot - 1) * 3 + bucket. Gives HMM round-specific structure.
    hmmObservations: 54,

    // Number of races to process in a single walk-forward training window.
    chunkSize: 9,

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
    priorWeight: 5,

    // Laplace smoothing constant for HMM re-estimation.
    // Prevents zero-probability transitions and improves generalization.
    hmmSmoothing: 1e-8,

    // Warm-start perturbation: when using seed params, scale factor for random noise (e.g. 0.2 = ±20%).
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

    betLimit: 3,

    scoreWeights: {
        historical: 0.09,
        hmm: 0.91,
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

    betLimit: 2,

    scoreWeights: {
        historical: 0.29,
        hmm: 0.71,
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

    betLimit: 1,

    scoreWeights: {
        historical: 0.01,
        hmm: 0.99,
    },

    minScoreThreshold: 0,
    relativeThreshold: 0,
};

/**
 * Strategy: CONTEXT EV PREDICTOR (CEVP)
 * Venue×round + monster-in-slot lookups; no HMM.
 */
export const CONFIG_CONTEXT: BacktestConfig = {
    ...BASE_CONFIG,
    betLimit: 2,
    scoreWeights: {
        historical: 1,
        hmm: 0,
    },
    minScoreThreshold: 0,
    relativeThreshold: 0,
    priorWeight: 5,
};

/** Conservative CEVP: single bet, requires positive relative edge. */
export const CONFIG_CONTEXT_CONSERVATIVE: BacktestConfig = {
    ...CONFIG_CONTEXT,
    betLimit: 1,
    relativeThreshold: 0.05,
};

/**
 * Default configuration used for generic tasks and optimization.
 */
export const CONFIG = CONFIG_HIGHEST_YIELD;
