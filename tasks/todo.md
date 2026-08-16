# MessagingMatrix v6 — active roadmap + checkpoint

**Ez a lean, aktív fájl.** A teljes történelem (Phase 0–10 logok, összes deploy- és session-checkpoint 2026-04 → 2026-07) szó szerint megvan itt: **`tasks/todo-archive.md`** (~4000 sor). Ott semmit nem törlünk — ez a hosszútávú emlékezet.

**Munkamenet:**
- Új session-checkpoint ennek a fájlnak az **aljára** kerül (append), nem az archívba.
- Ha az aktív rész kezd hízni a lezárt checkpointoktól, a régieket **átgörgetjük az archívba** (append oda), és itt hagyunk egy egysoros mutatót.
- Részletekért (file:line horgonyok, eredeti tervek, review-k) → `todo-archive.md`, szekció-cím vagy hozzávetőleges sor szerint hivatkozva.

**Kapcsolódó dokumentumok:**
- `docs/REBUILD_SPEC.md` — v6 design spec + multi-tenancy delta D1–D11.
- `tasks/component-inventory.md` — használatban lévő szemantikus class-nevek (új blokk-név előtt nézd meg).
- Master plan: `~/.claude/plans/you-ll-see-docs-and-snappy-charm.md`.

---

## Jelen állapot (2026-07-21)

- **Verzió: `6.9.0`**, **live** a Hetzner boxon (`erste.messagingmatrix.ai`, pm2 `mm6-erste`).
- Phase 0–10 szállítva. SQLite→Postgres migráció kész (közös Supabase a boxon, dev a `:5433` tunnelen éri). MinIO object store él (`:9000` tunnel). MCP server per-client bearerrel, **39 tool**.
- **Wave 0** ✅ teljesen zárva (W0.1 status-color single source + W0.2 filter-swatch — 6.9.0). **Wave 1** ✅ zárva (W1.2/1.3/1.4 edit-mode add/duplicate — 6.9.0; W1.1/1.5/1.6 smoke-ök obsolete). **Wave 3** nagyrészt szállítva (monitoring ingest end-to-end live).

**Prioritás-tierek lentebb:** 🟢 NOW = indulásra kész · 🟡 NEXT = green-light után · 🔵 LATER = push-back-first / blokkolt. Minden item commit-méretű; a wave/slice megnevezésével kell zöld-light indulás előtt. Minden tételnél "Fő lépések" + reuse-horgonyok (file:line a dráftelés napján igaz). A ⚠️ OPEN Q-k defaultja a fájl alján (**Nyitott döntések**).

---

## 🟢 NOW — indulásra kész (nincs blokkoló külső input)

### Text-formatting rule: exact-match érvényesítés (render ↔ editor aszimmetria fix)
Gyökér-ok (2026-08-15, MC301b nyomozás): a `render.ts:137-145` a rule-okat **substring-cserével** alkalmazza a teljes HTML-en, míg az editor (`MessageEditor.tsx:1199`) csak **pontos mező-egyezésnél** mutatja őket → láthatatlan szabály érvényesül (pl. a 176-os rule "Most Személyi Kölcsön" → `<br>`-ek belelógnak a hosszabb "…adósság-rendezéshez" copyba). A `feed-spans.ts:32` már most is exact-match — csak a render a bűnös. Hatásfelmérés prod DB-n: 122 aktív rule, mindegyik vagy exact-egyezik valamelyik üzenet-mezővel (működik tovább), vagy teljesen árva (már ma is halott) — **egyik sem támaszkodik szándékosan substring-matchre.**
- [x] **TF.1** `render.ts`: a formatting a placeholder-feloldáskor megy — feloldott érték után rule-keresés `textOriginal === value` + `matchesScope`; size-scoped rule előnyben az univerzálissal szemben (`applyFormatting`, a `feed-spans.ts` `pickVariantForSize` tükre); a teljes-HTML substring-pass törölve; fejléc-komment frissítve.
- [x] **TF.2** Tesztek: a 3 meglévő formatting-teszt átírva exact-match-re + regression (rövidebb rule NEM módosítja a hosszabb szöveget, az MC301b-eset) + size-scoped-vs-universal preferencia teszt. Suite: 556/556 zöld, `tsc` tiszta.
- [x] **TF.3** CHANGELOG (Unreleased/Changed) + bump-javaslat kiadva (minor).
- **Review:** egyetlen érdemi fájl változott (`render.ts`); a formatting mostantól CSAK olyan szövegre hat, ami az editorban is látszik a mező alatt — a render↔editor↔feed-export hármas azonos predikátummal dolgozik. Prod-hatás: a 9 árva rule halott marad, a többi 113 változatlanul él; az átvérzések (pl. 175/176 → hosszabb copyk) megszűnnek.

