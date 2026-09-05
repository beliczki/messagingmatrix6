# Szakértés — cost sankey a meglévő monitoring adatból

Dátum: 2026-09-05 · Adatforrás: élő Hetzner Postgres, `monitoring` tábla, erste kliens (2026-05 … 2026-08)

## 1. Rövid válasz

**Technikailag igen, üzletileg ma még csak korlátozottan.** A séma és a dimenziók megvannak
(`monitoring.cost` + audience/topic/MC/product/platform/size), a rajzoló pipeline nagy része
szintén megvan (`matrix/_tree/`), **de a költség 82%-a augusztusban nem köthető konkrét
matrix-cellához** — egyetlen `a_wid` / `m_00` gyűjtővödörben ül. Egy „cost → audience → topic →
MC" sankey ma a spend ~13%-át rajzolná ki üzenetszinten, a maradék egy vastag szürke szalag lenne.

Két őszinte változat lehetséges (részletek a 6. pontban): egy **teljes** sankey, ami vállalja a
„nem üzenetszintű" ágat, vagy egy **matched-only** sankey, ami kimondja, hogy a matrix-hoz kötött
költést mutatja. Hamis harmadik út nincs.

## 2. Pontosítás: a v5-ben nem volt cost sankey

A régi repóban (`/Users/robertbeliczki/messagingmatrix/`) a sankey megvan
(`src/components/sankey/` + `SankeyView/`, ~3040 sor canvas-renderer), **de a szalagvastagság ott az
üzenetek darabszáma**, nem költség:

```js
// useSankey.js — buildSankeyData
levelNodes[levelIndex].get(value).weight++;              // node súly = üzenetszám
flowCounts.set(flowKey, (flowCounts.get(flowKey)||0)+1); // él súly  = üzenetszám
```

A `cost` szó a teljes v5 repóban egyetlen helyen sem szerepel (node_modules-on kívül nulla találat),
a v5 monitoringja is csak `impressions` / `clicks` / `ctr` mezőket ismert. Tehát amire emlékszel, az
a **struktúra-sankey** — a *cost* dimenzió most, a v6 monitoring importtal jött be először.

Ez jó hír: nem visszaépítésről van szó, hanem egy olyan nézetről, ami a régiben nem is létezhetett.

## 3. Mi van most az adatban

`monitoring` tábla, 15 646 sor, 4 riportidőszak. Költség időszakonként (Ft):

| Időszak | Összes cost | Ebből matched (message_id) | Matched arány |
|---|---:|---:|---:|
| 2026-05 | 3 288 360 | 2 377 040 | 72% |
| 2026-06 | 7 094 910 | 6 103 800 | 86% |
| 2026-07 | 20 697 500 | 4 587 180 | 22% |
| 2026-08 | 35 883 100 | 4 537 960 | **13%** |

Augusztus match-szint szerint:

| match_level | sor | cost | mit jelent |
|---|---:|---:|---|
| `exact` | 5 024 | 4 537 970 | teljes 4-részes kulcs → konkrét cella |
| `family_known` | 453 | 2 014 390 | szám+variáns megvan, de több cellára fan-outol |
| `(none)` | 256 | 29 330 800 | nincs match — mind `a_wid` + `m_00` |

Rendelkezésre álló sankey-szintek: `platform`, `product`, `size`, `audience_key` → (join)
`audiences.strategy / data_source / targeting_type / channel / buying_platform`, `topic_key` →
`topics.name / tag*`, `mc_number` + `mc_variant`. Ez pontosan az a mezőkészlet, amit a mostani
TreeView `treeStructure` grammatikája már ismer.

Ízelítő, hogy nézne ki a matched ág első két szintje (2026-08):

| product | strategy | üzenet | cost |
|---|---|---:|---:|
| HK | pro | 203 | 991 488 |
| SZK | pro | 462 | 949 289 |
| SZK | rem | 253 | 876 486 |
| SZA | pro | 242 | 859 848 |
| VAL | pro | 198 | 485 155 |
| SZA | rem | 10 | 153 244 |
| VAL | rem | 5 | 123 193 |
| HK | rem | 15 | 99 264 |

Ez már önmagában olvasható sankey — 8 gyökérág, 960 olyan üzenet, amin valaha volt költés (a 2753-ból).

## 4. Az öt buktató, amit egy naiv `sum(cost)` eltalál

1. **A költés 82%-a nem üzenetszintű.** A nagy tételek PMMID-je `…-a_wid-m_00-t_<topic>-v_0`:
   tiktok 3,2M, wppnexus 3,1M, netmedia 2,1M, googleads 2,0M stb. Ez nem hiba az importban — ezeket
   a beszerzéseket **nem** taggelték üzenetszinten. Sankey-ben ez legitim „wid / nincs MC" ág, de
   üzenetre bontani nem lehet, és nem is szabad becsülni.
