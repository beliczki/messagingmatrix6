# Match agency-report rows to matrix cards two ways — by the MC label the report
# carries, and by the words ON the creative — and say where the two disagree.
import json, re, math, os, unicodedata
from collections import Counter

D = os.path.dirname(os.path.abspath(__file__))
creatives = json.load(open(f"{D}/creatives.json"))
messages = json.load(open(f"{D}/messages.json"))

def norm(s):
    if not s: return ""
    s = unicodedata.normalize("NFKD", str(s).lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s)

STOP = set("a az es is hogy ha nem de vagy meg mar csak el ki be fel le at on the of to and for you your with".split())
def toks(s):
    return [t for t in norm(s).split() if len(t) > 2 and t not in STOP]

# One document per matrix candidate: a creative's read text, or a DCO card's copy.
docs = []
for c in creatives:
    docs.append({
        "kind": "creative", "id": c["id"],
        "mc": c["mc"], "v": c["v"], "product": c["product"],
        "label": f'MC{c["mc"]}{c["v"] or ""}',
        "extra": f'{c["file_name"]} · {c["dim"]}',
        "toks": set(toks(c["image_text"])),
    })
for m in messages:
    body = " ".join(filter(None, [m["headline"], m["copy1"], m["copy2"], m["cta"], m["disclaimer"]]))
    if not body.strip(): continue
    docs.append({
        "kind": "message", "id": m["id"],
        "mc": m["mc"], "v": m["v"], "product": m["aud_product"],
        "label": f'MC{m["mc"]}{m["v"]}',
        "extra": f'{m["axis"]} · {m["status"]} · {m["topic"]}',
        "toks": set(toks(body)),
    })

N = len(docs)
df = Counter()
for d in docs:
    for t in d["toks"]: df[t] += 1
def idf(t): return math.log((N + 1) / (df.get(t, 0) + 1)) + 1

# The matrix as the MC label alone knows it.
by_label = {}
for m in messages:
    by_label.setdefault(f'MC{m["mc"]}{m["v"]}', []).append(m)
by_number = {}
for m in messages:
    by_number.setdefault(m["mc"], []).append(m)

# Cosine over IDF-weighted binary vectors, NOT one-sided coverage. The one-sided
# version ("how much of the report's text appears on the candidate") is what a
# first pass looks like and it is wrong: a card whose copy happens to be long
# covers most queries and wins everything. Here a long candidate pays for its
# own weight in the denominator, so the winner has to be specific in BOTH
# directions. Measured: the one-sided score handed MC23n the top slot on 18
# unrelated SZK rows at a flat 0.48.
_dnorm = {}
def dnorm(d):
    k = id(d)
    if k not in _dnorm:
        _dnorm[k] = math.sqrt(sum(idf(t) ** 2 for t in d["toks"])) or 1.0
    return _dnorm[k]

def score(qt, d):
    if not qt or not d["toks"]: return 0.0
    hit = sum(idf(t) ** 2 for t in qt if t in d["toks"])
    qn = math.sqrt(sum(idf(t) ** 2 for t in qt)) or 1.0
    return hit / (qn * dnorm(d))

def best_by_text(text, k=3):
    qt = set(toks(text))
    if not qt: return []
    scored = [(score(qt, d), d) for d in docs]
    scored.sort(key=lambda x: -x[0])
    out, seen = [], set()
    for s, d in scored:
        if s < 0.25: break
        if d["label"] in seen: continue
        seen.add(d["label"]); out.append((round(s, 3), d))
        if len(out) >= k: break
    return out

def parse_label(raw):
    """MC310 / MC290a / MC00b / 312c -> (number, variant) or (None, None)."""
    if raw is None: return (None, None)
    m = re.match(r"^(?:MC)?0*(\d+)([a-z]?)$", str(raw).strip(), re.I)
    if not m: return (None, None)
    return (int(m.group(1)), (m.group(2) or "").lower())
