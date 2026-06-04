import type { ContextConfig, ContextPredictionResult, ContextStatsResult, MonsterLookupSource, SlotContextDiagnostic } from "../shared/context-types";
import { applyMonsterTierAdjust, computeMonsterTiersFromStats, monsterDisplayName } from "../shared/monster-tiers";
import type { Race, SlotStat } from "../shared/types";
import { EQUAL_SLOT_PROBABILITY } from "../shared/utils";

const DEFAULT_MIN_CONTEXT = 5;
const DEFAULT_MIN_MVS = 3;
const DEFAULT_MIN_MS = 5;
const DEFAULT_MIN_GLOBAL = 10;
const DEFAULT_SPARSE_VENUE = 20;

function resolveContextRate(stats: ContextStatsResult, race: Race, slot: number, config: ContextConfig): { rate: number; source: string } {
    const prior = config.empiricalWinRates?.[slot] ?? EQUAL_SLOT_PROBABILITY;
    const minCtx = config.minContextSamples ?? DEFAULT_MIN_CONTEXT;
    const sparseThreshold = config.sparseVenueRaceThreshold ?? DEFAULT_SPARSE_VENUE;
    const venue = race.venue ?? "Unknown";
    const round = race.raceNumber;
    const venueRaces = stats.venueRaceCounts[venue] ?? 0;
    const isSparseVenue = venueRaces < sparseThreshold;

    const pick = (st: SlotStat | undefined, label: string, minOcc: number): { rate: number; source: string } | null => {
        if (st && st.occurrences >= minOcc) {
            return { rate: st.winRate, source: label };
        }
        return null;
    };

    if (!isSparseVenue) {
        const vr = stats.venueRoundMap[venue]?.[round]?.[slot];
        const hit = pick(vr, "venueRound", minCtx);
        if (hit) return hit;
    }

    const v = stats.venueMap[venue]?.[slot];
    const vHit = pick(v, "venue", minCtx);
    if (vHit) return vHit;

    const rnd = stats.roundMap[round]?.[slot];
    const rHit = pick(rnd, "round", minCtx);
    if (rHit) return rHit;

    const slotStat = stats.slotMap[slot];
    const sHit = pick(slotStat, "slot", 1);
    if (sHit) return sHit;

    return { rate: prior, source: "empiricalPrior" };
}

function resolveMonsterRate(stats: ContextStatsResult, race: Race, slot: number, monster: string, config: ContextConfig): { rate: number; occurrences: number; source: MonsterLookupSource } | null {
    const venue = race.venue ?? "Unknown";
    const minMvs = config.minMonsterVenueSlotSamples ?? DEFAULT_MIN_MVS;
    const minMs = config.minMonsterSlotSamples ?? DEFAULT_MIN_MS;
    const minGlobal = config.minGlobalMonsterSamples ?? DEFAULT_MIN_GLOBAL;

    const mvs = stats.monsterVenueSlotMap[monster]?.[venue]?.[slot];
    if (mvs && mvs.occurrences >= minMvs) {
        return { rate: mvs.winRate, occurrences: mvs.occurrences, source: "monsterVenueSlot" };
    }

    const ms = stats.monsterSlotMap[monster]?.[slot];
    if (ms && ms.occurrences >= minMs) {
        return { rate: ms.winRate, occurrences: ms.occurrences, source: "monsterSlot" };
    }

    const gm = stats.globalMonsterMap[monster];
    if (gm && gm.occurrences >= minGlobal) {
        return { rate: gm.winRate, occurrences: gm.occurrences, source: "globalMonster" };
    }

    return null;
}

function blendRates(contextRate: number, monster: { rate: number; occurrences: number } | null): number {
    if (!monster) return contextRate;
    const w = Math.min(1, monster.occurrences / 10);
    return contextRate * (1 - w) + monster.rate * w;
}

/**
 * Context EV Predictor: scores each slot from venue×round context and monster-in-slot stats.
 */
export function predictContextRace(race: Race, stats: ContextStatsResult, config: ContextConfig): ContextPredictionResult {
    const candidates: { slot: number; score: number; winRate: number }[] = [];
    const diagnostics: SlotContextDiagnostic[] = [];
    const tiers = computeMonsterTiersFromStats(stats, config.monsterTierThresholds);

    for (let s = 0; s < 6; s++) {
        const slot = s + 1;
        const payout = race.payouts[s] ?? 0;
        const monster = monsterDisplayName(race.players, s);

        const { rate: contextRate, source: contextSource } = resolveContextRate(stats, race, slot, config);
        const monsterLookup = resolveMonsterRate(stats, race, slot, monster, config);
        let winRate = blendRates(contextRate, monsterLookup);

        const msWins = stats.monsterSlotMap[monster]?.[slot]?.wins ?? 0;
        const tier = applyMonsterTierAdjust(monster, winRate, msWins, tiers, config.monsterTierThresholds);
        winRate = tier.winRate;

        const ev = tier.excluded ? -Infinity : winRate * payout - 1;
        if (!tier.excluded) {
            candidates.push({ slot, score: ev, winRate });
        }

        if (config.verbose) {
            diagnostics.push({
                slot,
                monster,
                contextRate,
                contextSource,
                monsterRate: monsterLookup?.rate ?? null,
                monsterSource: monsterLookup?.source ?? "none",
                monsterOccurrences: monsterLookup?.occurrences ?? 0,
                blendedWinRate: winRate,
                payout,
                ev: tier.excluded ? -Infinity : ev,
                excludedByTier: tier.excluded,
            });
        }
    }

    candidates.sort((a, b) => b.score - a.score);
    const avgScore = candidates.length > 0 ? candidates.reduce((acc, c) => acc + c.score, 0) / candidates.length : 0;

    const bets = candidates
        .filter((c) => {
            const aboveThreshold = c.score > config.minScoreThreshold;
            const hasEdge = c.score - avgScore > (config.relativeThreshold ?? 0);
            return aboveThreshold && hasEdge;
        })
        .slice(0, config.betLimit)
        .map((c) => c.slot);

    return {
        bets,
        score: candidates[0]?.score ?? 0,
        candidates,
        diagnostics: config.verbose ? diagnostics : undefined,
    };
}
