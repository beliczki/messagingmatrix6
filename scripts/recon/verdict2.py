# Two-stage verdict: the TEXT says which card, the PICTURE says which variant.
#
# Stage 1 (text_match) recovers the MC NUMBER reliably, because the copy is
# specific to a card. It cannot recover the VARIANT, because inside a DCO family
# every variant carries the SAME copy — the original verdict.py said so itself
# ("a képleírás dönti el") and then had nothing to decide it with.
# Stage 2 (image_match) now does, scoring the report's picture description
# against creatives.image_description, RESTRICTED to what stage 1 accepted.
# Unrestricted it misfires: a prominent object ("Visa-bankkártya") drags the
# query onto an unrelated card that features it — measured on MC366b, which fell
# to 3rd place globally and wins cleanly once restricted.
import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from text_match import best_by_text, parse_label, by_label, by_number
from image_match import best_by_image
from text_match import messages as MSGS

# Two columns the report already carries and the matcher never used:
# "Prospecting/ remarketing" and "Topic". Measured on the matrix, they separate
# 9 of the 25 duplicate MC pairs on their own (3 by strategy, 6 by topic) — the
# remaining 16 pairs are genuinely identical cards and no witness can split them.
_REM = re.compile(r"rem$|rem_|_rem|rtg|retarget|wlrm|bounc|allvisitors|visitor")
_bystrat, _bytopic = {}, {}
for _m in MSGS:
    _n = _m["mc"]
    _bystrat.setdefault(_n, set()).add("rem" if _REM.search((_m.get("audience") or "").lower()) else "pro")
    _bytopic.setdefault(_n, set()).add((_m.get("topic") or "").lower())

def narrow_by_report(nums, pr, topic):
    """Drop candidate numbers the report's own columns rule out."""
    keep, why = set(nums), []
    if pr:
        want = "rem" if "remarket" in str(pr).lower() else "pro"
        k = {n for n in keep if want in _bystrat.get(n, {want})}
        if k and k != keep: keep, _ = k, why.append(f"{want} szűrt")
    if topic:
        t = str(topic).lower().strip()
        k = {n for n in keep if any(t == x or (t and t in x) for x in _bytopic.get(n, set()))}
        if k and k != keep: keep, _ = k, why.append("topic szűrt")
    return keep, why

IMG_FLOOR  = 0.12   # below this the picture is not evidence
IMG_MARGIN = 0.04   # and it must beat the runner-up by this much

def is_reading(text):
    return "\n" in str(text or "")

def stage1(text):
    """-> (headline, winning number, tied labels)"""
    hits = best_by_text(text, 6)
    if not hits:
        return ("NINCS TALÁLAT — a szöveg nálunk sehol; valószínűleg beolvasatlan kreatív", None, [])
    s0, d0 = hits[0]
    near = [(s, d) for s, d in hits if s >= s0 - 0.03]
    nums = {d["mc"] for _, d in near}
    labels = sorted({d["label"] for _, d in near})
    if s0 < 0.45:
        return (f"GYENGE — legjobb {d0['label']} ({s0:.2f}), nem bizonyíték", None, [])
    if len(nums) == 1 and len(labels) == 1:
        return (f"PONTOS — {d0['label']} ({s0:.2f}, {d0['kind']})", d0["mc"], labels)
    if len(nums) == 1:
        return (None, d0["mc"], labels)          # number known, variant open -> stage 2
    # Several NUMBERS tie. The picture can still decide, so hand it to stage 2
    # as well instead of giving up — the original code stopped here.
    return (None, sorted(nums), labels)

def stage2(desc, number, labels):
    """Break the tie with the picture. `number` is an int (variant tie) or a
    list of ints (several numbers tie). Returns a verdict fragment."""
    multi = isinstance(number, list)
    what = ("MC" + "/MC".join(map(str, number))) if multi else f"MC{number}"
    lead = "TÖBB JELÖLT" if multi else "SZÁM MEGVAN, VARIÁNS NYITOTT"
    nums = set(number) if multi else {number}
    if not str(desc or "").strip():
        return (f"{lead} — {what}; holtverseny: "
                f"{', '.join(labels)} — nincs képleírás, ez döntené el"), None
    # by label first; if our side has no read picture for those exact labels,
    # widen to the candidate NUMBERS (a creative row may be read even when the
    # tied doc was a DCO card, which has no picture of its own)
    hits = best_by_image(desc, 4, restrict_labels=set(labels)) or \
           best_by_image(desc, 4, restrict_numbers=nums)
    if not hits:
        return (f"{lead} — {what} ({', '.join(labels)}); "
                f"nálunk nincs beolvasott kép ezekhez, a kép nem tud dönteni"), None
    s0, d0 = hits[0]
    s1 = hits[1][0] if len(hits) > 1 else 0.0
    if s0 >= IMG_FLOOR and (s0 - s1) >= IMG_MARGIN:
        return f"PONTOS A KÉP ALAPJÁN — {d0['label']} (kép {s0:.2f} vs {s1:.2f})", d0["mc"]
    return (f"{lead} — {what}; holtverseny: {', '.join(labels)} — "
            f"a kép sem dönt (legjobb {d0['label']} {s0:.2f}, második {s1:.2f})"), None

def verdict(text, raw_label, image_desc=None, pr=None, topic=None):
    if not is_reading(text):
        note = str(text or "").strip().replace("\n", " ")[:40]
        return (f'NEM KREATÍV-SZÖVEG — a cellában megjegyzés áll („{note}"), '
                f"nincs mit egyeztetni")
    head, win_num, labels = stage1(text)
    if head is None:
        note = []
        if isinstance(win_num, list):
            keep, why = narrow_by_report(win_num, pr, topic)
            if len(keep) == 1:
                win_num = sorted(keep)[0]
                labels = [l for l in labels if l.startswith(f"MC{win_num}")] or labels
                note = [f"a riport oszlopai szűkítettek ({', '.join(why)})"]
            elif keep and len(keep) < len(win_num):
                win_num = sorted(keep)
                labels = [l for l in labels if any(l.startswith(f"MC{n}") for n in keep)] or labels
                note = [f"a riport oszlopai szűkítettek ({', '.join(why)})"]
        if isinstance(win_num, int) and len({l for l in labels}) == 1:
            head = f"PONTOS A RIPORT OSZLOPAIBÓL — {labels[0]}"
        else:
            head, resolved = stage2(image_desc, win_num, labels)
            if resolved: win_num = resolved
        if note: head += " (" + "; ".join(note) + ")"
    parts = [head]
    num, var = parse_label(raw_label)
    if num is None:
        parts.append("MC-címke: a riportban nincs értelmezhető MC")
    elif num == 0:
        parts.append("MC-címke: MC00 — a név nem hordoz MC-t, ebből nem lett volna meg")
    else:
        lab = f"MC{num}{var}"
        rows = by_label.get(lab) or by_number.get(num)
        if not rows:
            parts.append(f"MC-címke: {lab} nincs a mátrixban")
        else:
            topics = sorted({r["topic"] or "?" for r in rows})[:2]
            if win_num is not None and num == win_num:
                parts.append(f"MC-címke: {lab} egyezik")
            elif win_num is not None:
                parts.append(f"MC-címke: {lab} ÜTKÖZIK — nálunk {'/'.join(topics)}")
            else:
                parts.append(f"MC-címke: {lab} → {'/'.join(topics)}")
    return " · ".join(parts)
