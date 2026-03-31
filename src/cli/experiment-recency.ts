/**
 * @file experiment-recency.ts
 * @description Experimental program to determine optimal recency weighting parameters
 * 
 * This script runs backtests with various recency configurations to find:
 * - Q1: Optimal decay value (0.9, 0.95, 0.97, 0.99, 1.0)
 * - Q2: Whether to enable recency by default
 * - Q3: Whether per-dimension decay rates are beneficial
 */

import { calculateEmpiricalWinRates, loadRaces, getPayoutBucket } from "../shared/utils";
import { predictRace } from "../core/prediction-engine";
import type { Race, StatsResult, BacktestConfig, Bet, SlotStat, BucketStat } from "../shared/types";
import { CONFIG_HIGHEST_YIELD, CONFIG_EFFICIENCY, CONFIG_BET2 } from "../shared/config";
import { WorkerPool } from "../workers/worker-pool";
import { formatCurrency } from "../shared/utils";

/**
 * Calculate weighted statistics with exponential decay
 * @param races - Array of races in chronological order
 * @param decay - Decay factor (0-1), closer to 1 = slower decay
 * @param slotDecay - Optional separate decay for slot stats
 * @param venueDecay - Optional separate decay for venue stats
 * @param roundDecay - Optional separate decay for round stats
 */
function calculateWeightedStats(
    races: Race[],
    decay: number,
    slotDecay?: number,
    venueDecay?: number,
    roundDecay?: number,
): StatsResult {
    const slotDecayFactor = slotDecay ?? decay;
    const venueDecayFactor = venueDecay ?? decay;
    const roundDecayFactor = roundDecay ?? decay;

    const bucketMap: { [key: number]: { [key: number]: { occurrences: number; wins: number; winRate: number } } } = {};
    const slotMap: { [key: number]: { occurrences: number; wins: number; winRate: number } } = {};
    const venueMap: { [key: string]: { [key: number]: { occurrences: number; wins: number; winRate: number } } } = {};
    const roundMap: { [key: number]: { [key: number]: { occurrences: number; wins: number; winRate: number } } } = {};

    // Calculate decay weights for each race (most recent = weight 1)
    const raceWeights = races.map((_, idx) => Math.pow(decay, races.length - 1 - idx));
    const totalWeight = raceWeights.reduce((a, b) => a + b, 0);
    const normalizedWeights = raceWeights.map(w => w / totalWeight);

    for (let r = 0; r < races.length; r++) {
        const race = races[r]!;
        if (race.winningSlot === null || race.winningPayout === null) continue;

        const slot = race.winningSlot;
        const payout = race.winningPayout;
        const bucket = getPayoutBucket(payout);
        const weight = normalizedWeights[r];

        // Initialize slot stats
        if (!slotMap[slot]) {
            slotMap[slot] = { occurrences: 0, wins: 0, winRate: 1/6 };
        }
        slotMap[slot]!.occurrences += weight;
        slotMap[slot]!.wins += weight;

        // Initialize bucket stats
        if (!bucketMap[slot]) {
            bucketMap[slot] = {};
        }
        if (!bucketMap[slot][bucket]) {
            bucketMap[slot][bucket] = { occurrences: 0, wins: 0, winRate: 1/6 };
        }
        const bucketStat = bucketMap[slot][bucket] ?? { occurrences: 0, wins: 0, winRate: 1/6 };
        bucketStat.occurrences += weight;
        bucketStat.wins += weight;

        // Initialize venue stats
        if (race.venue) {
            if (!venueMap[race.venue]) {
                venueMap[race.venue] = {};
            }
            if (!venueMap[race.venue][slot]) {
                venueMap[race.venue][slot] = { occurrences: 0, wins: 0, winRate: 1/6 };
            }
            venueMap[race.venue][slot]!.occurrences += weight;
            venueMap[race.venue][slot]!.wins += weight;
        }

        // Initialize round stats
        if (!roundMap[race.raceNumber]) {
            roundMap[race.raceNumber] = {};
        }
        if (!roundMap[race.raceNumber][slot]) {
            roundMap[race.raceNumber][slot] = { occurrences: 0, wins: 0, winRate: 1/6 };
        }
        roundMap[race.raceNumber][slot]!.occurrences += weight;
        roundMap[race.raceNumber][slot]!.wins += weight;
    }

    // Calculate win rates from weighted stats
    const finalizeStats = (stats: { [key: number]: { occurrences: number; wins: number; winRate: number } }): Record<number, SlotStat> => {
        const result: Record<number, SlotStat> = {};
        for (const slotStr of Object.keys(stats)) {
            const slot = parseInt(slotStr);
            const s = stats[slot];
            result[slot] = {
                occurrences: s.occurrences,
                wins: s.wins,
                winRate: s.occurrences > 0 ? s.wins / s.occurrences : 1/6,
            };
        }
        return result;
    };

    const finalizeBucketStats = (buckets: { [key: number]: { [key: number]: { occurrences: number; wins: number; winRate: number } | undefined } }): Record<number, BucketStat> => {
        const result: Record<number, BucketStat> = {};
        for (const slotStr of Object.keys(buckets)) {
            const slot = parseInt(slotStr);
            const b = buckets[slot];
            result[slot] = {};
            for (const bucketStr of Object.keys(b)) {
                const bucket = parseInt(bucketStr);
                const bucketStat = b[bucket] ?? { occurrences: 0, wins: 0, winRate: 1/6 };
                result[slot]![bucket] = {
                    occurrences: bucketStat.occurrences,
                    wins: bucketStat.wins,
                    winRate: bucketStat.occurrences > 0 ? bucketStat.wins / bucketStat.occurrences : 1/6,
                };
            }
        }
        return result;
    };

    return {
        bucketMap: Object.fromEntries(
            Object.entries(bucketMap).map(([slot, buckets]) => [parseInt(slot), finalizeBucketStats(buckets)])
        ),
        slotMap: finalizeStats(slotMap),
        venueMap: Object.fromEntries(
            Object.entries(venueMap).map(([venue, slots]) => [venue, finalizeStats(slots)])
        ),
        roundMap: Object.fromEntries(
            Object.entries(roundMap).map(([round, slots]) => [parseInt(round), finalizeStats(slots)])
        ),
    };
}

