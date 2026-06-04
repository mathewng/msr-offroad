#!/usr/bin/env python3
"""Analyse factors influencing slot 5 victory in data_all.txt"""
import csv
import math
import statistics
from collections import defaultdict

data = open('data_all.txt').read().strip().split('\n')
reader = csv.DictReader(data, delimiter='\t')
rows = list(reader)
N = len(rows)

slot5_win = [r for r in rows if r['Win5'] == '1']
slot5_loss = [r for r in rows if r['Win5'] != '1']
n_win = len(slot5_win)
n_loss = len(slot5_loss)
base_rate = n_win / N

print(f"Total races: {N}")
print(f"Slot 5 wins: {n_win} ({base_rate*100:.1f}%)")
print(f"Slot 5 losses: {n_loss}\n")

def score_binary(groups, label):
    """Show win rate for each group and calculate information value."""
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    for key, (w, l) in sorted(groups.items(), key=lambda x: -x[1][0]/(x[1][0]+x[1][1]) if (x[1][0]+x[1][1])>0 else 0):
        total = w + l
        rate = w / total * 100 if total > 0 else 0
        bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
        marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
        print(f"  {key:<20} {rate:5.1f}% ({w:>3}/{total:<3}) {bar} {marker}")

def calc_iv(groups, base):
    """Weight of evidence / information value for a feature."""
    iv = 0
    for key, (w, l) in groups.items():
        total = w + l
        if total == 0:
            continue
        p_win = w / n_win
        p_loss = l / n_loss
        if p_win == 0 or p_loss == 0:
            continue
        wo_e = math.log(p_win / p_loss)
        iv += (p_win - p_loss) * wo_e
    return iv

# 1. PAYOUT ANALYSIS
print("=" * 60)
print("  1. PAYOUT FACTORS")
print("=" * 60)