### DCO/nonDCO mátrix epic — statikus kreatívok first-class MC-ként (AKTÍV)
Cél: a statikus kép-kreatívok is MC-identitást kapjanak (MCP-hivatkozhatóság ingyen), mátrix header DCO/nonDCO toggle-lel; nonDCO oszlop = prodlist channel (6: DISP/SOC/PRG/GSN/GNW/YT), sor = auto-topic a kreatív nevéből. Terv: `~/.claude/plans/van-az-a-feladatd-encapsulated-meadow.md`. Lockolt: nonDCO MC = `messages` sor `template=null`+`image1`; nincs új MC-tábla; FR-A prodlist-ingest épül (deliverable-grain v1).
- [x] **Slice 0 — FR-A prodlist ingest:** `prodlist_rows` tábla (`0004_lumpy_blockbuster.sql`, deliverable-grain, unique `(clientId, deliverableId)`) + `entities/prodlist.ts` (list/get/upsert-batch/update + `listDistinctChannels`) + MCP `list_prodlist` (read) + `prodlist_upsert` (write, `bulk_upsert` audit) + McpTab "Prodlist" group. Teszt: `mcp-prodlist.test.ts` (5, zöld). `scripts/import-prodlist.ts` Slice 4-re halasztva (ingest addig MCP-n). ⏳ **Box deploy hátravan** (migr.+kód egy passzban).
- [x] **Slice 1 — Channel audiences + scoping:** `audiences.channel` oszlop (`0005_brief_pete_wisdom.sql`, nullable, `client_channel_idx`); `Audience` type (matrix + matrix/types) + `WRITABLE_FIELDS` + `createAudience`/`duplicateAudience` `channel`-átvezetés; `scripts/seed-channel-audiences.ts` (6 channel, idempotens). Teszt: `audiences.test.ts` +4 channel-eset. ⏳ **Box: migr.+seed hátravan.**
- [x] **Slice 2 — DCO/nonDCO toggle + szűrő:** `Filters.axis` + `MatrixAxis` (`types.ts`) + persist `mm6_matrix_state_v1` (`MatrixGrid` hydrate+payload); `matrix-axis-toggle` segmented control (`MatrixToolbar.tsx`, inventoryba felvéve); axis-partíció a `filtered` useMemóban (`channel==null` DCO vs `!=null` nonDCO) + axis-scoped audience-count; Clear megőrzi az axist. Nincs séma. `tsc` + 508/508 zöld.
- [x] **Slice 3 — Kép-cella preview template-null MC-hez:** `MatrixIframePreview` új `StaticImagePreview` ág (`template==null && image1` → `/api/drive/proxy/`, `thumb-checker` shell); `PreviewPane` új `staticImage` prop (prioritásos ág, `PreviewIframe` nem kell méret); `MessageEditor.refresh()` skip `/api/render` ha template null + image1. `matrix-static-preview` + `preview-pane__static-*` inventoryba. `tsc` tiszta.
- [x] **Slice 4 — Creative→message promóció:** `entities/promote.ts` (`autoTopicFromFilename` + `promoteCreative` egy tranzakcióban: find-or-create topic → `createMessage` template nélkül → `updateCreative` visszalink `mcNumber/mcVariant`); MCP `creative_promote` (creative_id VAGY file_name; explicit channel VAGY prodlist-familyKey-match; auto-topic VAGY override; already-matrixed refuse). Tesztek: `auto-topic.test.ts` (5) + `mcp-promote.test.ts` (6), zöld. UI "Matrixize" gomb: **halasztva** (agent-only elég v1-re).