2. **1x1 click-tracker sorok.** Augusztusban a cost 62%-a (22,27M) `impressions = 0` sorokon ül.
   A dashboard (`dashboard-monitoring.ts`) ezeket **kidobja** — ott helyesen, mert a CTR-t rontják.
   Cost-sankey-ben viszont ugyanez a szűrő a spend kétharmadát tüntetné el. A két nézet nem
   használhatja ugyanazt a WHERE-t, és ezt le kell írni a UI-ban is.
3. **`family_known` fan-out.** 2,0M Ft olyan sorokon, ahol a szám+variáns létezik, de több cellára
   megy. Vagy saját „több cellára oszlik" node-ot kap, vagy kimarad — arányos szétosztás
   (`cost / n_cell`) kitalált adat lenne, ne csináljuk.
4. **DV360-on nincs költség.** 1633 augusztusi sor, cost ≈ 0. Impressziót hoz, spendet nem — a
   DV360 riport nem tartalmaz költségoszlopot. Egy platform-szintű sankey emiatt torz: a DV360 ág
   nulla vastag lenne, pedig 1,26M impressziót szállított.
5. **Nincs napi bontás.** A `day` oszlop mind a 15 646 soron üres — az eddigi importok egész
   időszakot hajtogattak. Tehát havi granularitás, 4 hónap. Dátumcsúszkás/animált sankey ma nem megy.

## 5. Mibe kerülne

A pipeline nagy része megvan, **a v5 canvas-rendererből semmit nem érdemes átemelni**:

- **Adat:** 1 új aggregáló függvény `src/lib/` alá (mintája: `dashboard-monitoring.ts`), `group by`
  a választott szintekre, `sum(cost)`. Egy lekérdezés, ~1000 sor alatti eredmény → nincs lapozás.
- **Struktúra:** `matrix/_tree/parseTreeStructure.ts` (134 sor) + `buildTree.ts` (159 sor) már ma
  ugyanazt a `Audiences.X -> Topics.Y -> Messages.Number` nyelvtant értelmezi. A delta annyi, hogy
  a node súlya `count` helyett `sum(cost)` — a `buildTree` már számol `count`-ot node-onként.
- **Render:** ez az igazi munka. A React Flow (`@xyflow/react`, már dependency) él-vastagságot nem
  rajzol szalagként; kell egy saját SVG-réteg (bezier ribbon, ~200–300 sor) **vagy** egy új
  `d3-sankey` dependency. Az előbbit javaslom: kisebb, illik a meglévő TreeView-hoz, nincs új dep.
- **Nagyságrend:** 1 nap a becsületes v1-re (matched + „nincs MC" ág, hónapválasztó, product szűrő),
  ha a struktúrát a meglévő `treeStructure` configból örökli.

## 6. Javaslat

**Amit én építenék (v1):** a monitoring oldalra egy „Flow" nézet, `product → strategy → topic → MC`
szintekkel, hónap- és product-szűrővel, a felső sávban két számmal: *összes költés* és *ebből
üzenetszintre bontható*. A nem üzenetszintű spend egyetlen szürke ágként végigfut a jobb szélig
(`wid / nincs MC`), nem tűnik el. Így a diagram első ránézésre pont azt a kérdést válaszolja meg,
ami a legdrágább: **mennyi pénz megy olyan helyre, amit a matrix nem lát.**

**Amit nem építenék:** platform-szintű cost sankey (DV360 miatt hazudik), napi bontás (nincs adat),
`family_known` arányos szétosztás (kitalált szám).

## 7. Kérdések, mielőtt bármit építünk

1. **Tényleg ide tartozik?** A spend-riport klasszikusan médiaügynökségi/Excel terep. Ha a válasz
   „egyszer kell egy ábra a prezibe", akkor ez egy lekérdezés + egy kimásolt kép, nem egy új nézet.
2. **Mi a legolcsóbb 80%?** A `monitoring` tábla **már ma is** mutat cost oszlopot rendezhetően
   (`MonitoringTable.tsx`), és van MCP hozzáférés a DB-hez — a fenti product×strategy táblát egy
   promptból kikérni ma is lehet. A sankey akkor éri meg, ha **rendszeresen, havonta** kell, és a
   kérdés az arányokról szól, nem a számokról.
3. **A build kell, vagy az eredmény?** Ha a valódi cél „hova megy a pénz és mennyi esik a matrixon
   kívülre", az egy havi 5 soros riport is lehet. A sankey akkor nyer, ha a *szerkezetet* kell
   megmutatni valakinek, aki nem olvas táblázatot.

Ha ezek után is kell: szólj, és megírom a v1 tervet `tasks/todo.md`-be.
