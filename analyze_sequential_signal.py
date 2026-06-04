#!/usr/bin/env python3
"""
Rigorous statistical analysis of sequential dependence in race victories.
Tests: (1) global sequential signal, (2) per-venue sequential signal,
(3) permutation tests, (4) binomial tests, (5) chi-square independence.
No external dependencies beyond Python 3 stdlib.
"""
import csv
import math
import random
from collections import defaultdict

random.seed(42)

# ---------- minimal statistics (no scipy) ----------
def gammaln(x):
    """Log gamma function (Lanczos approximation)."""
    coef = [76.18009172947146, -86.50532032941677,
            24.01409824083091, -1.231739572450155,
            0.1208650973866179e-2, -0.5395239384953e-5]
    y = x
    tmp = x + 5.5
    tmp -= (x + 0.5) * math.log(tmp)
    ser = 1.000000000190015
    for j in range(6):
        y += 1
        ser += coef[j] / y
    return -tmp + math.log(2.5066282746310005 * ser / x)

def incomplete_gamma(a, x):
    """Regularized lower incomplete gamma function P(a,x)."""
    if x < a + 1:
        # Series expansion
        gam = 1.0 / a
        ap = a
        s = gam
        for _ in range(100):
            ap += 1
            gam *= x / ap
            s += gam
            if abs(gam) < 1e-14 * abs(s):
                break
        return s * math.exp(-x + a * math.log(x) - gammaln(a))
    else:
        # Continued fraction
        b = x + 1 - a
        c = 1.0 / 1e-30
        d = 1.0 / b
        h = d
        for i in range(1, 101):
            an = -i * (i - a)
            b += 2
            d = an * d + b
            if abs(d) < 1e-30:
                d = 1e-30
            c = b + an / c
            if abs(c) < 1e-30:
                c = 1e-30
            d = 1.0 / d
            delta = d * c
            h *= delta
            if abs(delta - 1) < 1e-14:
                break
        return 1.0 - math.exp(-x + a * math.log(x) - gammaln(a)) * h

def chi_square_survival(chi2, df):
    """P(χ² > chi2) for given df."""
    if chi2 <= 0 or df <= 0:
        return 1.0
    return 1 - incomplete_gamma(df / 2.0, chi2 / 2.0)

def binom_p_value(k, n, p):
    """Two-sided p-value for binomial test.
    P(X >= k) + P(X <= expected_opposite) where X ~ Binomial(n,p).
    """
    # Use one-sided (greater) * 2, capped at 1.0
    prob = 0.0
    for i in range(k, n + 1):
        prob += math.comb(n, i) * (p ** i) * ((1 - p) ** (n - i))
    return min(prob * 2, 1.0)

def entropy(probs):
    return -sum(p * math.log2(p) for p in probs if p > 0)

# ---------- data loading ----------
data = open('data_all.txt').read().strip().split('\n')
reader = csv.DictReader(data, delimiter='\t')
rows = list(reader)

winners = []
for r in rows:
    found = False
    for s in range(1, 7):
        if r[f'Win{s}'] == '1':
            winners.append(s)
            found = True
            break
    if not found:
        winners.append(0)

valid_idx = [i for i, w in enumerate(winners) if w > 0]
winners = [winners[i] for i in valid_idx]
rows = [rows[i] for i in valid_idx]
N = len(winners)

base_rate = {s: winners.count(s) / N for s in range(1, 7)}

print("=" * 72)
print("  ANALYSIS OF SEQUENTIAL SIGNAL IN RACE VICTORIES")
print("=" * 72)
print(f"\n  Total races: {N}")
print(f"  Win distribution: {', '.join(f'S{s}={winners.count(s)} ({winners.count(s)/N*100:.1f}%)' for s in range(1,7))}")

# ---------- 1. Chi-square test of independence ----------
print(f"\n{'='*72}")
print("  1. GLOBAL SEQUENTIAL SIGNAL: Chi-square test of independence")
print(f"{'='*72}")

transitions = defaultdict(lambda: defaultdict(int))
prev_counts = defaultdict(int)
for i in range(1, N):
    transitions[winners[i-1]][winners[i]] += 1
    prev_counts[winners[i-1]] += 1

total_transitions = N - 1
chi_sq = 0
df = 0
exp_min = float('inf')
for prev in range(1, 7):
    total_prev = prev_counts[prev]
    if total_prev == 0:
        continue
    for curr in range(1, 7):
        obs = transitions[prev][curr]
        exp = total_prev * base_rate[curr]
        exp_min = min(exp_min, exp)
        chi_sq += (obs - exp) ** 2 / exp
        df += 1

p_value = chi_square_survival(chi_sq, df)
cramers_v = math.sqrt(chi_sq / (total_transitions * (6 - 1)))

print(f"  Chi-square: {chi_sq:.2f}  (df={df})")
print(f"  p-value: {p_value:.6f}")
print(f"  Cramér's V: {cramers_v:.4f}  (0=independent, 1=fully dependent)")
print(f"  Min expected cell count: {exp_min:.1f}")
print(f"  Significant at α=0.05: {'YES' if p_value < 0.05 else 'NO'}")

