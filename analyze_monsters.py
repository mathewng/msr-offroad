#!/usr/bin/env python3
"""Deep-dive analysis of monster/player influence on race outcomes."""
import csv
import math
from collections import defaultdict

data = open('data_all.txt').read().strip().split('\n')
reader = csv.DictReader(data, delimiter='\t')
rows = list(reader)
N = len(rows)


def iv(groups, nw, nl):
    iv_ = 0
    for _, (w, l) in groups.items():
        t = w + l
        if t == 0: continue
        pw, pl = w / nw, l / nl
        if pw <= 0 or pl <= 0: continue
        iv_ += (pw - pl) * math.log(pw / pl)
    return iv_


def show(grp, nw, nl, label, base, min_total=3, top=200):
    iv_ = iv(grp, nw, nl)
    print(f"\n  {label}  (IV={iv_:.4f}, baseline={base*100:.1f}%)")
    sorted_items = sorted(grp.items(), key=lambda x: -(x[1][0] / (x[1][0] + x[1][1]) if x[1][0] + x[1][1] > 0 else 0))
    shown = 0
    for key, (w, l) in sorted_items:
        t = w + l
        if t < min_total: continue
        rate = w / t * 100
        marker = ' <<< HIGH' if abs(rate / 100 - base) > 0.08 else ''
        print(f"    {key:<40} {rate:6.1f}% ({w:>3}/{t:<3}){marker}")
        shown += 1
        if shown >= top: break
    return iv_


# Gather all monster data per race
print("=" * 70)
print("  1. MONSTER WIN RATES (regardless of slot)")
print("=" * 70)

monster_wins = defaultdict(lambda: [0, 0])  # monster -> [wins, total_races_present]
monster_by_slot = defaultdict(lambda: defaultdict(lambda: [0, 0]))  # monster -> slot -> [wins, races]
monster_by_venue = defaultdict(lambda: defaultdict(lambda: [0, 0]))  # monster -> venue -> [wins, races]
monster_by_venue_slot = defaultdict(lambda: defaultdict(lambda: [0, 0]))  # monster -> venue/slot -> [wins, races]

for r in rows:
    winning_slot = None
    for s in range(1, 7):
        if r[f'Win{s}'] == '1':
            winning_slot = s
            break

    monsters_present = set()
    for s in range(1, 7):
        m = r[f'Player{s}'] if r[f'Player{s}'] else 'Human'
        monsters_present.add(m)
        if winning_slot == s:
            monster_wins[m][0] += 1
            monster_by_slot[m][s][0] += 1
            monster_by_venue[m][r['Venue']][0] += 1
            monster_by_venue_slot[m][f"{r['Venue']} S{s}"][0] += 1
        else:
            monster_wins[m][1] += 1
            monster_by_slot[m][s][1] += 1
            monster_by_venue[m][r['Venue']][1] += 1
            monster_by_venue_slot[m][f"{r['Venue']} S{s}"][1] += 1

# Overall monster win rate
total_non_human_races = sum(w + l for m, (w, l) in monster_wins.items() if m != 'Human')
total_non_human_wins = sum(w for m, (w, l) in monster_wins.items() if m != 'Human')
print(f"  Human-controlled slots: {monster_wins['Human'][0] + monster_wins['Human'][1]}")
print(f"  Monster-controlled slots: {total_non_human_races}")
print(f"  Monster win rate: {total_non_human_wins/total_non_human_races*100:.1f}% vs Human {monster_wins['Human'][0]/monster_wins['Human'][1]*100:.1f}%")

nw_total = sum(w for _, (w, _) in monster_wins.items())
nl_total = sum(l for _, (_, l) in monster_wins.items())
print(f"\n  --- All monsters (>=10 appearances) ---")
_ = show(monster_wins, nw_total, nl_total, "", sum(w for _, (w, _) in monster_wins.items()) / (nw_total + nl_total), min_total=10)

# Distribution: how many races have 0, 1, 2+ monsters
print(f"\n{'='*70}")
print("  2. MONSTER DENSITY PER RACE")
print("=" * 70)
monster_counts = defaultdict(int)
for r in rows:
    count = sum(1 for s in range(1, 7) if r[f'Player{s}'])
    monster_counts[count] += 1