### Agentic test-creative gyártás MCP-n — `generate_test_creative` + draft pipeline (KÓD-KOMPLETT 2026-08-13)
Cél: agent mintát kérdez (mc_get / list_assets / get_media_file — mind létezett), külső eszközzel szöveget+képet generál, képet `asset_upload`-dal feltölti, majd `generate_test_creative` a mátrixon KÍVÜL draftol (`draft_messages`), méretenként async PNG-t renderel (közös Playwright-mutex), progress `draft_status` pollinggal (% + elapsed). Terv: `~/.claude/plans/k-ne-nekem-egy-j-functional-raven.md`.
- [x] **Slice 0** — `draft_messages` + `draft_previews` táblák (`0006_harsh_guardian.sql`) + tábla-teszt (5).
- [x] **Slice 1** — `preview-shooter.ts` generalizálás (`shootItems` persist-callbackkel, `shootPreviews` szignatúra változatlan) + `entities/drafts.ts` (create/render/status/list/get/delete/promote) + 16 teszt.
- [x] **Slice 2** — publikus `/api/draft-previews/[id]` + MCP `generate_test_creative` (async, azonnali draft_id) + `draft_status` (percent/elapsed/stalled) + 3 route-teszt.
- [x] **Slice 3** — MCP `list_drafts`/`draft_get` (read) + `draft_delete`/`draft_promote` (full) + `show_draft_previews` widget (MC-widget reuse) + 8 MCP-teszt.
- [x] **Slice 4** — `/drafts` oldal (masonry + render-progress polling + promote/delete dialog) + session route-ok (`/api/drafts*`) + Sidebar + component-inventory.
- [x] **Slice 5** — McpTab "Drafts" group + prose, CHANGELOG, bump **6.12.0**.
- [x] **Box deploy 2026-08-13:** migráció `0006` + kód egy passzban, élesben verifikálva (táblák + route-ok élnek).
- Halasztva (valós igényre): draft-edit tool (most: újragenerálás), TTL-cleanup, idempotency-kulcs a generate-hez.

### Scripts: unawaited `getActiveClient()` sweep (PG-cutover maradvány)
A `getActiveClient()` a SQLite→PG váltáskor lett async; a route-okat akkor javították, a `scripts/`-et nem (a tsconfig nem fedi, `tsc` nem fogja). A `seed-channel-audiences.ts` élesben elhasalt (`UNDEFINED_VALUE`, params:[undefined]) — 2026-08-13-án javítva. **9 további script ugyanígy törött:** scan-creatives, import-erste-sample, link-creative-files, reimport-media, import-erste, seed-multi, seed-perf, seed-keywords, seed-dev. Háromnál a befogadó `main()` nem is async → scriptenként kell (async-esítés + hívás). Előbb döntsd el, melyik retire-elhető (import-erste* / seed-dev SQLite-éra); a maradékra egyenkénti fix + kézi futtatás-teszt.
- [ ] Retire-vs-fix döntés scriptenként, aztán a maradék javítása egyesével.

### M9 — MC archiválás UI-ból (legkisebb; backend teljesen kész)
Cél: MC-t archiválni/visszaállítani lehessen az appból (ma csak MCP/HTTP). A DELETE-hívás + ARCHIVED status már megvan (`MessageEditor.tsx:1275`), csak a dedikált gomb hiányzik.
- [ ] **M9.1** Archive/Restore control a `MessageEditor` header action-clusterébe (`:544-624`), a `MediaEntityDialog:319,408-428` mintát másolva. Archive → `DELETE /api/messages/[id]` `If-Match: version`; Restore → `POST /api/messages/[id]/restore`; `parent_archived` 409 tiszta üzenettel; `["messages",{showArchived}]` invalidáció + dialog-zárás.
- [ ] **M9.2** (opcionális) chip-context akció `GridView.tsx`-ben editor-nyitás nélkül.
- [ ] **M9.3** (szomszédos, külön commit) audience/topic Archive-akció a `DimensionEditPanel`-be — a restore route-ok + editor-szintű showArchived már élnek, csak a panel kínál ma kizárólag hard-delete-et.

### M3 — Üres-vs-tele cella szín-különbség megszüntetése (triviális)
Cél: egységes cella-háttér, hogy a color-by (M1) tiszta alapon üljön.
- [ ] **M3.1** `GridView.tsx:456-458` (PlainCell) + `:524-526` (EditableCell): egy bg mindkét ágra (a `matrix-grid__cell--has-messages` class maradhat egyéb hookként). Az edit-mode drop-target ring maradjon (`:527-532`).

