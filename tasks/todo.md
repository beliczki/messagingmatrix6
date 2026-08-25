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
