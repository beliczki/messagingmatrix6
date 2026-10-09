# Add one column to an .xlsx by editing the sheet XML inside the zip and copying
# every other part byte-for-byte.
#
# NOT openpyxl: AO_PRG.xlsx carries 400 in-cell images as richData rich values
# (xl/richData/*, no drawings), and an openpyxl load-save drops them silently.
# Nothing here touches sharedStrings either — the new cells are inline strings.
import zipfile, re, shutil, os

def col_letter(n):  # 1 -> A
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s

def col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n

def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))

def add_column(path, sheet_xml, header, values, header_row=1):
    """values: {row_number: text}. Writes in place (after a .bak copy)."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        data = {n: z.read(n) for n in names}
    xml = data[sheet_xml].decode("utf8")

    m = re.search(r'<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/>', xml)
    last_col = col_index(m.group(3)) if m else 0
    new_col = col_letter(last_col + 1)

    targets = dict(values)
    targets[header_row] = header

    def cell(r, text):
        return (f'<c r="{new_col}{r}" t="inlineStr"><is>'
                f'<t xml:space="preserve">{esc(text)}</t></is></c>')

    out, pos, written = [], 0, 0
    for rm in re.finditer(r'<row r="(\d+)"[^>]*>', xml):
        rn = int(rm.group(1))
        if rn not in targets:
            continue
        end = xml.find("</row>", rm.end())
        if end < 0:
            continue
        out.append(xml[pos:end])
        out.append(cell(rn, targets[rn]))
        pos = end
        written += 1
    out.append(xml[pos:])
    xml = "".join(out)

    if m:
        xml = xml.replace(
            m.group(0),
            f'<dimension ref="{m.group(1)}{m.group(2)}:{new_col}{m.group(4)}"/>', 1)

    bak = path + ".bak"
    if not os.path.exists(bak):
        shutil.copy2(path, bak)
    data[sheet_xml] = xml.encode("utf8")
    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names:
            z.writestr(n, data[n])
    os.replace(tmp, path)
    return new_col, written


def set_column(path, sheet_xml, header, values, header_row=1):
    """Overwrite an EXISTING column (matched by header text) in place; append if
    absent. Same zip-surgery contract as add_column: every other part is copied
    byte-for-byte, so AO_PRG's 400 richData in-cell images survive."""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        data = {n: z.read(n) for n in names}
    xml = data[sheet_xml].decode("utf8")

    hrow = re.search(r'<row r="%d"[^>]*>(.*?)</row>' % header_row, xml, re.S)
    col = None
    if hrow:
        for cm in re.finditer(r'<c r="([A-Z]+)%d"[^>]*>(.*?)</c>' % header_row, hrow.group(1), re.S):
            tm = re.search(r"<t[^>]*>(.*?)</t>", cm.group(2), re.S)
            if tm and tm.group(1).strip() == header:
                col = cm.group(1); break
    if col is None:
        return add_column(path, sheet_xml, header, values, header_row)

    targets = dict(values); targets[header_row] = header
    written = 0
    def cell(r, text):
        return (f'<c r="{col}{r}" t="inlineStr"><is>'
                f'<t xml:space="preserve">{esc(text)}</t></is></c>')
    out, pos = [], 0
    for rm in re.finditer(r'<row r="(\d+)"[^>]*>', xml):
        rn = int(rm.group(1))
        if rn not in targets: continue
        end = xml.find("</row>", rm.end())
        if end < 0: continue
        body = xml[rm.end():end]
        stripped = re.sub(r'<c r="%s%d"[^>]*>.*?</c>' % (col, rn), "", body, flags=re.S)
        stripped = re.sub(r'<c r="%s%d"[^>]*/>' % (col, rn), "", stripped)
        out.append(xml[pos:rm.end()]); out.append(stripped); out.append(cell(rn, targets[rn]))
        pos = end; written += 1
    out.append(xml[pos:])
    xml = "".join(out)

    bak = path + ".bak2"
    if not os.path.exists(bak): shutil.copy2(path, bak)
    data[sheet_xml] = xml.encode("utf8")
    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for n in names: z.writestr(n, data[n])
    os.replace(tmp, path)
    return col, written