### M2 — "Hide inactive" checkbox (audience + topic sor/oszlop)
Cél: INACTIVE audience/topic sorok/oszlopok elrejtése (MC-t soha).
- [ ] **M2.1** `Hide inactive` checkbox a `MatrixToolbar`-ba (count block mellé, `:76`); persist `mm6_matrix_hide_inactive`.
- [ ] **M2.2** Kliens-szűrő a `filtered` useMemóba (`MatrixGrid.tsx:596-634`): dobd az `status==="INACTIVE"` audience/topic sorokat/oszlopokat; MC-t nem érint; archive-logikát nem érint.

### W2.6 + W2.7 — Unmatrixed filter pill + badge (Creative Library)
Cél: uploaded creative-ek MC-link nélkül láthatóak/szűrhetőek legyenek. (A link-mezők + a `CreativeDetailDialog` szerkesztés már él — csak a szűrő/badge hiányzik.)
- [ ] **W2.6** `All | Matrixed | Unmatrixed` pill a `CreativeLibrary` toolbarba (`:821-823` mellé), meglévő toolbar-pill stílus. Logika: `kind==='uploaded' && (mcNumber==null || mcVariant==null)`; persist `mm6_creative_library_match_filter`; `(N)` count.
- [ ] **W2.7** `status-badge--unmatrixed` sarok-badge a tile-on (látszik "All"-ban is).

---

## 🟡 NEXT — green-light után, alacsony blokk

### M1 — Matrix "Color by" (Strategy | Platform | Both)
Cél: audience-oszlopok színezése strategy/platform szerint, legenddel.
- [ ] **M1.1** `Color by: None|Strategy|Platform|Both` dropdown a `MatrixToolbar`-ba; persist `mm6_matrix_color_by`.
- [ ] **M1.2** Determinisztikus value→color map a látható audience-ök distinct `strategy`/`buyingPlatform` értékeiből (sorted distinct → paletta-index). Szín-token reuse (ne hardcode `bg-*`; STATUS_COLOR mintája = `status-dot--*` CSS-var class).
- [ ] **M1.3** Szín **band az audience oszlop-fejlécen** (nem a cellán); `Both` = két vékony sáv; kis legend. ⚠️ OPEN Q: `Both` vizuál + header-only.

### M4 — Crosshair highlight (sor+oszlop) hover + click-pin
- [ ] **M4.1** `hoveredCell {row,col}` state a `GridView`-ban; `onMouseEnter` → teljes sor+oszlop halvány kiemelés (fejlécekkel), layout-shift nélkül. (Ma nincs crosshair-state — net-új.)
- [ ] **M4.2** Click-to-pin: kattintásra pinnel escape/újraklikkig; a chip-open klikket nem nyeli el. ⚠️ OPEN Q: pin+hover mindkettő.

### M5 — Detail-view audience header: strategy tag + lineitem_id
- [ ] **M5.1** `MessageEditor` header (`:499-625`): `strategy` pill + `lineitemId` (ha van) az MC-label mellé; a ma Naming-tabon rejtett infó (`audienceRows` `:946,:950`) felhozva; status-badge stílus reuse.

### M6 — Detail-view: teljes key helyett product + tag pillék
- [ ] **M6.1** `NamingTab` disabled full-key inputjai (`:914-931`) helyett dekompozíció a betöltött rekordból (nincs key-parser). Topic: `product`+`tag1..4` (üres elhagyva). Audience: `product`+`strategy`+`buyingPlatform`+`device`+`tag`. ⚠️ OPEN Q: audience-mezőkészlet.

### M7 — Custom-CSS beszúró chipek az MC-editorban
- [ ] **M7.1** Két chip-sor a `customCss` textarea alá (`:1725-1731`); beszúrás cursor-pozícióba (ref + selectionStart/End splice).
- [ ] **M7.2** Méret-chipek: `TemplateInfo.sizes[]` (`:688-693`) → `.size-<W>x<H>`.
- [ ] **M7.3** Elem-ID chipek: parse-olt `id="..."` → `#<id>`.
- [ ] **M7.4** Plumbing: `elementIds: string[]` a `TemplateInfo`-ba `index.html` parse-olásával a `listVisibleTemplates`-ben (`lib/templates.ts`), a `sizes[]`-szel azonos cache-úton. (Ma nincs API-n kivezetve.)

