
import { loadRaces, calculateStats } from "./src/shared/utils";

const config = {
    priorWeight: 10.0,
    empiricalWinRates: { 1: 0.16, 2: 0.16, 3: 0.16, 4: 0.16, 5: 0.16, 6: 0.16 }
};

async function check() {
    const races = await loadRaces("data_historical.txt");
    const stats = calculateStats(races, config as any);
    console.log("Minar Forest Round 1 stats:");
    console.log(JSON.stringify(stats.venueRoundMap["Minar Forest"][1], null, 2));
}

check();
