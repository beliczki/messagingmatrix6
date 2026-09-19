import json, os, re, random, collections
R = os.path.dirname(os.path.abspath(__file__))
B = json.load(open(R + "/bundle.json"))

def i(x):
    try: return int(float(x))
    except Exception: return 0

# --- pmmid: the trafficking fingerprint --------------------------------------
MARKERS = ["-s_", "-a_", "-m_", "-t_", "-v_", "-n_"]
def parse_pmmid(pm):
    """Positional slice parse. Returns dict with scope/strategy/audience/number/topic/variant/version."""
    if not pm: return None
    core = pm.split("!")[0].strip()
    found = sorted([(core.find(m), m) for m in MARKERS if core.find(m) >= 0])
    if not found: return None
    out = {"raw": core, "scope": core[:found[0][0]] if found[0][0] > 0 else ""}
    for idx, (pos, mk) in enumerate(found):
        end = found[idx + 1][0] if idx + 1 < len(found) else len(core)
        out[{"‑s_": "strategy"}.get(mk, {"-s_":"strategy","-a_":"audience","-m_":"number",
             "-t_":"topic","-v_":"variant","-n_":"version"}[mk])] = core[pos + len(mk):end]
    return out

# --- creative filename: the production fingerprint ---------------------------
# ERSTE_<PROD>_MC<num><var>_<concept>_n<ver>_<WxH>.<ext>
FN = re.compile(r"^ERSTE_(?P<prod>[A-Z]+)_MC(?P<num>\d+)(?P<var>[a-zA-Z0-9]*)_(?P<concept>.*?)_n(?P<ver>\d+)_(?P<dims>\d+x\d+)\.(?P<ext>\w+)$")
def parse_filename(fn):
    m = FN.match(fn or "")
    return m.groupdict() if m else None

# --- agency MC label ---------------------------------------------------------
MC = re.compile(r"^MC(?P<num>\d+)(?P<var>[a-zA-Z]*)$")
def parse_mc(label):
    m = MC.match((label or "").strip())
    if not m: return None
    return {"number": int(m.group("num")), "variant": m.group("var").lower()}

# --- Meta ad name ------------------------------------------------------------
# native!newsfeedad!<num><var>!<WxH>!pmmid=<pmmid>!v11   (+ optional " - Copy"/" – Copy N")
META_AD = re.compile(r"(?:^|!)newsfeedad!(?P<num>[0-9.]+)(?P<var>[a-zA-Z]*)!(?P<dims>\d+x\d+)!")
def parse_meta_ad(name):
    out = {"raw": name, "copy": bool(re.search(r"[-–]\s*Copy", name or ""))}
    m = META_AD.search(name or "")
    if m:
        out["ad_num"] = m.group("num"); out["ad_var"] = m.group("var").lower(); out["dims"] = m.group("dims")
    p = re.search(r"pmmid=([^!]+)", name or "")
    out["pmmid"] = p.group(1) if p else ""
    return out

def norm_variant(v):
    """Matrix stores a bare letter; traffic sometimes carries a labelled variant."""
    v = (v or "").lower()
    parts = v.split("_")
    if len(parts) > 1:
        if re.fullmatch(r"[a-z]", parts[0]): return parts[0]
        if re.fullmatch(r"[a-z]", parts[-1]): return parts[-1]
    return v
