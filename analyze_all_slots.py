#!/usr/bin/env python3
"""Analyse factors influencing victory for all slots 1-6 in data_all.txt"""
import csv
import math
import statistics
from collections import defaultdict

data = open('data_all.txt').read().strip().split('\n')
reader = csv.DictReader(data, delimiter='\t')
rows = list(reader)
N = len(rows)

total_wins_per_slot = {s: sum(1 for r in rows if r[f'Win{s}'] == '1') for s in range(1, 7)}
print(f"Total races: {N}")
for s in range(1, 7):
    print(f"  Slot {s} wins: {total_wins_per_slot[s]:>3} ({total_wins_per_slot[s]/N*100:5.1f}%)")

base_rate = {s: total_wins_per_slot[s] / N for s in range(1, 7)}


def calc_iv(groups, n_win, n_loss):
    """Information Value for a feature."""
    iv = 0
    for key, (w, l) in groups.items():
        total = w + l
        if total == 0:
            continue
        p_win = w / n_win if n_win > 0 else 0
        p_loss = l / n_loss if n_loss > 0 else 0
        if p_win <= 0 or p_loss <= 0:
            continue
        wo_e = math.log(p_win / p_loss)
        iv += (p_win - p_loss) * wo_e
    return iv


def print_factor(groups, n_win, n_loss, label, base, show_all=False, min_total=5):
    """Print grouped factor analysis with win rates and signal markers."""
    iv = calc_iv(groups, n_win, n_loss)
    print(f"  IV={iv:.4f}")
    for key in sorted(groups.keys(), key=lambda k: -(groups[k][0]/(groups[k][0]+groups[k][1]) if groups[k][0]+groups[k][1] > 0 else 0)):
        w, l = groups[key]
        total = w + l
        if total < min_total and not show_all:
            continue
        rate = w / total * 100 if total > 0 else 0
        bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
        marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base) > 0.08 else ''
        print(f"  {key:<30} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")
    return iv


def compute_payout_rank(payouts_str, target_idx):
    """Computes 1-based payout rank for target slot (1=lowest payout)."""
    payouts = [int(p) for p in payouts_str]
    target = payouts[target_idx]
    sorted_p = sorted(payouts)
    return sorted_p.index(target) + 1


def compute_favorite(payouts_str, target_idx):
    """Returns 1 if target slot has lowest payout."""
    payouts = [int(p) for p in payouts_str]
    return 1 if payouts[target_idx] == min(payouts) else 0


def compute_spread(payouts_str):
    payouts = [int(p) for p in payouts_str]
    return max(payouts) - min(payouts)


def compute_avg_payout(payouts_str):
    payouts = [int(p) for p in payouts_str]
    return statistics.mean(payouts)


