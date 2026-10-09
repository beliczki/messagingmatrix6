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

## Szövegalapú egyeztetés — `text_match.py` / `verdict.py` / `addcol.py` (2026-09-24)

A képi beolvasás (`Szöveg a kreatívon` / `Kép / illusztráció leírása` az ügynökségi
riportokban) **független tanú** az MC-névhez képest, és ott is megszólal, ahol a név
nem: `MC00` sorokon és a Meta saját számozásán.

```bash
./scripts/recon/export_matrix.sh          # creatives.json + messages.json (DB-tunnel kell)
python3 scripts/recon/write_match_column.py   # „Mátrix találat" oszlop a három riportba
```

| fájl | szerep |
|---|---|
| `text_match.py` | IDF-koszinusz a riport-szöveg és a mátrix (beolvasott kreatívok + DCO-copy) között |
| `verdict.py` | egy cellányi ítélet: szöveg-találat + hogy az MC-címke egyezik-e vele |
| `addcol.py` | egy oszlop hozzáírása xlsx-hez **zip-szinten**; `set_column` egy meglévőt ír felül |
| `write_match_column.py` | a három riport bekötve |
| `image_match.py` | IDF-koszinusz a riport **képleírása** ↔ `creatives.image_description` |
| `verdict2.py` | **kétfokozatú** ítélet: a szöveg adja a SZÁMOT, a kép a VARIÁNST, + a riport `pro/rem` és `Topic` oszlopa tanúként |

## A kétfokozatú egyeztetés (2026-09-26)

Egy DCO-családon belül minden variáns **ugyanazt a szöveget** hordozza, ezért a szöveg-egyeztetés a
számot vissza tudja hozni, a variánst soha. A `verdict.py` ezt maga is kiírta („a képleírás dönti
el"), csak nem volt mivel. A `verdict2.py` ezt zárja be:

```bash
python3 -c "from verdict2 import verdict; print(verdict(text, mc_label, image_desc, pro_rem, topic))"
```

**Három szabály, amit a mérés kikényszerített — ne lazíts rajtuk:**

1. **A kép-fokozatot szűkíteni kell** a szöveg-fokozat jelöltjeire. Globálisan egy hangsúlyos tárgy
   („Visa-bankkártya") átrántja a találatot: a helyes MC366b a 3. helyre esett (0.156), szűkítve
   nyer (0.157 vs 0.082). Ugyanaz az elv, mint a topicnál: **cáfolni tud, jelölni nem.**
2. **`BOILER` stoplista kell.** Mindkét oldal generált próza, tele közös sablonszóval
   („háttéren", „látható", „jobb oldalon") — az IDF önmagában nem öli meg őket.
3. **A riport saját oszlopai is tanúk.** A `Prospecting/ remarketing` + `Topic` a 25 duplikált
   MC-párból 9-et önmagában szétválaszt.

**Regressziós korlát:** 37/90 egyértelmű találat (ebből 3 a kép, 7 az oszlopok döntése).
Ha a súlyokon vagy a küszöbökön (`IMG_FLOOR`, `IMG_MARGIN`) állítasz, ezt kell tartani.

**Három szabály, amit a mérés kényszerített ki:**

1. **A pontszám koszinusz, nem egyoldalú lefedettség.** Az „mennyi jelenik meg a riport
   szavaiból a jelölten" alak az első, kézenfekvő változat — és rossz: egy hosszú copyjú
   kártya majdnem minden lekérdezést lefed. Mérve: MC23n így **18 független SZK-soron**
   nyert, egyformán 0,48-cal. Koszinusszal mind a 18 helyesen „nincs találat".
2. **A szöveg az MC-t dönti el, a variánst nem mindig.** Az a/b/c színvariánsok gyakran
   szó szerint azonos copyt hordoznak (`MC365a/b/c` 1,00-n holtverseny). Ott a
   **képleírás** a következő tanú — de az nálunk csak 1037 kreatívra van meg.
3. **Nem minden a szöveg-oszlopban kreatív-szöveg.** Az `AO_PRG.xlsx` 29 kitöltött
   cellájából **19 régi emberi megjegyzés** („Aktív vagy sem?", „Q1 nem DCO"). Egy valódi
   beolvasás **többsoros**; ez a `verdict.is_reading` szűrője, és enélkül a matcher
   magabiztos badarságot ír 19 sorba.

**`addcol.py` miért nem openpyxl:** az `AO_PRG.xlsx` 400 cellába ágyazott képet hordoz
`xl/richData/` rich value-ként (drawing nélkül), és egy openpyxl load-save ezt **némán
eldobja**. A zip-szintű írás minden más részt bájtra másol, a `.bak` pedig ott marad.
