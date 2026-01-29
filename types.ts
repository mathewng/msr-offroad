/**
 * Represents the time of a race session.
 * These are generally categorical values found in the source data.
 */
export type RaceTime = "12:00" | "18:00" | "12pm" | "6pm";

/**
 * Represents a single bet placed on a specific slot.
 */
export interface Bet {
    slot: number; // The lane number (1-6)
    cost: number; // The amount wagered (usually normalized to 1 unit in backtests)
}

/**
 * Represents all data for a single race instance.
 */
export interface Race {
    day: number; // Relative day number from the start of the dataset
    venue?: string; // Geographical/logical location for the race
    time: RaceTime; // Session time
    raceNumber: number; // Sequential round number (1, 2, or 3) within a session
    payouts: number[]; // Payout multipliers for each slot (index 0 corresponds to slot 1)
    bets: Bet[]; // List of bets made on this race
    winningSlot: number | null; // The slot that actually won (1-6)
    winningPayout: number | null; // The payout multiplier for the winner
}

/**
 * Statistics for a specific payout bucket.
 * Buckets are used to group similar payout ranges (e.g. favored vs longshots).
 */
export interface BucketStat {
    occurrences: number; // Number of times a slot had a payout in this specific bucket
    wins: number; // Number of times it won while in this bucket
    winRate: number; // Probability of winning (smoothed proportion)
}

/**
 * General statistics for a specific slot.
 */
export interface SlotStat {
    occurrences: number; // Total number of races this slot appeared in
    wins: number; // Total win count for this slot
    winRate: number; // Overall win probability
}

/**
 * Aggregated statistical results used by the prediction engine.
 * Contains multidimensional win rate perspectives.
 */
export interface StatsResult {
    /** Maps slot (1-6) to its per-bucket stats */
    bucketMap: Record<number, Record<number, BucketStat>>;
    /** Maps slot (1-6) to its overall historical stats */
    slotMap: Record<number, SlotStat>;
    /** Maps venue name to slot stats for that venue */
    venueMap: Record<string, Record<number, SlotStat>>;
    /** Maps round number (1-3) to slot stats for that round */
    roundMap: Record<number, Record<number, SlotStat>>;
    /** The winner of the most recent race in the sequence */
    lastWinningSlot: number | null;
    /** Momentum bonus factor calculated from historical data */
    momentumBonus?: number;
}

/**
 * Global configuration settings for the backtesting and prediction engine.
 */
export interface BacktestConfig {
    betLimit: number; // Maximum number of slots to bet on per race
    ensembleSize: number; // Number of HMM models to train in parallel per chunk
    trainingIterations: number; // Max Epochs for the Baum-Welch algorithm
    convergenceTolerance: number; // Log-likelihood delta threshold for early stopping
    maxWorkers: number; // Degree of parallelism for worker threads
    hmmStates: number; // Number of hidden states (latent variables) in the HMM
    hmmObservations: number; // Cardinality of the observation space (e.g., 18 = 6 slots * 3 buckets)
    chunkSize: number; // The "Walk-Forward" window size for retraining models
    scoreWeights: {
        historical: number; // Weight for historical statistical EV (0.0 to 1.0)
        hmm: number; // Weight for HMM sequence-based EV (0.0 to 1.0)
        momentum: number; // Weight for the streak/momentum bonus (0.0 to 1.0)
    };
    minScoreThreshold: number; // Hard floor for the final EV score before a bet is considered
    relativeThreshold?: number; // Optional edge required over the race average score
    empiricalWinRates?: Record<number, number>; // Baseline win rates for each slot (1-6)
    priorWeight?: number; // The strength of the prior (virtual observations) for Laplace smoothing
}
