import type { Race } from "./types";

/**
 * Feature set for a single slot in a race.
 * Categorical values are strings, numerical values are numbers.
 */
export interface RaceFeatures {
    slot: number;
    venue: string;
    round: number;
    time: number;
    payout: number;
    monster: string;
    avgPayout: number;
    payoutRank: number;
    isFavorite: number; // 1 if lowest payout in race
    payoutDeviation: number; // payout / avgPayout
    logPayout: number; // Math.log(payout)
    slotWinRate: number; // Historical win rate for this slot
    monsterWinRate: number; // Historical win rate for the monster
}

/**
 * Extracts features for a specific slot in a given race.
 */
export function extractFeatures(
    race: Race, 
    slotIndex: number, 
    rates?: Record<number, number>,
    monsterRates?: Record<string, number>
): RaceFeatures {
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

    return {
        slot,
        venue: race.venue ?? "Unknown",
        round: race.raceNumber,
        time: timeHour,
        payout,
        monster: race.players?.[slotIndex] ?? "Human",
        avgPayout,
        payoutRank,
        isFavorite,
        payoutDeviation: payout / (avgPayout || 1),
        logPayout: Math.log(payout || 1),
        slotWinRate: rates?.[slot] ?? 0.16,
        monsterWinRate: monsterRates?.[race.players?.[slotIndex] ?? "Human"] ?? 0.16,
    };
}

/**
 * Converts a Race and its outcome into a set of training examples.
 * Each race produces 6 examples (one per slot).
 */
export function raceToExamples(
    race: Race, 
    rates?: Record<number, number>,
    monsterRates?: Record<string, number>
): (RaceFeatures & { won: number })[] {
    if (race.winningSlot === null) return [];
    
    return race.payouts.map((_, i) => {
        const features = extractFeatures(race, i, rates, monsterRates);
        return {
            ...features,
            won: (i + 1) === race.winningSlot ? 1 : 0,
        };
    });
}