### M8 — Creative Library size filter csoportosított dropdown
- [ ] **M8.1** `MultiPill` bővítése opcionális `groups` proppal (statikus kategória→méret map: Display / Social / Other; ismeretlen → Other). (Ma `MultiPill` flat only.)
- [ ] **M8.2** Csoport-fejléc tri-state checkbox (all/none/some); egyedi checkboxok maradnak; üres csoport rejtve. Persist `mm6_creative_library_filter_sizes` marad.

### Wave 2 maradék — guided picker + auto-match + bulk
Cél: a creative↔cella match a nyers mezőkön túl guided + tömeges legyen.
- [ ] **W2.2** `CreativeDetailDialog`: audience+topic dropdown, ami az MC number/variant pickert az adott metszet létező üzeneteire szűri (ma nyers DraftField `:182-186`).
- [ ] **W2.3** `POST /api/creatives` filenév-heurisztika `mc(\d+)([a-z])` → "Suggested match — confirm" (nem csendes commit).
- [ ] **W2.4** Toolbar "Bulk match by filename": regex a `mcNumber IS NULL` uploaded-ökre → confirm-table → batch `PATCH`; `FeedExportDialog` diff-stats mintát reusál. ⚠️ OPEN Q: W2.5 soft-link marad.

### Wave 3 maradék — cell-badge + unmatched-link + legacy-retire
- [ ] **W3.g** Matrix cella stat-badge: linkelt monitoring-sorral rendelkező MC-cellán kis impr/CTR badge (`GridView.tsx`); adat-wiring a lényeg, styling follow-up.
- [ ] **W3.h** Unmatched sor → message manuális link `MonitoringTable`-ben (ma csak match-filter `:369`, nincs kézi hozzárendelés).
- [ ] **Legacy `reporting` retire (LAST):** a 2 lingering olvasó (`mcp.ts:350` monitoring_status→adformStatus, `:977` matrix_status→syncedAt) átkötése `monitoring`-ra → tábla drop-migráció → import/export-xlsx + snapshot refek takarítása.
- Deferred: **Meta parser/resolver** — blokkolva valós Meta export sample-ig.

### MCP agent-trap fixek (2026-07-22, ✅ kész)
Kiváltó: egy agent nem tudott júniusi MC-rangsort csinálni. Két gyökér-ok, javítva `mcp.ts`-ben:
- [x] **Fix 1 — ISO `from` a riport-toolokban:** a `monitoring.period_from` `"DD/MM/YYYY 00:00:00"` szövegként tárolt; az agent ISO `"2026-06-01"`-et küld → exact `eq()` néma üres. Új közös `resolvePeriodFrom`/`periodDateKey` helper dátum-normalizál (DD/MM/YYYY ↔ ISO). `report_performance` + `get_mc_reporting` fogad ISO `from`-ot; ismeretlen `from` → hiba az elérhető period-listával (nem néma []). Teszt: mindkét tool-nál bare-ISO + unknown-from eset.
- [x] **Fix 2 — halott `monitoring_status` szűrő eltávolítva `list_mc`-ből:** az üres `reporting.adform_status`-t kérdezte → mindig []; a `monitoring`-ban nincs status oszlop, nem repointolható. Param + kód + description-mention törölve. (A `reporting` import + `matrix_status` olvasó marad — nagy legacy-retire, `:88`.)
- Verifikáció: `tsc --noEmit` clean, teljes integration suite 265/265 zöld (eldobható docker PG-n futtatva).

---

## 🔵 LATER — push-back-first / blokkolt

**Séma-migráció szabály (memory):** új oszlop/tábla `db:generate` → `0004_*.sql` (jelenleg legmagasabb `0003_lovely_sumo.sql`), és a **migráció + kód-deploy egy passzban** megy a boxon (migrate + `pm2 restart mm6-erste`), soha nem lokál `db:migrate` önmagában.

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

## 📌 Deferred / pinned (nincs változás)
- Phase 11 file-ingest pipeline (Forklift/Drive → `_inbox/` + MCP error-triage toolok, post-launch).
- Sankey alt-graph a Tree view-hoz (valós igényre).
- HTML creative auto-preview image link (use-case-ek scope-olása előbb).

---

## Nyitott döntések — AJÁNLOTT DEFAULTOK (user bólint / felülír)

