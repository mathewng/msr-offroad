import type { BacktestConfig } from "./types";

/**
 * Common configuration defaults shared across different strategies.
 * These parameters control the HMM training and ensemble behavior.
 */
const BASE_CONFIG: Omit<BacktestConfig, "betLimit" | "scoreWeights" | "minScoreThreshold" | "relativeThreshold"> = {
    // Number of HMM models to train in the ensemble. Higher = more stable predictions.
    ensembleSize: 120,

    // Maximum iterations for the Baum-Welch training algorithm.
    trainingIterations: 600,

    // Convergence cutoff for training. Smaller values yield more precise fits but take longer.
    convergenceTolerance: 5e-3,

    // Number of CPU cores to use for parallel training.
    maxWorkers: 4,

    // Number of hidden states in the HMM. 8 states has been tested to be optimal.
    hmmStates: 8,

    // Observation space size: 6 slots * 3 payout buckets (Favored, Neutral, Longshot) = 18.
    hmmObservations: 18,

    // Number of races to process in a single walk-forward training window.
    // Races are done 3 at a time, so this is 3 races per chunk.
    // The payouts for the next 3 races are also released at the same time.
    chunkSize: 3,
};

/**
 * Strategy: HIGHEST YIELD
 * Goal: Maximize total net profit.
 *
 * This strategy is more aggressive, placing up to 2 bets per race and using a
 * lower confidence threshold to capture more positive-EV opportunities.
 */
export const CONFIG_HIGHEST_YIELD: BacktestConfig = {
    ...BASE_CONFIG,
    // Allow betting on up to 2 slots per race.
    betLimit: 3,

    scoreWeights: {
        // Higher weight on historical patterns for better stability in high-volume betting.
        historical: 0.14224,
        hmm: 0.74676,
        momentum: 0.111, // 11.1% weight on streaks

        // historical: 0.152,
        // hmm: 0.796,
        // momentum: 0.052, // 5.2% on streaks

        // historical: 0.16,
        // hmm: 0.84,
        // momentum: 0.0,
    },

    minScoreThreshold: 0.1, //config 1
    relativeThreshold: 0.22, //config 1

    // minScoreThreshold: 0, //config 2
    // relativeThreshold: 0.2, //config 2

    // minScoreThreshold: 0, //config 3
    // relativeThreshold: 0, //config 3

    // minScoreThreshold: 0.05,
    // relativeThreshold: 0.1,
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
    // Only ever bet on the top-rated candidate.
    betLimit: 1,

    scoreWeights: {
        // Equal split between history and HMM provides the highest ROI for selective bets.
        historical: 0.152,
        hmm: 0.796,
        momentum: 0.052, // 5.2% on streaks

        // historical: 0.16,
        // hmm: 0.84,
        // momentum: 0.0,
    },

    minScoreThreshold: 0, // config 1
    relativeThreshold: 0.2, // config 1

    // minScoreThreshold: 0, // config 2
    // relativeThreshold: 0, // config 2

    // minScoreThreshold: 0.1, // config 3
    // relativeThreshold: 0.22, // config 3

    // minScoreThreshold: 0.05,
    // relativeThreshold: 0.1,
};

/**
 * Default configuration used for generic tasks and optimization.
 */
export const CONFIG = CONFIG_HIGHEST_YIELD;
