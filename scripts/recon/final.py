import sys, collections
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from recon import MX, i, norm_variant
import score as S

def axis(r):
    if r["template"] or r["buy_platform"] or r["headline"]: return "DCO"
    if parse_filename(r["name"]): return "NONDCO"
    return "OTHER"

print("### 1. IDENTITY AMBIGUITY IN THE MATRIX ###")
for label, keyfn in [
    ("(number, variant)                      ", lambda r:(i(r["number"]),norm_variant(r["variant"]))),
    ("(axis, number, variant)                ", lambda r:(axis(r),i(r["number"]),norm_variant(r["variant"]))),
    ("(axis, number, variant) ignoring SIZE  ", lambda r:(axis(r),i(r["number"]),norm_variant(r["variant"]))),
]:
    g=collections.defaultdict(set)
    for r in MX.rows:
        f=parse_filename(r["name"])
        val=(f["concept"] if (f and "SIZE" in label) else (r["name"],r["headline"]))
        g[keyfn(r)].add(val)
    amb=sum(1 for v in g.values() if len(v)>1)
    print(f"  {label} groups={len(g):>4}  ambiguous={amb:>4}  ({100*amb/len(g):>4.1f}%)")

print("\n### 2. WHAT CARRIES THE IDENTITY, AND WHERE IT BREAKS ###")
mon=B["monitoring"]
TOT=sum(i(r["impressions"]) for r in mon)
c=collections.Counter()
for r in mon:
    p=parse_pmmid(r["pmmid"]) or {}
    w=i(r["impressions"])
    c["pmmid present"]+=w
    c["  carries an MC (-m_ != 00)"]+= w if i(r["number"])!=0 else 0
    c["  carries strategy (-s_)"]+= w if p.get("strategy") else 0
    c["  carries lineitem (-l_)"]+= w if "-l_" in r["pmmid"] else 0
    c["  version -n_ present"]+= w if "-n_" in r["pmmid"] else 0
for k,v in c.items(): print(f"  {k:<34}{v:>12,}{100*v/TOT:>7.1f}%")
# version drift
drift=same=0
for r in mon:
    p=parse_pmmid(r["pmmid"]) or {}
    k=f'{i(r["number"])}|{norm_variant(r["variant"])}'
    mv={r2["version_no"] for r2 in MX.by_nv.get(k,[])}
    tv=(p.get("version","") or "").split("-")[0]
    if not mv or not tv.isdigit(): continue
    (same:=same+1) if int(tv) in {int(x) for x in mv} else (drift:=drift+1)
print(f"  -n_ version equals matrix version_no: {same} rows;  drifted: {drift} rows ({100*drift/max(same+drift,1):.0f}%)")

print("\n### 3. STORED vs RECOMPUTED MATCH (the frozen-snapshot problem) ###")
stored=collections.Counter()
for r in mon: stored[r["match_level"] or "null"]+=i(r["impressions"])
print("  stored at import time :", {k:f"{100*v/TOT:.1f}%" for k,v in stored.most_common()})
now=collections.Counter()
for r in mon:
    n,v=i(r["number"]),norm_variant(r["variant"])
    w=i(r["impressions"])
    if n==0: now["no MC in traffic"]+=w; continue
    if MX.by_exact.get(f'{n}|{v}|{r["audience_key"].lower()}|{r["topic_key"].lower()}'): now["exact"]+=w
    elif MX.by_nv.get(f"{n}|{v}"): now["family"]+=w
    else: now["null"]+=w
print("  recomputed today      :", {k:f"{100*v/TOT:.1f}%" for k,v in now.most_common()})
