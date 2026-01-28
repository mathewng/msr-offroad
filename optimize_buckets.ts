import { WorkerPool } from "./worker-pool";
import type { Race, StatsResult, BacktestConfig, BucketStat } from "./types";
import { parseLines } from "./utils";
import { predictRace } from "./prediction-engine";
import { CONFIG } from "./config";

// Custom bucket function for optimization
function getCustomPayoutBucket(payout: number, t1: number, t2: number): number {
    if (payout <= t1) return 0;
    if (payout <= t2) return 1;
    return 2;
}

// Custom stats calculation for optimization
function calculateStatsCustom(allRaces: Race[], t1: number, t2: number): StatsResult {
    const bucketMap: Record<number, Record<number, BucketStat>> = {};
    const slotMap: any = {};
    const venueMap: any = {};
    const roundMap: any = {};

    for (let s = 1; s <= 6; s++) {
        bucketMap[s] = {
            0: { occurrences: 0, wins: 0, winRate: 0 },
            1: { occurrences: 0, wins: 0, winRate: 0 },
            2: { occurrences: 0, wins: 0, winRate: 0 },
        };
        slotMap[s] = { occurrences: 0, wins: 0, winRate: 0 };
    }

    for (const r of allRaces) {
        if (r.winningSlot === null || r.winningPayout === null) continue;
        const winningSlot = r.winningSlot;

        for (let s = 1; s <= 6; s++) {
            slotMap[s]!.occurrences++;
            if (s === winningSlot) slotMap[s]!.wins++;

            const payout = r.payouts[s - 1] ?? 0;
            const bucket = getCustomPayoutBucket(payout, t1, t2);
            bucketMap[s]![bucket]!.occurrences++;
            if (s === winningSlot) bucketMap[s]![bucket]!.wins++;
        }
    }

    const smooth = (wins: number, total: number) => (wins + 0.5) / (total + 3);

    for (let s = 1; s <= 6; s++) {
        slotMap[s]!.winRate = slotMap[s]!.wins / (slotMap[s]!.occurrences || 1);
        for (let b = 0; b < 3; b++) {
            const bStats = bucketMap[s]![b]!;
            bStats.winRate = smooth(bStats.wins, bStats.occurrences);
        }
    }

    return { bucketMap, slotMap, venueMap, roundMap };
}

async function loadRaces(filePath: string): Promise<Race[]> {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return [];
    const text = await file.text();
    return parseLines(text.split("\n"));
}

async function evaluateThresholds(t1: number, t2: number, prevRaces: Race[], currRaces: Race[], pool: WorkerPool) {
    const history = [...prevRaces];
    let totalProfit = 0;
    let totalBets = 0;
    let wins = 0;

    // Use a smaller ensemble size for faster optimization
    const OPT_ENSEMBLE_SIZE = 40;

    for (let i = 0; i < currRaces.length; i += 3) {
        const chunk = currRaces.slice(i, i + 3);
        const currentStats = calculateStatsCustom(history, t1, t2);

        const validHistory = history.filter((r) => r.winningSlot !== null && r.winningPayout !== null);
        const sequence = new Int32Array(validHistory.map((r) => (r.winningSlot! - 1) * 3 + getCustomPayoutBucket(r.winningPayout!, t1, t2)));

        const ensemblePromises = Array.from({ length: OPT_ENSEMBLE_SIZE }, () =>
            pool.run({
                sequence,
                numStates: CONFIG.hmmStates,
                numObservations: 18,
                iterations: 400, // Slightly fewer iterations for speed
                tolerance: CONFIG.convergenceTolerance,
                steps: chunk.length,
            }),
        );

        const allEnsemblePredictions = await Promise.all(ensemblePromises);

        for (let j = 0; j < chunk.length; j++) {
            const currentRace = chunk[j]!;
            const aggregatedProbs = new Float64Array(18);

            for (const res of allEnsemblePredictions) {
                const stepProbs = res[j];
                if (stepProbs) {
                    for (let k = 0; k < 18; k++) {
                        aggregatedProbs[k] += (stepProbs[k] || 0) / OPT_ENSEMBLE_SIZE;
                    }
                }
            }

            // Mocking predictRace behavior with custom bucket logic
            const { bets } = predictRaceCustom(currentRace, currentStats, aggregatedProbs, { ...CONFIG, minScoreThreshold: 0.2 }, t1, t2);

            if (currentRace.winningSlot !== null && bets.length > 0) {
                totalBets += bets.length;
                for (const slot of bets) {
                    if (slot === currentRace.winningSlot) {
                        totalProfit += currentRace.winningPayout! - 1;
                        wins++;
                    } else {
                        totalProfit -= 1;
                    }
                }
            }
        }
        history.push(...chunk);
    }

    return {
        t1,
        t2,
        profit: totalProfit,
        roi: totalBets > 0 ? (totalProfit / totalBets) * 100 : 0,
        accuracy: totalBets > 0 ? (wins / (totalBets / CONFIG.betLimit)) * 100 : 0,
        bets: totalBets,
    };
}

