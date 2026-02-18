import type { BucketStat, Race, RaceTime, SlotStat, StatsResult, BacktestConfig } from "./types";

export const EQUAL_SLOT_PROBABILITY = 1 / 6;

/**
 * Parses raw lines from a data file into an array of Race objects.
 *
 * Expectations:
 * - Tab-separated values.
 * - Columns: [Venue] [Time] [Round] [W1] [W2] [W3] [W4] [W5] [W6] [Empty] [P1] [P2] [P3] [P4] [P5] [P6]
 * - W1-W6 are binary win indicators (1 for winner, 0 otherwise).
 * - P1-P6 are the payout multipliers for each slot.
 */
export function parseLines(lines: string[]): Race[] {
    let currentDay = 1;
    let lastVenue = "";
    let lastTime: RaceTime = "12:00";
    const races: Race[] = [];

    // Pre-allocate arrays to reduce allocations
    const winIndicators = new Array(6);
    const payouts = new Array(6);

    for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split("\t");

        // Basic validation for the expected number of columns
        if (parts.length >= 13) {
            const venue = parts[0]?.trim();
            const timeStr = parts[1]?.trim();
            const roundStr = parts[2]?.trim();
            const roundNum = parseInt(roundStr || "");

            if (isNaN(roundNum)) continue;

            if (venue) lastVenue = venue;
            if (timeStr) {
                const normalizedTime = timeStr as RaceTime;
                // Detect day transition: if time rolls back from evening to morning, increment day count
                if ((lastTime === "18:00" || lastTime === "6pm") && (normalizedTime === "12:00" || normalizedTime === "12pm")) {
                    currentDay++;
                }
                lastTime = normalizedTime;
            }

            // Reuse arrays instead of creating new ones
            for (let i = 0; i < 6; i++) {
                const winPart = parts[3 + i]?.trim();
                const payPart = parts[10 + i]?.trim();
                winIndicators[i] = winPart === "?" ? NaN : parseInt(winPart || "0");
                payouts[i] = payPart === "?" ? NaN : parseFloat(payPart || "0");
            }

            const winningIndex = winIndicators.findIndex((n) => n === 1);
            const winningSlot = winningIndex !== -1 ? winningIndex + 1 : null;
            const winningPayout = winningSlot !== null ? payouts[winningIndex - 1 + 1] : null;

            races.push({
                day: currentDay,
                venue: lastVenue,
                time: lastTime,
                raceNumber: roundNum,
                payouts: [...payouts], // Only copy when needed
                bets: [],
                winningSlot,
                winningPayout: winningPayout && !isNaN(winningPayout) ? winningPayout : null,
            });
        }
    }
    return races;
}

/**
 * Categorizes a payout into a "bucket" relative to that specific slot's typical range.
 *
 * This ensures that Bucket 0 always represents a "strong" (low payout) version of that lane,
 * and Bucket 2 represents a "weak" (high payout) version, regardless of overlapping global ranges.
 */
export function getPayoutBucket(payout: number, slot: number): number {
    const [low, high] = [5.5, 9.6];

    if (payout <= low) return 0;
    if (payout <= high) return 1;
    return 2;
}

/**
 * Calculates historical win rates for each slot across multiple dimensions.
 *
 * Dimensions:
 * 1. Global (Slot-wide)
 * 2. Payout Bucket (Slot + Odds range)
 * 3. Venue (Slot + Location)
 * 4. Round (Slot + Race sequence number)
 *
 * Uses Laplace Smoothing to prevent 0% or 100% probabilities in cases with low sample sizes.
 */