# ---------- 2. Permutation test ----------
print(f"\n{'='*72}")
print("  2. PERMUTATION TEST: Is information gain significant?")
print(f"{'='*72}")

def observed_info_gain(wseq):
    base_probs = [wseq.count(s) / len(wseq) for s in range(1, 7)]
    H_base = entropy(base_probs)
    trans = defaultdict(lambda: defaultdict(int))
    prev_c = defaultdict(int)
    for i in range(1, len(wseq)):
        trans[wseq[i-1]][wseq[i]] += 1
        prev_c[wseq[i-1]] += 1
    H_cond = 0
    total_t = len(wseq) - 1
    for prev in range(1, 7):
        t = prev_c[prev]
        if t == 0:
            continue
        probs = [trans[prev][curr] / t for curr in range(1, 7)]
        H_cond += (t / total_t) * entropy(probs)
    return H_base - H_cond

observed_ig = observed_info_gain(winners)

n_perm = 10000
count_extreme = 0
for p in range(n_perm):
    shuffled = winners.copy()
    random.shuffle(shuffled)
    if observed_info_gain(shuffled) >= observed_ig:
        count_extreme += 1

perm_p = count_extreme / n_perm

print(f"  Observed information gain: {observed_ig:.4f} bits")
print(f"  Permutation p-value ({n_perm} shuffles): {perm_p:.4f}")
print(f"  Significant at α=0.05: {'YES' if perm_p < 0.05 else 'NO'}")

# ---------- 3. Binomial tests per transition ----------
print(f"\n{'='*72}")
print("  3. PER-TRANSITION BINOMIAL TESTS")
print(f"{'='*72}")

print(f"\n  {'Prev':>4} {'Curr':>4} {'Obs':>7} {'Exp':>7} {'Δpp':>6} {'p-value':>8}  Sig")
print(f"  {'-'*52}")

sig_count = 0
sig_bonf = 0
transitions_list = []
for prev in range(1, 7):
    total_prev = prev_counts[prev]
    if total_prev < 5:
        continue
    for curr in range(1, 7):
        obs = transitions[prev][curr]
        exp_prob = base_rate[curr]
        p_val = binom_p_value(obs, total_prev, exp_prob)
        obs_pct = obs / total_prev * 100
        exp_pct = exp_prob * 100
        pp_diff = obs_pct - exp_pct
        sig = "***" if p_val < 0.001 else ("**" if p_val < 0.01 else ("*" if p_val < 0.05 else ""))
        if sig:
            sig_count += 1
        transitions_list.append((prev, curr, obs_pct, exp_pct, pp_diff, p_val, sig, total_prev))

transitions_list.sort(key=lambda x: x[4], reverse=True)
for prev, curr, obs_pct, exp_pct, pp_diff, p_val, sig, n in transitions_list:
    if sig:
        print(f"  S{prev:>3} -> S{curr:<3} {obs_pct:>5.1f}% {exp_pct:>5.1f}% {pp_diff:>+5.1f}  {p_val:>7.4f}  {sig:>3}  (n={n})")

n_tests = sum(1 for p in range(1, 7) for c in range(1, 7) if prev_counts[p] >= 5)
bonf_threshold = 0.05 / n_tests if n_tests > 0 else 0.05
sig_bonf = sum(1 for p, c, _, _, _, pv, _, _ in transitions_list if pv < bonf_threshold)
print(f"\n  Significant at α=0.05: {sig_count}/{n_tests}")
print(f"  Significant after Bonferroni (α={bonf_threshold:.5f}): {sig_bonf}/{n_tests}")

# ---------- 4. Per-venue sequential signal ----------
print(f"\n{'='*72}")
print("  4. PER-VENUE SEQUENTIAL SIGNAL")
print(f"{'='*72}")

venue_winners = defaultdict(list)
for r, w in zip(rows, winners):
    venue_winners[r['Venue']].append(w)

print(f"\n  {'Venue':<20} {'N':>4} {'χ²':>7} {'p':>8} {'V':>7} {'IG':>6} {'perm_p':>7}  Sig")
print(f"  {'-'*72}")

for v in sorted(venue_winners.keys()):
    wseq = venue_winners[v]
    if len(wseq) < 20:
        continue

    v_trans = defaultdict(lambda: defaultdict(int))
    v_prev = defaultdict(int)
    for i in range(1, len(wseq)):
        v_trans[wseq[i-1]][wseq[i]] += 1
        v_prev[wseq[i-1]] += 1

    v_base = {s: wseq.count(s) / len(wseq) for s in range(1, 7)}
    v_chi = 0
    v_df = 0
    for prev in range(1, 7):
        total = v_prev[prev]
        if total == 0:
            continue
        for curr in range(1, 7):
            obs = v_trans[prev][curr]
            exp = total * v_base[curr]
            if exp > 0:
                v_chi += (obs - exp) ** 2 / exp
                v_df += 1
    v_p = chi_square_survival(v_chi, v_df) if v_df > 0 else 1.0
    v_cramers = math.sqrt(v_chi / ((len(wseq) - 1) * (6 - 1))) if v_chi > 0 else 0

    v_ig = observed_info_gain(wseq)
    v_extreme = 0
    perm_k = 5000
    for _ in range(perm_k):
        shuffled = wseq.copy()
        random.shuffle(shuffled)
        if observed_info_gain(shuffled) >= v_ig:
            v_extreme += 1
    v_perm_p = v_extreme / perm_k

    sig = "***" if v_perm_p < 0.001 else ("**" if v_perm_p < 0.01 else ("*" if v_perm_p < 0.05 else ""))
    print(f"  {v:<20} {len(wseq):>4} {v_chi:>7.1f} {v_p:>8.4f} {v_cramers:>7.4f} {v_ig:>6.4f} {v_perm_p:>7.4f}  {sig:>3}")

