import type { MonsterTierThresholds } from "./monster-tiers";
import type { BacktestConfig, SlotStat, StatsResult } from "./types";

/**
 * Extended statistics for the Context EV Predictor.
 * Includes base StatsResult plus monster-in-slot lookup tables.
 */
export interface ContextStatsResult extends StatsResult {
    /** Win rate per monster per slot (1-6). */
    monsterSlotMap: Record<string, Record<number, SlotStat>>;
    /** Win rate per monster per venue per slot. */
    monsterVenueSlotMap: Record<string, Record<string, Record<number, SlotStat>>>;
    /** Global win rate per monster (all slots). */
    globalMonsterMap: Record<string, SlotStat>;
    /** Race count per venue (for sparse-venue handling). */
    venueRaceCounts: Record<string, number>;
}

/** Configuration for context-based prediction (subset of BacktestConfig + context gates). */
export interface ContextConfig {
    betLimit: number;
    minScoreThreshold: number;
    relativeThreshold?: number;
    empiricalWinRates?: Record<number, number>;
    priorWeight?: number;
    /** Minimum occurrences for venue×round lookup before falling back. */
    minContextSamples?: number;
    /** Minimum occurrences for monster×venue×slot lookup. */
    minMonsterVenueSlotSamples?: number;
    /** Minimum occurrences for monster×slot lookup. */
    minMonsterSlotSamples?: number;
    /** Minimum occurrences for global monster rate. */
    minGlobalMonsterSamples?: number;
    /** Venues with fewer races use heavier fallback (e.g. Lith Harbour). */
    sparseVenueRaceThreshold?: number;
    /** When true, prediction returns per-slot diagnostic detail. */
    verbose?: boolean;
    /** Thresholds for data-driven avoid / near-zero / premium tier lists. */
    monsterTierThresholds?: MonsterTierThresholds;
}

export function contextConfigFromBacktest(config: BacktestConfig): ContextConfig {
    return {
        betLimit: config.betLimit,
        minScoreThreshold: config.minScoreThreshold,
        relativeThreshold: config.relativeThreshold,
        empiricalWinRates: config.empiricalWinRates,
        priorWeight: config.priorWeight,
    };
}

export type MonsterLookupSource = "monsterVenueSlot" | "monsterSlot" | "globalMonster" | "none";

export interface SlotContextDiagnostic {
    slot: number;
    monster: string;
    contextRate: number;
    contextSource: string;
    monsterRate: number | null;
    monsterSource: MonsterLookupSource;
    monsterOccurrences: number;
    blendedWinRate: number;
    payout: number;
    ev: number;
    excludedByTier: boolean;
}

export interface ContextPredictionResult {
    bets: number[];
    score: number;
    candidates: { slot: number; score: number; winRate: number }[];
    diagnostics?: SlotContextDiagnostic[];
}