for c in sorted(monster_counts.keys()):
    pct = monster_counts[c] / N * 100
    print(f"  {c} monsters: {monster_counts[c]:>4} races ({pct:.1f}%)")

# Check: Do specific monsters appear in specific slots consistently?
print(f"\n{'='*70}")
print("  3. MONSTER x SLOT PREFERENCE (how often each monster appears in each slot)")
print("=" * 70)
slot_counts = defaultdict(lambda: defaultdict(int))  # monster -> slot -> count
for r in rows:
    for s in range(1, 7):
        m = r[f'Player{s}'] if r[f'Player{s}'] else 'Human'
        slot_counts[m][s] += 1

for m in sorted(slot_counts.keys()):
    if m == 'Human':
        continue
    total = sum(slot_counts[m].values())
    if total < 10:
        continue
    dist = [f"S{s}:{slot_counts[m][s]}({slot_counts[m][s]/total*100:.0f}%)" for s in range(1, 7) if slot_counts[m][s] > 0]
    print(f"  {m:<30} (n={total:>3})  {'  '.join(dist)}")

# 4. MONSTER x SLOT WIN RATES
print(f"\n{'='*70}")
print("  4. MONSTER x SLOT WIN RATES (monsters with >=8 appearances in a slot)")
print("=" * 70)
# First check: does a monster's win rate vary SIGNIFICANTLY by slot?
for m in sorted(monster_by_slot.keys()):
    if m == 'Human':
        continue
    total_appearances = sum(w + l for _, (w, l) in monster_by_slot[m].items())
    if total_appearances < 10:
        continue

    overall_w = monster_wins[m][0]
    overall_t = monster_wins[m][0] + monster_wins[m][1]
    overall_rate = overall_w / overall_t * 100

    # Check if any slot differs by >15pp from overall rate
    has_variation = False
    slot_rates = []
    for s in range(1, 7):
        w, l = monster_by_slot[m][s]
        t = w + l
        if t < 5:
            continue
        rate = w / t * 100
        slot_rates.append((s, w, t, rate))
        if abs(rate - overall_rate) > 15:
            has_variation = True

    if has_variation or total_appearances >= 25:
        parts = [f"overall={overall_rate:.1f}% ({overall_w}/{overall_t})"]
        for s, w, t, rate in sorted(slot_rates):
            delta = rate - overall_rate
            parts.append(f"S{s}={rate:.0f}% ({w}/{t}){' (Δ{:+d}pp)'.format(int(delta)) if abs(delta) > 8 else ''}")
        print(f"  {m:<30} {'  '.join(parts)}")

# 5. MONSTER x VENUE WIN RATES
print(f"\n{'='*70}")
print("  5. MONSTER x VENUE WIN RATES (monsters with >=8 appearances in a venue)")
print("=" * 70)
for m in sorted(monster_by_venue.keys()):
    if m == 'Human':
        continue
    total_app = sum(w + l for _, (w, l) in monster_by_venue[m].items())
    if total_app < 10:
        continue
    overall_w = monster_wins[m][0]
    overall_t = monster_wins[m][0] + monster_wins[m][1]
    overall_rate = overall_w / overall_t * 100

    has_variation = False
    venue_rates = []
    for v in sorted(monster_by_venue[m].keys()):
        w, l = monster_by_venue[m][v]
        t = w + l
        if t < 5:
            continue
        rate = w / t * 100
        venue_rates.append((v, w, t, rate))
        if abs(rate - overall_rate) > 15:
            has_variation = True

    if has_variation or total_app >= 25:
        parts = [f"overall={overall_rate:.1f}% ({overall_w}/{overall_t})"]
        for v, w, t, rate in sorted(venue_rates, key=lambda x: -x[3]):
            delta = rate - overall_rate
            parts.append(f"{v}={rate:.0f}% ({w}/{t}){' (Δ{:+d}pp)'.format(int(delta)) if abs(delta) > 8 else ''}")
        print(f"  {m:<30} {'  '.join(parts)}")

