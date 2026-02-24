/**
 * @file backtest.ts
 * @description Main entry point for the backtesting engine.
 * This module simulates the performance of the prediction system on historical data
 * using a walk-forward optimization methodology. It leverages an ensemble of
 * Hidden Markov Models (HMM) trained in parallel to predict race outcomes.
 */

import { CONFIG_BET2, CONFIG_EFFICIENCY, CONFIG_HIGHEST_YIELD } from "./config";
import { calculateEmpiricalWinRates } from "./utils";
import { predictRace } from "./prediction-engine";
import type { BacktestConfig, Race } from "./types";
import { calculateStats, formatCurrency, getPayoutBucket, parseLines, updateStats } from "./utils";
import { WorkerPool } from "./worker-pool";

/**
 * Tracks cumulative performance metrics throughout a backtest run.
 */
interface BacktestStats {
    totalProfit: number; // Net profit/loss in currency units
    correctPredictions: number; // Count of races where at least one bet was a winner
    totalPredictions: number; // Total number of races where at least one bet was placed
    totalBetCost: number; // Total amount wagered (1 unit per bet)
    skippedRaces: number; // Number of races where the system chose not to bet
}

/**
 * Loads race data from a flat file and parses it into structured Race objects.
 * Uses Bun's high-performance file I/O.
 *
 * @param filePath - The local path to the raw text data file.
 * @returns A promise resolving to an array of parsed Race objects.
 */
async function loadRaces(filePath: string | undefined): Promise<Race[]> {
    if (!filePath) return [];
    try {
        const file = Bun.file(filePath);
        if (await file.exists()) {
            const text = await file.text();
            return parseLines(text.split("\n"));
        }
    } catch (e) {
        console.error(`Error loading file ${filePath}:`, e);
    }
    return [];
}

/**
 * Formats and prints backtest results to the terminal.
 * Designed for readability, it outputs each race row-by-row and
 * provides a final statistical summary of the run.
 */
class ResultPrinter {
    // 126 characters wide for a standard terminal width
    private static readonly SEPARATOR = "-".repeat(126);

    /**
     * Table Columns:
     * Day | Venue | Time | R: Race Number | Bets: Slots being bet on | Act: Actual Winner
     * Pay: Actual Payout | Score: Model confidence score | Win?: Outcome | Profit: Net of the race
     * Cumulative: Total profit so far | Status: Execution status (WIN/LOSS/PENDING/SKIPPED)
     * Mode: Consensus HMM hidden state
     */
    private static readonly HEADER = `${"Day".padStart(3)} | ${"Venue".padEnd(14)} | ${"Time".padEnd(5)} | R | ${"Mode".padStart(4)} | ${"Bets".padEnd(7)} | ${"Act".padStart(3)} | ${"Pay".padStart(4)} | ${"Score".padStart(6)} | ${"Win?".padEnd(4)} | ${"Profit".padStart(8)} | ${"Cumulative".padStart(10)} | ${"Status".padEnd(8)}`;

    /**
     * Prints the table's header and separators.
     */
    static printHeader() {
        console.log([this.SEPARATOR, this.HEADER, this.SEPARATOR].join("\n"));
    }

    /**
     * Buffers and prints a single result row.
     *
     * @param race - The race being processed.
     * @param bets - Array of slot indices (1-6) the model bet on.
     * @param winningSlot - The actual winning slot index (null if pending).
     * @param winningPayout - The payout for the winning slot (null if pending).
     * @param score - The confidence score assigned to the prediction.
     * @param raceProfit - The net profit/loss for this specific race.
     * @param totalProfit - The cumulative profit up to this point in the backtest.
     * @param status - Textual status string.
     * @param regime - The consensus hidden state index.
     */
    static printRow(race: Race, bets: number[], winningSlot: number | null, winningPayout: number | null, score: number, raceProfit: number, totalProfit: number, status: string, regime: number) {
        // Visual representation of bets (e.g., "1 3 5")
        const betDisplay = [1, 2, 3, 4, 5, 6].map((s) => (bets.includes(s) ? s.toString() : " ")).join("");

        const isPending = winningSlot === null;

        /**
         * Win Status Logic:
         * - PENDING if outcome is unknown.
         * - YES if the race was profitable OR if any of our bets matched the winning slot.
         * - NO otherwise.
         */
        const winStatus = isPending ? "-" : raceProfit > 0 || (bets.includes(winningSlot!) && winningPayout! >= 1) ? "YES" : "NO";

        console.log(
            `${race.day.toString().padStart(3)} | ${(race.venue || "").padEnd(14)} | ${race.time.padEnd(5)} | ${race.raceNumber} | ${("S" + regime).padStart(4)} | ${betDisplay.padEnd(7)} | ${isPending ? "?".padStart(3) : winningSlot!.toString().padStart(3)} | ${isPending ? "?".padStart(4) : winningPayout!.toString().padStart(4)} | ${score.toFixed(2).padStart(6)} | ${winStatus.padEnd(4)} | ${isPending ? "-".padStart(8) : raceProfit.toFixed(2).padStart(8)} | ${totalProfit.toFixed(2).padStart(10)} | ${status.padEnd(8)}`,
        );
    }