# =====================================================================
# MAIN ANALYSIS
# =====================================================================
for slot in range(1, 7):
    slot_win = [r for r in rows if r[f'Win{slot}'] == '1']
    slot_loss = [r for r in rows if r[f'Win{slot}'] != '1']
    n_win = len(slot_win)
    n_loss = len(slot_loss)
    base = base_rate[slot]

    print(f"\n{'='*70}")
    print(f"  SLOT {slot} ANALYSIS ({n_win} wins, {n_win/N*100:.1f}% baseline)")
    print(f"{'='*70}")

    # --- 1. Payout Rank ---
    rank_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        rank = compute_payout_rank([r[f'Payout{i}'] for i in range(1, 7)], slot - 1)
        if r[f'Win{slot}'] == '1':
            rank_groups[rank][0] += 1
        else:
            rank_groups[rank][1] += 1
    print(f"\n  --- Payout Rank ---")
    print_factor(rank_groups, n_win, n_loss, "", base, show_all=True, min_total=0)

    # --- 2. Favorite Status ---
    fav_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        is_fav = compute_favorite([r[f'Payout{i}'] for i in range(1, 7)], slot - 1)
        if r[f'Win{slot}'] == '1':
            fav_groups[is_fav][0] += 1
        else:
            fav_groups[is_fav][1] += 1
    print(f"\n  --- Favorite Status (lowest payout) ---")
    print_factor(fav_groups, n_win, n_loss, "", base, show_all=True, min_total=0)

    # --- 3. Payout bins ---
    payout_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        ps = int(r[f'Payout{slot}'])
        bucket = (ps // 2) * 2
        if r[f'Win{slot}'] == '1':
            payout_groups[bucket][0] += 1
        else:
            payout_groups[bucket][1] += 1
    print(f"\n  --- Payout bin (width=2) ---")
    print_factor(payout_groups, n_win, n_loss, "", base, min_total=5)

    # --- 4. Venue ---
    venue_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        v = r['Venue']
        if r[f'Win{slot}'] == '1':
            venue_groups[v][0] += 1
        else:
            venue_groups[v][1] += 1
    print(f"\n  --- Venue ---")
    print_factor(venue_groups, n_win, n_loss, "", base, min_total=5)

    # --- 5. Round ---
    round_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        rd = int(r['Round'])
        if r[f'Win{slot}'] == '1':
            round_groups[rd][0] += 1
        else:
            round_groups[rd][1] += 1
    print(f"\n  --- Round ---")
    print_factor(round_groups, n_win, n_loss, "", base, show_all=True, min_total=0)

    # --- 6. Time ---
    time_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        t = r['Time']
        if r[f'Win{slot}'] == '1':
            time_groups[t][0] += 1
        else:
            time_groups[t][1] += 1
    print(f"\n  --- Time ---")
    print_factor(time_groups, n_win, n_loss, "", base, show_all=True, min_total=0)

    # --- 7. Monster in slot ---
    player_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        p = r[f'Player{slot}'] if r[f'Player{slot}'] else 'Human'
        if r[f'Win{slot}'] == '1':
            player_groups[p][0] += 1
        else:
            player_groups[p][1] += 1
    print(f"\n  --- Monster in Slot {slot} (>=5 races) ---")
    print_factor(player_groups, n_win, n_loss, "", base, min_total=5)

    # --- 8. Spread ---
    spread_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        spread = compute_spread([r[f'Payout{i}'] for i in range(1, 7)])
        bucket = (spread // 2) * 2
        if r[f'Win{slot}'] == '1':
            spread_groups[bucket][0] += 1
        else:
            spread_groups[bucket][1] += 1
    print(f"\n  --- Payout Spread ---")
    print_factor(spread_groups, n_win, n_loss, "", base, min_total=5)

    # --- 9. Venue x Round ---
    vr_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        key = f"{r['Venue']} R{r['Round']}"
        if r[f'Win{slot}'] == '1':
            vr_groups[key][0] += 1
        else:
            vr_groups[key][1] += 1
    print(f"\n  --- Venue x Round ---")
    print_factor(vr_groups, n_win, n_loss, "", base, min_total=3)

    # --- 10. Venue x Time ---
    vt_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        key = f"{r['Venue']} {r['Time']}"
        if r[f'Win{slot}'] == '1':
            vt_groups[key][0] += 1
        else:
            vt_groups[key][1] += 1
    print(f"\n  --- Venue x Time ---")
    print_factor(vt_groups, n_win, n_loss, "", base, min_total=3)

    # --- 11. Payout Rank x Venue ---
    prv_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        rank = compute_payout_rank([r[f'Payout{i}'] for i in range(1, 7)], slot - 1)
        key = f"{r['Venue']} Rank{rank}"
        if r[f'Win{slot}'] == '1':
            prv_groups[key][0] += 1
        else:
            prv_groups[key][1] += 1
    print(f"\n  --- Venue x Payout Rank ---")
    print_factor(prv_groups, n_win, n_loss, "", base, min_total=3)

    # --- 12. Venue x Round x Time (3-way if enough data) ---
    vrt_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        key = f"{r['Venue']} R{r['Round']} {r['Time']}"
        if r[f'Win{slot}'] == '1':
            vrt_groups[key][0] += 1
        else:
            vrt_groups[key][1] += 1
    print(f"\n  --- Venue x Round x Time (>=3 races) ---")
    print_factor(vrt_groups, n_win, n_loss, "", base, min_total=3)

    # --- 13. Venue-wide slot win distribution ---
    print(f"\n  --- Venue win distribution (all slots) ---")
    venue_all = defaultdict(lambda: defaultdict(lambda: [0, 0]))
    for r in rows:
        v = r['Venue']
        for s in range(1, 7):
            if r[f'Win{s}'] == '1':
                venue_all[v][s][0] += 1
            else:
                venue_all[v][s][1] += 1
    for v in sorted(venue_all.keys()):
        total_v = sum(venue_all[v][s][0] for s in range(1, 7))
        parts = []
        for s in range(1, 7):
            w = venue_all[v][s][0]
            rate = w / total_v * 100 if total_v > 0 else 0
            arrow = ' <<<' if s == slot else ''
            parts.append(f"S{s}:{w:>2}({rate:4.1f}%){arrow}")
        print(f"  {v:<20} {'  '.join(parts)}")

    # --- 14. SUMMARY IV RANKING ---
    print(f"\n  >>> FACTOR IV SUMMARY <<<")
    ivs = []
    ivs.append(("Payout Rank", rank_groups))
    ivs.append(("Favorite", fav_groups))
    ivs.append(("Payout Value", payout_groups))
    ivs.append(("Venue", venue_groups))
    ivs.append(("Round", round_groups))
    ivs.append(("Time", time_groups))
    ivs.append(("Monster in Slot", player_groups))
    ivs.append(("Payout Spread", spread_groups))
    ivs.append(("Venue x Round", vr_groups))
    ivs.append(("Venue x Time", vt_groups))
    ivs.append(("Venue x Payout Rank", prv_groups))

    for name, grp in sorted(ivs, key=lambda x: -calc_iv(x[1], n_win, n_loss)):
        iv = calc_iv(grp, n_win, n_loss)
        signal = "STRONG" if iv > 0.30 else "MEDIUM" if iv > 0.10 else "weak"
        print(f"  {name:<25} IV={iv:.4f}  [{signal}]")


# =====================================================================
# CROSS-SLOT COMPARISON: BEST/WORST venues per slot
# =====================================================================
print(f"\n\n{'='*70}")
print(f"  CROSS-SLOT VENUE COMPARISON (win rate % per venue)")
print(f"{'='*70}")
header = f"{'Venue':<20}" + "".join(f" S{s:>7}" for s in range(1, 7))
print(f"  {header}")
print(f"  {'-'*len(header)}")
venue_all = defaultdict(lambda: defaultdict(lambda: [0, 0]))
for r in rows:
    v = r['Venue']
    for s in range(1, 7):
        if r[f'Win{s}'] == '1':
            venue_all[v][s][0] += 1
for v in sorted(venue_all.keys()):
    total_v = sum(venue_all[v][s][0] for s in range(1, 7))
    rates = []
    for s in range(1, 7):
        w = venue_all[v][s][0]
        rate = w / total_v * 100 if total_v > 0 else 0
        rates.append(f"{rate:6.1f}%")
    print(f"  {v:<20}" + "".join(f"{r:>8}" for r in rates))

# Cross-slot: Best venues for EACH slot
print(f"\n\n{'='*70}")
print(f"  BEST & WORST (by venue) FOR EACH SLOT")
print(f"{'='*70}")
for s in range(1, 7):
    venue_rates = []
    for v in sorted(venue_all.keys()):
        total_v = sum(venue_all[v][s][0] for s2 in range(1, 7))
        w = venue_all[v][s][0]
        rate = w / total_v * 100 if total_v > 0 else 0
        venue_rates.append((v, rate, w, total_v))
    venue_rates.sort(key=lambda x: -x[1])
    best = venue_rates[0]
    worst = venue_rates[-1]
    print(f"  Slot {s}: best={best[0]} ({best[1]:.1f}%, {best[2]}/{best[3]}), "
          f"worst={worst[0]} ({worst[1]:.1f}%, {worst[2]}/{worst[3]})")


# =====================================================================
# GLOBAL IV RANKING (all factors across all slots)
# =====================================================================
print(f"\n\n{'='*70}")
print(f"  GLOBAL FACTOR RANKING (average IV across all slots)")
print(f"{'='*70}")

all_factors = [
    "Payout Rank", "Favorite", "Payout Value", "Venue", "Round",
    "Time", "Monster in Slot", "Payout Spread",
    "Venue x Round", "Venue x Time", "Venue x Payout Rank"
]


def compute_group_for_slot(slot, factor_name, rows):
    groups = defaultdict(lambda: [0, 0])
    for r in rows:
        key = None
        if factor_name == "Payout Rank":
            rank = compute_payout_rank([r[f'Payout{i}'] for i in range(1, 7)], slot - 1)
            key = f"R{rank}"
        elif factor_name == "Favorite":
            key = compute_favorite([r[f'Payout{i}'] for i in range(1, 7)], slot - 1)
        elif factor_name == "Payout Value":
            ps = int(r[f'Payout{slot}'])
            key = (ps // 2) * 2
        elif factor_name == "Venue":
            key = r['Venue']
        elif factor_name == "Round":
            key = f"R{r['Round']}"
        elif factor_name == "Time":
            key = r['Time']
        elif factor_name == "Monster in Slot":
            key = r[f'Player{slot}'] if r[f'Player{slot}'] else 'Human'
        elif factor_name == "Payout Spread":
            spread = compute_spread([r[f'Payout{i}'] for i in range(1, 7)])
            key = (spread // 2) * 2
        elif factor_name == "Venue x Round":
            key = f"{r['Venue']} R{r['Round']}"
        elif factor_name == "Venue x Time":
            key = f"{r['Venue']} {r['Time']}"
        elif factor_name == "Venue x Payout Rank":
            rank = compute_payout_rank([r[f'Payout{i}'] for i in range(1, 7)], slot - 1)
            key = f"{r['Venue']} R{rank}"

        if key is not None:
            if r[f'Win{slot}'] == '1':
                groups[key][0] += 1
            else:
                groups[key][1] += 1
    return groups


factor_ivs = {}
for fname in all_factors:
    slot_ivs = []
    for s in range(1, 7):
        nw = total_wins_per_slot[s]
        nl = N - nw
        grp = compute_group_for_slot(s, fname, rows)
        slot_ivs.append(calc_iv(grp, nw, nl))
    avg_iv = statistics.mean(slot_ivs)
    max_iv = max(slot_ivs)
    best_slot = slot_ivs.index(max_iv) + 1
    factor_ivs[fname] = (avg_iv, max_iv, best_slot)

for fname, (avg, mx, bs) in sorted(factor_ivs.items(), key=lambda x: -x[1][0]):
    signal = "STRONG" if avg > 0.30 else "MEDIUM" if avg > 0.10 else "weak"
    print(f"  {fname:<25} avg IV={avg:.4f}  max IV={mx:.4f} (slot {bs})  [{signal}]")


# =====================================================================
# PER-SLOT VENUE x ROUND x TIME HEATMAP
# =====================================================================
print(f"\n\n{'='*70}")
print(f"  VENUE x ROUND: Top offensive venues per slot (>=3 races)")
print(f"{'='*70}")
for s in range(1, 7):
    nw = total_wins_per_slot[s]
    base = nw / N
    vr_groups = defaultdict(lambda: [0, 0])
    for r in rows:
        key = f"{r['Venue']} R{r['Round']}"
        if r[f'Win{s}'] == '1':
            vr_groups[key][0] += 1
        else:
            vr_groups[key][1] += 1

    tops = [(k, vr_groups[k][0], vr_groups[k][0] + vr_groups[k][1])
            for k in vr_groups if vr_groups[k][0] + vr_groups[k][1] >= 3]
    tops.sort(key=lambda x: -(x[1] / x[2]))
    best = tops[:3] if tops else []
    worst = tops[-3:] if len(tops) >= 3 else tops[::-1] if tops else []
    print(f"  Slot {s} (base={base*100:.1f}%):")
    if best:
        for k, w, t in best:
            rate = w / t * 100
            lift = rate / (base * 100)
            print(f"    BEST:  {k:<25} {rate:5.1f}% ({w}/{t}) x{lift:.2f} vs baseline")
    if worst:
        for k, w, t in reversed(worst):
            rate = w / t * 100
            lift = rate / (base * 100)
            print(f"    WORST: {k:<25} {rate:5.1f}% ({w}/{t}) x{lift:.2f} vs baseline")
