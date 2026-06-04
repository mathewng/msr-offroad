/**
 * Walk-forward backtest for the Context EV Predictor (no HMM).
 */

import { predictContextRace } from "../core/context-engine";
import { CONFIG_CONTEXT, CONFIG_CONTEXT_CONSERVATIVE } from "../shared/config";
import { contextConfigFromBacktest, type ContextConfig } from "../shared/context-types";
import { calculateContextStats, updateContextStats } from "../shared/context-stats";
import type { Race } from "../shared/types";
import { calculateEmpiricalWinRates, loadRaces } from "../shared/utils";
import type { BacktestStats } from "./result-printer";
import { printHeader, printRow, printSummary } from "./result-printer";

const USAGE = `Usage: bun src/backtest/backtest-context.ts <historical> <current> [--conservative] [--file <single-file>]
       bun src/backtest/backtest-context.ts --file data_all.txt`;

function parseArgs(): {
    prevFile: string | undefined;
    currFile: string | undefined;
    singleFile: string | undefined;
    config: ContextConfig;
} {
    const args = process.argv.slice(2);
    let prevFile: string | undefined;
    let currFile: string | undefined;
    let singleFile: string | undefined;
    let conservative = false;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--conservative") conservative = true;
        else if (a === "--file" && args[i + 1]) {
            singleFile = args[++i];
        } else if (!a!.startsWith("-")) {
            if (!prevFile) prevFile = a;
            else if (!currFile) currFile = a;
        }
    }

    const base = conservative ? CONFIG_CONTEXT_CONSERVATIVE : CONFIG_CONTEXT;
    return {
        prevFile,
        currFile,
        singleFile,
        config: contextConfigFromBacktest(base),
    };
}

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

async function runContextBacktest(history: Race[], targetRaces: Race[], config: ContextConfig): Promise<BacktestStats> {
    const stats: BacktestStats = {
        totalProfit: 0,
        correctPredictions: 0,
        totalPredictions: 0,
        totalBetCost: 0,
        skippedRaces: 0,
    };

    let currentStats = calculateContextStats(history, config);
    printHeader();

    for (const currentRace of targetRaces) {
        const { bets, score } = predictContextRace(currentRace, currentStats, config);
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
            updateContextStats(currentStats, currentRace, config);
        }

        const status = computeStatus(bets, isPending, raceWins);
        printRow(currentRace, bets, currentRace.winningSlot, currentRace.winningPayout, score, raceProfit, stats.totalProfit, status, 0);
    }

    printSummary(stats);
    return stats;
}

async function main(): Promise<void> {
    const { prevFile, currFile, singleFile, config } = parseArgs();

    if (singleFile) {
        const all = await loadRaces(singleFile);
        const resolved = all.filter((r) => r.winningSlot !== null);
        if (resolved.length < 10) {
            console.error("Not enough resolved races for walk-forward.");
            process.exit(1);
        }
        const split = Math.max(1, Math.floor(resolved.length * 0.9));
        const history = resolved.slice(0, split);
        const target = resolved.slice(split);
        config.empiricalWinRates = calculateEmpiricalWinRates(history);
        console.log(`Single-file walk-forward: history=${history.length}, target=${target.length}`);
        await runContextBacktest(history, target, config);
        return;
    }

    if (!prevFile || !currFile) {
        console.error(USAGE);
        process.exit(1);
    }

    const previousMonthsRaces = await loadRaces(prevFile);
    const currentMonthRaces = await loadRaces(currFile);
    if (currentMonthRaces.length === 0) {
        console.error(`Error: No data found in ${currFile}`);
        process.exit(1);
    }

    config.empiricalWinRates = calculateEmpiricalWinRates(previousMonthsRaces);
    const history = [...previousMonthsRaces];
    console.log(`CEVP: history=${history.length}, target=${currentMonthRaces.length}`);
    await runContextBacktest(history, currentMonthRaces, config);
}

main().catch(console.error);
