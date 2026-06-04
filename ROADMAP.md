# ROADMAP

Analysis-driven modeling roadmap for MSR offroad race prediction.

| Item | Value |
| ---- | ----- |
| Data | 753 races in `data_all.txt` (729 historical + 24 current) |
| Analysis | 2026-06-04 (`analyze_*.py`, `investigate-factors.ts`) |
| Primary engine | **CEVP** — Context EV Predictor (`src/core/context-engine.ts`) |
| Validation | 2026-06-04 — see [Engine validation](#engine-validation) |

---

## Engine validation

Walk-forward backtests are the arbiter for ROI. Holdout (`data_historical` → train, `data_current` → score) is a small-sample sanity check only.

### Holdout: historical + current

History: 729 resolved races. Target: 24 races (21 resolved, 3 pending).

| Engine | ROI | Profit | Accuracy | Bets |
| ------ | --- | ------ | -------- | ---- |
| **CEVP** (default, 2 bets) | **155.26%** | 59.00 | 61.90% | 38 |
| CEVP (`--conservative`) | 104.76% | 22.00 | 23.81% | 21 |
| GBT | 128.57% | 54.00 | 52.38% | 42 |
| HMM yield | 81.82% | 36.00 | 47.62% | 44 |

### Walk-forward: `data_all.txt` (90% train / 10% test)

| Config | ROI | Profit | Accuracy | Bets |
| ------ | --- | ------ | -------- | ---- |
| CEVP default | **40.98%** | 50.00 | 37.14% | 122 |

```bash
bun run backtest:context                    # holdout, default
./context_backtest.sh                       # holdout default + conservative
bun src/backtest/backtest-context.ts --file data_all.txt   # walk-forward
bun run predict                             # score pending races in data_current.txt
```

See also `CONTEXT_VALIDATION.md` for command reference.

### CEVP algorithm (summary)

Per slot: hierarchical **venue×round×slot** win rate → blend with **monster×venue×slot** (fallback: monster×slot → global monster) → **data-driven monster tiers** (avoid / near-zero cap) → `EV = winRate × payout − 1` → bet top slots passing `minScoreThreshold`, `relativeThreshold`, and `betLimit`. No HMM. Sparse venues (`venueRaceCounts` < 20) skip venue×round tier.

---

## Completed

| Item | Implementation |
| ---- | -------------- |
| Venue×round×slot context | `resolveContextRate()` in `context-engine.ts`; `venueRoundMap` in `utils.ts` |
| Monster×slot / monster×venue×slot | `resolveMonsterRate()`; maps in `context-stats.ts` |
| Monster tiers (avoid / near-zero / premium) | `monster-tiers.ts` — thresholds from global stats, not hardcoded names |
| Walk-forward context backtest | `backtest-context.ts` |
| Live prediction CLI | `predict-race.ts` |
| GBT venue×round features | `features.ts` (`venueRoundWinRate`, etc.) — used by GBT, not CEVP |

---

## Improvement priorities

Ranked by expected impact on **walk-forward ROI** (not holdout headline).

### P0 — Bet selectivity and calibration

**Problem**: Default config (`CONFIG_CONTEXT`) uses `minScoreThreshold: 0`, `relativeThreshold: 0`, `betLimit: 2` — any positive EV can be bet. Raw odds analysis (`analyze-data.ts`) shows negative ROI at low odds (2–3, 5–7) and positive at 8–9; the model does not gate on price beyond the EV formula.

**Actions**:

- Grid-search on walk-forward: `minScoreThreshold`, `relativeThreshold`, `betLimit`, `priorWeight`, sample minimums.
- Add optional **odds floor** (e.g. skip slots with `payout < 8` unless EV exceeds a higher bar).
- **Slot-aware gates** — stricter EV for S5/S6 longshots; S1+S2 carry ~50% of wins at most venues.
- Extend `optimizer.ts` (today HMM-only) or add `optimize-context.ts` targeting `--file data_all.txt`.

### P1 — Venue × time context

**Signal**: Avg IV ≈ 0.152 (medium); not used in CEVP today.

**Action**: Add `venueTimeMap` (or equivalent) with the same fallback hierarchy as venue×round; validate in walk-forward before holdout tuning.

### P1 — CEVP × GBT agreement filter

**Rationale**: GBT is second on holdout; use disagreement to skip races or require dual confirmation for the second bet.

**Action**: Experiment in backtest only — bet when both engines rank a slot in top-N or EV > threshold.

### P2 — Within-session sequence features

**Signal**: Descriptive R2→R3 patterns (e.g. S4→S1 at 44.4%); **not** significant on permutation / χ² tests globally.

**Action**: Optional `prevRoundWinner` feature — adopt only if walk-forward ROI improves. Do not build venue-specific HMMs without the same proof.

### Deprioritized / do not pursue without new evidence

| Idea | Why |
| ---- | --- |
| Per-venue HMM | Sequential tests: no significant per-venue Markov structure |
| Payout rank / favorite flags | IV ≈ 0; noise |
| Chasing holdout ROI alone | ~21 resolved target races; walk-forward ~41% is the honest benchmark |

---

## Factor analysis reference

753 races, 7 venues, 3 rounds, 2 time slots. Lith Harbour n=6 — treat as noise until more data.

### Factor power (average IV)

| Factor | Avg IV | Signal | Notes |
| ------ | ------ | ------ | ----- |
| Venue × Round | 0.256 | MEDIUM | **In CEVP** |
| Monster in Slot | 0.237 | MEDIUM | **In CEVP** |
| Venue × Time | 0.152 | MEDIUM | Not in CEVP |
| Venue × Payout Rank | 0.129 | MEDIUM | GBT only; weak globally |
| Venue alone | 0.071 | weak | Fallback tier in CEVP |
| Payout value / spread / rank / time / favorite | < 0.05 | weak | Keep raw `payout` for EV only |

**Takeaway**: Context (where + round + slot) and monster-in-slot dominate. Payout-derived ranks are noise except raw payout in the EV term.

### Cross-venue slot win rates (%)

| Venue | S1 | S2 | S3 | S4 | S5 | S6 |
| ----- | -- | -- | -- | -- | -- | -- |
| Aqua Road | 25.4 | 26.2 | 15.1 | 19.8 | 10.3 | 3.2 |
| Cactus Desert | 25.0 | 21.7 | 11.7 | 15.0 | 23.3 | 3.3 |
| Deep Sea World | 25.8 | 24.7 | 12.4 | 14.0 | 15.6 | 7.5 |
| Leafre | 33.3 | 18.9 | 15.6 | 12.2 | 14.4 | 5.6 |
| Ludibrium | 24.0 | 32.8 | 10.9 | 8.7 | 16.9 | 6.6 |
| Minar Forest | 26.2 | 22.6 | 11.9 | 15.5 | 19.0 | 4.8 |
| Lith Harbour | 16.7 | 0.0 | 0.0 | 50.0 | 33.3 | 0.0 |

S1+S2 ≈ 50% combined at most venues. S6 best case Deep Sea World 7.5%.

### Venue × round sweet spots (lift vs baseline)

| Slot | Best (venue, round) | Rate | Lift | Worst | Rate |
| ---- | ------------------- | ---- | ---- | ----- | ---- |
| S1 | Leafre R2 | 35.5% | 1.39× | Cactus R2 | 14.3% |
| S2 | Ludibrium R3 | 42.6% | 1.71× | Leafre R2 | 9.7% |
| S3 | Aqua Road R2 | 25.6% | 2.07× | Cactus R1 | 4.8% |
| S4 | Deep Sea R2 | 23.1% | 1.69× | Deep Sea R3 | 3.1% |
| S5 | Cactus R1/R2 | 28.6% | 1.82× | Leafre R1 | 6.5% |
| S6 | Ludibrium R1 | 13.1% | 2.41× | Cactus R3 | 0.0% |

### Monster context (IV)

| Interaction | IV | In CEVP |
| ----------- | -- | ------- |
| Monster alone | 0.124 | weak — global tier only |
| Monster × Slot | 0.448 | yes |
| Monster × Venue × Slot | 0.524 | yes |
| Venue × Round × Slot (no monster) | 0.531 | yes |

**Tier rules** (`monster-tiers.ts`): avoid = 0 wins and ≥10 appearances (exclude unless ≥3 wins in that slot); near-zero = raw rate <10% (cap blended rate at 12%); premium = >25% (informational).

**Examples** (≥3 races): Griffey @ Minar S5 75%; Krappy @ Aqua S1 75%; King Bloctopus @ Ludibrium S1 60%.

**High slot variability** (>20pp spread): Krappy, Griffey, Risell Squid, Death Teddy, Squid, Bombing Fish House — always use slot+venue, never monster alone.

### Raw odds ROI (`analyze-data.ts`, floor odds, n≥100)

| Odds | Win% | Naive ROI |
| ---- | ---- | --------- |
| 2 | 24.8% | −50.4% |
| 3 | 28.3% | −15.0% |
| 4 | 25.5% | +1.8% |
| 8 | 13.9% | +11.0% |
| 9 | 14.7% | +32.1% |

Informs P0 odds-floor experiments; CEVP must beat “bet everything at 9×.”

---

## Sequential dependency (reference)

| Test | Result |
| ---- | ------ |
| Global χ² | p=0.88 — not significant |
| Permutation (info gain) | p=0.36 — not significant |
| Per-venue permutation | None significant at α=0.05 |
| Pseudo-R² (entropy) | 3.0% globally |

Entropy-based venue R² (e.g. Minar 14.3%) is **descriptive only** — validate any HMM or sequence feature in walk-forward before shipping.

Noteworthy descriptive patterns: S4→S1 (38.2%, 1.50×); R2→R3 S4→S1 44.4%. Round number alone is not chi-square significant (`investigate-factors.ts`).

---

## Verification

Re-run after data updates:

```bash
# Python — factor & sequence analysis
python3 analyze_all_slots.py
python3 analyze_monsters.py
python3 analyze_sequences.py
python3 analyze_sequential_signal.py

# TypeScript — EV & factors
bun src/cli/analyze-data.ts
bun src/cli/investigate-factors.ts

# Backtests (ROI arbiter)
bun run backtest:context
bun src/backtest/backtest-context.ts --file data_all.txt
./backtest.sh          # HMM strategies
./gbt_backtest.sh      # GBT
```

---

## Analysis scripts

| Script | Purpose |
| ------ | ------- |
| `analyze_all_slots.py` | Factor IV ranking, slots 1–6 |
| `analyze_slot5.py` | Slot 5 deep dive |
| `analyze_monsters.py` | Monster × slot × venue |
| `analyze_sequences.py` | Markov, streaks, within-session |
| `analyze_sequential_signal.py` | χ², permutation, binomial |
| `src/cli/analyze-data.ts` | EV by odds floor; venue bias |
| `src/cli/analyze-rounds.ts` | Round win rates, CIs |
| `src/cli/analyze-venues.ts` | Venue session / slot EV |
| `src/cli/investigate-factors.ts` | Chi-square vs engine usage |
| `src/backtest/backtest-context.ts` | CEVP walk-forward |
| `src/cli/predict-race.ts` | Forward predictions |

---

## Code map

| Path | Role |
| ---- | ---- |
| `src/core/context-engine.ts` | CEVP prediction |
| `src/shared/context-stats.ts` | Walk-forward stat build/update |
| `src/shared/monster-tiers.ts` | Tier classification & caps |
| `src/shared/config.ts` | `CONFIG_CONTEXT`, `CONFIG_CONTEXT_CONSERVATIVE` |
| `src/core/prediction-engine.ts` | HMM + historical EV (legacy compare) |
| `src/core/gbt-engine.ts` | GBT ensemble |
