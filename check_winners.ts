import { loadRaces } from "./src/shared/utils";

const races = await loadRaces("data_historical.txt");
const distribution: Record<number, number> = {};
for (const race of races) {
    if (race.winningSlot) {
        distribution[race.winningSlot] = (distribution[race.winningSlot] ?? 0) + 1;
    }
}
console.log("Historical distribution:", distribution);

const currentRaces = await loadRaces("data_current.txt");
const currentDist: Record<number, number> = {};
let count = 0;
for (const race of currentRaces) {
    if (race.winningSlot) {
        currentDist[race.winningSlot] = (currentDist[race.winningSlot] ?? 0) + 1;
        count++;
    }
}
console.log(`Current data distribution (${count} races):`, currentDist);