# ---------- 5. Same-venue vs cross-venue comparison ----------
print(f"\n{'='*72}")
print("  5. SAME-VENUE vs CROSS-VENUE TRANSITION STRENGTH")
print(f"{'='*72}")

same_venue = []
cross_venue = []
for i in range(1, len(rows)):
    if rows[i]['Venue'] == rows[i-1]['Venue']:
        same_venue.append((winners[i-1], winners[i]))
    else:
        cross_venue.append((winners[i-1], winners[i]))

def info_gain_from_pairs(pairs):
    if not pairs:
        return 0
    curr_w = [c for _, c in pairs]
    n = len(curr_w)
    base = entropy([curr_w.count(s) / n for s in range(1, 7)])
    tr = defaultdict(lambda: defaultdict(int))
    pr = defaultdict(int)
    for p, c in pairs:
        tr[p][c] += 1
        pr[p] += 1
    hc = 0
    for prev in range(1, 7):
        t = pr[prev]
        if t == 0:
            continue
        probs = [tr[prev][x] / t for x in range(1, 7)]
        hc += (t / len(pairs)) * entropy(probs)
    return base - hc

sv_ig = info_gain_from_pairs(same_venue)
cv_ig = info_gain_from_pairs(cross_venue)
diff_obs = sv_ig - cv_ig

print(f"  Same-venue transitions:  N={len(same_venue):>3}  IG={sv_ig:.4f}")
print(f"  Cross-venue transitions: N={len(cross_venue):>3}  IG={cv_ig:.4f}")
print(f"  Difference (same-cross):  {diff_obs:+.4f}")

# Permutation test
all_pairs = same_venue + cross_venue
all_labels = ['same'] * len(same_venue) + ['cross'] * len(cross_venue)
diff_extreme = 0
for _ in range(5000):
    random.shuffle(all_labels)
    sv = [all_pairs[i] for i in range(len(all_pairs)) if all_labels[i] == 'same']
    cv = [all_pairs[i] for i in range(len(all_pairs)) if all_labels[i] == 'cross']
    if not sv or not cv:
        continue
    ig_diff = info_gain_from_pairs(sv) - info_gain_from_pairs(cv)
    if ig_diff >= diff_obs:
        diff_extreme += 1

diff_p = diff_extreme / 5000
print(f"  Permutation test p-value: {diff_p:.4f}  {'<<< SIGNIFICANT' if diff_p < 0.05 else '(not significant)'}")

# ---------- 6. Summary ----------
print(f"\n{'='*72}")
print("  6. SUMMARY")
print(f"{'='*72}")

print(f"""
  GLOBAL SEQUENTIAL SIGNAL:
    χ²({df}) = {chi_sq:.2f}, p = {p_value:.4f}
    Cramér's V = {cramers_v:.4f}
    Info gain = {observed_ig:.3f} bits ({observed_ig/2.405*100:.1f}% of entropy)
    Permutation p = {perm_p:.4f}
    {'-> There IS a weak but statistically significant global sequential signal.' if p_value < 0.05 else '-> No global sequential signal detected.'}

  PER-VENUE SIGNAL (permutation test):
""")
for v in sorted(venue_winners.keys()):
    wseq = venue_winners[v]
    if len(wseq) < 20:
        continue
    v_ig = observed_info_gain(wseq)
    v_extreme = 0
    for _ in range(5000):
        shuffled = wseq.copy()
        random.shuffle(shuffled)
        if observed_info_gain(shuffled) >= v_ig:
            v_extreme += 1
    pp = v_extreme / 5000
    sig = "YES" if pp < 0.05 else "no"
    print(f"    {v:<20}: IG={v_ig:.4f}  perm_p={pp:.4f}  significant={sig}")

print(f"""
  KEY TAKEAWAY:
    The sequential signal is WEAK overall (Cramér's V = {cramers_v:.4f},
    info gain = {observed_ig:.1f}%, equivalent to R² = {(1 - (2.405-observed_ig)/2.405)*100 - 100:.1f}%).
    {'Some venues show stronger effects than others (see per-venue results).' if any(observed_info_gain(venue_winners[v]) > 0.2 for v in venue_winners) else 'Venue-specific effects are also weak.'}
""")
