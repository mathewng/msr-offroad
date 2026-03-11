/**
 * @file backtest.ts
 * @description Main entry point for the backtesting engine.
 * This module simulates the performance of the prediction system on historical data
 * using a walk-forward optimization methodology. It leverages an ensemble of
 * Hidden Markov Models (HMM) trained in parallel to predict race outcomes.
 */

import { calculateEmpiricalWinRates, calculateStats, getPayoutBucket, parseLines, updateStats } from "../shared/utils";
import { predictRace } from "../core/prediction-engine";
import type { BacktestConfig, Race, StatsResult } from "../shared/types";
import { WorkerPool } from "../workers/worker-pool";
import type { BacktestStats } from "./result-printer";
import { printHeader, printRow, printSummary } from "./result-printer";
import { printHmmDiagnostics, type DiagnosticSample } from "./hmm-diagnostics";
import { parseBacktestArgs, BACKTEST_USAGE } from "./backtest-args";

const OBS_PER_CONTEXT = 18; // 6 slots × 3 buckets

/**
 * Loads race data from a flat file and parses it into structured Race objects.
 */
export async function loadRaces(filePath: string | undefined): Promise<Race[]> {
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

/** Builds the observation sequence from history (encoding: round/slot/bucket). */
function buildInitialSequence(history: Race[]): number[] {
    return history.map((r) => {
        if (r.winningSlot === null || r.winningPayout === null) return -1;
        const bucket = getPayoutBucket(r.winningPayout);
        return (r.raceNumber - 1) * OBS_PER_CONTEXT + (r.winningSlot - 1) * 3 + bucket;
    });
}

/** Returns the consensus regime (mode of last Viterbi state) across ensemble predictions. */
function getConsensusRegime(allEnsemblePredictions: { viterbiPath?: number[] }[]): number {
    const regimeCounts = new Map<number, number>();
    for (const pred of allEnsemblePredictions) {
        if (pred.viterbiPath && pred.viterbiPath.length > 0) {
            const lastState = pred.viterbiPath[pred.viterbiPath.length - 1]!;
            regimeCounts.set(lastState, (regimeCounts.get(lastState) ?? 0) + 1);
        }
    }
    let consensusRegime = 0;
    let maxCount = -1;
    for (const [state, count] of regimeCounts) {
        if (count > maxCount) {
            maxCount = count;
            consensusRegime = state;
        }
    }
    return consensusRegime;
}

/** Aggregates ensemble step probabilities for one race index into a single Float64Array. */
function aggregateStepProbs(
    allEnsemblePredictions: { results: (Float64Array | number[] | undefined)[] }[],
    raceIndex: number,
    numObservations: number,
    invEnsembleSize: number,
    out: Float64Array,
): void {
    out.fill(0);
    for (const pred of allEnsemblePredictions) {
        const stepProbs = pred.results[raceIndex];
        if (stepProbs) {
            for (let k = 0; k < numObservations; k++) {
                out[k] = out[k]! + (stepProbs[k] ?? 0) * invEnsembleSize;
            }
        }
    }
}

/** Evaluates bets against the race outcome; returns race profit and number of winning bets. */
function evaluateRaceOutcome(bets: number[], race: Race): { raceProfit: number; raceWins: number } {
    let raceProfit = 0;
    let raceWins = 0;
    if (race.winningSlot === null) return { raceProfit, raceWins };
    for (const slot of bets) {
        if (slot === race.winningSlot) {
            raceProfit += (race.winningPayout ?? 0) - 1;
            raceWins++;
        } else {
            raceProfit -= 1;
        }
    }
    return { raceProfit, raceWins };
}

function computeStatus(bets: number[], isPending: boolean, raceWins: number): string {
    if (bets.length === 0) return isPending ? "PENDING" : "SKIPPED";
    return isPending ? "???" : raceWins > 0 ? "WIN" : "LOSS";
}

/**
 * Core backtest engine: walk-forward simulation.
 *
 * 1. Initialize stats from historical data.
 * 2. Process target races in chunks; before each chunk, retrain HMM ensemble.
 * 3. For each race: aggregate ensemble probs, predict bets, evaluate outcome, update history/stats.
 */
async function runBacktest(prevFile: string, currFile: string, config: BacktestConfig): Promise<void> {
    const previousMonthsRaces = await loadRaces(prevFile);
    const currentMonthRaces = await loadRaces(currFile);

    if (currentMonthRaces.length === 0) {
        console.error(`Error: No data found in ${currFile}`);
        process.exit(1);
    }

    config.empiricalWinRates = calculateEmpiricalWinRates(previousMonthsRaces);

    // Path is resolved by WorkerPool relative to worker-pool.ts (src/workers/), so same-dir hmm-worker
    const pool = new WorkerPool(config.maxWorkers, "./hmm-worker.ts");
    const history: Race[] = [...previousMonthsRaces];
    const stats: BacktestStats = {
        totalProfit: 0,
        correctPredictions: 0,
        totalPredictions: 0,
        totalBetCost: 0,
        skippedRaces: 0,
    };

    let sequence = buildInitialSequence(history);
    const maxSequenceLength = sequence.length + currentMonthRaces.length;
    const sharedBuffer = new SharedArrayBuffer(maxSequenceLength * 4);
    const sequenceArray = new Int32Array(sharedBuffer);
    sequenceArray.set(sequence);

    const aggregatedProbs = new Float64Array(config.hmmObservations);
    let currentStats: StatsResult = calculateStats(history, config);
    const diagnosticSamples: DiagnosticSample[] = [];
    const invEnsembleSize = 1.0 / config.ensembleSize;

    // Maintain ensemble parameters across chunks to support warm starting.
    // This stabilizes state labels and improves convergence for incremental data.
    const ensembleParams = new Array(config.ensembleSize).fill(undefined);

    console.log(
        `Loaded history: ${history.length}, Target: ${currentMonthRaces.length}. Using ${config.maxWorkers} cores.`,
    );
    printHeader();

    // Walk-forward: use relaxed relative threshold when we started with no history (HMM untrained for race 0).
    const effectiveConfig =
        previousMonthsRaces.length === 0 && (config.relativeThreshold ?? 0) > 0
            ? { ...config, relativeThreshold: 0 }
            : config;

    for (let j = 0; j < currentMonthRaces.length; j++) {
        // Train HMM on sequence so far (history + outcomes of races 0..j-1), predict one step for race j.
        sequenceArray.set(sequence);
        const currentSequenceView = sequenceArray.subarray(0, sequence.length);

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
                steps: 1,
                seedParams: ensembleParams[idx],
            }),
        );

        const allEnsemblePredictions = await Promise.all(ensemblePromises);

        for (let idx = 0; idx < config.ensembleSize; idx++) {
            ensembleParams[idx] = (allEnsemblePredictions[idx] as any).params;
        }

        const consensusRegime = getConsensusRegime(allEnsemblePredictions);

        aggregateStepProbs(allEnsemblePredictions, 0, config.hmmObservations, invEnsembleSize, aggregatedProbs);

        const currentRace = currentMonthRaces[j]!;
        const { bets, score, diagnostics } = predictRace(
            currentRace,
            currentStats,
            aggregatedProbs,
            effectiveConfig,
        );
        if (config.diagnoseHmm && diagnostics) {
            diagnosticSamples.push({ ...diagnostics, winningSlot: currentRace.winningSlot ?? null });
        }

        const isPending = currentRace.winningSlot === null;
        const { raceProfit, raceWins } = evaluateRaceOutcome(bets, currentRace);

        if (!isPending) {
            if (bets.length > 0) {
                stats.totalProfit += raceProfit;
                stats.totalBetCost += bets.length;
                if (raceWins > 0) stats.correctPredictions++;
                stats.totalPredictions++;
            } else {
                stats.skippedRaces++;
            }
        }

        const status = computeStatus(bets, isPending, raceWins);
        printRow(
            currentRace,
            bets,
            currentRace.winningSlot,
            currentRace.winningPayout,
            score,
            raceProfit,
            stats.totalProfit,
            status,
            consensusRegime,
        );

        if (!isPending) {
            const bucket = getPayoutBucket(currentRace.winningPayout!);
            sequence.push(
                (currentRace.raceNumber - 1) * OBS_PER_CONTEXT + (currentRace.winningSlot! - 1) * 3 + bucket,
            );
            updateStats(currentStats, currentRace, config);
        } else {
            sequence.push(-1);
        }
        history.push(currentRace);
    }

    pool.terminate();
    printSummary(stats);
    if (config.diagnoseHmm && diagnosticSamples.length > 0) {
        printHmmDiagnostics(diagnosticSamples);
    }
}

// --- Main ---

const { prevFile, currFile, config, showConfigOnly } = parseBacktestArgs();

if (showConfigOnly) {
    const previousMonthsRaces = await loadRaces(prevFile);
    if (previousMonthsRaces.length > 0) {
        config.empiricalWinRates = calculateEmpiricalWinRates(previousMonthsRaces);
    }
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
}

if (!prevFile || !currFile) {
    console.error(BACKTEST_USAGE);
    process.exit(1);
}

runBacktest(prevFile, currFile, config).catch(console.error);
