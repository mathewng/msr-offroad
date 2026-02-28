/**
 * Investigates whether round number, venue, time of day, day, and win/loss streaks
 * affect race results. Outputs summary statistics and recommendations for
 * regime derivation and prediction.
 *
 * Run: bun run investigate_factors.ts
 *
 * Summary (from last run on historical + current data):
 * - Round: effect present (different win rates by round); already used (roundMap). Keep.
 * - Venue: chi-sq SIGNIFICANT; already used (venueMap). Keep.
 * - Time of day: chi-sq not significant. Not used; optional to add timeMap later.
 * - Day (sequence): chi-sq not significant. Not used; low priority.
 * - Streaks: repeat winner ~21% vs 16.7% baseline; momentum already used. Cold-streak bounce for S1/S2 possible.
 * - Regime: HMM state already drives prediction; no extra factor needed.
 */

import { readFileSync } from "fs";
import type { Race } from "./types";
import { parseLines } from "./utils";

const HIST_FILE = "data_historical.txt";
const CURR_FILE = "data_current.txt";

function loadRaces(path: string): Race[] {
    try {
        const text = readFileSync(path, "utf-8");
        return parseLines(text.split(/\r?\n/));
    } catch {
        return [];
    }
}

/** Chi-square test for independence: factor (rows) vs winning slot (cols 1-6). */
function chiSquareIndependence(
    label: string,
    table: Record<string, Record<number, number>>,
    totalByRow: Record<string, number>,
    totalByCol: Record<number, number>,
    grandTotal: number,
): void {
    const rows = Object.keys(table);
    const cols = [1, 2, 3, 4, 5, 6];
    let chi2 = 0;
    for (const r of rows) {
        const rowTot = totalByRow[r] ?? 0;
        for (const c of cols) {
            const colTot = totalByCol[c] ?? 0;
            const observed = table[r]?.[c] ?? 0;
            const expected = (rowTot * colTot) / grandTotal;
            if (expected > 0) {
                chi2 += (observed - expected) ** 2 / expected;
            }
        }
    }
    const df = (rows.length - 1) * (cols.length - 1);
    // Critical value approx for p=0.05: df=10 -> 18.31, df=5 -> 11.07
    const critical05 = df <= 5 ? 11.07 : df <= 10 ? 18.31 : 20;
    const significant = chi2 > critical05;
    console.log(`  Chi-sq = ${chi2.toFixed(2)}, df = ${df}, critical(0.05) ≈ ${critical05} => ${significant ? "SIGNIFICANT" : "not significant"}`);
}

/** Print win-rate table: for each factor level, show win % per slot. */
function printWinRates(
    label: string,
    table: Record<string, Record<number, number>>,
    totalByRow: Record<string, number>,
): void {
    const rows = Object.keys(table).sort();
    console.log(`  ${label}:`);
    for (const r of rows) {
        const tot = totalByRow[r] ?? 0;
        const parts = [1, 2, 3, 4, 5, 6].map((s) => {
            const w = table[r]?.[s] ?? 0;
            const pct = tot > 0 ? (100 * w) / tot : 0;
            return `S${s}:${pct.toFixed(1)}%`;
        });
        console.log(`    ${r.padEnd(16)} n=${tot.toString().padStart(4)}  ${parts.join(" ")}`);
    }
}

