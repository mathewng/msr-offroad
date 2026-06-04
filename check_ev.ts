import { loadRaces } from "./src/shared/utils";

const races = await loadRaces("data_historical.txt");
const stats: Record<number, { wins: number; total: number; sumPayout: number }> = {};
for (let s = 1; s <= 6; s++) stats[s] = { wins: 0, total: 0, sumPayout: 0 };

for (const race of races) {
    if (race.winningSlot) {
        const s = race.winningSlot;
        stats[s]!.wins++;
        stats[s]!.sumPayout += race.winningPayout ?? 0;
    }
    for (let s = 1; s <= 6; s++) {
        stats[s]!.total++;
    }
}

for (let s = 1; s <= 6; s++) {
    const avgWinPayout = stats[s]!.wins > 0 ? stats[s]!.sumPayout / stats[s]!.wins : 0;
    const wr = stats[s]!.wins / stats[s]!.total;
    const ev = wr * avgWinPayout - 1;
    console.log(`Slot ${s}: WR=${(wr * 100).toFixed(2)}%, AvgWinPay=${avgWinPayout.toFixed(2)}, EV=${ev.toFixed(4)}`);
}
