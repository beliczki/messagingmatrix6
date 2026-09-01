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

### Slice 5 — Creative-library REBUILD lokális forrásból + nonDCO feltöltés (TERV, 2026-08-17, jóváhagyásra vár)
Kiváltó: user a lokális ground-truth-ből (`~/ERSTE Addressable AI Agent/creatives` 3417 fájl + `static_creatives_export.csv`) akarja újraépíteni a Creative Library-t, majd feltölteni a nonDCO mátrixot. **Előfeltétel kész:** nonDCO product-filter bug fix (`MatrixGrid.tsx:619` — csatorna-oszlopok product=NULL, nem szabad product-re vágni őket; kód alkalmazva 2026-08-17). Filename-formátum: `ERSTE_<PROD>_MC<N>_<var>_<TOPIC>_n<ver>_<WxH>.<ext>`, a `parseCreativeFilename` már bontja (`keywords` = a user topic-ja).
- **User-lockolt szabályok:** channel = méret-map (`1080x1080`+`1200x628` → SOC, minden más → DISP; többi channel később); topic = a `keywords` string **egy az egyben** (NEM a Slice-4 slug); mc/variant/version a **fájlnévből**.
- ⚠️ **Eltérés a Slice-4 gépezettől:** `promoteCreative` per-creative dolgozik, MAGA oszt MC-számot, és slug-topicot csinál → a rebuildhez kell egy script ami (a) a fájlnév MC-számát/variánsát megőrzi, (b) családonként (mc+variant+topic) EGY nonDCO MC-t rak channelenként a legfrissebb verzió képével, (c) topic = teljes keyword.
- **User-döntések (2026-08-17):** backup = CSV-dump + hard-delete (MinIO bájt marad); MC-szám a fájlnévből; Adobe PSD = mind hard-delete; rollout = sample-first LTP. Számmodell-ütközés (`egy szám = egy topic` vs fájlnév-szám, MC284 három topicon) feloldva: **topic per-szám = a variant-'a' keywordje**.
- [x] **nonDCO product-filter bug fix:** `MatrixGrid.tsx:619` — a 6 channel-audience `product=NULL`, product-szűrőkor kivágódtak → üres nonDCO grid. Fix: nonDCO-ban a product-szűrő nem vágja az audience-tengelyt, csak a topicokat. `tsc` tiszta.
- [x] **Script `scripts/rebuild-creatives.ts`** (termékre paraméterezve, dry-run default / `--commit`): (1) product creatives+uploaded_files hard-delete, (2) product Adobe PSD DCO MC-k hard-delete, (3) reimport folderből (`uploadFile`+`createCreative`, csak image+video), (4) nonDCO MC-k: kártya=(szám,variant), primary channel `createMessage`-dzsel (szám/variant megőrizve, MC0→auto), többi channel `copyMessages`-szel, channelenként saját méret-preview; channel=méret-map (1080x1080+1200x628→SOC, más→DISP); topic per-szám; creative back-link.
- [x] **Backup:** `~/ERSTE.../backup_20260817_113401/` — `creatives_rows.csv` (3035) + `uploaded_files_rows.csv` (3357), visszatölthető.
- [x] **LTP sample COMMIT (2026-08-17):** 51 régi creatives+uploaded_files törölve, 8 Adobe PSD DCO MC törölve (282-285), 51 creatives újraimportálva, **13 kártya → 21 cella** (13 SOC + 8 DISP), 12 új topic. Verifikálva: mind template-null+image1, mind a 21 image1 feloldódik uploaded_files-ra, 0 LTP PSD maradt, `tsc` tiszta. **⏳ User UI-review vár** (reload → nonDCO → LTP), utána a többi termék (SZA/SZK/VAL/HK/MARKET/HITEL).
- [x] **Deploy 6.15.1 (2026-08-17):** nonDCO product-filter bug fix élesben (box git pull + build + pm2 restart).
- [x] **LTP review-fixek (2026-08-17, 6.15.2):** (1) az új nonDCO topicok `product=NULL` voltak → LTP-szűrőre eltűntek; javítva a scriptben (`createTopic … product`) + a 9 LTP topic élőben back-fillelve `product=LTP`. (2) PreviewPane statikus mód: a DCO size-dropdown/skip-anim/image-preview vezérlők elrejtve template-null MC-nél → tiszta Creative-Library-stílusú kép-box (fájlnév-label + kép + háttér-váltó). `tsc` tiszta, deploy kész.
- **User review verdikt:** topic-szám modell OK; product-tag + preview-box javítva.
- [x] **nonDCO preview méret-switcher (2026-08-17, 6.16.0, deployolva):** a statikus MC preview dropdownja a kreatív VALÓDI tárolt méreteit listázza (azonos MC szám+variant → `creatives` sorok), váltásra az adott méret fájlját mutatja. Új scoped route `GET /api/creatives/by-mc?number=&variant=` + `listCreativesByMc`; PreviewPane statikus mód = Creative-Library-stílusú box (checker háttér default, bg-toggle, nincs template/animáció vezérlő). `tsc` tiszta; box health: `/api/creatives/by-mc` → 401 auth nélkül (helyes).
- [x] **Tengely-tudatos MC-számozás (2026-08-17, 6.17.0):** user-korrekció — DCO és nonDCO külön szám-tér, egy MC-szám párosíthat egy DCO kártyát a statikus nonDCO ikertestvérével (más topicban); a „szám nem ível át topicon" invariáns csak a cél audience TENGELYÉN belül él (`createMessage`, `channel==null` DCO vs set nonDCO). +2 teszt (cross-axis pár OK; nonDCO-n belül tiltott), 33/33 zöld. A `rebuild-creatives.ts` átírva **direct-insert**-re (pmmid+trafficking a valódi generátorokkal) → a fájlnév-szám DCO-pár mellett is megmarad, egy szám vihet eltérő variánsokat channelenként; a script **idempotens** (re-run előtt törli a termék nonDCO MC-it).
- [x] **TELJES ROLLOUT KÉSZ (2026-08-17):** mind a 7 termék újragenerálva a javított logikával. **826 nonDCO MC**, **3145 creatives**. Verifikálva: **DCO szám átível topicon = 0** (user fő szabálya), **Adobe PSD maradék = 0** (mind a 99 törölve), **feloldhatatlan preview = 0**. DCO/nonDCO **MC332-pár** él (DCO emlkezteto + nonDCO remarketing, azonos szám). Backupok: `~/ERSTE.../backup_20260817_113401/` (creatives, uploaded_files, törölt DCO placeholder MC-k, 339→332 renumber).
- **DCO-tisztítás (2026-08-17):** MC459a + 8 üres-template/preview DCO placeholder MC hard-delete (backup CSV); MC339a/b/c → MC332a/b/c átszámozva (pmmid+trafficking konzisztens).
- [x] **nonDCO topic on-the-fly (2026-08-17, 6.18.0, deployolva):** user-kifogás — a ~322 kép-származék topic hígította a DCO `topics` táblát. Javítás: a matrix nonDCO módban a sorokat a kreatív-backed üzenetekből képzi (`message.topic` = keyword, product a `<PROD>_` prefixből), NEM a topics táblából (`MatrixGrid.tsx` `nonDcoTopics` memo). A `rebuild-creatives.ts` már nem hoz létre topic-sort. A 322 nonDCO topic törölve a táblából (backup `deleted_nondco_topics.csv`); topics tábla most 83 (csak DCO), 826 nonDCO üzenet sértetlen.
- **Nyitott / megfigyelés:** nonDCO-ban a fájlnév-szám termékenként ismétlődhet → egy nonDCO szám megjelenhet két product-topicban (külön cella/pmmid, nem ütközik; a user DCO-szabálya nem tiltja). Ha nonDCO-egyediség kell, a scriptbe within-nonDCO ütközés-feloldás kell. Video-only channel (YT) + PRG/GSN/GNW méret-map: később. Deferred: nonDCO auto-topicok üres sorként a DCO nézetben (Slice-4 topic-scoping).

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

