import type { Race, StatsResult } from "./types";

/**
 * Feature set for a single slot in a race.
 * Categorical values are strings, numerical values are numbers.
 */
export interface RaceFeatures {
    slot: number;
    round: number;
    time: number;
    payout: number;
    avgPayout: number;
    payoutRank: number;
    isFavorite: number; // 1 if lowest payout in race
    payoutDeviation: number; // payout / avgPayout
    logPayout: number; // Math.log(payout)
    slotWinRate: number; // Historical win rate for this slot
    monsterWinRate: number; // Historical win rate for the monster
    venueWinRate: number; // Historical win rate for this slot at this venue
    roundWinRate: number; // Historical win rate for this slot in this round
    venueRoundWinRate: number; // Historical win rate for this slot at this venue AND round
    venueRoundAvgPayout: number; // Historical average payout when winning at this venue AND round
    venueRoundEV: number; // Historical expected value for this venue AND round
}

/**
 * Extracts features for a specific slot in a given race.
 */
export function extractFeatures(race: Race, slotIndex: number, stats?: StatsResult, monsterRates?: Record<string, number>): RaceFeatures {
    const slot = slotIndex + 1;
    const payout = race.payouts[slotIndex] ?? 0;

    // Sort payouts to find rank and average
    const sortedPayouts = [...race.payouts].sort((a, b) => a - b);
    const avgPayout = race.payouts.reduce((a, b) => a + b, 0) / race.payouts.length;
    const payoutRank = sortedPayouts.indexOf(payout) + 1;
    const isFavorite = payout === sortedPayouts[0] ? 1 : 0;

    // Normalize time (e.g. "12:00" -> 12, "6pm" -> 18)
    const timeStr = race.time.toLowerCase();
    let timeHour = 12;
    if (timeStr.includes("6pm") || timeStr.includes("18:00")) timeHour = 18;

    const venue = race.venue ?? "Unknown";
    const round = race.raceNumber;

    const slotWinRate = stats?.slotMap?.[slot]?.winRate ?? 0.16;
    const monsterWinRate = monsterRates?.[race.players?.[slotIndex] ?? "Human"] ?? 0.16;
    const venueWinRate = stats?.venueMap?.[venue]?.[slot]?.winRate ?? slotWinRate;
    const roundWinRate = stats?.roundMap?.[round]?.[slot]?.winRate ?? slotWinRate;
    const venueRoundWinRate = stats?.venueRoundMap?.[venue]?.[round]?.[slot]?.winRate ?? venueWinRate;
    const venueRoundAvgPayout = stats?.venueRoundMap?.[venue]?.[round]?.[slot]?.avgPayout ?? 6.0;

    // Historical EV calculation: pWin * avgPayout - (1 - pWin)
    const venueRoundEV = venueRoundWinRate * venueRoundAvgPayout - (1 - venueRoundWinRate);

    return {
        slot,
        round,
        time: timeHour,
        payout,
        avgPayout,
        payoutRank,
        isFavorite,
        payoutDeviation: payout / (avgPayout || 1),
        logPayout: Math.log(payout || 1),
        slotWinRate,
        monsterWinRate,
        venueWinRate,
        roundWinRate,
        venueRoundWinRate,
        venueRoundAvgPayout,
        venueRoundEV,
    };
}

/**
 * Converts a Race and its outcome into a set of training examples.
 * Each race produces 6 examples (one per slot).
 */
export function raceToExamples(race: Race, stats?: StatsResult, monsterRates?: Record<string, number>): (RaceFeatures & { won: number })[] {
    if (race.winningSlot === null) return [];

    return race.payouts.map((_, i) => {
        const features = extractFeatures(race, i, stats, monsterRates);
        return {
            ...features,
            won: i + 1 === race.winningSlot ? 1 : 0,
        };
    });
}
