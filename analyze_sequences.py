#!/usr/bin/env python3
"""Analyse sequential dependencies between race victories."""
import csv
import math
from collections import defaultdict

data = open('data_all.txt').read().strip().split('\n')
reader = csv.DictReader(data, delimiter='\t')
rows = list(reader)
N = len(rows)

# Parse all winning slots in order
winners = []
for r in rows:
    found = False
    for s in range(1, 7):
        if r[f'Win{s}'] == '1':
            winners.append(s)
            found = True
            break
    if not found:
        winners.append(0)  # placeholder for races with no clear winner

M = len(winners)
base_rate = {s: winners.count(s) / M for s in range(1, 7)}

print(f"Total races: {M}")
print(f"Win distribution: {', '.join(f'S{s}={winners.count(s)} ({winners.count(s)/M*100:.1f}%)' for s in range(1,7))}")
print()

# =============================================================
# 1. MARKOV CHAIN: P(slot j wins | slot i won previous race)
# =============================================================
print("=" * 70)
print("  1. TRANSITION MATRIX: P(current slot | previous slot)")
print("=" * 70)

transitions = defaultdict(lambda: defaultdict(int))  # prev -> curr -> count
prev_counts = defaultdict(int)  # prev -> total

for i in range(1, M):
    prev = winners[i - 1]
    curr = winners[i]
    if prev == 0 or curr == 0:
        continue
    transitions[prev][curr] += 1
    prev_counts[prev] += 1

header = f"{'Prev→Curr':<12}" + "".join(f"  S{s:<8}" for s in range(1, 7))
print(f"  {header}")
print(f"  {'-' * len(header)}")
for prev in range(1, 7):
    total = prev_counts[prev]
    if total == 0:
        continue
    row = f"  S{prev} (n={total:<3})"
    for curr in range(1, 7):
        cnt = transitions[prev][curr]
        pct = cnt / total * 100 if total > 0 else 0
        base = base_rate[curr] * 100
        marker = '*' if abs(pct - base) > 5 else ''
        row += f"  {pct:5.1f}%{marker}  "
    print(row)

# Expected under independence (baseline)
print(f"\n  {'Expected (base)':<12}", end="")
for s in range(1, 7):
    print(f"  {base_rate[s]*100:5.1f}%   ", end="")
print()

print(f"\n  (* = deviates from baseline by >5pp)")

# =============================================================
# 2. SAME-SLOT STREAK ANALYSIS
# =============================================================
print(f"\n{'='*70}")
print("  2. SAME-SLOT CONSECUTIVE WINS (streaks)")
print("=" * 70)

for s in range(1, 7):
    # Count how many times slot s is immediately followed by same slot
    total_s_wins = winners.count(s)
    same_follows = sum(1 for i in range(1, N) if winners[i - 1] == s and winners[i] == s)
    expected_same = total_s_wins * base_rate[s] if total_s_wins > 0 else 0
    pct_observed = same_follows / total_s_wins * 100 if total_s_wins > 0 else 0
    pct_expected = base_rate[s] * 100
    lift = pct_observed / pct_expected if pct_expected > 0 else 0
    marker = ' <<< STREAK' if lift > 1.3 else ''
    print(f"  S{s}: same-slot consecutive {same_follows}/{total_s_wins} "
          f"({pct_observed:.1f}% vs expected {pct_expected:.1f}%) "
          f"lift={lift:.2f}x{marker}")

# =============================================================
# 3. ALL TRANSITION LIFTS (positive & negative)
# =============================================================
print(f"\n{'='*70}")
print("  3. HIGHEST & LOWEST TRANSITION LIFTS (>5pp deviation)")
print("=" * 70)

entries = []
for prev in range(1, 7):
    total = prev_counts[prev]
    if total == 0:
        continue
    for curr in range(1, 7):
        cnt = transitions[prev][curr]
        obs = cnt / total if total > 0 else 0
        exp = base_rate[curr]
        lift = obs / exp if exp > 0 else 0
        pp_diff = (obs - exp) * 100
        entries.append((prev, curr, cnt, total, obs * 100, exp * 100, lift, pp_diff))

entries.sort(key=lambda x: -abs(x[7]))

print(f"  {'Prev':>4} {'Curr':>4} {'Obs':>7} {'Exp':>7}  {'Lift':>5}  {'Δpp':>5}  N")
print(f"  {'-'*50}")
for prev, curr, cnt, total, obs, exp, lift, ppd in entries[:15]:
    marker = ' <<<' if cnt >= 5 and abs(ppd) > 5 else ''
    print(f"  S{prev:>3} → S{curr:<3} {obs:>5.1f}% {exp:>5.1f}%  {lift:>4.2f}x {ppd:>+5.1f}  ({cnt:>2}/{total:<2}){marker}")

