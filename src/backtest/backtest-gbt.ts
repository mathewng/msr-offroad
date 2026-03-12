import { loadRaces, calculateEmpiricalWinRates } from "../shared/utils";
import { loadGBTModel, predictGBT } from "../core/gbt-engine";
import { printHeader, printRow, printSummary, SEPARATOR } from "./result-printer";
import type { BacktestStats } from "./result-printer";

async function runGBTBacktest(prevFile: string, currFile: string, betLimit: number, minScore: number) {
    const historicalRaces = await loadRaces(prevFile);
    const currentRaces = await loadRaces(currFile);
    
    const modelPath = "gbt_model.json";
    const gbt = await loadGBTModel(modelPath);
    
    if (!gbt) {
        console.error("No trained model found. Run 'bun src/analysis/train_gbt.ts' first.");
        return;
    }

    // Load win rates for features
    const ratesFile = Bun.file("slots_won.json");
    const winRates = (await ratesFile.exists()) ? await ratesFile.json() : {};

    const mRatesFile = Bun.file("monsters_won.json");
    const monsterRates = (await mRatesFile.exists()) ? await mRatesFile.json() : {};

    const stats: BacktestStats = {
        totalProfit: 0,
        correctPredictions: 0,
        totalPredictions: 0,
        totalBetCost: 0,
        skippedRaces: 0,
    };

    printHeader();

    for (const race of currentRaces) {
        if (race.winningSlot === null) continue;

        const probs = predictGBT(gbt, race, winRates, monsterRates);
        
        // Betting logic: Find slots where (Prob * Payout) is highest.
        // EV = Prob * Payout - 1
        const evs = probs.map((p, i) => p * race.payouts[i]! - 1);
        
        // Sort slots by EV descending
        const sortedSlots = evs
            .map((ev, i) => ({ slot: i + 1, ev }))
            .sort((a, b) => b.ev - a.ev);

        // Select bets above threshold and within limit
        const bets = sortedSlots
            .filter(s => s.ev > minScore)
            .slice(0, betLimit)
            .map(s => s.slot);

        const maxEV = sortedSlots[0]?.ev ?? -Infinity;
        
        let raceProfit = 0;
        let raceWins = 0;
        
        if (bets.length > 0) {
            stats.totalPredictions++;
            stats.totalBetCost += bets.length;
            
            for (const slot of bets) {
                if (slot === race.winningSlot) {
                    raceProfit += race.winningPayout! - 1;
                    raceWins++;
                    stats.correctPredictions++;
                } else {
                    raceProfit -= 1;
                }
            }
            stats.totalProfit += raceProfit;
        } else {
            stats.skippedRaces++;
        }

        const status = bets.length === 0 ? "SKIPPED" : raceWins > 0 ? "WIN" : "LOSS";
        
        printRow(
            race,
            bets,
            race.winningSlot,
            race.winningPayout!,
            maxEV,
            raceProfit,
            stats.totalProfit,
            status,
            0 // Consensus regime not applicable
        );
    }

    printSummary(stats);

    // Print latest 3 upcoming races (no winner yet)
    const upcoming = currentRaces.filter((r) => r.winningSlot === null);
    const latestUpcoming = upcoming.slice(-3);
    if (latestUpcoming.length > 0) {
        console.log("\n--- Latest 3 upcoming races (predictions) ---");
        printHeader();
        for (const race of latestUpcoming) {
            const probs = predictGBT(gbt, race, winRates, monsterRates);
            const evs = probs.map((p, i) => p * race.payouts[i]! - 1);
            const sortedSlots = evs
                .map((ev, i) => ({ slot: i + 1, ev }))
                .sort((a, b) => b.ev - a.ev);
            const bets = sortedSlots
                .filter((s) => s.ev > minScore)
                .slice(0, betLimit)
                .map((s) => s.slot);
            const maxEV = sortedSlots[0]?.ev ?? -Infinity;
            printRow(
                race,
                bets,
                null,
                null,
                maxEV,
                0,
                stats.totalProfit,
                "PENDING",
                0,
            );
        }
        console.log(SEPARATOR);
    }
}

function getFlagValue(args: string[], prefix: string): string | undefined {
    const arg = args.find((a) => a.startsWith(prefix));
    if (!arg || !arg.includes("=")) return undefined;
    const value = arg.split("=")[1]?.trim();
    return value !== "" ? value : undefined;
}

const args = process.argv.slice(2);
const positionalArgs = args.filter(a => !a.startsWith("-"));
const prevFile = positionalArgs[0] || "data_historical.txt";
const currFile = positionalArgs[1] || "data_current.txt";

const betLimitStr = getFlagValue(args, "--bet-limit=");
const betLimit = betLimitStr ? parseInt(betLimitStr, 10) : 2;

const minScoreStr = getFlagValue(args, "--min-score=");
const minScore = minScoreStr ? parseFloat(minScoreStr) : 0.15;

runGBTBacktest(prevFile, currFile, betLimit, minScore).catch(console.error);
