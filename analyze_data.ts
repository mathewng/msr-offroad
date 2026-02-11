import * as fs from "fs";
import { parseLines } from "./utils";

const data = fs.readFileSync("data_historical.txt", "utf-8");
const lines = data.split(/\r?\n/);
const races = parseLines(lines);

console.log(`Total Races: ${races.length}`);

// 1. Overround (House Edge)
let totalOverround = 0;
races.forEach((r) => {
    const impliedProb = r.payouts.reduce((sum, p) => sum + (p > 0 ? 1 / p : 0), 0);
    totalOverround += impliedProb;
});
console.log(`Average Overround (Sum of 1/Odds): ${(totalOverround / races.length).toFixed(4)}`);

// 2. EV Analysis by Odds
const oddsStats: Record<number, { wins: number; count: number; totalReturn: number }> = {};

races.forEach((r) => {
    r.payouts.forEach((p, index) => {
        const roundedOdds = Math.floor(p);
        if (!oddsStats[roundedOdds]) oddsStats[roundedOdds] = { wins: 0, count: 0, totalReturn: 0 };
        oddsStats[roundedOdds].count++;
        if (index + 1 === r.winningSlot) {
            oddsStats[roundedOdds].wins++;
            oddsStats[roundedOdds].totalReturn += p;
        }
    });
});

console.log("\n--- EV Analysis by Odds (Floor) ---");
console.log("Odds\tCount\tWin%\tROI");
Object.keys(oddsStats)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((odds) => {
        const s = oddsStats[odds];
        if (s.count < 100) return;
        const winRate = s.wins / s.count;
        const roi = s.totalReturn / s.count - 1;
        console.log(`${odds}\t${s.count}\t${(winRate * 100).toFixed(1)}%\t${(roi * 100).toFixed(1)}%`);
    });

// 3. Venue Bias
const venueStats: Record<string, Record<number, { wins: number; count: number }>> = {};
races.forEach((r) => {
    if (!venueStats[r.venue]) venueStats[r.venue] = {};
    for (let s = 1; s <= 6; s++) {
        if (!venueStats[r.venue][s]) venueStats[r.venue][s] = { wins: 0, count: 0 };
        venueStats[r.venue][s].count++;
        if (s === r.winningSlot) venueStats[r.venue][s].wins++;
    }
});

console.log("\n--- Venue Bias (Win Rate per Slot) ---");
Object.keys(venueStats).forEach((v) => {
    const slots = venueStats[v];
    const rates = [];
    for (let s = 1; s <= 6; s++) {
        const rate = slots[s].wins / slots[s].count;
        rates.push(`${s}:${(rate * 100).toFixed(1)}%`);
    }
    console.log(`${v.padEnd(20)}: ${rates.join(", ")}`);
});

// 4. Transition Matrix (Markov)
const transition: Record<number, Record<number, number>> = {};
for (let s = 1; s <= 6; s++) {
    transition[s] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
}

for (let i = 0; i < races.length - 1; i++) {
    const curr = races[i];
    const next = races[i + 1];
    if (curr.winningSlot && next.winningSlot) {
        transition[curr.winningSlot][next.winningSlot]++;
    }
}

console.log("\n--- Transition Matrix (Prev Slot -> Next Slot Win %) ---");
process.stdout.write("P\\N\t1\t2\t3\t4\t5\t6\n");
for (let p = 1; p <= 6; p++) {
    const row = transition[p];
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    const rates = [1, 2, 3, 4, 5, 6].map((n) => ((row[n] / total) * 100).toFixed(1) + "%");
    console.log(`${p}\t${rates.join("\t")}`);
}