/**
 * Run a backtest with a specific configuration
 */
async function runBacktestWithRecency(
    prevFile: string,
    currFile: string,
    config: BacktestConfig,
    recencyDecay: number,
    slotDecay?: number,
    venueDecay?: number,
    roundDecay?: number,
): Promise<{ totalProfit: number; accuracy: number; totalBets: number; roi: number }> {
    const previousMonthsRaces = await loadRaces(prevFile);
    const currentMonthRaces = await loadRaces(currFile);

    if (currentMonthRaces.length === 0) {
        throw new Error(`No data found in ${currFile}`);
    }

    // Calculate weighted stats
    const weightedStats = calculateWeightedStats(
        previousMonthsRaces,
        recencyDecay,
        slotDecay,
        venueDecay,
        roundDecay,
    );

    // Override config with weighted stats
    const testConfig = {
        ...config,
        priorWeight: 0, // Disable prior to use pure weighted stats
    };

    // Initialize worker pool
    const pool = new WorkerPool(config.maxWorkers, "./hmm-worker.ts");

    let totalProfit = 0;
    let correctPredictions = 0;
    let totalPredictions = 0;
    let totalBets = 0;

    const history: Race[] = [...previousMonthsRaces];
    const sequence = history.map((r) => {
        if (r.winningSlot === null || r.winningPayout === null) return -1;
        const bucket = getPayoutBucket(r.winningPayout);
        return (r.winningSlot - 1) * 3 + bucket;
    });

    const aggregatedProbs = new Float64Array(config.hmmObservations);
    const invEnsembleSize = 1.0 / config.ensembleSize;
    const ensembleParams = new Array(config.ensembleSize).fill(undefined);

    for (let i = 0; i < currentMonthRaces.length; i += config.chunkSize) {
        const chunk = currentMonthRaces.slice(i, i + config.chunkSize);

        // Train HMM
        const currentSequenceView = new Int32Array(sequence);
        const ensemblePromises = Array.from({ length: config.ensembleSize }, (_, idx) =>
            pool.run({
                sequence: currentSequenceView,
                numStates: config.hmmStates,
                numObservations: config.hmmObservations,
                iterations: config.trainingIterations,
                restarts: config.trainingRestarts,
                tolerance: config.convergenceTolerance,
                smoothing: config.hmmSmoothing,
                perturbAmount: config.perturbAmount,
                steps: chunk.length,
                seedParams: ensembleParams[idx],
            }),
        );

        const allEnsemblePredictions = await Promise.all(ensemblePromises);

        for (let idx = 0; idx < config.ensembleSize; idx++) {
            ensembleParams[idx] = (allEnsemblePredictions[idx] as any).params;
        }

        // Process each race in chunk
        for (let j = 0; j < chunk.length; j++) {
            const currentRace = chunk[j]!;

            // Aggregate HMM probabilities
            for (let k = 0; k < config.hmmObservations; k++) {
                aggregatedProbs[k] = 0;
            }
            for (const pred of allEnsemblePredictions) {
                const stepProbs = pred.results[j];
                if (stepProbs) {
                    for (let k = 0; k < config.hmmObservations; k++) {
                        aggregatedProbs[k] += (stepProbs[k] ?? 0) * invEnsembleSize;
                    }
                }
            }

            // Predict and evaluate
            const { bets, score } = predictRace(currentRace, weightedStats, aggregatedProbs, testConfig);

            if (bets.length > 0) {
                totalBets += bets.length;
                totalPredictions++;

                // Calculate profit
                let raceProfit = 0;
                for (const bet of bets) {
                    if (bet.slot === currentRace.winningSlot) {
                        raceProfit += bet.cost * (currentRace.winningPayout ?? 0) - bet.cost;
                        correctPredictions++;
                    } else {
                        raceProfit -= bet.cost;
                    }
                }
                totalProfit += raceProfit;
            }

            // Update history
            if (currentRace.winningSlot !== null) {
                const bucket = getPayoutBucket(currentRace.winningPayout!);
                sequence.push((currentRace.winningSlot! - 1) * 3 + bucket);
                history.push(currentRace);
            }
        }
    }

    pool.terminate();

    const roi = totalBets > 0 ? (totalProfit / (totalBets * 1)) * 100 : 0;
    const accuracy = totalPredictions > 0 ? (correctPredictions / totalPredictions) * 100 : 0;

    return {
        totalProfit,
        accuracy,
        totalBets,
        roi,
    };
}

