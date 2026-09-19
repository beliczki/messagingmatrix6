"""Quantified adjudication. Witness weights were fitted on the hand-labelled GOLD set.

Key structural fact exploited by W0: the pmmid is generated as
    p_<bp>-s_<strat>-a_<aud>-m_<num>-t_<TOPIC_KEY>-v_<var>-n_<ver>
so the t_ segment is the matrix TOPIC KEY VERBATIM (minus the product prefix on
Meta). Sequence similarity against the candidate's topic is therefore a far
stronger witness than bag-of-words overlap.
"""
import sys, re, collections, math
import os
from difflib import SequenceMatcher
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
from recon import MX, i, norm_variant

PRODUCTS = {"szk","sza","hk","val","hitel","market","ltp"}
STOP = PRODUCTS | {"na","erste","png","jpg","n1","n2","n3","n4","n5"}

def toks(s):
    return {t for t in re.split(r"[^0-9a-záéíóöőúüű]+", (s or "").lower()) if len(t) > 3 and t not in STOP}

def norm_topic(t):
    """Strip product prefix and punctuation so pmmid t_ and matrix topic are comparable."""
    t = (t or "").lower().strip()
    parts = t.split("_")
    while parts and parts[0] in PRODUCTS: parts = parts[1:]
    return re.sub(r"[^a-z0-9]", "", "_".join(parts))

_df = collections.Counter(); _N = 0
for r in MX.rows:
    _N += 1
    for t in toks(r["topic"]) | toks(r["name"]) | toks(r["headline"]): _df[t] += 1
def idf(t): return math.log((_N + 1) / (_df.get(t, 0) + 1))

_desc = {}
def descriptors(num, var=None):
    k = (num, var)
    if k in _desc: return _desc[k]
    out = set()
    for r in MX.by_n.get(num, []):
        if var and norm_variant(r["variant"]) != var: continue
        out |= toks(r["topic"]) | toks(r["name"]) | toks(r["headline"]) | toks(r["copy1"])
        f = parse_filename(r["name"])
        if f: out |= toks(f["concept"])
    for r in B["creatives"]:
        if i(r["number"]) != num: continue
        if var and norm_variant(r["variant"]) != var: continue
        f = parse_filename(r["file_name"])
        if f: out |= toks(f["concept"])
    _desc[k] = out; return out

_tops = {}
def topics_of(num):
    if num in _tops: return _tops[num]
    s = {norm_topic(r["topic"]) for r in MX.by_n.get(num, []) if r["topic"]}
    for r in B["creatives"]:
        if i(r["number"]) == num:
            f = parse_filename(r["file_name"])
            if f: s.add(norm_topic(f["concept"]))
    _tops[num] = s; return s

def variants_of(num):
    return {norm_variant(r["variant"]) for r in MX.by_n.get(num, [])}

def wsim(a, b):
    if not a: return 0.0
    den = sum(idf(t) for t in a)
    return sum(idf(t) for t in a & b) / den if den else 0.0

def seqsim(a, b):
    return SequenceMatcher(None, a, b).ratio() if a and b else 0.0

def blocksim(a, b):
    """How much of `a` is covered by the longest contiguous block shared with `b`.
    Robust to the extra tokens the matrix topic carries (quarter suffix, product
    prefix, template name) that the trafficked t_ segment drops."""
    if not a or not b: return 0.0
    m = SequenceMatcher(None, a, b).find_longest_match(0, len(a), 0, len(b))
    return m.size / len(a)

PRESETS = {"auto":"auto","lakas":"lakas","hitelkivaltas":"hitelkivaltas","felujitas":"felujitas",
           "kert":"kert","szabad":"szabad","varatlan":"varatlan","gamer":"gamer"}

def score_candidate(num, var, ev):
    if not MX.by_n.get(num): return (-9.0, {"exists": 0})
    p = {}
    pt_raw = norm_topic(ev["ptopic"])
    tset = topics_of(num)
    p["W0_topic_seq"]  = 2.5 * max([seqsim(pt_raw, t) for t in tset] or [0])
    p["W0b_topic_blk"] = 0.6 * max([blocksim(pt_raw, t) for t in tset] or [0])
    pt = toks(ev["ptopic"]); d_all = descriptors(num); d_var = descriptors(num, var)
    p["W1_topic_toks"] = 1.2 * max(wsim(pt, d_all), wsim(pt, d_var) if d_var else 0)
    at = toks(ev["adset"]) & set(PRESETS)
    p["W2_adset"]      = 1.5 * (wsim(at, d_all) if at else 0.0)
    rem_ad = bool(re.search(r"!ret!|retargeting|_rem\b|_rem_", ev["adset"] + " " + ev["ptopic"]))
    rem_mc = any(re.search(r"\brem|retarget", (r["topic"] + r["name"]).lower()) for r in MX.by_n.get(num, []))
    p["W3_strategy"]   = 0.8 * (1 if rem_ad == rem_mc else -1)
    mv = variants_of(num); fv = ev["fam_variants"]
    p["W4_variant_cov"]= 1.0 * (len(fv & mv) / max(len(fv), 1))
    p["W4b_superset"]  = 0.8 * (1 if fv and fv <= mv else 0)
    p["W5_var_exists"] = 0.4 * (1 if var in mv else 0)
    return (sum(p.values()), p)

# A topic names exactly one MC in 87% of cases, but a LOOSE topic match ties
# MCs that legitimately share a topic. So broaden only on a near-exact match to a
# topic that is unique to one MC; otherwise the pmmid topic may only VALIDATE or
# REFUTE a claimed number, never nominate one.
_T2N = None
def _topic_index():
    global _T2N
    if _T2N is None:
        _T2N = collections.defaultdict(set)
        for r in MX.rows:
            if r["topic"]: _T2N[norm_topic(r["topic"])].add(i(r["number"]))
    return _T2N

def candidates(ev, named, thresh=0.95):
    cands = dict(named)
    pt = norm_topic(ev["ptopic"])
    if pt:
        for t, ns in _topic_index().items():
            if len(ns) != 1: continue
            if seqsim(pt, t) >= thresh or blocksim(pt, t) >= 0.90:
                n = next(iter(ns))
                if n not in cands: cands[n] = None
    return cands
