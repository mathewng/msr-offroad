import { loadRaces, calculateStats } from "../shared/utils";
import { trainGBT, predictGBT } from "../core/gbt-engine";
import { printHeader, printRow, printSummary, SEPARATOR } from "./result-printer";
import type { BacktestStats } from "./result-printer";
import type { Race, BacktestConfig } from "../shared/types";
import { CONFIG_BET2 } from "../shared/config";

const defaultConfig: BacktestConfig = { ...CONFIG_BET2, ensembleSize: 1 };

function calculateMonsterRates(trainingRaces: Race[]): Record<string, number> {
    const monsterCounts: Record<string, { wins: number, total: number }> = {};
    for (const r of trainingRaces) {
        for (let i = 0; i < 6; i++) {
            const m = r.players?.[i] ?? "Human";
            if (!monsterCounts[m]) monsterCounts[m] = { wins: 0, total: 0 };
            monsterCounts[m]!.total++;
            if (i + 1 === r.winningSlot) monsterCounts[m]!.wins++;
        }
    }
    const monsterRates: Record<string, number> = {};
    for (const [m, c] of Object.entries(monsterCounts)) {
        monsterRates[m] = (c.wins + 0.1) / (c.total + 0.6);
    }
    return monsterRates;
}

async function runGBTBacktest(histFile: string | undefined, currFile: string, betLimit: number, minScore: number) {
    const historicalRaces = histFile ? await loadRaces(histFile) : [];
    const currentRaces = await loadRaces(currFile);
    
    // Initial training history: all races from historical file with known winners
    let trainingHistory = historicalRaces.filter(r => r.winningSlot !== null);
    
    const stats: BacktestStats = {
        totalProfit: 0,
        correctPredictions: 0,
        totalPredictions: 0,
        totalBetCost: 0,
        skippedRaces: 0,
    };

    printHeader();

    // Process in chunks of 3 (representing one session: 12pm or 6pm)
    const chunkSize = 3;
    for (let i = 0; i < currentRaces.length; i += chunkSize) {
        const chunk = currentRaces.slice(i, i + chunkSize);
        
        // Retrain model before each session using all available history
        const historicalStats = calculateStats(trainingHistory, defaultConfig);
        const monsterRates = calculateMonsterRates(trainingHistory);
        const gbt = trainGBT(trainingHistory, historicalStats, monsterRates);

        for (const race of chunk) {
            if (race.winningSlot === null) continue;

            const probs = predictGBT(gbt, race, historicalStats, monsterRates);
            
            // Betting logic: Find slots where (Prob * Payout) is highest.
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

        // Add this session's races to training history for next iteration
        const seenInChunk = chunk.filter(r => r.winningSlot !== null);
        trainingHistory = trainingHistory.concat(seenInChunk);
    }

    printSummary(stats);

    // Predict upcoming races
    const upcoming = currentRaces.filter((r) => r.isUnseen);
    const latestUpcoming = upcoming.slice(-3);
    if (latestUpcoming.length > 0) {
        // Use latest model for upcoming predictions
        const finalStats = calculateStats(trainingHistory, defaultConfig);
        const monsterRates = calculateMonsterRates(trainingHistory);
        const gbt = trainGBT(trainingHistory, finalStats, monsterRates);

        console.log("\n--- Latest 3 upcoming races (predictions) ---");
        printHeader();
        for (const race of latestUpcoming) {
            const probs = predictGBT(gbt, race, finalStats, monsterRates);
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

// If two files are provided, first is training (initial history)
// and second is test data. If one file is provided, it's the test data.
const testFile = positionalArgs.length >= 2 ? positionalArgs[1] : positionalArgs[0] || "data_current.txt";
const histFile = positionalArgs.length >= 2 ? positionalArgs[0] : undefined;

const betLimitStr = getFlagValue(args, "--bet-limit=");
const betLimit = betLimitStr ? parseInt(betLimitStr, 10) : 2;

const minScoreStr = getFlagValue(args, "--min-score=");
const minScore = minScoreStr ? parseFloat(minScoreStr) : -1.0;

runGBTBacktest(histFile, testFile!, betLimit, minScore).catch(console.error);