/**
 * Main experiment runner
 */
async function runExperiments() {
    const prevFile = "data_historical.txt";
    const currFile = "data_current.txt";

    console.log("=".repeat(80));
    console.log("RECENTCY WEIGHTING EXPERIMENT");
    console.log("=".repeat(80));
    console.log(`Historical data: ${prevFile}`);
    console.log(`Target data: ${currFile}`);
    console.log("=".repeat(80));

    // Test different decay values for Q1
    console.log("\n📊 Q1: Testing different decay values (CONFIG_HIGHEST_YIELD)");
    console.log("-".repeat(80));

    const decayValues = [0.9, 0.95, 0.97, 0.99, 1.0];
    const decayResults: { decay: number; profit: number; accuracy: number; roi: number; bets: number }[] = [];

    for (const decay of decayValues) {
        console.log(`\nTesting decay = ${decay}...`);
        try {
            const result = await runBacktestWithRecency(
                prevFile,
                currFile,
                CONFIG_HIGHEST_YIELD,
                decay,
            );
            decayResults.push({
                decay,
                profit: result.totalProfit,
                accuracy: result.accuracy,
                roi: result.roi,
                bets: result.totalBets,
            });
            console.log(`  Profit: ${formatCurrency(result.totalProfit)}`);
            console.log(`  ROI: ${result.roi.toFixed(2)}%`);
            console.log(`  Accuracy: ${result.accuracy.toFixed(2)}%`);
            console.log(`  Total Bets: ${result.totalBets}`);
        } catch (error) {
            console.error(`  Error: ${error}`);
        }
    }

    // Find best decay
    const bestDecay = decayResults.reduce((best, current) =>
        current.roi > best.roi ? current : best
    );
    console.log("\n✓ Best decay for HIGHEST_YIELD:");
    console.log(`  Decay: ${bestDecay.decay}, ROI: ${bestDecay.roi.toFixed(2)}%, Profit: ${formatCurrency(bestDecay.profit)}`);

    // Test Q2: Compare with/without recency for all strategies
    console.log("\n\n📊 Q2: Comparing recency enabled vs disabled (decay=1.0 vs decay=0.95)");
    console.log("-".repeat(80));

    const strategies = [
        { name: "HIGHEST_YIELD", config: CONFIG_HIGHEST_YIELD },
        { name: "EFFICIENCY", config: CONFIG_EFFICIENCY },
        { name: "BET2", config: CONFIG_BET2 },
    ];

    const q2Results: { strategy: string; withRecency: number; withoutRecency: number }[] = [];

    for (const { name, config } of strategies) {
        console.log(`\nStrategy: ${name}`);

        // Without recency (decay = 1.0)
        try {
            const without = await runBacktestWithRecency(
                prevFile,
                currFile,
                config,
                1.0,
            );
            console.log(`  Without recency: ROI = ${without.roi.toFixed(2)}%, Profit = ${formatCurrency(without.totalProfit)}`);

            // With recency (decay = 0.95)
            const withRecency = await runBacktestWithRecency(
                prevFile,
                currFile,
                config,
                0.95,
            );
            console.log(`  With recency:    ROI = ${withRecency.roi.toFixed(2)}%, Profit = ${formatCurrency(withRecency.totalProfit)}`);

            q2Results.push({
                strategy: name,
                withRecency: withRecency.roi,
                withoutRecency: without.roi,
            });
        } catch (error) {
            console.error(`  Error: ${error}`);
        }
    }

    // Test Q3: Per-dimension decay rates
    console.log("\n\n📊 Q3: Testing per-dimension decay rates");
    console.log("-".repeat(80));

    const decayConfigs = [
        { name: "Uniform", decay: 0.95, slotDecay: undefined, venueDecay: undefined, roundDecay: undefined },
        { name: "Slot-focused", decay: 0.95, slotDecay: 0.99, venueDecay: undefined, roundDecay: undefined },
        { name: "Venue-focused", decay: 0.95, slotDecay: undefined, venueDecay: 0.99, roundDecay: undefined },
        { name: "Round-focused", decay: 0.95, slotDecay: undefined, venueDecay: undefined, roundDecay: 0.99 },
        { name: "Balanced", decay: 0.95, slotDecay: 0.97, venueDecay: 0.98, roundDecay: 0.97 },
    ];

    const q3Results: { config: string; roi: number; profit: number }[] = [];

    for (const config of decayConfigs) {
        console.log(`\nConfig: ${config.name}`);
        console.log(`  Decay: ${config.decay}, Slot: ${config.slotDecay ?? 0.95}, Venue: ${config.venueDecay ?? 0.95}, Round: ${config.roundDecay ?? 0.95}`);

        try {
            const result = await runBacktestWithRecency(
                prevFile,
                currFile,
                CONFIG_HIGHEST_YIELD,
                config.decay,
                config.slotDecay,
                config.venueDecay,
                config.roundDecay,
            );
            console.log(`  ROI: ${result.roi.toFixed(2)}%, Profit: ${formatCurrency(result.totalProfit)}`);
            q3Results.push({
                config: config.name,
                roi: result.roi,
                profit: result.totalProfit,
            });
        } catch (error) {
            console.error(`  Error: ${error}`);
        }
    }

    // Find best per-dimension config
    const bestQ3Config = q3Results.reduce((best, current) =>
        current.roi > best.roi ? current : best
    );
    console.log("\n✓ Best per-dimension config:");
    console.log(`  ${bestQ3Config.config}: ROI = ${bestQ3Config.roi.toFixed(2)}%`);

    // Summary
    console.log("\n\n" + "=".repeat(80));
    console.log("EXPERIMENT SUMMARY");
    console.log("=".repeat(80));

    console.log("\nQ1 - Optimal Decay Value:");
    console.log(`  Best: ${bestDecay.decay} (ROI: ${bestDecay.roi.toFixed(2)}%)`);
    console.log("  Recommendation: Use", bestDecay.decay < 0.97 ? "moderate recency" : "light recency", "decay");

    console.log("\nQ2 - Should recency be enabled by default?");
    const avgImprovement = q2Results.reduce((sum, r) =>
        sum + (r.withRecency - r.withoutRecency), 0
    ) / q2Results.length;
    console.log(`  Average ROI improvement: ${avgImprovement.toFixed(2)}%`);
    console.log("  Recommendation:", avgImprovement > 0 ? "Enable by default" : "Keep opt-in");

    console.log("\nQ3 - Per-dimension vs uniform decay:");
    console.log(`  Best config: ${bestQ3Config.config} (ROI: ${bestQ3Config.roi.toFixed(2)}%)`);
    const uniformBest = q3Results.find(r => r.config === "Uniform")?.roi ?? 0;
    const improvement = bestQ3Config.roi - uniformBest;
    console.log(`  Improvement over uniform: ${improvement.toFixed(2)}%`);
    console.log("  Recommendation:", Math.abs(improvement) < 1 ? "Use uniform decay" : "Use per-dimension decay");

    console.log("\n" + "=".repeat(80));
}

// Run the experiment
runExperiments().catch(console.error);
