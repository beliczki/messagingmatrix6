"""Extract every identity-bearing dataset into one normalized JSON bundle.

Three identity spaces are being reconciled:
  MATRIX    — (number, variant) message, fanned out over audience x topic cells
  CREATIVE  — a produced file, named ERSTE_<PROD>_MC<n><v>_<concept>_n<ver>_<WxH>.<ext>
  TRAFFIC   — a pmmid, frozen at trafficking time:
              p_<buyplat>-s_<strategy>-a_<audkey>-m_<num>-t_<topickey>-v_<variant>-n_<ver>
"""
import csv, json, os, re, subprocess, sys

R = os.path.dirname(os.path.abspath(__file__))
REPORTS = "/Users/robertbeliczki/GoogleDrive/Data/ERSTE HU/_riports/"
CID = 8

def psql(sql):
    env = dict(os.environ)
    with open("/Users/robertbeliczki/messagingmatrix6/.env.local") as f:
        for line in f:
            if line.startswith("DATABASE_URL"):
                env["PGPASSWORD"] = re.search(r"://[^:]+:([^@]+)@", line).group(1)
    wrapped = "select coalesce(json_agg(t), '[]'::json)::text from (" + sql + ") t"
    out = subprocess.run(
        ["psql", "-h", "localhost", "-p", "5433", "-U", "postgres", "-d", "mm6",
         "-At", "-c", wrapped],
        capture_output=True, text=True, env=env, check=True).stdout
    return json.loads(out)

def rows(sql, cols=None):
    return psql(sql)

bundle = {}

# ---- MATRIX -----------------------------------------------------------------
bundle["matrix"] = rows(f"""
select m.number, m.variant, coalesce(m.audience,'') audience, coalesce(m.topic,'') topic,
       m.status, coalesce(m.pmmid,'') pmmid, coalesce(m.name,'') name, coalesce(m.headline,'') headline,
       coalesce(m.copy1,'') copy1, coalesce(m.image1,'') image1, coalesce(m.template,'') template,
       coalesce(a.product,'') product, coalesce(a.buying_platform,'') buy_platform,
       coalesce(a.strategy,'') strategy, coalesce(a.channel,'') channel, m.version_no,
       coalesce(m.utm_term,'') utm_term,
       case when m.audience is null then 1 else 0 end is_draft
from messages m left join audiences a on a.client_id=m.client_id and a.key=m.audience
where m.client_id={CID} and m.archived_at is null
""", ["number","variant","audience","topic","status","pmmid","name","headline","copy1",
      "image1","template","product","buy_platform","strategy","channel","version_no",
      "utm_term","is_draft"])

# ---- CREATIVES --------------------------------------------------------------
bundle["creatives"] = rows(f"""
select coalesce(mc_number::text,'') number, coalesce(mc_variant,'') variant,
       coalesce(file_name,'') file_name, coalesce(product,'') product,
       coalesce(file_dimensions,'') dims, coalesce(family_key,'') family_key,
       coalesce(type,'') type, coalesce(visual_keyword,'') visual_kw, coalesce(template,'') template
from creatives where client_id={CID} and archived_at is null
""", ["number","variant","file_name","product","dims","family_key","type","visual_kw","template"])

# ---- OUR MONITORING (imported AdForm) ---------------------------------------
bundle["monitoring"] = rows(f"""
select platform, coalesce(scope,'') scope, coalesce(pmmid,'') pmmid,
       mc_number number, mc_variant variant, audience_key, topic_key,
       coalesce(size,'') size, period_from,
       sum(impressions)::bigint impressions, sum(clicks)::bigint clicks,
       round(sum(cost)::numeric)::bigint cost, sum(conversions)::bigint conversions,
       coalesce(max(match_level),'') match_level, coalesce(max(product),'') product
from monitoring where client_id={CID}
group by 1,2,3,4,5,6,7,8,9
""", ["platform","scope","pmmid","number","variant","audience_key","topic_key","size",
      "period_from","impressions","clicks","cost","conversions","match_level","product"])

# ---- DIMENSIONS -------------------------------------------------------------
bundle["audiences"] = rows(f"""
select key, name, coalesce(product,'') product, coalesce(buying_platform,'') buy_platform,
       coalesce(strategy,'') strategy, coalesce(channel,'') channel, coalesce(tag,'') tag from audiences
where client_id={CID} and archived_at is null
""", ["key","name","product","buy_platform","strategy","channel","tag"])
bundle["topics"] = rows(f"""
select key, name, coalesce(product,'') product from topics where client_id={CID} and archived_at is null
""", ["key","name","product"])

# ---- AGENCY: PRG ------------------------------------------------------------
import openpyxl
def sheet_rows(path, name, header_row=0, limit_cols=None):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=False)
    ws = wb[name]
    out = []
    for i, r in enumerate(ws.iter_rows(values_only=True)):
        if limit_cols: r = r[:limit_cols]
        out.append(list(r))
    wb.close()
    return out

prg_raw = sheet_rows(REPORTS + "AO_PRG.xlsx", "PRG", limit_cols=14)
prg_hdr = [str(c).strip() if c else "" for c in prg_raw[0]]
bundle["prg"] = [dict(zip(prg_hdr, [("" if c is None else c) for c in r])) for r in prg_raw[1:]]

meta_raw = sheet_rows(REPORTS + "AO_Meta.xlsx", "Raw Data Report")
meta_hdr = [str(c).strip() if c else "" for c in meta_raw[2][1:16]]
bundle["meta"] = [dict(zip(meta_hdr, [("" if c is None else c) for c in r[1:16]]))
                  for r in meta_raw[3:] if r and r[1]]

json.dump(bundle, open(R + "/bundle.json", "w"), ensure_ascii=False, default=str)
for k, v in bundle.items():
    print(f"{k:<12} {len(v):>6} rows")
