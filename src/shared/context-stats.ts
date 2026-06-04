import type { ContextConfig, ContextStatsResult } from "./context-types";
import type { BacktestConfig, Race, SlotStat } from "./types";
import { calculateStats, EQUAL_SLOT_PROBABILITY, updateStats } from "./utils";
import { monsterDisplayName } from "./monster-tiers";

function emptySlotStat(prior: number): SlotStat {
    return { occurrences: 0, wins: 0, winRate: prior, totalPayout: 0, avgPayout: 6.0 };
}

function ensureMonsterSlot(map: Record<string, Record<number, SlotStat>>, monster: string, slot: number, prior: number): SlotStat {
    if (!map[monster]) {
        map[monster] = {};
        for (let s = 1; s <= 6; s++) map[monster]![s] = emptySlotStat(prior);
    }
    return map[monster]![slot]!;
}

function ensureMonsterVenueSlot(map: Record<string, Record<string, Record<number, SlotStat>>>, monster: string, venue: string, slot: number, prior: number): SlotStat {
    if (!map[monster]) map[monster] = {};
    if (!map[monster]![venue]) {
        map[monster]![venue] = {};
        for (let s = 1; s <= 6; s++) map[monster]![venue]![s] = emptySlotStat(prior);
    }
    return map[monster]![venue]![slot]!;
}

function smooth(wins: number, total: number, slot: number, config: ContextConfig | BacktestConfig): number {
    const prior = config.empiricalWinRates?.[slot] ?? EQUAL_SLOT_PROBABILITY;
    const alpha = config.priorWeight ?? 10.0;
    return (wins + alpha * prior) / (total + alpha);
}

function smoothAllMonsterMaps(stats: ContextStatsResult, config: ContextConfig | BacktestConfig): void {
    for (const monster in stats.monsterSlotMap) {
        for (let s = 1; s <= 6; s++) {
            const st = stats.monsterSlotMap[monster]![s]!;
            st.winRate = smooth(st.wins, st.occurrences, s, config);
        }
    }
    for (const monster in stats.monsterVenueSlotMap) {
        for (const venue in stats.monsterVenueSlotMap[monster]) {
            for (let s = 1; s <= 6; s++) {
                const st = stats.monsterVenueSlotMap[monster]![venue]![s]!;
                st.winRate = smooth(st.wins, st.occurrences, s, config);
            }
        }
    }
    for (const monster in stats.globalMonsterMap) {
        const st = stats.globalMonsterMap[monster]!;
        st.winRate = smooth(st.wins, st.occurrences, 1, config);
    }
}

/**
 * Builds context stats from historical races: base StatsResult plus monster lookup tables.
 */
export function calculateContextStats(allRaces: Race[], config: ContextConfig | BacktestConfig): ContextStatsResult {
    const base = calculateStats(
        allRaces.filter((r) => r.winningSlot !== null && r.winningPayout !== null),
        config as BacktestConfig,
    );

    const monsterSlotMap: ContextStatsResult["monsterSlotMap"] = {};
    const monsterVenueSlotMap: ContextStatsResult["monsterVenueSlotMap"] = {};
    const globalMonsterMap: ContextStatsResult["globalMonsterMap"] = {};
    const venueRaceCounts: Record<string, number> = {};

    for (const r of allRaces) {
        if (r.winningSlot === null || r.winningPayout === null) continue;
        const venue = r.venue ?? "Unknown";
        venueRaceCounts[venue] = (venueRaceCounts[venue] ?? 0) + 1;

        for (let s = 1; s <= 6; s++) {
            const monster = monsterDisplayName(r.players, s - 1);
            const prior = config.empiricalWinRates?.[s] ?? EQUAL_SLOT_PROBABILITY;
            const won = s === r.winningSlot;

            const ms = ensureMonsterSlot(monsterSlotMap, monster, s, prior);
            ms.occurrences++;
            if (won) {
                ms.wins++;
                ms.totalPayout += r.winningPayout;
            }

            const mvs = ensureMonsterVenueSlot(monsterVenueSlotMap, monster, venue, s, prior);
            mvs.occurrences++;
            if (won) {
                mvs.wins++;
                mvs.totalPayout += r.winningPayout;
            }

            if (!globalMonsterMap[monster]) {
                globalMonsterMap[monster] = emptySlotStat(prior);
            }
            const gm = globalMonsterMap[monster]!;
            gm.occurrences++;
            if (won) {
                gm.wins++;
                gm.totalPayout += r.winningPayout;
            }
        }
    }

    const stats: ContextStatsResult = {
        ...base,
        monsterSlotMap,
        monsterVenueSlotMap,
        globalMonsterMap,
        venueRaceCounts,
    };
    smoothAllMonsterMaps(stats, config);
    return stats;
}

/**
 * Incrementally updates context stats after a resolved race (walk-forward).
 */
export function updateContextStats(stats: ContextStatsResult, r: Race, config: ContextConfig | BacktestConfig): void {
    updateStats(stats, r, config as BacktestConfig);

    if (r.winningSlot === null || r.winningPayout === null) return;

    const venue = r.venue ?? "Unknown";
    stats.venueRaceCounts[venue] = (stats.venueRaceCounts[venue] ?? 0) + 1;
    const winningSlot = r.winningSlot;

    for (let s = 1; s <= 6; s++) {
        const monster = monsterDisplayName(r.players, s - 1);
        const prior = config.empiricalWinRates?.[s] ?? EQUAL_SLOT_PROBABILITY;
        const won = s === winningSlot;

        const ms = ensureMonsterSlot(stats.monsterSlotMap, monster, s, prior);
        ms.occurrences++;
        if (won) {
            ms.wins++;
            ms.totalPayout += r.winningPayout;
        }
        ms.winRate = smooth(ms.wins, ms.occurrences, s, config);

        const mvs = ensureMonsterVenueSlot(stats.monsterVenueSlotMap, monster, venue, s, prior);
        mvs.occurrences++;
        if (won) {
            mvs.wins++;
            mvs.totalPayout += r.winningPayout;
        }
        mvs.winRate = smooth(mvs.wins, mvs.occurrences, s, config);

        if (!stats.globalMonsterMap[monster]) {
            stats.globalMonsterMap[monster] = emptySlotStat(prior);
        }
        const gm = stats.globalMonsterMap[monster]!;
        gm.occurrences++;
        if (won) {
            gm.wins++;
            gm.totalPayout += r.winningPayout;
        }
        gm.winRate = smooth(gm.wins, gm.occurrences, s, config);
    }
}
