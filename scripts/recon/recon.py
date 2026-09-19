"""Layered, scored reconciliation between the four identity spaces.

Each matcher LAYER is a named rule with a confidence. Layers are tried in order;
the first that yields exactly one candidate wins. Every layer records how much
traffic (impressions / spend) it explains, so adding a rule is measurable.
"""
import sys, re, collections, json
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# ---------------------------------------------------------------- matrix index
class Matrix:
    def __init__(self, rows):
        self.rows = [r for r in rows if not i(r["is_draft"])]
        self.by_exact = collections.defaultdict(list)   # num|var|aud|topic
        self.by_nvt   = collections.defaultdict(list)   # num|var|topic
        self.by_nv    = collections.defaultdict(list)   # num|var
        self.by_n     = collections.defaultdict(list)   # num
        self.by_topic = collections.defaultdict(list)
        for r in self.rows:
            n, v = i(r["number"]), norm_variant(r["variant"])
            t, a = r["topic"].lower(), r["audience"].lower()
            self.by_exact[f"{n}|{v}|{a}|{t}"].append(r)
            self.by_nvt[f"{n}|{v}|{t}"].append(r)
            self.by_nv[f"{n}|{v}"].append(r)
            self.by_n[n].append(r)
            self.by_topic[t].append(r)
    def cells(self, key, idx):
        return getattr(self, idx).get(key, [])

MX = Matrix(B["matrix"])

def cellset(rows):
    """Collapse matrix rows to the logical message identity they agree on."""
    return {(i(r["number"]), norm_variant(r["variant"])) for r in rows}

# ------------------------------------------------------------------- reporting
class Coverage:
    def __init__(self, name, weight_key):
        self.name, self.wk = name, weight_key
        self.layer = collections.Counter(); self.lw = collections.Counter()
        self.total = 0; self.n = 0
    def hit(self, layer, row):
        w = i(row[self.wk]); self.layer[layer] += 1; self.lw[layer] += w
        self.total += w; self.n += 1
    def report(self):
        print(f"\n{'='*78}\n{self.name}   rows={self.n}  {self.wk}={self.total:,}")
        print(f"{'layer':<34}{'rows':>7}{'weight':>14}{'w%':>8}")
        for k, w in self.lw.most_common():
            print(f"  {k:<32}{self.layer[k]:>7}{w:>14,}{100*w/max(self.total,1):>7.1f}%")
        ok = sum(w for k, w in self.lw.items() if not k.startswith("X"))
        print(f"  {'-- RESOLVED':<32}{'':>7}{ok:>14,}{100*ok/max(self.total,1):>7.1f}%")
        return ok / max(self.total, 1)

# =============================================================== TARGET C
# our imported monitoring rows -> matrix message  (what production does today)
def target_C(version="v0"):
    cov = Coverage(f"C · monitoring -> matrix  [{version}]", "impressions")
    resid = []
    for r in B["monitoring"]:
        n, v = i(r["number"]), norm_variant(r["variant"])
        aud, top = r["audience_key"].lower(), r["topic_key"].lower()
        if n == 0:
            cov.hit("X0 m_00 (no MC by design)", r); resid.append(("m_00", r)); continue
        if MX.by_exact.get(f"{n}|{v}|{aud}|{top}"):
            cov.hit("1 exact 4-part", r); continue
        fam = MX.by_nv.get(f"{n}|{v}", [])
        if len(cellset(fam)) == 1 and fam:
            cov.hit("2 family (num+var unique)", r); continue
        if fam:
            cov.hit("X3 family_known (fans out)", r); resid.append(("fanout", r)); continue
        if version != "v0":
            # --- rules added by sampling live here ---
            pass
        cov.hit("X9 no match", r); resid.append(("nomatch", r))
    cov.report()
    return resid

if __name__ == "__main__":
    resid = target_C("v0")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resid_C.json")
    json.dump([{"why": w, **r} for w, r in resid], open(out, "w"), ensure_ascii=False)
    print(f"\nresidual written: {out}")
