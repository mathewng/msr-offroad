import { loadRaces, calculateStats, formatPercent } from "../shared/utils";
import { BacktestConfig } from "../shared/types";

async function main() {
    const races = await loadRaces("data_all.txt");
    if (races.length === 0) {
        console.error("No races found in data_all.txt");
        process.exit(1);
    }

    console.log(`Analyzing ${races.length} races for round-number significance...\n`);

    const config: BacktestConfig = {
        betLimit: 1,
        ensembleSize: 1,
        chunkSize: 9,
        trainingIterations: 1,
        trainingRestarts: 1,
        convergenceTolerance: 0.001,
        maxWorkers: 1,
        hmmStates: 2,
        hmmObservations: 18,
        scoreWeights: { historical: 1.0, hmm: 0.0 },
        minScoreThreshold: 0,
        priorWeight: 0,
    };

    const stats = calculateStats(races, config);

    // 1. Global Round Analysis
    console.log("--- Global Round Win Rate & EV Analysis ---");
    console.log("Round".padEnd(8) + " | Sample | Slot 1 (EV) | Slot 2 (EV) | Slot 3 (EV) | Slot 4 (EV) | Slot 5 (EV) | Slot 6 (EV)");
    console.log("-".repeat(100));

    for (let r = 1; r <= 3; r++) {
        const rStats = stats.roundMap[r];
        if (!rStats) continue;

        const sampleSize = rStats[1].occurrences;
        const row = [`Round ${r}`.padEnd(8), sampleSize.toString().padStart(6)];

        for (let s = 1; s <= 6; s++) {
            const rate = rStats[s].wins / rStats[s].occurrences;
            const avgPayout = rStats[s].totalPayout / rStats[s].wins;
            const ev = isNaN(rate * avgPayout) ? 0 : rate * avgPayout;
            row.push(`${formatPercent(rate)} (${ev.toFixed(1)})`.padStart(11));
        }
        console.log(row.join(" | "));
    }

    // 2. Statistical Significance Check (Standard Error)
    console.log("\n--- Confidence Check (Slot 1 & 2) ---");
    for (let r = 1; r <= 3; r++) {
        const rStats = stats.roundMap[r];
        if (!rStats) continue;
        for (let s = 1; s <= 2; s++) {
            const n = rStats[s].occurrences;
            const p = rStats[s].wins / n;
            const se = Math.sqrt((p * (1 - p)) / n);
            console.log(`Round ${r} Slot ${s}: ${formatPercent(p)} ± ${formatPercent(1.96 * se)} (95% CI)`);
        }
    }

    // 3. Venue-Round Interaction (Is Round 3 bias universal?)
    console.log("\n--- Venue x Round Interaction (Slot 1 & 2 Win Rate) ---");
    const venues = Object.keys(stats.venueMap).sort();
    console.log("Venue".padEnd(20) + " | R1 S1/2 | R2 S1/2 | R3 S1/2");
    console.log("-".repeat(60));

    for (const v of venues) {
        const vr = stats.venueRoundMap[v];
        if (!vr) continue;

        const row = [v.padEnd(20)];
        for (let r = 1; r <= 3; r++) {
            if (!vr[r]) {
                row.push("  N/A   ");
                continue;
            }
            const s1Rate = vr[r][1].wins / vr[r][1].occurrences;
            const s2Rate = vr[r][2].wins / vr[r][2].occurrences;
            const avg = (s1Rate + s2Rate) / 2;
            row.push(`${formatPercent(avg).padStart(7)}`);
        }
        console.log(row.join(" | "));
    }
}

main().catch(console.error);
