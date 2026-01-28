import { WorkerPool } from "./worker-pool";
import type { Race, StatsResult, BacktestConfig } from "./types";
import { parseLines, calculateStats, getPayoutBucket } from "./utils";
import { predictRace } from "./prediction-engine";
import { CONFIG } from "./config";

/**
 * Optimization script to find the best values for:
 * - historical weight
 * - hmm weight
 * - minScoreThreshold
 *
 * To save time, it pre-calculates the HMM predictions once and then
 * rapidly iterates over the scoring parameters.
 */

async function loadRaces(filePath: string): Promise<Race[]> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return [];
    const text = await file.text();
    return parseLines(text.split("\n"));
}

interface PredictionLogEntry {
    race: Race;
    stats: StatsResult;
    aggregatedProbs: Float64Array;
}

async function main() {
    const prevFile = "dec.txt";
    const currFile = "jan.txt";

    console.log(`Pre-calculating HMM predictions for ${currFile} using ${prevFile} as initial history...`);

    const previousMonthsRaces = await loadRaces(prevFile);
    const currentMonthRaces = await loadRaces(currFile);

    if (currentMonthRaces.length === 0) {
        console.error("No data found.");
        return;
    }

    const pool = new WorkerPool(CONFIG.maxWorkers, "./hmm-worker.ts");
    const history = [...previousMonthsRaces];
    const predictionLog: PredictionLogEntry[] = [];

    // --- STEP 1: PRE-CALCULATE ---
    for (let i = 0; i < currentMonthRaces.length; i += 3) {
        const chunk = currentMonthRaces.slice(i, i + 3);
        const currentStats = calculateStats(history);

        const validHistory = history.filter((r) => r.winningSlot !== null && r.winningPayout !== null);
        const sequence = new Int32Array(validHistory.map((r) => (r.winningSlot! - 1) * 3 + getPayoutBucket(r.winningPayout!, r.winningSlot!)));

        const ensemblePromises = Array.from({ length: CONFIG.ensembleSize }, () =>
            pool.run({
                sequence,
                numStates: CONFIG.hmmStates,
                numObservations: CONFIG.hmmObservations,
                iterations: CONFIG.trainingIterations,
                tolerance: CONFIG.convergenceTolerance,
                steps: chunk.length,
            }),
        );

        const allEnsemblePredictions = await Promise.all(ensemblePromises);

        for (let j = 0; j < chunk.length; j++) {
            const currentRace = chunk[j]!;
            const aggregatedProbs = new Float64Array(CONFIG.hmmObservations);

            for (const res of allEnsemblePredictions) {
                const stepProbs = res[j];
                if (stepProbs) {
                    for (let k = 0; k < CONFIG.hmmObservations; k++) {
                        const prob = stepProbs[k];
                        if (prob !== undefined) {
                            aggregatedProbs[k] = (aggregatedProbs[k] ?? 0) + prob / CONFIG.ensembleSize;
                        }
                    }
                }
            }

            predictionLog.push({
                race: currentRace,
                stats: currentStats,
                aggregatedProbs,
            });
        }
        history.push(...chunk);
    }
    pool.terminate();

    console.log(`Pre-calculation complete. Logged ${predictionLog.length} races.`);
    console.log("--------------------------------------------------------------------------------");
    console.log(`${"Hist".padStart(6)} | ${"HMM".padStart(6)} | ${"Thresh".padStart(6)} | ${"Profit".padStart(8)} | ${"ROI".padStart(8)} | ${"Acc".padStart(6)} | ${"Bets".padStart(5)}`);
    console.log("--------------------------------------------------------------------------------");

    // --- STEP 2: GRID SEARCH ---
    const results = [];

    for (let histW = 0.0; histW <= 1.05; histW += 0.1) {
        const hmmW = 1.0 - histW;
        for (let threshold = 0.0; threshold <= 0.6; threshold += 0.1) {
            let totalProfit = 0;
            let totalBets = 0;
            let wins = 0;

            const tempConfig: BacktestConfig = {
                ...CONFIG,
                scoreWeights: { historical: histW, hmm: hmmW },
                minScoreThreshold: threshold,
            };

            for (const entry of predictionLog) {
                const { bets } = predictRace(entry.race, entry.stats, entry.aggregatedProbs, tempConfig);

                if (entry.race.winningSlot === null) continue;

                if (bets.length > 0) {
                    totalBets += bets.length;
                    let raceProfit = 0;
                    let won = false;
                    for (const slot of bets) {
                        if (slot === entry.race.winningSlot) {
                            raceProfit += entry.race.winningPayout! - 1;
                            won = true;
                        } else {
                            raceProfit -= 1;
                        }
                    }
                    totalProfit += raceProfit;
                    if (won) wins++;
                }
            }

            const roi = totalBets > 0 ? (totalProfit / totalBets) * 100 : 0;
            const accuracy = totalBets > 0 ? (wins / (totalBets / CONFIG.betLimit)) * 100 : 0;

            results.push({
                histW,
                hmmW,
                threshold,
                totalProfit,
                roi,
                accuracy,
                totalBets,
            });

            console.log(
                `${histW.toFixed(1).padStart(6)} | ${hmmW.toFixed(1).padStart(6)} | ${threshold.toFixed(1).padStart(6)} | ${totalProfit.toFixed(1).padStart(8)} | ${roi.toFixed(1).padStart(7)}% | ${accuracy.toFixed(1).padStart(5)}% | ${totalBets.toString().padStart(5)}`,
            );
        }
    }

    // --- STEP 3: FIND BEST ---
    results.sort((a, b) => b.totalProfit - a.totalProfit);
    const best = results[0];

    console.log("--------------------------------------------------------------------------------");
    if (best) {
        console.log("BEST PARAMETERS FOUND:");
        console.log(`Historical Weight: ${best.histW.toFixed(1)}`);
        console.log(`HMM Weight:        ${best.hmmW.toFixed(1)}`);
        console.log(`Min Threshold:     ${best.threshold.toFixed(1)}`);
        console.log(`Expected Profit:   ${best.totalProfit.toFixed(2)}`);
        console.log(`Expected ROI:      ${best.roi.toFixed(2)}%`);
    }
}

main().catch(console.error);