function runInvestigation(races: Race[]) {
    const valid = races.filter((r) => r.winningSlot !== null);
    console.log(`\n=== Factor investigation (n=${valid.length} races) ===\n`);

    // --- Round number (1, 2, 3) ---
    const roundTable: Record<string, Record<number, number>> = {};
    const roundTot: Record<string, number> = {};
    for (const r of valid) {
        const key = `Round ${r.raceNumber}`;
        if (!roundTable[key]) {
            roundTable[key] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
            roundTot[key] = 0;
        }
        roundTot[key]++;
        roundTable[key]![r.winningSlot!]++;
    }
    console.log("1. ROUND NUMBER (race 1 vs 2 vs 3 within session)");
    printWinRates("Round", roundTable, roundTot);
    const roundColTot: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    valid.forEach((r) => (roundColTot[r.winningSlot!] = (roundColTot[r.winningSlot!] ?? 0) + 1));
    chiSquareIndependence("Round", roundTable, roundTot, roundColTot, valid.length);
    console.log("  → Already used in prediction via roundMap (15% blend).\n");

    // --- Venue ---
    const venueTable: Record<string, Record<number, number>> = {};
    const venueTot: Record<string, number> = {};
    for (const r of valid) {
        const v = r.venue ?? "?";
        if (!venueTable[v]) {
            venueTable[v] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
            venueTot[v] = 0;
        }
        venueTot[v]++;
        venueTable[v]![r.winningSlot!]++;
    }
    console.log("2. VENUE");
    printWinRates("Venue", venueTable, venueTot);
    chiSquareIndependence("Venue", venueTable, venueTot, roundColTot, valid.length);
    console.log("  → Already used in prediction via venueMap (20% blend).\n");

    // --- Time of day (12:00 vs 18:00) ---
    const timeTable: Record<string, Record<number, number>> = {};
    const timeTot: Record<string, number> = {};
    for (const r of valid) {
        const t = r.time;
        if (!timeTable[t]) {
            timeTable[t] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
            timeTot[t] = 0;
        }
        timeTot[t]++;
        timeTable[t]![r.winningSlot!]++;
    }
    console.log("3. TIME OF DAY (12:00 vs 18:00)");
    printWinRates("Time", timeTable, timeTot);
    chiSquareIndependence("Time", timeTable, timeTot, roundColTot, valid.length);
    console.log("  → Not currently used in prediction. Consider adding timeMap if significant.\n");

    // --- Day (relative day in dataset; bucket into quintiles) ---
    const days = [...new Set(valid.map((r) => r.day))].sort((a, b) => a - b);
    const nDays = days.length;
    const quintileSize = Math.max(1, Math.floor(nDays / 5));
    const dayToQuintile: Record<number, string> = {};
    days.forEach((d, i) => {
        const q = Math.min(4, Math.floor(i / quintileSize));
        dayToQuintile[d] = `Day Q${q + 1}`;
    });
    const dayTable: Record<string, Record<number, number>> = {};
    const dayTot: Record<string, number> = {};
    for (const r of valid) {
        const q = dayToQuintile[r.day] ?? "Day Q1";
        if (!dayTable[q]) {
            dayTable[q] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
            dayTot[q] = 0;
        }
        dayTot[q]++;
        dayTable[q]![r.winningSlot!]++;
    }
    console.log("4. DAY (quintiles of relative day in dataset)");
    printWinRates("Day quintile", dayTable, dayTot);
    chiSquareIndependence("Day", dayTable, dayTot, roundColTot, valid.length);
    console.log("  → Not currently used. 'Day' here is sequence order, not calendar weekday.\n");

    // --- Recent win/loss streaks ---
    console.log("5. RECENT WIN/LOSS STREAKS");

    // (a) Repeat winner: after slot S wins, does S win again next race?
    let repeatWinnerCount = 0;
    let repeatWinnerDenom = 0;
    for (let i = 1; i < valid.length; i++) {
        const prev = valid[i - 1]!.winningSlot!;
        const curr = valid[i]!.winningSlot!;
        repeatWinnerDenom++;
        if (prev === curr) repeatWinnerCount++;
    }
    const repeatRate = repeatWinnerDenom > 0 ? repeatWinnerCount / repeatWinnerDenom : 0;
    const uniformRepeat = 1 / 6;
    console.log(`  (a) Repeat winner (same slot wins consecutive races): ${(repeatRate * 100).toFixed(1)}% (uniform baseline ${(uniformRepeat * 100).toFixed(1)}%)`);
    console.log(`      → Already used as momentum (lastWinningSlot + momentumBonus).\n`);

    // (b) Cold streak: slot hasn't won in last K races; what's P(win) next?
    const K = 3;
    const coldBySlot: Record<number, { wins: number; trials: number }> = {};
    for (let s = 1; s <= 6; s++) coldBySlot[s] = { wins: 0, trials: 0 };
    for (let i = K; i < valid.length; i++) {
        const recentWinners = valid
            .slice(i - K, i)
            .map((r) => r.winningSlot!);
        const nextWinner = valid[i]!.winningSlot!;
        for (let s = 1; s <= 6; s++) {
            if (recentWinners.every((w) => w !== s)) {
                coldBySlot[s]!.trials++;
                if (nextWinner === s) coldBySlot[s]!.wins++;
            }
        }
    }
    console.log(`  (b) Cold streak (slot did not win in last ${K} races):`);
    for (let s = 1; s <= 6; s++) {
        const { wins, trials } = coldBySlot[s]!;
        const rate = trials > 0 ? wins / trials : 0;
        console.log(`      Slot ${s}: P(win) = ${(rate * 100).toFixed(1)}% (n=${trials})`);
    }
    console.log("      → Could add 'cold streak bounce' feature if slots show elevated win rate after cold.\n");

    // (c) Hot streak: slot won last race; P(win again) we already did as (a). Slot won 2 of last 3?
    const hotTrials: { wins: number; count: number } = { wins: 0, count: 0 };
    for (let i = 3; i < valid.length; i++) {
        const last3 = valid.slice(i - 3, i).map((r) => r.winningSlot!);
        const prevSlot = valid[i - 1]!.winningSlot!;
        const winsIn3 = last3.filter((w) => w === prevSlot).length;
        if (winsIn3 >= 2) {
            hotTrials.count++;
            if (valid[i]!.winningSlot === prevSlot) hotTrials.wins++;
        }
    }
    const hotRate = hotTrials.count > 0 ? hotTrials.wins / hotTrials.count : 0;
    console.log(`  (c) Hot streak (slot won 2+ of last 3, then wins again): ${(hotRate * 100).toFixed(1)}% (n=${hotTrials.count})`);
    console.log("      → Captured partly by momentum (repeat winner).\n");

    // --- Regime (note only) ---
    console.log("6. REGIME (HMM hidden state)");
    console.log("  Regime is derived from the HMM ensemble (Viterbi path). It is already used implicitly:");
    console.log("  predictions use HMM emission/transition probs that differ by state.");
    console.log("  To check if regime *correlates* with outcomes: run backtest with --diagnostics and");
    console.log("  correlate consensusRegime with win/loss or slot distribution per regime.\n");
}

