/**
 * @file result-printer.ts
 * @description Formats and prints backtest results to the terminal.
 */

import type { Race } from "../shared/types";
import { formatCurrency } from "../shared/utils";

/**
 * Tracks cumulative performance metrics throughout a backtest run.
 */
export interface BacktestStats {
    totalProfit: number;
    correctPredictions: number;
    totalPredictions: number;
    totalBetCost: number;
    skippedRaces: number;
}

/**
 * Table Columns:
 * Date | Time | Venue | R: Race Number | Bets: Slots | Act: Actual Winner
 * Pay: Actual Payout | Score: Model confidence | Win?: Outcome | Profit | Cumulative | Status | Mode
 */
const DATE_COL_WIDTH = 12; // "Fri, 30 Jan"
export const SEPARATOR = "-".repeat(135);
const HEADER = `${"Date".padStart(DATE_COL_WIDTH)} | ${"Time".padEnd(5)} | ${"Venue".padEnd(14)} | R | ${"Mode".padStart(4)} | ${"Bets".padEnd(7)} | ${"Act".padStart(3)} | ${"Pay".padStart(4)} | ${"Score".padStart(6)} | ${"Win?".padEnd(4)} | ${"Profit".padStart(8)} | ${"Cumulative".padStart(10)} | ${"Status".padEnd(8)}`;

export function printHeader(): void {
    console.log([SEPARATOR, HEADER, SEPARATOR].join("\n"));
}

/**
 * Prints a single result row.
 *
 * Win Status: PENDING if outcome unknown; YES if profitable or any bet matched winner; NO otherwise.
 */
export function printRow(
    race: Race,
    bets: number[],
    winningSlot: number | null,
    winningPayout: number | null,
    score: number,
    raceProfit: number,
    totalProfit: number,
    status: string,
    regime: number,
): void {
    const betDisplay = [1, 2, 3, 4, 5, 6].map((s) => (bets.includes(s) ? s.toString() : " ")).join("");
    const isPending = winningSlot === null;
    const winStatus = isPending
        ? "-"
        : raceProfit > 0 || (bets.includes(winningSlot!) && winningPayout! >= 1)
          ? "YES"
          : "NO";

    const dateCol = (race.date ? race.date : `D${race.day}`).padStart(DATE_COL_WIDTH);
    console.log(
        `${dateCol} | ${race.time.padEnd(5)} | ${(race.venue || "").padEnd(14)} | ${race.raceNumber} | ${("S" + regime).padStart(4)} | ${betDisplay.padEnd(7)} | ${isPending ? "?".padStart(3) : winningSlot!.toString().padStart(3)} | ${isPending ? "?".padStart(4) : winningPayout!.toString().padStart(4)} | ${score.toFixed(2).padStart(6)} | ${winStatus.padEnd(4)} | ${isPending ? "-".padStart(8) : raceProfit.toFixed(2).padStart(8)} | ${totalProfit.toFixed(2).padStart(10)} | ${status.padEnd(8)}`,
    );
}

/**
 * Summarizes the backtest run: ROI, profit, accuracy, total bets/predictions.
 */
export function printSummary(stats: BacktestStats): void {
    const { totalProfit, totalBetCost, correctPredictions, totalPredictions } = stats;
    const roi = totalBetCost > 0 ? (totalProfit / totalBetCost) * 100 : 0;
    const accuracy = (correctPredictions / (totalPredictions || 1)) * 100;

    console.log(SEPARATOR);
    console.log(
        `ROI: ${roi.toFixed(2).padStart(6)}% | Profit: ${formatCurrency(totalProfit).padStart(6, " ")} | Accuracy: ${accuracy.toFixed(2)}% | Total Bets: ${totalBetCost} | Total Preds: ${totalPredictions}`,
    );
}
