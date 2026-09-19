# `scripts/recon` — riport-egyeztető mérőkeret

**Olvasás-only.** Nem része az app buildjének, nincs npm-függősége (csak `python3` + `openpyxl`).
A `scripts/gen-collisions-doc.ts` precedensét követi: újrafuttatható riport-generátor, ezért marad
a repóban — szemben az egyszeri `renumber-*` scriptekkel.

Eredmények és értelmezés: **`docs/REPORT_RECONCILIATION_STUDY.md`**.

## Futtatás

```bash
python3 scripts/recon/extract.py     # DB + xlsx  -> bundle.json  (a script mappájába ír)
python3 scripts/recon/final.py       # identitás-többértelműség + befagyott-egyezés mérés
python3 scripts/recon/prg_recon.py   # PRG <-> monitoring: Q_ID (azonosság) és Q_VOL (volumen)
python3 scripts/recon/gate.py        # Meta: paraméter-sweep a gold címkéken
python3 scripts/recon/sample.py 20 1 # N-es minta mind a négy azonosítótérben (seed=1)
```

`extract.py` a `.env.local` `DATABASE_URL`-jéből olvassa a jelszót, és a `client_id=8` (erste)
scope-ot húzza. A riportfájlok útja a fájl tetején (`REPORTS`).

## Mit tartalmaz

| fájl | szerep |
|---|---|
| `extract.py` | mind a 7 adathalmaz normalizált JSON-be (matrix, creatives, monitoring, audiences, topics, prg, meta) |
| `common.py` | a négy azonosító-formátum parsere: pmmid, kreatív-fájlnév, ügynökségi MC-címke, Meta hirdetésnév |
| `recon.py` | mátrix-indexek + rétegzett lefedettség-riport (`Coverage`) |
| `score.py` | az öt súlyozott tanú + IDF + a szigorított jelöltbővítés |
| `gate.py` | a bizonyíték-kapu (puszta számegyezés nem elég) + paraméter-sweep |
| `labels.py` | **gold címkék** — 27 kézzel ítélt vitás eset + a negatív minta |
| `sample.py` | mintavételező: egy MC teljes lábnyoma mind a négy térben |
| `prg_recon.py` | PRG-egyeztetés, az azonosság és a volumen szándékosan külön kérdésként |
| `final.py` | a tanulmányban idézett összesített számok |

## A két szabály, amit a keret tanított

1. **A topic cáfolni tud, jelölni nem.** A laza topic-alapú jelöltbővítés 85%-ról 41%-ra rontott,
   mert 289 topicból 37 több MC-t is megnevez. Bővíteni csak közel-pontos egyezésre és egyedi
   topicra szabad.
2. **A puszta számegyezés nem bizonyíték.** Kapu nélkül az ügynökségi `01a/02a/03a` ráül az
   MC1/MC2/MC3-ra (20 hamis pozitív 32-ből). A `min_ev=0.20` kapuval 0 — kézi tiltólista nélkül.

Ha a súlyokon vagy a küszöbön változtatsz, **futtasd a `gate.py`-t**: a gold pontosság
(85% / 89% költés-súlyozva) és a hamis pozitív szám (0/32) a regressziós korlát.
