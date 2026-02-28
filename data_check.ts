/**
 * Data check: per-day summary of venue mix, average payout, and slot win distribution.
 * Use to detect structural breaks (e.g. around day 24) that may explain HMM slump.
 *
 * Usage: bun data_check.ts [data_file]
 * Default file: data_current.txt
 */

import { parseLines } from "./utils";
import type { Race } from "./types";

const file = process.argv[2] ?? "data_current.txt";
const file_historical = process.argv[3] ?? "data_historical.txt";
let text: string;
try {
    const f = Bun.file(file);
    const f_historical = Bun.file(file_historical);
    text = (await f_historical.text())+(await f.text());
} catch (e) {
    console.error(`Error reading ${file}:`, e);
    process.exit(1);
}

const races = parseLines(text.split(/\r?\n/));
const resolved = races.filter((r) => r.winningSlot != null && r.winningPayout != null);
if (resolved.length === 0) {
    console.error("No resolved races found.");
    process.exit(1);
}

const byDay = new Map<
    number,
    { races: Race[]; venueCounts: Record<string, number>; payouts: number[]; slotWins: Record<number, number> }
>();

for (const r of resolved) {
    const day = r.day;
    if (!byDay.has(day)) {
        byDay.set(day, {
            races: [],
            venueCounts: {},
            payouts: [],
            slotWins: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
        });
    }
    const row = byDay.get(day)!;
    row.races.push(r);
    if (r.venue) row.venueCounts[r.venue] = (row.venueCounts[r.venue] ?? 0) + 1;
    if (r.winningPayout != null) row.payouts.push(r.winningPayout);
    if (r.winningSlot != null) row.slotWins[r.winningSlot] = (row.slotWins[r.winningSlot] ?? 0) + 1;
}

const days = [...byDay.keys()].sort((a, b) => a - b);
const sep = "-".repeat(70);
console.log(`Data check: ${file}`);
console.log(`Total resolved races: ${resolved.length}, Days: ${days.length}\n`);
console.log(sep);
console.log("Per-day: venue mix (counts) | avg winning payout | slot win distribution (1-6)");
console.log(sep);

for (const day of days) {
    const row = byDay.get(day)!;
    const venueStr = Object.entries(row.venueCounts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([v, c]) => `${v}:${c}`)
        .join(" ");
    const avgPayout =
        row.payouts.length > 0 ? row.payouts.reduce((a, b) => a + b, 0) / row.payouts.length : 0;
    const slotStr = [1, 2, 3, 4, 5, 6].map((s) => row.slotWins[s] ?? 0).join(",");
    console.log(`Day ${day.toString().padStart(3)} | ${venueStr.padEnd(32)} | avg ${avgPayout.toFixed(2).padStart(5)} | [${slotStr}]`);
}

console.log(sep);