# 6. MONSTER x VENUE x SLOT
print(f"\n{'='*70}")
print("  6. MONSTER x VENUE x SLOT (>=3 races per combo)")
print("=" * 70)
# Overall human win rate baseline
human_rate = monster_wins['Human'][0] / (monster_wins['Human'][0] + monster_wins['Human'][1])

combos = []
for m in sorted(monster_by_venue_slot.keys()):
    if m == 'Human':
        continue
    for key, (w, l) in monster_by_venue_slot[m].items():
        t = w + l
        if t < 3:
            continue
        rate = w / t * 100
        lift = rate / (human_rate * 100)
        combos.append((m, key, w, t, rate, lift))

combos.sort(key=lambda x: -x[4])
print(f"  Human baseline win rate: {human_rate*100:.1f}%")
print(f"\n  TOP 30 (highest win rate):")
for m, key, w, t, rate, lift in combos[:30]:
    print(f"  {m:<25} {key:<15} {rate:6.1f}% ({w:>2}/{t:<2}) x{lift:.2f} vs Human")

print(f"\n  BOTTOM 15 (lowest win rate, >=3 races):")
for m, key, w, t, rate, lift in combos[-15:]:
    print(f"  {m:<25} {key:<15} {rate:6.1f}% ({w:>2}/{t:<2}) x{lift:.2f} vs Human")

# 7. LOGISTIC: Does monster identity alone predict winning?
print(f"\n{'='*70}")
print("  7. SAME MONSTER: consistency across slots")
print("=" * 70)
# For each monster with enough data, check if win rate is similar regardless of slot
for m in sorted(monster_by_slot.keys()):
    if m == 'Human':
        continue
    slot_data = [(s, monster_by_slot[m][s][0], monster_by_slot[m][s][0] + monster_by_slot[m][s][1])
                 for s in range(1, 7) if monster_by_slot[m][s][0] + monster_by_slot[m][s][1] >= 5]
    if len(slot_data) < 2:
        continue
    rates = [w / t for _, w, t in slot_data]
    max_rate, min_rate = max(rates), min(rates)
    # If win rate varies by more than 20pp between slots
    if max_rate - min_rate > 0.20:
        overall = monster_wins[m][0] / (monster_wins[m][0] + monster_wins[m][1]) * 100
        parts = [f"overall={overall:.0f}%"]
        for s, w, t in sorted(slot_data, key=lambda x: -x[1] / x[2]):
            parts.append(f"S{s}:{w/t*100:.0f}%({w}/{t})")
        print(f"  {m:<30} VARIABLE: {'  '.join(parts)}")

# 8. If a monster is GOOD in general vs GOOD only in specific contexts
print(f"\n{'='*70}")
print("  8. TOP MONSTERS: are they globally good or context-dependent?")
print("=" * 70)
human_w = monster_wins['Human'][0]
human_l = monster_wins['Human'][1]
human_rate = human_w / (human_w + human_l)

# Find monsters with overall win rate > 25% (well above human)
strong_monsters = []
for m, (w, l) in monster_wins.items():
    if m == 'Human':
        continue
    t = w + l
    if t < 10:
        continue
    rate = w / t
    if rate > 0.25:
        strong_monsters.append((m, w, t, rate))

strong_monsters.sort(key=lambda x: -x[3])
print(f"  Strong monsters (win rate >25%, >=10 races):")
for m, w, t, rate in strong_monsters:
    # Check slot distribution
    slots = [(s, monster_by_slot[m][s][0], monster_by_slot[m][s][0] + monster_by_slot[m][s][1])
             for s in range(1, 7) if monster_by_slot[m][s][0] + monster_by_slot[m][s][1] >= 3]
    slot_summary = '  '.join([f"S{s}:{wt}/{t}" for s, wt, t in sorted(slots, key=lambda x: -x[2])])
    print(f"  {m:<30} {w/t*100:5.1f}% ({w:>3}/{t:<3})  slots: {slot_summary}")