    /**
     * Summarizes the entire backtest run including ROI and Accuracy metrics.
     *
     * ROI = Net Profit / Total Units Wagered
     * Accuracy = Correct Race Predictions / Total Races Bet On
     */
    static printSummary(stats: BacktestStats) {
        const { totalProfit, totalBetCost, correctPredictions, totalPredictions } = stats;
        const roi = totalBetCost > 0 ? (totalProfit / totalBetCost) * 100 : 0;
        const accuracy = (correctPredictions / (totalPredictions || 1)) * 100;

        console.log(this.SEPARATOR);
        console.log(
            `ROI: ${roi.toFixed(2).padStart(6)}% | Profit: ${formatCurrency(totalProfit).padStart(6, " ")} | Accuracy: ${accuracy.toFixed(2)}% | Total Bets: ${totalBetCost} | Total Preds: ${totalPredictions}`,
        );
    }
}

/**
 * The core backtest execution engine.
 * Implements "Walk-Forward" simulation to accurately reflect real-world performance.
 *
 * Walk-Forward Lifecycle:
 * 1. Initialize historical statistics from past data (e.g., previous month).
 * 2. Process current races in chunks (e.g., 20 races at a time).
 * 3. Before each chunk, retrain an ensemble of HMMs on ALL data known so far.
 * 4. Parallelized HMM training using WorkerPool ensures performance on multicore systems.
 * 5. Predict outcomes for the next chunk, update stats after each race.
 * 6. Repeat until all races in the target dataset are processed.
 *
 * @param prevFile - Path to historical race results (the "Training" set).
 * @param currFile - Path to target race results (the "Test" set).
 * @param config - Global configuration governing weights, thresholds, and simulation parameters.
 */
