import { CONFIG_EFFICIENCY, CONFIG_HIGHEST_YIELD, calculateEmpiricalWinRates } from "./config";
import { predictRace } from "./prediction-engine";
import type { BacktestConfig, Race } from "./types";
import { calculateStats, formatCurrency, getPayoutBucket, parseLines, updateStats } from "./utils";
import { WorkerPool } from "./worker-pool";

/**
 * Interface for tracking cumulative backtest performance.
 * Tracks profit, accuracy, and volume of bets.
 */
interface BacktestStats {
    totalProfit: number;
    correctPredictions: number;
    totalPredictions: number;
    totalBetCost: number;
    skippedRaces: number;
}

/**
 * Helper to load and parse race data from a text file.
 * Uses Bun.file for fast I/O.
 *
 * @param filePath - Path to the data file.
 * @returns A promise that resolves to an array of parsed Race objects.
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
 * Handles all console output formatting for the backtest results.
 * Outputs a tabular view of each race prediction and a final summary.
 * Optimized with string builder pattern to reduce memory allocations.
 */
class ResultPrinter {
    private static readonly SEPARATOR = "-".repeat(126);
    private static readonly HEADER = `${"Day".padStart(3)} | ${"Venue".padEnd(14)} | ${"Time".padEnd(5)} | R | ${"Bets".padEnd(7)} | ${"Act".padStart(3)} | ${"Pay".padStart(4)} | ${"Score".padStart(6)} | ${"Win?".padEnd(4)} | ${"Profit".padStart(8)} | ${"Cumulative".padStart(10)} | ${"Status".padEnd(8)}`;

    /**
     * Prints the table header for the race-by-race output.
     */
    static printHeader() {
        console.log([this.SEPARATOR, this.HEADER, this.SEPARATOR].join("\n"));
    }

    /**
     * Buffers a single row instead of immediate console output.
     */
    static printRow(race: Race, bets: number[], winningSlot: number | null, winningPayout: number | null, score: number, raceProfit: number, totalProfit: number, status: string) {
        const betDisplay = [1, 2, 3, 4, 5, 6].map((s) => (bets.includes(s) ? s.toString() : " ")).join("");
        const isPending = winningSlot === null;
        const winStatus = isPending ? "-" : raceProfit > 0 || (bets.includes(winningSlot!) && winningPayout! >= 1) ? "YES" : "NO";

        console.log(
            `${race.day.toString().padStart(3)} | ${(race.venue || "").padEnd(14)} | ${race.time.padEnd(5)} | ${race.raceNumber} | ${betDisplay.padEnd(7)} | ${isPending ? "?".padStart(3) : winningSlot!.toString().padStart(3)} | ${isPending ? "?".padStart(4) : winningPayout!.toString().padStart(4)} | ${score.toFixed(2).padStart(6)} | ${winStatus.padEnd(4)} | ${isPending ? "-".padStart(8) : raceProfit.toFixed(2).padStart(8)} | ${totalProfit.toFixed(2).padStart(10)} | ${status.padEnd(8)}`,
        );
    }

