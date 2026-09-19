"""PRG (agency programmatic) <-> our monitoring.

Two independent questions, deliberately kept apart:
  Q_ID   can the key be resolved at all?      (measurable on everything)
  Q_VOL  do the numbers agree?                (only on the period-aligned subset:
         PRG is Jan-Aug, we hold May-Aug, so only creatives that STARTED in Q3
         can be compared volume-for-volume)
"""
import sys, re, collections
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from recon import MX, i, norm_variant
import score as S

MEDIA2PLAT = {"PBU": {"adform"}, "Flex": {"dv360"}}
STRAT = {"prospecting": "pro", "remarketing": "rem"}

# our monitoring, indexed by (num, var) and by (num, var, platform, strategy)
ours = collections.defaultdict(lambda: collections.Counter())
ours_ps = collections.defaultdict(lambda: collections.Counter())
for r in B["monitoring"]:
    k = (i(r["number"]), norm_variant(r["variant"]))
    p = parse_pmmid(r["pmmid"]) or {}
    st = p.get("strategy", "")
    for f in ("impressions", "clicks", "cost", "conversions"):
        ours[k][f] += i(r[f])
        ours_ps[(k[0], k[1], r["platform"], st)][f] += i(r[f])
    ours[k]["_topics"] = 0
ours_topics = collections.defaultdict(set)
for r in B["monitoring"]:
    ours_topics[(i(r["number"]), norm_variant(r["variant"]))].add(r["topic_key"].lower())

prg = []
for r in B["prg"]:
    m = parse_mc(str(r.get("MC", "")))
    prg.append({"mc": m, "row": r,
                "impr": i(r["Impressions"]), "clicks": i(r["Clicks"]),
                "conv": i(r["Conversion"]), "topic": str(r.get("Topic", "")),
                "media": str(r.get("Media", "")), "pr": str(r.get("Prospecting/ remarketing", "")),
                "product": str(r.get("Product", "")), "cp": str(r.get("Conversion point", ""))})

TOT = sum(p["impr"] for p in prg)
print(f"PRG rows={len(prg)} impressions={TOT:,} conversions={sum(p['conv'] for p in prg):,}\n")

# ---------------- Q_ID ----------------
lay = collections.Counter(); layw = collections.Counter(); unres = []
for p in prg:
    m = p["mc"]
    if not m: lay["X un-parseable MC label"] += 1; layw["X un-parseable MC label"] += p["impr"]; continue
    k = (m["number"], m["variant"])
    if m["number"] == 0:
        lay["X MC00 (agency static, no MC)"] += 1; layw["X MC00 (agency static, no MC)"] += p["impr"]; continue
    in_mx = bool(MX.by_nv.get(f"{k[0]}|{k[1]}"))
    in_us = k in ours
    tmatch = p["topic"].lower() in ours_topics.get(k, set()) or \
             any(S.norm_topic(p["topic"]) == S.norm_topic(t) for t in ours_topics.get(k, set()))
    if in_mx and in_us and tmatch: key = "1 MC + topic both agree"
    elif in_mx and in_us:          key = "2 MC agrees, topic differs"
    elif in_mx:                    key = "3 in matrix, absent from our monitoring"
    elif in_us:                    key = "4 in our monitoring, absent from matrix"
    else:                          key = "X MC unknown on both sides"; unres.append(p)
    lay[key] += 1; layw[key] += p["impr"]
print(f"{'Q_ID layer':<40}{'rows':>6}{'impressions':>14}{'%':>7}")
for k in sorted(layw, key=lambda x: -layw[x]):
    print(f"  {k:<38}{lay[k]:>6}{layw[k]:>14,}{100*layw[k]/TOT:>6.1f}%")
ok = sum(v for k, v in layw.items() if not k.startswith("X"))
print(f"  {'== IDENTIFIED':<38}{'':>6}{ok:>14,}{100*ok/TOT:>6.1f}%")

# ---------------- Q_VOL ----------------
print("\nQ_VOL — period-aligned subset (MC >= 314: Q3 creatives that only ran May-Aug)")
rows = []
for p in prg:
    m = p["mc"]
    if not m or m["number"] < 314: continue
    k = (m["number"], m["variant"])
    if k not in ours: continue
    rows.append((k, p["impr"], ours[k]["impressions"], p["conv"], ours[k]["conversions"],
                 ours[k]["cost"]))
agg = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
for k, pi_, oi, pc, oc, ocost in rows:
    a = agg[k]; a[0] += pi_; a[1] = oi; a[2] += pc; a[3] = oc; a[4] = ocost
pi_t = sum(a[0] for a in agg.values()); oi_t = sum(a[1] for a in agg.values())
pc_t = sum(a[2] for a in agg.values()); oc_t = sum(a[3] for a in agg.values())
print(f"  MCs compared            : {len(agg)}")
print(f"  impressions  PRG={pi_t:>11,}   ours={oi_t:>11,}   ours/PRG={oi_t/max(pi_t,1):.3f}")
print(f"  conversions  PRG={pc_t:>11,}   ours={oc_t:>11,}   ours/PRG={oc_t/max(pc_t,1):.3f}")
rat = sorted(a[1]/max(a[0],1) for a in agg.values())
print(f"  per-MC impression ratio : median={rat[len(rat)//2]:.3f} min={rat[0]:.3f} max={rat[-1]:.3f}")
print(f"  cost: ours={sum(a[4] for a in agg.values()):,} Ft   PRG has NO cost column")

# strategy split we currently throw away
print("\nStrategy dimension — PRG reports it, our schema drops it:")
ps = collections.Counter()
for p in prg:
    if p["mc"] and p["mc"]["number"] >= 314: ps[(p["media"], p["pr"])] += p["impr"]
print("  PRG  :", {f"{k[0]}/{k[1]}": f"{v:,}" for k, v in ps.most_common()})
os_ = collections.Counter()
for (n, v, plat, st), c in ours_ps.items():
    if n >= 314: os_[(plat, st)] += c["impressions"]
print("  ours :", {f"{k[0]}/{k[1] or '?'}": f"{v:,}" for k, v in os_.most_common(6)})