async function runBacktest(prevFile: string, currFile: string, config: BacktestConfig) {
    const previousMonthsRaces = await loadRaces(prevFile);
    const currentMonthRaces = await loadRaces(currFile);

    if (currentMonthRaces.length === 0) {
        console.error(`Error: No data found in ${currFile}`);
        process.exit(1);
    }

    // Dynamic configuration update: Calculate empirical win rates from the historical data provided
    // This allows the model to adapt its priors based on the specific historical dataset.
    config.empiricalWinRates = calculateEmpiricalWinRates(previousMonthsRaces);

    // Initialize the worker pool for parallel HMM training (ensemble approach)
    const pool = new WorkerPool(config.maxWorkers, "./hmm-worker.ts");
    const history = [...previousMonthsRaces];
    const stats: BacktestStats = {
        totalProfit: 0,
        correctPredictions: 0,
        totalPredictions: 0,
        totalBetCost: 0,
        skippedRaces: 0,
    };

    /**
     * HMM Observation Sequence Encoding:
     * Observations are mapped to a single integer representing (slot * payout_bucket).
     * Format: (winning_slot_index [0-5] * 3) + payout_bucket [0-2]
     * This captures the dependency between the winning slot and its payout magnitude.
     * Uses -1 to represent missing data in the sequence.
     */
    let sequence = history.map((r) => (r.winningSlot !== null && r.winningPayout !== null ? (r.winningSlot - 1) * 3 + getPayoutBucket(r.winningPayout, r.winningSlot) : -1));

    /**
     * Mechanical Sympathy (Performance Optimization):
     * SharedArrayBuffer allows multiple worker threads to access the observation sequence
     * with zero-copy overhead, which is critical for the intensive ensemble training.
     */
    const maxSequenceLength = sequence.length + currentMonthRaces.length;
    const sharedBuffer = new SharedArrayBuffer(maxSequenceLength * 4); // 4 bytes per Int32
    const sequenceArray = new Int32Array(sharedBuffer);
    sequenceArray.set(sequence);

    // Reusable Float64Array to aggregate probabilities from the ensemble
    const aggregatedProbs = new Float64Array(config.hmmObservations);

    // Initial statistical baseline from the historical set
    let currentStats = calculateStats(history, config);
    console.log(`Loaded history: ${history.length}, Target: ${currentMonthRaces.length}. Using ${config.maxWorkers} cores.`);
    ResultPrinter.printHeader();

    // Process target races in chunks to simulate periodic retraining of models
    for (let i = 0; i < currentMonthRaces.length; i += config.chunkSize) {
        const chunk = currentMonthRaces.slice(i, i + config.chunkSize);

        // Update the SharedArrayBuffer with the most recent sequence data before retraining
        const currentSequenceView = sequenceArray.subarray(0, sequence.length);
        currentSequenceView.set(sequence);

        // Retrain an ensemble of models in parallel.
        // Different models capture varying local optima, and averaging their
        // results (Ensemble Averaging) improves overall predictive stability.
        const ensemblePromises = Array.from({ length: config.ensembleSize }, () =>
            pool.run({
                sequence: currentSequenceView,
                numStates: config.hmmStates,
                numObservations: config.hmmObservations,
                iterations: config.trainingIterations,
                restarts: config.trainingRestarts,
                tolerance: config.convergenceTolerance,
                smoothing: config.hmmSmoothing,
                steps: chunk.length,
            }),
        );

        const allEnsemblePredictions = await Promise.all(ensemblePromises);
        const invEnsembleSize = 1.0 / config.ensembleSize;

        // Determine the consensus "Regime" (most likely hidden state) for the current historical state.
        // We take the mode of the last state in the Viterbi path across all ensemble members.
        const regimeCounts = new Map<number, number>();
        for (const pred of allEnsemblePredictions) {
            if (pred.viterbiPath && pred.viterbiPath.length > 0) {
                const lastState = pred.viterbiPath[pred.viterbiPath.length - 1];
                regimeCounts.set(lastState, (regimeCounts.get(lastState) || 0) + 1);
            }
        }
        let consensusRegime = 0;
        if (regimeCounts.size > 0) {
            let maxRegimeCount = -1;
            for (const [state, count] of regimeCounts) {
                if (count > maxRegimeCount) {
                    maxRegimeCount = count;
                    consensusRegime = state;
                }
            }
        }

        // Process each race in the current chunk one-by-one
        for (let j = 0; j < chunk.length; j++) {
            const currentRace = chunk[j]!;
            aggregatedProbs.fill(0);

            // Compute the average probability for each observation across all models in the ensemble
            for (let e = 0; e < allEnsemblePredictions.length; e++) {
                const stepProbs = allEnsemblePredictions[e]!.results[j];
                if (stepProbs) {
                    for (let k = 0; k < config.hmmObservations; k++) {
                        aggregatedProbs[k] = aggregatedProbs[k]! + stepProbs[k]! * invEnsembleSize;
                    }
                }
            }

            // Combine HMM probabilities with historical statistics to determine bets
            const { bets, score } = predictRace(currentRace, currentStats, aggregatedProbs, config);
            const isPending = currentRace.winningSlot === null;
            let raceProfit = 0;
            let raceWins = 0;

            // Evaluate prediction outcome against ground truth
            if (!isPending) {
                for (const slot of bets) {
                    if (slot === currentRace.winningSlot) {
                        // Success: Gain = Payout - Stake (1 unit per bet)
                        raceProfit += currentRace.winningPayout! - 1;
                        raceWins++;
                    } else {
                        // Failure: Loss = Stake (1 unit per bet)
                        raceProfit -= 1;
                    }
                }

                // Update cumulative stats if any bets were placed
                if (bets.length > 0) {
                    stats.totalProfit += raceProfit;
                    stats.totalBetCost += bets.length;
                    if (raceWins > 0) stats.correctPredictions++;
                    stats.totalPredictions++;
                } else {
                    stats.skippedRaces++;
                }
            }

            const status = bets.length > 0 ? (isPending ? "???" : raceWins > 0 ? "WIN" : "LOSS") : isPending ? "PENDING" : "SKIPPED";

            ResultPrinter.printRow(currentRace, bets, currentRace.winningSlot, currentRace.winningPayout, score, raceProfit, stats.totalProfit, status, consensusRegime);

            // Walk-forward Step: Update the model's history and statistics after EACH race
            // This ensures the NEXT race prediction has access to the result of the CURRENT race.
            if (!isPending) {
                sequence.push((currentRace.winningSlot! - 1) * 3 + getPayoutBucket(currentRace.winningPayout!, currentRace.winningSlot!));
                updateStats(currentStats, currentRace, config);
            } else {
                sequence.push(-1); // Maintain temporal sequence even if result is unknown
            }
            history.push(currentRace);
        }
    }

    pool.terminate();
    ResultPrinter.printSummary(stats);
}

