import { loadRaces, calculateStats, formatPercent } from "../shared/utils";
import { BacktestConfig } from "../shared/types";

async function main() {
  const races = await loadRaces("data_all.txt");
  if (races.length === 0) {
    console.error("No races found in data_all.txt");
    process.exit(1);
  }

  console.log(`Analyzing ${races.length} races for venue patterns...\n`);

  // 1. Streak Analysis
  const streaks: number[] = [];
  let currentStreak = 0;
  let lastVenue = "";

  for (const r of races) {
    if (r.venue === lastVenue) {
      currentStreak++;
    } else {
      if (currentStreak > 0) streaks.push(currentStreak);
      currentStreak = 1;
      lastVenue = r.venue || "?";
    }
  }
  if (currentStreak > 0) streaks.push(currentStreak);

  const streakCounts: Record<number, number> = {};
  streaks.forEach((s) => {
    streakCounts[s] = (streakCounts[s] || 0) + 1;
  });

  console.log("--- Venue Session Length Distribution ---");
  console.log("Races\tCount\tFrequency");
  const totalSessions = streaks.length;
  Object.keys(streakCounts)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((s) => {
      const count = streakCounts[s];
      console.log(`${s}\t${count}\t${formatPercent(count / totalSessions)}`);
    });
  console.log(`Average Session Length: ${(races.length / totalSessions).toFixed(2)} races\n`);

  // 2. Win Rate & EV per Venue
  const config: BacktestConfig = {
    betLimit: 1,
    ensembleSize: 1,
    chunkSize: 9,
    trainingIterations: 10,
    trainingRestarts: 1,
    convergenceTolerance: 0.001,
    maxWorkers: 1,
    hmmStates: 2,
    hmmObservations: 18,
    scoreWeights: { historical: 1.0, hmm: 0.0 },
    minScoreThreshold: 0,
    priorWeight: 0, // No smoothing for pure empirical analysis
  };

  const stats = calculateStats(races, config);
  const venues = Object.keys(stats.venueMap).sort();

  console.log("--- Win Rate and EV by Venue ---");
  console.log("Venue".padEnd(20) + " | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 | Slot 6");
  console.log("-".repeat(88));

  for (const v of venues) {
    const slotStats = stats.venueMap[v]!;
    const row = [v.padEnd(20)];
    for (let s = 1; s <= 6; s++) {
      const winRate = slotStats[s].wins / slotStats[s].occurrences;
      row.push(formatPercent(winRate).padStart(6));
    }
    console.log(row.join(" | "));

    const evRow = ["  (Implied EV)".padEnd(20)];
    for (let s = 1; s <= 6; s++) {
      const winRate = slotStats[s].wins / slotStats[s].occurrences;
      const avgPayout = slotStats[s].totalPayout / slotStats[s].wins;
      const ev = isNaN(winRate * avgPayout) ? 0 : winRate * avgPayout;
      evRow.push(ev.toFixed(2).padStart(6));
    }
    console.log(evRow.join(" | "));
    console.log("-".repeat(88));
  }

  // 3. Round-specific variance within Venue
  console.log("\n--- Round-Specific Win Rates (All Venues) ---");
  const rounds = [1, 2, 3];
  console.log("Round".padEnd(10) + " | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Slot 5 | Slot 6");
  for (const r of rounds) {
    const rStats = stats.roundMap[r];
    if (!rStats) continue;
    const row = [`Round ${r}`.padEnd(10)];
    for (let s = 1; s <= 6; s++) {
      const rate = rStats[s].wins / rStats[s].occurrences;
      row.push(formatPercent(rate).padStart(6));
    }
    console.log(row.join(" | "));
  }
}

main().catch(console.error);