# Bucket payouts
for bucket_size, label in [(2, 'Payout bins (width=2)'), (3, 'Payout bins (width=3)')]:
    groups = defaultdict(lambda: [0, 0])
    for r in rows:
        p5 = int(r['Payout5'])
        bucket = (p5 // bucket_size) * bucket_size
        if r['Win5'] == '1':
            groups[bucket][0] += 1
        else:
            groups[bucket][1] += 1
    iv = calc_iv(groups, base_rate)
    print(f"\n  {label} (IV={iv:.4f})")
    for bucket in sorted(groups.keys()):
        w, l = groups[bucket]
        total = w + l
        rate = w / total * 100 if total > 0 else 0
        bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
        marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
        print(f"  Payout {bucket:>2}-{bucket+bucket_size-1:<2}  {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# Payout rank (1=lowest, 6=highest)
rank_groups = defaultdict(lambda: [0, 0])
for r in rows:
    payouts = [int(r[f'Payout{i}']) for i in range(1, 7)]
    p5 = int(r['Payout5'])
    sorted_p = sorted(payouts)
    rank = sorted_p.index(p5) + 1
    if r['Win5'] == '1':
        rank_groups[rank][0] += 1
    else:
        rank_groups[rank][1] += 1
iv = calc_iv(rank_groups, base_rate)
print(f"\n  Payout Rank (IV={iv:.4f})")
for rank in sorted(rank_groups.keys()):
    w, l = rank_groups[rank]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  Rank {rank:<15} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# Favorite status
fav_groups = defaultdict(lambda: [0, 0])
for r in rows:
    payouts = [int(r[f'Payout{i}']) for i in range(1, 7)]
    p5 = int(r['Payout5'])
    is_fav = 1 if p5 == min(payouts) else 0
    if r['Win5'] == '1':
        fav_groups[is_fav][0] += 1
    else:
        fav_groups[is_fav][1] += 1
iv = calc_iv(fav_groups, base_rate)
print(f"\n  Favorite Status (Lowest Payout) (IV={iv:.4f})")
for is_fav in sorted(fav_groups.keys()):
    w, l = fav_groups[is_fav]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {'Favorite' if is_fav else 'Not Favorite':<20} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 2. VENUE ANALYSIS
print(f"\n{'='*60}")
print("  2. VENUE FACTOR")
print(f"{'='*60}")
venue_groups = defaultdict(lambda: [0, 0])
for r in rows:
    v = r['Venue']
    if r['Win5'] == '1':
        venue_groups[v][0] += 1
    else:
        venue_groups[v][1] += 1
iv = calc_iv(venue_groups, base_rate)
print(f"  IV={iv:.4f}")
for v in sorted(venue_groups.keys()):
    w, l = venue_groups[v]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {v:<20} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 3. ROUND ANALYSIS
print(f"\n{'='*60}")
print("  3. ROUND FACTOR")
print(f"{'='*60}")
round_groups = defaultdict(lambda: [0, 0])
for r in rows:
    rd = int(r['Round'])
    if r['Win5'] == '1':
        round_groups[rd][0] += 1
    else:
        round_groups[rd][1] += 1
iv = calc_iv(round_groups, base_rate)
print(f"  IV={iv:.4f}")
for rd in sorted(round_groups.keys()):
    w, l = round_groups[rd]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  Round {rd:<15} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 4. TIME ANALYSIS
print(f"\n{'='*60}")
print("  4. TIME FACTOR")
print(f"{'='*60}")
time_groups = defaultdict(lambda: [0, 0])
for r in rows:
    t = r['Time']
    if r['Win5'] == '1':
        time_groups[t][0] += 1
    else:
        time_groups[t][1] += 1
iv = calc_iv(time_groups, base_rate)
print(f"  IV={iv:.4f}")
for t in sorted(time_groups.keys()):
    w, l = time_groups[t]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {t:<20} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 5. MONSTER ANALYSIS
print(f"\n{'='*60}")
print("  5. MONSTER/PLAYER FACTOR (Slot 5 occupants)")
print(f"{'='*60}")
player_groups = defaultdict(lambda: [0, 0])
for r in rows:
    p = r['Player5'] if r['Player5'] else 'Human'
    if r['Win5'] == '1':
        player_groups[p][0] += 1
    else:
        player_groups[p][1] += 1
iv = calc_iv(player_groups, base_rate)
print(f"  IV={iv:.4f}")
# Show only with enough data
for p in sorted(player_groups.keys(), key=lambda x: -(player_groups[x][0]+player_groups[x][1])):
    w, l = player_groups[p]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {p:<20} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 6. DISTRIBUTION CHARACTERISTICS
print(f"\n{'='*60}")
print("  6. PAYOUT DISTRIBUTION SHAPE")
print(f"{'='*60}")

# Payout spread (max - min)
spread_groups = defaultdict(lambda: [0, 0])
for r in rows:
    payouts = [int(r[f'Payout{i}']) for i in range(1, 7)]
    spread = max(payouts) - min(payouts)
    bucket = (spread // 2) * 2
    if r['Win5'] == '1':
        spread_groups[bucket][0] += 1
    else:
        spread_groups[bucket][1] += 1
iv = calc_iv(spread_groups, base_rate)
print(f"\n  Payout Spread (max-min) (IV={iv:.4f})")
for bucket in sorted(spread_groups.keys()):
    w, l = spread_groups[bucket]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  Spread {bucket:>2}-{bucket+1:<2}  {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# Avg payout of race
avg_groups = defaultdict(lambda: [0, 0])
for r in rows:
    payouts = [int(r[f'Payout{i}']) for i in range(1, 7)]
    avg = statistics.mean(payouts)
    bucket = int(avg // 1) * 1
    if r['Win5'] == '1':
        avg_groups[bucket][0] += 1
    else:
        avg_groups[bucket][1] += 1
iv = calc_iv(avg_groups, base_rate)
print(f"\n  Race Avg Payout (IV={iv:.4f})")
for bucket in sorted(avg_groups.keys()):
    w, l = avg_groups[bucket]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  Avg ~{bucket:<14} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 7. VENUE + ROUND INTERACTION
print(f"\n{'='*60}")
print("  7. VENUE x ROUND INTERACTION")
print(f"{'='*60}")
vr_groups = defaultdict(lambda: [0, 0])
for r in rows:
    key = f"{r['Venue']} R{r['Round']}"
    if r['Win5'] == '1':
        vr_groups[key][0] += 1
    else:
        vr_groups[key][1] += 1
iv = calc_iv(vr_groups, base_rate)
print(f"  IV={iv:.4f}")
for k in sorted(vr_groups.keys()):
    w, l = vr_groups[k]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {k:<25} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 8. VENUE + TIME
print(f"\n{'='*60}")
print("  8. VENUE x TIME INTERACTION")
print(f"{'='*60}")
vt_groups = defaultdict(lambda: [0, 0])
for r in rows:
    key = f"{r['Venue']} {r['Time']}"
    if r['Win5'] == '1':
        vt_groups[key][0] += 1
    else:
        vt_groups[key][1] += 1
iv = calc_iv(vt_groups, base_rate)
print(f"  IV={iv:.4f}")
for k in sorted(vt_groups.keys()):
    w, l = vt_groups[k]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {k:<25} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 9. LOGISTIC REGRESSION for multi-factor signal
print(f"\n{'='*60}")
print("  9. TOP FACTORS RANKED BY INFORMATION VALUE (IV)")
print(f"{'='*60}")
print(f"  IV > 0.10 = medium signal, > 0.30 = strong signal")

# Summarize all IVs
factors = []

# Payout rank
factor_name = "Payout Rank"
iv = calc_iv(rank_groups, base_rate)
factors.append((factor_name, iv, dict(rank_groups)))

# Favorite
iv = calc_iv(fav_groups, base_rate)
factors.append(("Is Favorite", iv, dict(fav_groups)))

# Venue
iv = calc_iv(venue_groups, base_rate)
factors.append(("Venue", iv, dict(venue_groups)))

# Round
iv = calc_iv(round_groups, base_rate)
factors.append(("Round", iv, dict(round_groups)))

# Time
iv = calc_iv(time_groups, base_rate)
factors.append(("Time", iv, dict(time_groups)))

# Player
iv = calc_iv(player_groups, base_rate)
factors.append(("Monster (Slot 5)", iv, dict(player_groups)))

# Venue x Round
iv = calc_iv(vr_groups, base_rate)
factors.append(("Venue x Round", iv, dict(vr_groups)))

# Venue x Time
iv = calc_iv(vt_groups, base_rate)
factors.append(("Venue x Time", iv, dict(vt_groups)))

# Spread
iv = calc_iv(spread_groups, base_rate)
factors.append(("Payout Spread", iv, dict(spread_groups)))

# Avg payout
iv = calc_iv(avg_groups, base_rate)
factors.append(("Race Avg Payout", iv, dict(avg_groups)))

# Payout bins (width=2)
payout_groups2 = defaultdict(lambda: [0, 0])
for r in rows:
    p5 = int(r['Payout5'])
    bucket = (p5 // 2) * 2
    if r['Win5'] == '1':
        payout_groups2[bucket][0] += 1
    else:
        payout_groups2[bucket][1] += 1
iv = calc_iv(payout_groups2, base_rate)
factors.append(("Payout5 Value", iv, dict(payout_groups2)))

for name, iv, _ in sorted(factors, key=lambda x: -x[1]):
    signal = "STRONG" if iv > 0.30 else "MEDIUM" if iv > 0.10 else "weak"
    print(f"  {name:<22} IV={iv:.4f}  [{signal}]")

# 10. CONDITIONAL: Payout Rank + Venue interaction
print(f"\n{'='*60}")
print("  10. PAYOUT RANK x VENUE (slot 5 payout rank within venue)")
print(f"{'='*60}")
prv_groups = defaultdict(lambda: [0, 0])
for r in rows:
    payouts = [int(r[f'Payout{i}']) for i in range(1, 7)]
    p5 = int(r['Payout5'])
    sorted_p = sorted(payouts)
    rank = sorted_p.index(p5) + 1
    key = f"{r['Venue']} Rank{rank}"
    if r['Win5'] == '1':
        prv_groups[key][0] += 1
    else:
        prv_groups[key][1] += 1
iv = calc_iv(prv_groups, base_rate)
print(f"  IV={iv:.4f}")
for k in sorted(prv_groups.keys()):
    w, l = prv_groups[k]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {k:<25} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# 11. For each venue: payout rank distribution for slot 5 wins
print(f"\n{'='*60}")
print("  11. VENUE DEEP DIVE - all slot win rates by venue")
print(f"{'='*60}")
venue_slot_wins = defaultdict(lambda: defaultdict(lambda: [0, 0]))
for r in rows:
    v = r['Venue']
    for s in range(1, 7):
        if r[f'Win{s}'] == '1':
            venue_slot_wins[v][s][0] += 1
        else:
            venue_slot_wins[v][s][1] += 1

for v in sorted(venue_slot_wins.keys()):
    print(f"\n  --- {v} ---")
    total_v = sum(venue_slot_wins[v][s][0] for s in range(1, 7))
    for s in range(1, 7):
        w, l = venue_slot_wins[v][s]
        rate = w / total_v * 100 if total_v > 0 else 0
        bar = '#' * int(rate * 2)
        print(f"  Slot {s}: {rate:5.1f}% ({w:>3}/{total_v:<3}) {bar}")

# 12. Top monster performers in slot 5 (min 10 appearances)
print(f"\n{'='*60}")
print("  12. TOP MONSTERS IN SLOT 5 (>=10 appearances)")
print(f"{'='*60}")
for p in sorted(player_groups.keys(), key=lambda x: -(player_groups[x][0]/(player_groups[x][0]+player_groups[x][1]) if (player_groups[x][0]+player_groups[x][1]) > 0 else 0)):
    w, l = player_groups[p]
    total = w + l
    if total >= 10:
        rate = w / total * 100
        spread = 1.96 * math.sqrt(rate/100 * (1-rate/100) / total) * 100
        print(f"  {p:<20} {rate:5.1f}% ±{spread:4.1f}  ({w:>3}/{total:<3})")

# 13. MULTI-FACTOR: HIGHEST SIGNAL COMBOS
print(f"\n{'='*60}")
print("  13. MULTI-FACTOR ANALYSIS")
print(f"{'='*60}")

# Venue + Favorite
vfav_groups = defaultdict(lambda: [0, 0])
for r in rows:
    payouts = [int(r[f'Payout{i}']) for i in range(1, 7)]
    p5 = int(r['Payout5'])
    is_fav = 1 if p5 == min(payouts) else 0
    key = f"{r['Venue']} {'Fav' if is_fav else 'NotFav'}"
    if r['Win5'] == '1':
        vfav_groups[key][0] += 1
    else:
        vfav_groups[key][1] += 1
print(f"\n  Venue + Favorite Status:")
for k in sorted(vfav_groups.keys()):
    w, l = vfav_groups[k]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {k:<25} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")

# Round + Payout Rank
rdrank_groups = defaultdict(lambda: [0, 0])
for r in rows:
    payouts = [int(r[f'Payout{i}']) for i in range(1, 7)]
    p5 = int(r['Payout5'])
    sorted_p = sorted(payouts)
    rank = sorted_p.index(p5) + 1
    key = f"R{r['Round']} Rank{rank}"
    if r['Win5'] == '1':
        rdrank_groups[key][0] += 1
    else:
        rdrank_groups[key][1] += 1
print(f"\n  Round + Payout Rank:")
for k in sorted(rdrank_groups.keys()):
    w, l = rdrank_groups[k]
    total = w + l
    rate = w / total * 100 if total > 0 else 0
    bar = '#' * int(rate / 2) + ' ' * (50 - int(rate / 2))
    marker = ' <-- HIGH SIGNAL' if abs(rate/100 - base_rate) > 0.08 else ''
    print(f"  {k:<25} {rate:5.1f}% ({w:>3}/{total:<3}) {bar}{marker}")