/**
 * CLI Argument Parser.
 * Configures the backtest based on user input flags and positional arguments.
 *
 * Positional Arguments:
 * 1. Historical data file (training set)
 * 2. Target data file (test set)
 *
 * Flags:
 * --efficiency: Use configuration optimized for higher ROI.
 * --yield: Use configuration optimized for higher net profit.
 * --bet2: Strategy that allows up to 2 bets per race.
 * --historical-weight=<val>: Override the importance of historical statistics.
 * --hmm-weight=<val>: Override the importance of HMM predictions.
 * --momentum-weight=<val>: Override the importance of momentum/trend signals.
 * --zigzag-weight=<val>: Override the importance of ZigZag reversal signals.
 * --min-score=<val>: Confidence threshold for placing a bet.
 * --relative-threshold=<val>: Secondary threshold relative to the top choice.
 * --hmm-smoothing=<val>: Laplace smoothing constant for HMM re-estimation.
 * --chunk-size=<val>: How many races to process before HMM retraining.
 * --restarts=<val>: Number of HMM training sessions per model.
 * --print-config-only: Calculate empirical win rates and exit after printing the config.
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const fileArgs = args.filter((a) => !a.startsWith("-"));
    const flags = args.filter((a) => a.startsWith("-"));

    // Select the base configuration strategy
    let config = CONFIG_HIGHEST_YIELD;
    if (flags.includes("--efficiency") || flags.includes("--eff") || flags.includes("-eff") || flags.includes("-e")) {
        config = CONFIG_EFFICIENCY;
    } else if (flags.includes("--yield") || flags.includes("-y")) {
        config = CONFIG_HIGHEST_YIELD;
    } else if (flags.includes("--bet2") || flags.includes("-b2")) {
        config = CONFIG_BET2;
    }

    // Dynamic Weights Overrides: Allows fine-tuning the model's ensemble components
    const historicalWeightMatch = args.find((a) => a.startsWith("--historical-weight="));
    const hmmWeightMatch = args.find((a) => a.startsWith("--hmm-weight="));
    const momentumWeightMatch = args.find((a) => a.startsWith("--momentum-weight="));
    const zigZagWeightMatch = args.find((a) => a.startsWith("--zigzag-weight="));

    if (historicalWeightMatch || hmmWeightMatch || momentumWeightMatch || zigZagWeightMatch) {
        config = { ...config };
        if (historicalWeightMatch && historicalWeightMatch.includes("=") && historicalWeightMatch.split("=")[1]!.trim() !== "") {
            const weight = parseFloat(historicalWeightMatch.split("=")[1]!);
            if (!isNaN(weight)) {
                config.scoreWeights = { ...config.scoreWeights, historical: weight };
            }
        }
        if (hmmWeightMatch && hmmWeightMatch.includes("=") && hmmWeightMatch.split("=")[1]!.trim() !== "") {
            const weight = parseFloat(hmmWeightMatch.split("=")[1]!);
            if (!isNaN(weight)) {
                config.scoreWeights = { ...config.scoreWeights, hmm: weight };
            }
        }
        if (momentumWeightMatch && momentumWeightMatch.includes("=") && momentumWeightMatch.split("=")[1]!.trim() !== "") {
            const weight = parseFloat(momentumWeightMatch.split("=")[1]!);
            if (!isNaN(weight)) {
                config.scoreWeights = { ...config.scoreWeights, momentum: weight };
            }
        }
        if (zigZagWeightMatch && zigZagWeightMatch.includes("=") && zigZagWeightMatch.split("=")[1]!.trim() !== "") {
            const weight = parseFloat(zigZagWeightMatch.split("=")[1]!);
            if (!isNaN(weight)) {
                config.scoreWeights = { ...config.scoreWeights, zigZag: weight };
            }
        }
    }

    // Decision Logic Overrides: Affects how aggressive the model is
    const minScoreMatch = args.find((a) => a.startsWith("--min-score="));
    if (minScoreMatch && minScoreMatch.includes("=") && minScoreMatch.split("=")[1]!.trim() !== "") {
        const threshold = parseFloat(minScoreMatch.split("=")[1]!);
        if (!isNaN(threshold)) {
            config = { ...config, minScoreThreshold: threshold };
        }
    }

    const relativeMatch = args.find((a) => a.startsWith("--relative-threshold="));
    if (relativeMatch && relativeMatch.includes("=") && relativeMatch.split("=")[1]!.trim() !== "") {
        const threshold = parseFloat(relativeMatch.split("=")[1]!);
        if (!isNaN(threshold)) {
            config = { ...config, relativeThreshold: threshold };
        }
    }

    const priorMatch = args.find((a) => a.startsWith("--prior-weight="));
    if (priorMatch && priorMatch.includes("=") && priorMatch.split("=")[1]!.trim() !== "") {
        const weight = parseFloat(priorMatch.split("=")[1]!);
        if (!isNaN(weight)) {
            config = { ...config, priorWeight: weight };
        }
    }

    const hmmSmoothingMatch = args.find((a) => a.startsWith("--hmm-smoothing="));
    if (hmmSmoothingMatch && hmmSmoothingMatch.includes("=") && hmmSmoothingMatch.split("=")[1]!.trim() !== "") {
        const smoothing = parseFloat(hmmSmoothingMatch.split("=")[1]!);
        if (!isNaN(smoothing)) {
            config = { ...config, hmmSmoothing: smoothing };
        }
    }

    const chunkSizeMatch = args.find((a) => a.startsWith("--chunk-size="));
    if (chunkSizeMatch && chunkSizeMatch.includes("=") && chunkSizeMatch.split("=")[1]!.trim() !== "") {
        const chunkSize = parseInt(chunkSizeMatch.split("=")[1]!, 10);
        if (!isNaN(chunkSize) && chunkSize > 0) {
            config = { ...config, chunkSize: chunkSize };
        }
    }

    const restartsMatch = args.find((a) => a.startsWith("--restarts="));
    if (restartsMatch && restartsMatch.includes("=") && restartsMatch.split("=")[1]!.trim() !== "") {
        const restarts = parseInt(restartsMatch.split("=")[1]!, 10);
        if (!isNaN(restarts) && restarts > 0) {
            config = { ...config, trainingRestarts: restarts };
        }
    }

    return {
        prevFile: fileArgs[0],
        currFile: fileArgs[1],
        config,
        showConfigOnly: flags.includes("--print-config-only") || flags.includes("-pco"),
    };
}

// Main Process Flow
const { prevFile, currFile, config, showConfigOnly } = parseArgs();

// Feature: Export configuration with calculated win rates for use in other tools or debugging
if (showConfigOnly) {
    const previousMonthsRaces = await loadRaces(prevFile);
    if (previousMonthsRaces.length > 0) {
        config.empiricalWinRates = calculateEmpiricalWinRates(previousMonthsRaces);
    }
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
}

// Mandatory file check for standard backtest run
if (!prevFile || !currFile) {
    console.error("Usage: bun backtest.ts <previous_month_data> <current_month_data> [--efficiency|--yield|--bet2] [overrides...]");
    process.exit(1);
}

// Initiate the simulation
runBacktest(prevFile, currFile, config).catch(console.error);