// Custom predictRace that respects the thresholds being tested
function predictRaceCustom(race: Race, stats: StatsResult, aggregatedProbs: Float64Array, config: BacktestConfig, t1: number, t2: number) {
    const candidates: { slot: number; score: number }[] = [];

    for (let slot = 1; slot <= 6; slot++) {
        const payout = race.payouts[slot - 1] ?? 0;
        const bucket = getCustomPayoutBucket(payout, t1, t2);

        const bStat = stats.bucketMap[slot]?.[bucket];
        const sStat = stats.slotMap[slot];

        if (!bStat || !sStat) continue;

        const histProb = bStat.winRate;
        const hmmProb = aggregatedProbs[(slot - 1) * 3 + bucket] || 0;

        const score = histProb * config.scoreWeights.historical + hmmProb * config.scoreWeights.hmm;
        candidates.push({ slot, score });
    }

    candidates.sort((a, b) => b.score - a.score);

    const bets = candidates
        .filter((c) => c.score >= config.minScoreThreshold)
        .slice(0, config.betLimit)
        .map((c) => c.slot);

    return { bets };
}

async function main() {
    const prevFile = "data_historical.txt";
    const currFile = "data_current.txt";

    const previousRaces = await loadRaces(prevFile);
    const currentRaces = await loadRaces(currFile);

    const pool = new WorkerPool(CONFIG.maxWorkers, "./hmm-worker.ts");

    const t1Range = [5.0, 5.2, 5.4, 5.5, 5.6, 5.8, 6.0];
    const t2Range = [9.0, 9.2, 9.4, 9.5, 9.6, 9.8, 10.0];

    console.log(`Optimizing thresholds over ${t1Range.length * t2Range.length} combinations...`);
    console.log(`${"T1".padStart(4)} | ${"T2".padStart(4)} | ${"Profit".padStart(8)} | ${"ROI".padStart(8)} | ${"Bets".padStart(5)}`);
    console.log("-".repeat(45));

    const results = [];

    for (const t1 of t1Range) {
        for (const t2 of t2Range) {
            const result = await evaluateThresholds(t1, t2, previousRaces, currentRaces, pool);
            results.push(result);
            console.log(
                `${t1.toFixed(1).padStart(4)} | ${t2.toFixed(1).padStart(4)} | ${result.profit.toFixed(1).padStart(8)} | ${result.roi.toFixed(1).padStart(7)}% | ${result.bets.toString().padStart(5)}`,
            );
        }
    }

    pool.terminate();

    results.sort((a, b) => b.profit - a.profit);
    const best = results[0];

    console.log("-".repeat(45));
    console.log("BEST THRESHOLDS FOUND:");
    console.log(`T1 (Favored Boundary): ${best.t1.toFixed(1)}`);
    console.log(`T2 (Neutral Boundary): ${best.t2.toFixed(1)}`);
    console.log(`Max Profit:            ${best.profit.toFixed(2)}`);
    console.log(`ROI:                   ${best.roi.toFixed(2)}%`);
}

main().catch(console.error);