1. **M1 `Both` vizuál** → *default:* két vékony egymásra-rakott sáv (strategy fent, platform lent) az oszlop-fejlécen, kis legenddel. Színezés **csak a fejlécen**, nem a cellákon.
2. **M4 pin + hover** → *default:* mindkettő — hover ideiglenes crosshair, kattintás pinnel escape/újraklikkig.
3. **M6 audience-dekompozíció** → *default:* topic = `product`+`tag1..4`; audience = `product`+`strategy`+`buyingPlatform`+`device`+`tag` (az audience-nek egy `tag`-je, nem tag1-4).
4. **W2.5 soft-link vs join-tábla** → *default:* marad a soft `(mcNumber, mcVariant)` link; join-tábla csak valós many-to-many workflow igényére.
5. **FR-A/B/C tábla vs view** → *default:* FR-C = strukturált `todo.md` szekció előbb (nincs új tábla); FR-A/B = új tábla nullable soft-linkkel a messages-hez + MCP write-tool — de csak a 3-kérdéses push-back után.
6. **M9 szomszédos gap** → *default:* audience/topic Archive-akció a `DimensionEditPanel`-be (restore route-ok élnek); külön kis commit (M9.3), nem M9.1 blokkolója.

---

## Session checkpointok (legutóbbi felül; régiek → archív)

### 2026-08-16 — DEPLOYOLVA 6.14.0 (text-formatting exact-match)
- Bump `6.13.1`→`6.14.0`, commit `465ff9c`, push, box deploy: `/var/www/mm6-erste` pull → build → `pm2 restart mm6-erste` (Ready 1534ms; séma-migráció nincs). Health: `/` 307, `/mcp` 401, boxon a `465ff9c` + 6.14.0 verifikálva.
- User teendő (prod smoke): MC301b preview 300x250 — a Copy 1 törés nélkül, egyben ("Most Személyi Kölcsön adósság-rendezéshez"); egy pontos-egyezéses rule-os MC-n (pl. ahol a copy tényleg "Most Személyi Kölcsön") a `<br>`-ek továbbra is élnek.

### 2026-08-15 — Text-formatting exact-match fix (render.ts)
- MC301b-nyomozás: a 176-os rule ("Most Személyi Kölcsön" → `<br>`-ek) substringként belelógott a hosszabb copyba, miközben az editor nem mutatta (az csak teljes mező-egyezésnél listáz). Fix: a rule-alkalmazás a `render.ts`-ben placeholder-feloldáskor, `textOriginal === érték` teljes egyezéssel + scope-match; size-scoped > universal (feed-spans precedencia-tükör); a teljes-HTML substring-pass törölve. Prod DB hatásfelmérés: 122 aktív rule-ból 0 támaszkodott szándékosan substringre. Tesztek: 3 átírva + 2 új, 556/556 zöld. Részletek: NOW § "Text-formatting rule: exact-match".

### 2026-08-14 — Global edit: status + flight-dátumok szám-szintű propagálása
- Bug-bejelentés "status mindig local" → éles audit-logból verifikálva: az azonos (szám,variáns) audience-propagálás MŰKÖDÖTT (MC124/126 same-second sibling-auditok); a valódi rés: a global edit nem lépett át variánsok között, a user pedig a MC331 a/b/c-t kézzel állítgatta. User-döntés: **status + startDate/endDate szám-szintű** (a szám ÖSSZES variánsának összes élő sora), creative-mezők maradnak variáns-szintűek.
- Implementáció: `messages.ts` `PROPAGATED_FIELDS` → `CARD_FIELDS` + `NUMBER_LEVEL_FIELDS` két tier; `propagateToSiblings` a teljes szám-családot kérdezi, same-variant sor kap creative+number payloadot (trafficking-recompute-tal), other-variant sor csak status/dátumot (trafficking szándékosan érintetlen). Editor tooltipek frissítve. Teszt: +3 eset (`propagate-siblings.test.ts`), 554/554 zöld.

