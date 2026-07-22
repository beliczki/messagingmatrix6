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