export function calculateStats(allRaces: Race[], config: BacktestConfig): StatsResult {
    const bucketMap: Record<number, Record<number, BucketStat>> = {};
    const slotMap: Record<number, SlotStat> = {};
    const venueMap: Record<string, Record<number, SlotStat>> = {};
    const roundMap: Record<number, Record<number, SlotStat>> = {};

    // Initialize maps for all 6 slots
    for (let s = 1; s <= 6; s++) {
        bucketMap[s] = {
            0: { occurrences: 0, wins: 0, winRate: 0 },
            1: { occurrences: 0, wins: 0, winRate: 0 },
            2: { occurrences: 0, wins: 0, winRate: 0 },
        };
        slotMap[s] = { occurrences: 0, wins: 0, winRate: 0 };
    }

    // Accumulate frequency and victory counts
    for (const r of allRaces) {
        if (r.winningSlot === null || r.winningPayout === null) continue;
        const winningSlot = r.winningSlot;

        if (r.venue && !venueMap[r.venue]) {
            venueMap[r.venue] = {};
            for (let s = 1; s <= 6; s++) venueMap[r.venue]![s] = { occurrences: 0, wins: 0, winRate: 0 };
        }
        if (!roundMap[r.raceNumber]) {
            roundMap[r.raceNumber] = {};
            for (let s = 1; s <= 6; s++) roundMap[r.raceNumber]![s] = { occurrences: 0, wins: 0, winRate: 0 };
        }

        for (let s = 1; s <= 6; s++) {
            slotMap[s]!.occurrences++;
            if (s === winningSlot) slotMap[s]!.wins++;

            const payout = r.payouts[s - 1] ?? 0;
            const bucket = getPayoutBucket(payout, s);
            bucketMap[s]![bucket]!.occurrences++;
            if (s === winningSlot) bucketMap[s]![bucket]!.wins++;

            if (r.venue) {
                venueMap[r.venue]![s]!.occurrences++;
                if (s === winningSlot) venueMap[r.venue]![s]!.wins++;
            }
            if (r.raceNumber >= 1 && r.raceNumber <= 3) {
                roundMap[r.raceNumber]![s]!.occurrences++;
                if (s === winningSlot) roundMap[r.raceNumber]![s]!.wins++;
            }
        }
    }

    /**
     * Laplace Smoothing (Additive Smoothing) with Empirical Prior:
     * Formula: (wins + alpha * prior) / (total + alpha)
     * We use a total weight (alpha) of config.priorWeight (default 10.0).
     */
    const smooth = (wins: number, total: number, slot: number) => {
        const prior = config.empiricalWinRates?.[slot] ?? EQUAL_SLOT_PROBABILITY;
        const alpha = config.priorWeight ?? 10.0;
        return (wins + alpha * prior) / (total + alpha);
    };

    for (let s = 1; s <= 6; s++) {
        slotMap[s]!.winRate = smooth(slotMap[s]!.wins, slotMap[s]!.occurrences, s);
        for (let b = 0; b < 3; b++) {
            const bStats = bucketMap[s]![b]!;
            bStats.winRate = smooth(bStats.wins, bStats.occurrences, s);
        }
    }
    for (const v in venueMap) {
        for (let s = 1; s <= 6; s++) {
            const vStats = venueMap[v]![s]!;
            vStats.winRate = smooth(vStats.wins, vStats.occurrences, s);
        }
    }
    for (const rnd in roundMap) {
        for (let s = 1; s <= 6; s++) {
            const rStats = roundMap[rnd]![s]!;
            rStats.winRate = smooth(rStats.wins, rStats.occurrences, s);
        }
    }

    // Calculate momentum bonus from consecutive wins
    let momentumBonus: number | undefined;

    if (allRaces.length > 1) {
        // Count consecutive wins for each slot
        const consecutiveWins: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        const totalWins: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

        for (let i = 1; i < allRaces.length; i++) {
            const prevRace = allRaces[i - 1]!;
            const currRace = allRaces[i]!;

            if (prevRace.winningSlot !== null && currRace.winningSlot !== null) {
                totalWins[prevRace.winningSlot]!++;
                if (prevRace.winningSlot === currRace.winningSlot) {
                    consecutiveWins[prevRace.winningSlot]!++;
                }
            }
        }

        // Calculate momentum bonus as the ratio of consecutive wins to total wins,
        // but only for slots that have enough data
        const minSamples = 10; // Minimum number of samples needed to calculate meaningful momentum
        let validSlots = 0;
        let totalBonus = 0;

        for (let slot = 1; slot <= 6; slot++) {
            if (totalWins[slot]! >= minSamples) {
                const bonus = consecutiveWins[slot]! / totalWins[slot]! - slotMap[slot]!.winRate;
                totalBonus += bonus;
                validSlots++;
            }
        }

        if (validSlots > 0) {
            momentumBonus = totalBonus / validSlots;
        }
    }

    return { bucketMap, slotMap, venueMap, roundMap, lastWinningSlot: allRaces[allRaces.length - 1]?.winningSlot ?? null, momentumBonus };
}

/**
 * Initializes empty statistics for a new session.
 */
