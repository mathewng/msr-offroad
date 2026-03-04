import type { BucketStat, Race, RaceTime, SlotStat, StatsResult, BacktestConfig } from "./types";

export const EQUAL_SLOT_PROBABILITY = 1 / 6;

/**
 * Formats a date string from the data file (e.g. "Friday, 30 January 2026") to "Fri, 30 Jan".
 * Returns the original string if parsing fails.
 */
export function formatRaceDate(dateStr: string): string {
    const trimmed = dateStr.trim();
    if (!trimmed) return trimmed;
    // Strip leading "Weekday, " so we can parse "30 January 2026"
    const withoutWeekday = trimmed.replace(/^[^,]+,?\s*/i, "").trim();
    const d = new Date(withoutWeekday);
    if (Number.isNaN(d.getTime())) return trimmed;
    const weekday = d.toLocaleDateString("en-GB", { weekday: "short" });
    const day = d.getDate();
    const month = d.toLocaleDateString("en-GB", { month: "short" });
    return `${weekday}, ${day} ${month}`;
}

/** Index of max value in array (0-based). Ties break to first. */
export function argMax(arr: number[]): number {
    let best = 0;
    for (let i = 1; i < arr.length; i++) {
        if (arr[i]! > arr[best]!) best = i;
    }
    return best;
}

/**
 * Parses raw lines from a data file into an array of Race objects.
 *
 * Supports two formats:
 *
 * New format (with optional header row):
 * - Tab-separated. Columns: Date, Time, Venue, Round, Payout1..Payout6, Player1..Player6, Win1..Win6.
 * - Win1-Win6: "1" = slot won, blank = didn't win, "?" = no data.
 * - Player1-Player6: blank = random human, non-blank = monster name.
 *
 * Legacy format (no header):
 * - Columns: Venue, Time, Round, W1..W6, Empty, P1..P6. W1-W6 = win (1/0), P1-P6 = payouts.
 */
export function parseLines(lines: string[]): Race[] {
    let currentDay = 1;
    let lastVenue = "?";
    let lastTime: RaceTime = "12:00";
    const races: Race[] = [];

    const winIndicators = new Array(6);
    const payouts = new Array(6);

    for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split("\t");

        // Skip header row (new format)
        if (parts[0]?.trim() === "Date" && parts[2]?.trim() === "Venue") continue;

        // New format: Date, Time, Venue, Round, Payout1-6, Player1-6, Win1-6 (22 columns)
        if (parts.length >= 22) {
            const venueStr = parts[2]?.trim();
            const timeStr = parts[1]?.trim();
            const roundStr = parts[3]?.trim();
            const roundNum = parseInt(roundStr || "", 10);
            if (isNaN(roundNum)) continue;

            const venue = venueStr || lastVenue || "?";
            if (venueStr) lastVenue = venue;
            if (timeStr) {
                const normalizedTime = timeStr as RaceTime;
                if ((lastTime === "18:00" || lastTime === "6pm") && (normalizedTime === "12:00" || normalizedTime === "12pm")) {
                    currentDay++;
                }
                lastTime = normalizedTime;
            }

            for (let i = 0; i < 6; i++) {
                const payPart = parts[4 + i]?.trim();
                const playerPart = parts[10 + i]?.trim();
                const winPart = parts[16 + i]?.trim();
                payouts[i] = payPart === "?" ? NaN : parseFloat(payPart || "0");
                winIndicators[i] = winPart === "?" ? NaN : winPart === "1" ? 1 : 0;
            }

            const winningIndex = winIndicators.findIndex((n) => n === 1);
            const winningSlot = winningIndex !== -1 ? winningIndex + 1 : null;
            const winningPayout = winningIndex !== -1 ? payouts[winningIndex] : null;

            const players: (string | null)[] = [];
            for (let i = 0; i < 6; i++) {
                const p = parts[10 + i]?.trim();
                players.push(!p ? null : p); // blank = random human (null), else monster name
            }

            const rawDate = parts[0]?.trim();
            races.push({
                day: currentDay,
                date: rawDate ? formatRaceDate(rawDate) : undefined,
                venue: lastVenue,
                time: lastTime,
                raceNumber: roundNum,
                payouts: [...payouts],
                bets: [],
                winningSlot,
                winningPayout: winningPayout != null && !isNaN(winningPayout) ? winningPayout : null,
                players,
            });
            continue;
        }

        // Legacy format: Venue, Time, Round, W1-W6, Empty, P1-P6 (13+ columns)
        if (parts.length >= 13 && parts[2]?.trim()) {
            const venue = parts[0]?.trim() ?? lastVenue ?? "?";
            const timeStr = parts[1]?.trim();
            const roundStr = parts[2]?.trim();
            const roundNum = parseInt(roundStr || "", 10);
            if (isNaN(roundNum)) continue;

            if (venue) lastVenue = venue;
            if (timeStr) {
                const normalizedTime = timeStr as RaceTime;
                if ((lastTime === "18:00" || lastTime === "6pm") && (normalizedTime === "12:00" || normalizedTime === "12pm")) {
                    currentDay++;
                }
                lastTime = normalizedTime;
            }

            for (let i = 0; i < 6; i++) {
                const winPart = parts[3 + i]?.trim();
                const payPart = parts[10 + i]?.trim();
                winIndicators[i] = winPart === "?" ? NaN : parseInt(winPart || "0", 10);
                payouts[i] = payPart === "?" ? NaN : parseFloat(payPart || "0");
            }

            const winningIndex = winIndicators.findIndex((n) => n === 1);
            const winningSlot = winningIndex !== -1 ? winningIndex + 1 : null;
            const winningPayout = winningIndex !== -1 ? payouts[winningIndex] : null;

            races.push({
                day: currentDay,
                venue: lastVenue,
                time: lastTime,
                raceNumber: roundNum,
                payouts: [...payouts],
                bets: [],
                winningSlot,
                winningPayout: winningPayout != null && !isNaN(winningPayout) ? winningPayout : null,
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
export function getPayoutBucket(payout: number): number {
    // These thresholds (5,8) are derived from empirical analysis of the historical
    // dataset to categorize payouts into roughly equal-frequency buckets:
    // Bucket 0 (<= 5): Favored / Strong lane
    // Bucket 1 (5 - 8): Neutral / Mid-range
    // Bucket 2 (> 8): Longshot / Weak lane
    const [low, high] = [5, 8];

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
            const bucket = getPayoutBucket(payout);
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

    return { bucketMap, slotMap, venueMap, roundMap };
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
    };
}

/**
 * Updates an existing StatsResult with a new race outcome.
 * Used during walk-forward testing/deployment.
 */
export function updateStats(stats: StatsResult, r: Race, config: BacktestConfig): StatsResult {
    if (r.winningSlot === null || r.winningPayout === null) return stats;

    const winningSlot = r.winningSlot;

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
        const bucket = getPayoutBucket(payout);
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
