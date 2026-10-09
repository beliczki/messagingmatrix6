import openpyxl, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verdict import verdict
from addcol import add_column

R = os.path.expanduser("~/GoogleDrive/Data/ERSTE HU/_riports")
HDR = "Mátrix találat"

def build(path, sheet, sheet_xml, textcol, labelfn, header_row=1):
    wb = openpyxl.load_workbook(f"{R}/{path}", read_only=True)
    ws = wb[sheet]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(c) if c else "" for c in rows[header_row - 1]]
    ti = hdr.index(textcol)
    vals = {}
    for i, r in enumerate(rows[header_row:], start=header_row + 1):
        if not r[ti]:
            continue
        vals[i] = verdict(r[ti], labelfn(r, hdr))
    wb.close()
    col, n = add_column(f"{R}/{path}", sheet_xml, HDR, vals, header_row)
    print(f"{path}: {n-1} sor + fejléc -> oszlop {col}")
    return vals

def meta_label(r, h):
    ad = str(r[h.index("Ad name")]); seg = ad.split("!")
    return seg[2] if len(seg) > 2 else None

build("AO_PRG.xlsx", "PRG", "xl/worksheets/sheet1.xml",
      "Szöveg a kreatívon", lambda r, h: r[h.index("MC")], 1)
build("AO_Meta.xlsx", "Formatted Report", "xl/worksheets/sheet1.xml",
      "Szöveg a kreatívon", meta_label, 3)
build("AO_PMAX_kreativok_soronkent.xlsx", "PMAX kreatívok", "xl/worksheets/sheet1.xml",
      "image_text", lambda r, h: None, 1)