# 9. Monsters that are extremely BAD
print(f"\n{'='*70}")
print("  9. WEAK MONSTERS (win rate <10%, >=10 races)")
print("=" * 70)
for m, (w, l) in sorted(monster_wins.items(), key=lambda x: x[1][0] / (x[1][0] + x[1][1]) if x[1][0] + x[1][1] > 0 else 1):
    if m == 'Human':
        continue
    t = w + l
    if t < 10:
        continue
    rate = w / t
    if rate < 0.10:
        slots = [(s, monster_by_slot[m][s][0], monster_by_slot[m][s][0] + monster_by_slot[m][s][1])
                 for s in range(1, 7) if monster_by_slot[m][s][0] + monster_by_slot[m][s][1] >= 3]
        slot_summary = '  '.join([f"S{s}:{wt}/{t}" for s, wt, t in sorted(slots, key=lambda x: -x[2])])
        print(f"  {m:<30} {w/t*100:5.1f}% ({w:>3}/{t:<3})  slots: {slot_summary}")

# 10. MODEL: Best single-variable IV for monster vs monster+slot vs monster+venue+slot
print(f"\n{'='*70}")
print("  10. INFORMATION VALUE COMPARISON")
print("=" * 70)
nw_total = sum(w for _, (w, _) in monster_wins.items())
nl_total = sum(l for _, (_, l) in monster_wins.items())

iv_monster = iv(monster_wins, nw_total, nl_total)
print(f"  Monster alone:             IV={iv_monster:.4f}")

# Monster x Slot
ms_groups = defaultdict(lambda: [0, 0])
for m in monster_by_slot:
    for s in range(1, 7):
        w, l = monster_by_slot[m][s]
        if w + l > 0:
            ms_groups[f"{m} S{s}"][0] += w
            ms_groups[f"{m} S{s}"][1] += l
iv_ms = iv(ms_groups, nw_total, nl_total)
print(f"  Monster x Slot:            IV={iv_ms:.4f}")

# Monster x Venue
mv_groups = defaultdict(lambda: [0, 0])
for m in monster_by_venue:
    for v in monster_by_venue[m]:
        w, l = monster_by_venue[m][v]
        if w + l > 0:
            mv_groups[f"{m} {v}"][0] += w
            mv_groups[f"{m} {v}"][1] += l
iv_mv = iv(mv_groups, nw_total, nl_total)
print(f"  Monster x Venue:           IV={iv_mv:.4f}")

# Monster x Venue x Slot
mvs_groups = defaultdict(lambda: [0, 0])
for m in monster_by_venue_slot:
    for vs in monster_by_venue_slot[m]:
        w, l = monster_by_venue_slot[m][vs]
        if w + l > 0:
            mvs_groups[f"{m} {vs}"][0] += w
            mvs_groups[f"{m} {vs}"][1] += l
iv_mvs = iv(mvs_groups, nw_total, nl_total)
print(f"  Monster x Venue x Slot:    IV={iv_mvs:.4f}")

# Compare to Venue x Slot (no monster)
vs_groups = defaultdict(lambda: [0, 0])
for r in rows:
    for s in range(1, 7):
        key = f"{r['Venue']} S{s}"
        if r[f'Win{s}'] == '1':
            vs_groups[key][0] += 1
        else:
            vs_groups[key][1] += 1
iv_vs = iv(vs_groups, nw_total, nl_total)
print(f"  Venue x Slot (no monster): IV={iv_vs:.4f}")

# Venue x Round x Slot
vrs_groups = defaultdict(lambda: [0, 0])
for r in rows:
    for s in range(1, 7):
        key = f"{r['Venue']} R{r['Round']} S{s}"
        if r[f'Win{s}'] == '1':
            vrs_groups[key][0] += 1
        else:
            vrs_groups[key][1] += 1
iv_vrs = iv(vrs_groups, nw_total, nl_total)
print(f"  Venue x Round x Slot:      IV={iv_vrs:.4f}")

print(f"\n{'='*70}")
print("  TOP OVERALL COMBOS (all monster x venue x slot, >=3 races)")
print("=" * 70)
combos.sort(key=lambda x: -x[4])
for m, key, w, t, rate, lift in combos[:50]:
    print(f"  {m:<25} {key:<15} {rate:6.1f}% ({w:>2}/{t:<2}) x{lift:.2f} vs baseline")