print(f"\n  Bottom 10 (negative):")
for prev, curr, cnt, total, obs, exp, lift, ppd in entries[-10:]:
    marker = ' <<<' if cnt >= 5 and abs(ppd) > 5 else ''
    print(f"  S{prev:>3} → S{curr:<3} {obs:>5.1f}% {exp:>5.1f}%  {lift:>4.2f}x {ppd:>+5.1f}  ({cnt:>2}/{total:<2}){marker}")

# =============================================================
# 4. VENUE-SPECIFIC TRANSITION EFFECT
# =============================================================
print(f"\n{'='*70}")
print("  4. VENUE-SPECIFIC: SAME-VENUE transitions")
print("=" * 70)

venue_transitions = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
venue_prev_counts = defaultdict(lambda: defaultdict(int))

prev_venue = None
for i, r in enumerate(rows):
    curr_venue = r['Venue']
    curr_winner = winners[i]
    if curr_winner == 0:
        prev_venue = curr_venue
        continue
    if prev_venue is not None and curr_venue == prev_venue:
        prev_winner = winners[i - 1]
        if prev_winner == 0:
            prev_venue = curr_venue
            continue
        venue_transitions[curr_venue][prev_winner][curr_winner] += 1
        venue_prev_counts[curr_venue][prev_winner] += 1
    prev_venue = curr_venue

for v in sorted(venue_transitions.keys()):
    print(f"\n  --- {v} ---")
    header = f"  {'Prev→Curr':<15}" + "".join(f"  S{s:<7}" for s in range(1, 7))
    print(f"  {header}")
    for prev in range(1, 7):
        total = venue_prev_counts[v][prev]
        if total < 5:
            continue
        row = f"  S{prev} (n={total:<2})"
        for curr in range(1, 7):
            cnt = venue_transitions[v][prev][curr]
            pct = cnt / total * 100 if total > 0 else 0
            base = base_rate[curr] * 100
            marker = ' *' if abs(pct - base) > 10 else ''
            row += f"  {pct:5.1f}%{marker}"
        print(row)

# =============================================================
# 5. RUN-LENGTH ANALYSIS: how long between slot victories
# =============================================================
print(f"\n{'='*70}")
print("  5. GAP DISTRIBUTION (races between consecutive wins for each slot)")
print("=" * 70)

for s in range(1, 7):
    positions = [i for i, w in enumerate(winners) if w == s]
    if len(positions) < 5:
        continue
    gaps = [positions[j] - positions[j - 1] for j in range(1, len(positions))]
    avg_gap = sum(gaps) / len(gaps)
    max_gap = max(gaps)
    min_gap = min(gaps)
    # Expected gap under independence
    expected_gap = N / len(positions)
    print(f"  S{s}: avg gap={avg_gap:.1f}, min={min_gap}, max={max_gap}, "
          f"expected={expected_gap:.1f} (n={len(positions)} wins)")

# =============================================================
# 6. POSITION IN RACE-NIGHT: Does round sequence matter?
# =============================================================
print(f"\n{'='*70}")
print("  6. WITHIN-SESSION: R1→R2→R3 transitions")
print("=" * 70)

# Group by session (Date + Time)
session_winners = defaultdict(list)
for r, w in zip(rows, winners):
    session_winners[(r['Date'], r['Time'], r['Venue'])].append((int(r['Round']), w))

# R1→R2 transitions
r1r2 = defaultdict(lambda: [0, 0])
r2r3 = defaultdict(lambda: [0, 0])
for session, outcomes in session_winners.items():
    outcomes.sort()
    for i in range(len(outcomes) - 1):
        r1, w1 = outcomes[i]
        r2, w2 = outcomes[i + 1]
        if r1 == 1 and r2 == 2:
            r1r2[w1][0] += 1
            r1r2[w2][1] += 1
        elif r1 == 2 and r2 == 3:
            r2r3[w1][0] += 1
            r2r3[w2][1] += 1

print(f"\n  R1 winner → R2 winner:")
for prev in range(1, 7):
    parts = []
    for curr in range(1, 7):
        cnt = r1r2[f"{prev}->{curr}"] if isinstance(r1r2, defaultdict) else 0
    # Rebuild properly
    pass

