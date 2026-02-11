import type { BacktestConfig } from "./types";
import { EQUAL_SLOT_PROBABILITY } from "./utils";

/**
 * Common configuration defaults shared across different strategies.
 * These parameters control the HMM training and ensemble behavior.
 */
const BASE_CONFIG: Omit<BacktestConfig, "betLimit" | "scoreWeights" | "minScoreThreshold" | "relativeThreshold"> = {
    // Number of HMM models to train in the ensemble. Higher = more stable predictions.
    ensembleSize: 120,

    // Maximum iterations for the Baum-Welch training algorithm.
    trainingIterations: 10_000,

    // Convergence cutoff for training. Smaller values yield more precise fits but take longer.
    convergenceTolerance: 1e-3,

    // Number of CPU cores to use for parallel training.
    maxWorkers: 4,

    // Number of hidden states in the HMM. 8 states has been tested to be optimal.
    hmmStates: 6,

    // Observation space size: 6 slots * 3 payout buckets (Favored, Neutral, Longshot) = 18.
    hmmObservations: 18,

    // Number of races to process in a single walk-forward training window.
    // Races are done 3 at a time, so this is 3 races per chunk.
    // The payouts for the next 3 races are also released at the same time.
    chunkSize: 3,

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
        historical: 0.825,
        hmm: 0.175,
        momentum: 0,
        zigZag: 0,
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
        // baseline performance to beat
        // historical: 1,
        // hmm: 0,
        historical: 0.825,
        hmm: 0.175,
        momentum: 0,
        zigZag: 0,
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

    hmmStates: 6,
    betLimit: 1,

    scoreWeights: {
        // baseline to beat
        // historical: 1,
        // hmm: 0,
        historical: 0.84,
        hmm: 0.16,
        momentum: 0,
        zigZag: 0,
    },

    minScoreThreshold: 0,
    relativeThreshold: 0,
};

/**
 * Default configuration used for generic tasks and optimization.
 */
export const CONFIG = CONFIG_HIGHEST_YIELD;
