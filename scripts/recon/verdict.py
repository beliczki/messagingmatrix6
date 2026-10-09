import sys, os, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from text_match import best_by_text, parse_label, by_label, by_number

# A real reading is the verbatim text off the banner: several lines, one per
# text element. Every other value in that column is a human note left there
# earlier ("Aktív vagy sem?", "Q1 nem DCO", "Hiteltinder SZK kampányból") — 19
# of AO_PRG's 29 filled cells are exactly that. Matching them against the matrix
# produces confident nonsense, so they get named for what they are instead.
def is_reading(text):
    return "\n" in str(text or "")

def verdict(text, raw_label):
    if not is_reading(text):
        note = str(text or "").strip().replace("\n", " ")[:40]
        return (f'NEM KREATÍV-SZÖVEG — a cellában megjegyzés áll („{note}"), '
                f"nincs mit egyeztetni")
    """One line: what the matrix card is, how confidently, and whether the
    report's own MC label agrees. Kept short enough to read in a cell."""
    hits = best_by_text(text, 6)
    parts = []
    if not hits:
        parts.append("NINCS TALÁLAT — a szöveg nálunk sehol; valószínűleg még beolvasatlan kreatív")
        win_num = None
    else:
        s0, d0 = hits[0]
        near = [(s, d) for s, d in hits if s >= s0 - 0.03]
        nums = {d["mc"] for _, d in near}
        labels = {d["label"] for _, d in near}
        win_num = d0["mc"]
        if s0 < 0.45:
            parts.append(f"GYENGE — legjobb {d0['label']} ({s0:.2f}), nem bizonyíték")
        elif len(nums) == 1 and len(labels) == 1:
            parts.append(f"PONTOS — {d0['label']} ({s0:.2f}, {d0['kind']})")
        elif len(nums) == 1:
            parts.append(
                f"SZÁM MEGVAN, VARIÁNS NYITOTT — MC{list(nums)[0]} "
                f"({s0:.2f}); holtverseny: {', '.join(sorted(labels))} — a képleírás dönti el"
            )
        else:
            parts.append(
                f"TÖBB JELÖLT — {', '.join(sorted(labels))} ({s0:.2f})"
            )
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
