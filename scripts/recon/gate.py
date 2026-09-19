"""Evidence gate: a claimed number is accepted only when an INDEPENDENT witness
corroborates it. Mirrors the production rule that evidence-free associations
must not count."""
import sys, collections
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from recon import MX, i, norm_variant
import score as S
from labels import GOLD, NEG_PMMID_PREFIXES
from sweep import ads, fam

def corroboration(num, var, ev):
    """Independent evidence that MC<num> is the creative, ignoring the claim itself."""
    _, p = S.score_candidate(num, var, ev)
    if "exists" in p: return -1.0
    return (p["W0_topic_seq"] / 2.5, p["W2_adset"] / 1.5, p["W4_variant_cov"], p["W4b_superset"] / 0.8)

def decide(x, prior, min_ev, bt=0.95):
    an = x["a"].get("ad_num",""); pn = x["p"].get("number","")
    pmraw = (x["p"].get("raw") or x["a"].get("pmmid") or "")
    if pmraw.startswith(NEG_PMMID_PREFIXES) or x["a"].get("pmmid","").startswith(NEG_PMMID_PREFIXES):
        return None, 0.0, {}, "agency-own numbering"
    av = norm_variant(x["a"].get("ad_var","")) or norm_variant(x["p"].get("variant",""))
    pv = norm_variant(x["p"].get("variant",""))
    ev = {"ptopic": x["p"].get("topic",""), "adset": x["adset"], "fam_variants": fam.get(an,set())}
    named = {}
    if an and an.lstrip("0").isdigit(): named[i(an)] = av
    if pn and pn.lstrip("0").isdigit(): named.setdefault(i(pn), pv)
    pool = S.candidates(ev, named, bt)
    sc = {}
    for n, v in pool.items():
        base, _ = S.score_candidate(n, v or av, ev)
        sc[n] = base + (prior if (an and i(an) == n) else 0.0)
    if not sc: return None, 0.0, {}, "no candidate"
    best = max(sc.items(), key=lambda kv: kv[1])
    corr = corroboration(best[0], pool.get(best[0]) or av, ev)
    strongest = max(corr) if isinstance(corr, tuple) else -1
    if strongest < min_ev:
        return None, 0.0, {k: round(v,2) for k,v in sc.items()}, f"uncorroborated (best witness {strongest:.2f})"
    others = [v for k, v in sc.items() if k != best[0]]
    return best[0], best[1]-(max(others) if others else -99), {k: round(v,2) for k,v in sc.items()}, "ok"

if __name__ == "__main__":
    print(f"{'prior':>6}{'min_ev':>8}{'acc':>8}{'spend':>8}{'FP on agency-own':>18}")
    best=None
    for prior in (0.4, 0.8, 1.2):
        for min_ev in (0.0, 0.25, 0.4, 0.55, 0.7):
            ok=okw=tot=totw=0; fp=0
            for x in ads:
                key=(x["a"].get("ad_num",""), x["p"].get("number",""), norm_variant(x["p"].get("variant","")))
                pmraw=x["a"].get("pmmid","")
                pred,_,_,why = decide(x, prior, min_ev)
                if pmraw.startswith(NEG_PMMID_PREFIXES) or (pmraw and "-m_" not in pmraw):
                    fp += (pred is not None); continue
                if key not in GOLD: continue
                gold,_=GOLD[key]
                g=(pred==gold); tot+=1; totw+=x["spend"]; ok+=g; okw+=x["spend"]*g
            a,w = ok/max(tot,1), okw/max(totw,1)
            sc_=(a+w)/2 - 0.05*fp
            if best is None or sc_>best[0]: best=(sc_,a,w,fp,prior,min_ev)
            print(f"{prior:>6.1f}{min_ev:>8.2f}{a:>8.0%}{w:>8.0%}{fp:>18}")
    print(f"\nBEST acc={best[1]:.0%} spend={best[2]:.0%} false-positives={best[3]}  prior={best[4]} min_ev={best[5]}")