### 2026-08-14 — Audience-fejléc strategy/platform él (GridView + globals.css)
- Audience fejléceken bottom-border: vastagság = stratégia (`pro` 3px / `rem` 5px), szín = platform (`dv360` zöld #43970b / `adform` teal #03c9ab). Élő adatból verifikált értékkészlet; mindkét mező kell (a 13 channel-audience érintetlen). Mindkét orientációban (audience sor- és oszlop-fejléc). A 4 osztály a globals.css végén rétegen kívül ül, hogy a border utility-ket felülírja. Az M1 "Color by" ennek a felülete lehet később — ez a mindig-bekapcsolt v0.

### 2026-08-14 — Inactive audience/topic fejléc-jelölés a mátrixban (GridView.tsx)
- INACTIVE státuszú audience/topic oszlop- és sor-fejléc szövege halványszürke, dense függőleges labelre is; háttér/viselkedés változatlan. Új inventory-tokenek: `matrix-grid__{col,row}-header-label--inactive`. Follow-up user-kérésre: új **`--text-disabled`** design-token (light `#cccccc` / dark `#4d4d4d`, tailwind `text-text-disabled`) — a tertiary túl sötét volt. (Az M2 "Hide inactive" checkbox továbbra is nyitott, ez csak a vizuális jelölés.)

### 2026-08-14 — MC-editor autosave ön-konfliktus javítva (MessageEditor.tsx)
- Tünet: lassú gépelésnél (style / képnév mező) autosave közben "Someone else saved changes…" — a szerkesztő saját magával ütközött. Gyökér-ok, két úton: **(A)** nincs in-flight guard → 400 ms-nál hosszabb PATCH-körbeérésnél két átfedő mentés ugyanazzal az `If-Match`-csel → a második 409; pont a style/képnév mezők lassítják a PATCH-et (render-POST minden draft-változásra + karakterenkénti `/api/drive/proxy` GET-ek foglalják a kapcsolat-sort). **(B)** a saját SSE-visszhang refetch-e régebbi verziójú sort hozhat vissza a frissebb cache fölé → a Phase-B szigorú `!==` konfliktusnak látta.
- Fix (csak MessageEditor.tsx, nincs API/séma változás): mentések sorosítása (`saveInFlightRef` + `onMutate/onSettled`, a debounce-timer in-flight alatt nem mutál, settle után a friss snapshot ellen újraütemez; `manualSave` dupla-klikk guard); Phase-B `===` → `<=` (a régebbi echo-sor ignorálva, csak valóban ÚJABB verzió = peer edit); 7 stale-closure `setDraft({...draft})` → funkcionális forma (`SetDraft` típus, 5 tab). NEM user-tracking — a valódi két-tabos ütközés detektálása változatlan.
- Teszt: 551/551 zöld, `tsc` tiszta. Kézi smoke (user): lassú gépelés style mezőben autosave-vel, global edit móddal is.

### 2026-08-13 — DEPLOYOLVA: DCO/nonDCO (6.11.0) + agentic drafts (6.12.0), két passzban
- Committer-identity javítva (`beliczki.robert@gmail.com`, 3 commit reset-author). A két epic szétválasztva: PR #3 (DCO, `86249de`) merge → **1. passz**: box `06d8cc4`→`5b5da30`, build, `db:migrate` (0004+0005), `seed-channel-audiences` (6 audience: ch_disp…ch_yt, id 462–467), pm2 restart — `/` 307, `/mcp` 401. PR #5 (agentic, a base-törléskor auto-záródott #4 pótlása) merge → **2. passz**: box → `3ca2f5c`, build, `db:migrate` (0006), pm2 restart — `draft_messages`+`draft_previews` élesben ellenőrizve, `/api/draft-previews` route él.
- **Élesben talált+javított bug:** a seed script unawaited `getActiveClient()`-je (PG-cutover maradvány, `UNDEFINED_VALUE`) — fix `3ca2f5c`; 9 további script ugyanígy törött → új NOW-pont (retire-vs-fix scriptenként).
- User teendő (prod smoke): mátrix DCO/nonDCO toggle + nonDCO oszlopok; MCP-agentből `generate_test_creative` → `draft_status` polling → `/drafts` oldal.

### 2026-08-13 — Agentic test-creative epic (Slice 0–5) kód-komplett
- `generate_test_creative` MCP workflow end-to-end: `draft_messages`+`draft_previews` (`0006`), shooter-generalizálás (`shootItems`, közös mutex), 7 új MCP tool (read: list_drafts/draft_get/draft_status/show_draft_previews · full: generate_test_creative/draft_delete/draft_promote), publikus `/api/draft-previews/[id]`, `/drafts` oldal promote/delete-tel, McpTab Drafts szekció. Async render + polling (stateless MCP transport miatt nincs progress-notification); stalled-detekció pm2-restartra; hard delete storage-takarítással.
- Kulcsdöntések: teljes mező-paritás (disclaimer+styles+customCss), draft nem kerül snapshotba, `promoted_message_id` a dupla-promote guard, widget-HTML változatlan reuse. Terv: `~/.claude/plans/k-ne-nekem-egy-j-functional-raven.md`.
- Bump **6.11.0 → 6.12.0**. ⏳ Deploy: migráció+kód egy passzban a boxon.

### 2026-07-22 — DCO/nonDCO epic (Slice 0–4) kód-komplett, PR-re
- Az egész epic megvan a `feat/dco-nondco-matrix` branchen: `prodlist_rows` tábla (`0004`) + `audiences.channel` (`0005`) + DCO/nonDCO matrix-toggle + template-null MC kép-preview + `creative_promote` MCP-tool. nonDCO MC = `messages` sor `template=null`+`image1` → MCP-hivatkozhatóság 0 munkával. 6 channel-audience (DISP/SOC/PRG/GSN/GNW/YT). Auto-topic `familyKey`-ből, freeze-safe.
- **Tesztek: 519/519 zöld, `tsc` tiszta.** Bump **6.10.0 → 6.11.0** (minor). Terv: `~/.claude/plans/van-az-a-feladatd-encapsulated-meadow.md`.
- **Halasztva:** "Matrixize" UI-gomb (`CreativeLibrary.tsx`) + topic-tengely axis-scoping (auto-topic ütközés) + `scripts/import-prodlist.ts`.
- **Deploy hátravan** (PR-merge után, boxon egy passzban): `db:migrate` 0004+0005 a közös Postgresre + `seed-channel-audiences.ts` (ACTIVE_CLIENT_KEY=erste) + `pm2 restart mm6-erste`. A migrációk additívak (új tábla + nullable oszlop) → backward-kompatibilisek.


### 2026-07-21 — todo.md priorizálva (Now/Next/Later + lépés-vázlatok)
- A "Nyitott roadmap" mutató-lista lecserélve **🟢 NOW / 🟡 NEXT / 🔵 LATER** tierekre, minden tételnél fő lépések + reuse-horgonyok + open-Q defaultok. 3 Explore-agent audit korrigálta a done-állapotot: **W0.2 kész** (Wave 0 teljesen zárva), **Wave 2 link+dialog+import kész** (csak guided picker/auto-match/bulk/unmatrixed nyitott), **Wave 3 end-to-end live** (csak cell-badge/unmatched-link/retire nyitott), **audience/topic soft-archive UI részben megvan** (M9 gap szűkebb), **MCP = 39 tool**. Doc-only, nincs verzióbump. Terv: `~/.claude/plans/a-megmaradt-todot-szervezz-k-temporal-widget.md`.

### 2026-07-21 — todo.md szétbontva lean + archív
- `tasks/todo.md` (ez) = lean aktív roadmap + checkpoint. `tasks/todo-archive.md` = a régi ~4000 soros fájl teljes, szó szerinti másolata (semmi nem veszett el). Doc-only, nincs verzióbump.

### 2026-07-21 — W1.1 / W1.5 / W1.6 obsolete (Wave 1 zárva)
- A három maradék Wave 1 smoke-teszt lezárva obsolete-ként: napi live üzem (W1.1) / Phase 8 smoke már megvolt (W1.5) / productionizálva a külön `~/ERSTE Addressable AI Agent` skillben (W1.6). Nincs bump. Részletek: archív § "W1.1 / W1.5 / W1.6 LEZÁRVA".

### 2026-07-21 — DEPLOYOLVA 6.9.0
- Box `3f1d5f4`→`164dfd0`, 1 commit: W0.1 status-szín single-source + W1.2 dense New MC + W1.3 add audience/topic + W1.4 duplicate hover. Séma-migráció nincs. `pm2 restart mm6-erste` → Ready 1377ms. Health `/` 307, `/mcp` 401.
- **User teendő (prod vizuális check, edit-mód):** (1) status dot színek a Design-tab tokenekből, (2) dense New MC kis kör +, (3) add audience/topic záró cella + gomb, (4) header hover Duplicate.

*(Korábbi checkpointok — 6.1.0–6.8.0 deployok, MCP tool-bővítések, Postgres/MinIO migráció, Phase 0–10 — mind az archívban.)*
