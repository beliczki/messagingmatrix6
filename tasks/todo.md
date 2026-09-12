# MessagingMatrix v6 — active roadmap + checkpoint

**Ez a lean, aktív fájl.** A teljes történelem (Phase 0–10 logok, összes deploy- és session-checkpoint 2026-04 → 2026-09-07, minden lezárt epic-log) szó szerint megvan itt: **`tasks/todo-archive.md`** (~6200 sor). Ott semmit nem törlünk — ez a hosszútávú emlékezet.

**Munkamenet:**
- Új session-checkpoint ennek a fájlnak az **aljára** kerül (append), nem az archívba.
- Ha az aktív rész kezd hízni a lezárt checkpointoktól, a régieket **átgörgetjük az archívba** (append oda), és itt hagyunk egy egysoros mutatót.
- Részletekért (file:line horgonyok, eredeti tervek, review-k) → `todo-archive.md`, szekció-cím vagy hozzávetőleges sor szerint hivatkozva.

**Kapcsolódó dokumentumok:**
- `docs/REBUILD_SPEC.md` — v6 design spec + multi-tenancy delta D1–D11.
- `tasks/component-inventory.md` — használatban lévő szemantikus class-nevek (új blokk-név előtt nézd meg).
- Master plan: `~/.claude/plans/you-ll-see-docs-and-snappy-charm.md`.

---

## Jelen állapot (2026-09-10)