    /**
     * Prints the final summary statistics including ROI and accuracy.
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
 * Orchestrates the backtesting process.
 *
 * The backtest uses a "Walk-Forward" methodology:
 * 1. Load historical data.
 * 2. Process current data in chunks.
 * 3. Before each chunk, train an ensemble of Hidden Markov Models (HMM) on all known history.
 * 4. Predict each race in the chunk using a combination of historical stats and HMM probabilities.
 * 5. Update the history and statistics with the actual outcomes after each race.
 *
 * This approach simulates real-world deployment where models are periodically retrained
 * as new data becomes available, maintaining an accurate picture of the system's behavior.
 *
 * @param prevFile - Path to the historical data file.
 * @param currFile - Path to the target data file for testing.
 * @param config - The backtest configuration settings.
 */
async function runBacktest(prevFile: string, currFile: string, config: BacktestConfig) {
    const previousMonthsRaces = await loadRaces(prevFile);
    const currentMonthRaces = await loadRaces(currFile);

    if (currentMonthRaces.length === 0) {
        console.error(`Error: No data found in ${currFile}`);
        process.exit(1);
    }

    // Dynamic configuration update: Calculate empirical win rates from the historical data provided
    config.empiricalWinRates = calculateEmpiricalWinRates(previousMonthsRaces);

    // Initialize the worker pool for parallel HMM training
    const pool = new WorkerPool(config.maxWorkers, "./hmm-worker.ts");
    const history = [...previousMonthsRaces];
    const stats: BacktestStats = {
        totalProfit: 0,
        correctPredictions: 0,
        totalPredictions: 0,
        totalBetCost: 0,
        skippedRaces: 0,
    };

    // Prepare the initial observation sequence for the HMM (slot index * 3 + payout bucket)
    let sequence = history.filter((r) => r.winningSlot !== null && r.winningPayout !== null).map((r) => (r.winningSlot! - 1) * 3 + getPayoutBucket(r.winningPayout!, r.winningSlot!));

    // Pre-allocate reusable SharedArrayBuffer with extra capacity
    const maxSequenceLength = sequence.length + currentMonthRaces.length;
    const sharedBuffer = new SharedArrayBuffer(maxSequenceLength * 4);
    const sequenceArray = new Int32Array(sharedBuffer);
    sequenceArray.set(sequence);

    // Pre-allocate reusable aggregation buffer
    const aggregatedProbs = new Float64Array(config.hmmObservations);

    // Calculate initial statistical win rates from history
    let currentStats = calculateStats(history, config);
    console.log(`Loaded history: ${history.length}, Target: ${currentMonthRaces.length}. Using ${config.maxWorkers} cores.`);
    ResultPrinter.printHeader();

    // Process target races in chunks to simulate periodic retraining
    for (let i = 0; i < currentMonthRaces.length; i += config.chunkSize) {
        const chunk = currentMonthRaces.slice(i, i + config.chunkSize);

        /**
         * Performance Optimization (Mechanical Sympathy):
         * Reuse SharedArrayBuffer to avoid expensive allocations.
         * Only update the relevant portion with current sequence data.
         */
        const currentSequenceView = sequenceArray.subarray(0, sequence.length);
        currentSequenceView.set(sequence);

        // Retrain an ensemble of models in parallel to improve stability and capture different patterns
        const ensemblePromises = Array.from({ length: config.ensembleSize }, () =>
            pool.run({
                sequence: currentSequenceView,
                numStates: config.hmmStates,
                numObservations: config.hmmObservations,
                iterations: config.trainingIterations,
                tolerance: config.convergenceTolerance,
                steps: chunk.length,
            }),
        );

        const allEnsemblePredictions = await Promise.all(ensemblePromises);
        const invEnsembleSize = 1.0 / config.ensembleSize;

        // Process each race in the current chunk
        for (let j = 0; j < chunk.length; j++) {
            const currentRace = chunk[j]!;
            aggregatedProbs.fill(0);

            // Average predictions across the ensemble to reduce variance
            for (let e = 0; e < allEnsemblePredictions.length; e++) {
                const stepProbs = allEnsemblePredictions[e]![j];
                if (stepProbs) {
                    for (let k = 0; k < config.hmmObservations; k++) {
                        aggregatedProbs[k] = aggregatedProbs[k]! + stepProbs[k]! * invEnsembleSize;
                    }
                }
            }

            // Generate betting decisions based on combined stats and HMM predictions
            const { bets, score } = predictRace(currentRace, currentStats, aggregatedProbs, config);
            const isPending = currentRace.winningSlot === null;
            let raceProfit = 0;
            let raceWins = 0;

            // Evaluate the prediction if the race outcome is known
            if (!isPending) {
                for (const slot of bets) {
                    if (slot === currentRace.winningSlot) {
                        raceProfit += currentRace.winningPayout! - 1;
                        raceWins++;
                    } else {
                        raceProfit -= 1;
                    }
                }

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

            ResultPrinter.printRow(currentRace, bets, currentRace.winningSlot, currentRace.winningPayout, score, raceProfit, stats.totalProfit, status);

            // Walk-forward: Add the new result to the HMM sequence and update historical stats
            if (!isPending) {
                sequence.push((currentRace.winningSlot! - 1) * 3 + getPayoutBucket(currentRace.winningPayout!, currentRace.winningSlot!));
                updateStats(currentStats, currentRace, config);
            }
            history.push(currentRace);
        }
    }

    pool.terminate();
    ResultPrinter.printSummary(stats);
}

/**
 * Parses command-line arguments to configure the backtest.
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const fileArgs = args.filter((a) => !a.startsWith("-"));
    const flags = args.filter((a) => a.startsWith("-"));

    let config = CONFIG_HIGHEST_YIELD;
    if (flags.includes("--efficiency") || flags.includes("--eff") || flags.includes("-eff") || flags.includes("-e")) {
        config = CONFIG_EFFICIENCY;
    } else if (flags.includes("--yield") || flags.includes("-y")) {
        config = CONFIG_HIGHEST_YIELD;
    }

    // Parse score weights override
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

    // Parse min score threshold override
    const minScoreMatch = args.find((a) => a.startsWith("--min-score="));
    if (minScoreMatch && minScoreMatch.includes("=") && minScoreMatch.split("=")[1]!.trim() !== "") {
        const threshold = parseFloat(minScoreMatch.split("=")[1]!);
        if (!isNaN(threshold)) {
            config = { ...config, minScoreThreshold: threshold };
        }
    }

    // Parse relative threshold override
    const relativeMatch = args.find((a) => a.startsWith("--relative-threshold="));
    if (relativeMatch && relativeMatch.includes("=") && relativeMatch.split("=")[1]!.trim() !== "") {
        const threshold = parseFloat(relativeMatch.split("=")[1]!);
        if (!isNaN(threshold)) {
            config = { ...config, relativeThreshold: threshold };
        }
    }

    // Parse prior weight override
    const priorMatch = args.find((a) => a.startsWith("--prior-weight="));
    if (priorMatch && priorMatch.includes("=") && priorMatch.split("=")[1]!.trim() !== "") {
        const weight = parseFloat(priorMatch.split("=")[1]!);
        if (!isNaN(weight)) {
            config = { ...config, priorWeight: weight };
        }
    }

    return {
        prevFile: fileArgs[0],
        currFile: fileArgs[1],
        config,
        showConfigOnly: flags.includes("--print-config-only") || flags.includes("-pco"),
    };
}

// Execution Entry Point
const { prevFile, currFile, config, showConfigOnly } = parseArgs();

if (showConfigOnly) {
    const previousMonthsRaces = await loadRaces(prevFile);
    // Note: We don't need currentMonthRaces to print config, but calculateEmpiricalWinRates needs history.
    // If only one file is provided with -pco, we can use it.

    if (previousMonthsRaces.length > 0) {
        config.empiricalWinRates = calculateEmpiricalWinRates(previousMonthsRaces);
    }

    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
}

if (!prevFile || !currFile) {
    console.error(
        "Usage: bun backtest.ts <previous_month_data> <current_month_data> [--efficiency|--yield] [--historical-weight=<value>] [--hmm-weight=<value>] [--momentum-weight=<value>] [--min-score=<value>] [--relative-threshold=<value>] [--prior-weight=<value>]",
    );
    process.exit(1);
}

runBacktest(prevFile, currFile, config).catch(console.error);
