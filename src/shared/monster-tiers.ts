import type { ContextStatsResult } from "./context-types";
import type { SlotStat } from "./types";

/** ROADMAP §2 criteria — thresholds only, not monster names. */
export interface MonsterTierThresholds {
    /** Minimum slot appearances before a monster is tier-classified. */
    minAppearances?: number;
    /** Raw win rate below this → near-zero tier (exclusive of avoid). */
    nearZeroRate?: number;
    /** Raw win rate above this → premium tier (informational). */
    premiumRate?: number;
    /** Cap blended win rate for near-zero monsters. */
    nearZeroCap?: number;
    /** Monster×slot wins required to bet an avoid-tier monster anyway. */
    avoidSlotWinsOverride?: number;
}

export const DEFAULT_MONSTER_TIER_THRESHOLDS: Required<MonsterTierThresholds> = {
    minAppearances: 10,
    nearZeroRate: 0.1,
    premiumRate: 0.25,
    nearZeroCap: 0.12,
    avoidSlotWinsOverride: 3,
};

export interface MonsterTiers {
    avoid: Set<string>;
    nearZero: Set<string>;
    premium: Set<string>;
}

function resolveThresholds(thresholds?: MonsterTierThresholds): Required<MonsterTierThresholds> {
    return { ...DEFAULT_MONSTER_TIER_THRESHOLDS, ...thresholds };
}

/**
 * Classifies monsters from global appearance/win counts (raw rates, not Laplace-smoothed).
 */
export function computeMonsterTiers(globalMonsterMap: Record<string, SlotStat>, thresholds?: MonsterTierThresholds): MonsterTiers {
    const t = resolveThresholds(thresholds);
    const avoid = new Set<string>();
    const nearZero = new Set<string>();
    const premium = new Set<string>();

    for (const [monster, stat] of Object.entries(globalMonsterMap)) {
        if (monster === "Human") continue;
        if (stat.occurrences < t.minAppearances) continue;

        const rawRate = stat.wins / stat.occurrences;
        if (stat.wins === 0) {
            avoid.add(monster);
        } else if (rawRate < t.nearZeroRate) {
            nearZero.add(monster);
        } else if (rawRate > t.premiumRate) {
            premium.add(monster);
        }
    }

    return { avoid, nearZero, premium };
}

export function computeMonsterTiersFromStats(stats: ContextStatsResult, thresholds?: MonsterTierThresholds): MonsterTiers {
    return computeMonsterTiers(stats.globalMonsterMap, thresholds);
}

export interface TierAdjustResult {
    winRate: number;
    excluded: boolean;
}

/**
 * Applies monster tier caps and exclusions after contextual blending.
 * Avoid-tier monsters are excluded unless monster×slot has enough wins in history.
 */
export function applyMonsterTierAdjust(monster: string, winRate: number, monsterSlotWins: number, tiers: MonsterTiers, thresholds?: MonsterTierThresholds): TierAdjustResult {
    const t = resolveThresholds(thresholds);

    if (tiers.avoid.has(monster) && monsterSlotWins < t.avoidSlotWinsOverride) {
        return { winRate: 0, excluded: true };
    }
    if (tiers.nearZero.has(monster)) {
        return { winRate: Math.min(winRate, t.nearZeroCap), excluded: false };
    }
    return { winRate, excluded: false };
}

export function monsterDisplayName(players: (string | null)[] | undefined, slotIndex: number): string {
    const p = players?.[slotIndex];
    return p && p.trim() ? p.trim() : "Human";
}