export function initializeStats(config: BacktestConfig): StatsResult {
    const bucketMap: Record<number, Record<number, BucketStat>> = {};
    const slotMap: Record<number, SlotStat> = {};

    for (let s = 1; s <= 6; s++) {
        const prior = config.empiricalWinRates?.[s] ?? EQUAL_SLOT_PROBABILITY;
        bucketMap[s] = {
            0: { occurrences: 0, wins: 0, winRate: prior },
            1: { occurrences: 0, wins: 0, winRate: prior },
            2: { occurrences: 0, wins: 0, winRate: prior },
        };
        slotMap[s] = { occurrences: 0, wins: 0, winRate: prior };
    }

    return {
        bucketMap,
        slotMap,
        venueMap: {},
        roundMap: {},
        lastWinningSlot: null,
    };
}

/**
 * Updates an existing StatsResult with a new race outcome.
 * Used during walk-forward testing/deployment.
 */
export function updateStats(stats: StatsResult, r: Race, config: BacktestConfig): StatsResult {
    if (r.winningSlot === null || r.winningPayout === null) return stats;

    const winningSlot = r.winningSlot;
    stats.lastWinningSlot = winningSlot;

    // Lazy initialization for venue/round maps
    if (r.venue && !stats.venueMap[r.venue]) {
        stats.venueMap[r.venue] = {};
        for (let s = 1; s <= 6; s++) {
            const prior = config.empiricalWinRates?.[s] ?? EQUAL_SLOT_PROBABILITY;
            stats.venueMap[r.venue]![s] = { occurrences: 0, wins: 0, winRate: prior };
        }
    }
    if (!stats.roundMap[r.raceNumber]) {
        stats.roundMap[r.raceNumber] = {};
        for (let s = 1; s <= 6; s++) {
            const prior = config.empiricalWinRates?.[s] ?? EQUAL_SLOT_PROBABILITY;
            stats.roundMap[r.raceNumber]![s] = { occurrences: 0, wins: 0, winRate: prior };
        }
    }

    const smooth = (wins: number, total: number, slot: number) => {
        const prior = config.empiricalWinRates?.[slot] ?? EQUAL_SLOT_PROBABILITY;
        const alpha = config.priorWeight ?? 10.0;
        return (wins + alpha * prior) / (total + alpha);
    };

    for (let s = 1; s <= 6; s++) {
        // Update Slot Global Stats
        const sStat = stats.slotMap[s]!;
        sStat.occurrences++;
        if (s === winningSlot) sStat.wins++;
        sStat.winRate = smooth(sStat.wins, sStat.occurrences, s);

        // Update Bucket Stats
        const payout = r.payouts[s - 1] ?? 0;
        const bucket = getPayoutBucket(payout, s);
        const bStat = stats.bucketMap[s]![bucket]!;
        bStat.occurrences++;
        if (s === winningSlot) bStat.wins++;
        bStat.winRate = smooth(bStat.wins, bStat.occurrences, s);

        // Update Venue Stats
        if (r.venue) {
            const vStat = stats.venueMap[r.venue]![s]!;
            vStat.occurrences++;
            if (s === winningSlot) vStat.wins++;
            vStat.winRate = smooth(vStat.wins, vStat.occurrences, s);
        }

        // Update Round Stats
        if (r.raceNumber >= 1 && r.raceNumber <= 3) {
            const rndStat = stats.roundMap[r.raceNumber]![s]!;
            rndStat.occurrences++;
            if (s === winningSlot) rndStat.wins++;
            rndStat.winRate = smooth(rndStat.wins, rndStat.occurrences, s);
        }
    }

    return stats;
}

export function formatCurrency(value: number): string {
    return value.toFixed(2);
}

export function formatPercent(value: number): string {
    return (value * 100).toFixed(2) + "%";
}

/**
 * Derives historical win rates from a dataset to populate the config.
 */
export function calculateEmpiricalWinRates(races: Race[]): Record<number, number> {
    const counts: Record<number, { wins: number; total: number }> = {};
    for (let s = 1; s <= 6; s++) counts[s] = { wins: 0, total: 0 };

    for (const r of races) {
        if (r.winningSlot === null) continue;
        for (let s = 1; s <= 6; s++) {
            counts[s]!.total++;
            if (s === r.winningSlot) counts[s]!.wins++;
        }
    }

    const rates: Record<number, number> = {};
    for (let s = 1; s <= 6; s++) {
        const { wins, total } = counts[s]!;
        // Use a tiny amount of smoothing to avoid 0%
        rates[s] = total > 0 ? (wins + 0.1) / (total + 0.6) : EQUAL_SLOT_PROBABILITY;
    }
    return rates;
}
