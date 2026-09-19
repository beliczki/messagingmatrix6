"""Show the full identity footprint of N sampled SZK/SZA messages."""
import sys, collections, random
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

PRODS = {"SZK", "SZA"}
N = int(sys.argv[1]) if len(sys.argv) > 1 else 20
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else 1

# index everything by MC number
mon = collections.defaultdict(list)
for r in B["monitoring"]: mon[(i(r["number"]), norm_variant(r["variant"]))].append(r)
prg = collections.defaultdict(list)
for r in B["prg"]:
    p = parse_mc(r.get("MC"))
    if p: prg[(p["number"], p["variant"])].append(r)
meta = collections.defaultdict(list)
for r in B["meta"]:
    a = parse_meta_ad(r.get("Ad name"))
    if "ad_num" in a: meta[a["ad_num"]].append((a, r))
crea = collections.defaultdict(list)
for r in B["creatives"]: crea[(i(r["number"]), norm_variant(r["variant"]))].append(r)

# candidate pool: matrix (num,var) of SZK/SZA that carry impressions in OUR data
pool = sorted({(i(m["number"]), norm_variant(m["variant"]))
               for m in B["matrix"]
               if m["product"] in PRODS and not i(m["is_draft"])
               and (i(m["number"]), norm_variant(m["variant"])) in mon})
random.seed(SEED)
sample = random.sample(pool, min(N, len(pool)))
print(f"pool={len(pool)} sample={len(sample)} seed={SEED}\n")

for num, var in sorted(sample):
    cells = [m for m in B["matrix"] if i(m["number"]) == num and norm_variant(m["variant"]) == var]
    c0 = cells[0]
    print("=" * 100)
    print(f"MC{num}{var}  product={c0['product']}  cells={len(cells)}  status={collections.Counter(c['status'] for c in cells).most_common()}")
    print(f"  matrix topic(s): {sorted({c['topic'] for c in cells})}")
    print(f"  matrix name    : {c0['name'][:80]!r}  headline={c0['headline'][:40]!r} copy1={c0['copy1'][:50]!r}")
    print(f"  matrix pmmid   : {c0['pmmid'][:110]}")
    fns = sorted({r['file_name'] for r in crea[(num,var)]})
    print(f"  creatives ({len(crea[(num,var)])}): {fns[:3]}")
    m = mon[(num, var)]
    if m:
        agg = collections.Counter()
        for r in m: agg[r["platform"]] += i(r["impressions"])
        pmset = sorted({r["pmmid"][:95] for r in m})[:3]
        print(f"  OUR monitoring : {dict(agg)}  topics={sorted({r['topic_key'] for r in m})[:3]}")
        print(f"                   pmmids: {pmset}")
    p = prg[(num, var)]
    if p:
        print(f"  PRG rows ({len(p)}): impr={sum(i(r['Impressions']) for r in p)} conv={sum(i(r['Conversion']) for r in p)}")
        for r in p[:3]:
            print(f"     {r['Product']!r:<22} {r['Media']:<5} {r['Prospecting/ remarketing']:<12} topic={r['Topic']!r}")
    mt = meta.get(str(num), [])
    if mt:
        print(f"  META ads ({len(mt)}):")
        for a, r in mt[:4]:
            pp = parse_pmmid(a["pmmid"]) or {}
            print(f"     ad={a['ad_num']}{a['ad_var']} dims={a.get('dims')} copy={a['copy']} "
                  f"pmmid[m_{pp.get('number','?')} v_{pp.get('variant','?')} a_{pp.get('audience','?')!r} t_{pp.get('topic','?')[:30]!r}] "
                  f"spend={i(r['Amount spent (HUF)'])} impr={i(r['Impressions'])}")
    print()
