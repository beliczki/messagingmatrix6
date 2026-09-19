import sys, re, collections
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
    ads.append({"a":a,"p":p,"spend":i(r["Amount spent (HUF)"]),"impr":i(r["Impressions"]),
                "results":i(r["Results"]),"rtype":r.get("Result type",""),
                "adset":r.get("Ad set name",""),"camp":r.get("Campaign name","")})
fam=collections.defaultdict(set)
for x in ads:
    if x["a"].get("ad_num"): fam[x["a"]["ad_num"]].add(norm_variant(x["p"].get("variant","")))

ABSTAIN=0.35
def decide(x, broaden=True):
    an=x["a"].get("ad_num",""); pn=x["p"].get("number","")
    av=norm_variant(x["a"].get("ad_var","")) or norm_variant(x["p"].get("variant",""))
    pv=norm_variant(x["p"].get("variant",""))
    ev={"ptopic":x["p"].get("topic",""),"adset":x["adset"],
        "fam_variants":fam.get(an,set()),"dims":x["a"].get("dims","")}
    named={}
    if an and an.lstrip("0").isdigit(): named[i(an)]=av
    if pn and pn.lstrip("0").isdigit(): named.setdefault(i(pn), pv)
    pool = S.candidates(ev, named) if broaden else named
    sc={n:S.score_candidate(n, pool.get(n) or av, ev) for n in pool}
    if not sc: return None,{},0
    best=max(sc.items(), key=lambda kv: kv[1][0])
    others=[v[0] for k,v in sc.items() if k!=best[0]]
    margin=best[1][0]-(max(others) if others else -99)
    return best[0], {k:round(v[0],2) for k,v in sc.items()}, margin

if __name__=="__main__":
    print(f"{'ad':>6} {'pmmid':>7} {'gold':>5} {'pred':>5} {'ok':>3} {'marg':>6}  scores")
    ok=okw=tot=totw=0
    for x in ads:
        key=(x["a"].get("ad_num",""), x["p"].get("number",""), norm_variant(x["p"].get("variant","")))
        if key not in GOLD: continue
        gold,_=GOLD[key]
        pred,sc,margin=decide(x)
        if margin<ABSTAIN: pred=None
        good=(pred==gold); tot+=1; totw+=x["spend"]; ok+=good; okw+=x["spend"]*good
        print(f"{key[0]:>6} {key[1]+key[2]:>7} {str(gold):>5} {str(pred):>5} {'OK' if good else 'XX':>3} {margin:>6.2f}  {sc}")
    print(f"\nGOLD accuracy: {ok}/{tot} = {100*ok/max(tot,1):.0f}%   spend-weighted {100*okw/max(totw,1):.0f}%")
