import { parseLines, EQUAL_SLOT_PROBABILITY } from "./utils";

async function analyze() {
    const historicalData = await Bun.file("data_historical.txt").text();
    const currentData = await Bun.file("data_current.txt").text();

    const races = [...(await parseLines(historicalData.split("\n"))), ...(await parseLines(currentData.split("\n")))];

    console.log("=== STREAK AND MOMENTUM ANALYSIS ===");

    // 1. Slot Momentum: Probability of Slot X winning if it won the previous race
    console.log("\n--- Conditional Probability (Same Slot Repeat) ---");
    let repeatAttempts = 0;
    let repeatWins = 0;

    for (let i = 1; i < races.length; i++) {
        const prev = races[i - 1];
        const curr = races[i];
        if (prev.winningSlot === null || curr.winningSlot === null) continue;

        repeatAttempts++;
        if (prev.winningSlot === curr.winningSlot) {
            repeatWins++;
        }
    }

    const baselineRepeatProb = EQUAL_SLOT_PROBABILITY * 100;
    const actualRepeatProb = (repeatWins / repeatAttempts) * 100;
    console.log(`Baseline (Random): ${baselineRepeatProb.toFixed(2)}%`);
    console.log(`Actual Repeat:     ${actualRepeatProb.toFixed(2)}% (${repeatWins}/${repeatAttempts})`);
    console.log(`Momentum Factor:   ${(actualRepeatProb / baselineRepeatProb).toFixed(2)}x`);

    // 2. Performance by Slot
    console.log("\n--- Repeat Win Probability by Slot ---");
    for (let s = 1; s <= 6; s++) {
        let sAttempts = 0;
        let sRepeats = 0;
        let sBaseline = 0;
        let sTotalRaces = 0;

        for (let i = 1; i < races.length; i++) {
            if (races[i - 1].winningSlot === s) {
                sAttempts++;
                if (races[i].winningSlot === s) sRepeats++;
            }
            if (races[i].winningSlot === s) sTotalRaces++;
        }

        const winRate = (sTotalRaces / races.length) * 100;
        const repeatProb = sAttempts > 0 ? (sRepeats / sAttempts) * 100 : 0;
        console.log(`Slot ${s}: Base WR: ${winRate.toFixed(1).padStart(4)}% | Repeat Prob: ${repeatProb.toFixed(1).padStart(4)}% | Edge: ${(repeatProb - winRate).toFixed(1)}%`);
    }

    // 3. Payout Correlation: Do high payouts "cluster"?
    console.log("\n--- High Payout clustering (Longshots follow Longshots?)");
    let longshotFollowsLongshot = 0;
    let longshotAttempts = 0;
    const LONGSHOT_THRESHOLD = 10.0;

    for (let i = 1; i < races.length; i++) {
        if (races[i - 1].winningPayout! >= LONGSHOT_THRESHOLD) {
            longshotAttempts++;
            if (races[i].winningPayout! >= LONGSHOT_THRESHOLD) {
                longshotFollowsLongshot++;
            }
        }
    }

    const baseLongshotFreq = (races.filter((r) => r.winningPayout! >= LONGSHOT_THRESHOLD).length / races.length) * 100;
    const conditionalLongshotFreq = (longshotFollowsLongshot / longshotAttempts) * 100;
    console.log(`Baseline Longshot Freq:    ${baseLongshotFreq.toFixed(2)}%`);
    console.log(`Conditional (After LS):    ${conditionalLongshotFreq.toFixed(2)}%`);
}

analyze();