### M10 — Bulk Delete az edit-mode panelben: Archive **vagy** Delete dialog (✅ KÉSZ, 6.22.0, 2026-08-17)
Kiindulás: `EditModePanel.tsx:88-96` — a Delete gomb be van drótozva `disabled`-re (`title="Bulk delete — coming in v2"`), nincs mögötte se handler, se endpoint; a Copy/Move mögött ott a `bulk-copy`/`bulk-move`. Cél: kijelölés → Delete → dialog két kimenettel: **Archive** (soft, `archived_at`, „Show archived"-dal visszahozható) vagy **Delete** (hard, sor törlése), hogy az archívum ne teljen meg szeméttel. Rokon: M9 (egy-kártyás archive az editorból) — más belépési pont, ütközés nincs.
- [x] **M10.1** Entity-réteg (`lib/entities/messages.ts`): `archiveMessages()` + `deleteMessages()` a `moveMessages` (`:869`) mintájára — `{mcLabel, expectedVersion}[]`, egy tranzakció, hibán `{ok:false, reason, mcLabel}`. Reason-ök: `version_conflict`, `not_found`, `row_locked_by_status`, `creative_linked`.
  - Hard delete tiltva, ha a státusz a `BLOCKED_MOVE_STATUSES`-ban van (`:859`, ACTIVE/INACTIVE/ARCHIVED) — mérés-zárolt sor csak archiválható. A konstans mostantól két műveletet szolgál (move + delete), ezért semlegesebb néven (`MEASUREMENT_LOCKED_STATUSES`), egy fájlon belüli 2 hivatkozás.
  - Hard delete tiltva, ha ez az **utolsó élő (number, variant)** sor és van rá `creatives` back-link (`mc_number`/`mc_variant` nem FK, lógva maradna). Az üzenet nevezze meg az esetet (a többi MC-hiba stílusában).
  - Amit az FK elintéz: `message_previews` cascade (`schema.ts:353`), `monitoring.message_id` → null (`:621`), `draft_messages.promoted_message_id` → null (`:423`). A MinIO-ban maradó preview-PNG-k a meglévő `scripts/cleanup-unused-assets.ts` dolga, nem itt.
- [x] **M10.2** Route: `POST /api/messages/bulk-delete`, body `{ mode: "archive" | "purge", items: [{mc_label, version}] }`, a `bulk-move/route.ts` szerkezetével (zod + `withSession` + `denyDemo` + tranzakció + reason→HTTP: 409/404/400). Audit: hard delete-nél **soronként** `action:"delete"` a teljes `before`-ral (a sor után ez az egyetlen nyom), archive-nál egy aggregált `bulk_archive` (mint a `bulk_move`).
- [x] **M10.3** Dialog: `matrix/DeleteMcDialog.tsx` — `ModalBackdrop` + `modal`/`modal__header`/`modal__close` osztályok a `CreateMcDialog` mintájára, `alert-dialog` danger-tokenek (`bg-rose-600`, `ShieldAlert`) az `AlertDialog.tsx:139-144`-ből. Három kimenet (Archive / Delete permanently / Cancel), ezért nem fér az `AlertDialog` confirm API-jába (az bináris). Tartalom: N kijelölt MC + státusz-bontás; ha van zárolt sor, a Delete gomb disabled + `title` megnevezi, hány sor és miért.
- [x] **M10.4** Wiring (`MatrixGrid.tsx`): `deleteMutation` a `copyMutation`/`moveMutation` mintájára (`:296-318`), `EditApi` bővítés `openDeleteDialog` / `closeDeleteDialog` / `applyDelete(mode)`, `bulkBusy` + `bulkError` kiterjesztése (`:423-433`), siker után `invalidateQueries(["messages"])` + `clearSelection()`. A dialog a `CreateMcDialog` mellé renderelve (`:965`), mert a státusz-bontáshoz a `messagesById` kell. `EditModePanel.tsx:88-96` gomb élesítése (a `disabled` és a v2-title törlése).
- [x] **M10.5** Tesztek (lokális PG :55432): archive-bulk, hard delete törli a sort + a `message_previews` sorokat, status-lock elutasítás, creative-linked elutasítás, `version_conflict`.
- [x] **M10.6** `tasks/component-inventory.md` (`delete-mc-dialog`) + CHANGELOG + verzió: **minor, `6.21.0` → `6.22.0`** (új route + új UI-akció).

**User-döntés (2026-08-17):** státusz-zár OK; creative-linked eset = **tiltás** (nem néma unlink); egy dialog két akciógombbal. Így ment ki.

### M3 — Üres-vs-tele cella szín-különbség megszüntetése (✅ KÉSZ, 6.24.0, 2026-08-25)
Cél: egységes cella-háttér, hogy a color-by (M1) tiszta alapon üljön.
- [x] **M3.1** `GridView.tsx` PlainCell (`:665`) + EditableCell (`:733`): a `messages.length===0 ? "bg-slate-50/50 dark:bg-white/[0.03]" : "…bg-surface"` feltételes háttér lecserélve egységes `"bg-surface"`-re; a `matrix-grid__cell--has-messages` osztály megmarad szemantikus hookként (nincs saját CSS-e, sehol nem hivatkozzák CSS-ből). A drop-target/reject ring (EditableCell) érintetlen. `tsc` exit 0.

### M2 — "Hide inactive" checkbox a SAROK-cellába (audience + topic sor/oszlop)
Cél: INACTIVE audience/topic sorok/oszlopok elrejtése (MC-t soha). **User-döntés (2026-08-25): a checkbox a mátrix bal-felső SAROK-cellájába (`matrix-grid__corner`, `GridView.tsx:201`) kerül a transpose-gomb mellé, NEM a toolbarba.**
- [x] **M2.1** `hideInactive` state + persist a `mm6_matrix_state_v1`-be (`MatrixGrid.tsx`: `PersistedState`, hydrate, payload, default `false`). Prop + setter le a `GridView`-ba.
- [x] **M2.2** Checkbox a sarok-cellába (`GridView.tsx` `matrix-grid__corner`): `Hide inactive` pipa a transpose-gomb alá (`flex-col`), `normal-case font-normal` override; a sarok `h-20` marad.
- [x] **M2.3** Szűrő a `filtered` useMemóba: `hideInactive` esetén `auds`/`tops` `status!=="INACTIVE"` szűrés az `audKeys`/`topKeys` kiszámítása ELŐTT (MC a header eltűnésével esik ki); MC-t/archive-ot nem érint. **✅ KÉSZ (6.23.0, 2026-08-25).**

### M11 — Drag-and-drop sorrend a mátrix headereken (edit mode, `orderIndex`)
Cél: edit módban a sorok/oszlopok drag-drop-pal átrendezhetőek; a sorrend a meglévő `orderIndex`-be mentődik (audiences + topics). **User-döntés (2026-08-25): mindig látszó handle, de CSAK edit módban; sor elején (bal szél), oszlop alján a szín-border (`audienceEdgeClasses`) FELETT; minden density nézetben.**
Reuse: a `keywords/reorder` minta (`reorderKeywords` `entities/keywords.ts:190` + `POST /api/keywords/reorder` route + `KeywordsTab` reorder mutation `:149`). A grid már használ `@dnd-kit/core` DndContextet MC-chip drag-re (`GridView.tsx:100-146,460`), abba ágazok be.
- **Fázis 1 — valódi `orderIndex`-szel bíró entitások (DCO audiences+topics, nonDCO channel-audiences): ✅ KÉSZ (6.23.0, 2026-08-25).**
  - [x] **M11.1** Entity: `reorderAudiences`/`reorderTopics` (`entities/audiences.ts` / `topics.ts`), EGY tranzakcióban. **Permute-within-occupied-slots** (nem 0..N reindex): `slots = present.map(orderIndexOf).sort(asc)`, `newOrder[i] → orderIndex = slots[i]`; csak a küldött csoport pozíciói permutálódnak → DCO/nonDCO nem interleave-el. Más kliens id-ja + <2 id no-op.
  - [x] **M11.2** Route: `POST /api/audiences/reorder` + `POST /api/topics/reorder`, `withSession`+`denyDemo`, body `{ ids }`, audit `bulk_update` (before/after orderIndex). Bad-body → 400.
  - [x] **M11.3** GridView DnD: `ro:<kind>:<id>` draggable + `rod:<kind>:<id>` droppable a `mc:`/`cell:` mellé; `onDragStart`/`onDragEnd` branch a prefixre; drop → splice a látható `audiences`/`topics` prop id-listájában (nem `rows`/`cols` — a callback a korai return ELŐTT van) → `onReorder` → invalidate. Kind az id-ben kódolva (nincs stale-closure a rowKind-ra).
  - [x] **M11.4** Handle: `HeaderReorderHandle` (mindig látszó grip, CSAK edit módban) — `GripVertical` a row-header bal szélén (`inset-y-0 left-0`), `GripHorizontal` a col-header alján a szín-border felett (`inset-x-0 bottom-0`), a gomb `pl-4`/`pb-3.5` paddinggal nem takarja a szöveget; `HeaderDropZone` pointer-events-none overlay (geometria-alapú collision, isOver ring). Dense is támogatott. `topicReorderable={axis==="dco"}` → nonDCO synth topic-sor nincs grip.
  - [x] **M11.5** Tesztek: `reorderAudiences` (reverse, permute-slots, foreign-client drop, <2 no-op) + `reorderTopics` (permute-slots). ⚠️ **Nem futott le** — se Docker daemon, se lokális PG-szerver (csak libpq kliens); tsc tiszta + unit 181/181 zöld. Az integ-suite futtatása Docker-t igényel.
  - [x] **M11.6** CHANGELOG + bump **minor `6.22.2` → `6.23.0`** + component-inventory (`matrix-grid__row-reorder`/`__col-reorder`/`__reorder-overlay`/`__hide-inactive`).
- **Fázis 2 — nonDCO SZINTETIZÁLT topic-sorok sorrendje (⚠️ ÚJ TÁROLÁSI RÉTEG — push-back-first):** a nonDCO topic-sorok a `message.topic` keywordből szintetizálódnak menet közben (`MatrixGrid nonDcoTopics`, 6.18.0 óta nincsenek a `topics` táblában), nincs `orderIndex`-ük. Sorrend-mentéshez **új overlay-tábla kell** (`matrix_row_order(clientId, axis, rowKey, orderIndex)`, `0007+` migráció, deploy egy passzban). A user kérte ("handle mindenhol"), de ez külön epic — **3-kérdéses push-back kell (tényleg kell perzisztens sorrend a szintetizált soroknak? legolcsóbb 80% = kliens-oldali localStorage-order? build vs outcome?) MIELŐTT tábla születik.** Fázis 1 leszállítása után külön green-light.

### W2.6 + W2.7 — Unmatrixed filter pill + badge (Creative Library)
Cél: uploaded creative-ek MC-link nélkül láthatóak/szűrhetőek legyenek. (A link-mezők + a `CreativeDetailDialog` szerkesztés már él — csak a szűrő/badge hiányzik.)
- [ ] **W2.6** `All | Matrixed | Unmatrixed` pill a `CreativeLibrary` toolbarba (`:821-823` mellé), meglévő toolbar-pill stílus. Logika: `kind==='uploaded' && (mcNumber==null || mcVariant==null)`; persist `mm6_creative_library_match_filter`; `(N)` count.
- [ ] **W2.7** `status-badge--unmatrixed` sarok-badge a tile-on (látszik "All"-ban is).

### D1 — Státusz-szűrő: MC-darabszám opciónként a szűrt eredményben (✅ KÉSZ, 6.31.0, 2026-08-30)
Cél: a Status legördülőben minden opció jobb szélén **kis szürke szám** = hány MC esik arra a státuszra a JELENLEGI szűrt eredményben. Nem pill, nem badge (a pill a gombon már megvan) — csak jobbra igazított `text-xs text-slate-400`.
Reuse: a `MultiPill` már fogad opciónkénti extrát és rendereli az opció-sorban (`optionColors` → színpötty, `_components/MultiPill.tsx:140-143`); ugyanoda kerül egy `optionCounts?: Record<string, number>` prop `ml-auto` számmal. Forrás: a `MatrixGrid` `filtered` useMemója.
- [x] **D1.1** `optionCounts` prop a `MultiPill`-be + jobbra igazított szürke szám (nincs szám → nem renderel semmit).
- [x] **D1.2** `statusCounts` a `MatrixGrid`-ben → `MatrixToolbar` (`:80-85`) → `MultiPill`. **Fontos:** a számot a **státusz-szűrő alkalmazása ELŐTTI** részhalmazon kell képezni (product + search + axis + hide-inactive már ráment), különben minden kiválasztott státusz önmagát számolná, a ki nem választottak meg mindig 0-t mutatnának.
- ⚠️ Default: ugyanez a prop a Product-szűrőre is rámegy (egy hívási sor), ha a user kéri — nem külön munka.

---

## 🟡 NEXT — green-light után, alacsony blokk

### M1 — Matrix "Color by" (Strategy | Platform | Both)
Cél: audience-oszlopok színezése strategy/platform szerint, legenddel.
- [ ] **M1.1** `Color by: None|Strategy|Platform|Both` dropdown a `MatrixToolbar`-ba; persist `mm6_matrix_color_by`.
- [ ] **M1.2** Determinisztikus value→color map a látható audience-ök distinct `strategy`/`buyingPlatform` értékeiből (sorted distinct → paletta-index). Szín-token reuse (ne hardcode `bg-*`; STATUS_COLOR mintája = `status-dot--*` CSS-var class).
- [ ] **M1.3** Szín **band az audience oszlop-fejlécen** (nem a cellán); `Both` = két vékony sáv; kis legend. ⚠️ OPEN Q: `Both` vizuál + header-only.

### M4 — Crosshair highlight (sor+oszlop) hover + click-pin
- [x] **M4.1 (✅ KÉSZ, 6.24.0, 2026-08-25)** Él-rail crosshair, NEM state-alapú. Imperatív (`GridView.paintCrosshair` + delegált `onMouseOver`/`onMouseLeave` a `<table>`-ön, ref) → hoverkor nincs grid-újrarajzolás. `data-col-key`/`data-row-key` a 2 header-`<th>`-re + mindkét cella-`<td>`-re; a `c`+`c-1` oszlop `border-right`-ja és a `r`+`r-1` sor `border-bottom`-ja kap `--mx-cross` színt (`matrix-grid__x--edge-r`/`--edge-b`, unlayered CSS). Csak meglévő border SZÍNE vált → **0 layout-shift**, `transition: border-color 140ms` → nem villódzik. Edit módban is megy (border-color ≠ ring box-shadow). Header-hover = csak az az oszlop/sor. Korlát: legszélső bal oszlop / legfelső sor külső élét a sticky header adja (nincs `c-1`/`r-1`).
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

## 💡 Ötlet-inbox (2026-08-30, user) — döntések lezárva, terv jóváhagyásra vár

Négy ötlet érkezett; a user 2026-08-30-án mindháromra megadta az irányt (a negyedik, **D1**, döntés nélkül indítható és a 🟢 NOW-ban van). Alább: a **lezárt döntés**, a **felmért tények** (DB-ből és kódból, nem tippelve) és a **lépéslista**. Sorrend **lezárva (user, 2026-08-30): D1 + I3 megy elsőként** (a két kicsi, migráció nélkül), utána I1, végül I2.

### I3 — Tree view: színezés **platform** szerint (✅ KÉSZ, 6.31.0, 2026-08-30)
**User-döntés:** platform szerint színezzen, „mert az a kisebb egység — pl. dv360 és adform is programmatic", és a mátrix audience-headerben már a platformot színezzük. → **A csatorna-szín (YT/SOC/DISP) NEM ez a feladat**, és a Design-tab kivezetés egyelőre lekerül (lásd lent a tényt).
**Felmért tények:**
- A platform-szín ma **`audienceEdgeClasses`** (`GridView.tsx:33-51`): két hardcode-olt ág (`dv360` / `adform`) → CSS-osztályok (`globals.css:397-407`, `#43970b` és `#03c9ab`). A strategy a **vastagságot** kódolja (pro 3px / rem 5px), a platform a **színt**. Fontos részlet: **csak akkor színez, ha strategy ÉS platform is be van állítva** (különben `null`).
- **DB (2026-08-30): összesen két platform-érték létezik** — `adform` 105, `dv360` 68, `null` 7 audience. **YouTube / meta / egyéb platform-érték ma NINCS.** (A `monitoring` táblában van 16 „platform", de az riport-forrás — publisher-nevekkel, pl. telex/hvgonline —, más fogalom, nem az `audiences.buyingPlatform`.)
- A `buyingPlatform` **szabad szöveges** mező (autocomplete, `DimensionGrid/columns.ts:32`), nem enum → új platform = adat-kérdés, nem kód-kérdés, HA a színforrás map + fallback.
- A tree-node ma **mélység szerint** színez (`tree-view__node-wrap--lvl-0..5`, `TreeView.tsx:41,240`). A `buildTree` minden node-on gyűjti az átmenő message-id-ket (`AggNode.rows`), és a `parseTreeStructure` a `buyingPlatform`-ot már ismeri csoportosító mezőként (`:28-29`) → a node-onkénti platform kiszámítható, nincs szükség a fa átstrukturálására.
- **⇒ A Settings-kivezetés ma megalapozatlan** (két érték, mindkettőnek van színe). Default: **kódban rögzített map + fallback szín az ismeretlen platformra**; a `channels.color` oszlop + ChannelsTab-swatch csak akkor, ha tényleg lesz több csatorna-szín igény. Ha a user mégis most akarja a szerkeszthetőséget, az külön slice (új oszlop + migráció).
- [x] **I3.1** `PLATFORM_COLOR` map egy helyre (`matrix/types.ts`, a `STATUS_COLOR` mellé — az a bevált precedens), + `PLATFORM_COLOR_FALLBACK`. Az `audienceEdgeClasses` erre kötve: **viselkedés-változás nélkül** (ugyanaz a két osztály áll elő). Ismeretlen platform → fallback-osztály a mai `null` helyett? ⚠️ **NEM**: a mátrix-header maradjon változatlan ebben a slice-ban, a fallback csak a tree-é.
- [x] **I3.2** `buildTree`: `AggNode`-ra `platforms: Set<string>`, a `TreeNode`-ra `platform?: string` (pontosan egy distinct érték esetén) + `platformMixed?: true` (több esetén). A `rows` gyűjtésével azonos helyen (`buildTree.ts:118`), a row audience-éből.
- [x] **I3.3** `TreeView`: a node-osztály a platform-színt kapja a `--lvl-N` helyett, ha van egyértelmű platform; `mixed` → semleges (mai lvl-szín); nincs platform (pl. topic-ág) → mai lvl-szín. A `LEVEL_COLOR_CYCLE` marad fallbacknek.
- [x] **I3.4** `component-inventory` frissítve. **Legend NEM készült, szándékosan:** az appban ma sehol nincs legend-komponens (a mátrix audience-header is legend nélkül színez a platformmal), így a tree-hez építeni új mintát találna ki egy olyan kódoláshoz, ami máshol is magyarázat nélkül él. Külön kérésre, és akkor mindkét helyre egyszerre.
- ✅ **LEZÁRVA (user, 2026-08-30):** a tree **csak színt** kap; a strategy vastagság-kódolása NEM jön át (a tree-node keretvastagsága ma más célt szolgál).

### I5 — Feed-részletek a 500-as limit miatt (IGÉNY RÖGZÍTVE, 2026-08-31 — user: „ezzel majd később")
**Modell-javítás (user):** a „productonként egy live feed" **hibás kérés volt** — egy termékhez több élő feed tartozhat. **Az SZK mai esete a PLATFORM szerinti kettősség**, amit a 6.34.0 már megold (`feed_exports.platform`, `findLiveExport(product, platform)`, platformonkénti verzió-vonal és Live sor). **Máskor viszont a `MAX_ROWS_PER_FEED = 500` is szétvághat egy terméket két részletre** — ez a rész elhalasztva.
- **User-döntés, ami már megvan:** a részletek **két önálló feed** (nem egy feed két fele) → külön verzió-vonal, külön élő sor, külön diff — pontosan az a forma, amit a platform-oszlop csinál. Egy jövőbeli limit-alapú vágásnak ugyanígy **saját megkülönböztetőt** kell kapnia, nem az uniót kell diffelnie.
- **Nyitva:** mi a megkülönböztető a limit-alapú vágásnál (a vágás helye önmagában nem jelent semmit), és ki dönti el a vágást (automatikus limit szerint vs kézi MC-besorolás, ami megmarad a következő exportra). A user mindkettőt későbbre tette.
- **Tény a döntéshez:** `MAX_ROWS_PER_FEED = 500` (`feed-export.ts:32`), és az SZK exportok korábban **443 / 644 / 681** sorosak voltak — tehát a limit valós kényszer, nem elméleti.

### I6 — Diff-alap választó + „a feedből semmi nem tűnik el" szabály (TERV KÉSZ, ÉPÍTÉS ZÖLD-LIGHTRA VÁR)
**User-szabály, egy mondatban:** a feedből soha semmi nem tűnik el — ami kikerül a válogatásból, vagy amelynek az azonosítói megváltoztak, az bent marad `IsActive=FALSE`-szal, a pótlása hozzáfűződik; **törölni csak explicit „force new version" esetén** szabad.
**User-döntések (2026-08-31):** (1) diff-alapnak **bármelyik korábbi, termékre stimmelő feed** választható, default a **legfrissebb** (mindegy, referencia vagy export); (2) force nélkül a diff **ne mutasson sor-törlést** — azt mondja, hogy „az új feedben az alaphoz képest nincs benne x sor", és ezek a régiben INACTIVE-ra állnak; force esetén ezek törlődnének; (3) ha pmmid/advert_id változik: a korábbi sor INACTIVE lesz, és a frissült azonosítójú sor **újként hozzáadódik**.

**⚠️ LELET — ma a szűrő FELÜLÍRJA a sticky-supersetet.** `feed-export.ts:416`: `if (allowed && !allowed.has(m.id)) continue;` — a `messageIds` szűrő a carry-forward unió **ELŐTT** fut, tehát a mátrix-szűrőn kívül eső sor akkor is kiesik a feedből, ha benne van az élő exportban. Vagyis a user által tiltott törlés **ma megtörténik**, épp amikor szakaszonként szűrve exportál. Ez a szabály fő sérülési pontja, és egyben a javítás helye.

**Szeletek:**
- [x] **I6.1 Carry-forward a szűrő felett:** a `liveIdSet`-beli sorok ne essenek ki az `allowed` szűrőn; ha nincsenek a mai válogatásban, a soruk `IsActive=FALSE`-szal megy ki (az `isActiveCol` felülírás mintájára, ami ma az archivált sorokra megy, `:452`). ⚠️ **Feed-kimenetet változtat** — a négy lockolt invariáns egyike (sticky-superset), tesztekkel és külön ellenőrzéssel.
- [x] **I6.2 Diff-szöveg:** force nélkül ne „removed" legyen, hanem „x sor nincs benne az új feedben → INACTIVE lesz"; force-szal „x sor törlődik". A `diffRowSets` számol tovább, csak a bemutatás és a `decideVersion` indoklása változik.
- [x] **I6.3 Alap-választó:** a dialogban select a termék (és platform) korábbi feedjeiből, default a legfrissebb; a választott id a POST bodyba, a szerver ahhoz diffel (ma automatikus: legfrissebb referencia → utolsó export).
- [x] **I6.4 (A NEHÉZ RÉSZ) kulcsmező-változás:** ha egy MC pmmid/advert_id-je változott, a régi sornak nincs többé mögötte üzenet — tehát azt **az alap payloadjából** kell kihozni, INACTIVE-ra állítva. Ez új fogalom: „szellemsor", aminek nincs message-e. Érinti a `messageIds` párhuzamos tömböt és a DEFAULT-sor indexét. **Ezt külön szeletként, saját teszttel.**
- [x] **I6.5** Tesztek mind a négyre + CHANGELOG + bump.

**Miért nem kezdtem bele:** ez a `buildFeedRowSet` kimenetét módosítja, ami a **négy lockolt feed-invariáns** területe (sticky-superset, verzió-bump triggerek, uploaded≠exported, DEFAULT-sor transzformáció). Nem akartam egy hosszú session végén, más kiadással összekeverve hozzányúlni.

### I4 — Drive-leadási linkek ↔ Creative Library (IGÉNY RÖGZÍTVE, 2026-08-31 — NINCS terv, nincs döntés)
**User-igény, szó szerint:** „szeretnék egy feature-t ami összeköti a Google Drive leadási linkeket a Creative Library kreatívok infóval; jó lenne tudni hogy mi hol érhető el Drive-on mátrixból, meg Drive-ból hogy azok hol elérhetőek matrix preview API-n." **User: „megbeszéljük később, most csak az igény van."** → **NE készüljön terv, amíg a lenti három kapu nincs megválaszolva.**

**Felmérés (2026-08-31, tények — ezek a kiindulás, ha egyszer nekiállunk):**
- ⚠️ **Az `/api/drive/proxy/` NEM Google Drive.** v5-ös örökség: a `template.json` beégetett `path-messagingmatrix` útvonala, ami fájlnév alapján a MinIO-ból szolgál ki bájtokat (`src/app/api/drive/proxy/[filename]/route.ts`). **A projektben ma nulla Drive-integráció van.**
- Minden eddigi Drive-munka (átnevezések, lapos tükör, mtime-helyreállítás) a **user gépén, a mountolt Drive-on** futó scriptekkel ment. **A Hetzner boxon nincs Drive mount** — ez dönti el, hogy tárolt linkre vagy API-ra van szükség.
- **A fájlnév már ma is join-kulcs:** a korábbi átnevezési körök után „3227/3227 cél létezik" és „60/60 fájl neve egyezik a DB-vel". Ha a mappaszerkezet determinisztikus, a Drive-hely nagy része **kiszámítható** abból, amit az MM6 már tud — új tárolás nélkül.
- **Átfedés meglévő roadmap-tételekkel:** **FR-B Documents** (Google Slides link-tárház, `documents` tábla + soft link + MCP toolok) majdnem ugyanez a forma; a **Wave 5 — Share → Google Drive** kapujában pedig az áll, hogy a legolcsóbb 80% = PDF-export + manuális Drive drop → *kill the build*. Külön építve **két majdnem azonos dolgot** kapnánk.

**Megválaszolatlan kapuk (a user későbbre tette):**
1. **Hozzáférés:** tárolt link/útvonal (script tölti a mountról, nincs OAuth) · számított útvonal (nulla tárolás, de nincs kattintható URL) · valódi Drive API (OAuth + token-tárolás + kvóta, a boxon is).
2. **Kimenet:** generált kereszt-riport (a `docs/mc-collisions.html` mintájára, nulla séma/UI/deploy) · UI a Creative Library-ben · MCP tool az agentnek.
3. **FR-B összevonás:** közös „külső hivatkozás" tábla mindkettőre, vagy külön.

### I1 — Dashboard: hasznos **napi** áttekintő (DÖNTÉS LEZÁRVA)
**User-döntés:** „ha már van, hasznos áttekintőt szeretnék belőle faragni, **per nap**." → a dashboard **nap-scope-os digest**, nem szabad-szűrős analitika-oldal. Ez egyben megválaszolja a top-toolbar kérdést: a szűrő = **nap-választó** (Ma / Tegnap / utolsó 7 nap), nem generikus filter-sáv.
**Felmért tények (2026-08-30, prod DB):**
- **Az activity-log nem listázható nyersen:** ma **904** audit-sor van (tegnap 1754, 2026-08-17-én **5085**) — a mai 15-soros nyers lista (`page.tsx:37-43,105-125`) ebből semmit nem mutat. **A „legyen okosabb" valódi tartalma: aggregálás** (ki / mit / hány darabot), nem szebb sorok.
- A humanizálás két fele **már roadmap-item**: `FR-D D.1` (`actor_kind` ui|mcp oszlop → ember-vs-agent badge) és `D.2` (users-join a nyers `userId` helyett). **Az I1 ezeket előrehozza, nem duplikálja.**
- **A `reporting` tábla ÜRES (0 sor)** → a chartok forrása **kizárólag a `monitoring`** (6366 sor: impressions/clicks/cost/conversions, `period_from/to`, `imported_at`, `platform`, `mc_number`).
- **A monitoring-adat elavult:** a lefedett időszak **2026. május** (`01/05`–`31/05`), az utolsó import **2026-07-16**. ⇒ **A user által kért „report dátum" widget a legértékesebb az egész oldalon** (hangosan kiírja, hogy 6 hete nincs friss adat), a **chartok viszont ma 3 hónapos adatot rajzolnának** — ezért a chart-slice a monitoring-ingest újraindulásáig alacsony hozamú.
- **`feed_exports`:** 23 sor, oszlopok `exported_at` / `uploaded_to_adform_at` (nincs `created_at`). A legutóbbi három (SZA v2 ma, SZA v1 tegnap) **`uploaded_to_adform_at = NULL`** → az „exportálva, de nincs feltöltve" a legkonkrétabb napi jelzés, és pontosan a lockolt feed-invariánst (uploaded ≠ exported) teszi láthatóvá.
- **Kreatívok:** az 1080×1080 → 300×250 **arány-eltérés** (1:1 vs 1.2:1) → nem transzformáció, hanem illesztés. **Default: a 250×250 doboz** (arányhelyes), `object-contain`-nel, a Creative Library tile mintájára.
- Ma nincs chart-lib a projektben (új függőség = külön döntés).
- [ ] **I1.1 Nap-scope + fejléc:** `?d=YYYY-MM-DD` (default: ma) + Ma / Tegnap / 7 nap kapcsoló. A meglévő toolbar-pill stílust használja, nem új chrome. A page marad server component, a scope URL-ben (nincs kliens-state).
- [ ] **I1.2 Activity-digest (a nyers lista helyett):** aznapi `audit_log` **aggregálva** — `entityType` × `action` × aktor, darabszámmal, a top-N kibontható. Ide jön be `FR-D D.2` (users-join → email/név) — **`D.1` (`actor_kind`) séma-migráció, ezért külön slice** (lásd I1.6).
- [ ] **I1.3 Friss kreatívok — horizontális album (user-pontosítás, 2026-08-30):** aznap létrehozott `creatives` vízszintes csíkban. **Normalizálás MAGASSÁGRA, nem fix dobozra:** a 300×250 megy **eredeti méretben**, az 1080×1080 **250×250-re** kicsinyítve → minden tile **250px magas**, a szélesség változó. (Ez feloldja az arány-problémát: nem vágunk és nem letterboxolunk, csak azonos magasságra hozunk.) Vezérlés: **léptető gombok** + **mobil swipe** balra/jobbra, az elején **rugalmas visszapattanás**, a végén **infinite scroll** (lapozva tölt tovább). A Creative Library tile-t újrahasználva, ne szülessen új tile-komponens.
  - ⚠️ Tisztázandó a slice indulásakor: az „aznapi" halmaz mennyi tile-t jelent (ma 0–56/nap a `creatives` szerint) — ha egy napra kevés, az album scope-ja legyen-e inkább „legutóbbi N" a nap-scope helyett? Az infinite scroll csak akkor keres értelmet, ha van mit tölteni.
- [ ] **I1.4 Feed-exportok:** aznapi `feed_exports` (product, verzió, `exported_at`) + **„exportálva, nincs feltöltve" figyelmeztetés**, ha `uploaded_to_adform_at IS NULL`.
- [ ] **I1.5 Riport-frissesség tile:** `monitoring` `max(imported_at)` + a lefedett `period_from..period_to` + „N napja nincs friss import" jelzés. **Ez az egyetlen widget, ami MA is hasznos adatot mutat** — előre veendő.
- [ ] **I1.6 (külön slice, migrációval) `actor_kind`:** `FR-D D.1` — `ui|mcp` oszlop az `audit_log`-ra + beállítás a két writer-site-on + ember/agent badge a digestben. **Migráció + kód egy passzban a boxon.** Ugyanez az oszlop-fogalom kell az I2-höz → **egyszer szülessen meg.**
- [ ] **I1.7 (halasztva) Chartok:** amíg a monitoring-import nem indul újra, 3 hónapos adatot rajzolnának. Chart-lib választás + widget csak ezután. ⚠️ **Külön green-light.**
- ⚠️ **Elvetve az első körből:** side toolbar view-kapcsolókkal — a nap-scope adja a nézetváltást, és 5-6 widgetnél a második toolbar üres chrome.

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

### 2026-08-18 — Delete-dialog szövegjavítás (6.22.1)
- **User-kifogás:** a dialog „Remove 4 Messaging Cards" + 4× `MC290a` felirata azt sugallta, hogy magát a kártyát törli, pedig egy kijelölt cella = **egy audience-másolat**. A megkülönböztetés azért fontos, mert a kártya tartalma csak az UTOLSÓ másolat permanens törlésekor tűnik el.
- Javítás (`DeleteMcDialog.tsx` + `MatrixGrid.tsx`): a fejléc „Remove N audience copies", a lista **kártyánként csoportosít** ((number, variant, topic) = valódi audience-másolatok) „MC290a · 4 of 32 audience copies" formában, `LAST COPY` rose badge + piros figyelmeztető doboz ott, ahol a kijelölés az utolsó másolatot is tartalmazza. A darabszám a **teljes** üzenetlistából jön, nem a szűrt nézetből (szűrt másolat is életben tartja a kártyát).
- Backend változatlan; `tsc` tiszta. **DEPLOYOLVA 6.22.1** (2026-08-18): commit `d7c4c63`, box `b28b391`→`d7c4c63`, build OK, `pm2 restart mm6-erste` → Ready 1426ms. Health: `/` 307, `/login` 200, `/mcp` 401.

### 2026-08-17 — MC-átszámozás SQL-lel + M10 bulk delete (6.22.0)
- **MC renumber élesben (client 8).** A DCO html-kártyák a nonDCO eredetijük számát kapták meg (axis-scoped számozás, `entities/messages.ts:215-227`): `34800` MC838a → **MC290a**, `34801` MC838a → **MC321a**, `34802` MC838b → **MC321c**. Nincs app-szintű renumber (a `number`/`variant` nem writable a PATCH-en), ezért kézi SQL: `number`(+`variant`) mellett `pmmid` (`m_838`→`m_szám`, `-v_b-`→`-v_c-`), `utm_cd26`, `utm_term`, `final_trafficked_url`, `version+1`. Az `updateMessage` minden mentésen újraszámolja a trafficking mezőket, de a **pmmid-et soha** — azt kézzel kell vinni.
- Előtte ellenőrizve: cél-szám szabad a DCO tengelyen, 0 `creatives`/`monitoring`/`reporting`/`text_formatting`/preview hivatkozás, és egyik feed exportban sem szerepeltek.
- **Ismert csapda:** a `findSiblings` (`:448`) csak (number, variant)-re szűr, tengelyre nem → a global edit (`?propagate=siblings`) a nonDCO ikreket is testvérnek látja. A renumberelt kártyákon ne használd.
- **DEPLOYOLVA 6.22.0** (2026-08-18): commit `b28b391`, box `c71831c`→`b28b391`, `npm run build` OK, `pm2 restart mm6-erste` → Ready 1332ms. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/mcp` 401, `POST /api/messages/bulk-delete` 401 auth nélkül (a route él, nem 404).
- **M10 leszállítva** (részletek fent): `archiveMessages`/`deleteMessages` + `POST /api/messages/bulk-delete` + `DeleteMcDialog` + a panel Delete gombja élesítve. 7 új integrációs teszt, teljes suite 573/573 zöld, `tsc --noEmit` tiszta. Böngészős click-through még nem volt.

### 2026-08-17 — 3 eltűnt SZK asset: root cause + restore (rebuild-creatives category-guard)
- **Tünet:** az Assets gridben három 08-16-án feltöltött SZK asset (id 1140–1142) szürke placeholderként jelent meg.
- **Root cause:** `scripts/rebuild-creatives.ts` 1. lépése (`drop this product's creatives + uploaded_files`) **csak fájlnév-prefix** alapján törölt (`filename like 'ERSTE_<PROD>_%'`), `category` szűrő nélkül. Az asset-library feltöltések ugyanezt a `ERSTE_<PROD>_MC…` névkonvenciót követik → a ma 11:06–11:12 UTC-kor futott SZK rebuild elvitte a három `category='asset'` sort is. Az `assets` sorokat a script nem törli, így azok életben maradtak egy halott `file_id`-vel → dangling hivatkozás → nincs mihez thumbnailt szolgálni.
- **Bizonyíték:** `audit_log` 3847–3852 (create-ek 08-16 07:51–07:53), `uploaded_files` category='asset' max created_at = 08-13 (a 08-16-osok eltűntek), SZK creative-ek mind 08-17 11:06–11:12. Törlésről nincs audit bejegyzés → nem app-útvonal volt.
- **Fix:** `eq(uploadedFiles.category, "creative")` a delete-be + magyarázó komment. Predikátum-ellenőrzés: régi 642 sor / új 639 sor → **pontosan a 3 asset kímélve**, minden SZK creative továbbra is törlődik.
- **Restore:** a bytok megvoltak MinIO-ban (a script nem hív `deleteStorageFile`-t). A három `uploaded_files` sor visszaírva az audit logból mentett eredeti `id`/`sha256`/`size`/`filename` + a MinIO key + az `assets` sorból a `dimensions` alapján; mindhárom objektum sha256-a **újraszámolva egyezik**. Dangling maradék: 2 db — a régi 2026-05-01-i `EBH_SELFIE_ONBOARDING_CSEMPÉK…` sorok, **más ok**, nyitott apróság.
- `tsc --noEmit` zöld. Élesen (boxon) a script frissítése kell a következő rebuild előtt; a DB közös, a restore már live.

### 2026-08-17 — DEPLOYOLVA 6.15.0 (edit-mode hint + MultiPill quick-select)
- Bump `6.14.0`→`6.15.0`, commit `d5489b8`, push, box deploy: `/var/www/mm6-erste` pull → build → `pm2 restart mm6-erste` (Ready 1623ms; séma-migráció nincs). Health: `/` 307, `/mcp` 401, `/login` 200.
- **User teendő (prod vizuális check):** (1) matrix jobb-toolbar Edit mode panel — a hint-sor a gomb fölött; (2) Status pill dropdown — "Select all / none"; (3) creative library Size pill — default/social/iab/none, `social`+`iab` stackel, ismételt kattintás leszedi.


- Kiindulás: user szerint nem lehet UI-ból audience/topic-ot felvenni. Valójában **lehet** — a `+` záró oszlop/sor csak **edit mode**-ban és csak **grid view**-ban látszik (`GridView.tsx:313,437` → `MatrixGrid.addHeader:534`, POST `/api/audiences|topics`, kulcs szerveroldali auto-gen: `config.patterns.audienceKey` vagy `aud{N+1}`). A felfedezhetőség volt a hiba, nem a funkció.
- **Fix 1:** `edit-mode-panel__hint` — egy szürke sor a title és a toggle között ("Add / duplicate topics and audiences; add, copy and move Messaging Cards.").
- **Fix 2:** `MultiPill` új opcionális `quickSelect` propja + `multi-pill__bulk` / `__bulk-link` osztályok. Status pillek (MatrixToolbar + DimensionGrid) → megosztott `STATUS_QUICK_SELECT` ("Select all / none"). Creative library Size pill → lokális `SIZE_QUICK_SELECT` (default/social/iab/none). Preset-szemantika: nevesített preset **togglel** (mind bent → kiveszi, különben hozzáadja), így `social`+`iab` stackelhető; `none` = all↔none flip; az `options`-ben nem létező méretekre hivatkozó preset link elrejtve.
- Nincs séma-migráció, nincs új route. `tsc --noEmit` zöld. (`npm run lint` a repo-ban interaktív ESLint-setup promptra fut — deprecated `next lint`, külön ügy.)
- **Nyitott apróság:** a collapsed jobb-toolbar ceruza-ikonja (`MatrixGrid.tsx:815`) csak `title="Enter edit mode"`-ot visel, a hint oda nem került be.

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

### 2026-08-17 — Global edit: státusz + flight date variant-szintűre
- **Root cause (nem bug, tervezési ütközés):** a `status`/`startDate`/`endDate` a 2026-08-14-i döntés óta **number-szintű** mezők voltak (`NUMBER_LEVEL_FIELDS`), így Global edit-nél az MC331c státusza szétterült az **összes variánsra** (a,b,c). A user viszont variant-szintet akart (331a inaktív mindenhol, 331c aktív mindenhol). Ezt látta „a c mellett az a és b is aktív lesz"-ként. A „nem megy tovább a többi audience-re" tünet = Global edit ki volt kapcsolva, vagy 409 (más is editálta → reload-only conflict, audit logban látszik).
- **Fix (user-döntés 2026-08-17, felülírja a 2026-08-14-it):** `NUMBER_LEVEL_FIELDS = []` — mindhárom mező variant-szintű lett (ugyanúgy propagál, mint a kreatív mezők: azonos number+variant, minden audience-ben; más variáns érintetlen). Frissítve: `messages.ts` komment + mező-lista, `MessageEditor.tsx` 2 tooltip copy, `propagate-siblings.test.ts` fő assertion (b variáns már NEM változik). Tesztek 9/9 zöld, `tsc` tiszta.
- **Nincs retroaktív adatjavítás:** a régi rossz állapotokat (ahol a/b már aktívra flippelt) a usernek egyszer manuálisan kell rendbe tennie (331a inaktív global, 331b inaktív global). Innentől helyesen propagál.
- **Kapcsolódó fix (ugyanaz a session):** globalEdit státusz-mentés után a TÖBBI audience testvér-pöttye ~30s-t késett. Ok: az `onSuccess` csak a primaryt patch-elte a cache-be (`setQueriesData`), a testvéreket egy `invalidateQueries` **teljes /api/messages refetch**-re bízta (~2435 sor, nehéz → lassú). A szerver viszont már kiszámolja a módosított testvér-sorokat (`propagateToSiblings` `changes`), csak eldobta. Fix: a `PATCH /api/messages/[id]` visszaadja a `siblings: after[]` sorokat, a kliens azokat is **közvetlenül bepatch-eli** (id→row Map), a teljes refetch kiesett. Cross-tab frissülés továbbra is az SSE broadcaston megy (writeAudit → `audit.ts:43`). Érintett: `messages/[id]/route.ts`, `MessageEditor.tsx` onSuccess. `tsc` tiszta, tesztek zöld.
- Bump-javaslat: **6.18.0 → 6.19.0** (minor, user-látható viselkedésváltozás — státusz-szint + azonnali sibling-frissülés).

### 2026-08-17 — TERV: Leadás-forrás átnevezés a javasolt névre + Creative Library újraépítés (JÓVÁHAGYÁSRA VÁR)
Kérés: `~/ERSTE Addressable AI Agent/static_creatives_export.csv` `suggested_filename` oszlopa alapján átnevezni **az eredeti fájlokat a GoogleDrive Leadás-könyvtárakban** (dátumok megőrzésével!), majd újra lefuttatni a creative-library update-et (dátumok ott is megmaradnak).

**Felderítés (kész, 2026-08-17):**
- CSV: 3227 sor, mind a 3227 forrás-path létezik; 1869 sor neve ≠ `suggested_filename`; 0 duplikált cél-név ugyanabban a könyvtárban.
- A GoogleDrive mount **case-insensitive** (macfuse) → 11 „csak kisbetű/nagybetű" átnevezés (`MC289_B` → `MC289_b`) csak **két lépésben** (temp néven át) megy.
- 26 `htmlFolder` sor valódi **könyvtár**, és a javaslat hibásan `.htmlFolder` kiterjesztést biggyeszt a végére → ezeknél a `.htmlFolder` suffixet le kell vágni.
- 10 sorban van `suggestion_correction` érték (kézi felülbírálás) → az élvez elsőbbséget a `suggested_filename`-nel szemben.
- 53 `suggested_filename` nem illeszkedik a kanonikus `ERSTE_<PROD>_MC<N>_<var>_<TOPIC>_n<v>_<WxH>.<ext>` mintára (pl. `MC3_va_`, hash-topicok).

**Fontos megállapítás (ez blokkolja a „aztán újra a library update" részt):**
- A lapos tükör (`~/ERSTE.../creatives`, 3227 fájl) **már most is pontosan a `suggested_filename` neveket viseli, és az mtime-ok bitre egyeznek a forrásokkal** (0 eltérés). A mm6 DB is ebből épült (3145 creatives = 3227 − 82 htmlFolder). → Az eredetik átnevezése **forrás-higiénia**, önmagában **nem változtat semmit a DB-ben**; a rebuild újrafuttatása ugyanazt az eredményt adná.
- A valószínű **valódi nonDCO-hiba:** 1259 `suggested_filename` **még mindig `MC0`-t tartalmaz**, miközben a CSV `suggested_mc_number` oszlopa valódi számot ad (MC2–MC388, 231 distinct). A `rebuild-creatives.ts` a **fájlnévből** veszi az MC-számot → az 1259 MC0-fájl **friss, globális max fölötti számot** kapott (ezért fut fel a nonDCO 837-ig) a szándékolt MC2–MC388 helyett.
- A behelyettesítés **nem mechanikus**: 43 `(suggested_mc_number, variant)` pár **több topichoz** tartozik, és 19 pár **ütközik** egy már számozott családdal (gyakran más termékben).

**Lépések (a ⚠️ döntés után indul):**
- [x] **R0** User-döntés (2026-08-17): **szó szerint a `suggested_filename`** (MC0 marad MC0) + a htmlFolder-mappáknál a `.htmlFolder` suffix levágva: az átnevezés csak a `suggested_filename`-t követi (MC0 marad), VAGY a `MC0` → `suggested_mc_number` behelyettesítéssel együtt (és akkor a 43+19 ütközés feloldási szabálya kell).
- [x] **R1** Rename-manifest generálás (dry-run CSV: `path`, régi név, új név, mtime ISO, ütközés-flag) — `.tmp_rename/` alatt, semmit nem ír.
- [x] **R2** Átnevezés végrehajtása: `os.rename` + **mtime visszaírás** (`os.utime` a CSV `date`-jéből), case-only esetek két lépésben, htmlFolder-suffix levágva, `suggestion_correction` prioritással. Rollback-manifest kiírása.
- [x] **R3** Verifikáció: 0 hiányzó forrás, 0 duplikátum, minden mtime egyezik a CSV `date`-tel.
- [ ] **R4** Lapos tükör (`~/ERSTE.../creatives`) újraszinkronizálása az új nevekre, mtime-megőrzéssel + `creatives_manifest.csv` / `static_creatives_export.csv` frissítés.
- [x] **R5** mm6 rebuild: `rebuild-creatives.ts <PROD> --commit` mind a 7 termékre (LTP/SZA/SZK/VAL/HK/MARKET/HITEL) — a script idempotens, a `createdAt` a fájl mtime-jából jön.
- [x] **R6** Ellenőrzés a DB-n: nonDCO max MC-szám, „DCO szám átível topicon = 0", feloldhatatlan preview = 0, creatives darabszám + `createdAt` eloszlás a CSV `date`-hez képest.
- [x] **R7** CHANGELOG + bump-javaslat.
- **DEPLOYOLVA 6.19.0** (2026-08-17): commit `11091ae`, box `a64235f`→`11091ae` (2 commit lemaradást is behozott: createdAt-backfill + docs), `npm run build` OK, `pm2 restart mm6-erste` → online. Nincs séma-migráció (csak route válasz-alak + propagáció-logika + kliens). Health `/` 307, `/mcp` 401.

**R1–R4 EREDMÉNY (2026-08-17):**
- **1867 fájl/mappa átnevezve** a Leadás-könyvtárakban (1358 már jó nevű volt, 0 ütközés). A 2 „failed" sor valójában lement — a macfuse a `rename` utáni `stat`-ra dobott ENOENT-et (metadata-cache), a cél-fájlok a helyükön vannak.
- **11 case-only átnevezés** (`MC289_B` → `MC289_b`) temp-néven keresztül lement, 0 temp-maradvány.
- **Dátumok:** a `rename` a Drive-mounton megőrzi az mtime-ot; a **26 htmlFolder-mappánál** viszont a Drive utólag felülírta (sync) → `os.utime`-mal visszaállítva a CSV `date`-ből. **Végállapot: 3227/3227 cél létezik, 0 mtime-eltérés a CSV-hez képest.**
- **R4 tárgytalan:** a lapos tükör (`~/ERSTE.../creatives`) nevei és mtime-jai már azonosak voltak a CSV-vel, és azok is maradtak (3227 fájl, 0 eltérés mindkét irányban).
- Manifestek: `rename_manifest.csv` + `rename_done.csv` a session-scratchpadban (rollback-alap).

**R5 — GYÖKÉR-OK JAVÍTVA (2026-08-17), fut a 7 termék:**
- **`rebuild-creatives.ts` számozás determinisztikussá téve.** A nonDCO MC-szám mostantól: (1) a fájlnévből, ha van valódi szám; (2) a `static_creatives_export.csv` `suggested_mc_number` oszlopából, ha a fájlnév `MC0`. A terv **az összes termékre egyszerre** számolódik, tisztán a mappa + CSV függvénye → **egy re-run bitre ugyanazt adja**. Az `autoNum = max(number)+1` fallback **törölve** (ez volt a 800+ számok forrása); ha egy fájl se fájlnév-, se CSV-számot nem hoz, a script **leáll**, nem talál ki számot.
- **Ütközés-szabály:** a fájlnév-igény veri a CSV-javaslatot. A CSV generátora 324–332-t osztott ki MC0-családoknak, miközben azok a számok már más termék fájlneveiben éltek → a 9 vesztes csoport a nonDCO-tér teteje fölé került: `HITEL MC324–329 → MC389–394`, `MARKET MC330–332 → MC395–397`. Determinisztikus (termék+szám szerint rendezve allokál). Fájlnév-vs-fájlnév ütközés (10 szám: 7/159/171/174/287/288/289/290/302/321) **érintetlen** — az a korábbi állapot, nem ez a terv hozta.
- **Számterv (dry-run, mind a 7 termék):** 446 nonDCO kártya → 688 cella, számtartomány **2–397** (a mai 826 sor / 333–837 helyett). 3145 forrásfájl: 1914 fájlnév-szám + 1231 CSV-javaslat.
- **Új-MC auto-számozás tengely-scope-olt** (`messages.ts` `liveOnAxis` + `numbering.ts` doc): egy új DCO MC a DCO-max+1-et kapja (333), egy új nonDCO a nonDCO-max+1-et (398) — nem ugrik át a másik tengely magasságára. +1 integrációs teszt (`messages.test.ts`), MCP tool-leírás + MatrixGrid komment frissítve.
- **Backup a destruktív futás előtt:** `~/ERSTE.../backup_20260817_prerenumber/` — `nondco_messages.csv` (826), `creatives_rows.csv` (3145), `uploaded_files_rows.csv` (3145).

**(eredeti blokkoló megjegyzés, feloldva):** a rebuild újrafuttatása **tartalmilag no-op** (a forrás bájtra és névre azonos), viszont **kárt okoz**: a `rebuild-creatives.ts:331` `autoNum = max(number)+1` a törlés UTÁN számol, így a **308 auto-számozott nonDCO kártya** (a 826-ból; 69 jön a fájlnévből) újraszámozódna 333–837-ről 838+-ra. Ez a nonDCO-hiba gyökere is: 1259 fájlnév `MC0`, a CSV `suggested_mc_number`-e viszont MC2–MC388 — ezt a mostani rename (szándékosan) nem javította.

---

## 🟡 NEXT — Channels-entitás + MC-creation defaults epic (TERV, 2026-08-17, JÓVÁHAGYÁSRA VÁR)

**Kiváltó (user, 2026-08-17):** 5 összefüggő igény. Döntések lockolva: (1) channelek KÜLÖN entitás, ch_* audience-ok kiszedve az audiences-ből; (2) default template a Templates oldalon megjelölve (per-client config); (3) egy nagy összefüggő terv.

**Élő adat (migráció mérete):** 6 ch_* channel-audience · 180 DCO audience · **826 nonDCO message hivatkozik `audience="ch_*"` string-kulcson** (nincs DB FK → törlésnél elárvulnának) · 826 template=null · 814 status null/üres.

**Architekturális tény (térkép, 2026-08-17):** a "channel" ma NEM tábla, hanem az `audiences.channel` nullable oszlop. nonDCO message a channelt közvetve, `messages.audience = "ch_disp"` kulcson hivatkozza. A DCO/nonDCO tengely mindenhol `audience.channel == null` vs `!= null`. `createMessage` (`messages.ts:322-351`) pmmid+trafficking-et épít az audience-kulcs lookupból → a channel-audience törlése a nonDCO pmmid/UTM-et is érinti.

**Ajánlott megközelítés (light-B, kockázat-minimalizált — jóváhagyandó):** új `channels` tábla adja a channel-definíciókat; a `messages.audience` string-kulcsok (`ch_disp`) VÁLTOZATLANOK maradnak (nincs 826-soros átdrótozás); a ch_* SOROK törlődnek az `audiences`-ből; a channel-kulcs lookupok (numbering / trafficking / matrix-oszlop / archive-cascade) **channel-aware fallback**-et kapnak (ha egy audience-kulcs nincs a valódi audience-ök közt, a channels táblából oldódik fel). Ez a user B-döntését teljesíti (külön entitás + ch_* kitakarítás) a 826-soros adat-rewrite és a `messages.channel` oszlop nélkül.

### Szeletek (mind commit-méretű, teszttel)

- [x] **S1 — Default status = INCOMING.** `createMessage`: `status: input.status ?? "INCOMING"` (lefedi dialog+MCP `mc_create`/`mc_create_batch`+promote+draft-promote; copy/move a forrás státuszát klónozza, változatlan). Teszt: create default INCOMING; explicit status felülír. *(Nyitott: a 814 meglévő null-status backfill — külön, opcionális.)*
- [x] **S2 — Default template DCO MC-hez.** Új per-client `config` kulcs `defaultTemplate` (a `visibleTemplates` mintájára). Templates oldal: "Set as default" jelölő egy HTML template-re → írja a configot. Create-logika: ha a cél audience DCO (nem channel) ÉS nincs template megadva → `template = config.defaultTemplate`; channel/nonDCO ág marad `null`. Teszt: DCO create default template-et kap, nonDCO nem.
- [x] **S3 — nonDCO edit-mode kivezetés + info box.** `filters.axis === "nondco"` guard: add-MC ("+" üres cella + dense), add-audience/add-topic header-gombok (`GridView.tsx:310-322,424-443,600-624`) elrejtve nonDCO-ban; az `EditModePanel` (`MatrixGrid.tsx:883-888`) helyén nonDCO-ban info box: "Upload correctly named creatives to the Creative Library to see them here." (empty-state token, szemantikus class). Nincs séma.
- [x] **S4 — Channels tábla + migráció (a nehéz mag).** Új `channels` tábla `(clientId, key, code, label, orderIndex, archivedAt)`. Migráció: tábla + seed a 6 ch_*-ból (kulcs `ch_disp`, kód `DISP`, label `Display` megőrzve) → majd a 6 ch_* audience SOR archiválása/törlése. Rewire channel-aware fallbackkel: matrix-oszlop deriv (`MatrixGrid.tsx:582-585,642-644`), axis-numbering `channelByAudience` (`messages.ts:215-227`), promote channel→kulcs (`promote.ts:63-79`), createMessage pmmid/trafficking lookup (channels a lookup-felületen), archive/restore cascade (`audiences.ts`/`messages.ts`). **Integr. teszt: migráció után a 826 nonDCO message + derivált topic-sorok VÁLTOZATLANUL látszanak a mátrixban; promote channelre rak; numbering DCO/nonDCO nem ütközik.**
- [x] **S5 — Settings › Channels management.** Új Settings tab/szekció a channel-lista kezelésére (label + sorrend + archive; a channel-SET forrása a `prodlist_rows.channel`-lel reconciled). Reuse: DimensionGrid vagy keywords-stílus. (Méret→channel map `egyelőre` kód-szintű marad, channels kulcsokra hivatkozva.)
- [x] **S6 — Audiences lista tiszta + verifikáció.** A ch_* sorok az S4 után már nincsenek az `audiences`-ben → a lista automatikusan tiszta; ellenőrzés + regressziós teszt hogy channel nem szivárog vissza. `types.ts:21` + `WRITABLE_FIELDS` channel-mező sorsa (marad a fallbackhez vagy törlődik) az S4-ben dől el.

### Kockázatok / hazardok (térkép szerint, sorrendben)
1. `messages.audience` nem-FK text → ch_* törlésnél a 826 sor csendben elárvulhat. **Kezelés:** kulcs-stringek megőrzése + channel-aware lookup, migrációs teszt.
2. Axis-numbering `sameAxis`/`targetIsDco` → rossz join DCO/nonDCO MC-szám ütközést okoz. **Kezelés:** dedikált numbering teszt.
3. Promote + rebuild-creatives + seed channel→audience lookup elhal. **Kezelés:** átirányítás channels táblára.
4. Archive/restore cascade parent-child alak változik. **Kezelés:** channel-aware cascade.
5. nonDCO pmmid/trafficking az audience-lookupon lóg. **Kezelés (S4 nyitott al-döntés):** ellenőrizni kell-e egyáltalán nonDCO-nak pmmid/UTM; ha igen, channels a lookup-felületen.

### Deploy
Séma-migráció (channels tábla) → **migrate+kód egy passzban a boxon** (`db:migrate` + build + `pm2 restart mm6-erste`), soha nem lokális migrate önmagában. Bump: minor (több user-látható változás + séma) — vagy a user dönthet nagyobbról a channel-modell törése miatt.

**Sorrend-javaslat:** S1 → S2 → S3 (független, gyors, alacsony kockázat, azonnal deployolható) ⇒ S4 → S5 → S6 (channel-mag, egyben migrálva/deployolva).
- **DEPLOYOLVA 6.20.0** (2026-08-17): S1–S3 (channel-epic 1/2, migration-free). Commit `6a818ca`, box `11091ae`→`6a818ca`, build OK, `pm2 restart mm6-erste` → online. Health `/` 307, `/mcp` 401. S4–S6 (channels tábla + migráció + Settings + audiences-takarítás) hátravan, egyben deployolva. ⚠️ Megjegyzés: a boxra NEM kerültek fel a `rebuild-creatives.ts`/`mcp.ts`/`numbering.ts` lokális commitolatlan módosítások (nem az én munkám) — csak origin/main.
- **DEPLOYOLVA 6.21.0** (2026-08-17): S4–S6 channel-mag. Commit `c71831c`, box `6a818ca`→`c71831c`. Séma-migráció `0007` (channels tábla) + `migrate-channels.ts` (erste): **6 channel seedelve, 6 ch_* audience törölve, 0 message elveszett** (ch_*-kulcsú msg 583→602 közben NŐTT a párhuzamos rebuild miatt). build OK, `pm2 restart` → online. Health `/` 307, `/mcp` 401, `/api/channels` 401. ⚠️ **rebuild-creatives.ts (user uncommitted) még channel-audience-t használ — a channels-táblára kell átírni futtatás előtt.** ⚠️ Csak erste-re futott a data-migráció; ha más kliens is használ nonDCO-t, nekik is kell.

**R5–R7 EREDMÉNY (2026-08-17):**
- **Mind a 7 termék újraépítve.** Az első háttérfutás a HITEL újraimportja közben megszakadt (külső kill, 520/555 creative bement, 0 nonDCO MC) — a script idempotens, a HITEL újrafuttatása rendbe tette.
- **Végállapot (DB, erste):** **688 nonDCO üzenet** (357 DISP + 331 SOC), **232 distinct MC-szám, tartomány 2–397** (a korábbi 826 sor / 333–837 helyett). 3145 creatives. `createdAt` visszaállítva a CSV file-dátumokból (`fix-creative-dates.ts --commit`, 3145 sor; 3118 CSV-ből, 27 mtime-ból).
- **Invariánsok:** DCO szám átível topicon = 0 · nonDCO image1 feloldhatatlan = 0 · nonDCO image1 hiányzik = 0 · DCO max = 332. nonDCO-ban 10 szám ível át topicon — pontosan a 10 előzetesen azonosított fájlnév-vs-fájlnév ütközés (7/159/171/174/287/288/289/290/302/321), ezeket szándékosan nem nyúltuk.
- **⚠️ Párhuzamos session:** közben a repo 6.19.0 → **6.21.0**-ra ment (channels epic: a channel-audience-ök átkerültek a külön `channels` táblába, `migrate-channels.ts`). A rebuild által írt `audience='ch_disp'/'ch_soc'` kulcsok **helyesek maradtak** — a channels-modell pont ezt írja elő ("nonDCO messages keep their audience key and resolve through the channels table"). A tengely-scope-olt auto-számozás (`liveOnAxis`) is bekerült HEAD-be a 6.20.0-val, a channels-modellhez igazítva.
- Tesztek **566/566 zöld**, `tsc` tiszta.
- **Nyitva maradt (user-döntés kérdése):** 1231 fájl neve továbbra is `MC0` — a szám a CSV-ből jön, nem a fájlnévből. Ha a fájlnevek is a valódi számot vinnék, a rename-et újra kéne futtatni MC0 → `suggested_mc_number` behelyettesítéssel (a 9 ütköző csoportra a fenti 389–397 leképezéssel).

### 2026-08-18 — MC0 → valódi szám a fájlnevekben is (a rename második köre)
- **User-döntés:** a fájlnevek is vigyék a valódi MC-számot, a rebuild által használt leképezéssel (fájlnév-szám nyer; `MC0` → CSV `suggested_mc_number`; a 9 ütköző csoport 389–397).
- **2518 átnevezés, 0 hiba** — 1259 eredeti a Leadás-könyvtárakban + 1259 a lapos tükörben. mtime mindkét helyen megőrizve (8 htmlFolder-mappánál a Drive felülírta → `os.utime`-mal visszaállítva). Végállapot: **0 `MC0` maradt**, 3227 eredeti + 3227 tükör, 0 dátum-eltérés.
- **CSV átvezetve** (`name`, `path`, `suggested_filename`, `suggestion_correction`, + a 9 csoport `suggested_mc_number`-e = 73 sor). Backup: `static_creatives_export.before_mc0_substitution.csv`. A `name`/`path` az ELSŐ rename kör után is elavult volt 610 sorban — most mind a 3227 sor a `suggested_filename`-ből újraszármaztatva, 0 hiányzó fájl. ⚠️ A `filename_ok` / `dimension_ok` oszlopokat nem nyúltam — azokat a külső szkennernek kell újraszámolnia.
- **CRLF-csapda:** a CSV újraírása CRLF-re váltott, amitől a `loadSuggestedNumbers` nem találta az utolsó oszlopot. A fájl visszaállítva LF-re, a parser pedig megvédve a `\r`-től.
- **DB in-place átnevezve, NEM újraépítve.** A `storage_path` tartalom-hash alapú, nem a fájlnévből jön → elég volt 4 UPDATE egy tranzakcióban (`uploaded_files.filename` + `original_filename` 1231, `creatives.file_name` 1231, `messages.image1` 290, `messages.name` 290). Ezzel megspóroltunk egy ~2 órás, destruktív újratöltést MinIO-ba.
- **Verifikáció:** `creatives.mc_number` vs az új fájlnév száma → **0 eltérés** (a DB számai már pontosan egyeztek). Rebuild dry-run: **3145 fájl, mind a fájlnévből, 0 CSV-javaslat, 0 újraallokáció** — a terv változatlan. DB: 688 nonDCO üzenet, 232 szám, **2–397**, feloldhatatlan image1 = 0, DB-név nincs a lemezen = 0. DCO max = **333** (közben született egy új DCO MC — pont a tengely-scope-olt allokáció működése).

---

## 🔴 INCIDENS — MC301c tartalom felülíródott (2026-08-17 20:15) — helyreállítva, javítás JÓVÁHAGYÁSRA VÁR

**Tünet (user, 2026-08-18):** MC301c tartalma MC330c/MC330a tartalmára cserélődött.

**Mi történt (audit_log alapján, bizonyított):** 2026-08-17 **20:15:42 → 20:15:59** között az MC301c **mind a 36 audience-sora** (34 DCO + 2 nonDCO `ch_disp`/`ch_soc`) hatszor egymás után teljesen felülíródott, mindig egy **másik** kártya tartalmával, ~3 mp-enként: **MC316a** („Kalkulátor - autó") → **MC317b** („Kalkulátor - lakás") → **MC319d** („Kalkulátor - varatlen") → két név nélküli kártya → **MC330a** („Lakásfelújítás lépésenként", `MC330_a_felhasznalas_lakasfelujitas_n1.jpg`). Kárfelmérés az egész audit-történetre (≥5 kártya-mező egyszerre változott): **csak a 301c érintett** (216 sor-update); a 332a/b/c találatok új kártya kitöltései, nem kár.

### Két külön gyökér-ok

**GY1 — elavult `committedSnapshot` az editorban (ez írta be a más kártya tartalmát).**
`MessageEditor.tsx` `save.onSuccess` **feltétel nélkül** rebase-eli a `committedSnapshot`-ot a mentett sorra, akkor is, ha az editor közben már **másik kártyára lépett** (prev/next `onJump`). Sorrend:
1. A kártyán fut egy autosave PATCH (globális szerkesztéssel ~2 mp, mert 35 testvérsort ír).
2. A user átlép B kártyára → a reset-effect `draft`+`committedSnapshot` = B.
3. Az A-ra indított mentés beér → `onSuccess` → `committedSnapshot` **vissza A-ra**, miközben a `draft` már B.
4. A következő autosave `diff(A, B)` = B **összes** mezője → PATCH **A sor id-jára** → A kártya tartalma = B tartalma.
5. Globális szerkesztéssel ez az összes audience-másolatra rámegy.
Önfenntartó: a lassú propagáló PATCH miatt a következő lapozáskor megint van in-flight mentés → 6 hullám 17 mp alatt.

**GY2 — a testvér-fan-out nem tengely-tudatos (a user diagnózisa, megerősítve).**
`messages.ts` `findSiblings` / `propagateToSiblings` **csak `(clientId, number, variant)`-ra szűr**, tengely nélkül — a kódkomment még a régi invariánst állítja („(number, variant) never spans more than one topic"). A **6.17.0** viszont pont ezt oldotta fel: `nextMcSlot` kommentje szerint „Cross-axis reuse is allowed — a DCO number may be claimed for its nonDCO twin". Így egy DCO MC301c global edit **beleír a nonDCO MC301c-be** (és fordítva). Élő kitettség most: **31 `(number, variant)` pár / 20 MC-szám él mindkét tengelyen.**

### Helyreállítás — KÉSZ (2026-08-18)
- [x] Forrás: `audit_log.before` a kaszkád **első** bejegyzéséből soronként (pontosabb, mint az xlsx: soronkénti, UTM-mel együtt). Backup a felülírt állapotról: scratchpad `mc301c_before_restore.jsonl` (36 sor).
- [x] 36 sor visszaállítva (tartalom + stílus + képek + UTM + státusz + flight dates), `version` +1. Ellenőrizve az `erste-SZK-feed-v1-22-merged-adform.xlsx` ellen: „Pattintsd le a régi hiteled!" / „Próbáld ki hitelkiváltás kalkulátorunkat!" / `keklabda_pattan` / `purple fullSurfaceColor objectGfx` — egyezik. A 2 nonDCO sor a saját statikus kreatív-nevét kapta vissza.
- [x] Previewk: `message_previews.message_version` = 1 vs `messages.version` = 9 → a meglévő stale-detektálás újragenerálja, nincs teendő.

### Javítás (TERV — jóváhagyásra vár)
- [x] **F1 (GY1)** `MessageEditor.tsx`: új `openRowIdRef` tartja a ténylegesen nyitott sort. `save.onSuccess` csak akkor rebase-eli a `committedSnapshot`-ot, ha `openRowIdRef.current === saved.message.id`; a `onError` konfliktus-ág elhagyott sorra `return`-öl (nem blokkolja a most nyitott kártyát). A grid-cache patch marad feltétel nélküli (a mentett sorok valósak).
- [x] **F2 (GY2)** `messages.ts`: új `sameAxisAs(clientId, primary)` helper (a `nextMcSlot` `sameAxis`-ával azonos szemantika: `listAudiences` + `listChannels().map(channelToAudience)`, ismeretlen kulcs = DCO). `findSiblings` és `propagateToSiblings` `family`-je is szűr rá. `MatrixGrid.openSiblingCount` szintén tengely-tudatos (`channelAudienceKeys`), hogy a figyelmeztetés azt mondja, amit a fan-out csinál. A `messages.ts:279` + a `propagateToSiblings` elavult kommentjei javítva.
- [x] **F3** Bump `6.22.1` → **`6.22.2`** (patch) + CHANGELOG. *(Alternatíva volt a minor, mert az F2 user-látható viselkedésváltozás — de mindkettő hibás viselkedés javítása, ezért patch.)*

**Tesztek:** 3 új integrációs teszt (`tests/integration/api/messages.test.ts`, `messages — global-edit fan-out is axis-scoped`): findSiblings kihagyja a nonDCO névrokont; DCO global edit nem ér el a nonDCO ikerhez; és fordítva. Ellenőrizve, hogy a javítás nélkül **buknak**. Teljes suite **576/576 zöld**, `tsc` tiszta.
**Nem fedi teszt:** az F1 React-race — a repo-ban nincs komponens-teszt infra (`.test.tsx` nincs), ezért nem építettem hozzá újat.
**Deploy:** nincs séma-migráció, sima build + `pm2 restart mm6-erste`. A DB-helyreállítás a közös Hetzner Postgresen már él.

- **DEPLOYOLVA 6.22.2** (2026-08-18): MC301c incidens javítása (F1 editor stale-snapshot + F2 tengely-scope-olt fan-out). Commit `0956f82`, box `d7c4c63`→`0956f82` (a 6.22.1-et is behozta), `npm run build` OK, `pm2 restart mm6-erste` → online. Nincs séma-migráció. Health `/` 307, `/mcp` 401, `/api/channels` 401. A DB-helyreállítás (36 sor) a közös Postgresen érintetlen.

### 2026-08-25 — Hide-inactive sarok-checkbox + header drag-reorder (6.23.0)
- **M2 ✅** — `Hide inactive` pipa a mátrix sarok-cellájába (transpose alá, `matrix-grid__hide-inactive`); `filtered` useMemo dobja az `INACTIVE` audience/topic headereket mindkét tengelyen (MC-t/archive-ot nem érint); persist `mm6_matrix_state_v1`.
- **M11 Fázis 1 ✅** — edit-mode drag-drop sorrend a headereken. Mindig látszó grip (csak edit módban): row bal szél (`GripVertical`), col alsó él a szín-border felett (`GripHorizontal`), minden density. `reorderAudiences`/`reorderTopics` (permute-within-occupied-slots — nem 0..N reindex, így DCO/nonDCO nem interleave-el) + `POST /api/{audiences,topics}/reorder` (`withSession`+`denyDemo`, audit). GridView DnD kiterjesztve `ro:`/`rod:` prefixekkel a meglévő `@dnd-kit` contextbe.
- **nonDCO topic-sorok:** nincs grip (synth, nincs orderIndex) → `topicReorderable={axis==="dco"}`. **M11 Fázis 2** (overlay-tábla a synth-sorok sorrendjéhez) külön epic, push-back-first — a user kérte ("handle mindenhol"), de új tárolási réteg, ezért elhalasztva.
- **Teszt-állapot:** tsc tiszta (lokál + box build exit 0), unit **181/181 zöld**. Új integ-tesztek (audiences: reverse/permute-slots/foreign-drop/no-op; topics: permute-slots) MEGÍRVA, de **nem futottak** — nincs se Docker daemon, se lokális PG-szerver (csak libpq kliens a gépen). ⏳ Integ-suite lefuttatása hátravan, amint a Docker fenn van (`npm run test:fast`).
- **Bump:** `6.22.2` → `6.23.0` (minor: 2 új route + új edit-mode UI-akció + új sarok-kontroll). CHANGELOG + component-inventory frissítve.
- **DEPLOYOLVA 6.23.0 (2026-08-25):** commit `12b1633`, push origin main, box `/var/www/mm6-erste` git pull `0956f82→12b1633` + `npm run build` (exit 0) + `pm2 restart mm6-erste` → online. Nincs séma-migráció. Health: `/`→307, `/mcp`→401, `/api/audiences/reorder` GET→405 (csak POST), `/api/topics/reorder` POST no-auth→401. `~$` Office lock-fájl gitignore-olva.

### 2026-08-25 — Egységes cella-háttér (M3) + hover crosshair (M4.1) — 6.24.0
- **6.23.1 (előző, addig nem checkpointolt):** audience strategy/platform szín-strip a jobb élre került transposed nézetben (audience=sor), nem az aljára — `audienceEdgeClasses` bottom/right ág + right-edge CSS-variánsok. Commit `245d58d`.
- **M3 ✅** — `GridView.tsx` PlainCell + EditableCell egységes `bg-surface` (üres és tele cella azonos háttér); a feltételes `bg-slate-50/50 dark:white/[0.03]` üres-tint törölve. A `matrix-grid__cell--has-messages` osztály marad szemantikus hookként (nincs saját CSS-e). Tiszta alap az M1 „Color by"-hoz.
- **M4.1 ✅** — hover crosshair él-rail-ekkel. Imperatív (`paintCrosshair` + delegált `onMouseOver`/`onMouseLeave` a `<table>`-ön), nincs grid re-render hoverkor. Oszlop bal+jobb (`c`+`c-1` `border-right`) és sor alsó+felső (`r`+`r-1` `border-bottom`) él kap `--mx-cross` színt; csak border-COLOR vált → 0 layout-shift, `transition: border-color 140ms` → nem villódzik. Edit módban is megy (nem ütközik a drop-ring box-shadow-jával). Header-hover = csak az az oszlop/sor. `data-col-key`/`data-row-key` a headereken + cellákon. Új CSS-token `--mx-cross` (light `#0ea5e9` / dark `#38bdf8`), unlayered mátrix-blokk.
- **Verifikáció:** `tsc --noEmit` exit 0. Vizuális check a boxon/dev-en (nem futott le böngészős smoke).
- **Bump:** `6.23.1` → `6.24.0` (minor — M4.1 új feature; M3 CSS-tisztítás egybevonva). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.

### 2026-08-25 — Sidebar theme toggle (Confai2-minta) + crosshair szürke + dense pötty-centrálás — 6.25.0
- **User-kérés (3 db):** (1) crosshair NE kék legyen, hanem semleges szürke (light ~30%-kal sötétebb mint az alap border, dark picivel világosabb); (2) dense nézetben az egysoros pötty-csoportok vertikálisan középre; (3) a Confai2 light/dark switcherének működését+elhelyezését átvenni a sidebar fix alsó részébe (becsukva függőleges verzióval), és kivenni a theme-switchert a Settings/Design tabból (system állapot elhagyva).
- **(1) Crosshair szín:** `--mx-cross` → `rgba(0,0,0,0.4)` light / `rgba(255,255,255,0.4)` dark (kék `#0ea5e9`/`#38bdf8` helyett). Semleges szürke, egyértelműen sötétebb/világosabb a halvány rács-vonalnál.
- **(2) Dense pötty-centrálás:** `GridView.tsx` PlainCell + EditableCell — dense ágon `align-top` → `align-middle` (a `<td>` vertical-align középre teszi a pötty-blokkot a sor magasságában; egysoros és kétsoros csoport is centrálva). Nem-dense marad `align-top`.
- **(3) Sidebar theme toggle + verzió (Confai2-minta):** `Sidebar.tsx` — a footer aljára pinnelt `app-sidebar__theme` blokk. Expanded: Sun/Moon segmented pill (`app-sidebar__theme-pill`/`__theme-btn`) + inline verzió. Collapsed: függőleges verzió (`-rotate-90`, `h-11` box) + kör-ikon gomb (`app-sidebar__theme-round`). A toggle a `.dark` class-t váltja + `localStorage.mm6_theme` (per-böngésző, light/dark only). A verzió a nav-ból a fix footerbe költözött. **mm6 SAJÁT theme-infra újrahasznosítva** (nincs Confai2-provider import): a `<head>` FOUC inline-script + `localStorage.mm6_theme` + `.dark` már megvolt.
- **DesignTab:** a „Color mode" szekció + `ColorModeField` (light/dark/system pill) törölve; az `applyColorMode` és a `localStorage.setItem("mm6_theme", …)` **leválasztva** (különben egy brand-szín Save felülírná a sidebar theme-választását). A `colorMode` mező a configban marad (első-látogatás default), de UI-ból nem szerkeszthető; a system állapot a UI-ból eltűnt.
- **Verifikáció:** `tsc --noEmit` exit 0, `npm run build` exit 0. Böngészős smoke a userre vár (dark/light váltás + collapsed sidebar + crosshair szürke + dense pöttyök).
- **Bump:** `6.24.0` → `6.25.0` (minor — új sidebar feature + user-látható theme-áthelyezés). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.
- **Deferred/megjegyzés:** Confai2 view-transition circle-reveal animáció (startViewTransition) NEM került át — plain instant váltás + color-transition; külön kérésre hozzáadható. A sidebar teljes dark-polish a külön WP-sweep tárgya (a bg-white/border-slate utilityk már remappeltek dark-ban).

### 2026-08-25 — Sidebar theme finomítás: kör-reveal animáció + verzió-szín + reorder — 6.26.0
- **User-észrevételek (3):** (1) miért színes a verzió? → legyen szürke mint minden más; (2) a switcher + verzió az admin@local FÖLÉ; (3) a switcher a Confai2 masked-animációja helyett koncentrikus kör-animáció a kattintás helyétől a teljes felületre, a megjelenés rögzítésével az animáció idejére.
- **(1) Verzió-szín:** `text-slate-400` → `text-slate-500`. Ok: a `slate-500/600` át van kötve dark-ban `--text-secondary`-re (semleges #999), a `slate-400` NEM → nyers Tailwind slate-400 (#94a3b8, kékes) → színesnek látszott. Most a többi muted label-lel egyezik.
- **(2) Reorder:** a `app-sidebar__theme` blokk a footer TETEJÉRE került (a user/`admin@local` blokk fölé), `border-b` elválasztóval (`border-t` helyett).
- **(3) Kör-reveal animáció:** `Sidebar.setTheme(next, e)` a class-flipet `document.startViewTransition`-be csomagolja; a kattintás `clientX/clientY`-ből `--theme-switch-x/y` a `<html>`-en; globals.css `::view-transition-new(mm-theme)` `clip-path: circle(0%→150% at var(...))` 0.5s, az `::view-transition-old` `animation:none` (befagyasztva). `prefers-reduced-motion` → JS kihagyja a view transitiont (azonnali flip); API nélküli böngészőn is azonnali flip. `html { view-transition-name: mm-theme }` (a Next router nem trigger-el view transitiont, biztonságos).
- **Verifikáció:** `tsc` exit 0, `npm run build` exit 0. Böngészős smoke a userre vár (kör-animáció a kattintás helyétől; verzió szürke; sorrend admin@local fölött).
- **Bump:** `6.25.0` → `6.26.0` (minor — új kör-reveal animáció-viselkedés). CHANGELOG frissítve. Nincs séma-migráció.

### 2026-08-25 — Dark-mode fixek + bug-hunt report (Finding 1–4,6) — 6.27.0
- **Dark-mode darabok (user-jelentés + screenshotok):** (1) sidebar: vonal törölve a switcher és admin@local közül (`border-b`→`mb-3`); (2) DCO/nonDCO toggle aktív `bg-slate-800`→`bg-slate-900` (invertál fehérre dark-ban); (3) MC-editor tab-sor `bg-slate-50/60`→`bg-slate-50` (a `/opacity` variáns NEM remappelt, a sima igen); (4) audience/topic property panelek `bg-slate-50/50`→`bg-slate-50`; (5) feed „Build & Download XLSX" gomb `bg-brand-button`→`bg-slate-900 hover:bg-slate-800` (mint az upload-gomb, invertál); (6) feed warning/success dobozok amber/emerald `dark:` variánsok.
- **Bug-hunt `docs/BUGHUNT_2026-08-25_matrix-filter-crash.md` — Finding 1–4,6 megcsinálva:**
  - **F1 (CRITICAL, én okoztam 6.24.0-ban):** a crosshair `tableRef`/`crossRef` az empty-axis early return ALÁ került → egy nullára szűkítő `t:`/`a:`/… filter React #300 („rendered fewer hooks") → egész app fehér képernyő. Fix: a két `useRef` az early return FÖLÉ, magyarázó kommenttel.
  - **F2:** `src/app/(app)/error.tsx` route-szintű error boundary (a layout/sidebar életben marad, Try again / Reload).
  - **F3:** ESLint flat config (`eslint.config.mjs`, `next/core-web-vitals` + `react-hooks/rules-of-hooks: error`), `lint`→`eslint .`. Verifikálva: a hook-after-early-return mintát elfogja (a fixet előtte buktatta volna). A `next build` mostantól enforce-olja → megjavítottam a build-blokkoló pre-existing errorokat: `useS3`→`s3Enabled` rename (sima fv, nem hook, 3 false-positive), `<a>`→`<Link>` (FeedExportDialog), 3 unescaped entity (McpTab/SnapshotsTab). Maradék: 72 warning (img/exhaustive-deps) — nem blokkol, külön takarítás.
  - **F4:** `quietConsole` flag a render-pipeline-on (render.ts `injectQuietConsole` → no-op console.log/debug/info, warn/error marad), csak a Creative Library grid-tile-okon bekapcsolva (Tile/Card/ListRow prop-átvezetés); editor/share/monitoring marad verbose.
  - **F6:** `/api/previews/status` offenders `mcLabel` szerint csoportosít (nem row-onként), `mcCount` = distinct label.
  - **F5 (NEM csinálva):** stored-preview kiszolgálás live-render helyett — design-change, a report is „discuss first"-nek jelöli.
- **Verifikáció:** `tsc` exit 0, `npm run build` exit 0. Integ-teszt Docker-igényes (down); komponens-teszt infra nincs (F1 React-race). 
- **Bump:** `6.26.0` → `6.27.0` (minor — kritikus crash-fix + több user-látható dark-mode/badge/console változás). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.

### 2026-08-29 — Topic-hozzáadás 500 + header-dialog bezáródás tag-szerkesztésnél (bump vár: 6.27.4)
- **(1) „can't add topic" (prod 500):** az Erste `config.patterns.topicKey` = `{{product}}_{{tag1}}_{{tag2}}_{{tag3}}_{{tag4}}`. Új topicnál minden mező üres → a minta `____`-ra evaluálódik, ami NEM üres string, így a `generateTopicKey()` `out.trim() !== ""` fallback-őre átengedte → a 2. topictól `duplicate key ... topics_client_key_unique (8, ____)` → 500. (Prod pm2 logból, nem tippelve.) Fix `src/lib/entities/topics.ts`: `hasKeyContent()` — alfanumerikus tartalom nélküli minta-eredmény = üres → `top{orderIndex+1}` fallback; + `ensureUniqueKey()` a create és az update key-regen ágán (a meglévő `_N` suffix-konvencióval), ami a másik élő változatot is lezárja (két azonos product/tag kombójú topic ugyanazt a kulcsot generálta volna). 2 regressziós teszt (`topics.test.ts`).
- **(2) Tag-szerkesztés bezárta a header-dialogot:** a `MatrixGrid.headerDialog` state `{kind, key}`-t tárolt, a `headerEntity` pedig `topics.find(t => t.key === headerDialog.key)`. A tag/product mentése szerveroldalon ÚJRAGENERÁLJA a kulcsot (MC-guard: csak 0 MC-nél) → az autosave utáni refetch után a key-alapú lookup nem talált semmit → `headerEntity === null` → a dialog unmountolt. Fix: a state és az `onOpenHeader` id-alapú (`MatrixGrid.tsx`, `GridView.tsx`), a `headerMessages` a `headerEntity.key`-t használja. (Ugyanez érintette az audience-dialogot is.)
- **(3) Topic törlés:** már létezik — Topics oldal → sor kijelölése → Edit panel → Delete (hard delete, MC-vel rendelkező sort visszautasít). A matrix edit-mode header-menüben csak add/duplicate van; ha oda is kell törlés, külön kérés. A 606 (`____`, „New topic") és 612 („ - boost individual (2)") sor 0 MC-vel törölhető.
- **Audiences twin-bug NEM javítva:** a `generateAudienceKey()` ugyanezt az `out.trim() !== ""` ellenőrzést használja, ugyanezzel a minta-alakkal (`audienceKey`) → ugyanígy 500-azni fog. Külön kérésre tükrözöm.
- **Verifikáció:** `tsc --noEmit` exit 0, `npx vitest run` 583/583 zöld, eslint a módosított fájlokon 0 error. Deploy a boxra még nem történt meg.

### 2026-08-29 — Audience-kulcs fix + header-dialog Delete + legacy Tag mező — 6.28.0
- **(1) `generateAudienceKey()` ugyanaz a fix mint a topicnál (6.27.4):** `hasKeyContent()` (szeparátor-only minta-eredmény = üres → `aud{N}` fallback) + `ensureUniqueKey()` a create és az update key-regen ágán. 2 regressziós teszt (`audiences-key-pattern.test.ts`).
- **(2) Delete a header-dialogban (topic ÉS audience), az Autosave mellett:** rose-outline `matrix-header-dialog__delete` gomb. Folyamat: (a) kliens-precheck a **szűrők nélküli** MC-listán (`headerAllMessages`, bármilyen státusz) → ha van MC, `alert({variant:"warning", confirmLabel:"Cancel"})` a blokkolók listájával (`MC<szám><variant> — név — státusz`), csak Cancel; (b) ha nincs, `confirm({variant:"danger"})` → POST `hard-delete` (If-Match); (c) a szerver 409 `in_use` válasza (archivált MC-k, amiket a grid nem is töltött be) ugyanazt a warning-dialogot nyitja a szerver listájával. Meglévő `useAlertDialog()` infra, nem új dialog-komponens.
- **`referencedBy` szerződés-változás:** `number[]` → `BlockingMc[]` (`id, number, variant, status, name`), új közös `src/lib/entities/mc-refs.ts` (nincs import-ciklus a messages.ts-szel). Érinti: topics.ts, audiences.ts, entity-route.ts, DimensionEditPanel.tsx (csak típus), 2 teszt-assert.
- **(3) Legacy `Tag` mező kivéve a topic-formból:** a tag1–4 az, ami a Key-be generálódik; a sorszám nélküli `tag` ötödik, kulcs nélküli tagnek látszott. A DB-oszlop és a Topics-grid oszlopa marad (1 legacy sor tartalmaz értéket: topic 224).
- **Csatorna-sor bug (a 6.27.4 id-alapú lookup mellékhatása):** a nonDCO tengely channel-sorai a channels tábla id-jét hozzák → ütközhet valódi audience id-vel. A `headerDialog` state mostantól `{kind, id, channel}` és a lookup a channel-diszkriminátort is nézi; channel-sornál nincs Delete gomb (nem audience, nem törölhető azon a route-on).
- **Verifikáció:** `tsc --noEmit` exit 0, `npx vitest run` 585/585 zöld, `npm run build` exit 0, eslint 0 error. Component-inventory frissítve (`__delete`, `__blockers`).
- **Bump:** `6.27.4` → `6.28.0` (minor — új user-látható delete-akció + API-válasz alakváltozás). Deploy még nem történt meg.
- **6.28.1 (UI-nit, user):** a header-dialog Delete gombja a Close mellől a sor **elejére** (Autosave elé) került, és piros bordered gombból **szürke ikon-link** lett (`text-slate-500`, hover underline, `size-3` ikon) — destruktív akció ne legyen a Close felé vezető kurzor útjában, és a kisebb találati felület csökkenti a véletlen kattintást.
- **6.28.2 (dark-mode, user):** az edit-mode MC-kijelölés nem látszott dark-ban. Ok: a kijelölő gyűrű `ring-slate-900`, és a slate-900 családból (bg/border/text) **egyedül a `ring-` nem volt átkötve** a `globals.css` dark-remap blokkjában → fekete gyűrű fekete cellán. Fix: `html.dark .ring-slate-900 { --tw-ring-color: var(--text-primary); }` a `border-slate-900` mellé (`@layer utilities`, így a Tailwind saját utility-jét felülírja). Ugyanez javítja a Creative Library tile-kijelölést és a library drop-target gyűrűket is.

### 2026-08-30 — Asset batch upload (drag-drop + táblázatos overlay) — 6.29.0
- **User-panasz gyökere:** a drop handler CSAK az `assets-library__scroll` konténeren volt (`useDropTarget`), az „Upload asset" modal viszont z-50 backdroppal letakarja → a modalra ejtett fájlt a böngésző default módon megnyitotta új tabon. Ezért „nem működött" ott, ahol próbálta.
- **(1) Globális drop-guard:** `AppShell` document-szintű `dragover`/`drop` → `preventDefault`. Igazi drop-targetek működnek tovább (a React handler előbb fut, a listener csak a defaultot öli). Ez az, ami eddig kiugratta az appból.
- **(2) `useUploadQueue` hook** kiemelve az `UploadQueue.tsx`-ből (state gép: upload → metadata → commit, + új `updateMetadata` és `applyToAll`). A lebegő panel (`UploadQueue` default export) változatlanul ezt használja → **Creative Library nem változott**.
- **(3) Új `assets/AssetUploadDialog.tsx`:** 90vw×90vh modal (header-dialog méretek), soronként thumbnail (objectURL, revoke unmountkor) + fájlnév/méret/státusz/warning, 4 metadata oszlop (brand/product/type/keywords), sticky fejlécben **batch-sor** ugyanezekkel a mezőkkel + Apply (Enter is) → `applyToAll` csak a nem-üres mezőket írja rá a még szerkeszthető sorokra. Product/type `datalist` a meglévő értékekből. A dialog maga is drop-target, üres állapotban nagy dropzone.
- **(4) AssetsLibrary:** az Upload gomb és a rácsra dobás UGYANOTT köt ki (`droppedFiles` state → `initialFiles`). A régi egyfájlos `UploadDialog` + `AssetMetadataForm` + `QueueItemForm` + a csak ezekhez használt `Field` törölve az assets oldalról (a `UploadDialog` komponens marad a Creative Library-nek).
- **Verifikáció:** `tsc` 0, `npm run build` 0, `npx vitest run` 585/585, eslint 0 error. Component-inventory új szekció (`asset-upload-dialog`, `asset-upload-table`).
- **Bump:** `6.28.2` → `6.29.0` (minor — új user-látható feltöltő felület).

### 2026-08-30 — TERV: Dimenzió-kulcs újragenerálás + kaszkád (topic/audience rekey)
**Kiváltó ok:** két nap alatt kétszer kellett kézzel rekulcsolni (topic 261 `…individual`→`…valtscsapatot`, topic 266 `…150e`→`…120e`). Az `updateTopic`/`updateAudience` MC-guardja (`topics.ts:228`, `audiences.ts:257`) NÉMÁN kihagyja a kulcs-regent, ha bármelyik MC hivatkozik a kulcsra → a tag4 elmozdul, a kulcs nem, a PMMID pedig beégve viszi a régi kulcsot. A guard helyes; a némaság a hiba.

- [x] 1. `src/lib/message-identity.ts` — tiszta fv: PMMID + 7 trafficking oszlop db-oszlop alakban (`regeneratedIdentity` / `traffickingColumns`). Nincs db-import → nincs ciklus (a `mc-refs.ts` precedens).
- [x] 2. `createMessage` átkötése a helperre (tsc + tesztek)
- [x] 3. `copyMessages` átkötése (tsc + tesztek)
- [x] 4. `moveMessages` átkötése (tsc + tesztek)
- [x] 5. `updateMessage` átkötése (csak trafficking, PMMID marad) (tsc + tesztek)
- [x] 6. `writeAudit` `silent` opció → a kaszkád soronként auditál, de EGY broadcastot küld
- [x] 7. `src/lib/entities/rekey.ts` — `previewRekey` + `rekeyDimension("topic"|"audience")`, tranzakcióban
- [x] 8. Stale-kulcs jelzés: `listTopics`/`listAudiences` → `generatedKey` + `keyStale`
- [x] 9. `makeRekeyRoute` az `entity-route.ts`-ben + `/api/{topics,audiences}/[id]/rekey`
- [x] 10. `HeaderDetailDialog` — a read-only Key mező mellé stale-badge + akció + preview (régi→új kulcs, érintett MC-szám, minta-PMMID előtte/utána)
- [x] 11. Integrációs teszt (rekey + no-op másodszorra + guard-elutasítás)
- [x] 12. component-inventory + CHANGELOG + verzióbump

**Lezárt döntések (user: „close along your intuition"):**
- **Audit:** soronkénti audit-bejegyzés (MC-history megmarad) + EGY összevont SSE broadcast (nem 120).
- **Nem automatikus:** a guard marad, az akció explicit — a drift láthatóvá tétele volt a hiányzó darab.
- **Árvákat nem javít:** csak létező dimenzió kulcsát írja át; a 641 árva MC külön ügy.
- **Guard = „elszállt-e már?", nem „ACTIVE-e?"** — a 120 db ACTIVE MC336 rekulcsolása biztonságos volt, mert semmi nem fogyasztotta még a PMMID-eket. Elutasít, ha a régi kulcs szerepel egy **feltöltött** feed exportban, vagy ha van rá monitoring sor.
- **Történelmet NEM ír át** (korrekció az első vázlathoz képest): a `monitoring` sorok a platform-riportból parse-olt tények, ahogy a `feed_exports.payload_json` is — ezért ezek nem átírandók, hanem a guard részei. A guard miatt a kérdés amúgy is majdnem tárgytalan: ha semmi nem szállt el, monitoring sor sem létezhet a kulcsra.
- **Kulcs-ütközés:** nem suffixel némán (`_2`), hanem elutasít.

**Eredmény (2026-08-30):**
- **Új:** `src/lib/message-identity.ts` (tiszta PMMID+trafficking builder), `src/lib/entities/rekey.ts` (preview + kaszkád), `makeRekeyRoute` + `/api/{topics,audiences}/[id]/rekey`, `KeyField` a header-dialogban, `tests/integration/api/rekey.test.ts` (11 teszt).
- **Refaktor:** a „PMMID először, utána trafficking (utm_cd26 = {{PMMID}})" blokk **5 helyen** volt kimásolva (`createMessage`, `copyMessages`, `moveMessages`, `updateMessage`, `propagateToSiblings`) — mind az öt a közös helperre kötve, egyesével, tesztfuttatással a lépések között. A `propagateToSiblings` az ötödik példány volt, a tervezéskor csak hármat számoltam.
- **UI-gap javítva menet közben:** a stale-badge a `committed`-ből olvasott volna, amit a PATCH-válasz (nyers sor, `generatedKey`/`keyStale` nélkül) felülír → pont a tag-szerkesztés pillanatában tűnt volna el a jelzés. Most a lista-alapú `entity` propból olvas.
- **Verifikáció:** `tsc --noEmit` 0, `npm run build` 0, `npx vitest run` **596/596** (585 → +11), eslint 0 error a módosított fájlokon (3 pre-existing warning a HeaderDetailDialogban, nem az új kódban). Böngészős smoke a userre vár.
- **Bump:** `6.29.0` → `6.30.0` (minor: új user-látható akció + 2 új HTTP route + list-válasz bővülés). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.
- **DEPLOYOLVA 6.30.0 (2026-08-30):** commit `4008914`, push origin main, box `/var/www/mm6-erste` git pull `4f98641`→`4008914` + `npm run build` (exit 0) + `pm2 restart mm6-erste` → **Ready 1477ms**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/topics` 401, **`GET /api/topics/[id]/rekey` 401** és **`POST /api/audiences/[id]/rekey` 401** (az új route-ok élnek, nem 404). Böngészős smoke (stale-badge + preview dialog) még hátravan.

- **6.30.1 (UI-nit, user):** a header-dialog Key mezője **teljes szélességű**, alatta ugyanabban a mono betűtípusban a **generált kulcs** — a kettő karakterről karakterre összevethető, amit a két féloszlopos elrendezés pont nehezített. Az „out of date" badge kikerült; helyette a pár alatt egy sor magyarázza, mit csinál a Regenerate, mellette link-stílusú gombbal. A **„MC count" mező törölve** (audience + topic form): ugyanaz a szám ott van a jobb felső MC-léptető mellett `n/n` alakban. A `mcCount`/`uniqueMcCount`/`totalMcCount` plumbing is kivezetve. A Regenerate gomb kikerült a `Field` `<label>`-jéből (label nem foghat interaktív elemet).
- **DEPLOYOLVA 6.30.1 (2026-08-30):** commit `aea4a66`, push origin main, box `/var/www/mm6-erste` git pull `4008914`→`aea4a66` + `npm run build` (exit 0) + `pm2 restart mm6-erste` → **Ready 1353ms**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/mcp` 401, `GET /api/topics/[id]/rekey` 401. Böngészős smoke (teljes szélességű Key + generált kulcs összevetése + Regenerate preview) a userre vár.

- **6.30.2 (UI-nit, user):** a „Generated key" mező **szürkén jelent meg amber helyett** — az ok nem a szándék, hanem a Tailwind: a `clsx(readOnlyCls, "…bg-amber-50…")` két AZONOS rétegbeli utilityt tett egymás mellé (`bg-slate-50` vs `bg-amber-50`), és ilyenkor a stíluslap sorrendje dönt, nem a class-attribútumé. Most saját, explicit osztálylistája van (nincs merge), a labelje is amber (`Field` új opcionális `labelCls` propja). A gomb felirata `Regenerate` → **`Regenerate dependencies`**, amber tónusban.
- **DEPLOYOLVA 6.30.2 (2026-08-30):** commit `def87db`, box `aea4a66`→`def87db`, build exit 0, `pm2 restart mm6-erste` → **Ready 1341ms**. Health: `/` 307, `/login` 200, `/mcp` 401.

---

## Session 2026-08-30 — MC337a → MC294 átszámozás + tartalom a régi VAL feedből (TERV)

Forrás: `docs/Erste_Vallalkozo_2026 (0508).xlsx` (régi Adform VAL feed, 179 sor: MC1 default 101, MC293 76, MC294 2).
Cél-sor a mátrixban: **id 35943** — DCO, `MC337a`, audience `VAL_microlp`, topic `VAL_brand_bankvaltas_NA_rem120e`, status `PREVIEW`, minden tartalmi mező üres (a user előkészített helye).

### Feladat 1 — átszámozás + tartalom-feltöltés (VÉGREHAJTÁS)
- [x] **1.1** `number` 337 → 294. Szabad a DCO tengelyen (294-et csak a nonDCO `ch_soc`/`ch_disp` páros tartja `VAL_Remarketing_Erstes-leszek_120e_rem` topicban — cross-axis párosítás 6.17.0 óta engedett).
- [x] **1.2** `pmmid` + trafficking ÚJRAGENERÁLÁS `regeneratedIdentity()`-vel (`message-identity.ts`) — az `updateMessage` szándékosan NEM nyúl a pmmidhez, a szám viszont benne van (`-m_337-`), és az `utm_term` (`...!hu!337a`) + `utm_cd26` + `final_trafficked_url` is.
- [x] **1.3** Tartalmi mezők a feed aktív (2026-os, ADFPLAID 14234692) sorából:
  - `template` = `html`, `template_variant_classes` = `animated purple fullSurfaceColor objectGfx`
  - `headline` = `Legyél erstés vállalkozóként is!` (PLAIN — v6-ban egyetlen üzenet sem tárol HTML-t a szövegmezőben)
  - `copy1` = `Tedd meg az első lépést még most!` (PLAIN)
  - `headline_style` = `font-size:1.15rem;`, `copy1_style` = `font-size:0.9rem;`
  - `cta` = `Érdekel!`
  - `landing_url` = `https://www.erstebank.hu/hu/ebh-business/kisvallalkozasok/szamlak-napi-penzugyek/bankvaltas`
  - assets a `patterns.feed` map szerint (`image1`→bg1, `image2`→bg2, `image5`→brand, `image6`→sticker): `empty.png` / `erste_vallalkozo_object.png` / `EBH_Logo_screen_white.png` / `empty.png`, `image3` = `empty.png` (MC23/MC108 objectGfx konvenció), `video1` üres.
- [x] **1.4** A feed HTML-formázása NEM a mezőbe megy, hanem 2 `text_formatting` szabályba (exact-match, universal scope):
  - `Legyél erstés vállalkozóként is!` → `Legyél erstés<br> vállalkozóként is!`
  - `Tedd meg az első lépést még most!` → `Tedd meg az első <span style=white-space:nowrap>lépést még most!</span>`
- **NEM nyúlok hozzá:** `status` (marad PREVIEW), `start_date`/`end_date` (a régi feed 2025-02-02→2026-12-31 flight-dátuma lifecycle-állapot, nem tartalom), `name`, `audience`, `topic`.
- ⚠️ **Hiányzó asset:** `erste_vallalkozo_object` nincs az `uploaded_files`/`assets` táblában egyik kliensnél sem, és a lokális `~/ERSTE .../assets` mappában sincs. A `.png` kiterjesztés a többi `*_object.png` konvencióból következtetve. A feed-export így a helyes stringet adja, de az in-app preview addig nem oldja fel, amíg a fájl nincs feltöltve a media libarybe.

### Feladat 2 — audience-elemzés (CSAK ELEMZÉS, nincs írás)
- [x] **2.1** Régi feed MC294 audience-ei vs. mátrix VAL audience-ek — lásd lent.

**Módszer:** a pmmid `-a_...-` szegmens nem elég (a feed két névgeneráció keveréke: az MC1 default sor már az ÚJ `VAL_*` kulcsokat használja, az MC293/294 még a régi Adform-neveket). Megbízható join: **`AdformSignal:ADFPLAID` ↔ `audiences.lineitem_id`**.

**Eredmény — MC294 = 1 audience:**
| régi név | ADFPLAID | IsActive | DateFrom→DateTo | mátrix audience |
|---|---|---|---|---|
| `afwesegall` | 14234692 | TRUE | 2025-02-02 → 2026-12-31 | ✅ `VAL_microlp` — Landing Page Visitors (rem / websiteEvent / segment / all), **ACTIVE** |
| `afwesegall` | 12994656 | FALSE | 2025-02-02 → 2026-12-31 | ❌ nincs — ez a 2025-ös kampány (`mID25-00101`) line itemje, ugyanaz az audience, leváltva a 2026-osra (`mID26-00016`) |

- A 2 feedsor tehát **ugyanaz az egy audience**, csak két kampányévvel. Élő audience-szám: **1**.
- Ez pontosan az az audience, amire a user a helyet (MC337a) előkészítette → a placement stimmel, nincs mit pótolni.
- **Kontroll (MC293, a prospecting kártya): 19/19 audience megvan** a mátrixban (`afadwlall`→`VAL_adaptive`, `afafwldtfindsk`→`VAL_wlfin-findsk`, `afdgsegallincome`→`VAL_wldigiseg-income` stb.), 0 hiányzó. Az audience-migráció tehát teljes volt — a régi feedben nincs olyan VAL audience, ami kimaradt.
- **Struktúra:** MC293 (19 pro audience) és MC294 (1 rem audience) diszjunkt — `VAL_microlp` NEM szerepel MC293-ban. MC294 a VAL termék **egyetlen remarketing kreatívja** volt, és a `VAL_microlp` az egyetlen ACTIVE `rem`-stratégiájú VAL audience (a `VAL_microtarasaslp` INACTIVE, nincs line itemje).

### Végrehajtva
Egyszeri script (`scripts/renumber-337-to-294.ts`, dry-run → `--commit`, futás után törölve — nem újrahasznosítható művelet). Utána `version` 3→4 kézzel (az optimistic lockot a direkt UPDATE nem emelte volna, egy nyitott böngészőfül elavult verzióval felülírhatta volna).

**Eredmény (id 35943):** `MC294a` · `VAL_microlp` · `VAL_brand_bankvaltas_NA_rem120e` · PREVIEW · `html` + `animated purple fullSurfaceColor objectGfx` · pmmid `p_adform-s_rem-a_VAL_microlp-m_294-t_VAL_brand_bankvaltas_NA_rem120e-v_a-n_1` · utm_term `con!adform!VAL_microlp!...!hu!294a`. 2 új `text_formatting` szabály (id 228, 229).

**Nyitott:** `erste_vallalkozo_object.png` fel kell tölteni a media libarybe (a mezőben már benne a hivatkozás, a feed-export helyes stringet ad, de a preview addig nem oldja fel). Nincs kódváltozás → nincs verzió-bump.

### 2026-08-30 — Státusz-darabszám a szűrőben (D1) + tree platform-szín (I3) — 6.31.0
- **Előzmény:** a user négy ötletet adott (dashboard-felújítás, komment-thread, tree platform-színek, státusz-darabszám). Mind a négy felmérve (kód + prod DB), a döntések lezárva, a tervek a **💡 Ötlet-inbox** szekcióban. A user a két kicsit engedte el elsőnek.
- **D1 ✅ — státusz-darabszám a Status-szűrőben.** `MultiPill` új opcionális `optionCounts` propja (`ml-auto text-xs tabular-nums text-slate-400`, `multi-pill__count`) — az `optionColors` színpötty mellé, ugyanabba az opció-sorba. A `MatrixGrid` `filtered` useMemója számolja és adja tovább a toolbaron át.
  - **A számolás helye a lényeg:** a státusz-szűrőt **átmozgattam a search-szűrő MÖGÉ**, és a darabszámot a kettő közt veszem — minden más szűrő (product, axis, hide-inactive, search) érvényes, a státusz-szűrő még nem. Utána számolva minden kiválasztott státusz csak önmagát számolná, a kiválasztatlanok meg mind 0-t mutatnának. A státusz és a search független sor-predikátumok, ezért a sorrendcsere azonos `msgs` halmazt ad — a viselkedés nem változik.
  - A `DimensionGrid` Status-pillje nem ad `optionCounts`-ot → ott nincs szám (a prop opcionális).
- **I3 ✅ — tree-node színezés platform szerint** (user-döntés: platform, „mert az a kisebb egység"; **csak szín, strategy-vastagság nem**).
  - `buildTree`: az `AggNode` gyűjti a node alatti distinct `buyingPlatform`-okat; a `TreeNode` **csak akkor** kap `platform`-ot, ha pontosan egy van. Kevert vagy platform nélküli részfa → nincs mező, a node marad a mélység-színénél — így a „nincs szín" sosem olvasódik platformnak.
  - `TreeView`: pontosan EGYIK osztályt adja rá (`--plat-*` VAGY `--lvl-*`), nem kettőt egymásra — nincs specificitás-játék, a `border-left` shorthand tisztán felülíródik.
  - **Szín-forrás egy helyre:** a két hex kétszer szerepelt a `globals.css`-ben (alsó- és jobb-él variáns), a platform→szín elágazás pedig be volt drótozva a `GridView`-ba. Most a **`--plat-dv360` / `--plat-adform` CSS-változó** az egyetlen hely, ahol a szín él, és **`matrix/types.ts` `PLATFORM_TOKENS`** az egyetlen hely, ahol az dől el, melyik platform-string kap színt. A `platformToken()` trimmel + kisbetűsít (a `buyingPlatform` szabad szöveges mező) — ez szigorú bővítés, a mátrix-header vizuálisan nem változott.
  - **Adat-tény:** a prod DB-ben ma **csak két** platform-érték él (adform 105, dv360 68, null 7) — youtube/meta nincs. Ezért a Settings-szintű szín-szerkesztés kimaradt: új platform ma **egy sor** a `PLATFORM_TOKENS`-ben + egy var. Ha tényleg állítgatni kell, az külön slice (új oszlop + migráció).
  - Menet közben javítva egy **elavult CSS-komment**: a tree-blokk egy `LEVEL_COLORS` tömbre hivatkozott a `TreeView.tsx`-ben, ami nem létezik (a MiniMap saját flat `nodeColor`-t fest).
- **Verifikáció:** `tsc --noEmit` 0, `npm run build` 0, `npx vitest run` **599/599** (596 → +3 új `build-tree` teszt: egységes platform öröklődik felfelé; kevert részfa nem kap platformot, de az alatta lévő egységes node igen; platform nélküli fa érintetlen), eslint 0 error a módosított fájlokon. **Böngészős smoke a userre vár** (tree platform-csíkok + státusz-számok).
- **Bump:** `6.30.2` → `6.31.0` (minor — két user-látható feature). CHANGELOG + component-inventory frissítve. Nincs séma-migráció.
- **⚠️ Menet közben:** a HEAD elmozdult (`def87db`, 6.30.2 a userre) — a `-42` sor a todo.md diffben a saját, commitolatlan v1 ötlet-blokkom lecserélése v2-re, nem elveszett tartalom.

### 2026-08-30 — MC335→398, MC336→399 renumber (DCO tengely) — adatjavítás
**Kérés:** a DCO kampány-kártyák MC335/MC336 száma ütközik az azonos számú analóg (nonDCO) MARKET témákkal; írjuk át őket. Első javaslat 340/341 volt, de azok a nonDCO tengelyen foglaltak (MARKET_GoApp 340c, SZA_Szamlanyitas 341a) → user döntés: **398 / 399** (a kliens max MC-je 397, tehát mindkét tengelyen szabad).

**Scope (user által megerősítve):** csak a **DCO** oldal mozdul.
- `SZA_beerste_bankvaltas_NA_valtscsapatot` MC335 a–i, 216 sor (ACTIVE, a c variáns INACTIVE) → **MC398**
- `VAL_beerste_bankvaltas_NA_valtscsapatot120e` MC336 a–f, 120 sor (ACTIVE) → **MC399**
- Az analóg `MARKET_MCx_f_genZbefektetes_2026Q1` (335) és `MARKET_MCx_genZbefektetes_2026Q1` (336) **marad**.

- [x] 1. `scripts/renumber-mc-dco.ts` — dry-run alapértelmezett, `--commit` ír
- [x] 2. Blokkoló-ellenőrzés futás közben: cél-szám foglaltság a DCO tengelyen, feltöltött feed export, monitoring sor
- [x] 3. Dry-run + PMMID before/after minta bemutatása
- [x] 4. `--commit` egy tranzakcióban: `number` + `pmmid` + 7 trafficking oszlop + `version+1` + audit sor MC-nként
- [x] 5. Utóellenőrzés SQL-lel, script törlése (egyszeri művelet)

**Előzetesen ellenőrzött tények:** `monitoring` 0 sor a 335/336-ra; `prodlist_rows` 0 sor; a `creatives` 32 rekordja mind az *analóg* MARKET fájlokhoz tartozik (`ERSTE_MARKET_MC335_a_...`), a DCO kártyákhoz egy sem → creative-link nem szakad el (sőt, a mai téves (mc_number,mc_variant) egyezés megszűnik). 3 feed export (SZA v1, v1, v2) tartalmaz `-m_335-`-öt, de **egyik sincs Adformra feltöltve** → nem blokkoló; a payloadot nem írjuk át (shipped-history invariáns), a következő exportnál újragenerálódik.

### Végrehajtva
Egyszeri script (`scripts/renumber-mc-dco.ts`, dry-run → `--commit`, futás után törölve — a `renumber-337-to-294.ts` precedensét követve). A `number` szándékosan nem writable mező (`WRITABLE_FIELDS`), ezért nincs támogatott app-útvonal; a script a `entities/rekey.ts` mintáját másolja: ugyanazok a blokkoló-ellenőrzések, ugyanaz a „regeneráld az identitást, de a leszállított history-t soha ne írd át" szabály, MC-nként audit sor.

**Kulcs-kontroll a commit előtt:** mind a 336 sorra lefuttattam a `regeneratedIdentity`-t **változatlan** számmal, és a 8 generált oszlop (`pmmid` + 7 trafficking) **bitre azonosan** reprodukálódott a tároltakkal. Tehát nem volt előzetes pattern-sodródás, amit a javítás csendben behúzott volna — a commit tényleg csak a számot és a belőle képzett részstringeket írta át.

**Eredmény:** 336 sor. `MC335 → MC398` (SZA_beerste_bankvaltas, a–i, 216 sor), `MC336 → MC399` (VAL_beerste_bankvaltas120e, a–f, 120 sor). Pl. `p_adform-s_pro-a_SZA_adaptive_IDF-m_398-t_SZA_beerste_bankvaltas_NA_valtscsapatot-v_a-n_1`, utm_term `...!hu!398a`. 336 audit sor, `version` mindenhol +1. Utóellenőrzés: 0 maradék `m_335`/`m_336` a mozgatott sorok generált oszlopaiban; a 335/336 mostantól kizárólag az analóg MARKET témáké. Adat-only javítás, nincs kódváltozás → **nincs verzió-bump**.

**⚠️ Nyitott — még 20 szám ütközik keresztbe a két tengelyen**, köztük a szomszédos `332` (SZK_emlkezteto ↔ SZK_remarketing) és `334` (SZK_edukacio ↔ MARKET_MCx_e_genZbefektetes), valamint 5, 124, 131, 134, 141, 290, 294, 301, 302, 311, 316–321, 330, 331. A tengelyenkénti számozás ezt megengedi (a DCO kártya és a statikus nonDCO ikre szándékosan oszthat számot), de ha a cél a globálisan egyedi MC-szám, ez külön kör. A `MARKET_MCx_*_genZbefektetes` sorozat amúgy is szét van szórva: b=396, c=397, d=333, e=334, f=335, alap=336.

### 2026-08-30 — MC-ütközés riport (`docs/mc-collisions.html`)
**Kérés:** gyűjtsük ki az ütközéseket egy statikus HTML-be a `/docs`-ba, a DCO bannereket statikban megépítve, képekkel, 3 oszlopos táblázatban, az ütközés természetének magyarázatával.

- [x] `scripts/gen-collisions-doc.ts` — **megtartva** (a `renumber-*` scriptektől eltérően ez csak olvas: újrafuttatható riport-generátor, ahogy az ütközések fogynak). Dev szerver kell hozzá.
- [x] 20 DCO banner renderelve az app saját pipeline-jával (`shootItems` → `templates/html`, 300×250, headless Chromium) — nem külön reimplementáció, ugyanaz a kód fut, mint a preview-knál. **A `message_previews` táblához nem nyúl**, a PNG-t a saját `persist` callback kapja el.
- [x] Statikus kreatívok az objektumtárból (`readFileBytes`), `sips`-szel 440px-re kicsinyítve; minden kép **data URI-ként beágyazva** → a 2.6 MB-os fájl hálózat nélkül is megnyílik.
- [x] Böngészős ellenőrzés (Playwright screenshot, 1440px).

**Az ütközések természete — 3 kategória, nem egy:**
- **Szándékos ikerpár (18)** — ugyanaz a kampány két formában; a DCO kártya és a statikus kivágata. A közös szám itt *helyes*, a tengelyenkénti számozás pont ezt engedi meg. A 316–320-nál a kötés a legszorosabb: a DCO háttér maga a statikus precompja (`precomp_ERSTE_MC316_a_..._n7.png`, `preCompBg`).
- **Valódi ütközés (3)** — két nem összetartozó kampány: **MC5** (VAL Társasházi Számlacsomag ↔ HITEL Babaváró), **MC302** (SZK bankváltás ↔ SZA online számlanyitás — itt *mellette* van egy szabályos iker is), **MC334** (SZK kamatkedvezmény ↔ MARKET genZbefektetes). Ez ugyanaz az eset, mint a ma javított 335/336.
- **nonDCO duplikáció (2)** — **MC290** és **MC321**: ugyanaz a statikus kreatív kétszer importálva, két téma alatt (`HITEL_*` és `SZK_HITEL_a_*`). Ez nem tengelyek közti ütközés, hanem kétszeres import; érdemes a kettőt együtt rendezni.

**Menet közbeni észrevétel:** a **DCO MC332c** a vizsgálatkor a 332a szó szerinti klónja volt (ugyanaz a headline, flash, class, sőt a 332**a** háttérképe), miközben a valódi 332c más felépítésű kreatív (teal színfelület + kivágott objektum, „Akár 15M Ft kölcsön nagyobb terveidhez is."). **A user ezt közben maga javította az appban** (16:02 UTC) — a riport már a javított állapotot tükrözi. Nem én írtam.

**Nincs verzió-bump:** új doksi + egy `scripts/` riport-generátor, a futó appot nem érinti.

### 2026-08-30 — Társasház DCO kártya: MC5 → MC78
**Kérés:** a DCO MC5 (VAL Társasházi Számlacsomag) kapjon új számot, mert a HITEL Babaváró statikussal ütközött. Első kör: „keressünk lukat 100 alatt" → MC10. Utána user-korrekció: **MC78**, mert a kártya eredetileg is a meglévő statikus `ERSTE_VAL_MC78_b_Tarsashaz_szamla_pro_b` DCO párja akart lenni, csak sosem készült el.

- **Végrehajtva:** `scripts/renumber-mc-dco.ts` (újra megírva és **most megtartva** — másodszor kellett; a `MAP=from:to` env paraméterezi). 5→10, majd 10→78; mindkettő 3 sor (a,b,c variáns, `VAL_wldigiseg-realestate`, INCOMING). Blokkoló egyik lépésnél sem volt.
- **Kontroll:** az 5→10 után diffeltem a 8 generált oszlopot úgy, hogy a régi számot előbb kicseréltem az újra — **identikus**, tehát csak a szám és a belőle képzett részstringek mozdultak.
- **Eredmény:** MC5 mostantól kizárólag a HITEL Babaváró statikusé. MC78 = szándékos ikerpár: DCO a/b/c (`VAL_feature_tarsashaz_szamlacsomag_`) + a meglévő statikus b (`VAL_Tarsashaz_szamla_pro_b`, 4 creative fájl). MC10 újra szabad.
- **Mellékhatás, ami jó:** a 6 HITEL Babaváró creative (`mc_number=5, mc_variant=c`) eddig tévesen egyezett a DCO MC5c cellával — ez megszűnt.
- **Számtér-tény 100 alatt:** csak **10, 11, 12** volt teljesen szabad (mindkét tengelyen). Minden más 100 alatti „szabad" szám csak a DCO tengelyen szabad — azokra átírni új keresztirányú ütközést csinálna.

### 2026-08-30 — MC302: megvizsgálva, NEM írjuk át (blokkolt)
**Kérés:** a DCO MC302 mehetne-e valamilyen 300-as sorozatú számra.

**Van luk** a 300-as tartományban: **300, 312, 353** teljesen szabad. **De a DCO MC302-t nem szabad átírni** — a script blokkolja, jogosan:
- **Feed export #8 (SZK, v0) 2026-05-03-án fel lett töltve Adformra**, és tartalmazza a DCO 302 pmmid-jét → az átírás hazuggá tenné a leszállított feedet.
- **540 monitoring sor** ül a 302-n, ebből **529 pontosan a DCO témára** (`SZK_felhaszcelja_..._bankvaltasAdossagrendezes`, b: 273, c: 256) — valós beérkezett riportadat, ami árván maradna.

**A fontosabb felismerés: nem a DCO oldal a hibás.** A 302-n a **nonDCO tengelyen két külön téma** ül — `SZK_bankvalats_hitel` (a,b,c, 6 sor, a DCO kártya szabályos statikus ikre) és `SZA_onlineszamla_2026Q1_fullImageSurface` (a–e, 10 sor, a betolakodó). Egy tengelyen belül egy szám **soha nem léphet át témát** — a rendszer saját szabálya sérül itt, nem a DCO↔nonDCO ikerpár a baj.

**Javaslat (user döntésére vár):** az `SZA_onlineszamla_2026Q1_fullImageSurface` menjen új számra (10 sor, 11 monitoring sor a `onlineszamla_q2` témán, + 56 SZA-nevű creative `mc_number`-ét vinni kell vele), ne a 91 soros, leszállított DCO kártya. Ehhez **nonDCO-tengelyes renumber kell** — a mostani script csak a DCO tengelyt kezeli, és a `creatives.mc_number` átírását sem csinálja. A rokon SZA online számla kártyák: 296, 368–372, 375 — nincs szoros szomszédsági kényszer.

**Döntés (user, 2026-08-30):** az MC302 **marad** — „két külön productban van, nem baj, és a DCO része már inaktív". Helyette magyarázó komment került mind a **107** MC302 sorra (mindkét tengely: 91 DCO + 6 SZK statikus iker + 10 SZA online számla):

> Átálláskor keletkezett azonos MC: a 302 két különböző productban fut — SZK bankváltás/adósságrendezés (DCO, INACTIVE, + statikus ikre) és SZA online számla (statikus). Szándékos, nem javítandó. Átírni amúgy sem lehetne: a v0 SZK feed 2026-05-03-án felment Adformra, és 529 monitoring sor hivatkozik rá.

- Egyszeri script (`scripts/_set-mc302-comment.ts`, dry-run → `--commit`, futás után törölve). **Csak a `comment` mezőt írja** — a komment egyetlen patternbe sem folyik bele (a pmmid/trafficking az audience/topic/number/variant/versionNo/landingUrl-ből épül), így a 107 élő sor UTM-oszlopait nem bolygattuk meg fölöslegesen. Ellenőrizve: mind a 107 pmmid változatlanul `-m_302-`.
- A `version` viszont **emelve** (1→2), hogy egy nyitott szerkesztőfül elavult verzióval ne írhassa felül a kommentet.
- A script visszautasítja a futást, ha bármelyik soron már van komment (appendelés emberi döntés) — most mind a 107 üres volt.
- `docs/mc-collisions.html` frissítve: a 302 sora most rögzíti, hogy megvizsgált és **elfogadott** eset, a blokkoló okokkal együtt.

### 2026-08-30 — MC334 (genZ „e" statikus) → MC312, fájlnevekkel együtt
**Kérés:** az utolsó tengely-ütközés (334: DCO `SZK_edukacio_NA_NA_kamatkedvezmeny` ↔ nonDCO `MARKET_MCx_e_genZbefektetes_2026Q1`) feloldása; új szám a 300-as tartományból, és a fájlnév átírása a DB-ben **és** a Drive-on (`~/GoogleDrive/Data/ERSTE HU/MARKET/Future befektetés - GenZ`) — leadás fájlok + source PSD.

**Választott szám: MC312** (300, 312, 353 volt a három teljesen szabad a 300-as tartományban).

- **DB:** 2 `messages` (number + name + image1 + pmmid/trafficking regenerálva), 7 `creatives` (mc_number + file_name), 7 `uploaded_files` (filename + original_filename). Az objektumtárhoz **nem** nyúltunk — a storage key content-hash, a fájlnév csak metaadat.
- **Drive:** 7 leadás fájl + a source PSD átnevezve.
- **Második kör (user):** a fájlnevekből ki az `_a_MCx` rész → `ERSTE_MARKET_MC312_e_genZbefektetes_2026Q1_n1_<méret>.jpg`. Mind a 7 név egyedi marad (a méret különbözteti meg). Ugyanez a DB-ben, **csak az MC312-es szettre szűkítve** (az első lekérdezésem az egész genZ sorozatot elkapta volna — 42 fájlt 7 helyett).
- **PSD (user-döntés):** `ERSTE_MARKET_e_...psd` → `ERSTE_MARKET_MC312_e_genZbefektetes_2026Q1_fullImageSurface.psd`. A genZ PSD-kben eredetileg **nem volt** MC-szám (a `vagyonkezelés` mappában van, a `BefCast`/`Go`-ban üres `MC_` placeholder — nincs egységes konvenció).

**⚠️ Következmény, amit tudni kell:** a fájlnév-séma `ERSTE_<PRODUCT>_MC<n>_<variáns>_<kampány>_n<k>_<méret>`. Az `_a_` törlésével a **sorozat-betű (`e`) csúszott a variáns-helyre**, miközben a DB-ben a `variant`/`mc_variant` továbbra is **`a`**. A creative↔cella kötés az oszlopokból dolgozik, nem a fájlnévből, tehát ma jól működik — de a `scripts/scan-creatives.ts` a **fájlnévből** parse-olja a variánst, így egy újraszkennelés `e`-t vezetne le és nem találna rá az `a` sorra. Ha ez a szándékolt végállapot, a `variant`/`mc_variant` oszlopot is `e`-re kell vinni.

**Új lelet a riportban:** a `creatives` táblában egy `(mc_number, mc_variant)` páron **két különböző kampány** fájljai is ülhetnek — a Drive két külön mappájából (`Future befektetés - GenZ` vs `vagyonkezelés`, `BefCast` vs `3D_icon`/`agrarcsalad`). Ez nem tengely-ütközés, hanem creative-szintű átfedés; külön szekciót kapott a riportban. Az első, naiv detektálásom 28 sort dobott, aminek a nagy része hamis (`..._badge`, `...-promo-2`, `..._fullImageSurface` ugyanannak a kampánynak a névváltozatai) — szigorítva: a rendition-jelölő tokenek (`creative`, `asset`, `image`, `only`) kiesnek, és két kampány csak akkor számít külön kampánynak, ha egyik token-halmaza sem tartalmazza a másikat és az első tokenjük is eltér. Így **24 jelölt** maradt, és a riport kimondja, hogy ez **jelöltlista, nem ítélet**. A szemmel is egyértelmű valódi esetek: `BeErste3`↔`WIZZAIR` (MC287), `diakszamla`↔`munkashitel` (MC288, MC289), `genZbefektetes`↔`tengeri_hajozas`/`jazz_piknik` (MC333, MC335), `MCx_BefCast`↔`3D_icon`/`agrarcsalad` (MC337, MC338).

### 2026-08-30 — MARKET konszolidáció: genZ → MC312 a–f, BefCast → MC300 a,b
**Előzmény:** a PSD-nevek árulkodóak — a `vagyonkezelés` mappa PSD-iben **van** MC-szám (`ERSTE_MARKET_MC333_a_tengeri_hajozas_n1.psd`), a `BefCast` és a genZ PSD-kben **nincs** (`ERSTE_MARKET_MC_a_BefCast…`, `ERSTE_MARKET_a_genZ…`). Vagyis a vagyonkezelés az eredeti tulajdonos, a másik kettő betolakodó. **User-döntés:** egy kampány = egy MC-szám, a renderek variánsok.

- **genZ:** 336a→**312a**, 396a→312b, 397a→312c, 333a→312d, 312a→312e, 335a→312f. Közös téma: `MARKET_genZbefektetes_2026Q1`.
- **BefCast:** 338a→**300a**, 337a→300b. Közös téma: `MARKET_BefCast_2026Q2`.
- **Érintetlen** (a vagyonkezelés visszakapta a számait): 333b tengeri_hajozas, 335b jazz_piknik, 337b 3D_icon, 338b buzakalasz, 338c agrarvallakozo.
- **Volumen:** 16 message (szám + variáns + téma + name/image1 + pmmid/trafficking), 60 creative, 60 uploaded_file, 60 Drive-fájl, 7 PSD.
- **Nem hoztam létre `topics` sorokat:** a nonDCO témák 230-ból 226 esetben amúgy sem léteznek sorként, csak string-hivatkozások — sorok gyártása itt lenne a kilógó eset.
- Minden `creatives`/`uploaded_files` egyezés **fájlnév-prefix** szerint szűrve, sosem puszta `mc_number` alapján — különben a vagyonkezelés fájljai is elmozdultak volna ugyanarról a számról.

**⚠️ Saját hiba, javítva:** a Drive-átnevező bash függvényemben egyetlen sorban írtam `local b="${f##*/}" t="…${b#$op}"` — zsh-ban `b` a `t` kiértékelésekor még az **előző iteráció** értékét tartja, így az első fájl neve a puszta prefixre csonkolt, a többi pedig eggyel eltolódott. Nem veszett el fájl (42 + 18 megvan). Helyreállítás **tartalom-hash alapján** (`uploaded_files.sha256`), két menetben (előbb ideiglenes névre, hogy az ütközések feloldódjanak) → **60/60 fájl neve egyezik a DB-vel**. A PSD-k (nincs hash a DB-ben) a csonkolt névben megőrzött betűjel alapján álltak helyre. Tanulság: külön sorban deklaráld a köztes változót, és a rename után **mindig** auditálj.

**⚠️ Nyitott:** a helyben maradt vagyonkezelés-sorok témája még a régi, félrevezető nevet viseli (MC333b `tengeri_hajozas` a `MARKET_MCx_d_genZbefektetes_2026Q1` témában, MC337b/338b/338c a `MARKET_MCx_*BefCast` témákban). A user azt kérte, ezek maradjanak — a **számuk** maradt is, de a téma-nevük külön kört érdemel.

### Riport-átépítés
- **4 fül** a tetején: Szándékos ikerpár (19) · Valódi ütközés (1) · nonDCO duplikáció (2) · Creative-átfedés (20). Sima JS, panel-váltás `hidden`-nel. Egy sor több fülön is megjelenhet (a 302 ikerpár **és** ütközés).
- **A creative-átfedés szekció most képes:** kampányonként egy reprezentatív kreatív (a négyzetes 1080x1080-at preferálva) az objektumtárból, 260px-re kicsinyítve, data URI-ként beágyazva. Így ránézésre látszik az ütközés — pl. MC159-nél két Személyi kölcsön kreatív mellett egy **Erste Max Hitelkártya**.
- A riport 4,4 MB, továbbra is önálló fájl.

### 2026-08-30 — Feed export: DEFAULT sor label-javítás + clickTAG DEFAULT-osítás (6.32.0)
- **Tünet:** feed 35 (SZA) DEFAULT sorában a `Text:pmmid` és a `ReportingLabel` megtartotta a valódi audience key-t (`-a_SZA_rtg-allvisitors_IDF-`), nem lett `-a_DEFAULT-`. Feed 30-ban ugyanaz a termék még jól működött.
- **Gyökérok:** `feed-export.ts` → `applyDefaultLabelTransforms` regexe `/(-a_)[^-]*(-m_)/` volt. A `[^-]*` nem tud átlépni az audience key-ben lévő kötőjelen (`SZA_rtg-allvisitors_IDF`), így a csere némán nem talált. A `-l_\d+ → -l_ANY` csere közben lefutott, ezért tűnt úgy, hogy „félig" működik. A 30-as export default üzenetének audience key-e (`SZA_afrtsegallvisitors`) kötőjel nélküli volt.
- **Fix:** lusta illesztés `/(-a_).*?(-m_)/` — ugyanaz a minta, amit az `adform-snapshot.ts` már használ (`/-a_(.+?)-m_/`).
- **Teszt:** `tests/unit/feed-default-labels.test.ts` — 7 eset (label: sima key / kötőjeles key / `-l_` szuffix; URL: utm_cd26, utm_term, érintetlen utm_campaign+utm_source, nem-egyező key = no-op).
- **clickTAG is átírva (user-döntés, új viselkedés):** a DEFAULT sor trafficking URL-jében eddig — a v5-ben és az élő Adform fájlban is — a donor audience key ült, így egy fallback-kattintás az analyticsben megkülönböztethetetlen volt a donor saját sorára érkező kattintástól. Mostantól két helyen DEFAULT: az `utm_cd26` PMMID-jében (`-a_<key>-m_`) és az `utm_term` önálló tokenjében. **Szándékosan érintetlen:** `utm_campaign` / `utm_source`, mert azok `audiences[<key>].Field` lookupok — nincs DEFAULT nevű audience sor, átírva üres paraméterek mennének ki.
- Kis/nagybetű: mindenhol nagybetűs `DEFAULT` — az `adform-snapshot.ts:105` pont erre a stringre szűri ki a sentinel audience-t visszaimportáláskor.

**DEPLOYOLVA 6.32.0 (2026-08-30):** két commit ment ki egy passzban — `2aab359` (a commitolatlanul állt 6.31.0: status-filter countok, tree platform-színek, `--plat-*` tokenek, + a MARKET-session két one-off scriptje) és `36cf83c` (ez a feed-fix). Box `def87db`→`36cf83c`, `npm run build` exit 0, `pm2 restart mm6-erste` → **Ready 1470ms**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401; publikus `https://erste.messagingmatrix.ai/login` 200.
**Hátravan:** a feed 35 (SZA) újraexportálása — a most kint lévő sor mindkét hibát viszi (donor audience key a pmmidben/ReportingLabelben és a clickTAG-ben).

### Riport-bővítés — DCO kereszthivatkozások + dokumentáció
- **A creative-átfedés kártyák mellé jobbra zárt referencia-blokk** került, két kérdésre válaszolva: (1) *van-e DCO kártya ezen a számon* — tiszta DB-lekérdezés; (2) *a képen olvasható szöveg alapján melyik DCO MC-nek ugyanez a headline-ja*.
- **OCR:** a generátor lefordít egy pici Swift programot (`OCR_SWIFT` → `swiftc` → temp), ami az Apple **Vision** `VNRecognizeTextRequest`-jét használja (`hu-HU` + `en-US`), és az **eredeti méretű** kreatívokon fut. Nem kellett külső függőség — se tesseract, se Python csomag.
- **Normalizálás:** NFD + ékezet-eldobás + kisbetű + nem-alfanumerikus → szóköz. A felismerő rendszeresen elhagyja az ékezetet („almaid"), ékezet-érzékeny összevetés semmit nem találna.
- **Küszöb, ami nélkül használhatatlan:** headline csak akkor vesz részt, ha normalizálva ≥20 karakter **és** ≥4 szó. Enélkül a „Személyi Kölcsön" a fél SZK termékvonalra illeszkedett — **946 találat** jött ki; a küszöbökkel **60**. Kártyánként max 6 tétel látszik, a többi „+N további".
- **Valódi leletek:** az MC171 statikus (`gamertech`) szövege a DCO **MC271**-re illeszkedik; az MC287 (`BeErste3` + `WIZZAIR`) szövege a ma átszámozott **MC398**-ra („Válts csapatot, legyél erstés!", ACTIVE). A „szám szerinti" oszlop többnyire üres — a 8 átfedő számból 6 nonDCO-only, csak a 301/302 érinti a DCO oldalt.
- **`docs/mc-collisions.md`** — kísérő dokumentáció a riport mellé: újrafuttatás egy paranccsal, mit tekint ütközésnek (tengely-definíció, a három `NOTES`-kategória, a creative-átfedés heurisztikája a rendition-szűrővel), hogyan működik az OCR-es kereszthivatkozás a küszöbökkel, honnan jönnek a képek, gyorsítótár, és a már megfizetett buktatók (fájlnév-prefix szerinti szűrés, Drive-rename audit, nonDCO témák nem `topics` sorok).
- **Feljegyezve a jövőre:** a fájlnév `ERSTE_<PRODUCT>_` prefixe erősebb jel a kampány-tokennél — ha két külön termék fájljai ülnek egy számon, az biztos találat. A generátor ma nem használja szűrésre; ez a következő szigorítás helye.

### Product tag a creative-átfedés kártyákon
Minden kampány-thumbnail alatt, a fájlszámláló sor **bal oldalán** termék-címke (`SZK` `SZA` `HK` `HITEL` `VAL` `MARKET` `LTP`), a fájlnév `ERSTE_<PRODUCT>_` prefixéből — vagyis abból, amihez az adott MC ténylegesen parse-olódik. Termékenként saját szín; ismeretlen termék semleges szürkét kap (nincs `.product-tag--*` osztály → a `.product-tag` alap háttere marad), tehát új termék nem töri el a riportot. 62 címke a 20 kártyán.

Ettől egy pillantásra látszik a kemény eset: **MC287** = `SZA` + `HK`, **MC302** = `SZA` + `SZK`. A `docs/mc-collisions.md` frissítve — a korábbi „ezt a generátor nem mutatja" megjegyzés helyére pontos leírás került: a termék **látszik**, de a jelöltlistát továbbra is a kampány-token heurisztika állítja elő, a termék-alapú szigorítás a következő lépés.

### 2026-08-31 — nonDCO státuszok kiosztása
**Kérés:** minden nonDCO (statikus) kreatív kapjon státuszt — idei dátumúak `ACTIVE`, régebbiek `INACTIVE`, ne maradjon státusz nélküli.

- **A dátum forrása a lényeg:** `creatives.created_at` (amit a `scripts/fix-creative-dates.ts` a valódi fájldátumból töltött fel), **nem** a `messages.created_at` — az utóbbi az egységes 2026-08-17-i import-időbélyeg, azzal minden sor ACTIVE lett volna. Ellenőrizve: a legkésőbbi kreatív-dátum 2026-08-13, tehát nincs import-szennyeződés.
- **A join fájlnév szerint** (`messages.name = creatives.file_name`), nem `(mc_number, mc_variant)` alapján — az a pár kampányok és tengelyek közt osztott. Mind a 688 nonDCO sor pontosan illeszkedett, egy sem maradt dátum nélkül (a script kilép, ha bármelyik nem talál dátumot — így nem tud „none" státuszú sor keletkezni).
- **Eredmény:** 676 sor kapott státuszt → nonDCO összesen **374 ACTIVE / 314 INACTIVE**, 0 üres. Kereszttábla: 2024 → 56 INACTIVE, 2025 → 258 INACTIVE, 2026 → 373 ACTIVE.
- **Csak az üres státuszúakhoz nyúltam.** A 12 már beállított sort békén hagytam; ezek közül **egy tér el a szabálytól**: MC290a `HITEL_kerdoiv_hitelvalaszto_hiteltinder_1` `ACTIVE`, pedig a kreatívja 2025-10-28-i. Szándékosan nem írtam felül — emberi döntés volt, és a testvérsora (2026-os) is ACTIVE. Ha kell, egy paranccsal átbillenthető.
- Egyszeri script (`_status-nondco.ts`), futás után törölve. `messages` biztonsági mentés a futás előtt.
- A riport újragenerálva — a nonDCO oszlopban mostantól valódi státusz-badge-ek látszanak a korábbi „—" helyett.

### 2026-08-31 — „None" státusz kizárása MC-ken (elemzés + fix, bump vár)
**User-kérdés:** hogyan keletkezik kreatív-feltöltéskor státusz nélküli MC, és hogyan előzzük meg. **User-döntés:** a „nincs státusz" **nem legális állapot**, és mivel rendszerint leadott (élő) kreatívok töltődnek fel, a default **ACTIVE**.
- **Elemzés — a feltöltés két külön dolog:**
  - **Fájl → Creative Library:** `useUploadQueue` → `POST /api/files/upload` (`uploaded_files`, MinIO, sha256-dedup) → `POST /api/creatives` → `createCreative`. **Ez az út nem tud „none"-t gyártani:** a `creatives` táblán nincs is status oszlop, és nem keletkezik `messages` sor.
  - **Kreatív → MC:** `creative_promote` → `promoteCreative` → `createMessage` (INCOMING default), VAGY `scripts/rebuild-creatives.ts` nyers insertje.
- **Gyökér-ok:** `rebuild-creatives.ts:499` nyers `db.insert(messages)`-e **kihagyta a `status` mezőt**. Szándékosan kerüli meg a `createMessage`-et (hogy a fájlnévből jövő MC-szám megmaradjon) — így viszont annak `status: input.status ?? "INCOMING"` defaultját is megkerülte. **Mind a 676 status nélküli MC innen jött, 2026-08-17-én** (mind nonDCO channel-MC, mind template-null; DCO oldalon 0 db volt).
- **Miért volt rosszabb, mint amilyennek látszott:** a szűrő `m.status && ss.has(m.status)` szerint dolgozik, és a `statusOptions` csak létező státuszokat kínál → **egy null-státuszú MC eltűnt, amint bármelyik státuszt bepipáltad, és rá szűrni sem lehetett.** Nem szürke volt, hanem láthatatlan a státusz-tengelyen.
- **A 676 sort a user időközben maga szétosztotta** ACTIVE (+362) / INACTIVE (+314) között — a backfill tehát megtörtént, a munka a megelőzésről szól.
- **Fix — a réteg + mind a három forrás:**
  - [x] **Séma:** `messages.status` → `NOT NULL DEFAULT 'ACTIVE'`, migráció **`0008_nifty_the_initiative.sql`**. A generált SQL elé **kézzel betettem egy backfill UPDATE-et**: a `SET NOT NULL` egyetlen megmaradt NULL-on is elhasal, és a gyártó script a fájl megírása és a deploy között még lefuthat.
  - [x] **`scripts/rebuild-creatives.ts`:** explicit `status: "ACTIVE"` (nem a kolumna-defaultra bízva — olvashatóság).
  - [x] **`MessageEditor`:** a Status legördülő `— none —` opciója **törölve** (ez volt szó szerint a „none", és minden MC-n elérhető volt; a global edit ráadásul propagálta a testvérekre).
  - [x] **`import-xlsx.ts`:** üres Status cella → `INCOMING`, **nem** a kolumna ACTIVE defaultja. ⚠️ **Kimondott feltevés:** egy táblázat-sor, ami sosem mondta hogy „élő", ne váljon élővé mulasztásból. Ha ezt máshogy akarod, egy szó átírása.
  - [x] **`promoteCreative`:** explicit `status: "ACTIVE"` (eddig a `createMessage` INCOMING-ját örökölte, ami egy kész, leadott fájlra hamis). **Kézzel létrehozott MC változatlanul INCOMING.**
- **Verifikáció:** `tsc` 0, `npm run build` 0, `npx vitest run` **606/606**, eslint 0 error a módosított fájlokon.
- **⚠️ Deploy:** séma-migráció van → **migrate + kód EGY passzban** a boxon (`db:migrate` + build + `pm2 restart mm6-erste`), soha nem lokál `db:migrate` önmagában.
- **Bump-javaslat:** `6.32.0` → **`6.33.0`** (minor: séma-migráció + user-látható viselkedés-változás). A CHANGELOG-bejegyzés egyelőre `[Unreleased]` alatt áll, mert menet közben te is bumpoltál (6.31.0 → 6.32.0) — nem akartam verziót ütni rád.
- **Nyitva hagyva (nem kértél rá):** 8 db **`PLANNED`** státuszú MC van, ami nincs a kanonikus `STATUS_OPTIONS`-ban; a `Message` TS-típus még `status: string | null`-t mond (a DB már nem engedi); a `MessageEditor` saját, karakterre azonos `STATUS_OPTIONS` másolatot tart a `types.ts`-beli mellett.

### 2026-08-31 — Feed-váltás crash nyomozás (BLOKKOLVA — hibaszöveg kell)
**Bejelentés:** mátrixban változtatás → átlépés Feed view-ra → az app errorral elszáll; reload után a feed rendben feljön.
**Kizárva (nem ez):**
- **Lazy chunk / ChunkLoadError:** a `GridView`/`FeedView`/`TreeView` **statikus import** a `MatrixGrid`-ben, nincs `dynamic()`/`lazy()`, nincs `Suspense`.
- **Hook-sorrend (a 6.24.0-s F1 minta):** a `FeedView`-ban minden hook a return előtt van, korai return nincs; a `FeedExportPanel`-ben pedig **már ott a védelem és a magyarázó komment is** (a `filteredIds` memo szándékosan a `if (!ready) return` FÖLÖTT van). Az eslint `rules-of-hooks: error` óta (6.27.0) a statikus alakot amúgy is elfogná a build.
- **Query-hiba mint render-crash:** a globális `QueryClient`-en nincs `throwOnError` (`QueryProvider.tsx:9-16`), tehát egy elszálló query nem dobja a boundaryt.
- **Cache-alak romlás:** a mátrixban **nincs `setQueryData`**, csak invalidálás → a feed ugyanazt az alakot kapja, mint reload után.
- A `FeedView` adat-útja (`columns`/`rows`/`sizesByTemplate`) végig `??` fallbackös, nem dob.
**Ami hátravan:** a tényleges hibaszöveg. Kliens-oldali render-hiba, a box logjában nem látszik, lokálisan pedig nem tudom reprodukálni (nincs bejelentkezésem — a dev a KÖZÖS prod Postgresre megy).
**Következő lépés:** a user másolja ki a piros hibaképernyő / konzol első sorát (React #300/#310 vs. egy konkrét `TypeError`), abból egy lépésben megvan. Megjegyzés: a **6.32.0** épp feed-fixet hozott (DEFAULT-sor audience-rewrite) — ha az után is megvan, az kizár egy lehetséges okot.

### 2026-08-31 — Feeds lista: fájlnév-oszlop + Exported áthelyezés; a „mindig v1" magyarázata
**User-kérés (3):** (1) a generált XLSX neve legyen az első oszlop, pontosan ahogy a letöltés adja; (2) az `Exported` kerüljön a `Published at` elé; (3) fura, hogy a verzió mindig `v1`, pedig egy VAL feedből rögtön 4-et generált, mire végleges lett.
- [x] **(1) Fájlnév-oszlop.** Új `src/lib/feed-filename.ts` (`feedExportFilename`, db-függőség nélkül, hogy kliens is használhassa). A letöltő route (`feed-exports/[id]`) és a lista-route MOSTANTÓL UGYANEZT hívja — eddig a formátum-string csak a letöltőben élt, egy második másolat garantáltan szétcsúszott volna. A lista-route visszaad egy `filename` mezőt (kell hozzá a `clients.key`, +1 lekérdezés listánként). A `FeedsView` első oszlopa `File` (300px, mono), és **a detail-link is ide költözött** a dátumról — az első oszlop a sor identitása. ⚠️ Feltevés, egy sor visszacsinálni, ha a linket a dátumon akarod.
- [x] **(2) `Exported` áthelyezve** közvetlenül a `Published at` elé, sima cellaként (`feeds-table__exported`). A default rendezés marad `exportedAt desc`, a fejléc a `COLUMNS`-ból generálódik, tehát a sorrend automatikusan követi.
- **(3) A verzió NEM bug — ez a lockolt „uploaded ≠ exported" invariáns.** `decideVersion` (`feed-export.ts:560`) a `liveExport`-ból indul ki, amit a `findLiveExport` **kizárólag a `uploaded_to_adform_at`-tal rendelkező sorokból** választ. Ha nincs publikált előd → `{feedVersion: 1, action: "first"}`. Ha van, akkor is csak három ok bumpol: a user kéri, a sorszám átlépi a `MAX_ROWS_PER_FEED`-et, vagy sor tűnne el (sticky-superset); egyébként `append` ugyanarra a verzióra.
  - **Adat igazolja:** VAL 4 export (id 37–40), publikálva csak a 40-es, 12:50-kor — vagyis mind a 4 generáláskor még nem volt publikált VAL előd → mind `v1`. Termékenként: SZA 13 export / 2 publikált / max v2; SZK 16 / 1 / v1; VAL 4 / 1 / v1. A minta konzisztens.
  - **Fogalmi különbség:** a `Version` azt mondja, **melyik verziót kapja/kapta az Adform**, nem azt, hányszor nyomtál Exportot. A „hányadik próbálkozás" egy külön fogalom (export-sorszám), amit ma az `Exported` időbélyeg + a sor id hordoz — és a fájlnév végén lévő id meg is különbözteti a négy VAL fájlt (`…-v1-37.xlsx` … `…-v1-40.xlsx`).
  - **Ha mégis látni akarod a próbálkozás-számot:** külön oszlop (ordinal a product+version csoporton belül) a helyes megoldás — **a `Version` szemantikáját NEM szabad átírni**, mert az az AdForm advert_id identitáshoz van kötve (a négy lockolt feed-invariáns egyike). Külön kérésre megcsinálom.
- **Mellékes lelet:** a `src/lib/feed-export.ts` **nyers NUL bájtot tartalmaz** (offset 18511, 502. sor) egy kulcs-összefűzés elválasztójaként: `` `${row[advertIdCol] ?? ""}\x00${row[reportingCol] ?? ""}` ``. Működik, de emiatt a `file` és a `grep` **binárisnak látja az egész fájlt és némán kihagyja** — ezért nem találtam meg elsőre a verzió-logikát benne. Egy karakteres javítás: nyers bájt helyett `\u0000` escape, futásidőben azonos. Nem nyúltam hozzá, mert nem kérted.
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error/0 warning a négy érintett fájlon.

- **DEPLOYOLVA 6.33.0 (2026-08-31):** commit `9d34ec0`, push origin main, box `36cf83c`→`9d34ec0`. **Séma-migráció VAN:** `npm run db:migrate` → `0008` alkalmazva (9 migráció összesen), utána `npm run build` (Compiled successfully 41s) + `pm2 restart mm6-erste` → **Ready 1460ms**, online. Verifikálva a közös Postgresen: `messages.status` `is_nullable=NO`, `column_default='ACTIVE'::text`, **0 null sor**. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401, `/feeds` 307. A box-on nincs `psql` (a DB-ellenőrzés lokálról, a tunnelen ment).

### 2026-08-31 — DV360 vs AdForm signal-oszlop: export-dropdown + referencia-visszatöltés (bump vár)
**Kiváltó:** a user két SZK feedet tett a `docs/`-ba (`…-27-merged-adform-…`, `…-28-merged-DV360-…`). **Megállapítás: pontosan EGY oszlop tér el, a 3.** — `AdformSignal:ADFPLAID` vs `ExternalSignal:ExternalSignal`; a maradék 32 fejléc karakterre azonos. Az **érték** oldal viszont már ma is helyes: mindkettőnél a `{{audiences[…].lineitem_id}}` pattern tölti, és az audience a saját buying platformjához tartozó id-t hordozza (adform 8 jegyű placement id, dv360 11 jegyű line item id). **Tehát nem új oszlop, nem új pattern, nem külön feed-struktúra kell — csak a fejlécnév.**
- [x] **Közös modul `src/lib/feed-signal.ts`** — `SIGNAL_COLUMN_OPTIONS` (a két érték + platform-címke), `DEFAULT_SIGNAL_COLUMN` (= AdForm, hogy a régi viselkedés változatlan maradjon), `isSignalColumn`, `isValidSignalColumn`. Függőség-mentes, mert a panel (kliens) és a route-ok (szerver) is használják.
- [x] **`FeedRowSet.signalColumn?`** — a választott fejléc a payloadban tárolódik, de **szándékosan NEM a `columns`-ban**. Ok: a `columns` a sor-értékek lookup-kulcsa, és a `diffRowSets` oszlopnév szerint hasonlít — ha az alias bekerülne a `columns`-ba, egy DV360-as export MINDEN sora „changed"-nek olvasódna egy AdForm-oshoz képest.
- [x] **`buildXlsxBuffer`** — csak a fejléc-cellát írja át (`isSignalColumn` találatnál), az értékeket továbbra is az eredeti kulcson olvassa.
- [x] **`POST /api/feed-exports`** — `signalColumn` a body-ban, ismeretlen érték **elutasítva** (400 `bad_signal_column`), nem átengedve: ez a string egy olyan fejlécbe kerül, amit AdForm és DV360 is szigorúan parse-ol, egy elgépelés használhatatlan fájlt adna a túloldalon.
- [x] **Referencia-visszatöltés (`adform-snapshots`)** — (a) a `findColumnMismatch` a signal-vs-signal esetet egyezésnek veszi; (b) a feltöltött snapshot a **konfigurált névre normalizálva** tárolódik (oszlop + sor-kulcsok), a fájl által használt alias a `signalColumn`-ba kerül — különben a feltöltés átmenne, de utána minden sor „changed"-nek látszana a diffben.
- [x] **UI:** `Signal column` dropdown közvetlenül a `Default for this export` alatt (`feed-export-panel__signal`), azonos stílus; perzisztencia terméken­ként (`mm6_feed_export_signal_<product>`), a default-sor mintájára. A hookok mind a `if (!ready)` korai return FÖLÖTT maradtak (a panel ismert csapdája).
- **Verifikáció a VALÓDI fájlokon:** a konfigurált struktúra 33 oszlop; az AdForm fájl régen is, most is átmegy; a **DV360 fájl régen elakadt** (`3. oszlop: "ExternalSignal:ExternalSignal" vs "AdformSignal:ADFPLAID"`), **most átmegy**. `tsc` 0, `npm run build` 0, eslint 0 error/0 warning, új `tests/unit/feed-signal.test.ts` (4 teszt: alias-felismerés, stamp nélkül változatlan fejléc, rename csak a fejlécen az értékek megtartásával, a `columns` érintetlen marad).
- **Bump-javaslat:** `6.33.0` → **`6.34.0`** (minor: új user-látható vezérlő + új HTTP body-mező). Nincs séma-migráció.

### 2026-08-31 — Feeds `Live` oszlop: egy élő sor / termék + ACTIVE szín (bump vár)
**User-kérés (2):** (1) a `Live` cella háttere legyen az ACTIVE státusz-szín, hogy jobban látsszon; (2) ne lehessen két Live sor ugyanarra a termékre — ha új SZA feedet tölt fel referenciaként, a másiknak vissza kéne állnia.
- **Gyökér-ok (2): az oszlop rossz dolgot mutatott.** `live = r.uploadedToAdformAt !== null`, azaz „valaha publikálva lett" — nem „ez az élő". A rendszer saját definíciója viszont a `findLiveExport` (`feed-export.ts`): a publikált sorok közül a **legfrissebb**. Vagyis a DB-ben mindig is pontosan egy élő sor volt terméken­ként, csak a UI mutatott kettőt.
- [x] **Megjelenítés javítva, adat nem** — `liveIdByProduct` memo a TELJES listából (nem a `filtered`-ből: a termék-szűrés nem promótálhat más sort élővé); `live = liveIdByProduct.get(r.product) === r.id`. A leváltott sor **megtartja a `Published at` dátumát** — egyszer tényleg élő volt, az tény, nem törlendő. Így nem kell adatot rombolni ahhoz, hogy egy élő sor legyen. Tooltip megkülönbözteti: „currently live" vs „was published, but a newer export has since gone live".
- [x] **Rendezés is az új definíción** (`compareRows` kapja a mapet) — különben a `Live` szerinti rendezés mást csoportosítana, mint amit az oszlop mutat.
- [x] **(1) Szín:** `feeds-table__cell--live` a teljes cellán, a meglévő `status-badge--active` szín-képletével (`color-mix(… var(--status-active) 18%, white)` + `var(--status-active)` szöveg) — nem új szín-család, és követi a Design tab státusz-színeit.
- [x] **⚠️ Menet közben talált VALÓDI hiba — vegyes időbélyeg-formátum.** Két író volt: a `mark-uploaded` route a séma `nowUtc`-ját (`YYYY-MM-DD HH:MM:SS`), az `adform-snapshots` viszont `new Date().toISOString()`-et (`…T…Z`). Ezeket az oszlopokat **stringként** hasonlítjuk össze (a `findLiveExport` és mostantól a UI is), és `"T"` (0x54) > `" "` (0x20) → **azonos napon egy ISO-bélyegű reggeli referencia felülírja a délután publikált exportot.** Ez nem elméleti: a user ma reggel töltött fel referenciát SZA-ra és SZK-ra. A snapshot-route átírva `nowUtc`-ra.
  - ⏳ **NYITVA (user döntése kell, prod UPDATE):** két meglévő sor ISO-formátumú — `id 41 (SZA, 2026-08-31T12:50:18.068Z)` és `id 42 (SZK, 2026-08-31T13:21:22.145Z)`. Amíg nincsenek normalizálva, ugyanez a hiba elsülhet rajtuk. Javasolt: `update feed_exports set uploaded_to_adform_at = to_char((uploaded_to_adform_at::timestamptz at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS') where uploaded_to_adform_at like '%T%Z';` — MA mindkettő a legfrissebb a termékén, tehát az élő sor nem változna tőle.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error. Az adaton: publikált sorok SZA 41+16, SZK 42, VAL 40 → az új szabály szerint élő SZA=41, SZK=42, VAL=40, ami **karakterre egyezik** a `findLiveExport` `distinct on (product)` eredményével.
- **Bump-javaslat:** a `6.34.0` javaslathoz hozzáadva (ugyanaz a kiadás, nincs séma-migráció).

## 🟢 AKTÍV — Feed platform-dimenzió + split export (TERV, 2026-08-31, user green-light: „platform + split egyben")

**Kiváltó / premissza-javítás (user):** egy termékhez **jogosan tartozik két élő feed** — egy AdForm, egy DV360 —, mert a két platform külön feedet kap (más signal-fejléc, más lineitemek). Ez érvényteleníti a 6.34.0-ba írt „egy élő / termék" szabályt: ma véletlenül helyes (mind a 4 publikált sor `AdformSignal:ADFPLAID`-et hordoz, ellenőrizve a payloadokban), de az első DV360 feednél elrejtené az élő AdForm sort. **A termék-scope-os szabály NEM megy ki** — ugyanebben a kiadásban a platform-scope-os váltja le.
**A valódi hiányzó darab nem a split, hanem hogy sehol nem tároljuk, melyik platformnak készült egy feed.** A `findLiveExport` is `(clientId, product)` szerint keres → egy DV360 referencia lenne a következő AdForm export verzió-alapja; a két `docs/`-beli fájl 362 vs 467 soros, tehát a keresztbe-diff tömegével „removed" sort adna, ami **verzió-bump trigger** → spontán verzióugrások.

### P1 — platform first-class a `feed_exports`-on (ez oldja meg a korrektséget)
- [x] **P1.1** `feed_exports.platform` (`NOT NULL DEFAULT 'adform'`), `0009` migráció. Backfill: minden meglévő sor `adform` — igazolva, mindegyik payload `AdformSignal:ADFPLAID`-et tartalmaz.
- [x] **P1.2** `findLiveExport(clientId, product, platform)` — az élő-keresés, és ezzel a verzió-döntés + diff-alap platformra szűkül.
- [x] **P1.3** `POST /api/feed-exports` a `signalColumn`-ból vezeti le és tárolja a platformot.
- [x] **P1.4** Referencia-feltöltés: a platform a **feltöltött fájl signal-fejlécéből** derül ki (`isSignalColumn`) — nincs „split vagy single" kapcsoló, mert egy fájlnak egy fejléce van, tehát fizikailag nem lehet split.
- [x] **P1.5** Feeds lista: `Platform` oszlop + a Live „egy élő / (termék × platform)". Ez váltja le a termék-scope-os szabályt.
- [ ] **P1.6** Tesztek (élő-választás platformonként; a cross-platform alap ne szivárogjon be a verzió-döntésbe).

### P2 — split export (kényelem: egy művelet két menet helyett)
- [x] **P2.1** A default-választó átkerül a side toolbarból az **export dialogba** (user kérése). Perzisztencia terméken­kéntiről termék+platformra bővül.
- [x] **P2.2** Split kapcsoló a dialogban: bekapcsolva a `filteredMessages` `audience.buyingPlatform` szerint particionálódik, **platformonként külön default-választóval**.
- [x] **P2.3** Egy művelet **két `feed_exports` sort** hoz létre (platformonként egyet), mindegyik a saját signal-fejlécével és **saját verzió-vonalával**.
- [x] **P2.4** Letöltés: **egy ZIP** a két XLSX-szel (`jszip` már függőség, nincs új dep).
- [x] **P2.5** Elutasítási szabály: ha egy sor audience-ének nincs `buyingPlatform`-ja, a split **megtagadja és felsorolja őket** — feedből sort némán elhagyni veszélyes. Ma ez csak a 7 `*_INCOMING` staging audience-t érintené (egyetlen érdeminek 2 üzenete van).
- [ ] **P2.6** Tesztek + component-inventory + CHANGELOG + bump.

**Kimondott feltevések (egy szó átírni, ha másképp kell):**
1. **Platformonként külön verzió-vonal** — az első DV360 export `v1` akkor is, ha az AdForm már `v3`-nál tart. Két külön feed két külön rendszerben; közös számozás félrevezetne.
2. **A fájlnév megkapja a platformot** (`erste-SZA-adform-feed-v1-40.xlsx`), különben a split két fájlja csak a záró id-ben térne el. Érinti a `lib/feed-filename.ts`-t és a Feeds lista első oszlopát.
3. **A single (nem split) export megmarad** a signal-dropdownnal — a split nem váltja ki, csak automatizálja a két menetet.

- [x] **P2.6 részben** — component-inventory + CHANGELOG kész. **Új integrációs teszt a split útra még NINCS** (a meglévő 610 lefut); a split kliens-oldali particionálás, amire nincs komponens-teszt-infra a projektben. A szerver-oldali rész (platform-scope-olt `findLiveExport`, zip-route) tesztelhető lenne integrációs szinten — ha kell, külön kérésre.
- **Megvalósítás — eltérés a tervtől, indoklással:** a split NEM egy új „többlábú" POST végpont, hanem a dialog **legenként hívja a meglévő `POST /api/feed-exports`-ot** (szekvenciálisan). Ok: az a route már tartalmazza a teljes verzió-döntést, diffet és auditot; egy második, több-legű változat lemásolta volna mindezt. A két leg amúgy is két független export (külön verzió-vonal), tehát a szekvenciális hívás az őszinte modell. A ZIP-et külön `GET /api/feed-exports/zip?ids=` adja (`jszip`, max 10 id, hiányzó id → 404, hogy a zip ne legyen némán hiányos).
- **Egységes „leg" modell:** a nem-split export = 1 leg, a split = platformonként 1. Így a preview, a commit és a letöltés nem ágazik el a `split` flagre minden lépésnél; a preview EGY `useQuery`, ami `Promise.all`-lal futtatja a legeket (fix hook-szám, akárhány platform).

## MC export a docs-ba (2026-08-31)

Kérés: ismételhető export az összes **DCO** MC-ről, ami ACTIVE vagy INACTIVE (= ami szolgál ki) — product, MC szám, variáns, PMMID, status, preview kép link. A preview-generátor újrafuttatása után csak újra kell futtatni, és a linkek frissülnek.

Döntések (user, AskUserQuestion):
- **Granularitás:** egy sor = egy MC szám+variáns (219 sor), a PMMID-k (2038 db) összevonva darabszámmal + listával, a status ACTIVE/INACTIVE bontásban összesítve.
- **Formátum:** XLSX (`node-xlsx`, már függőség) → `docs/mc-export.xlsx`.
- **Origin:** `https://erste.messagingmatrix.ai` (a `/api/previews/[id]` route szándékosan publikus), `MC_EXPORT_ORIGIN`-nal felülírható.

- [x] **M1** `scripts/gen-mc-export.ts` — read-only, lapozó (500/oldal) lekérés. DCO-teszt a kanonikus `sameAxisAs` szerint: az `audience` kulcs **nem** oldódik fel channelre. Product = `audiences.product ?? topics.product`.
- [x] **M2** Preview linkek: `message_previews` minden méretre külön oszlop, csoportonként a legkisebb message id reprezentánsa, `?v=updated_at` cache-busterrel (ugyanaz a forma, mint a `list_mc`-é és a szerkesztőé).
- [x] **M3** `npm run export:mc` script a `package.json`-be.
- [x] **M4** Futtatás + a fájl ellenőrzése; CHANGELOG + verzióbump javaslat.

**Kész (2026-08-31).** `npm run export:mc` → `docs/mc-export.xlsx`: **219 MC** (2038 message sorból összevonva), méretek 300x250 / 300x600 / 640x360 / 970x250. Egy élő link ellenőrizve: `200 image/png`. **25 MC-nek nincs egyetlen preview-ja sem** — mind `html` sablonos, tehát csak még nem futott rájuk a shooter; `npm run gen:previews` + újra `export:mc` betölti őket. Product/topic/template kártya-szintű egyezése nem feltételezés: eltérésre a script figyelmeztet (most egy sem volt).

## Share oldal + Creative Library kör (2026-08-31)

### B1 — BUG: a HTML néha nem jelenik meg (gyökérok megvan)
`PublicMatrixPreview.tsx:50` és `MatrixIframeTile.tsx:189` egyaránt így olvassa az IntersectionObservert:
`(entries) => setVisible(entries[0]?.isIntersecting === true)`.
Az IO callback a legutóbbi kézbesítés óta **sorba állt összes** entry-t kapja, és `entries[0]` a **LEGRÉGEBBI**. Gyors görgetésnél (19 iframe, terhelt main thread) a sor `[false, true]` lesz → a kód a `false`-ot olvassa ki, a tile `visible=false` marad. A tile ezután mozdulatlanul áll a képernyőn, **több intersection-változás nincs**, tehát soha nem tér magához → örök `</>` placeholder. Ráadásul a `visible → false` az effect cleanupját is lefuttatja: a már repülő render-fetch `cancelled=true` lesz, és a beérkező válasz a guard miatt **még a modul-szintű `renderCache`-be sem kerül be**, tehát a következő mount sem tudja megúszni.
- [x] **B1.1** Az utolsó entry olvasása (`entries[entries.length - 1]`) mindkét fájlban.
- [x] **B1.2** `renderCache.set(...)` a `cancelled` guard **elé** — egy megérkezett render soha ne vesszen el.
- [x] **B1.3** Ez a belépett Creative Library masonryjában is ott van (`MatrixIframeTile`), tehát a user kérdésére: **de igen, ott is** ugyanez a hiba.

### S1 — Select all filtered (Creative Library)
- [x] **S1.1** Gomb a `SelectionActions`-be, a Share **fölé**; a teljes `filtered` halmazt jelöli ki, nem csak a végtelen-görgetéssel betöltött 200-at. Collapsed toolbarhoz ikonos variáns.

### S2 — Share oldal fejléc-átrendezés
- [x] **S2.1** 1. sáv: brand / breadcrumb / cím + jobbra a **comments számláló és a captured dátum** (ma alul van).
- [x] **S2.2** 2. sáv: **balra** Size filter + Commented only (a cím alatt), **jobbra** View switcher + Image preview + Download all.

### S3 — Image preview kapcsoló a share oldalon
- [x] **S3.1** Új publikus `GET /share/[id]/previews` — a snapshotban szereplő üzenetek `{messageId, size, previewId, updatedAt}` listája. Ugyanaz a kapuzás, mint a `/share/[id]/file/[fileId]`-nál (a share snapshotja a hozzáférési lista). A PNG-t maga a már publikus `/api/previews/[id]` szolgálja ki.
- [x] **S3.2** Pipás kapcsoló a View mellé, a Download all elé — ugyanaz a checkbox-forma, mint az MC editor „Image preview"-je. Bekapcsolva a matrix-tile-ok az eltárolt PNG-t mutatják iframe helyett.
- [x] **S3.3** Download all: image módban a PNG-ket zipeli, egyébként a HTML-eket (a statikus kreatívok mindkét módban a saját fájljukat adják).

### S4 — Kompaktabb masonry a share oldalon
- [~] **S4.1** ELVETVE (user): nem a szélesség a baj. A `max-w-6xl` marad.
- [x] **S4.2** A `Masonry` round-robin osztása (item i → i % colCount) vegyes képarányoknál csálé aljat ad. Opcionális, magasság-becslésen alapuló „legrövidebb oszlopba" pakolás — **csak a share galéria kapcsolja be**, a library olvasási sorrendje marad.

**Kész (2026-08-31).** Build zöld, 613 teszt zöld, a share oldal élőben ellenőrizve localhost:6009-en.
- **B1**: a gyökérok igazolva a kódból, nem tünetkezelés. Ugyanaz a hiba volt a belépett Creative Library masonryjában (`MatrixIframeTile`) is — ott is javítva.
- **S3**: új publikus `GET /share/[id]/previews`. Hiányzó PNG-nél a tile „no preview image", és **kimarad a zipből** (user döntése) — az Image preview gomb számlálója ezért mutatja külön, hány elemnek van képe: ha eltér a Download all számától, azonnal látszik.
- **S4.2**: a `Masonry` új, opcionális `estimateHeight` propja — a share galéria a banner-méretből / fájl-dimenzióból előre kiszámolja a tile magasságát, és mindig a **legrövidebb oszlopba** pakol. A library round-robinja (olvasási sorrend) érintetlen. Ellenőrizve: a négy oszlop alja ~300px-en belül ér véget, korábban több képernyőnyi volt a különbség.
- A `StoredPreview` `aspectRatio`-t foglal betöltés előtt, különben a galéria 0 magasságra esik össze a módváltáskor.
- **Figyelem:** a 6001-es dev szervered újraindítás nélkül nem látja az új `/share/[id]/previews` route-ot (a Next dev nem szedte fel az új könyvtárat) — a 6009-esen ezért teszteltem.

- **DEPLOYOLVA 6.34.0 (2026-08-31):** commit `e173869`, push origin main, box `9d34ec0`→`e173869`. **Séma-migráció VAN:** `npm run db:migrate` → `0009` alkalmazva, majd `npm run build` (Compiled successfully 51s) + `pm2 restart mm6-erste` → **Ready 1388ms**, online. Verifikálva a közös Postgresen: `feed_exports.platform` `is_nullable=NO`, `default='adform'::text`, mind a **33 sor `adform`**. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401, **`/api/feed-exports/zip?ids=1` 401** (az új route él, nem 404), `/feeds` 307.
- **Két szál egy kiadásban:** a feed platform-dimenzió + split (ez a szál) és a share-galéria preview / masonry / select-all / `export:mc` (másik szál, a `[Unreleased]` alatt már ott voltak a bejegyzései). Kombinált fán ellenőrizve deploy előtt: `tsc` 0, `npm run build` 0, **613/613 teszt zöld**.

### 2026-08-31 — Share-dialog image preview + referencia-fájlnév a Feeds listán (bump vár)
- **Image preview a detail-dialogban (user):** a kapcsoló a lightbox fejlécébe is bekerült, és **kétirányban szinkron** — nem két állapot szinkronizálva, hanem **EGY**: a `ShareGallery` `imagePreview`-ja megy le propként (`imageMode`/`setImageMode`). Szinkronizáló effect nincs, tehát nem is romolhat el.
  - A kapcsoló kikerült közös modulba (`share/[id]/ImagePreviewToggle.tsx`): a galéria adja a `ready`/`total` számot, a dialog nem (egy elemre értelmetlen lenne) → ott nincs count-badge, és `compact` módban felirat nélkül, csak ikonnal fér a fejlécbe a BgToggle mellé.
  - **Kép-mód a stage-ben:** a tárolt PNG a live render HELYETT, de **ugyanabban a skálázott dobozban és ugyanazon az `AnnotationLayer`-en belül** — így a meglévő pin/box annotációk koordinátái változatlanul ugyanoda mutatnak. Ha az elemnek nincs tárolt képe, **visszaesik a live renderre** (üres stage azt üzenné, hogy „elromlott a hirdetés", nem azt, hogy „még nincs preview").
  - Csak `kind === "matrix"` elemnél látszik a kapcsoló — a kreatívok amúgy is képek.
- **Feed-referencia fájlnév (user):** a File oszlop generált nevet mutatott (`erste-SZK-adform-feed-v0-42.xlsx`) olyan fájlokra is, amiket nem tőlünk töltöttek le. A feltöltött név a `notes`-ban van (`"Uploaded from AdForm: <név>"`), volt is rá helper az `adform-snapshots` route-ban — **közös helyre került** (`lib/feed-filename.ts`: `filenameFromNotes` + `feedExportDisplayName`), és a lista ezt használja. Export sorok változatlanok. +3 teszt.
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error, **616/616 teszt zöld** (613 → +3).
- **Bump-javaslat:** `6.34.0` → **`6.35.0`** (minor — user-látható új vezérlő + oszlop-tartalom változás). Nincs séma-migráció.

- **DEPLOYOLVA 6.35.0 (2026-08-31):** commit `722db94`, push origin main, box `e173869`→`722db94`, `npm run build` (Compiled successfully 35.9s) + `pm2 restart mm6-erste` → **Ready 1485ms**, online. **Nincs séma-migráció** (sima pull + build + restart). Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401, `/feeds` 307. Böngészős smoke a userre vár: a share-dialog image-preview kapcsolója (kétirányú szinkron a galériával, annotációk a helyükön maradnak) + a Feeds lista File oszlopa a két REFERENCE soron.

### 2026-08-31 — A feed-váltás crash GYÖKÉR-OKA megvan + 3 azonos rejtett hiba (bump vár)
**A hibaszöveg oldotta meg** (`TypeError: l.filter is not a function`, `formatted` → `String.replace` → `Array.map` → `useMemo`), amit a korábbi statikus elemzésem nem talált meg — mert nem hook-sorrend, nem chunk-load, nem `throwOnError` volt, hanem **közös react-query cache-kulcs eltérő ALAKKAL**.
- **Gyökér-ok:** a `MessageEditor.tsx:1085` és a `FeedView.tsx:88` is a `["text-formatting"]` kulcsot használta, de az editor a **teljes borítékot** tette a cache-be (`{ text_formatting: [...] }`), a FeedView a **kicsomagolt tömböt**. Amelyik előbb mountol, az nyeri a bejegyzést. MC-t nyitsz (vagy az editor bármelyik `invalidateQueries`-e fut) → a cache objektum lesz → Feed nézet → a `rules` átcsúszik a `formatted` mod `!rules` őrén (objektum, tehát truthy), majd `feed-spans.ts:30` `rules.filter(...)` → **TypeError renderelés közben → route error boundary**. Reload után azért működött, mert akkor a FeedView töltötte fel elsőként.
- **Javítás:** közös `useTextFormattingRules` hook (`matrix/useTextFormattingRules.ts`) — egy fetch, egy alak, egy hibakezelés. **Nem** védekező `Array.isArray` őr a fogyasztóban: a forrás volt a hibás, nem a fogyasztó.
- **⚠️ Beyond-the-ask, de ugyanez a hiba, háromszor:** mivel ez az osztály épp egy prod crash-t okozott, végigszkenneltem a `useQuery` definíciókat közös kulcsokra. A `MonitoringTable` **három kulcson** (`["messages"]`, `["audiences"]`, `["templates","folders"]`) kicsomagolt, míg mind a **négy** másik fogyasztó (MatrixGrid, CreativeLibrary, TemplateEditor, DraftsView, AudiencesEditor) borítékot tárol. Következmény: mátrixról Monitoringra lépve `templates.map` objektumot kap → crash; visszafelé a mátrix template-listája **némán kiürül**. A `MonitoringTable` most borítékot tárol, mint mindenki más — a saját kommentje is azt állítja, hogy „same sources as Creative Library". Ellenőrizve: a `["config","patterns"]` páros (FeedView + StructureTab) **rendben van**, mindkettő `Patterns` objektumot ad.
- **Tanulság a jövőre:** a query key **a cache-elt ALAK szerződése**, nem csak az URL-é. Két `useQuery` ugyanazzal a kulccsal, eltérő `queryFn`-nel = időzítéstől függő crash, amit reload elrejt.
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error, **616/616 teszt zöld**. ⚠️ Komponens-teszt-infra nincs, ezért erre a hiba-osztályra nem született automata teszt; a szerkezeti javítás (egy hook) a megelőzés.
- **Bump-javaslat:** `6.35.0` → **`6.35.1`** (patch — két crash-fix, nincs user-látható új viselkedés). Nincs séma-migráció.

- **DEPLOYOLVA 6.35.1 (2026-08-31):** commit `fc82682`, push origin main, box `722db94`→`fc82682`, `npm run build` (Compiled successfully 34.9s) + `pm2 restart mm6-erste` → **Ready 1271ms**, online. Nincs séma-migráció. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/text-formatting` 401, `/matrix` 307, `/monitoring` 307. **Böngészős smoke a userre vár — ez a lényeg:** (1) MC szerkesztése → Feed nézetre váltás (a bejelentett crash), (2) mátrix → Monitoring és vissza (a szkennel talált három azonos hiba).

### 2026-08-31 — Referencia-feltöltés: vége az „egy snapshot / termék" szabálynak (bump vár)
**User:** „nem tudom felmásolni az SZK feed két változatát, egymást felülírják" → majd: **„ne legyen többet egy snapshot per termék, ez butaság volt kérnem."**
- **Gyökér-ok:** az `adform-snapshots` POST **upsert** volt `(clientId, product)` kulcson — beszúrás előtt **törölte** a termék meglévő snapshotját (`route.ts:252-268`), platformtól függetlenül. Ez a szabály régebbi, mint a 6.34.0 platform-oszlopa, ezért az SZK dv360 feltöltése kitörölte az adform-osat. (A képernyőképen 5 sor maradt, az SZK adform referencia eltűnt.)
- **Javítás (a user döntése szerint, nem csak platformra scope-olva):** a törlés **teljesen kivéve** — a referenciák halmozódnak, és a **legfrissebb** (product, platform) párra épül a diff. Ugyanaz a szabály, mint az exportoknál; a régiek történelemként megmaradnak. Az audit `action` mostantól mindig `create` (a feltöltés hozzáad, nem cserél), és a `platform` bekerült az audit `after`-be.
- **Második, ugyanilyen hiba ugyanabban a folyamatban:** a diff-alapot adó snapshot-lekérdezés (`feed-exports/route.ts:212`) **csak termékre** szűrt, `limit(1)`-gyel és **rendezés nélkül** → amint egy terméknek adform ÉS dv360 referenciája is van, egy adform export a dv360 képhez hasonlíthatott volna (a másik platform minden sora eltérésnek olvasódik). Most `platform`-ra is szűr és `uploadedToAdformAt desc` szerint rendez. Az `adform-snapshots` GET `?product=` szintén rendez (eddig tetszőleges sort adhatott).
- **⚠️ SÜRGŐSSÉ VÁLT: az utolsó ISO-formátumú időbélyeg.** Mivel a diff-alapot mostantól `uploadedToAdformAt` szerinti rendezés dönti el, az `id 41` (SZA adform, `2026-08-31T12:50:18.068Z`) aktívan árt: egy MA feltöltött SZA adform referencia bélyege `2026-08-31 22:…` lenne, ami **stringként kisebb** a `T`-s alaknál (`' '` 0x20 < `'T'` 0x54) → a friss feltöltés NEM lenne az alap. Egy soros javítás, azonos pillanat, más írásmód: `update feed_exports set uploaded_to_adform_at = to_char((uploaded_to_adform_at::timestamptz at time zone 'utc'), 'YYYY-MM-DD HH24:MI:SS') where uploaded_to_adform_at like '%T%Z';`
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error, **616/616 teszt zöld**.
- **Bump-javaslat:** `6.35.1` → **`6.35.2`** (patch — adatvesztést okozó bug + rossz diff-alap javítása). Nincs séma-migráció.

### 2026-08-31 — Split export KIVÉVE (user), a dialog visszaáll egy exportra
**User:** „az export dialogból ki szeretném venni a split funkciót, fogom filterezni hogy éppen melyik szakaszt akarom exportálni, választom a defaultot és a signal oszlop nevét."
- A tegnapi P2 (split) **visszavonva**: a `Leg` modell, a platform-particionálás, a platformonkénti default-választók, a `splitBlocked` ág és a `GET /api/feed-exports/zip` **törölve**. Az `audiences` prop is kikerült a panelből és a dialogból (csak a particionálás miatt kellett).
- **Ami MARAD:** a `feed_exports.platform` oszlop, a platformonkénti élő feed és verzió-vonal (`findLiveExport(product, platform)`), a signal-oszlop választó és a default-választó — mindkettő a dialogban, ahogy a user kérte. A default perzisztencia `mm6_feed_export_default_<product>_<platform>` maradt.
- **Miért nem baj, hogy eldobtuk:** a split kényelmi funkció volt (egy művelet két menet helyett), nem korrektségi. A korrektségi rész — hogy egy termékhez platformonként külön élő feed és külön verzió-vonal tartozik — a platform-oszlopban van, és érintetlen.
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint 0 error, 616/616 zöld.

### 2026-08-31 — I6.1–I6.3 kész: alap-választó + „semmi nem tűnik el" szabály (bump vár)
- **ISO-időbélyeg javítva (prod UPDATE, user jóváhagyta):** `id 41` (SZA adform referencia) `2026-08-31T12:50:18.068Z` → `2026-08-31 12:50:18`. 1 sor, 0 ISO maradt; az SZA sorrend változatlanul helyes (41 frissebb, mint 16). Ez azért vált sürgőssé, mert mostantól a rendezés dönti el a diff-alapot.
- **I6.1 ✅ — a szűrő többé nem töröl sorokat.** `feed-export.ts`: az `allowed` (mátrix-szűrő) eddig a carry-forward unió ELŐTT futott, tehát egy szakasz exportálása kidobta a többi szakasz sorait a feedből. Most a `liveIdSet`-beli sorok túlélik a szűrőt, és `IsActive=FALSE`-szal mennek ki (`deactivated` halmaz, az archivált-sorok meglévő felülírása mellett).
- **I6.3 ✅ — alap-választó.** `baselineExportId` a POST bodyban → `BuildOptions` → új `findExportById` (kliensre ÉS termékre scope-olva, hogy kézzel átadott id ne húzhasson be másik termék feedjét). A dialogban „Compare against" select a termék korábbi feedjeivel, legfrissebb előre kiválasztva; a választott alap egyben a **diff-alap ÉS a carry-forward halmaz**. A `diffSource` címke a sor `source`-ából derül, hogy egy export-alapot ne nevezzen „AdForm snapshot"-nak.
- **I6.2 ✅ — diff-szöveg:** a „Removed" statisztika neve force nélkül **„Switched off"**, force-szal **„Dropped"**.
- **⚠️ I6.4 NINCS KÉSZ — kimondom, mert élesben számít:** ha egy MC **pmmid-je vagy advert_id-je megváltozik**, a régi sor ma NEM kerül be inaktívként (nincs mögötte üzenet, az alap payloadjából kellene kihozni — „szellemsor"). Vagyis kulcsmező-változás esetén a régi sor továbbra is eltűnik. Ez a rekey-funkcióval fordulhat elő; ha ma nem rekeyelsz, nem érint.
- **Teszt:** új `tests/integration/api/feed-carry-forward.test.ts` (3): a kizárt sor bent marad FALSE-szal; az alap által nem hordozott sor NEM támad fel; a kiválasztott sor normálisan szolgál. Az első a régi kóddal elbukott volna. Suite: **619/619 zöld** (616 → +3), `tsc` 0, build 0, eslint 0 error.
- **Bump-javaslat:** `6.35.1` → **`6.36.0`** (minor — új vezérlő + feed-kimenet viselkedés-változás). Nincs séma-migráció.

- **DEPLOYOLVA 6.36.0 (2026-08-31 este):** commit `237f3bc`, push origin main, box `fc82682`→`237f3bc`, `npm run build` (Compiled successfully 42s) + `pm2 restart mm6-erste` → **Ready 1490ms**, online. Nincs séma-migráció. Health: `/` 307, `/login` 200, `/mcp` 401, `/api/feed-exports` 401, `/feeds` 307, `/matrix` 307. A törölt zip-route `401`-et ad (nem 404): a `[id]` dinamikus útvonal fogja el `id="zip"`-ként, és az auth előbb fut a `bad_id` validációnál — helyes.

### 2026-09-01 — Export-dialog: alap vezérli a mezőket, szűrhető diff, fejléc-fájlnév — 6.37.0
- **⚠️ A tegnapi carry-forward javítás FÉLIG MŰKÖDÖTT — user képe leplezte le.** Egy feltöltött referencia `messageIds`-e csupa `-1` (`adform-snapshot.ts:64`), mert egy AdForm-XLSX nem ismeri az MM6 sor-azonosítókat → a `liveIdSet` ÜRES lett → a „semmi nem tűnik el" szabály **referencia-alap esetén nem érvényesült**, pedig épp az a gyakori eset. Ezért mutatott a preview 23 eltűnő sort. Javítás: ha a `liveIdSet` üres, a carry-forward halmaz az alap payloadjának **PMMID-oszlopából** oldódik fel az üzenetekre (ugyanaz a párosítás, amit a diff már használ).
- **Verzió-indoklás szövege:** „N live rows would be removed (sticky-superset rule)" → force nélkül „N baseline row(s) are not in this selection - they go out switched off, not deleted", force-szal „…are dropped from this version".
- **Az alap kitölti a signalt és a defaultot:** a `baselineExportId` változásakor a `platform`-ból signal-oszlop, a sor `defaultMessageId`-jából default. ⚠️ Csapda, amit kezelni kellett: a localStorage-restore effect kulcsa tartalmazza a platformot, tehát a signal átállása után AZONNAL felülírta volna a defaultot — ezért a restore csak `baselineExportId === null` esetén fut.
- **Diff-csempék szűrőként:** Added / Changed / Switched off gomb; a kiválasztott a details listát arra a szeletre szűkíti és kinyitja. A `Stat` opcionálisan kattintható (`onClick` nélkül sima kijelző marad).
- **Fejléc:** a leendő fájlnév a termék helyett. A dry-run válasza `filenamePreview`-t ad; a `feedExportFilename` `id` paramétere `number | null`, null esetén `new` (nem `0`, ami valódi id-nek látszana). Export után a valódi név látszik.
- **Sorrend:** inputok felül, alattuk (elválasztóval) a diff-forrás, a verzió-figyelmeztetés és a details — a diff addig értelmetlen, amíg nincs megadva, mihez képest.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error, **619/619 zöld**.
- **NYITVA — advert_name záró szám (user kérdezte):** a minta `MC{{number}}_{{variant}}_{{topic}}_{{version}}`, és a `{{version}}` a **`messages.version`**, azaz az optimistic-lock szerkesztés-számláló (`buildContext` `...m`-mel teszi be), nem az MC verziója. Ezért nő minden mentésnél (41→43, 5→97), és ezért látszik sok „changed" sor. **Ez konfig, nem kód** (Settings → Patterns → feed → `advert_name`). Ha kiszedjük, EGYSZERI churn: minden sor advert_name-je megváltozik, tehát a következő diff mindent „changed"-nek mutat. Nem nyúltam hozzá — user döntése.

- **DEPLOYOLVA 6.37.0 (2026-09-01):** commit `90821f5`, box `237f3bc`→`90821f5`, build 33.0s, `pm2 restart` → **Ready 1316ms**, online. Nincs séma-migráció. Health: `/` 307, `/login` 200, `/matrix` 307, `/api/feed-exports` 401.

### 2026-09-01 — Két hiba a user képéről: default-sor + a verzió-döntés diffje — 6.37.1
- **User kérdése:** „nem ismeri fel a default sort, miért nem?" Az adat megvolt: a referencia (id 46) `default_message_id = 32654` (MC301b). A hiba a kliensen: a szerver a **teljes** üzenet-listából oldja fel a default MC-t (`feed-export.ts:532`), a legördülő viszont a **szűrt** halmazból épült → a szűrésen kívüli MC-hez nem volt `<option>`, és a select némán az elsőre esett vissza. Javítás: az alap saját defaultja opcióként bekerül, „from baseline, outside this filter" felirattal.
- **⚠️ A képen a figyelmeztetés 190 sort mondott, a csempe 46-ot — ez két különböző diff volt.** A `versionDiff` az alapértelmezett `rowKey`-vel párosít **(advert_id, ReportingLabel)**, ami csak két MM6 export között működik: **az MM6 soraiban nincs advert_id** (az AdForm-é), a referenciában viszont van → szinte semmi nem párosult, majdnem minden sor „removed"-nak számított, és **a verzió-döntés ezen a diffen született**. A preview ugyanezt PMMID-vel számolta (46). Mostantól referencia-alapnál a döntés is `pmmidRowKey`-t használ. A régi komment („the only source of stable advert_id identity") épp azt a feltevést rögzítette, ami referencia-alapnál nem áll.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error, 619/619 zöld. ⚠️ A 190→46 változást élesben a te preview-d fogja igazolni.

- **DEPLOYOLVA 6.37.1 (2026-09-01):** commit `0ee3ec8`, box `90821f5`→`0ee3ec8`, build 36.3s, `pm2 restart` → **Ready 1674ms**, online. Nincs séma-migráció. Health: `/` 307, `/matrix` 307, `/api/feed-exports` 401.

### 2026-09-01 — I6.4 kész: szellemsorok + gazdag alap-választó — 6.38.0
- **User két kérdése a preview-ról, mindkettő valós hibát fedett fel.**
- **(1) „Miért akar még egy default sort hozzáadni?"** — a referencia-fájl **önmagával inkonzisztens**: a DEFAULT sorában `messaging_card_id=301` / `advert_name=MC301_b_…`, a PMMID és a ReportingLabel viszont `-m_302-`. Az `extractDefaultMc` a card-id oszlopokból olvas → `default_message_id` = MC301b; a diff viszont PMMID szerint párosít → a mi `-m_301-` DEFAULT sorunk nem talál párt, ezért „added", a fájlé meg „switched off". **Nem kód-hiba: a feltöltött (kézzel merge-elt) fájl mond két különbözőt.** Egy feed egyébként is pontosan egy DEFAULT sort visz, tehát a csere helyes viselkedés.
- **(2) „A switched off nem kéne hogy kikerüljön a feedből"** — IGAZA VAN, és ki is került: 361 alap − 46 + 1 = 316 sor. Ok: mind a 46 sor PMMID-je olyan MC-re mutat, ami **már nem létezik** (MC90, MC91, MC92…), tehát nincs mögötte üzenet, amiből a sort felépíthetném — a tegnapi PMMID-alapú carry-forward csak létező üzenetre tud hordozni. **Javítás (I6.4):** az alap payloadjából **szó szerint újra kiírjuk** ezeket a sorokat `IsActive=FALSE`-szal, a feed-struktúra oszlopaira szűkítve (hogy egy másik struktúrájú alap ne szélesítse a lapot). Az alap saját DEFAULT sora kimarad (egy feed egy DEFAULT-ot visz).
- **Gazdag alap-választó** (`BaselinePicker`): fájlnév + `reference`/`export vN` + `· live` + dátum. Natív select helyett popover, `MultiPill` mechanikával. **Az „automatic" sor megszűnt:** a legfrissebb ÉLŐ feed van előre kijelölve (ha nincs élő, a legfrissebb épített), kézi választást soha nem ír felül.
- **Teszt:** +2 (`feed-carry-forward.test.ts`): a nem-építhető sor bent van FALSE-szal és a ReportingLabelje sértetlen; a frissen épített sor nem duplázódik az alapból. Suite **621/621 zöld**.
- **Bump:** `6.37.1` → **`6.38.0`** (minor — feed-kimenet viselkedés-változás + új vezérlő).

- **DEPLOYOLVA 6.38.0 (2026-09-01):** commit `65db982`, box `0ee3ec8`→`65db982`, build 36.8s, `pm2 restart` → **Ready 1393ms**, online. Nincs séma-migráció. Health: `/` 307, `/matrix` 307, `/api/feed-exports` 401.

### 2026-09-01 — DEFAULT sor: a PMMID a forrás, nem a leíró oszlopok — 6.38.1
- **User: „a defaultot még mindig meg akarja változtatni, miért?"** A 6.38.0 után 361 sor (a carry-forward rendben), de maradt **1 added + 1 switched off — mindkettő a DEFAULT sor**: a miénk `-m_301-`, a fájlé `-m_302-`.
- **Gyökér-ok a MI oldalunkon:** az `extractDefaultMc` a `messaging_card_id`/`_variant` oszlopokból olvasott, azok viszont **leíró szöveg**, ami elmehet a sor saját PMMID-jétől. A user referenciájában pontosan ez történt: card-id `301/b`, PMMID és ReportingLabel `-m_302-`. Mivel MINDEN párosítás (diff, carry-forward, AdForm riport) PMMID-n megy, a DEFAULT sort más MC-ből építettük újra → sosem talált párt → **minden export örökre 1 added + 1 switched off**.
- **Javítás:** a DEFAULT MC a **PMMID-ből** derül (`-m_<szám>-`, `-v_<variáns>-`, `-n_<verzió>-`), a leíró oszlopok maradnak fallbacknek. A **verzió is kell**: az MC302b két verzióban létezik (`n_1` és `n_4`), és rossz verzióval olyan PMMID-t generálnánk, ami továbbra sem egyezik. +2 unit teszt.
- **A meglévő referencia adata is javítva** (a kód csak új feltöltésre hat): `feed_exports.id=46` `default_message_id` `32654` (MC301b) → **`32208`** (MC302b n4, topic egyezik), `default_label` frissítve. Ellenőrizve: ennek a PMMID-je a DEFAULT-átírás után **karakterre** a referencia DEFAULT sora.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error, **623/623 zöld**.

- **DEPLOYOLVA 6.38.1 (2026-09-01):** commit `a9f7e55`, box `65db982`→`a9f7e55`, build 33.0s, `pm2 restart` → **Ready 1516ms**, online. Nincs séma-migráció. Health: `/` 307, `/matrix` 307.