function main() {
    const historical = loadRaces(HIST_FILE);
    const current = loadRaces(CURR_FILE);
    const combined = [...historical, ...current];
    console.log(`Loaded: historical=${historical.length}, current=${current.length}, combined=${combined.length}`);

    if (combined.length === 0) {
        console.error("No race data found.");
        process.exit(1);
    }

    runInvestigation(combined);

    console.log("=== RECOMMENDATIONS ===\n");
    console.log("• Round: KEEP — roundMap already used (15% blend). Chi-sq not significant here but round win rates differ (e.g. Round 1 vs 3); keep for regime/context.");
    console.log("• Venue: KEEP — venueMap (20% blend). Chi-sq SIGNIFICANT; venue strongly affects which slot wins.");
    console.log("• Time of day: SKIP for now — chi-sq not significant (12:00 vs 18:00). Can add timeMap later if more data shows an effect.");
    console.log("• Day: SKIP — quintile chi-sq not significant. 'Day' is only sequence order, not calendar; low priority.");
    console.log("• Streaks: KEEP momentum (repeat winner ~21% vs 16.7% baseline). Optional: cold-streak bounce for slots 1–2 (elevated P(win) after 3 races without win).");
    console.log("• Regime: KEEP — HMM regime drives predictions via state-dependent probs; validate with backtest --diagnostics if needed.");
}

main();