r1r2_matrix = defaultdict(lambda: defaultdict(int))
r2r3_matrix = defaultdict(lambda: defaultdict(int))
for session, outcomes in session_winners.items():
    outcomes.sort()
    for i in range(len(outcomes) - 1):
        r1, w1 = outcomes[i]
        r2, w2 = outcomes[i + 1]
        if r1 == 1 and r2 == 2:
            r1r2_matrix[w1][w2] += 1
        elif r1 == 2 and r2 == 3:
            r2r3_matrix[w1][w2] += 1

for label, mat in [("R1→R2", r1r2_matrix), ("R2→R3", r2r3_matrix)]:
    print(f"\n  {label}:")
    header = f"  {'Prev→Curr':<12}" + "".join(f"  S{s:<7}" for s in range(1, 7))
    print(f"  {header}")
    for prev in range(1, 7):
        total = sum(mat[prev].values())
        if total < 5:
            continue
        row = f"  S{prev} (n={total:<2})"
        for curr in range(1, 7):
            cnt = mat[prev][curr]
            pct = cnt / total * 100 if total > 0 else 0
            base = base_rate[curr] * 100
            marker = ' *' if abs(pct - base) > 10 else ''
            row += f"  {pct:5.1f}%{marker}"
        print(row)

# =============================================================
# 7. COMPARING OBSERVED vs EXPECTED: chi-square style
# =============================================================
print(f"\n{'='*70}")
print("  7. STRENGTH OF SEQUENTIAL DEPENDENCY")
print("=" * 70)

# If there were no sequential dependency, the transition matrix
# would just be the base rate. Let's see how much it deviates.
total_transitions = M - 1
obs_counts = []
exp_counts = []
for prev in range(1, 7):
    for curr in range(1, 7):
        obs = transitions[prev][curr]
        total_prev = prev_counts[prev]
        if total_prev == 0:
            continue
        exp = total_prev * base_rate[curr]
        obs_counts.append(obs)
        exp_counts.append(exp)

# Pseudo R²: compare transition matrix entropy vs base rate entropy
import math
def entropy(probs):
    return -sum(p * math.log2(p) for p in probs if p > 0)

base_probs = [base_rate[s] for s in range(1, 7)]
H_base = entropy(base_probs)
print(f"  Base rate entropy: {H_base:.3f} bits (uncertainty per race)")

# Average conditional entropy
H_cond_avg = 0
for prev in range(1, 7):
    total = prev_counts[prev]
    if total == 0:
        continue
    probs = [transitions[prev][curr] / total for curr in range(1, 7)]
    H_cond = entropy(probs)
    w_prev = total / total_transitions
    H_cond_avg += w_prev * H_cond
    print(f"  H(S{prev})={H_cond:.3f} bits")

print(f"  Average conditional entropy: {H_cond_avg:.3f} bits (uncertainty given previous winner)")
print(f"  Information gain: {H_base - H_cond_avg:.3f} bits (reduction in uncertainty)")
print(f"  Pseudo-R²: {(H_base - H_cond_avg) / H_base * 100:.1f}%")

# =============================================================
# 8. PER-VENUE SEQUENTIAL DEPENDENCY
# =============================================================
print(f"\n{'='*70}")
print("  8. WITHIN-VENUE SEQUENTIAL DEPENDENCY")
print("=" * 70)

venue_winners = defaultdict(list)
for r, w in zip(rows, winners):
    venue_winners[r['Venue']].append(w)

for v in sorted(venue_winners.keys()):
    wseq = venue_winners[v]
    if len(wseq) < 20:
        continue
    v_trans = defaultdict(lambda: defaultdict(int))
    v_prev = defaultdict(int)
    for i in range(1, len(wseq)):
        v_trans[wseq[i - 1]][wseq[i]] += 1
        v_prev[wseq[i - 1]] += 1

    v_base = {s: wseq.count(s) / len(wseq) for s in range(1, 7)}
    H_v_base = entropy([v_base[s] for s in range(1, 7)])
    H_v_cond = 0
    v_total_trans = len(wseq) - 1
    for prev in range(1, 7):
        total = v_prev[prev]
        if total == 0:
            continue
        probs = [v_trans[prev][curr] / total for curr in range(1, 7)]
        H_v_cond += (total / v_total_trans) * entropy(probs)
    info_gain = H_v_base - H_v_cond
    r2 = info_gain / H_v_base * 100 if H_v_base > 0 else 0
    print(f"  {v:<20} H_base={H_v_base:.3f}  H_cond={H_v_cond:.3f}  "
          f"info_gain={info_gain:.3f}  R²={r2:.1f}%")