- **Verzió: `6.85.0`** (live a boxon: `6.83.0` — a 6.84/6.85 deploy-ra vár) a Hetzner boxon (`erste.messagingmatrix.ai`, pm2 `mm6-erste`). Working tree tiszta; a 6.82.x munkák commitálva.
- Phase 0–10 + a 2026-08/09-es epicek mind leszállítva: DCO/Agentic mátrix, Creative Library rebuild, DRAFT-modell (draft = `messages` sor `audience IS NULL`), draft-variánsok, státusz-takarítás (6 státusz), monitoring periódus-tartomány + nap-grain, Drive-linkek, feed diff-alap + „semmi nem tűnik el", dashboard napi áttekintő, Channels-entitás, MCP per-user tokenek.
- **Átrendezés 2026-09-10:** minden lezárt epic-log és a 2026-09-10 előtti checkpointok szó szerint átkerültek a `todo-archive.md`-be („Archivált 2026-09-10 — todo.md átrendezés" szekció). Itt csak a nyitott munka maradt.

**Prioritás-tierek lentebb:** 🟢 NOW = indulásra kész · 🟡 NEXT = green-light után · 🧹 TECH-ADÓSSÁG = adathigiénia és maradványok · 🔵 LATER = push-back-first / blokkolt. Minden item commit-méretű.

---

## 🟢 NOW — indulásra kész (nincs blokkoló külső input)

### ~~Box deploy — 6.83.0~~ — **✅ DEPLOYOLVA (2026-09-11)**
commit `c49d391`, box `0c6bce0`→`c49d391`, `npm run build` OK, `pm2 restart mm6-erste --update-env` → **Ready 1310ms**, box `package.json` **6.83.0**. **Séma-migráció nincs** (`git diff --name-only 0c6bce0..c49d391 -- db/migrations` üres). `error.log` a restart óta üres. Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/drafts` 307 · `/creative-library` 307 · `/api/templates` 401 · `/mcp` 401; publikus `erste.messagingmatrix.ai/login` **200**.

### Apróság-kör (user, 2026-09-10) — M12 + M9.1 + M4.2
Tételenként külön commit, `tsc` + vitest mindegyik után. A `MultiPill`-hez csak az M12.1 nyúl. Végén egy minor bump + CHANGELOG.

### M12 — Mátrix szűrő-pillek: kijelölt érték a pillben + product tag a sor/oszlop-fejléceken (user, 2026-09-10)
Apróságok, screenshotból (`/matrix`, Product + Status `multi-pill`):
- [x] **M12.1 (✅ KÉSZ, 6.83.0, 2026-09-10)** 1–2 kijelölésnél a `multi-pill__badge` a **kijelölt értékeket** írja ki (`HK, SZK`), 3+-nál marad a szám (tooltipben az értékek). Nem prop, hanem **alapviselkedés** minden `MultiPill`-en (Product, Status, Size, Platform, Type, DimensionGrid) — egy `describeSelection()` dönt, nincs call-site logika. Sorrend az **opció-lista** szerint, nem a Set (=klikk-)sorrend szerint; az opciók közül eltűnt, de kijelölt érték a végére kerül és **számít** (perzisztált szűrő, ami tényleg rejt sorokat). 6 unit teszt.
- [ ] **M12.2** Ha **több product** van kijelölve, az **audience oszlop-fejléc** és a **topic sor-fejléc** elejére (a név elé) **product tag** kerül, hogy látsszon melyik termékhez tartozik. Vizuál = a draft-kártya `tag-chip drafts-tile__product` pillje (sötét `bg-slate-800 text-white`, `text-[10px]`) — reuse, ne új család. **Minden density-ben ott legyen, a dense-ben is.** Egy product kijelölésnél (vagy szűrő nélkül, ha egy termék látszik) nem kell.

### M9 — MC archive/delete edit módban: már megoldott, csak a súgószöveg hiányos (user-döntés, 2026-09-10)
Az edit-mode panel Delete gombja archivál vagy töröl (M10 dialog), tehát az MC archiválás use-case-e **megvan** — az egykori M9.1 (külön Archive gomb a `MessageEditor` headerben) **kikerül**, nem építjük.
- [ ] **M9.1** `EditModePanel.tsx:40` súgószöveg bővítése: „Add / duplicate topics and audiences; add, copy and move Messaging Cards." → vegye fel, hogy **MC delete és archive** is edit módban érhető el (a Delete gomb dialogja dönt). Copy-only, semmi logika.
- [ ] **M9.3** (szomszédos, külön commit) audience/topic Archive-akció a `DimensionEditPanel`-be — a restore route-ok + editor-szintű showArchived már élnek, csak a panel kínál ma kizárólag hard-delete-et.

### M4 — Crosshair highlight (sor+oszlop) hover + click-pin
- [x] **M4.1 (✅ KÉSZ, 6.24.0, 2026-08-25)** Él-rail crosshair, NEM state-alapú. Imperatív (`GridView.paintCrosshair` + delegált `onMouseOver`/`onMouseLeave` a `<table>`-ön, ref) → hoverkor nincs grid-újrarajzolás. `data-col-key`/`data-row-key` a 2 header-`<th>`-re + mindkét cella-`<td>`-re; a `c`+`c-1` oszlop `border-right`-ja és a `r`+`r-1` sor `border-bottom`-ja kap `--mx-cross` színt (`matrix-grid__x--edge-r`/`--edge-b`, unlayered CSS). Csak meglévő border SZÍNE vált → **0 layout-shift**, `transition: border-color 140ms` → nem villódzik. Edit módban is megy (border-color ≠ ring box-shadow). Header-hover = csak az az oszlop/sor. Korlát: legszélső bal oszlop / legfelső sor külső élét a sticky header adja (nincs `c-1`/`r-1`).
- [ ] **M4.2** Click-to-pin: kattintásra pinnel escape/újraklikkig; a chip-open klikket nem nyeli el. ⚠️ OPEN Q: pin+hover mindkettő.

---

## 🟡 NEXT — green-light után, alacsony blokk

### UI-apróságok (mátrix + editor + library)

### ~~M1 — Matrix „Color by"~~ — **KIVEZETVE (user, 2026-09-10)**
A funkció lényege **már él, más néven**: `GridView.audienceEdgeClasses()` (`:33`) az audience-fejléc élére csíkot rak, ahol a **vastagság = strategy** (pro 3px / rem 5px), a **szín = platform** (`--plat-dv360` / `--plat-adform`), transzponált nézetben is (`globals.css:609-619`). A user döntése: **sem a „Color by" dropdown, sem legend nem kell.** Az M1.1–M1.3 törölve, nem építjük.

### M7 — Custom-CSS beszúró chipek az MC-editorban — **✅ KÉSZ (6.83.0, 2026-09-10)**
- [x] **M7.4** `elementIds` + `elementClasses` a `TemplateInfo`-ba, `index.html` parse-olásával a `readTemplate`-ben (`lib/templates.ts`), a `sizes[]`-szel azonos cache-úton — az API (`/api/templates`) a teljes `TemplateInfo`-t adja vissza, így külön kivezetés nem kellett. Placeholderből épített név (`id="{{pmmid}}"`, `class="{{template_variant_class}}"`) kiesik. Non-html kind: üres, ahogy a `sizes` is.
- [x] **M7.1** Chip-blokk a `customCss` textarea alá (`SelectorChips`), beszúrás a kurzorpozícióba (ref + selectionStart/End splice), szóköz-normalizálással mindkét oldalon — két chip így **descendant selectorrá** áll össze, nem fúzionál. A kurzor `useEffect`-tel áll a beszúrt token mögé (a textarea kontrollált: klikk-időben a DOM még a régi stringet hordja).
- [x] **M7.2** Méret-chipek: `.size-<W>x<H>`.
- [x] **M7.3 + bővítés** Elem-chipek **két sorban**: `CLASSES` (`.headline_text_1`) és `ELEMENTS` (`#adContainer`). **Felfedezés a valós adatból:** a mentett override-ok mind **osztályra** hivatkoznak (MC94a: `.size-300x250 .copy_text_2 {…}`), az id-k a konténereken ülnek — a todo eredeti `#<id>`-only terve a rossz szókincset kínálta volna.
- **Nyitva hagyva (kicsi):** a `html` sablonnál 25 class + 22 id = 47 chip, ami hosszú blokk. Ha zavaró, egy „több…" összecsukás a Classes sorra a következő kör.

### ~~M8 — Creative Library size filter csoportosított dropdown~~ — **KIVEZETVE (user, 2026-09-10)**
A legolcsóbb 80% már él: a Size pill `SIZE_QUICK_SELECT` preset-linkjei (`CreativeLibrary.tsx:44-51`) — `default / social / iab / none`, és egy preset csak akkor jelenik meg, ha a data tényleg tartalmazza azokat a méreteket. Csoport-fejléc + tri-state = `MultiPill`-műtét (5 használati hely) egy megoldott problémára. **Ha a méretlista tényleg hosszúra nő és zavaró lesz, visszahozzuk** — addig nem.

### Monitoring maradék (Wave 3)
- ~~**W3.g** Matrix cella stat-badge~~ — **KIVEZETVE (user, 2026-09-10).** Nem kell. (Tény a jövőnek: az adat-út kész lenne — `useMessageMetrics` + `/api/monitoring/message-metrics` per-`messageId` impr/cost/conv-ot ad; csak `clicks` hiányzik a `MessageMetricRow`-ból a CTR-hez.)
- [ ] **W3.h → átkeretezve, saját szelet, NEM UI-apróság (user: „most túl nagy", 2026-09-10).** Unmatched sor → message kézi link. **A naiv megoldás némán elveszik:** a monitoring import **periódusonként töröl + újratölt** minden sort (`import/route.ts:121-135`), tehát egy kézzel beírt `monitoring.messageId` **eltűnik a következő feltöltéskor** — és a W3.j-6 (mind a 4-5 riportfájl újraimportja) nyitva áll, szóval ez biztosan bekövetkezik. Túléléshez: override-tábla a **message-kulcsra** (`mcNumber+variant+audienceKey+topicKey` vagy pmmid) + **4. resolver-szint** a `buildMessageResolver`-ben + reapply-pass. Kész minta: `resolveProduct` keyword→product szabályok + `/api/monitoring/reapply-products` — **szabály, nem soronkénti kézimunka**, és épp ezért éli túl az újraimportot. **Első lépés felméréssel:** hány unmatched sor van, ebből mennyi `family_known` vs teljes no-match, és mennyi impressziót visznek — a szám dönti el, megéri-e bármit építeni.
- Deferred: **Meta parser/resolver** — blokkolva valós Meta export sample-ig.

### Agent-oldal (MCP + provenance)

### ~~MCP token-scope #3: `draft`~~ — **✅ KÉSZ (6.84.0, 2026-09-12)**
Leszállítva: `read | draft | full`. A `draft` mindent olvas, és csak a draft-térbe ír
(`generate_test_creative`, `brief_attach`, `draft_archive`, `asset_upload`). **Séma-migráció nincs**
(`mcp_tokens.scope` sima `text`, check constraint nélkül).

- [x] **S1** `McpScope = "read" | "draft" | "full"`; `resolveBearerClient` a tárolt értéket adja.
- [x] **S2** `buildMcpServer` `draft` ága; `draft_promote` külön `registerDraftPromoteTool`-ba emelve,
      csak `full` kapja — a promote cellát ad, azaz kilép a draft-térből.
- [x] **S3** `outsideDraftScope()` sorszintű őr. Két helyen kellett: `brief_attach` (bármely message
      id-t elfogad) **és — menet közben derült ki — az `asset_upload` `replace_existing`-je**: a
      fájlnév-feloldás newest-first, tehát a csere azt írja át, amit egy **már kihelyezett** kártya
      renderel. Az őr a SORON ül, nem a tool-listán, különben egy később hozzáadott tool kicsúszik.
- [x] **S4** `mcp-tokens/route.ts` validáció (`read|draft|full`); demo user marad `read`-only.
- [x] **S5** `McpTab.tsx`: típus, `SCOPE_BADGE` map (amber), select-opció, próza.
- [x] **S6** 5 új teszt (tool-lista draft scope-ban · bearer-feloldás · `brief_attach` placed kártyán
      elutasít + full-scope kontroll · `replace_existing` elutasítás + új név megy). 911/911.
- [x] **S7** CHANGELOG + `6.84.0` minor bump.

**⚠️ Nyitva hagyott döntés (user elé):** a `scope` oszlopon **nincs check constraint**, és az ismeretlen
érték **`full`-ra szélesedik** (`mcp.ts` `resolveBearerClient`) — ez a 6.0 óta így van, én csak
dokumentáltam (teszt + komment). Egy elgépelt kézi SQL így teljes jogot ad. Szűkítés `read`-re +
check constraint = egy migrációs szelet; a user dönt.

**Következő szelet → ✅ leszállítva `6.85.0`-ban:** `draft_update` MCP tool.

### I2 — Komment-thread mint **entitás-provenance** (DÖNTÉS LEZÁRVA)
**User-döntés:** „thread lenne a legjobb, fáj hogy nem látszik ki mikor mit" + **a cél explicit: az agenteknek kontextust adni** arról, hogy mi változott, milyen kérésre, miért, és **egyáltalán miért hívnak úgy egy topicot / audience-t / MC-t, mi van rajtuk, miért jöttek létre.**
⇒ **Ez átkeretezi a feladatot:** nem „chat-buborék UI" a fő termék, hanem **entitásonkénti provenance-napló, aminek az agent az elsődleges olvasója és társ-írója**. Az MCP olvasó/író oldal tehát nem opcionális ráadás, hanem a lényeg.
**Felmért tények:**
- Ma **egyetlen `comment` text oszlop** van (nincs szerző, idő, thread): `audiences:175`, `channels:248`, `topics:311`, `messages`, `assets:487`, `creatives:528` (`src/db/schema.ts`).
- **`share_comments` (`:704-726`) viszont már valódi thread-tároló:** `itemKey` diszkriminátor (`"matrix:{messageId}:{size}"` / `"creative:{id}"`), `authorName`, `body`, normalizált `annotation` (point/rect JSON), `createdAt`, `archivedAt`. Ma a publikus share-galériához kötve (`shareGalleryId` NOT NULL).
- **`share_comments`-ben mindössze 2 sor van** ⇒ az általánosításnak **nincs érdemi adat-migrációs kockázata**.
- Az „ember vagy agent" **ugyanaz az egy fogalom, mint az `FR-D D.1` `actor_kind`-ja** → **egyszer definiáljuk** (I1.6), és a komment ugyanazt használja.
- [ ] **I2.1 Séma:** `share_comments` általánosítása — `share_gallery_id` **nullable**, + `entity_type` / `entity_id`, + `author_kind` (`user|agent`), + `user_id` / `mcp_token_id`. A meglévő 2 sor `entity_type='share_item'`-mel back-fillelve. Migráció (`0008+`) **+ kód egy passzban** a boxon. A régi 6 `comment` oszlop **marad** (nem migrálunk adatot az első körben).
- [ ] **I2.2 Entity-réteg:** `entities/comments.ts` — `listComments(entityType, entityId)` / `addComment` / `archiveComment`. A `keywords`-minta (managed tábla ordering+archive-val) a precedens.
- [ ] **I2.3 MCP (a lényeg):** `list_comments` (read) + `comment_add` (write, `author_kind='agent'`, a hívó token azonosításával) — így az agent **olvassa a miértet és hozzá is ír**. McpTab „Comments" group + prose (a tool-lista auto-szinkron, a prózát kézzel kell).
- [ ] **I2.4 UI — EGY helyen debütál:** buborék-thread az **MC-editorban**; ember/agent avatar-jelöléssel, idővel, szerzővel. Csak ha bevált, terjed a topic/audience header-dialogra és az asset/creative detailre.
- [ ] **I2.5** Tesztek (entity + MCP + route) · component-inventory · CHANGELOG · bump.
- ✅ **LEZÁRVA (user, 2026-08-30):** a mai egy-mezős `comment` oszlopok **változatlanul maradnak** a thread mellett — az első kör semmit nem vesz el.

---

### I1.6 — `actor_kind` az audit_logon (az I1 dashboard egyetlen nyitott tétele; az I2-vel EGY migrációs passzban)
- [ ] **I1.6 (külön slice, migrációval) `actor_kind`:** `FR-D D.1` — `ui|mcp` oszlop az `audit_log`-ra + beállítás a két writer-site-on + ember/agent badge a digestben. **Migráció + kód egy passzban a boxon.** Ugyanez az oszlop-fogalom kell az I2-höz → **egyszer szülessen meg.**

---

## 🧹 TECH-ADÓSSÁG — adathigiénia és migrációs maradványok

### Scripts: unawaited `getActiveClient()` sweep (PG-cutover maradvány)
A `getActiveClient()` a SQLite→PG váltáskor lett async; a route-okat akkor javították, a `scripts/`-et nem (a tsconfig nem fedi, `tsc` nem fogja). A `seed-channel-audiences.ts` élesben elhasalt (`UNDEFINED_VALUE`, params:[undefined]) — 2026-08-13-án javítva. **9 további script ugyanígy törött:** scan-creatives, import-erste-sample, link-creative-files, reimport-media, import-erste, seed-multi, seed-perf, seed-keywords, seed-dev. Háromnál a befogadó `main()` nem is async → scriptenként kell (async-esítés + hívás). Előbb döntsd el, melyik retire-elhető (import-erste* / seed-dev SQLite-éra); a maradékra egyenkénti fix + kézi futtatás-teszt.
- [ ] Retire-vs-fix döntés scriptenként, aztán a maradék javítása egyesével.

### Legacy `reporting` tábla retire
- [ ] **Legacy `reporting` retire (LAST):** a 2 lingering olvasó (`mcp.ts:350` monitoring_status→adformStatus, `:977` matrix_status→syncedAt) átkötése `monitoring`-ra → tábla drop-migráció → import/export-xlsx + snapshot refek takarítása.

### Monitoring nap-grain — az újraimport a useré
- [ ] **W3.j-6** Újraimport a 4 (5) meglévő riportfájlból a Monitoring oldal feltöltőjén át — nem script. **Migráció + kód egy passzban a boxon** (`migrate` + `pm2 restart`), ahogy a `mcp_tokens` szeletnél is.

### DRAFT-modell utóélet (Slice 1–5 leszállítva 2026-09-04–06, log az archívban)
- [ ] **D1.4a** ⚠️ **Soft-link következmény (2026-09-04, a legacy-nyomozásból):** a `creatives`, `monitoring` és `prodlist_rows` táblák `(mc_number, mc_variant)` **soft linkkel** mutatnak az MC-re, nem FK-val. Amint a draft is `messages` sor **számmal és variánssal**, minden ilyen link **DRAFT sorra is illeszkedhet**. Konkrét eset már ma: a `MC78b`-hez tartozó 4 kreatív `(78,b)`-re illeszkedik, ami **két axison is létezik** — a DCO-sat most DRAFT-ba tesszük, a nonDCO-s marad. Döntendő: a creative↔cell match **lássa-e** a draftokat (mellette szól: így kap a draft kreatívot; ellene: a `family_known` több-találatos ág zajosabb lesz). A `monitoring` **soha** ne lásson draftot (nincs mérés draft előtt).
- [ ] **D7.2** **Invariáns-sértés a prodban:** a `321` a **nonDCO axison két topicot fog át** (`HITEL_TCU_2026Q2_fullColorSurface` + `SZK_HITEL_a_TCU_2026Q2_fullColorSurface`), miközben a szabály *„a number never spans topics WITHIN an axis"* (`messages.ts:283`). Valószínű ok: a 2026-08-17-i kézi SQL-átszámozás (`MC838a → MC321a`), ami megkerülte a `createMessage` ellenőrzéseit. Két közel-duplikált topic is keletkezett. Felmérés → egy topicra összevonás vagy külön szám; és **ez az érv a D6.1 (first-class renumber/move) mellett** — a kézi SQL épp az invariánsokat kerüli meg.

### nonDCO szám-egyediség — megfigyelés (Creative Library rebuild, 2026-08-17)
- **Nyitott / megfigyelés:** nonDCO-ban a fájlnév-szám termékenként ismétlődhet → egy nonDCO szám megjelenhet két product-topicban (külön cella/pmmid, nem ütközik; a user DCO-szabálya nem tiltja). Ha nonDCO-egyediség kell, a scriptbe within-nonDCO ütközés-feloldás kell. Video-only channel (YT) + PRG/GSN/GNW méret-map: később. Deferred: nonDCO auto-topicok üres sorként a DCO nézetben (Slice-4 topic-scoping).

---

## 🔵 LATER — push-back-first / blokkolt

**Séma-migráció szabály (memory):** új oszlop/tábla `db:generate` → `0019_*.sql` (jelenleg legmagasabb `0018_jazzy_steel_serpent.sql`), és a **migráció + kód-deploy egy passzban** megy a boxon (migrate + `pm2 restart mm6-erste`), soha nem lokál `db:migrate` önmagában.

### Wave 4 — Platform expansion (Meta / DV360 / Direct Display)
**Push-back gate (W4.1):** a user Metát MM6-ból *hajt* (full audience+feed lifecycle) vagy csak *trackel* (a Wave 3 monitoring-ingesttel már megvan)? Tracking-only → az egész Wave egyetlen audience platform-tag-re esik össze.
Fő lépések (ha full-lifecycle):
- [ ] **W4.2** `audiences.platform` enum-by-convention (`adform|meta|dv360|direct_display`, default `adform`) — `schema.ts:157`; `db:generate`→`0004`; per-row backfill. `buyingPlatform` (`:170`) marad DSP/seat-label.
- [ ] **W4.3** Audiences UI: platform pill a `DimensionGrid`-be + `Platform: All|AdForm|Meta|DV360|Direct` filter.
- [ ] **W4.4** Per-platform feed-config: ma `feedStructure` egyetlen config-string + `patterns.feed` Record (`feed-export.ts`) → per-platform kulcsra; Settings → Patterns platform-tab.
- [ ] **W4.5** Feed-export route platform-aware: `platform` a `BuildOptions`-ba (`feed-export.ts:63`) + POST bodyba; `buildFeedRowSet` (`:276`) a `readFeedStructure/Patterns` hívásnál (`:287-289`) platform szerint választ. **BLOKKOLT** míg a Meta export-formát nem lockoljuk (Custom Audience CSV vs bulk Ads Manager XLSX).
- [ ] **W4.6** Feeds UI platform-diszkriminátor oszlop+filter (`FeedsView`).
- [ ] **W4.7** Direct Display: csak `platform='direct_display'` tag; vendor a `buyingPlatform`-ban (default: nincs új mező).

### Wave 5 — Share → Google Drive
**Push-back gate (W5.1):** a legolcsóbb 80% = share-view PDF-export + manuális Drive drop? Ha igen → **kill the build.** Csak konkrét kliens/agency-workflow igényre.
- [ ] **W5.1** Push-back döntés.
- [ ] **W5.2** Open Q-k lock (ha build): target folder · formátum (PDF/CSV-JSON/assets+manifest) · naming · auth (per-user Google vs MM service account) · snapshot-vs-sync · lifecycle.
- [ ] **W5.3** Destination toggle: Option 1 = mai MM (default), Option 2 = Drive (placeholder) → Option 2 narrowest-viable-first.

### FR-A/B/C/D — agent-facing tárházak
**Elv:** elsősorban az AGENTEKÉRT (vékony UI + MCP tool-felület). Mindegyik előtt 3-kérdéses push-back (tényleg MM6 vs brain/inbox? legolcsóbb 80%? build vs outcome?).
**Közös minta (grounded):** managed tábla ordering+archive-val → `keywords` pgTable (`schema.ts:725`) + `/api/keywords/*` + `KeywordsTab`. Új MCP tool → `registerTool(name,{description,inputSchema:zod-field-map},handler)`; write: `requireRate`→entity-helper→`writeAudit({userId:mcpUserId})`→`jsonResult`; batch = `db.transaction`+egy audit (`mcp.ts:1180/2122/228`). Új Settings tab → folder+komponens + `TabKey` + `TABS` + render-ág (`SettingsView.tsx:16,27-37,115-131`).
- [ ] **FR-A Prodlist management** — agent-feldolgozott prodlist-sorok first-class rekordként; soronként MC vagy creative-hez köthető. Ref: `~/ERSTE Addressable AI Agent/outputs/prodlist_q3_2026`. Lépések: `prodlist_rows` tábla → `/api/prodlist/*` → MCP list/get/update/link/processed-mark → vékony lista-UI. ⚠️ OPEN Q lent.
- [ ] **FR-B Documents** — Google Slides link-tárház; agent követi melyik MC-nek van tracking-slide-ja + állapota. Lépések: `documents` tábla nullable soft-link a messages-hez → `/api/documents/*` → MCP list/get/add/update/link + "mely MC-knek nincs slide" query → vékony lista-UI.
- [ ] **FR-C Request-a-change** — ticket-inbox → auto-roadmap. **Default: legolcsóbb 80% = strukturált `todo.md` szekció** (ez a reorg adja az alapot), nem új tábla; `change_requests` tábla + státusz-pipeline csak valós multi-filer igényre.
- [ ] **FR-D Dashboard** (meglévő oldal, legkönnyebb push-back): **D.1** `actor_kind` (`ui|mcp`, opc. `token_id`) oszlop az `audit_log`-ba (`schema.ts:113` ma csak `userId`; `0004+` migráció) + beállítás a két writer-site-on (UI entity-route + `mcp.ts` ~30 call-site) + widget-badge. **D.2** users-join a raw `row.userId` helyett (`page.tsx:123` → email/név). **D.3** utolsó-90-nap `count()` predikátum az `entityCounts()`-ba (`page.tsx:18`) tile-onként.

### MCP SDK v2 migráció (`2026-07-28` spec)
- [ ] **NEM most.** Várunk a v2 stable-re (~2026-07-28), aztán branch-en. Migrációs checklist: archív § "MCP `2026-07-28` spec compatibility" (~L1450). A `show_mc_previews` widget (OpenAI Apps SDK) a valódi app-szintű munka.

### Parallel polish — Dark-mode component sweep (WP.1–8)
- [ ] Piecemeal, **soha nem search-and-replace**; egy klaszter egyszerre, vizuális verifikáció. Sorrend: sidebar → modals → grids → matrix chrome → forms → status pills → iframe chrome → QA. Alap (shadcn-tokenek) 2026-05-07-én landolt. Archív: § "Parallel polish" (~L2593) + punch list §10 (~L1585).

---

### DRAFT-modell Slice 6 — roadmapre, most NEM építjük
- [ ] **D6.1** Mért MC mozgatása pmmid-folytonossággal: first-class művelet explicit megerősítéssel + a régi pmmid megőrzésével, hogy az ACTIVE-ból visszakattintás kerülőút (és a "feedből némán kiesik" kockázat) megszűnjön. *Megjegyzés: a normál előre-irány (PREVIEW → APPROVED → mozgatás → ACTIVE → feed-export) nem kockázatos — a feed-export ACTIVE-ra gate-el, tehát közben nem exportálódik semmi. Csak a MÁR ACTIVE sor visszakattintása az.*
- [ ] **D6.2** Share-oldali approve gomb → `status='APPROVED'` (ember vagy agent). A purpose-doksi 9.3-as hiánya; az `APPROVED` ezért marad a listában (0 sora **be nem kötöttséget** jelent, nem feleslegességet).

### I5 — Feed-részletek a 500-as limit miatt (IGÉNY RÖGZÍTVE, 2026-08-31 — user: „ezzel majd később")
**Modell-javítás (user):** a „productonként egy live feed" **hibás kérés volt** — egy termékhez több élő feed tartozhat. **Az SZK mai esete a PLATFORM szerinti kettősség**, amit a 6.34.0 már megold (`feed_exports.platform`, `findLiveExport(product, platform)`, platformonkénti verzió-vonal és Live sor). **Máskor viszont a `MAX_ROWS_PER_FEED = 500` is szétvághat egy terméket két részletre** — ez a rész elhalasztva.
- **User-döntés, ami már megvan:** a részletek **két önálló feed** (nem egy feed két fele) → külön verzió-vonal, külön élő sor, külön diff — pontosan az a forma, amit a platform-oszlop csinál. Egy jövőbeli limit-alapú vágásnak ugyanígy **saját megkülönböztetőt** kell kapnia, nem az uniót kell diffelnie.
- **Nyitva:** mi a megkülönböztető a limit-alapú vágásnál (a vágás helye önmagában nem jelent semmit), és ki dönti el a vágást (automatikus limit szerint vs kézi MC-besorolás, ami megmarad a következő exportra). A user mindkettőt későbbre tette.
- **Tény a döntéshez:** `MAX_ROWS_PER_FEED = 500` (`feed-export.ts:32`), és az SZK exportok korábban **443 / 644 / 681** sorosak voltak — tehát a limit valós kényszer, nem elméleti.

### M11 Fázis 2 — nonDCO szintetizált topic-sorok sorrendje (⚠️ ÚJ TÁROLÁSI RÉTEG — push-back-first)
A nonDCO topic-sorok a `message.topic` keywordből szintetizálódnak, nincs `orderIndex`-ük. Sorrend-mentéshez új overlay-tábla kellene (`matrix_row_order`). **3-kérdéses push-back MIELŐTT tábla születik** (tényleg kell perzisztens sorrend? legolcsóbb 80% = localStorage-order? build vs outcome?). Fázis 1 (valódi `orderIndex`) kész 6.23.0-ban — részletek az archívban.

### W3.k — nap-felbontású monitoring tartomány-lekérdezés (`?from=2026-06-15&to=2026-07-20`, „last 30 days")
Előfeltétel: W3.j-6 újraimport (fent). UI-t és dashboard-csempéket is érint, külön szelet.

---

## 📌 Deferred / pinned (nincs változás)
- Phase 11 file-ingest pipeline (Forklift/Drive → `_inbox/` + MCP error-triage toolok, post-launch).
- Sankey alt-graph a Tree view-hoz (valós igényre).
- HTML creative auto-preview image link (use-case-ek scope-olása előbb).

---

## Nyitott döntések — AJÁNLOTT DEFAULTOK (user bólint / felülír)

1. ~~**M1 `Both` vizuál**~~ — tárgytalan, az M1 kivezetve (2026-09-10).
2. **M4 pin + hover** → *default:* mindkettő — hover ideiglenes crosshair, kattintás pinnel escape/újraklikkig.
3. **W2.5 soft-link vs join-tábla** → *default:* marad a soft `(mcNumber, mcVariant)` link; join-tábla csak valós many-to-many workflow igényére.
4. **FR-A/B/C tábla vs view** → *default:* FR-C = strukturált `todo.md` szekció előbb (nincs új tábla); FR-A/B = új tábla nullable soft-linkkel a messages-hez + MCP write-tool — de csak a 3-kérdéses push-back után.

---

## Session checkpointok (legutóbbi felül; régiek → archív)

> 2026-09-10 előtti checkpointok (2026-07-21 → 2026-09-07, 6.9.0 → 6.72.0) + minden lezárt epic-log: `todo-archive.md` § „Archivált 2026-09-10 — todo.md átrendezés".

### 2026-09-10 — dashboard: friss adat kattintásra + „ebben a hónapban még nincs riport" (TERV, jóváhagyásra vár)

**User (két kérés, egy képernyő):**
1. „frissítési gond volt, kéne hogy ha átkattintok akkor reload nélkül is frissüljön"
2. „ha szeptemberi időszakban vagyunk sept 4-10 ig akkor azt kéne mutassa … hogy szeptemberre nincs adatunk, még akkor is ha mutatja a multat ami jó, de kéne ott egy szeptember oszlop hogy üres"

**Gyökérok (1) — nem cache-bug.** A `staleTimes.dynamic` alapértéke a Next 15.5-ben `0`
(`node_modules/next/dist/server/config-shared.js:203`), a `/` ráadásul `force-dynamic`
(`src/app/(app)/page.tsx:63`), tehát appon belüli navigációnál a szerver úgyis újrarenderel.
Ami tegnap megfogott: **a fül órákig nyitva állt, és a napi horgony a URL-be van fagyasztva**
(`?d=2026-09-09&r=7d`). Éjfél után ugyanaz a URL már a *tegnapi* ablakot kéri — a ma készült
MC-k nem hiányoztak, csak kívül estek. A cookie ezt jól kezeli (`dashboard-view.ts`: „a CHOSEN
VIEW, nem egy befagyasztott dátum"), a nyitva felejtett fül URL-je nem.

- [x] `_dashboard/DashboardLiveRefresh.tsx` (client, semmit nem renderel): `visibilitychange` →
      ha a URL `d`-je < mai UTC nap, `router.replace` a mai horgonyra (a `r`/`p`/`cs`
      paramétereket megtartva); egyébként `router.refresh()`.
- [x] Nincs interval, nincs polling — a kiváltó ok a fül visszafókuszálása, nem az idő múlása.
      Csak `visibilitychange`: egy eseményt hallgat, így nincs mit deduplikálni (a `focus`
      ugyanarra a fülváltásra másodszor is tüzelne).
- [x] Csak a dashboardon (user: „Csak a dashboardon"). A Matrix / Creative Library szerkesztési
      állapotot tart; ott egy magától érkező refresh kockázat, nem szolgáltatás.

**Gyökérok (2).** `monthlyDelivery` (`src/lib/dashboard-monitoring.ts:33`) azt a néhány perió­dust
adja vissza, ami a `monitoring`-ban **létezik** — szeptemberi import nincs, így szeptemberi oszlop
sincs. Mindkét csempe (`DeliveryTrend`, `CoverageTile`) a sor utolsó elemét tekinti „current"-nek,
ezért az augusztus úgy néz ki, mintha a mostani hónap volna.

- [x] `DeliveryMonth` kap egy `reported: boolean` mezőt; `monthlyDelivery` új 4. paramétere
      (`throughMonth`, „YYYY-MM") a legutolsó importált periódus és a scope horgony-hónapja közti
      naptári hónapokat **üres elemként** hozzáfűzi (`padMissingMonths`). A page a
      `scope.date.slice(0, 7)`-et adja át.
- [x] A fejszám (20.1M / 35%) **marad az utolsó importált hónapon** — a user szerint a múlt mutatása
      jó. Mindkét csempében `measured = months.filter(m => m.reported)`, és a `latest` innen jön;
      a coverage `0/0`-t sosem oszt.
- [x] Az üres hónap oszlopa **nem 6%-os csonk** (az „majdnem nulla delivery"-t jelentene), hanem
      szaggatott keretű, teljes magasságú placeholder; tooltip: „Sep 2026: not imported".
      A tengelyfelirat `text-slate-300`. A hint mondatban is ki van mondva:
      „impressions · Aug 2026 vs Jul · no Sep data yet".
- [x] Új szemantikus nevek a `component-inventory.md`-ben: `delivery-trend__bar--missing`,
      `coverage-tile__bar--missing`.
- [x] 4 új teszt a `tests/integration/dashboard-monitoring.test.ts`-ben (kitöltés, évforduló,
      „a scope hónapja ≤ utolsó import → nincs padding", „nincs import → nincs horgony").
      13/13 zöld.

**Döntés (user, 2026-09-10):** a feltöltés a *scope* horgony-hónapjáig megy — júniusra
visszalapozva nincs padding, a csempe azt mutatja, ami akkor igaz volt.

**Nyitva:** a lokális prod buildet böngészőben nem néztem meg (a login a userre tartozik);
`npm run build` + `tsc` + `eslint` + a 13 teszt zöld.

### 2026-09-10 — draft variánsok + Creative Library mint a draft anyagtára (TERV jóváhagyva)

Teljes terv: `~/.claude/plans/v-rjunk-m-g-van-m-g-jiggly-storm.md`. User-döntések: a draft **nyitva marad indexként**
(nincs auto-promote/archiválás), a `target` **átkerül a Brief fülre**, variáns-létrehozás **két akció**
(duplicate / empty), cover **csak 300×250**, egyébként „No 300×250 agentic preview yet".

- [x] **Slice 1 — `promoteDraft` guardok** (séma nélkül, UI nélkül): cross-topic szám-guard (axis-scoped,
      `sameAxisAs`) + archivált-iker guard. Előbb megy ki, mint a Slice 2, mert az teszi elérhetővé őket.
- [x] **Slice 2 — MC404b**: `createDraft` `requestedNumber`, `createDraftVariant(mode)`, `POST /api/drafts`
      `{ from_draft_id, mode }`, két gomb a Brief fülön, Delete-copy javítás több draft esetén.
- [x] **Slice 3 — `draft_target`**: 0018 migráció + check constraint, plumbing, szegmentált vezérlő a Brief
      fülön, a Promote fül olvassa (read-only sorral).
- [x] **Slice 4a — matched adat + Promote fül**: `listCreativeMatchesForMcs`, additív `matches` a
      `/api/creatives/by-mc`-n és a `/api/drafts`-on, számláló + bélyegkép-sor.
- [x] **Slice 4b — fal + jobb panel**: kártya-cover szabály, sarok-badge, editor jobb panel library-preview.

**Mind az öt szelet leszállítva, 6.73.0 (2026-09-10).** `npm test` 871/871 (92 fájl, ebből új:
`draft-target`, `creative-matches`, `api/drafts-variant`, plusz 9 új eset a `draft-lifecycle`-ben),
`tsc` + `eslint` + `next build` tiszta.

⚠️ **Deploy-figyelmeztetés: séma-migráció VAN (`0018_jazzy_steel_serpent.sql`).** A dev a *közös*
Hetzner Postgresre néz, tehát amíg a migráció nem futott, **sem lokálisan, sem élesben nem indul**
a `messages`-t olvasó lekérdezés (`column "draft_target" does not exist`). Egy passzban, a boxon:
`export $(grep '^DATABASE_URL=' .env | xargs) && npm run db:migrate` → build → `pm2 restart
mm6-erste --update-env`. Az oszlop nullable + check, a régi kód sosem írja, tehát a migráció
önmagában ártalmatlan a futó verzióra.

**A dashboard-szelet (üres hónap-oszlop + fókusz-frissítés) ugyanebben a bumpban ment.**

**DEPLOYOLVA 6.73.0 (2026-09-10):** commit `5f285d0`, box `e1886f7`→`5f285d0`. **Séma-migráció VAN**,
egy passzban: `export $(grep '^DATABASE_URL=' .env | xargs) && npm run db:migrate` (0018) → build →
`pm2 restart mm6-erste --update-env` → Ready 1240ms. Mentés nem kellett: a migráció tisztán additív
(`ADD COLUMN draft_target text` + check), a rollback egyetlen `ALTER TABLE messages DROP COLUMN
draft_target`. Ellenőrizve élesben: az oszlop és a `messages_draft_target_values` constraint ott van,
`error.log` üres a restart óta, `deployed 6.73.0`. Health: `/login` 200 · `/` 307 · `/drafts` 307 ·
`/matrix` 307 · `/api/drafts` 401 · `/mcp` 401 · **`/share/fke-60Mn5frC` 200** — ez utóbbi a lényeg,
mert publikus és `messages`-t olvas az új sémán át, tehát a kód és a DB együtt van.

~~**Böngészőben NEM ellenőrizve**~~ → a 6.74–6.83 iterációk mind ezeken a felületeken mentek, élőben
használva. Lezárva 2026-09-12.

### 2026-09-10 — draft-kártya: kétsoros meta + akció-menü — 6.74.0

**User:** „tegyük az MC alá a product taget és a draft name-et, és tegyünk egy ellipsis local menüt a
kártyára ahonnan lehet a duplicate, new variant, az archive és delete akciókat választani"

- [x] `drafts-tile__meta` **két sor**: `__mc` külön, alatta `__sub` = product chip + név. A 6.72.0-s
      egysoros szabályt a *tördelés* indokolta (egyes kártyákon két sorra nőtt, másokon nem) — a fix
      kétsoros blokk ezt nem hozza vissza, egyik sor sem tördel.
- [x] `drafts-tile__menu` — ellipszis a média jobb felső sarkában, `opacity-0 group-hover:opacity-100`;
      Duplicate as variant · New empty variant · ─ · Archive · Delete. Kívülre kattintás + Escape zár
      (a `creative-library__preview-warning` mintája).
- [x] **A csempe külső eleme `div` lett, benne a kattintható `button`** — gomb a gombban érvénytelen
      markup, a böngésző lezárja a külsőt és a kártya saját kattintása elromlik egy részén.
- [x] A Delete helyben, két kattintással erősít, és a SZÁMRÓL beszél: testvér-drafttal
      „MC404 stays reserved.", egyébként „free the number?". Ugyanaz a nyelv, mint a Promote fülön.
- [x] A matched-badge **balra** költözött, mert a jobb felső sarkot a menü kapta.

`npm test` 871/871, `tsc` + `eslint` + `next build` tiszta. Séma-migráció nincs.

### 2026-09-10 — a draft akciói egy helyre: a kártya drop-up menüje — 6.75.0

**User:** „legyen az első sor Product tag + MC, és a name legyen a második sor, az ellipsis legyen
felhulló menü és jobb alsó sarokban, vízszintes ellipsis, és legyenek bele kivezetve az akciógombok
ne csak bemenjen a kártyára, és ezeket az akciógombokat meg vegyük ki belülről. A Brief fülön a
product lehet egymás mellett a Draft name-mel, nem kell az input mezők alá a magyarázat szürke
szöveg, a variants úgy kerüljön ki az action menübe."

- [x] `drafts-tile__meta` első sor: `__product` + `__mc`; második sor: `__name`. `pr-8`, hogy a menü
      ne üljön rá.
- [x] `drafts-tile__menu` a **jobb alsó** sarokban, **felfelé** nyílik (`bottom-full mb-1`) — a gomb a
      kártya alsó élén ül, lefelé nyílva kilógna a kártyából és az utolsó soron a görgetőből is.
- [x] `brief-tab__variant` **megszűnt** — a két variáns-akció a kártya menüjében él.
- [x] A Promote fül `promote-tab__discard` párosa (Archive/Delete) **megszűnt** — ugyanoda költözött.
      A fül egy kérdést válaszol meg: hova. Vele ment a `siblingDraftCount` prop és a `confirming` state.
- [x] `brief-tab__intake-row`: Draft name (`flex-1`) + Product (`w-36`) egy sorban.
- [x] A Brief fül `Field`-jei **hint nélkül**. A Brief slide inputnak placeholdere van, a hibát a
      `form-field__error` mondja ki — a magyarázó bekezdést senki nem olvassa kétszer.

`npm test` 871/871, `tsc` + `eslint` + `next build` tiszta. Séma-migráció nincs.

### 2026-09-10 — draft = egy MC, a variánsok befelé (TERV, jóváhagyásra vár)

**User:** „a draftokat ne kezeljük variánsonként, mert nem tudjuk előre hány lesz — a draft fogja csak
az MC sorszámot, a variánskezelés menjen belülre: Brief fül, aztán variant a / variant b tabok, de
csak egy tabbal indulunk. Egy tabon belül legyen minden content dolog: template szekció, content
szekció, style szekció. Lehessen tabot duplikálni vagy hozzáadni. Ha több tab mint 4, ne írjuk ki
hogy »variant a«, csak »a, b, c«. A tervezett topic mezőt vezessük ki a Brief fülre a Target fölé.
A promote akció kerüljön a kártya ellipszis-menüjébe, dialógust nyisson, ahol beállítható mely
variánsokat promotáljuk, milyen audience-re (default INCOMING), milyen státusszal (default PREVIEW),
melyik topicra, és hogy promote után a draft megmaradjon vagy archiválódjon — két megerősítő gomb:
»Promote and archive« / »Promote«. Nem kell form element."

**Két tisztázott döntés (user, 2026-09-10):**
- **A promote konvertál, nincs duplikátum** — a sor megszűnik draft lenni, ahogy ma. A „megmaradjon
  vagy archiválódjon" tehát a **nem promotált** variánsokra vonatkozik: a `Promote` a maradékot a
  falon hagyja, a `Promote and archive` nyugdíjazza. **Nincs modellváltás**, a szám/brief/történet
  ugyanúgy átmegy.
- **Cover:** az `a` variánssal indul, és a kártya fölött **vízszintesen scrubbolva** vált — ahány
  variáns, annyi aktív sáv a médián, és a preview arra ugrik.

**Séma-migráció NINCS.** A variánsok ma is külön `messages` sorok ugyanazon a `number`-en; a változás
az, hogy a fal és a szerkesztő ezt **egy kártyaként** kezeli.

- [x] **Slice 1 — a fal MC-számonként csoportosít.** `DraftsView`: `drafts` → `Map<number, Draft[]>`
      betű szerint rendezve, egy `DraftTile` csoportonként. A csempe címkéje `MC404` (betű nélkül).
      Cover = `a`, `drafts-tile__scrub` sávokkal: N egyenlő zóna a médián, `onMouseEnter`-re vált az
      aktív variánsra, `onMouseLeave`-re visszaáll `a`-ra; alul N szegmensű jelző. A `mc:` szűrő a
      csoportra illeszkedjen. Az Archive/Delete a **teljes MC-re** hat (minden variáns-sora), a
      megerősítő szöveg mondja ki a darabszámot.
- [x] **Slice 1b — a matched-jelzés a médiáról a meta sorba.** A sarok-badge megszűnik; helyette az
      MC szám **mellett**: `MC404 · matched 18 (a,b)` — az összes találat a variánsokon át, és
      zárójelben azok a betűk, amelyekhez tartozik anyag. Nulla találatnál nem írunk ki semmit.
      (User, 2026-09-10: „ne a jobb sarokba írjuk ki hogy 9 creative found, hanem az MC szám mellett".)
- [x] **Slice 2 — variánsváltó a szerkesztő FEJLÉCÉBEN, nem fülekben** (user, menet közben: „ne
      kelljen szétbaszni az MC editor fülkezelését"). Új, önálló komponens a `‹ ● MC404a › 1/5`
      léptető mellé: a szám variánsai gombként (`a` `b` `c`), az aktív kiemelve, kattintásra a
      meglévő `onJump`-pal vált sorra; mellette `+` a *Duplicate this variant* / *New empty variant*
      párossal. **A Template / Content / Styles fülek érintetlenül maradnak**, és a mátrix
      fülkezeléséhez egyáltalán nem nyúlunk. A `Promote` fül eltűnik (a kártya dialógusába megy).
- [x] **Slice 3 — tervezett topic a Brief fülre**, a Target fölé (a draft szabadszöveges `topic`-ja).
      A Promote fül hintje eddig ott mondta ki; az a hely megszűnik.
- [x] **Slice 4 — Promote dialógus a kártya menüjéből.** `AppDialog` shell, **nincs `<form>`**:
      variáns-checkboxok (default mind) · audience `<select>` (default `<PRODUCT>_INCOMING`, ha van
      ilyen kulcs) · státusz `<select>` (default `PREVIEW`) · topic `<select>` (csak létező topic,
      a promote sosem hoz létre topicot) · két gomb: `Promote` és `Promote and archive`.
      Új route: `POST /api/drafts/promote` `{ ids, audienceKey, topicKey, status, archiveRest }`,
      betűsorrendben hívja a `promoteDraft`-ot, és per-id eredményt ad vissza.
- [x] **Slice 4b — a saját betű megtartása promotáláskor.** Ma a `promoteDraft` akkor is a következő
      szabad betűre ugrik, ha a draft SAJÁT betűje szabad a cellában (404a és 404c promotálásakor a
      `c`-ből `b` lesz, csendben). A javítás: ha a draft betűje szabad a célcellában, maradjon; csak
      ütközéskor bumpoljon. Enélkül a dialógus részhalmaz-promotálása átnevezi a variánsokat.

**Amit ez visszavon a mai munkából:** a kártya menüjéből a két variáns-akció kikerül (befelé megy a
fülsorra), a Promote fül megszűnik. Az Archive/Delete a menüben marad, de MC-szintre tágul.

**Leszállítva 6.76.0 (2026-09-10).** `npm test` 880/880 (93 fájl, új: `api/drafts-promote-batch`),
`tsc` + `eslint` + `next build` tiszta. **Séma-migráció nincs.**

Két dolog, ami menet közben derült ki:
- A `promoteDraft` **saját betű** javítása nem kozmetika: a dialógus részhalmaz-promotálása nélküle
  minden alkalommal átnevezte volna a variánsokat (404a + 404c → a és **b**).
- A `topic` bekerült a szerkesztő `EDITABLE_KEYS`-ébe, de `string | null`-ként felülírva:
  a placed kártya `topic`-ja nem nullable, a drafté igen, és a Brief fül csak a draft-only
  intake-blokkban kínálja.

### 2026-09-10 — a variáns-betű a draft sorozata, nem a mátrixé — 6.77.0

**User:** „duplicate-re egyből C-re ugrott, nem látszik a B variáns, amúgy van már hozzá creative
library item, lehet ez a baj?" — igen, és a szabály volt rossz, nem a library.

Az adat: `MC404` — draft `a` (36016) + **négy élő Agentic sor** (`404a`/`404b` × `ch_disp`/`ch_soc`,
36017–36020), amiket a `ensureAgenticMc` mintázott a feltöltött `ERSTE_MARKET_MC404_a/b_…` fájlokból.
A 6.75.0-s `createDraft` a **teljes élő halmazon** kereste a következő betűt, így a `b`-t foglaltnak
látta és `c`-t adott (36021).

- [x] A betű a **draft sorokon** fut (`live.filter(audience === null && number === n)`), nem az
      összes élő soron. A leszállított MC404b fájlok nem „valami más": pont az, amiért a `b` variáns
      van, és `(number, variant)`-tal találják meg. Draftnak nincs cellája, tehát nem is ütközhet
      placed sorral; az igazi ütközés a promote-nál van, ahol a `promoteDraft` már bumpol.
- [x] A teszt megfordítva (`takes the next DRAFT letter…`), plusz új eset: másik **draft** által
      tartott betű elutasítva.
- [x] `draft-variants__item--ghost` — a máshol létező betűk (matched kreatívok alapján) szaggatottan
      megjelennek a fejlécben, tartalom nélkül. A `matches` map-ből, új lekérdezés nélkül.
- [x] `draft-variants__delete` — a nyitott variáns törlése a `+` mellett, két kattintással; utána a
      szerkesztő a megmaradt betűre ugrik, vagy bezár, ha a szám elfogyott.

**A user 404c sorához nem nyúltam** — az új törlés-gombbal maga akarta eltüntetni, utána a duplicate
már `b`-t ad.

### 2026-09-10 — a scrub kiolvasása az MC címkén — 6.78.0

**User:** „nem kell ide a c jelölés a preview kép fölé, de a működés az jó — úgy tegyük érthetővé
hogy miért vált a kép, hogy mouse overre az MC jelölés végére tegyük oda azt a variánst, amit épp
a mouse over megjelenít."

- [x] `drafts-tile__variants` / `__variant` **megszűnt** — a betűcsík lekerült a képről.
- [x] `drafts-tile__mc` több variáns esetén a végén viszi az aktív betűt (`MC404a` → `MC404b`).
      Egy variánsnál nincs mit váltani, marad `MC404`.
- [x] A `__scrub` zónák maradnak, csak most semmit nem rajzolnak.

### 2026-09-10 — a dashboard strip egy csempét ad egy variánsnak — 6.79.0

**User:** „miért van kétszer itt a legfrissebbek között a 404 a és b — 404 most nem both hanem
agentic, így nem kell a html preview."

**A diagnózis más volt, mint a feltételezés:** nem html preview duplázott. Az MC404 Agentic tükrei
`template = null`-lal ülnek, a strip `mc` ága pedig csak sablonos sort vesz, tehát onnan MC404 nem
is jöhet. Mind a négy csempe **feltöltött fájl** volt: `MC404a` és `MC404b`, egyenként 300×250-ben
ÉS 1080×1080-ban — a strip mindkét elfogadott méretet kirakta.

- [x] Az uploaded ág `distinct on (mc_number, mc_variant)`-ra ment, a 300×250 nyer (az a forma,
      amiben a strip többi csempéje is van). Ez egy **ellentmondást is felold**: az `mc` ág mindig is
      `(number, variant)`-onként egy csempét adott, épp azért, amiért az uploaded ág nem.
- [x] MC-szám nélküli kreatívokat NEM csoportosít — nincs mi szerint; két számozatlan fájl két
      szállítás. Az id tartja őket külön.
- [x] A `sourceCount` ugyanígy számol, különben a „N in this window" és a lapozás elcsúszna.
- [x] Három új teszt (mindkét méret megérkezett · csak a négyzetes van · számozatlanok nem
      csoportosulnak). `npm test` 884/884.

### 2026-09-10 — Production target + tagelt planned topic — 6.80.0

**User:** „a planned topicot tegyük a Target alá (a Targetet nevezzük át production target-re), ha DCO
akkor legyen itt a tag 1-2-3 lehulló egymás után és a Tag 4 free input field, és ha both akkor is,
ha pedig agentic akkor legyen egy üres mező, Topic input field."

- [x] `Target` → **`Production target`**, a planned topic **alá** került.
- [x] `PlannedTopicField` — DCO/Both: tag1–3 legördülő + tag4 szabad szöveg + a összeálló kulcs
      előnézete; Agentic: egy szabad mező.
- [x] A szótár a **ténylegesen használt** értékekből jön (`topics.tag1..tag3`), `NA` elöl. Egy olyan
      érték, amit a draft visz, de a dimenzió már nem (archivált topic), nem tűnik el a saját
      legördülőjéből.
- [x] Az összefűzés a kliens `topicKey` mintáját követi
      (`{{product}}_{{tag1}}_{{tag2}}_{{tag3}}_{{tag4}}`); a mérvadó generátor továbbra is a
      `keyFromPattern`. A komponens `_`-ra fűz és `_`-nál bont, tehát a két fele egymással
      konzisztens; a tag4 megtarthatja a saját aláhúzásait.

**Mellékesen tisztázva (user kérdés):** a dashboard creative-strip **nincs 5-re vágva** — a lusta
vízszintes végtelen görgetés megvan (`CreativeStrip.loadMore`, `nextOffset`, oldalanként 24). Az
„5 in this window" a teljes találat; 7-ről 5-re a 6.79.0-s összevonás vitte (MC404a/b négy csempéje
kettő lett).

### 2026-09-10 — a mentés nem perzisztált a drafts oldalon — 6.81.0

**User:** „ha A és B-t átállítom DCO-ra, elkezdek lépkedni a headerben, előbb-utóbb visszaugrik
Agenticre; oldalfrissítés után jól jelenik meg, pedig kiírta az autosave hogy saved. Általában van
problémám, hogy a megváltoztatott értékek nem perzisztálnak, valami state-ben bent marad."

**Gyökérok — nem a mentés, hanem a cache.** A `MessageEditor` `save.onSuccess`-e a szerver által
visszaadott sort **bepatcheli a lista-cache-be**, hogy a rács azonnal a mentett értéket mutassa —
de csak a `["messages"]` kulcsba (`MessageEditor.tsx:464`). A drafts oldal viszont a saját sorait a
**`["drafts"]`** borítékban tartja. Az a másolat a mentés ELŐTTI értékeken maradt, a szerkesztő
pedig minden sor-váltáskor **abból** veti újra a `draft` state-jét — tehát variánsváltás (vagy a
`‹ ›` léptető) után visszatérve a régi értékek íródtak a frissen mentettek fölé. A „saved" nem
hazudott: a szerver oldalon ott volt, csak a képernyőn nem.

- [x] `save.onSuccess` a `["drafts"]` borítékot is patcheli (a `matches` kulcsot érintetlenül
      átvíve). Minden draft-mezőt érint, nem csak a targetet.
- [x] **A mátrix szerkesztő nem volt érintett:** a rács kulcsa `["messages", { showArchived }]`, amit
      a meglévő prefix-illesztésű `setQueriesData` már lefed — ezt a kód kommentje ki is mondja.
- [x] `planned-topic__row` — a négy tag egy sorban, kulcs-sorrendben.

### 2026-09-10 — a tag4-be gépelés a tag1-be került — 6.81.1

**User:** „nem tudok rendesen gépelni pl. a tag4 mezőbe, mert mindig a mentés miatt elugrik a kurzor."

**Nem a mentés volt, hanem a tegnapi composerem.** A `joinTopic` `filter(Boolean)`-nel dobta az üres
részeket, így `tag4 = "t"` → `MARKET_t`, amit a `splitTopic` **tag1 = "t"**-nek olvasott vissza: a
karakter átugrott az első mezőbe, a kurzor vele. Ráadásul minden leütés a composed stringen keresztül
ment oda-vissza, tehát az input értéke az volt, ami a round-tripet túlélte.

- [x] `joinTopic` **pozíciótartó** (üres slot üres szegmens marad: `MARKET____t`) — pont az, amit a
      tárolt kulcs-minta is előállít ugyanerre a bemenetre. Csak a záró üresek esnek ki.
- [x] A négy rész **saját state**, `composedRef`-fel: a `value` csak akkor seedel újra, ha kívülről
      változott (másik variáns, reload), nem minden leütésnél.
- [x] 7 unit teszt a `tests/unit/planned-topic.test.ts`-ben, benne a konkrét hibás eset.

~~**NYITVA — külön feladat:** 409 a saját mentés ellen~~ → **LEZÁRVA 6.82.1-ben** (a fan-out sorok
elavult `version`-je a kliens-cache-ben volt az ok, l. lent).

### 2026-09-10 — a brief az MC-hez tartozik, nem a variánshoz — 6.82.0

**User:** „a briefnek MC-hez kéne tartoznia és nem variánshoz — nem lehet az, hogy az a és b DCO, a c
meg agentic, és az sem, hogy a variánsoknak más a topicja, tag-je; a brief is mindig ugyanaz. A
mostani b és c brief-füles adatait el lehet dobni, ami az a varianson van, az vonatkozik az egész
draft MC-re."

- [x] `propagateBriefAcrossDraftVariants` az `updateMessage` végén: draft soron az intake
      (`brief`, `briefSlidesFileId`, `briefSlideId`, `topic`, `draftProduct`, `draftTarget`)
      a szám **összes élő draft sorára** kiíródik. A **teljes** intake megy ki, nem csak a
      megváltozott mező — ettől szűnik meg a korábbi eltérés, nem félig.
- [x] Placed kártyát nem érint (`status='DRAFT'` + `audience is null` szűrő), és a variáns-szintű
      tartalom (template/content/styles) érintetlen — 4 új teszt fedi mindkettőt.
- [x] **Miért nem külön MC-tábla:** ezek nem draft-only oszlopok. A `brief_slides_file_id`/`brief`
      a placed kártyákon is él, a mátrix Brief füle ott **kártyánként** szerkeszti, és az MCP
      `list_briefs` ez alapján csoportosít — két külön cellában lévő kártya jogosan vihet más
      briefet. A számra normalizálás attól a felülettől venné el, amelyiknek kell.
- [x] **Live adat rendezve:** `a` variáns intake-je ráírva a többire (MC400 b/c topicja
      `SZA____szamlavalaszto` → `SZA_edukacio_NA_tudatossag_szamlavalaszto`; MC404 már egyezett).
      2 sor módosult, mentés előtte: `scratchpad/draft-intake-backup-20260910.csv` (8 sor).

### 2026-09-10 — a fan-out a képernyőig — 6.82.1

**User:** „ha egy MC minden variánsának ugyanaz a brief füle, akkor hogy lehet a 404a ilyen, a 404b meg
ilyen?" — a **DB-ben nem is tért el**: mindkettő `agentic`, ugyanazzal az `updated_at`-tel. Amit
látott, kizárólag kliens-cache.

**Gyökérok:** a 6.82.0 fan-outja a szám többi draft sorát is írja, de azok **nincsenek benne a PATCH
válaszában**, a kliens pedig csak a visszakapott sort patchelte. A többi variáns így a fan-out előtti
értéket mutatta reloadig — és a cache-elt **`version`-jük is ott maradt**, tehát a következő
szerkesztés rajtuk elavult `If-Match`-csel ment ki. **Innen jött a „saját munkámba akadok" 409 is.**

- [x] `src/lib/draft-intake.ts` — a mezőlista egy helyen, szerver és kliens is ezt nevezi meg
      (a kliens nem húzhatja be az entity modult a db-vel együtt).
- [x] `save.onSuccess`: ha a mentett sor draft ÉS a payload intake-mezőt érint → `["drafts"]`
      invalidate. A payloadra van kapuzva, hogy a sima gépelés ne indítson újratöltést.
- [x] Lokális build kihagyva az új szabály szerint; `tsc` + `eslint` tiszta, `npm test` 895/895.

### 2026-09-10 — apróság-kör: pill-kiírás + Custom-CSS chipek — 6.83.0

**User-döntések a NEXT/UI-apróságokról (M1, M7, M8, W3.g, W3.h):** „a color by strategy nem kell és
legend se kell a pixel magassághoz, M7 kell egyértelmű, M8-ból ami megvalósult jobb, W3.g nem kell,
W3.h most túl nagy" + **M12.1 most**: „ha max 2 van kijelölve, a szám helyett írja ki, mi van
kijelölve; a szám csak 3-nál többnél".

- [x] **M12.1** `MultiPill.describeSelection()` — 1–2 kijelölés = értékek, 3+ = szám. Alapviselkedés
      minden pillen, nem prop. Opció-lista sorrend (nem klikk-sorrend). 6 unit teszt.
- [x] **M7 teljes** (3 commit): `elementIds` + `elementClasses` a `TemplateInfo`-ba → `SelectorChips`
      a Styles fülön → a Classes sor a valós szókincs. Részletek a NEXT M7 szekciójában.
- [x] `MessageEditor`: a draft sablonjának keresése **egy** helyen (`currentTemplate`), nem harmadszor
      másolva — a Content-méretek, a chipek és a preview ugyanazt kérdezik.
- [x] M1 / M8 / W3.g kivezetve a roadmapről indoklással; W3.h átkeretezve saját, felméréssel induló
      szeletté.

**⚠️ Incidens — élő MC-n teszteltem, autosave-vel:** a chip-beszúrást az MC94a-n (`messages.id=31590`)
próbáltam ki; a takarításhoz használt `shift+Home` macOS textareában a **dokumentum elejéig** jelöl ki,
így a Backspace az egész `custom_css` mezőt törölte, az autosave pedig elmentette (`audit_log` 16349,
`after=null`). A visszagépelés karaktereket ejtett (`.sie-300x250`), ezért az `audit_log` 16346-os sor
`before` mezőjéből írtam vissza byte-pontosan (`EXACT MATCH` ellenőrizve). A `version` 5→7, az
`updated_at` 20:56 — tartalmilag ép. **Tanulság a fájlba: UI-t DRAFT-on kell próbálni, nem élő
kártyán** (a második kör már az MC402a drafton ment, azt is visszaürítettem).

### 2026-09-11 — szallashu demo tenant: megvalósíthatósági tanulmány (DÖNTÉSRE VÁR)
- Tanulmány: `docs/SZALLASHU_DEMO_STUDY.md`. Meta Ad Library (~32 aktív hirdetés) + 2 Gemius display-kreatív alapján; box + DB + kód ellenőrizve.
- Verdikt: Standard scope ~18–32 gépi óra + 4–7 user-óra, 3–5 munkanap. Kritikus út: `templates/szallashu` review-kör. Meta/Google feed nincs (W4 blokkolt) — csak roadmapként.
- Nyitott: a tanulmány §7 hét döntése (scope, hostname/DNS, topológia A/B, termékek, képforrás, logó, Meta-üzenet). Kód nem változott.

### 2026-09-12 — Ikonkészlet-tanulmány: lucide → kapcsolható Streamline Core (DÖNTVE, feladattá alakítandó)
- Tanulmány: `docs/ICON_SET_STUDY.md`. Kód-leltár (87 lucide ikon / 66 fájl / 1 custom `GoogleDriveIcon`) + Streamline Core free 8 stílus (Iconify `streamline` = Line+Solid+Remix, Pop csak GitHub) + 87 soros név-megfeleltetés, kirenderelve ellenőrizve.
- Verdikt: 51 ✅ / 24 🟡 / 12 ❌ — a Core free-ben **nincs chevron, spinner, grip, rács**; ezek 9 saját 14-grid path-tal pótolhatók vagy Pro Core Line ($19/hó/seat). Kapcsolhatósághoz szemantikus ikon-regiszter (`src/app/_icons/`) + build-time generált családok kellenek; a 66 fájl egyesével áll át (~2–3 nap). Pop nem `currentColor` (fix 5 szín), dark módban CSS-var csere kell.
- Döntve (user, ugyanaznap): tenantenkénti kapcsoló a Settings → Design tabon (`lookAndFeel.iconSet`), lucide+custom a default, a Core csak a lefedett 75 ikont cseréli (12 ❌ lucide marad), Core free, Pop bekerül, lucide 1.45-re. Lépések a tanulmány §5.7-ben — agent-feladattá alakítandó. Kód nem változott.

### 2026-09-12 — MCP `draft` token-scope — 6.84.0

**User:** „ok gyerünk" / „mehet" — a 6.73–6.83 draft-modell azért épült, hogy legyen egy tér, ahol az
agent hibája nem ér el élő kártyát; ez a szelet adja hozzá a kulcsot.

- [x] S1–S7 a NEXT szekció szerint. **Séma-migráció nincs**, a deploy sima build + restart.
- [x] `npm test` **911/911** (95 fájl), `tsc` + `eslint` tiszta (0 error). Lokális build kihagyva.
- [x] Böngészőben **nem** néztem meg a Settings › MCP fület (belépést igényel) — az új select-opció,
      az amber badge és a próza vizuális ellenőrzése a useré.

**Két dolog, ami menet közben derült ki:**
- Az `asset_upload` **nem tisztán additív**: `replace_existing=true` esetén a newest-first
  fájlnév-feloldás miatt egy **élő kártya** képét cseréli le. A terv „additív, mehet a draft
  scope-ba" indoklása eddig hiányos volt — ezért kapott saját őrt, nem csak a brief_attach.
- A `draft_promote` kiemelése külön regisztrációs függvénybe kellett, mert a `registerDraftWriteTools`
  egyben tartotta a négy draft-írót; így a scope-határ a kódban is látszik, nem egy `if`-ben bújik el.

**Nyitva:** az ismeretlen `scope` érték `full`-ra szélesedése (l. a NEXT szekció figyelmeztetését).

### 2026-09-12 — `draft_update`: az agent iterálni is tud — 6.85.0

A 6.84.0 `draft` scope-ja után ez a párja: az agent eddig **létrehozni** és **archiválni** tudott
draftot, **szerkeszteni** nem — az `mc_update` pmmid-del címez, a draftnak meg nincs pmmid-je.

- [x] `updateTestCreative` (`entities/drafts.ts`): csak a **jelen lévő** mezőket írja, üres string
      **töröl**, opcionális `expectedVersion`. Nem draft / archivált / sablon nélküli sorra nem megy.
- [x] `draft_update` MCP tool ugyanazzal a szókinccsel, mint a `generate_test_creative`;
      `render` (default true) fire-and-forget újrarajzolás, `sizes` szűkíthet.
- [x] **A validáció kiemelve** (`collectContentProblems`) — a create és az update *ugyanazokkal* a
      szabályokkal ítél. Fontos részlet: a patch a draftot **a végállapotában** validálja, nem
      önmagában; különben egy tag-eket nem érintő szerkesztés üres stringre bukna el.
- [x] **A `background_images` egész érték:** ha megadod, mind a négy slotot felülírja (amit nem ér el,
      az törlődik). Részleges tömb némán meghagyná a régi slotokat — ez volt a csapda.
- [x] **A template NEM cserélhető** itt: az dönti el, mely méretek és tag-tokenek érvényesek, és a
      meglévő preview-sorok árván maradnának. A tool leírása kimondja. ⚠️ **Ára:** rossz sablonnal
      indított draftnál a szám elég (az archive megtartja) — ha ez zavaró lesz, külön szelet.
- [x] 8 új teszt (patch · üres string töröl · végállapot-validáció · hiányzó képfájl · 4 slot ·
      render lista + `render=false` · version_conflict · promotált kártyát elutasít). **919/919.**

**Nem teszteltem:** hogy a `render=false` tényleg nem indít chromiumot — a shooter mockolva van, és a
fire-and-forget promise-t determinisztikusan bevárni nem tudom. A visszaadott `rendering: []`
szerződést ellenőrzöm helyette; magát a `startDraftRender`-t a create-ág már fedi.

**Séma-migráció nincs.** Deploy: build + `pm2 restart` (a 6.84.0-val együtt).
