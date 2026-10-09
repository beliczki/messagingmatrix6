# Second matching stage: the PICTURE.
#
# Why this exists. Inside a DCO/variant family the copy is SHARED — MC365a/b/c
# all read "Nyiss gyerkőcödnek Erste Cseperedő bankszámlát / Akár 20 000 Ft-ot
# kaphattok". So text can recover the NUMBER and never the VARIANT; text_match
# correctly reports a tie and says "a képleírás dönti el". Only the image differs,
# and since 2026-09 both sides carry an LLM-written Hungarian description of it:
# the report's "Kép / illusztráció leírása" column and creatives.image_description.
# This module scores one against the other and breaks the tie.
import json, re, math, os, unicodedata
from collections import Counter

D = os.path.dirname(os.path.abspath(__file__))
creatives = json.load(open(f"{D}/creatives.json"))

def norm(s):
    if not s: return ""
    s = unicodedata.normalize("NFKD", str(s).lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s)

# Both sides are generated prose, so they share a large boilerplate vocabulary
# ("hatteren", "lathato", "jobb oldalon", "alul"). Those words carry no identity
# and IDF alone does not kill them because nearly every description has them.
BOILER = set("""hatteren hatter kepen lathato lathatok jelenik meg mellette alatta felette
jobb bal oldalon oldalt also felso sarkaban kozepen alul felul elotte mogotte
szinu szinben szines nagy kis kicsi egy ket ketto harom all ul fekszik tart
kezeben kezevel valamint tovabba illetve amely amelyen ahol van vannak
kor kore korben gomb gombbal szoveg szoveggel felirat feliratu logo logoval
erste reklamszoveg ajanlati keret kerettel""".split())

def toks(s):
    return [t for t in norm(s).split() if len(t) > 2 and t not in BOILER]

docs = []
for c in creatives:
    if not c.get("image_description"): continue
    docs.append({
        "id": c["id"], "mc": c["mc"], "v": c["v"] or "",
        "label": f'MC{c["mc"]}{c["v"] or ""}',
        "dim": c.get("dim"), "file_name": c["file_name"],
        "desc": c["image_description"],
        "toks": set(toks(c["image_description"])),
    })

N = len(docs)
df = Counter()
for d in docs:
    for t in d["toks"]: df[t] += 1
def idf(t): return math.log((N + 1) / (df.get(t, 0) + 1)) + 1

_dn = {}
def dnorm(d):
    k = d["id"]
    if k not in _dn:
        _dn[k] = math.sqrt(sum(idf(t) ** 2 for t in d["toks"])) or 1.0
    return _dn[k]

def score(qt, d):
    if not qt or not d["toks"]: return 0.0
    hit = sum(idf(t) ** 2 for t in qt if t in d["toks"])
    qn = math.sqrt(sum(idf(t) ** 2 for t in qt)) or 1.0
    return hit / (qn * dnorm(d))

def best_by_image(desc, k=5, restrict_labels=None, restrict_numbers=None):
    """Rank creatives by how well their picture matches `desc`.
    restrict_* narrows to the candidates the TEXT stage already accepted."""
    qt = set(toks(desc))
    if not qt: return []
    out = []
    for d in docs:
        if restrict_labels and d["label"] not in restrict_labels: continue
        if restrict_numbers and d["mc"] not in restrict_numbers: continue
        s = score(qt, d)
        if s > 0: out.append((s, d))
    out.sort(key=lambda x: -x[0])
    best, seen = [], set()
    for s, d in out:
        if d["label"] in seen: continue
        seen.add(d["label"]); best.append((round(s, 3), d))
        if len(best) >= k: break
    return best
