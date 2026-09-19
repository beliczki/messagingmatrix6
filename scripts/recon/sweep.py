import sys, collections, itertools
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from recon import MX, i, norm_variant
import score as S
from labels import GOLD

ads=[]
for r in B["meta"]:
    if r.get("Ad name") in ("All","",None): continue
    a=parse_meta_ad(r["Ad name"]); p=parse_pmmid(a["pmmid"]) or {}
    ads.append({"a":a,"p":p,"spend":i(r["Amount spent (HUF)"]),"adset":r.get("Ad set name","")})
fam=collections.defaultdict(set)
for x in ads:
    if x["a"].get("ad_num"): fam[x["a"]["ad_num"]].add(norm_variant(x["p"].get("variant","")))

def decide(x, prior, abstain, broaden_thresh):
    an=x["a"].get("ad_num",""); pn=x["p"].get("number","")
    av=norm_variant(x["a"].get("ad_var","")) or norm_variant(x["p"].get("variant",""))
    pv=norm_variant(x["p"].get("variant",""))
    ev={"ptopic":x["p"].get("topic",""),"adset":x["adset"],"fam_variants":fam.get(an,set())}
    named={}
    if an and an.lstrip("0").isdigit(): named[i(an)]=av
    if pn and pn.lstrip("0").isdigit(): named.setdefault(i(pn),pv)
    pool=S.candidates(ev,named,broaden_thresh) if broaden_thresh<=1 else named
    sc={}
    for n,v in pool.items():
        base,_=S.score_candidate(n, v or av, ev)
        sc[n]=base + (prior if (an and i(an)==n) else 0.0)
    if not sc: return None,0,{}
    best=max(sc.items(), key=lambda kv: kv[1])
    others=[v for k,v in sc.items() if k!=best[0]]
    return best[0], best[1]-(max(others) if others else -99), sc

def evaluate(prior, abstain, bt):
    ok=okw=tot=totw=0
    for x in ads:
        key=(x["a"].get("ad_num",""), x["p"].get("number",""), norm_variant(x["p"].get("variant","")))
        if key not in GOLD: continue
        gold,_=GOLD[key]
        pred,margin,_=decide(x,prior,abstain,bt)
        if margin<abstain: pred=None
        g=(pred==gold); tot+=1; totw+=x["spend"]; ok+=g; okw+=x["spend"]*g
    return ok/max(tot,1), okw/max(totw,1), tot

if __name__=="__main__":
    print(f"{'prior':>6}{'abst':>6}{'broaden':>9}{'acc':>8}{'spend-acc':>11}")
    best=None
    for prior in (0.0,0.4,0.8,1.2,1.6,2.0):
        for abstain in (0.0,0.2,0.35,0.6):
            for bt in (0.95, 2.0):   # 2.0 == broadening off
                a,w,n=evaluate(prior,abstain,bt)
                if best is None or (a+w)>(best[0]+best[1]): best=(a,w,prior,abstain,bt)
                if abstain in (0.0,0.35):
                    print(f"{prior:>6.1f}{abstain:>6.2f}{('on' if bt<=1 else 'off'):>9}{a:>8.0%}{w:>11.0%}")
    print(f"\nBEST acc={best[0]:.0%} spend={best[1]:.0%}  prior={best[2]} abstain={best[3]} broaden={'on' if best[4]<=1 else 'off'}")
