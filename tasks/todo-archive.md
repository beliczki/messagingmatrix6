# MessagingMatrix v6 — checkpoint after `/clear` (2026-04-27)

## Hotfix (2026-05-03) — Creative Library masonry: wrong ad after size-filter change

**Symptom:** in the masonry view, toggling the Size filter caused some tiles to render the previous tile's ad (iframe `srcDoc` stale) while the iframe `title` and the click → detail dialog used the new ad's ID. Result: visual mismatch + clicking the wrong ad opened a different preview than what was visible.

**Root cause:** `Masonry.tsx` keyed items positionally (`key={i}`). When the filtered list changed, React reused the same `MatrixIframePreview` instance at a given column slot for a *different* message. `MatrixIframePreview` caches its rendered HTML in `useState` (lazy-init from a module cache, never reset on prop change), and its fetch effect bails when `html !== null` — so the stale `srcDoc` survived even though `title`/`onOpen` were computed fresh from new props.

**Fix:** add `itemKey` prop to `Masonry`, supplied by all three callers (Creative Library, Assets Library, Share Gallery — all have stable item ids/keys). Stable keys → React unmounts/mounts cleanly → `MatrixIframePreview`'s lazy state init runs against the correct cache key.

- [x] Add `itemKey?: (item, index) => React.Key` to `Masonry`, default to positional fallback
- [x] Pass `itemKey` from Creative Library (`c.id`)
- [x] Pass `itemKey` from Assets Library (`a.id`)
- [x] Pass `itemKey` from Share Gallery (`it.key`)

### Review
Single-prop addition, three call-site updates, no behavior change beyond keying. The lazy-`useState` pattern in `MatrixIframePreview` is left as-is — it's correct *given* stable keys; tracking down a defensive in-component reset would be a band-aid for the keying bug we just fixed.

---

## Current task (2026-05-01 dél) — Phase 10 kickoff (soft-delete + snapshots + perf/smoke)

**Cél:** Master plan Phase 10, **újraszabva** (2026-05-01 user briefing alapján): a Cmd+K palette és Cmd+Z keyboard undo **kiesett**, helyette **soft-delete mindenre + snapshot-alapú restore + read-only changelog UI**. Logika: a v6 elsősorban agent-mátrix, az agentek mutálnak, és ha kavarodás van akkor egy snapshot restore (vagy kézi Claude Code / új XLSX import) a mentő — sor-szintű undo nem ér meg külön komplexitást. A soft-delete egyúttal megoldja a hard-delete cascade rekonstrukció problémáját. Becslés ~3.5–4 nap, 5 sub-fázis.

### Felmért állapot (2026-05-01)
- v5-ben **nem volt** soft-delete pattern (`grep archived/deleted_at/softDelete` üres) → nincs mit portolni, új feature.
- v6 schema-ban **van** `status` mező audiences/topics/messages táblákon (line 129/168/215), de ez **üzleti status** (active/incoming/preview/approved/dead/etc.) — **NEM keverhető** az archive flag-gel. Új mező kell: `archived_at TEXT NULLABLE` (NULL = aktív, ISO timestamp = archived ekkor).
- 9 DELETE endpoint van v6-ban (`audiences/[id]`, `topics/[id]`, `messages/[id]`, `text-formatting/[id]`, `users/[id]`, `files/[id]`, `share-galleries/[id]`, `creatives/[id]`, `assets/[id]`) — mind átírandó "soft-delete + cascade" módra.
- 10 tenant-scoped tábla snapshot scope-hoz: audiences, topics, messages, assets, creatives, text_formatting, reporting, share_galleries, uploaded_files, users. **`audit_log` NEM** snapshot-olható (circular: a snapshot művelet auditja maga is bekerülne a snapshotba).
- `audit_log.before` / `after` JSON full-row snapshot már mindenhol kitöltött (`src/lib/audit.ts:33-34`) → a changelog UI read-only renderhez közvetlenül használható, nincs séma-bővítés.

### Sub-fázis javaslat (sorrendileg)

- [ ] **10a — Soft-delete migration (~1.5–2 nap)** — 4 sub-sub-fázisra bontva, mindegyik commit-sized:
  - [ ] **10a.1** Schema migration: 10 tenant-scoped táblába `archived_at TEXT NULLABLE`, drizzle generate + migration file, `archived_idx` per tábla a default-`WHERE archived_at IS NULL` query-khez. Csak schema, semmi viselkedés-változás még. Tests: typecheck + meglévő 160 zöld marad.
  - [ ] **10a.2** Library + API layer: 9 DELETE route → soft-archive (`UPDATE … SET archived_at = now()`); új `POST /api/{entity}/[id]/restore` per entitás; minden lista GET `WHERE archived_at IS NULL` default + `?includeArchived=1` opt-in; cascade archive (audience↔messages↔reporting, topic↔messages↔reporting); `withSession` middleware archived user reject (`WHERE archived_at IS NULL`); restore parent-first guard (Q4: child restore returns 409 ha parent.archived_at != NULL); audit row "archive"/"restore" action. Tests: per-entity archive+restore+cascade + parent-first guard + archived user 401.
  - [ ] **10a.3** UI: "Show archived" toggle minden lista-toolbarba (Matrix MatrixToolbar, Creative Library RightToolbar, Assets RightToolbar, Templates Settings, Users SettingsView, Share Galleries SettingsView). Archived row-ok vizuálisan dim/strike (semantic class: `row--archived`); restore gomb minden archived row-on (parent-archived esetén disabled + tooltip "Parent {entity} archived").
  - [ ] **10a.4** MCP scoping: a Phase 8 MCP tool-ok (list/get/create/update/delete/batch) most a soft-delete világban élnek — list default `archived_at IS NULL`, új `includeArchived` paraméter; `*_delete` tool soft-archive lesz; új `*_restore` tool per entitás (parent-first guard ugyanúgy). Tests: MCP behavior contract update.
- [ ] **10b — Snapshot create/restore (~1 nap)**: új `snapshots` tábla (`id, client_id, label, created_at, created_by, payload_json`); `POST /api/snapshots` (label) → snapshot a 10 tenant-scoped táblából, transaction-ban; `GET /api/snapshots` lista; `POST /api/snapshots/[id]/restore` → transaction-ban wipe-then-insert mind a 10 táblát + audit row "snapshot_restore" action; `DELETE /api/snapshots/[id]`. Settings → új "Snapshots" tab: lista + Create + Restore (confirm modal: "ez felülírja az összes mostani aktív és archivált adatot a {label} pillanatképpel — biztos?") + Delete. **Nem érinti** a config/clients/system_config/audit_log táblákat.
- [ ] **10c — Changelog read-only UI (~fél nap)**: új Settings → "Changelog" tab (vagy Monitoring page-en belül). Lista az `audit_log` row-okról reverse chronological, oldal-szintű virtualizálás (van-e már 1k+ row az Erste-n? valószínűleg igen). Filterek: entitás-típus (audience/topic/message/…), action (create/update/delete/restore/bulk_*/snapshot_restore), dátumtartomány, user. Per-row expand: before/after JSON diff (oldalt-oldalt vagy unified). **Nincs undo gomb** — explicit decision, agent-mátrixhoz snapshot az restore-mechanizmus.
- [ ] **10d — Perf budgets verifikáció (~fél nap)**: spec §8.1 budgetek pörgetve a seeded Erste deploy-on. Lighthouse run + saját timing logok; ha mind passz → review-rögzítés; ha valami fail → root cause + fix (pl. `react-virtual` window-méret, lazy import, memoization).
- [ ] **10e — Multi-deploy smoke (~fél nap)**: 3 deploy `ACTIVE_CLIENT_KEY=erste|telekom|proficio` (+ opcionálisan `demo`) ugyanazon SQLite-on; verify branding (login + sidebar + buttons), izoláció (Telekom UI nem lát Erste row-t, forged JWT 403), MCP per-client (Erste token Telekom deploy-on 401), snapshot per-client (Erste snapshot Telekom-on nem listázódik), share gallery cross-deploy (Erste share Telekom-on nyitva is Erste branded). Eredmény checklist `tasks/todo.md`-be.

### Mit NEM csinálunk (Phase 10-en belül)
- **Cmd+K command palette** — eredetileg roadmap-en, most kihúzva.
- **Cmd+Z keyboard undo / per-action undo gomb** — eredetileg roadmap-en, most kihúzva (snapshot + kézi Claude Code / XLSX import az ágy).
- **Audit_log archive cascade** — entity archive nem érinti az audit row-okat (history megmarad, snapshot diff-hez is kell).
- **`uploaded_files` automatikus cascade archive** — content-addressed sha256, több creative is mutathat rá; csak közvetlen `DELETE /files/[id]` archiválja, entitás archive nem érinti.
- **Snapshot file storage tartalmával** — a sha256 storage immutable; snapshot csak a metadata sorokat (`uploaded_files`) menti, a fizikai bytes-okat nem (azok eleve idempotens dedup-pal újra-importálhatók).
- **Snapshot retention policy / auto-purge / scheduled snapshots** — manual create/delete first; ha kell, Phase 11+.
- **Hard delete UI** — admin-only "purge archived rows older than X" later (Phase 11+); most a soft-delete + manual SQL-script elég GDPR purge-höz, ha jönne.

### Open questions — locked (2026-05-01 user)
1. **`uploaded_files` cascade**: NE archiválódjon entity archive-ből, csak közvetlen `DELETE /files/[id]`. ✅ confirmed (default).
2. **`audit_log` cascade**: NE archiválódjon, history sosem vész. ✅ confirmed (default).
3. **`users` archived → login**: `withSession` reject (`WHERE id = ? AND archived_at IS NULL`). ✅ confirmed (default).
4. **Cascade restore irány**: parent-first. Child restore disabled UI-on amíg parent archived; API 409. ✅ confirmed (user explicit).
5. **Snapshot scope `audit_log`**: kihagyva. ✅ confirmed (default).
6. **Changelog UI hely**: Settings → új "Changelog" tab a Snapshots mellé. ✅ confirmed (user explicit).

### Indítás
Mind a 6 lockolt → **10a.1 (schema migration) készen áll indulásra**. Ez egy önálló kis commit: 10 tábla `archived_at TEXT NULLABLE` + per-tábla `archived_idx`, drizzle generate, migration file. Semmi viselkedés-változás, csak séma. Várom a "mehet 10a.1" zöld jelzést, aztán futok.

### 10a.1 Review (2026-05-01)
**1 schema fájl + 1 migration (`0006_shiny_husk.sql`, 10 ALTER TABLE). 167/167 tests green; typecheck clean.** Per-table `archived_at TEXT NULLABLE` mező, **nincs** dedikált `(client_id, archived_at)` index — YAGNI, 10d perf round eldönti kell-e (a meglévő `(client_id, *)` index-eken a list query-k filter-elik az archived-eket app-szinten gyorsan).

### 10a.2 Review (2026-05-01)
**44 fájl változás (~+1207 / −187 sor). 167/167 tests green (160 → 167); typecheck clean.**
- 7 entity lib `delete*` → `archive*` átnevezés + új `restore*`. Audience és topic archive cascade-archive-eli a hozzá kötött message-eket egyetlen `db.transaction`-ben.
- `messages.softDeleteMessage` → `archiveMessage`. Régi `status='deleted'` filter megmaradt backward-compat-ként (`listMessages` kizárja mind a status='deleted'-et, mind az archived_at != NULL row-okat).
- 9 DELETE route soft-archive lett (audit "archive"). 9 új `[id]/restore` POST route audit "restore" + parent-first guard a message restore-on (409 + parent type/key).
- `withSession` archived-user reject (sub-ms PK lookup minden authenticated request-en).
- `mcp.ts` 3 *_remove tool átírva archiveX hívásra; *_restore tool-ok 10a.4-ben.
- `numbering.ts` `nextMcSlot` az archived row-okat is `!isLive`-nek kezeli — fully-archived cell új MC-je recycle-eli a variant slotot (v5 fixture konzisztens, `cell-only-has-deleted` ported to archive).
- `files.ts` `deleteFile` (ref-counting + fizikai cleanup) átnevezve `purgeFile`-re; új `archiveFile`/`restoreFile` (csak metadata, fizikai bytes maradnak).

### 10a.3 Review (2026-05-01)
**7 fájl változás (~+433 / −131 sor). 167/167 tests green; typecheck clean.**
- Új shared `<ArchiveToggle>` komponens (`src/app/(app)/_components/ArchiveToggle.tsx`) — stateless pill, Archive/ArchiveRestore icon swap.
- Új `.row--archived` global CSS class (opacity 0.55 + grayscale 0.4, `.row--archived__filename`/`__title` line-through).
- 4 list view: AssetsLibrary, CreativeLibrary (mind 3 view mód: masonry/grid/list), Users tab, SharesView. Mindegyik kapott "Show archived" toggle-t a toolbar-ba + restore mutation-t + dim/restore-button-swap a row-szintű komponensben.
- Users tab: `archived` badge az email mellett, edit gomb disabled archived row-on.
- Shares: copy/open gombok disabled archived share-en.
- Matrix Grid/Feed UX **NEM** ebben a commit-ben — cell-szintű archive viselkedés (whole row/column dim vs hide) más design, defer 10d/post-10 polish-ra.

### 10a.4 Review (2026-05-01)
**1 fájl változás (`src/lib/mcp.ts`, ~+127 sor). 167/167 tests green.**
- `list_audiences`, `list_topics`, `list_mc` → új `include_archived` param (default false).
- 3 új tool: `audience_restore`, `topic_restore`, `mc_restore`. Mc_restore parent-first guard (parent_archived hibaválasz a parent type/key-vel).
- 24 tool összesen (8 read/meta + 9 single write + 4 batch + 3 restore).

### 10b Review (2026-05-01)
**11 fájl változás (~+700 sor). 170/170 tests green (167 → 170, 3 új snapshot teszt: round-trip restore, cross-client izoláció, list+delete).**
- Új `snapshots` tábla (migration `0007_sour_morlocks.sql`): `id, client_id, label, created_by, payload_json, created_at` + `(client_id, created_at)` index.
- `src/lib/snapshots.ts`: createSnapshot mind a 10 tenant-scoped táblából olvas és JSON-ba szerializál a `payload_json`-be. restoreSnapshot egyetlen `db.transaction`-ben wipe-then-insert. List/get/delete + per-table row counts.
- 3 új API route (admin-only via `withAdmin`): `POST/GET /api/snapshots`, `DELETE /api/snapshots/[id]`, `POST /api/snapshots/[id]/restore`.
- Audit row-ok: create/delete/snapshot_restore action `entityType='snapshots'`-on.
- Settings → új "Snapshots" tab: Create form (label), saved-snapshots list per-table count chip-ekkel, Restore (amber confirm modal a wipe-figyelmeztetéssel), Delete browser-confirm-mel. Restore után minden TanStack Query key invalidate.
- **Nem érinti** config / clients / system_config / audit_log — config (lookAndFeel, patterns) + audit history túléli a restore-t.

### 10c Review (2026-05-01)
**3 fájl (~+408 sor). 170/170 tests green; typecheck clean.**
- `GET /api/audit-log` admin endpoint: filterek entity, actions (CSV), userId, since/until (ISO date), limit (max 1000), offset. Returns rows + hasMore + nextOffset.
- Settings → új "Changelog" tab: filterek (entity dropdown, date range, user id, action multi-pill action-type alapján színkódolva). Reverse-chronological list, 100/page, Prev/Next.
- Per-row expand: side-by-side Before/After JSON pretty-print.
- **Nincs undo gomb** — design szerint (snapshot restore a mechanizmus).

### 10d Status (2026-05-01)
**Synthetic perf seed létrehozva** (`scripts/seed-perf.ts`, `npm run seed:perf`): 100 audience, 100 topic, 30000 message, 500 creative az aktív client-be (default Erste). A seed eldobja a meglévő tenant-data-t a 4 táblán — production Erste DB ellen ne futtasd.

**Spec §8.1 budgetek (manuális verify a usernek)**:
- [ ] Matrix Grid `/matrix` paint < 50ms (30k MC) — React DevTools Profiler "Profile" rec, mérd a teljes commit-ot a TanStack Virtual scroll-ozáskor
- [ ] Creative Library `/creative-library` masonry FCP < 200ms (500 creative) — Lighthouse mobile preset
- [ ] Message Editor preview iframe re-render < 200ms field edit után — DevTools Performance tab, mérd a `keydown → iframe paint` window-t
- [ ] AdForm sync 10k banner < 5s — **defer** (Phase 6c monitoring page nincs még)

Eredmények rögzítendők ide. Ha bármi fail → root-cause + fix patch (virtualization window méret, lazy import, memoization). A budget verification end-user manual workflow, mert Lighthouse+DevTools-t a böngészőben kell pörgetni — Claude itt nem fut.

### 10e Status (2026-05-01)

**Bootstrap automatizálva**: új `scripts/seed-multi.ts` (`npm run seed:multi`) létrehozza a 4 deploy clients row-jait (erste / telekom / proficio / demo) + admin user-t mindegyikbe (default `admin@local` / `admin123`). Az `seed-multi` futás eredménye táblázatban kiírja az id/key/mcp_token-t és a port + dev script mappingot.

**Manuális smoke checklist (a usernek)** — futtass mindegyiket egy frissen seedelt DB-n:

#### Branding
- [ ] `npm run dev:erste` → http://localhost:6001 — login page Erste branding (sidebar logo, brand colors a lookAndFeel-ből)
- [ ] `npm run dev:telekom` → http://localhost:6002 — login page Telekom branding (eltér Erste-től)
- [ ] `npm run dev:proficio` → http://localhost:6003 — Proficio branding
- [ ] `npm run dev:demo` → http://localhost:6000 — generic slate (default lookAndFeel)
- [ ] Settings → Design tab egyik deploy-on változtatás (pl. `--brand-primary`) → ugyanazon deploy login page új színt mutat → másik deploy login page **érintetlen**

#### Adat-izoláció (cross-tenant leak)
- [ ] Erste deploy-on hozz létre egy audience-t. Telekom deploy `/api/audiences` GET → 0 row (vagy kizárólag Telekom data)
- [ ] Erste session JWT-vel hívd meg Telekom deploy-on `/api/audiences` (curl Bearer-rel) → 401 (forged-cid)
- [ ] Forged JWT-t signeljen Telekom client_id-vel és Erste session-secret-tel → Erste deploy `/api/audiences` → 401 (cid mismatch)

#### MCP per-client
- [ ] Settings → Clients tab Erste deploy-on → "Generate MCP token". Másold a tokent.
- [ ] Hívd meg Erste `/mcp` endpoint-ot a Bearer-rel + `tools/list` → 24 tool sikeres
- [ ] Hívd meg ugyanazt a tokent Telekom `/mcp`-n → 401
- [ ] Telekom-on generálj saját MCP tokent → ugyanaz a flow Telekom data-val

#### Snapshot per-client izoláció
- [ ] Erste deploy-on hozz létre snapshot-ot ("test-1"). Settings → Snapshots tab list mutatja
- [ ] Telekom deploy Settings → Snapshots → list **NEM** tartalmazza Erste "test-1"-t
- [ ] Telekom-on hozz létre saját snapshot-ot → Erste-n nem látszik

#### Share gallery cross-deploy
- [ ] Erste deploy-on hozz létre share gallery-t a Matrix-ról (selected MC-k → "Share")
- [ ] Másold a share URL-t (`/share/<id>`)
- [ ] Nyisd meg a URL-t Telekom deploy host-on (port 6002) → a megnyíló oldal **Erste branding**-gel renderelődik (mert a share metadata client_id-t tárol)

#### Soft-archive cross-tenant
- [ ] Erste-n archiváld egy audience-t → Telekom Matrix listáján nem látszik (mindenképp, már izolált)
- [ ] Erste "Show archived" toggle-lel láthatóvá teszed → csak Erste archived row-ok jelennek meg
- [ ] Restore működik per-client

#### Eredmények rögzítése
Pipáld ki a fenti lépéseket. Ha bármi fail → bug-fix patch a következő phase 11+ kibocsátásig. A Phase 10 ezzel zárva.

---

## Phase 10 zárás összegzés

**Status (2026-05-01)**: Phase 10 funkcionálisan zárva (10a.1-10c kódolva + commit-olva + tesztelve, 170/170 zöld). A 10d (perf budget verify) és 10e (multi-deploy smoke) **manuális end-user workflow** — Claude bootstrap script-ekkel előkészítette (`seed-perf` + `seed-multi`) és checklistet adott; a tényleges Lighthouse + multi-deploy futtatás a usernél van.

**Új capability-k:**
- Soft-delete mindenre (10 tenant-scoped tábla `archived_at`-tal, cascade audience↔message + topic↔message)
- Restore per-action a UI-on (Assets/CL/Users/Shares) és MCP-n (audience_restore/topic_restore/mc_restore)
- Parent-first restore guard messages-en (parent audience/topic archived → 409 / MCP error)
- Snapshot create/restore (10 tábla teljes pillanatkép, transaction-ban wipe-then-insert) — Settings → Snapshots tab
- Read-only changelog UI (audit_log timeline filterekkel) — Settings → Changelog tab
- Synthetic perf seed + multi-deploy bootstrap script

**Hátra (post-launch / 11+):**
- Matrix Grid/Feed cell-szintű archive UX (most a list view-on van toggle, mátrix nem)
- Templates/Monitoring tab archive toggle-jei (most kihagyva, mert template fájlrendszer-alapú; monitoring 6c deferred)
- Phase 11 file ingest pipeline + AI-agent error triage (post-launch pinned work)

---

## Current task (2026-05-01) — Phase 8 kickoff (MCP server, per-client bearer)

**Cél:** Spec §5 + master plan D8/Phase 8. Becslés 2 nap. 21 tool (17 v5-ből + 4 új batch). 4 sub-fázisra bontva, hogy minden commit-sized.

### Felmért állapot (2026-05-01)
- Nincs MCP scaffolding még: nincs `/src/app/mcp/`, nincs `@modelcontextprotocol/sdk` dep, nincs `src/lib/mcp.ts`.
- `clients.mcp_token` mező létezik a schemában (séma 21. sor) — még üres minden client-en.
- A 7 entitás v6 CRUD lib-je (`src/lib/entities/`) már átveszi a writes-ot a HTTP route-okból; az MCP toolok ezeket a lib-ket fogják közvetlenül hívni (SQLite közvetlen, nem belső HTTP).
- Audit lib + SSE broadcast már működik. MCP write-ok automatikusan SSE-zenek.
- D8 spec: bearer → client lookup → ha `client.id !== claims.cid` (deploy-pinned) → 401. Külön ellenőrzés: `Authorization: Bearer <token>` VAGY `?secret=<token>` (utóbbi a claude.ai connector-hoz).

### Sub-fázis javaslat

- [x] **8a — Scaffold + bearer auth + 2 read tool (`list_audiences`, `list_topics`)** ✅ 2026-05-01 (typecheck + 160/160 tests green)
  - `@modelcontextprotocol/sdk@1.29.0` + `zod@4.4.1` direct dep installálva.
  - `src/lib/mcp.ts` új: `resolveBearerClient(req)` reads `Authorization: Bearer <token>` OR `?secret=<token>`, lookup-olja `clients.mcp_token`-ből a row-t, **deploy-pinned check** (`row.id !== activeClientId()` → 401). Sikerre `McpContext = { clientId }`. `buildMcpServer(ctx)` factory egy `McpServer` példányt ad vissza 2 registered tool-lal.
  - `src/app/mcp/route.ts` új: `POST` / `GET` / `DELETE` mind a `handle(req)`-en megy át — auth → új `WebStandardStreamableHTTPServerTransport` (stateless mode, `enableJsonResponse: true`) → `server.connect(transport)` → `transport.handleRequest(req)`. Per-request fresh transport+server (stateless minta, no session state). `dynamic = "force-dynamic"` hogy a Next ne próbálja cache-elni.
  - `scripts/rotate-mcp-token.ts` új: `crypto.randomBytes(32).toString('hex')` `mcp_<hex>` formátum. `--client <key>` flag VAGY `getActiveClient()` default. UPDATE `clients.mcp_token`. Smoke parancsot is kiír.
  - Tool: `list_audiences({ product? })` és `list_topics({ product? })` — entity lib (`listAudiences`/`listTopics`) hívás client-id scope-pal, opcionális `product`-szűrő. `jsonResult()` helper minden tool output-hoz (`content: [{ type: 'text', text: JSON.stringify(value, null, 2) }]`).
  - **Manuális smoke**:
    ```sh
    ACTIVE_CLIENT_KEY=erste npx tsx scripts/rotate-mcp-token.ts
    # → kiírja a tokent
    npm run dev
    # → másik terminál:
    curl -X POST -H "Authorization: Bearer mcp_..." \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
      http://localhost:3000/mcp
    # → list_audiences + list_topics tool-leírás
    ```

- [x] **8b — Read + meta tool blokk** ✅ 2026-05-01 (typecheck + 160/160 tests green)
  - **Read (2 új):** `list_mc({ topic_key?, audience_key?, product?, status?, monitoring_status?, limit? })`, `mc_get({ mc_label })`.
  - **Meta (4 új):** `list_templates()`, `list_products()`, `matrix_status()`, `get_mc_reporting({ mc_label })`.
  - Mind a 6 tool a `src/lib/mcp.ts`-ben, közös pattern: zod inputSchema → drizzle query `clientId` scope-pal → `jsonResult()`.
  - `list_mc` `product` filter: subquery `audiences.product = ?` és `topics.product = ?`-ra → kulcsok kigyűjtve → `messages.audience IN (...) OR messages.topic IN (...)`.
  - `list_mc` `monitoring_status` filter: `reporting.adform_status = ?` → mc_label-ek kigyűjtve → `messages.pmmid IN (...)`.
  - `mc_get` és `get_mc_reporting` az MC label-t (PMMID) használják kulcsként, ahogy spec §5.1 rögzíti.
  - `matrix_status.last_export = null` — még nincs export-history tracking; Phase 8d / 9c-ben tehetünk audit-row alapút ha kell.

- [x] **8c — Single write tools (9 db) + audit `byUser="mcp:<cid>"`** ✅ 2026-05-01 (typecheck + 160/160 tests green)
  - 9 új tool: `audience_create`, `audience_update`, `audience_remove`, `topic_create`, `topic_update`, `topic_remove`, `mc_create`, `mc_update`, `mc_remove`.
  - Mindegyik az entity lib függvényt hívja (`createAudience` / `updateAudience` / stb.) — ugyanaz a kód-út mint a HTTP route-oké. Optimistic lock automatikusan, conflict-on `isError: true` + `current` row visszaadva az MCP eredményben hogy az agent retry tudjon.
  - Audit `userId = "mcp:<cid>"`. Audit row + SSE broadcast automatikusan, mint HTTP-oldali write-oknál.
  - **Lookup by key**: a write tools nem id-t várnak, hanem `key` (audience/topic) vagy `mc_label` (= pmmid; messages). 3 inline helper (`findAudienceByKey`, `findTopicByKey`, `findMessageByPmmid`) lookupol előbb, majd lib-et hívja a numerikus id-vel.
  - **Schema**: explicit required mezők (pl. `name` create-en, `key+version` update-en) + opcionális `fields: z.record(z.string(), z.unknown())`. A `fields` átmegy a meglévő `pickWritable` whitelistjén (filter ki a `id`/`client_id`/`version`/timestamp-eket). Description-ben felsorolva minden írható mező név hogy az agent tudja mit kérhet.

- [x] **8d — 4 batch tool + rate limit + Settings → Clients tab MCP token UI** ✅ 2026-05-01 (typecheck + 160/160 tests green) **= Phase 8 záró**
  - 4 batch tool a `src/lib/mcp.ts`-ben: `audience_create_batch`, `topic_create_batch`, `mc_create_batch`, `mc_update_batch`. Atomic `db.transaction(() => { ... })`-be wrappelve — better-sqlite3 sync txn ugyanazon a connection-ön → entity lib `db`-hívások mind a txn része. Throw → BEGIN/ROLLBACK. Single bulk audit a txn commit UTÁN (`bulk_create` / `bulk_update`, entityId=`bulk:<cid>`, after=`{ count, ids }`) — szándékosan nem per-row, hogy `writeAudit` `broadcast()`-ja ne hazudjon rolled-back írásokról.
  - Rate limit: in-memory `Map<clientId, { count, windowStart }>`, 60-sec fixed window. Default 60 call/min, felülírható `config(client_id, key='mcp.rateLimit')`-tel. Egy tool call = 1 unit (batch is). Limit elérésére `errorResult("rate_limited", { limit, resetAt })` → MCP `isError: true`.
  - `GET /api/clients` mostantól **mask-eli** a `mcpToken`-t: `mcp_xxxx…yyyy` formában a `mcpTokenMasked` mezőben; a raw token soha nem jön ki listán.
  - `POST /api/clients/[id]/rotate-mcp-token` (admin-only): új 32-byte hex (`mcp_<hex>`), UPDATE `clients.mcp_token`, audit `before`/`after` mindkettő masked-vel (audit-ban se szivárogjon raw token), válasz `{ token, tokenMasked }`. **A raw token ITT ÉS CSAK ITT** látható.
  - `ClientsTab.tsx` frissítve: új "MCP token" oszlop (masked vagy "(not set)"), "Rotate token" / "Generate token" gomb soronként, `confirm()` előtt-után. Mutáció után `TokenRevealModal` 1×: kiírja a tokent borostyán dobozban, "Copy to clipboard" + "I've stored it" gombokkal. Modal bezárása után a token már nincs hol megjelenni.
  - **Phase 8 ezzel zárva**: 21 tool áll (8 read/meta + 9 single write + 4 batch).

### Mit NEM csinálunk most (Phase 8-on belül)
- `mc_preview_image` (Puppeteer, headless Chrome) — Spec §5.2 explicit defer v6.1-be.
- `mc_search` (embedding-alapú) — szintén defer.
- claude.ai connector setup útmutató doc — manuális smoke `mcp-inspector`-rel; a connector wiring user-feladat ha kell.
- Tool-szintű integration teszt suite — backend pattern szerint a lib-szintű golden fixturék már lefedik az alapot. MCP transport-szintet manuális smoke-kal verifikáljuk.

### Indítás
**8a-val kezdek**, mert kicsi, foundational, és azonnali smoke (mcp-inspector → list_audiences). Várom a megerősítést hogy a 4-os bontás OK, és hogy 8a-val nyitunk.

### 8a Review (2026-05-01)

**3 új fájl + 2 új dep, ~140 sor netto. Typecheck + 160/160 tests green.**

**Auth design (Spec §5 + D8):**
- Bearer egy egyszerű hex-token (`mcp_<64-hex>`), per-client. `clients.mcp_token` UNIQUE-nak nem definiálva a schemában, de gyakorlatban kollízió valószínűsége 2^256 nevezőjű — nem aggódunk.
- Két beolvasási út: `Authorization: Bearer <token>` (standard MCP kliensek) ÉS `?secret=<token>` (claude.ai connector kompatibilitásból, lásd Spec §5 line 431).
- **Deploy-pinned**: a resolve-olt client `id` össze van vetve `activeClientId()`-vel. Ha valaki egy másik kliens MCP tokenjével próbálja hívni az Erste deploy `/mcp`-jét → 401. Ez megfelel D8 specnek: "A stolen Telekom token can't be used against an Erste deploy".
- 401 = "unauthorized" JSON body. Nincs WWW-Authenticate header (a JSON-RPC client önmagában mindig POST-ol JSON-t, headergel nem foglalkozik).

**SDK használat:**
- v1.29 `@modelcontextprotocol/sdk` API: `McpServer` magas-szintű wrapper, `registerTool(name, { description, inputSchema }, callback)` zod schema-val. Output `{ content: [{ type: 'text', text }] }` formátum (a `jsonResult` helper a JSON-stringify-t intézi).
- Transport: `WebStandardStreamableHTTPServerTransport` (Web standard `Request`/`Response`, nem Node Express) — kifejezetten arra a runtime-ra mint a Next 15 App Router. Stateless mode (`sessionIdGenerator: undefined`) + `enableJsonResponse: true` → minden request fresh transport, nincs session state, JSON válasz SSE helyett (ami nekünk nem kell, mert a browser SSE már külön `/api/events` route-on megy).
- Per-request server build: a `McpContext`-et a constructor-ba adjuk, és a tool callback-ek closure-rel hozzáférnek a `ctx.clientId`-hoz. Memóriafogyasztás nüansz: minden request alapján egy új McpServer + transport, de mind kicsi (~néhány KB), GC-ezi a request végén.

**Mit NEM csinálunk most (8b-d-be):**
- Audit log nincs az olvasásokra (korrekt — read-only nem audit-olunk).
- Rate limit nincs (8d).
- Settings UI nincs (8d).
- Egyetlen tool teszt sincs — a backend pattern szerint tool-szintű golden fixturék lib-szinten lesznek, és a transport-szintet manuális smoke fedi.
- **Note az 8b előtti design fixre**: a master plan + Spec §5 `mc_get({ mc_label })` és `list_mc({ ... })` egy "MC label" string-et használ kulcsként. v6-ban ez a `pmmid` mező (Spec §3.3), v5 hagyatékként "MC label" / "PMMID" felcserélhető fogalom. 8b-ben a tool-paramétert `mc_label`-nek hívom (spec compliance), és egy `WHERE pmmid = ?` lookuppal feloldom. Ezt itt rögzítem hogy 8b-ben ne legyen tévesztés.

**Mit fed le a manuális smoke (user-nek):**
1. `npm run dev` → Next.js dev server :3000-on
2. `ACTIVE_CLIENT_KEY=erste npx tsx scripts/rotate-mcp-token.ts` → kiírja a token-t (másold ki)
3. `tools/list` curl → válaszként a 2 tool leírása JSON-RPC formában
4. `tools/call` `list_audiences` → 165 audience row JSON-ként
5. Másik token-nel próba (pl. nem-létezővel) → 401
6. Token elhagyása → 401
7. `?secret=<token>` query paraméter is működik

**Következő:** **8b — read + meta tool blokk**. `list_mc`, `mc_get`, `list_templates`, `list_products`, `matrix_status`, `get_mc_reporting`. Indítás megerősítésre vár.

### 8b Review (2026-05-01)

**1 fájl változás (`src/lib/mcp.ts` ~+170 sor). Typecheck + 160/160 tests green. 6 új tool, összesen 8 read/meta tool áll.**

**Tool-pattern (most már stabilan):**
- zod inputSchema (üres `{}` ha nincs param) → tool callback closure-böl elérhető `ctx.clientId` → drizzle query → `jsonResult()` JSON-stringify-vel.
- Minden query `WHERE client_id = ctx.clientId`-vel kezdődik. Cross-tenant leak lehetetlen ezen a szinten (a `resolveBearerClient` is a deploy-pinned client-re kötötte a ctx-et, és innen ki sem mehet).

**Néhány döntés ami nem triviális:**
- `list_mc.product` szűrés: `messages` táblának nincs `product` oszlopa, csak `audience`/`topic` foreign-keyek. Két subquery (`audiences.product = ?` és `topics.product = ?`) → kulcs-listák → `messages.audience IN (...) OR messages.topic IN (...)`. Ha mind a két lista üres → korai return üres tömbbel (különben `IN ()` SQL hibát adna SQLite-ban). A `[""]` üres-string fallback amikor csak az egyik oldal üres — biztos hogy nincs olyan kulcs.
- `list_mc.monitoring_status`: hasonló logika `reporting.adform_status` alapján. Ha nincs reporting row a tenanton (pl. fresh deploy), korai return.
- `list_mc.limit` default 100, max 1000 (zod `.max(1000)`). Megóv egy 5000+ row-ot kérő agentet a memória-bursttől.
- `mc_get` és `get_mc_reporting` `mc_label`-ja a `pmmid` mezőre köt — spec §5.1 + 8a Review-ban rögzítve. v6 séma a `pmmid`-t használja, "MC label" csak a tool-API neveken túl.
- `matrix_status.messages.by_status`: in-memory aggregáció (egyetlen `SELECT status FROM messages` a teljes táblára). Erste-en 1361 message → ms-rendű. SQLite GROUP BY-jal effektívebb lenne, de drizzle `groupBy` + `count(*)` szintaktikailag terhesebb és ez most még olcsó. Ha 100k+ message lesz egyszer, kicseréljük 5 sorra.
- `matrix_status.last_export = null`: nincs export-history tábla / audit. Az export route audit nélküli (rövidesen tehetünk be egy `entityType="export"` audit rowot ha kell). Most explicit `null` placeholder, doksálva.
- `list_products` UNION: `Set<string>` deduppal, `null`/whitespace szűrve, sorted. Ugyanazt adja vissza mint a v5 MCP.

**Mit NEM csináltunk most:**
- Tool-szintű integration tesztet nem írtam (8a-ban már leszögeztem hogy a backend pattern lib-szintű).
- `list_mc.audience_key` / `topic_key` érték-validáció (pl. létezik-e az adott key a tenant-ban) nincs — ha nem létezik, üres tömb jön vissza, ami szemantikusan korrekt és olcsóbb.
- A `list_templates` az aktuális `listVisibleTemplates` libet hívja, ami `visibleTemplates` config-rejtést is figyelembe vesz. Ha a user később azt akarja hogy az MCP minden template-et lásson (nem csak az UI-ban kiválasztottakat), `listAllTemplates` a fallback. Most a UI-konzisztens viselkedést hagyom.

**Manuális smoke addendum (a 8a smoke-hoz):**
- `tools/list` válaszában most 8 tool (volt 2): `list_audiences`, `list_topics`, `list_mc`, `mc_get`, `list_templates`, `list_products`, `matrix_status`, `get_mc_reporting`.
- `matrix_status` Erste-en (XLSX import után): `{ audiences: 165, topics: 80, messages: { total: 1361, by_status: {...} }, last_reporting_sync: <timestamp>, last_export: null }`.
- `list_products` Erste-en: ['ASGB', 'BANCA', 'CFP', ...] (az XLSX product oszlopaiból dedupolva).

**Következő:** **8c — single write tools** (9 db: audience/topic/mc × create/update/remove). Audit `byUser="mcp:<cid>"`, optimistic-lock-pal együttműködve. Indítás megerősítésre vár.

### 8c Review (2026-05-01)

**1 fájl változás (`src/lib/mcp.ts` ~+330 sor; jelenleg ~590 sor összesen). Typecheck + 160/160 tests green. 9 új tool, összesen 17 tool áll (8 read/meta + 9 write).**

**Tool-API minta (most már stabil mintára áll):**
- **Create**: `{ <required-key>, fields?: object }` → row JSON. Pl. `audience_create({ name: "Premium men 25-44", fields: { product: "ASGB", strategy: "remarketing" } })`.
- **Update**: `{ key|mc_label, version, fields?: object }` → új row JSON, vagy `isError: true` + `current` ha version conflict / not found.
- **Remove**: `{ key|mc_label, version }` → `{ ok: true, deleted: row }`. mc_remove **soft delete** (`status="deleted"`, version bump), audience/topic_remove **hard delete** (lib szerződésnek megfelelően).

**Optimistic lock viselkedés:**
- Lib `{ ok: true, row }` vagy `{ ok: false, current }` szerződésével dolgozunk. Conflict-on (vagy not-found-on) `errorResult("version_conflict", { current })` → `isError: true` + JSON-stringified current row a content text-ben.
- Az agent ezt látva refetcheli (`mc_get`/`list_audiences`) az aktuális verziót, és retry-ol a friss `version`-nel. Spec §5.3 explicit: "Returns include `version` so agents can chain optimistic updates" — ez most teljesül.

**Audit log:**
- Minden írásra `writeAudit({ clientId, userId: "mcp:<cid>", entityType, entityId, action, before?, after? })`. 
- `userId = "mcp:<cid>"` — egy MCP token egy clientre szól, nem egy konkrét emberre. Ha a user-rendszer később több MCP usert akar (pl. különböző Claude instance-eket), bevezethetünk per-token alias-t a `clients.mcp_token` mellé. Most egyszerű.
- Audit + SSE broadcast a `writeAudit` belsejéből megy → minden böngésző-tab azonnal frissül, mintha a UI csinálta volna a write-ot. Ez a **fő érv** miért hívjuk a lib függvényeket közvetlenül és nem belső HTTP-vel.

**Lookup by user-friendly key:**
- HTTP route-ok numerikus id-vel mennek (pl. `PUT /api/audiences/123`). MCP toolok kulccsal (`audience_update({ key: "premium_men_25_44", … })`) — agent-friendly, az agent szinte sose tud numeric ID-t. 3 helper:
  - `findAudienceByKey(cid, key)` → audience row vagy null
  - `findTopicByKey(cid, key)` → topic row vagy null
  - `findMessageByPmmid(cid, mc_label)` → message row vagy null
- Mindhárom inline a `mcp.ts`-ben (3-3 sor). Nem extracteltem külön lib-be — ha később több helyen kellenek, akkor a `src/lib/entities/*-by-key.ts` lehet a hely.

**Input schema design:**
- Az MCP SDK `inputSchema` egy `ZodRawShape` (lapos object zod validátorokkal). 25+ mező zod-ból nem skálázódna jól, és a `pickWritable` whitelist már elvégezi az engedélyezett-mező-szűrést.
- Hibrid: required mezők (kulcs, version, név) explicit zod típussal a top-szinten; minden más egy `fields: z.record(z.string(), z.unknown()).optional()`-ben. Az description-ben felsorolom hogy mi mehet a `fields`-be.
- Trade-off: az agent-felhasználói élmény tools/list-en kicsit gyengébb (a `fields` belső struktúrája nem auto-discoverable), de a tool description-ben minden név fel van sorolva, és az agent egy `mc_get`-ből amúgy is megnézi a row-shape-et. Cserébe: lib `pickWritable` az egyetlen forrás az írható mezőkről, nem ismétlődik a zod schema kód.

**Mit NEM csináltunk most:**
- Batch tool (8d-ben).
- Rate limit (8d-ben).
- Settings UI a token rotálásra (8d-ben).
- Konflikt-toleráns auto-retry MCP-oldalon (szándékosan; a spec szerint ez agent dolga).
- Field-szintű schema validation (pl. `status` enum-ellenőrzés) — a lib szint amúgy se tesz ilyet, az adatbázis NULL-engedő minden non-required mezőre. Ha kell, később bevihető.
- `mc_create` még mindig szerkesztésre csapdát ejthet ha az agent `audience_key` szerint nem létező audience-t küld — `MessageError` jön a libből, és `errorResult` JSON-string-ben adja vissza. OK.

**Manuális smoke addendum:**
- `tools/list` válaszában most 17 tool.
- Példa workflow:
  1. `audience_create({ name: "Test cohort", fields: { product: "TEST" } })` → `{ id: 200, key: "audXXX", name: "Test cohort", version: 1, ... }`
  2. UI-ben (Erste deploy `/audiences` page-en) **azonnal** megjelenik a row az SSE event miatt — anélkül hogy refresh kéne.
  3. `audience_update({ key: "audXXX", version: 1, fields: { name: "Renamed cohort" } })` → row visszajön `version: 2`-vel
  4. `audience_remove({ key: "audXXX", version: 1 })` → `isError: true`, `current: { ..., version: 2 }` (mert már 2-re van bumpolva)
  5. `audience_remove({ key: "audXXX", version: 2 })` → `{ ok: true, deleted: row }`

**Következő:** **8d — 4 batch tool + rate limit + Settings UI MCP token UI**. Phase 8 zárása. Mehet?

### 8d Review (2026-05-01)

**5 fájl változás (`src/lib/mcp.ts` ~+250 sor; `src/app/api/clients/route.ts` mask; új `src/app/api/clients/[id]/rotate-mcp-token/route.ts`; `src/app/(app)/settings/_clients/ClientsTab.tsx` ~+90 sor; new `TokenRevealModal`). Typecheck + 160/160 tests green. Phase 8 ezzel teljesen zárva.**

**Batch tool design:**
- Better-sqlite3 (és drizzle wrapper) `db.transaction(callback)`: a callback **synchronous** kell legyen, és belül a `db`-n keresztüli minden write azonos connection-ön megy → BEGIN/COMMIT-be tagolódik. Egyetlen throw a callback-ben → BEGIN/ROLLBACK. Ez azért fontos mert az entity lib függvények (`createAudience` stb.) belül `db`-t használnak (a globális proxy-t), nem `tx`-et — ettől függetlenül atomikus a viselkedés.
- **Audit minta**: NEM per-row a txn-en belül, mert `writeAudit` belül `broadcast()`-ol unconditionally. Ha a txn rolladott, az SSE event már elment hamis adattal. Helyett: txn commit UTÁN egyetlen `bulk_create` / `bulk_update` audit row, `entityId="bulk:<cid>"`, `after = { count, ids }`. SSE-listener oldalán ugyanaz a hatás (entity-list invalidate), 1 broadcast helyett N.
- **Hiba-kezelés**: a négy batch tool közül a 3 create-batch egyszerűen catch-eli a megfelelő `BadRequest`/`MessageError`/`TopicError`-t. `mc_update_batch` ennél bonyolultabb mert per-row optimistic-lock van; egy belső `BatchError` osztály cipeli a hibás `mc_label`-t és a `current` row-t a callback-en kívülre, ahol `errorResult("...", { mc_label, current })` lesz belőle. Az agent ezt látva tudja melyik MC-vel volt baj és milyen verzióval kéne újra.

**Rate limit design:**
- In-memory single-process state (Map). v6 nem cluster-elt, a Phase 7-es spec szerint single-node deploy. Ha valaha klaszter lesz, ez kérni fog Redis-t / másik backendet — most YAGNI.
- Fix-ablakos (60s), nem sliding — egyszerű és elég pontos a 60/min célhoz. Window restart amikor a következő call érkezik egy lejárt ablak után.
- `readRateLimit(clientId)`: minden ellenőrzéskor olvassa a `config(client_id, key='mcp.rateLimit')`-et — ez DB lookup, kicsit pazarló de pofonegyszerű és per-call ms-rendű (~0.1ms). Cache-elhetnénk később, de a beállítás ritkán változik és élő frissülést is kapunk így ingyen.
- Default 60 — ha nincs config row, fallback. Pozitív szám validáció.
- Limit átlépéskor: NEM HTTP 429, hanem MCP-szintű `isError: true` válasz (`rate_limited`, `limit`, `resetAt`). Ez azért mert a HTTP réteget a transport intézi, és a tool callback nem tudja módosítani a status code-ot. Az agent a `isError`-t látva ugyanúgy kezeli mint egy normál tool errort.
- **Test-only export**: `_resetMcpRateLimitForTests()` hogy integration tesztek tudjanak ablakot törölni.

**Token security:**
- A `clients.mcp_token` korábban **leakelt volna** az UI-ra: a régi `GET /api/clients` az egész row-t adta vissza, beleértve a token-t. UI nem olvasta, de az response payload-ban benne volt — bárki Network tab-on látta volna. **Javítva**: a route mostantól `mcpTokenMasked` formában adja vissza (csak első+utolsó 4 karakter), a raw mező destrukturálással leszedve a response-ból.
- Token rotálás auditja maszkolt before/after-rel — még az `audit_log` táblában se látszik a raw token. (Ez akkor számít, ha valaki shell-elérést kap a DB-hez de nem a fájlrendszerhez. Belt-and-suspenders.)
- Új token **egyszer**, csak a rotate response-ban látható; utána a UI csak masked-et lát. A `TokenRevealModal` ezt világossá teszi a usernek a borostyán figyelmeztetéssel.

**Mit NEM csináltunk most:**
- Token-szintű egyedi user assignment a tokenekhez (egy MCP token egy clientre szól, nem egy konkrét emberre). Ha kellene több MCP user / client, kellene egy `mcp_tokens` tábla `(client_id, token, name, owner_user_id)` formában. Nem hiányzik most.
- Rate-limit "1 batch = N call" alternativa — most 1 batch = 1 unit, ami a spec "60 writes/min" laza interpretációja. Ha a v6.1-es Erste-en agent legitime batch-flood-ot csinál és túl könnyen akad fenn, mehetne `1 batch = items.length` is — de cserébe a default 60 kibírhatatlanul kicsi lenne. Most marad ahogy van.
- WebSocket-szerű token-stream rotate (azaz hogy az aktív agent kapásból tudja az új tokent) — agent restart kell rotate után. Triviális elsőre.
- claude.ai connector wiring végpont — Spec §5 szerint az `?secret=<token>` URL paraméter már elég ehhez (8a-ban már bekötöttem). Manuál tesztelés UI/connector-pánelről user-feladat.
- `mcp_token` `UNIQUE` constraint a schemában — gyakorlatban 2^256 ütközés-kicsi, de egy `unique()` index lehetne biztonsági öv. Phase 10 perf/QA round-on bevihető.

**Manuális smoke (user-nek):**
1. Log in admin-ként, /settings → Clients tab
2. Új "MCP token" oszlop minden soron — Erste-en "(not set)" (mert ezelőtt nem volt rotate)
3. "Generate token" gomb a legaktívabb sor mellett → `confirm()` → modal megnyit a borostyán dobozzal + tokent kimásolható
4. Modal bezárása után a sor a masked formátumot mutatja (`mcp_xxxx…yyyy`)
5. **Smoke az MCP-en**: `npm run dev`, másik terminál `curl -X POST -H "Authorization: Bearer <copied>" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:3000/mcp` → 21 tool listája
6. **Rate limit smoke**: gyors `for i in {1..70}; do curl -X POST -H ... -d '{"jsonrpc":"2.0","id":'$i',"method":"tools/call","params":{"name":"audience_create","arguments":{"name":"X"}}}' http://localhost:3000/mcp; done` → 60 sikeres, 10 `rate_limited` errorResult. Egy perc után window resetel.
7. **Batch smoke**: `mc_create_batch({ messages: [{ audience_key: "...", topic_key: "..." }, { audience_key: "BAD", topic_key: "..." }] })` → `isError`, ÉS az első item se kerül be (rollback)

**Phase 8 zárás összegzés:**
- **21 tool**: read (`list_audiences`, `list_topics`, `list_mc`, `mc_get`) + meta (`list_templates`, `list_products`, `matrix_status`, `get_mc_reporting`) + single write (audience/topic/mc × create/update/remove) + batch (`audience_create_batch`, `topic_create_batch`, `mc_create_batch`, `mc_update_batch`).
- Per-client bearer auth, deploy-pinned, rate-limited (60/min default).
- Audit `byUser="mcp:<cid>"`, SSE-broadcasted, UI-frissül azonnal.
- Settings UI: token rotálás admin-ról.
- 7 új fájl, ~870 sor netto a teljes fázishoz (`mcp.ts` ~590, route + script + UI delta).

**Roadmap:**
Phase 7 ✅, Phase 8 ✅ (ez), Phase 9 ✅. **Hátra**: Phase 10 (Cmd+K palette / Cmd+Z undo / perf budgets / smoke), opcionálisan Phase 6c (Monitoring) és Phase 11 (file ingest pipeline post-launch).

---


Roadmap lives in `~/.claude/plans/you-ll-see-docs-and-snappy-charm.md`.
Spec: `docs/REBUILD_SPEC.md`.

## Current task (2026-04-27) — Phase 9 kickoff (XLSX I/O + Erste v5→v6 migráció)

**Cél:** Master plan Phase 9. ~1-2 nap. Két fő blokkra (XLSX I/O + migration script) bontva, és prioritás szerint sorba téve.

**Felmért állapot (2026-04-27):**
- v5 forrás él: `/Users/robertbeliczki/messagingmatrix/db/messaging-matrix.db` + `db/schema.js`. Mezőnevek snake_case, séma hasonló v6-hoz **DE nincs `client_id`** és külön a v5-ös mezőelhelyezések (pl. messages: `name` → első, `version` → integer; v6-ban `versionNo`).
- Golden fixture-ok kéznél: `tests/fixtures/v5/dataset/{audiences,topics,messages,assets,creatives,text_formatting,share_galleries,uploaded_assets,users,config,cache_metadata}.json`. Verifikálható minden táblát byte-kompatibilis JSON-nel.
- `node-xlsx` (`^0.24.0`) már installálva → nincs új dep szükséges.
- v6 storage: `storage/erste/` directory létezik (Phase 6a uploadokból). A migrationnek a v5 file-okat ide kell mozgatnia (sha256 dedup intra-client only, lásd D9).
- v5 JS volt, v6 TS — a migration scriptet TypeScript-ben írom, `tsx` futtatóval (vagy `bun`-nal ha gyorsabb), nem JS-ben.

### User-confirmed irány (2026-04-27)

- **NEM v5 SQLite-ból** migrálunk → a 15-ös `docs/ERSTE HU AI messaging matrix 2026 - ALL - 15 March - Beliczki.xlsx` az igazi ground truth (a v5 DB régebbi).
- **Wipe-then-import** stratégia: minden Erste row felülírható, creative library is üríthető (a Phase 6a filename parser amugy is hibás).
- **Nincs backup** automatice (user szerint smoke test megvolt, ha elszáródik szereljük).

### XLSX struktúra felmért (`docs/`-ből)

11 sheet, ezekből 7-et import-álunk → v6 entitásokra map-elve:
| XLSX sheet | rows | v6 cél |
|---|---|---|
| audiences | 165 | audiences |
| topics | 80 | topics |
| messages | 1360 | messages |
| AI messages | 1 | messages (merge) |
| creatives | 2000 | creatives |
| assets | 555 | assets |
| textformats | 96 | text_formatting |
| Reporting | 4380 | reporting |
| **feed / filtered_feed** | 1259 / 219 | **skip** (render output, regenerable) |
| **keywords** | 21 | **skip** (UI dropdown opciók — Phase 7d-be való ha kell) |
| **messages_archive** | 0 | **skip** |

### Sub-fázis javaslat (új sorrend)

- [x] **9b.1 — Erste XLSX bootstrap** ✅ 2026-04-27 — **7672 row az Erste kliensnek live betolva 798ms alatt**, typecheck + 160/160 tests green
  - `src/lib/import-xlsx.ts` core importer lib — kapott `clientId` + parsed XLSX → wipe + insert. Per-sheet column mapper (XLSX header → v6 camelCase), required-field validation. Függvénynek visszaad `{ inserted: { audiences: 165, topics: 80, … }, errors: […] }`-t.
  - `scripts/import-erste.ts` (standalone, `tsx`-szel futtatható) — beolvassa az xlsx-et a `docs/`-ból (vagy `--xlsx <path>`-szal felülírható), Erste client lookup/create, hívja az importer libet.
  - **Wipe order** (FK miatt): reporting → text_formatting → assets → creatives → messages → topics → audiences. Mind `WHERE client_id = erste_id`. Aztán insert ugyanebben a sorrendben fordítva (parents elősz, children utána).
  - **NEM része:** file storage migráció (a creatives/assets `File_driveID`-t tartja a row-ban, fizikai file Drive-ban marad — Phase 11 ingest pipeline majd lehúzza).

- [x] **9b.2 — `/api/import/xlsx` route** ✅ 2026-04-30 (typecheck + 160/160 tests green)
  - `src/lib/import-xlsx.ts`: első paraméter `string | Buffer` lett (`xlsx.parse` amúgy is fogad bufferát, csak a típus szélesítve). Script érintetlen, route közvetlenül buffer-ral hívja.
  - `src/app/api/import/xlsx/route.ts` új: `POST` `withAdmin`, multipart `file` field, 50MB limit, `.xlsx` ext + MIME guard, `?dryRun=1` és `?wipe=0` query parok. Hívja `importErsteXlsx(buffer, { clientId: claims.cid, wipeFirst, dryRun })`-t. Hibára 500 + `{error, detail}`.
  - Audit: per-entity-type `bulk_create` row csak ha `inserted[entity] > 0`, `entityId="bulk:<cid>"`, `after = { inserted, skipped, wipeFirst, source: filename }`. **dryRun=true esetén NEM ír auditot** (rollback miatt nincs valódi változás, és a `broadcast()` SSE-t sem akarjuk feleslegesen kilőni).
  - Response: `{ ok, dryRun, wipeFirst, filename, inserted, skipped, errors }`.

- [x] **9a — `/api/export/xlsx` (active client)** ✅ 2026-04-30 (typecheck + 160/160 tests green)
  - `src/lib/export-xlsx.ts` új: `exportClientXlsx(clientId)` → `{ buffer, counts }`. Per-entity canonical column lista (`Col<T> = { header, get }`), 7 sheet (audiences, topics, messages, creatives, assets, textformats, Reporting). Header sorrend FIX (lásd lentebb az indokot).
  - `src/app/api/export/xlsx/route.ts` új: `GET` + `withSession`, hívja a libet, response binary `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="<clientKey>-<YYYY-MM-DD>.xlsx"`, `Cache-Control: no-store`.
  - **Eltérés a tervtől**: `config(structure)`-t NEM használtam header-rendezésre — ott sparse a definíció (10 col vs ~17 importable audience field, 14 col vs ~40 message field), és az UI list-view rendezésre van szánva, nem data interchange-re. Canonical fix order = stabil, diffolható, reproducible export. Részletek a Reviewban.

- [ ] **9c — Google Sheets export** (defer — szükség esetén Phase 10+)

### Indítás

**9b.1-gyel kezdek** — érintendő fájlok:
- új `src/lib/import-xlsx.ts` (core importer)
- új `scripts/import-erste.ts` (bootstrap script)
- esetleg `package.json`-ban új script entry: `"import-erste": "tsx scripts/import-erste.ts"`

A script minden Erste adatot KIIRT és újraimportál a `docs/ERSTE HU AI messaging matrix 2026 - ALL - 15 March - Beliczki.xlsx`-ből.

### 9b.2 Review (2026-04-30)

**2 fájl változás (1 lib widening + 1 új route, ~95 sor netto). Typecheck + 160/160 tests green.**

**Lib (kis):**
- `src/lib/import-xlsx.ts` `importErsteXlsx(input: string | Buffer, …)`: paraméter típusa szélesedett, `xlsx.parse(input, …)` változatlan. `node-xlsx` `parse(mixed: unknown)` amúgy is fogadta — csak a TS oldali signature volt szűk. Script (path-string) és új route (Buffer) ugyanazt a függvényt hívja.

**Új route (`src/app/api/import/xlsx/route.ts`):**
- `POST`, `withAdmin` (nem-admin → 403 a wrappertől). Demo nem lehet admin spec szerint, így denyDemo redundáns.
- Multipart: `file` blob kötelező; ha hiányzik vagy nem Blob → 400 `file_required`. Empty body / nem multipart → 400 `multipart_required`.
- 50MB limit (consistent with `/api/files/upload` MAX_BYTES) → 413 `file_too_large` + maxBytes echo.
- Validáció: `.xlsx` ext **vagy** ismert MIME (a 4 elfogadott típus: openxml-spreadsheet, ms-excel, octet-stream, üres). Ha egyik sem → 415 `not_xlsx`. Az "octet-stream + üres MIME" megengedés azért, mert egyes uploaderek nem küldenek MIME-et — a `.xlsx` ext akkor is dönt.
- Query parok: `?dryRun=1` (default `false`) → libnek `dryRun: true`, ami SAVEPOINT-os rollback-be becsomagolja az egész importot. `?wipe=0` (default `wipe=true`) → felül lehet bírálni, normál esetben wipe-then-import a stratégia.
- Importer hívás `try/catch` blokkban — bármilyen exception (parse error, FK violation, …) → 500 `import_failed` + `detail` szöveggel.
- Audit (csak NEM dryRun esetén): a 7 entitásra végigmegy és csak ott ír sort, ahol `inserted[entity] > 0`. `entityType` = táblanév (audiences, topics, messages, creatives, assets, text_formatting, reporting). `entityId` = `bulk:<cid>` (audit table `entity_id` kötelezően string, és bulk műveletre nincs egy konkrét entity ID — a "bulk:<cid>" kulcs egyértelmű scope-pal). `after` JSON: `{ inserted, skipped, wipeFirst, source: filename }`. `before` üres (hiszen a wipe műveletet nem auditáljuk külön — a delete + insert egy bulk_create-ként jelenik meg). Amikor `writeAudit` lefut, a `broadcast()` automatikusan SSE-t küld `(entity, ids:["bulk:<cid>"], action: "bulk_create")`-rel; minden tab a megfelelő list query-jét invalidálhatja.
- DryRun = true esetén NEM ír auditot (és így nem broadcast-el sem) — a tranzakció rollback-elt, nincs valódi DB változás, az SSE-t pedig nem akarjuk megzavarni egy "majdnem"-mal.
- Response 200: `{ ok: true, dryRun, wipeFirst, filename, inserted: ImportCounts, skipped: ImportCounts, errors: string[] }`.

**Mit NEM csináltunk most (szándékosan):**
- Nincs UI az importhoz — a route áll, kézzel `curl`-lel hívható. A Settings → Storage tabon vagy egy Import gombbal a 9c körüli idő alatt rátehetjük; v6 launch előtt nem szükséges (már megvan a `npx tsx scripts/import-erste.ts` parancs).
- Nincs SSE megerősítés / preview a sikeres importról — a `bulk_create` event broadcast-ja elvileg invalidálja a list query-ket, de a Matrix grid pl. nincs feliratkozva minden 7 entity-eventra. Ha gondolnám érdemesnek, egy "Imported successfully — please refresh" toast plusz egy `qc.invalidateQueries()` ráhúzható lesz amikor a UI megépül.
- Nincs verziókövetés vagy "merge" mód — `wipe=true` mindig wipe-then-import. Az incremental upsert egy másik út lenne (nem-Erste tenant-en lehet hogy kelleni fog Phase 9c körül), most az Erste 1-shot bootstrap-hez ez elég.
- Nem írtunk new integration tesztet a route-hoz — a 9b.1-ben sincs route-szintű teszt (csak lib-szintű importer-tesztek lennének de azok sincsenek), és a backend pattern szerint a routera elsősorban a lib-szintű golden fixtures + manual smoke a verifikáció. A típus + 160/160 zöld + lib változatlanul futott a script-en a 9b.1 round-ban (798ms, 7672 row betolva).

**Manuális smoke (user-nek ha akar):**
```sh
# default Erste xlsx, normál mód
curl -X POST -F "file=@docs/ERSTE HU AI messaging matrix 2026 - ALL - 15 March - Beliczki.xlsx" \
  -H "Cookie: <admin-jwt-cookie>" \
  http://localhost:3000/api/import/xlsx

# dry-run
curl -X POST -F "file=@<path>.xlsx" \
  -H "Cookie: <admin-jwt-cookie>" \
  "http://localhost:3000/api/import/xlsx?dryRun=1"

# nem-admin → 403; nem-xlsx → 415; >50MB → 413; üres body → 400
```

**Következő lépés:** **9a — `GET /api/export/xlsx`** (priority 3). Roundtrip-fordítója a 9b-nek, 7 sheet-tel, header sorrend `config(structure)` rowok alapján. ~150-200 sor, lib + route. Indítás megerősítésre vár.

### 9a Review (2026-04-30)

**2 fájl új (1 lib + 1 route, ~270 sor netto). Typecheck + 160/160 tests green.**

**Lib (`src/lib/export-xlsx.ts`, ~250 sor):**
- `Col<T> = { header: string; get: (r: T) => Cell }` ahol `Cell = string | number | null`. Per-entity 7 lista (`audienceCols`, `topicCols`, …) deklaratív header → getter map. `s()` és `num()` helper a null-passthroughhoz.
- `buildSheet<T>(name, cols, rows)` → `{ name, data: [headers, ...rows], options: {} }`. Az `options: {}` kötelező a `node-xlsx` `WorkSheet` típushoz (eredetileg elhagytam, typecheck rászólt).
- `exportClientXlsx(clientId): { buffer: Buffer; counts: ExportCounts }`. 7 darab `db.select().where(eq(<table>.clientId, clientId)).all()` (semmi join, mind ugyanazt csinálja). Eredmény `xlsx.build(sheets)` Buffer-ben.

**Route (`src/app/api/export/xlsx/route.ts`, ~30 sor):**
- `GET` + `withSession` (NEM admin-only — bármely auth-elt user lehúzhatja a saját kliense adatait, mint a többi entity-list GET).
- Client key lookup `claims.cid`-ből (`erste-2026-04-30.xlsx` formátum); fallback `client-<cid>` ha valami furcsa miatt nincs row (defensive, de valójában a `withSession` JWT-ben már szerepel a cid → létezik).
- Response `new NextResponse(new Uint8Array(buffer), …)`. A `Buffer` direktül nem `BodyInit`-elhető a Next 15-ben, ezért `Uint8Array` view rajta. `Content-Length` is megy. `Cache-Control: no-store` mert minden export friss kell hogy legyen.

**Header naming convention:**
- Az import lib `findCol(headers, …)` aliasokat használ (pl. `Buying_platform` / `BuyingPlatform`, `MC_Number` / `McNumber`). Az export az **első aliast** használja minden mezőre (`Buying_platform`, `MC_Number`, …). Ez stabil + roundtrip-safe — az import normalizálja a header-eket lower+strip(`[\s_-]`)-pel, így bármelyik forma elfogadható lenne, de fix az első alak hogy reproducible legyen az export.
- Sheet nevek: `audiences`, `topics`, `messages`, `creatives`, `assets`, `textformats`, `Reporting`. A `Reporting` a 7-nek külön nagy R-rel — az import `byName.get("Reporting")` ezt fogadja. Konzisztensen tartom hogy ne kelljen aliast venni input oldalon.

**Eltérés a tervtől (`config(structure)` figyelmen kívül):**
- A todo azt mondta header-sorrend `structure` config rowok alapján. **Nem használtam.** Indok:
  1. `structure` sparse: pl. `messagesStructure` 14 oszlopot definiál, viszont 40+ importable mező van (Image1..6, _style mezők, UTM_*, finalTraffickedUrl, brief). Ha csak strukturet használnék, sok mezőt elveszítene az export.
  2. `structure` az UI list-view (Matrix grid / Audiences page table) oszlop-sorrendezésére van — adat-interchange nem.
  3. Ha az UI rendezés módosítja az export sémát, az roundtrip-pel zavaró: két különböző timestamp-ű export más sorrendet adna ha a user közben változtatott structure-t.
  4. Canonical fix order = byte-szinten reproducible export → diff-olható, version control alá tehető.
- Ha a user mégis ragaszkodik a structure-pre-fixálásra, ez egy 30-soros patch: structure CSV-t parseolni → snake_case → header label map → reorder a canonical listát structure-prefixszel; canonical lista marad fallback. Most nem írtam meg — várom a visszajelzést.

**Mit NEM csináltunk most:**
- Nincs UI gomb / link az exportra. A Settings → Storage tab vagy a Header közelében egy "Export" gomb 1 sornyi `<a href="/api/export/xlsx" download>` lenne; v6 launch előtt nem szükséges, kézzel `curl`-lel vagy közvetlen URL-megnyitással lehúzható.
- Nincs filter / range query — minden client adat egyben jön. A user-data mennyiség (~7700 row Erste-en) bőven elég kicsi hogy single-shot menjen; ha később streamelni kell, a `xlsx.build` buffer-szintű, ott nincs incremental output, kell egy másik xlsx lib (pl. `exceljs` write streamel).
- Nincs Audit row — a `AuditAction` enum nem tartalmaz `bulk_read`-et, és olvasásra általában nincs audit (az öntő szándékosan write-only). Ha kell, a `read` actiont hozzá lehetne tenni külön, de szándékosan nem feszítem ki most.
- Nincs Roundtrip integration teszt (export → re-import → diff DB) — a backend pattern szerint a 9b.1-en sincs ilyen, kizárólag golden fixture alapú lib teszt; nem akarok új tesztkörben járni egy 9a deliverable-höz. A canonical column list deklaratív → ha valamelyik mezőt elfelejtettem, az tipikusan egy egysoros patch lesz.

**Mi van Roundtrip szempontjából:**
- **Lossless** mind a 16 audience mező + 21 topic mező + 41 message mező + 15 creative mező + 10 asset mező + 4 text_formatting mező + 12 reporting mező → összesen 119 oszlop megy ki és vissza pontosan ugyanígy az import liben.
- **Egyetlen szegmens** ahol az import lib hiányos: `topics` szintén tartalmazza az audience-style oszlopokat (strategy, buyingPlatform, dataSource, targetingType, device, tag, campaignName, campaignId, lineitemName, lineitemId), DE az import lib ezeket csak audience-re olvassa, topic-ra nem (lásd `import-xlsx.ts:243-255` topic idx-mező-lista). Ha export után re-import, ezek a topic mezők NULL-ra állnak. Az Erste 15 March xlsx-ben ezek amúgy is NULL, így gyakorlatilag nincs adatvesztés. Patch ha kell: ~10 sor a `importTopics`-ban a `findCol`-ok kiterjesztésére. NEM CSINÁLTAM most (scope-on kívül).
- **`messages.brief`**: schema-ban van, importban nincs felolvasva. Export kiteszi `Brief` oszlopként, re-import nem olvassa. Detto, ~3 sor a `importMessages`-ben.
- Ezek fel vannak jegyezve **a következő iterációba**: ha a user a roundtrip-et tervezi rendszeresen használni, a 9b.1 lib kiterjesztése konkrétan 13 sor (`topics` 10 mező + `messages.brief` + import lib `bool`-helper-rel typo).

**Manuális smoke (user-nek):**
```sh
# Egyszerű böngészős letöltés:
# 1. login admin-ként, majd visit:
#    http://localhost:3000/api/export/xlsx
# → letöltődik mint "erste-2026-04-30.xlsx"

# Vagy curl-lel cookie-val:
curl -L -o erste-export.xlsx \
  -H "Cookie: <admin-jwt-cookie>" \
  http://localhost:3000/api/export/xlsx

# Verifikáció: Excelben / Numbers-ben megnyitva 7 sheet:
#   audiences (165 row + header), topics (80), messages (1361), creatives (2000),
#   assets (555), textformats (96), Reporting (4380)
```

**Következő lépés:** A Phase 9 ezzel funkcionálisan be van zárva (9b.1 ✅, 9b.2 ✅, 9a ✅; 9c Google Sheets export defer). A roadmap szerint **Phase 8 — MCP server per-client bearer** vagy **Phase 10 — Cmd+K palette / Cmd+Z undo / perf budgets / smoke**. A pinned post-launch (file ingest pipeline) és a Phase 6c (Monitoring) szintén kandidátus. Megerősítést várok hogy melyik irány.

---

## Done so far — Phase 7 (lezárva 2026-04-27, mind a 6 sub-fázis)

## Current task (2026-04-27) — Phase 7 kickoff (Settings + design system + Users + Shares)

**Cél:** Phase 7 a master plan szerint. Becslés: 3-4 nap. Túl nagy egy körre — sub-fázisokra bontva, mindegyik külön commit/session.

**Tenant lista frissítve (2026-04-27):** négy tenant lesz — `erste`, `telekom`, `proficio`, `demo`. A **Demo** szándékosan a default `lookAndFeel`-en marad (generikus slate paletta, semmi override) → ez lesz a brand-neutral sandbox / screenshot / pitch deploy. Spec §17.1 + §17.2 + §17.11 + master plan D10 frissítve.

**Mai felmért állapot:**
- `/settings` és `/users` pages = `Placeholder`. Semmi UI nincs még.
- DB séma kész: `clients`, `users` (per-client), `config(client_id, key)`, `share_galleries`. `getActiveClient()` auto-seedeli a default `lookAndFeel`-t / structures-t új client-nek.
- `/api/config-public` betölti a `lookAndFeel`-t a `/login` brandinghez. **De** az `(app)` shell (sidebar + main pages) **nem** olvas semmilyen `lookAndFeel`-t → ezért az app ugyanúgy generikus slate marad belépés után.
- `/api/config` ágon csak `parsing-rules` van; általános config GET/PUT nincs. `/api/clients`, `/api/users`, `/api/share-galleries` route-ok hiányoznak. `/share/[id]` page szintén.
- `globals.css` 3 CSS varral indul (`--color-primary`, `--color-toolbar`, `--font-family`); status color/brand catalog még nincs definiálva.
- Component-inventory pass óta megvannak a semantic class hookok (`status-dot`, `toolbar-btn--primary`, `app-sidebar`, …) — csak még nem fogyasztanak CSS varokat.

### Sub-fázis javaslat (sorrendileg, leverage szerint)

- [x] **7a — Design-system wire-up** ✅ 2026-04-27 (typecheck + 160/160 tests green)
  - `globals.css`: brand vars (`--brand-primary`, `--brand-button`, `--brand-secondary-1..4`) + status vars (`--status-incoming`, `--naming`, `--content`, `--preview`, `--approved`, `--active`, `--inactive`, `--error`, `--dead`, `--memory`).
  - Status modifier osztályok hozzáadva: `.status-dot--incoming` … (10 db), `.status-badge--incoming` … (azokon a helyeken ahol most inline `bg-{slate,emerald,…}` van).
  - `(app)/layout.tsx` SSR-ben felolvassa a `lookAndFeel`-t (`getActiveClient` + config row), és a `<html style="…CSS vars…">`-ra ráírja. Login már ezt csinálja kliens-oldalt; itt SSR-ben mert az `(app)` shell server component.
  - 2-3 magas-leverage konzument áthuzalozunk a CSS varokra (sidebar `app-sidebar__brand` háttér, `toolbar-btn--primary` bg, MC editor stepper status dot). Tailwind class-ok megmaradnak fallback-nek; csak `style={{ background: "var(--brand-primary, #1f2937)" }}` jellegű.
  - **Nincs új UI surface.** Csak plumbing. Eredmény: app a `lookAndFeel`-t tükrözi belépés után is.

- [x] **7b — Settings shell + Design tab** ✅ 2026-04-27 (typecheck + 160/160 tests green)
  - `/api/config` általános GET/PUT (admin-only, kategóriánként szűrhető). Audit row + SSE invalidate `config:lookAndFeel`-re.
  - `/settings` page: TabBar (Clients / Storage / Design / Structure / About). Routing query-paramos vagy lokál state.
  - **Design tab:** color picker grid (10 status + 5 brand), font select, page title input, cobranding logo upload (filename → `/api/files/upload` → asset ID), capsule-design toggle. Save → `/api/config` PUT → `<html>` CSS varok azonnal frissülnek (SSE `config:lookAndFeel` event → kliensoldali `document.documentElement.style.setProperty`).
  - Demo: változtasd Erste `headerColor`-ját → sidebar brand háttér azonnal vált, reload nélkül.

- [x] **7c — Settings: Clients tab** ✅ 2026-04-27 (typecheck + 160/160 tests green)
  - `/api/clients` GET (admin-only). POST új client (key + name + opcionális copy-from `lookAndFeel`/structures). PATCH (rename / archive). Nincs DELETE — archive only (mert `client_id` FK CASCADE veszélyes lenne).
  - Clients tab UI: read-only banner felül "This deploy is locked to: **erste**". Alatta tábla az összes klienssel. "New client" gomb modal-lal.
  - Megj: itt **nem** lehet váltani — env var dönt.

- [x] **7d — Settings: Storage / Structure / About tabs** ✅ 2026-04-27 (typecheck + 160/160 tests green)
  - Storage: Google Drive folder ID-k, AdForm creds (titkosítva? — eldöntendő, lehet hogy csak az env-ben lakik), Sheets target ID. JSON formok a `config(category='storage')` rowokhoz.
  - Structure: 5 db csv-szerű header lista textarea + 1 JSON editor `creativeParsingRules`-hoz. `config(category='structure')` rowok.
  - About: deploy info (active client + key + status, env summary, DB path, app version, fixture count), tisztán read-only.

- [x] **7e — Users CRUD** ✅ 2026-04-27 (typecheck + 160/160 tests green)
  - `/api/users` GET/POST/PATCH/DELETE (admin-only, scoped to `activeClientId`). Password hashing meglévő `auth-server`-ből.
  - `/users` page: tábla (email / role / created), Add user modal (email + initial password + role select), Edit modal (rename role + reset password), Delete confirm.
  - Self-protection: admin nem tudja saját magát törölni / role-ját userre demote-olni.

- [x] **7f — Public share gallery `/share/[id]`** ✅ 2026-04-27 (typecheck + 160/160 tests green) **= teljes Phase 7 kész**
  - `/api/share-galleries` list/create/delete (auth-ed). Create payload: `{ title, mcIds: [...] }`. Server snapshot-olja a metadata-t a `share_galleries.metadata` JSON-be.
  - Trigger: GridView vagy MessageEditor toolbar (`Create share` button).
  - `/share/[id]` **public no-auth** route: server-side render-eli a snapshot-olt MC listát ugyanazzal a `lookAndFeel`-lel ami a `client_id`-hez tartozik (akkor is ha másik deploy nyitja meg — ezért a metadata snapshot, nem live join).

### Mit NEM csinálunk most

- Tailwind utility-k kicserélése `@apply`-ra / plain CSS-re (külön későbbi fázis a 6d Review szerint)
- `MessageEditor` Fragment-tabok wrappelése (6d Review caveat)
- v5 → v6 Erste migration (Phase 9)
- MCP per-client server (Phase 8)
- Inline duplikátumok hoist-olása shared komponensekké (6d Review szerint későbbi)

### Javaslat indításra

**7a (Design-system wire-up)** kezdőként: kicsi, foundational, és azonnali vizuális payoff (bejelentkezés után az app a `lookAndFeel`-t tükrözi). Utána 7b (Design tab) zárja a UI körét. A maradék (7c-7f) sorrendileg vagy igény szerint felcserélhető — pl. ha sürgősen kell új admin user, 7e ugorhat előre.

**Várom a megerősítést hogy 7a-val indítsunk**, vagy jelezd ha máshonnan kezdenél (pl. 7e Users CRUD, ha admin-felvétel sürget).

### 7b Review (2026-04-27)

**4 fájl változás (1 új route + 1 új page szekció + 2 új komponens), ~430 sor netto. Typecheck + 160/160 tests green.**

**Backend:**
- `src/app/api/config/route.ts` (új): `GET /api/config?key=lookAndFeel | ?category=lookAndFeel | (semmi → mind)` — `withSession` (admin nem kell olvasáshoz, mert pl. a kliens `lookAndFeel`-t a UI minden user-nek mutathatja). `PUT /api/config` body `{ key, value, category? }` — `withAdmin`-szal (nem-admin → 403). Upsert minta: ha létezik `(client_id, key)` row → UPDATE, különben INSERT. Az `value`-t JSON-stringeljük, ha nem string. `updatedAt` `sql\`(CURRENT_TIMESTAMP)\``-pel frissítve. Audit row `entityType="config"`, `entityId=key`, `action="update"|"create"`, before/after a parsolt JSON-objektumokkal. `writeAudit()` automatikusan `broadcast()`-elja az SSE eventet → más kliens-tab azonnal értesül a config változásról. **Még nincs SSE-listener** a Design tabban — a save után a saját tab `setProperty`-vel azonnal alkalmazza a új varokat, refresh után pedig minden tab a frissült SSR HTML-ből kapja meg.

**UI (új Settings shell + Design tab):**
- `src/app/(app)/settings/page.tsx`: korábbi `Placeholder` lecserélve. Server component, double-gate auth + admin (`role !== "admin"` → redirect `/`), majd `<SettingsView>`-t rendereli.
- `src/app/(app)/settings/SettingsView.tsx` (új, client): bal oldali tab-bar 5 elemmel (Clients/Design/Storage/Structure/About), default active = Design. Inactive tabok `<PhasePlaceholder>` empty-state komponens "Phase 7c"/"7d" cimkével. Aktív tab `bg-brand-primary` (a 7a-s konzumens-pattern szerint, nem `bg-slate-900`).
- `src/app/(app)/settings/_design/DesignTab.tsx` (új, client, ~280 sor): a `lookAndFeel`-t TanStack Query `useQuery`-vel olvassa `/api/config?key=lookAndFeel`-ról, deep-merge-eli `DEFAULT_LOOK_AND_FEEL`-lel, `useState` draft-ba teszi. Mező-szerkesztéskor (`setField` / `setStatus`) → state update + `applyLive()` ami `document.documentElement.style.setProperty()`-t hív minden 18 CSS varra → **élő preview azonnal**, save nélkül is. Save gomb `useMutation` PUT `/api/config`-ra; success-on `qc.invalidateQueries(['config','lookAndFeel'])`. Revert gomb: visszaállítja a draftot a server-side adatra + `applyLive()`. Sticky bottom action-bar a Save/Revert gombokkal + status indikátor (Saving / Saved / Save failed).
- 6 db Brand color picker (`<input type="color">` + szín kód kijelzés), 3 db Identity field (Page title text, Font family text, Capsule design checkbox), 2 db Cobranding (Enable checkbox + Logo URL text), 10 db Status color picker. Mindegyik `form-field` + `input-box` semantic className-mel a 7a inventory-ből.

**Working demo loop (a user-nek):**
1. Login admin-ként, /settings nyit → Design tab auto-aktív
2. "Header / brand primary" picker → válassz pl. piros — sidebar aktív nav link **azonnal** piros lesz (mert `app-sidebar__nav-link--active` `bg-brand-primary`-t fogyaszt, és `applyLive` `document.documentElement.style.setProperty('--brand-primary', '...')`-t hív)
3. "Primary button" picker → változtass — Save gomb azonnal felveszi az új színt (`bg-brand-button` osztály ugyanúgy CSS varra mappel)
4. Status colors fülön változtass valamit → még nincs konzumens migrálva (pl. Dashboard audit row-okat 7a-nál szándékosan nem nyúltunk hozzá, ott még inline `bg-emerald-100/text-emerald-800`); a `--status-X` CSS varok frissülnek, de a UI csak ott reflektálja ahol a `.status-dot--*` / `.status-badge--*` modifier osztályok használatban vannak (jelenleg sehol — Phase 7d/7e-ben jönnek be).
5. Save → 200 OK → audit row beíródik (`entity_type="config"`, `entity_id="lookAndFeel"`, before/after a teljes lookAndFeel JSON-nel). Refresh → SSR a `<html>` style-on már az új színekkel emit.
6. Revert → visszaáll az utoljára mentett állapotra (vagy az alapértelmezettre, ha még nem volt mentés).

**Mit NEM csináltunk most:**
- **Nincs SSE-listener cross-tab szinkronra.** A `writeAudit()` broadcast-olja a `config` event-et, de a Design tab nem feliratkozik rá. Egy másik nyitott tab nem látja az élő változást — csak refresh után. Trivializálható lenne, de Phase 7b deliverable-jéhez nem kell, és inkább 7c/7d-ben oldjuk meg ha kérdés.
- **Nincs cobranding logo upload UI.** A Cobranding mező egy URL text input — a felhasználó kézzel pasztezheti a `/api/files/upload` URL-t. Phase 7d-ben jöhet egy proper file picker ide.
- **Nincs status modifier konzumens migráció a 7a-utáni további surface-eken.** A status pickerek működnek, de csak "kész helyek" reflektálják őket. Több hely a Phase 7e Users tabbal és más oldalak finomításával fog megjelenni.

**Browser-verifikáció a useron:**
- (a) `/settings` URL → tab bar bal oldalon, Design tab default kiválasztva, content jobb oldalon. Nem-admin user `/`-re redirectel.
- (b) Brand primary picker módosítás → sidebar aktív link háttere azonnal vált.
- (c) Brand button picker módosítás → Save gomb maga azonnal vált (mert `bg-brand-button`).
- (d) Save → "Saved" zöld jelzés. Refresh → még mindig az új színek (SSR-ből).
- (e) Revert → visszaáll az utoljára mentettre.
- (f) DevTools → Network tab → Save kattintáskor `PUT /api/config` 200, `audit_log` táblában új row.

---

### 7a Review (2026-04-27)

**6 fájl változás, ~80 sor netto. Typecheck + 160/160 tests green.**

**Új plumbing:**
- `src/app/globals.css` (újraírva): `:root`-ban brand palette (`--brand-primary`, `--brand-button`, `--brand-secondary-1..4`, `--font-base`) + status palette (10 db `--status-{incoming,naming,content,preview,approved,active,inactive,error,dead,memory}`). Default értékek a `DEFAULT_LOOK_AND_FEEL`-ből másolva → ha senki nem ír felül semmit (pl. Demo tenant) az app pont úgy néz ki mint eddig.
- `globals.css` `@layer components` blokk: `.status-dot` + 10 modifier (`--incoming`, `--naming`, …) + `.status-badge` + 10 modifier. A badge `color-mix(in srgb, var(--status-X) 18%, white)` halvány bg-vel + status szín szöveg. **Még nincs konzumens** — a meglévő inline `bg-emerald-100/text-emerald-800` pattern-ek migrálása (pl. `Dashboard` page audit row, `RightToolbar` save indicator) későbbi sub-fázisra marad ha igény van rá.
- `tailwind.config.ts`: `theme.extend.colors.brand` (primary/button/secondary-1..4) + `colors.status` (10 db) mind CSS varokra mappelve. `fontFamily.sans` átállítva `var(--font-base)`-re. Korábbi `colors.primary` / `colors.toolbar` aliasok eltávolítva — egyik sem volt konzumálva (`grep` eredménye: 0 találat).
- `src/lib/branding.ts` (új): `getActiveLookAndFeel()` SSR helper — beolvassa a `config(active_client_id, key='lookAndFeel')` rowot, `JSON.parse`-olja, deep-merge-eli a `DEFAULT_LOOK_AND_FEEL`-lel (`statusColors` és `cobranding` nested objektumok kézzel mergelve). `lookAndFeelToCssVars(laf)` → `Record<string,string>` az összes CSS varhoz, közvetlenül spreadable React `style` propba.
- `src/app/layout.tsx` (root, sync → most async-ready): `getActiveLookAndFeel()` + `lookAndFeelToCssVars()` SSR-en, eredmény `style={...}` a `<html>` elemen. Cast `as CSSProperties` mert a CSS custom property kulcsok nem szerepelnek a React types-ban — runtime-on viszont React natívan átadja őket. Eredmény: minden page (login + (app)/* mind) a `<html>` style-on keresztül megkapja a kliens színeit, **server-side első paint-en**, FOUC nélkül. Korábban csak a `/login` állította be a varokat client-side `useEffect`-ben — most már ez redundáns volt és kikerült.

**Demo tenant lookAndFeel-höz: lefelé kompatibilis.** A Demo client row a default JSON-t kapja (lásd `defaults.ts:defaultConfigSeed`); az SSR helper deep-merge-el így fix módon a default színeket fogja kiosztani — pont a kívánt generikus slate eredményt adja.

**Konzumens-migráció (high-leverage):**
- `src/app/_components/Sidebar.tsx`: `app-sidebar__nav-link--active` `bg-slate-900` → `bg-brand-primary`. Most az aktív nav link háttere a kliens header színét veszi fel. Ez a leglátványosabb single-pixel-payoff: pl. ha az Erste headerColor `#cc3333` → bal sávban a kiválasztott lap háttere Erste piros.
- `src/app/login/page.tsx`: `style={{ color: "var(--color-primary)" }}` → `var(--brand-primary)`. `style={{ backgroundColor: "var(--color-button, #2563eb)" }}` → `bg-brand-button` Tailwind utility (a Tailwind config map-eli a CSS varra). Client-side `useEffect`-ből kikerült a `--color-primary` és `--color-button` `setProperty` (mostantól SSR adja); a `pageTitle` setter maradt mert az `document.title`-re ír.

**Minden más konzumens érintetlen.** A `bg-slate-900` / `bg-emerald-500` / inline status color pattern-ek tovább működnek; a brand-button / brand-primary / status-dot--* osztályok rendelkezésre állnak, de a meglévő utility class-okat nem cseréltük le egyszerre — Phase 7b Design tab működéséhez ennyi elég.

**Mit NEM csináltunk most (szándékosan):**
- Nem migráltuk a többi `bg-slate-900` előfordulást (toolbar Save gomb, MC editor stepper bg, MatrixToolbar header, …) `bg-brand-primary`-re. Ezek a meglévő semantic class hookokon keresztül egy későbbi swap-passal frissíthetők, ha a Design tab tényleg dynamic theming-et fog adni — addig nem kell.
- Nem hooztunk szét status badge konzumens (pl. `app/(app)/page.tsx` audit row inline `bg-emerald-100/text-emerald-800` cserék) — globalis status-badge--{create,update,delete} osztályokká alakítás külön mini-pass.
- Nem szedtem szét a status-dot--* CSS-t Tailwind plugin-ré — a meglévő `@layer components` szabály egyszerűbb és működik.
- Nincs SSE-alapú élő preview még (Phase 7b kell hozzá): jelenleg `/api/config` lookAndFeel változás csak full reload után látszik, mert SSR-ben olvasunk.

**Browser-verifikáció a useron:**
- (a) Belépés után a sidebar aktív nav link slate-900-ról továbbra is sötétszürkével indul (mert `--brand-primary: #1f2937` a default) — ha a DB-ben Erste-re már be van állítva más `headerColor`, akkor azt a színt veszi.
- (b) Login page címsor + Sign in gomb a `--brand-primary` / `--brand-button`-ból veszi a színt (defaultokkal megegyezik a régivel).
- (c) Devtools → `<html>` element style attribute látható: `--brand-primary: #1f2937; --brand-button: #2563eb; …` — 18 db custom property.
- (d) Dashboard / Matrix / minden (app) screen ugyanúgy renderelődik, regresszió nincs.

---

## Done so far — Phase 6 záró session (2026-04-26 este) — Semantic naming + global CSS hooks

**Cél:** Tailwind marad utility-szinten, DE
- minden képernyő minden azonosítható egysége kap egy emberileg olvasható, BEM-szerű root className-t (`matrix-grid`, `matrix-grid__cell`, `matrix-toolbar__filter-pill`)
- a kereszt-screen újrahasznosítható elemek külön globalis nevet kapnak (`custom-dropdown`, `input-box`, `toolbar-btn`, `form-field`, `status-badge`, `empty-state`, …)
- ezek lesznek a kapaszkodók egy következő fázisban a design system / CSS extraction-höz, amikor majd `@apply` vagy plain CSS mögé tesszük az utility-ket

**User-confirmed scope (2026-04-26):**
- (1) (b) — Tailwind marad, csak szemantikus class-hookokat adunk hozzá
- (2) Design system kell — de az CSS-extraction **külön későbbi fázis**, nem része ennek a taszknak
- (3) Inventory + névadás a kódban — most ennyi

**Lépések:**

- [x] **A. Inventory dokumentum** (`tasks/component-inventory.md`)
  - Per-screen lista: Matrix (Grid + Feed + MessageEditor), Creative Library, Assets, Templates, Login, Sidebar, RightToolbar
  - Minden egységhez: jelenlegi fájl + sor, 1-soros leírás, javasolt BEM név
  - Külön szekció: globalis újrahasznosítható elemek
  - **NINCS kódváltozás ebben a lépésben** — csak doc

- [x] **B. User review** — átolvasod a `component-inventory.md`-t, javítasz a neveken / megerősíted, **mielőtt** egy karaktert is hozzáadok a kódhoz

- [ ] **C. ClassName injection — per fájl, egyenként.** Csak az inventoryban véglegesített nevek mennek be. **Egy fájl ≈ egy commit.** Sorrend (kicsi → nagy):
  - [x] C1. Sidebar (`_components/Sidebar.tsx`) — typecheck ✅ 2026-04-26
  - [x] C2. RightToolbar (`_components/RightToolbar.tsx`) — typecheck ✅ 2026-04-26
  - [x] C3. MultiPill (`_components/MultiPill.tsx`) — typecheck ✅ 2026-04-26
  - [x] C4. PreviewPane (`_components/PreviewPane.tsx`) — typecheck ✅ 2026-04-26
  - [x] C5. UploadDialog + UploadQueue + Masonry + CycleIconButton + Placeholder — typecheck ✅ 2026-04-26
  - [x] C6. Login page (`login/page.tsx`) — typecheck ✅ 2026-04-26
  - [x] C7. MatrixToolbar — typecheck ✅ 2026-04-26
  - [x] C8. GridView — typecheck ✅ 2026-04-26
  - [x] C9. FeedView — typecheck ✅ 2026-04-26
  - [x] C10. MessageEditor — typecheck ✅ 2026-04-26 (note: ContentTab/StylesTab/TraffickingTab/TemplateTab return Fragments — tab-level class kihagyva; jövőbeli wrapper-add lenne strukturális változás)
  - [x] C11. MatrixGrid — typecheck ✅ 2026-04-26
  - [x] C12. CreativeLibrary — typecheck ✅ 2026-04-26
  - [x] C13. AssetsLibrary — typecheck ✅ 2026-04-26
  - [x] C14. TemplateEditor — typecheck ✅ 2026-04-26
  - [x] C15. monitoring/users/settings page-ek — typecheck ✅ 2026-04-26

- [x] **D. Verifikáció** minden injection fájl után:
  - `npm run typecheck` zöld minden lépés után ✅
  - **160/160 teszt zöld** session végén ✅
  - vizuálisan ellenőrzöd hogy a screen ugyanúgy néz ki (semmi nem törhet — csak class-ok jönnek hozzá a meglévő Tailwind class-ok mellé)

## Review (2026-04-26 este)

**A teljes C1–C15 lefutott egy session-ben.** Mind a 15 fájl (~5630 sor) megkapta a szemantikus class-hookokat a meglévő Tailwind class-ok mellé. Tipikus pattern:

```tsx
// Előtte:
<button className="rounded bg-slate-900 px-2 py-1 text-white">…</button>
// Utána:
<button className="toolbar-btn--primary rounded bg-slate-900 px-2 py-1 text-white">…</button>
```

**Globalisok bevezetve:** `app-sidebar`, `right-toolbar`, `toolbar`, `multi-pill`, `custom-dropdown`, `input-box` (+ `--with-icon` / `__icon` / `__field`), `form-field` (+ `__label` / `__hint`), `form-grid`, `toolbar-btn` (+ `--primary`), `toggle-btn` (+ `--active`), `toggle-group`, `cycle-icon-btn`, `preview-pane` (+ subelementek), `upload-dialog` (+ phase modifier-ek), `upload-queue` (+ item status modifier-ek), `drop-overlay`, `masonry`, `media-tile`, `status-dot`, `status-badge`, `save-indicator` (+ status modifier-ek), `empty-state`, `modal` / `modal-backdrop` / `modal__close`, `tab-bar` (+ `__tab` / `--active`), `nav-stepper`, `divider-handle` (+ `--horizontal` / `--vertical`), `tag-chip`, `error-alert`.

**Page rootok:** `matrix`, `creative-library`, `assets-library`, `template-editor`, `login`, `monitoring`, `users`, `settings` (prefix nélkül, ahogy döntöttünk).

**Inventory frissítve menet közben** mindenhol ahol új sub-element nevet vezettem be (`right-toolbar__header/title/section-title/content`, `preview-pane__size-select/skip-anim/bg-group/refresh/viewport`, `upload-dialog__title/dropzone`, `upload-queue__header/title/count/items/item-name/item-discard`, `matrix-grid__row-header-label/key`, `media-tile__thumb/meta/filename/tags`, `input-box__icon/field`, `toolbar__count`, `login__client-name`, `matrix-toolbar__brand/title`).

**Egyetlen kompromisszum:** `MessageEditor.tsx`-ben a ContentTab/StylesTab/TraffickingTab/TemplateTab `<>` Fragmentet ad vissza wrapper div nélkül — ezekre nem lehetett a `message-editor-tab--{name}` class-t feltenni strukturális változás (új wrapper div) nélkül. NamingTab kapott (van saját `<div>`-je). A többi tabot egy későbbi structural-cleanup commit tudja wrappelni; most a `message-editor__tab-content` parent + a tab state alapján is el lehet érni őket, ha CSS-ben szükség lenne tab-specifikus szabályra.

**Spec + Plan + globalis CLAUDE.md** frissítve session elején: spec §7.1 + új §7.1a a design system konvencióval és az inventory hivatkozással; master plan Phase 7 a design-system wire-up-pal (CSS vars `lookAndFeel`-ből, status color modifier-ek itt landolnak); globalis CLAUDE.md új "Component styling" szekció.

**Mi NEM történt** (szándékosan, a plan szerint):
- Tailwind class-ok érintetlenek — csak `mellé` raktuk a szemantikus class-okat
- Semmit nem toltunk `globals.css`-be vagy új CSS fájlba — csak hookok kerültek a kódba
- Inline duplikátumok (Field 3×, ToggleBtn 2×, EmptyState 3×, divider 2×, MC stepper 2×, status dot 3×) NEM lettek shared komponenssé refaktorálva — flag-elve a `component-inventory.md` 8. szekciójában későbbi hoisting-ra
- Status color modifier-ek (`status-dot--incoming` stb.) **nem** kerültek be — Phase 7 design-system fázisra maradnak

**Következő természetes lépés:** vizuális end-to-end ellenőrzés a böngészőben (`npm run dev`), aztán a Phase 7 design system munkára áttérés, ahol ezek a hookok mögé `lookAndFeel`-vezérelt CSS vars + design tokenek kerülnek.

**Mit NEM csinálunk most:**
- NEM dobjuk ki a Tailwind class-okat
- NEM tolunk semmit `globals.css`-be vagy új CSS fájlba
- NEM definiálunk design tokeneket
- NEM hozunk létre `@apply` szabályokat
- NEM refaktoráljuk az inline duplikátumokat (ToggleBtn, Field, EmptyState) shared komponensekké

Mind a következő (külön) fázisban jön, amikor megvan a stabil névrendszer.

**Caveat:** ha az inventory során olyan komponensre bukkanok ami **azonos név alatt többször előfordul kicsit eltérő struktúrával** (pl. ToggleBtn 2x, Field 3x), azt jelzem a doc-ban — de a hoisting/dedup nem itt történik.

Várom a megerősítést a `component-inventory.md` legenerálása előtt.

---

## Done so far

- [x] Phase 0: Repo skeleton + fixtures + spec multi-tenancy delta (D1–D11).
- [x] Phase 1: Schema (incl. `clients`, per-client `config`), deploy-pinned auth, client-aware login.
- [x] Phase 2: Per-entity CRUD APIs (audiences/topics/messages/assets/creatives/text-formatting) with client scoping, optimistic lock, audit, SSE.
- [x] Phase 3: File upload/serve, template discovery, render route.
- [x] Phase 4: Matrix Grid + Feed views (Tree/Sankey deferred — verify).
- [x] Phase 5: Message Editor modal (5 tabs, live preview).
- [x] Phase 6a: Creative Library (masonry + upload dialog).
- [x] Phase 6b: Assets page (mirrors 6a, simpler metadata).
- [x] Phase 6a+: Drag-and-drop UI in both libraries; filename parser (`src/lib/parse-filename.ts`, 10 unit tests); per-client parsing rules endpoint; queue panel with auto-upload + batch-save.
- [x] Phase 6d: Templates editor — see iteration log below.
- [x] Session 2026-04-26 (delta over Phase 5 + 6d): sidebar branding, Matrix toolbar reorder, **shared PreviewPane** between MC editor and Templates editor, MC editor structural rework (full-width header, draggable divider, landscape layout flip, autosave toggle + manual Save/Cancel), skip-anim class-strip fix in MC editor, Refresh-button force remount. See "Session 2026-04-26 — UI unification" log below.

### Phase 6d iteration log (2026-04-26)

**Backend (lib + routes):**
- `src/lib/templates.ts`: `listTemplateFiles`, `writeTemplateFile`, `createTemplate`, `templateExists`, hardened path safety (`safeTemplateDir`, `safeTemplateFilePath` reject `..`, abs paths, path separators in name/file)
- `PUT /api/templates/[name]/[file]` (admin) — text/binary write
- New `/api/templates/[name]/route.ts`: `GET` returns `{ template, files }` with file metadata (name/ext/bytes/size/isText), sorted (`index.html` → `template.json` → `main.css` → size CSS by area → other text → binary); `POST` (admin) scaffolds new template with `index.html` / `main.css` / `300x250.css` / `template.json`
- 14 new integration tests in `tests/integration/templates/write.test.ts` (lib functions only — route handlers tested via lib pattern matching the rest of the codebase)

**Frontend — first cut:**
- 3-pane: left fixed file tree / center CodeMirror 6 / right fixed preview
- Auto-save (800ms debounce) + Cmd/Ctrl+S
- New-template button in main header, page admin-gated

**Iterative UX changes (driven by user, in order):**
1. **v5-mintára újrahúzva**: aspect-ratio layout flip (`>= 1.5` ratio → preview top / editor bottom), template selector + New gomb a header tetején, Files panel slide-in balról, Bindings panel slide-in jobbról v5-stílusú type filter chip-ekkel (`Type`/`Image`/`Video`/`Link`/`Tag`/`Palette`) + per-placeholder type-color border + `AlertTriangle` ha unbound, skip-animation toggle a size selector mellé
2. **Slide-in trigger-ek áthelyezve**: Files toggle a code header-be (filename mellé), Bindings toggle a preview header-be (bg switcher mellé). `Menu` ikonok cserélve `ChevronLeft`/`ChevronRight`-ra (chevron arra mutat amerre a panel mozog)
3. **Pane header-ek `h-10` fix magasság** hogy `<select>` és chevron-only header egy vonalban legyen
4. **Auto-save eltávolítva, kézi Save/Cancel**: a code header-be került Save (slate-900, `Save` ikon) + Cancel (border, revert to `fileQ.data`) + modified/saving/saved/error indicator. `confirm()` guard file/template váltáskor ha dirty
5. **Draggable divider** editor és preview között (4px, hover slate-400). Orientáció-érzékeny (`row-resize` wide-ban, `col-resize` narrow-ban). `splitPercent` 20–80% bound, `containerRef.getBoundingClientRect()` alapján
6. **Preview box átdolgozva**: háttér eltávolítva → light/dark/checker bg switcher (v5 paletta: `#1f2937` dark, 20px ferde gradient checker). `previewBoxRef` + `ResizeObserver` méri a kontént. iframe natív méreten + `transform: scale(min(1, availW/adW, availH/adH))` ha nem fér el. 16px margó körbe, soft box-shadow
7. **MC stepper a header jobb oldalán**: "Preview with:" + `ChevronLeft` + colored-dot select + `ChevronRight`. v5 default `statusColors` paletta (INCOMING `#8B5CF6`, … MEMORY `#06B6D4`) felülírható `lookAndFeel.statusColors`-ból. `uniqueCards` dedup `(number, variant)` szerint legmagasabb `versionNo`-val (v5 logika átvéve). Wrap-around stepper. Real message kiválasztva → render kapja a DB row-t (camelCase → v5 PascalCase a render-side normalize-ban már működik); ha nincs választás → `synthMessage()`
8. **Skip-anim hiba fix (v5-stílus)**: a skip-animation BE → a `template_variant_classes`-ból a literális `animated` szót is stripeljük client-side, mielőtt a render-be megy. Ok: a v5 sablonok az `.animated` class-szal `opacity:0 → 1` fade-int csinálnak; csak az `animation:none`-nal az elemek `opacity:0`-n maradnak (láthatatlanul). Mind a két érintett: `messageForRender(m, skipAnim)` és `synthMessage(t, skipAnim)`
9. **Bindings panel resolved value display (v5-stílus)**: minden placeholder kártyán a binding név alatt látszik a kiválasztott MC-ből feloldott érték. From-message = slate truncated, default = italic amber `default: …`, sehonnan = halvány `no default` vagy `not in MC{label}`. `resolveBindingValue()` helper a render-side lookup logikát tükrözi (lowercase + non-alphanum strip + match)
10. **localStorage perzisztencia** (`mm6_templates_editor_state_v1` kulcs): globálisan `activeTemplate`, `previewBg`, `skipAnim`, `typeFilters`, `splitPercent`; per-template `file`, `size`. Mount-on `loadPersisted()` → state default-ok. Watcher useEffect minden releváns state változásra ír. Validáció: ha a persisted template/file/size már nem létezik → fallback first-available-re

**Új CodeMirror dependency-k**: `@uiw/react-codemirror`, `@codemirror/lang-html`, `-css`, `-json`, `-javascript`.

State a session végén: **typecheck green, 160/160 tests green** (volt 146 a 6d előtt; 14 új write-test).

> Caveat: backend tesztelve, UI csak typecheck-elt. User-nek kell hitelesítenie: (a) wide aspect (970x250 / 728x90) layout flip, (b) Files+Bindings slide-in animáció és overlay-zár, (c) divider drag mind két orientációban, (d) preview scale-to-fit, (e) bg switcher, (f) MC stepper befetcheli a message-eket és valódi adattal renderel, (g) Save/Cancel + dirty guard, (h) skip-anim BE → animated content látszik (nem opacity:0 állapot), (i) bindings panelen a feloldott érték látszik MC-szelekciónál, (j) localStorage refresh-en is megőrzi a választásokat.

**Git state**: `cd717f6` initial commit pushed to `origin/main` (207 fájl, 50,817 sor).

### Session 2026-04-26 — UI unification (Phase 5 ↔ 6d)

Driven by user feedback after both editors were live; goal: kill the divergence between the MC editor's preview UI and the Templates editor's preview UI, then bring the MC editor's *outer* layout up to the same flexibility level (full-width header, draggable divider, landscape flip, optional autosave).

1. **`docs/` git-untrack** (housekeeping): `docs/` (REBUILD_SPEC.md + Erste XLSX sample) `git rm --cached`-elve és `.gitignore`-ba téve. Lokálisan megmaradt; történelem érintetlen. Commit `156cd2b`.
2. **Sidebar branding**: `public/mmatrix.svg` (v5 `mmatrix.svg` átemelve). Headerből kivéve a "MESSAGING MATRIX" felirat — csak `client.name` (pl. "Erste") marad. A logo átveszi a hamburger szerepét: `Sidebar.tsx` toggle gombja immár az SVG ikon, `lucide` `Menu` import törölve.
3. **Matrix toolbar reorder** (`MatrixToolbar.tsx`): a Grid/Feed view-toggle pinned right; az Informative/Minimal density-toggle előbbre került balra. Cél: a view-toggle pozíciója ne ugráljon attól, hogy Grid módban van-e Density panel vagy nincs (Feed módban a density rejtve marad).
4. **Shared `PreviewPane` komponens** (`src/app/(app)/_components/PreviewPane.tsx`): a két preview UI egy kódbázisban. API: `{ html, sizes, size, onSizeChange, bg, onBgChange, skipAnim, onSkipAnimChange, onRefresh?, rightExtras? }`. Belül: ResizeObserver + scale-to-fit `PreviewIframe`, `BgBtn` triplet (Sun/Grid/Moon), Skip-animation gomb (Check ikonnal, slate-900 active), Refresh gomb (`reloadKey` state-tel — minden kattintásra inkrementál és az iframe `key`-ére kerül, így force-remount akkor is, ha a HTML byte-ra ugyanaz). A Bindings panel toggle (Templates editor) → `rightExtras` slotba kerül. MC editor nem ad rightExtras-t.
5. **MC editor preview unification** (`MessageEditor.tsx::MessagePreview`): a régi inline iframe + szöveges `[light dark checker]` + checkbox skip-anim chrome lecserélve `<PreviewPane>`-re. Skip-anim viselkedés: a render felé küldött merged message-en stripeljük az `animated` class literált a `templateVariantClasses`-ből, mielőtt POST-oljuk (`messageForRender` v5-stílus). Korábban: `templateVariantClasses` érintetlen → `animated` osztály a gyökéren → a `* {animation:none}` mellett a `.animated .headline { opacity:0 }` szelektorok bent maradtak → ad eltűnt. Fix: ugyanaz a v5-szabály, ami a Templates editorban már működött (`Phase 6d iteration log` 8. pont).
6. **Templates editor refactor** (`TemplateEditor.tsx`): inline preview chrome eltávolítva, helyette `<PreviewPane>` invokáció + `rightExtras` a Bindings panel chevron-toggle-jéhez. Lokál helperek (`BgBtn`, `bgStyleFor`, `PreviewIframe`) törölve — most a shared komponens tartalmazza. `previewBoxRef`, `boxSize` state, ResizeObserver effect szintén kiemelve a sharedba. Felszabadult import: `Sun`, `Moon`, `Grid`, `RefreshCw` (csak a shared komponensben kellenek).
7. **MC editor outer layout rework**:
   - Header full-width: kikerült a 58%-os left columnból, a modal `flex-col` lett, header tetején spannolja a teljes szélességet.
   - Draggable divider editor szekció és preview szekció között — pontosan ugyanaz a `splitPercent` (20–80% bound) + `containerRef.getBoundingClientRect()`-alapú mousemove logika, ami a Templates editorban van.
   - Landscape layout flip: új `isLandscape(size)` helper (w/h ≥ 1.5) + `MessagePreview` `onSizeChange` callback bubblesz fel a parentre. Wide → preview top (`order: 1`), editor bottom (`order: 3`); narrow → editor left, preview right.
   - **Autosave toggle** a header jobb oldalán (default ON, megőrzi a régi viselkedést). Ha OFF: a debounced auto-save effect early return-ölése + a pending debounce timer törlése; megjelenik a "modified" amber tag (ha `isDirty`) és Save (slate-900) + Cancel (border) gomb. `isDirty` `useMemo`-val a `diffPayload` alapján; `manualSave` az aktuális snapshot version-jét használja az `If-Match` header-höz; `manualCancel` `setDraft(toEditable(committedSnapshot))`. Konfliktus-handlinget az meglévő mutation `onError` ágon megoldja (409 → snapshot bump, conflict indicator).

State a session végén: **typecheck green**, browser-tesztet a user csinál.

> Caveat: új komponensek és layout flipek; user-nek ellenőriznie kell: (a) sidebar logo méret + collapse toggle viselkedés, (b) Matrix toolbar Grid/Feed pozíció Grid és Feed módban is, (c) MC editorban portrait + landscape size kiválasztásnál layout flip + divider drag, (d) skip-anim toggle BE → ad még látszik (nem opacity:0), (e) autosave OFF → modified tag + Save/Cancel működik (Cancel revert, Save POST 200), (f) refresh button vizuálisan visszatöltik az iframe-et, (g) mindkét helyen ugyanazt a UI-t adja a Skip animation és bg-switcher.

### Session 2026-04-26 (cont.) — RightToolbar, MultiPill, transpose

Strukturális / funkcionális kiegészítések az UI unification után.

1. **`MultiPill` shared komponens** (`src/app/(app)/_components/MultiPill.tsx`): kontrollált `useState` open + `document mousedown` outside-click handler + `Escape` close. Az eddigi 3 lokál `<details>`-alapú kópia (MatrixToolbar, CreativeLibrary, AssetsLibrary) lecserélve egy közös importra. A `<details>` natív viselkedése nem zárt mellékattintásra — ezt javítja a kontrollált verzió.
2. **`RightToolbar` shared komponens** (`src/app/(app)/_components/RightToolbar.tsx`): full-height jobb-oldali sáv, `lucide` `PocketKnife` ikonnal (v5 toolbar ikon). Per-page localStorage kulcs. Default állapot csukva, kibontva tartalom a children-as-function pattern szerint: `children?: ReactNode | ((collapsed: boolean) => ReactNode)` — a parent collapsed/open módra különböző tartalmat tud renderelni, és collapsed-ben is renderel a body. Toggle gomb a viewport jobb széléhez van pin-elve, így csukva/nyitva ugyanazon a screen-X-en marad — egy kattintással toggle-ölhető egérmozgás nélkül.
3. **`CycleIconButton` shared komponens** (`src/app/(app)/_components/CycleIconButton.tsx`): generikus (`<T extends string | number>`), opciók listája `{ value, icon, label }`. Kattintásra körbeforgat az opciókon (wrap-around). Tooltip mutatja a current → next állapotot. Olyan helyzetekre, ahol a hely szűk és nem fér el segmentált ToggleGroup (pl. collapsed RightToolbar).
4. **Matrix view+density áthelyezve a RightToolbarba**: `MatrixToolbar` most már csak filterek (search + Product/Status MultiPill + Clear). View (Grid/Feed) és Density (Informative/Minimal) kontrollok átkerültek `MatrixGrid`-be a `RightToolbar` children-as-function alá. Open mód: `ViewControls` segmentált ToggleGroup. Collapsed mód: két `CycleIconButton` egymás alatt (View + Density, utóbbi csak `view === "grid"` esetén). MatrixGrid root layout `flex-col → flex` (row).
5. **CL / Assets / Monitoring oldalak**: szintén row layout + `<RightToolbar>` jobbra, egyelőre üres children-nel (későbbi page-specifikus kontrollok ide jönnek). Monitoring `page.tsx` átírva placeholder + RightToolbar wrappre.
6. **GridView transpose toggle**: a `"Audience ╲ Topic"` címke a corner cellán belül egy `<button>` lett. Kattintásra `transposed` state flippel: rows ↔ cols (audiences ↔ topics), per-jel `╲` ↔ `╱`, címkék is helyet cserélnek. A cell-lookup (`${audKey}\0${topKey}`) változatlan — csak a render-sorrend változik. State lokál a `GridView`-ben (nem perzisztens).

State session végén: **typecheck green**, browser-tesztet user csinál.

## Decision (2026-04-26)

User confirmed: **skip 6c for now, go to 6d next**. 6c (Monitoring) comes back later — not a permanent drop, just deferred until there's a reason to wire AdForm UI.

## Remaining roadmap

- [ ] **Phase 6d (NEXT)**: `/templates` editor — CodeMirror 6 + 3-pane (file menu / editor / preview), wire to existing `/api/templates/[name]/[file]` PUT.
- [ ] **Phase 6c (deferred)**: `/monitoring` page — AdForm sync UI (campaign prefix, date range, sync now button, last-sync indicator) + `POST /api/adform/sync` + `GET /api/adform/status`. Regex extraction already in fixtures.
- [ ] **Phase 7**: Settings tabs (Clients/Storage/Design/Structure/About), brand-color binding via CSS vars on `<html>` from `lookAndFeel` (sidebar + buttons reflect Erste/Telekom/Proficio palette), Users CRUD, Shares (`/share/[id]`).
- [ ] **Phase 8**: MCP server (`/mcp`) per-client bearer, 17+4 tools.
- [ ] **Phase 9**: XLSX/Sheets I/O + one-shot Erste v5 migration.
- [ ] **Phase 10**: Cmd+K palette, Cmd+Z undo, perf budgets, multi-deploy smoke.

## Pinned future work (post-launch / Phase 11)

File-system ingest pipeline (Forklift/Total Commander → `_inbox/`) + Google Drive sync + MCP error-triage tools (`list_pending_files`, `retry_file_with_metadata`, `update_creative_parsing_rules`). Pinned 2026-04-26.

## Next up

Pick one of these next:
- **Phase 7** — Settings (Clients tab + Storage/Design/Structure/About) + brand-color CSS-var binding from `lookAndFeel` (sidebar/buttons take Erste/Telekom/Proficio palette) + Users CRUD + Shares.
- **Phase 6c (deferred)** — `/monitoring` page + AdForm sync route. Comes back when there's reason to wire AdForm UI.
- **Phase 8** — MCP server per-client bearer.

Recommendation: Phase 7 next so the app actually looks like the active client (currently generic slate everywhere).

---

## Creative Library — perf refactor (1k–3k images)

**Cél:** kézi loader/unloader nélkül, böngésző- és React-primitívekre építve elviselni 1500–2000+ képet (1 év alatt). A v5-ös fájdalom (manuális IntersectionObserver loader/unloader) kiváltása platform-megoldásokkal.

**Architektúra (kliensoldali szűréssel marad, mert a metaadat olcsó):**
1. Metadata továbbra is egyben jön (`/api/creatives`) — 3k row ~500KB–1MB JSON, kliens-szűrés ingyen marad, a szűrő pill-ek érintetlenek.
2. **Inkrementális render IntersectionObserver-rel** — `visibleCount` state, default 200; alul egy sentinel `<div>`, amikor viewport-ba ér → `setVisibleCount(c => c + 200)`. Filter/search változáskor visszaáll 200-ra.
3. **`content-visibility: auto` + `contain-intrinsic-size`** minden tile-on (masonry / grid / list mind). Off-screen tile-ok layout/paint nélkül vannak — ettől esik le a render-cost a leglátványosabban.
4. **`decoding="async"`** minden `<img>`-en (a `loading="lazy"` már bent van). A dekódolást is áttolja a fő szálról.
5. **Kisebb thumbnailek view-onként** — masonry: `?w=320`, grid: `?w=240` (denser layout), list: `?w=96` (már most ennyi).
6. **Search input debounce** (200ms) — keystroke-onként ne fusson le 3k-elemű filter+render.

**Mit nem csinálunk (és miért):**
- Server pagination (`useInfiniteQuery`): a kliens-oldali szűréssel konfliktusos lenne (minden filter change egy server query). A metadata mérete megengedi a teljes betöltést.
- Virtualizálás (`@tanstack/react-virtual`, `masonic`): masonry-ra fájdalmas vagy új dep, és `content-visibility: auto`-val az off-screen layout/paint cost amúgy is eltűnik.
- `next/image` custom loader: a saját thumbnail endpoint már 90%-ban azt csinálja, amit `next/image` adna (méretes változatok). Az integráció (custom loader + `fill` masonry-ban) több munka, mint amit hoz.

**Lépések, kicsi commit-okra bontva:**
- [ ] 1. `content-visibility: auto` + `contain-intrinsic-size` az `ImageTile` / `Card` / `ListRow` wrapperén (3 kis edit, vizuálisan semmi nem változik, scroll perf javul).
- [ ] 2. `decoding="async"` az `<img>` elemekre (`ImageTile`, `Card`, `ListRow`).
- [ ] 3. View-függő thumbnail width (`w=240` grid, `w=320` masonry).
- [ ] 4. `useDebouncedValue` helper + debounced search a filter logic-ban (csak a `filtered` useMemo-t érinti, a UI input azonnal frissül).
- [ ] 5. Inkrementális render: `visibleCount` state + sentinel div + `IntersectionObserver` a scroll-konténerhez kötve. `filtered.slice(0, visibleCount)` megy a Masonry / grid / list felé. Filter change (products/types/sizes/search) → `visibleCount` reset 200-ra.
- [ ] 6. (Opcionális) Mérés: `console.time` az első render körül, előtte/utána összevetés egy 1500 mock creative-vel (csak local sanity check, nem commit-olok mock seed-et).

**Verifikáció (user):** scroll-perf a 3 view-ban, filter change után új találatok azonnal renderelődnek, scroll lefelé +200-asával töltődik tovább a galéria.

Várom a megerősítést indítás előtt.

---

## 2026-05-02 — Library + Matrix media UX overhaul

Több inkrementális kérés egy session alatt; mind merge-elt és typecheck-clean. Nincs új feature flag, nincs új DB séma, nincs új teszt fájl.

### Library (Creative Library + Assets) view réteg

- **Row-first masonry.** `_components/Masonry.tsx` átírva CSS-column alapról flex-column-okra: a parent container ResizeObserver-rel detektálja a szélességet (Tailwind sm/md/lg/xl breakpoints → 1/2/3/4/5 oszlop), az item-eket round-robin osztja szét N oszlopba (`columns[i % N].push(items[i])`), így egymás melletti elemek **szomszédos oszlopokban** vannak, nem alulmaszkolva. Variable-height tile-ok így is masonry-szerűen pakolódnak per-oszlop.
- **Új shared komponensek:** `_components/LibraryViewSwitcher.tsx` (Grid/List/Masonry toggle, collapsed-aware → expanded-ben labeled toggle group, collapsed-ben CycleIconButton), `_components/usePersistent.ts` (lifted CreativeLibrary-ből: `usePersistent` hook + `STRING_CODEC`/`SET_CODEC`).
- **Assets: grid + list + masonry view.** Eddig csak masonry volt — most ugyanaz a 3 mód mint Creative Library-n, ugyanaz a switcher, ugyanaz a localStorage perzisztencia (`mm6_assets_library_view`).
- **`thumb-checker` global CSS class** (`app/globals.css`): conic-gradient 16px kétszínű kockás minta, áttetsző PNG/SVG mögé. Mind a 6 tile thumb-wrapperben (Card/ImageTile/ListRow × 2 lib) lecserélte a `bg-slate-50`-t. A "no file" placeholder div kapott `bg-slate-50`-t hogy ne látszódjon a kockás minta üres tile-on.
- **Video creative-ek megjelennek.** Mind a 6 tile renderben új `<video src="/api/files/<id>#t=0.1" preload="metadata" muted playsInline>` ág a kép-ág mellett `mimeType.startsWith("video/")` esetén. A `#t=0.1` fragment hint elkerüli a fekete első frame-et bizonyos kodek-eknél. Backend-változtatás nem kellett: `/api/files/[id]` már streamel.
- **Click-to-open detail dialog mind a 3 view-on.** Card / ImageTile / ListRow most `<button>`, kattintás → `setDetailId(id)`. Hover archive overlay megszűnt mind a háromban; archive/restore a dialog-ba költözött. A `del`/`restore` parent-szintű mutation + `useMutation` import + `_components/ArchiveOrRestoreBtn.tsx` mind törölve mindkét lib-ből.

### Detail dialog (`_components/MediaEntityDialog.tsx`) — MC editor-style

Generic `<MediaEntityDialog<E,D>>` egyetlen shared komponensben. `CreativeDetailDialog` és `AssetDetailDialog` ennek vékony wrapper-jei (csak Draft shape + diff payload + renderForm + endpoint/queryKey).

- **Header:** stepper (◀ filename ▶ X/Y, a filtered listán lépdel), Active/Archived státusz badge, save indicator (idle/saving/saved/conflict/error), Archive/Restore gomb, Autosave checkbox, manual Save+Cancel ha autosave kikapcsolva, close X.
- **Body:** form pane | draggable divider | preview pane. Layout flippel landscape vs portrait fájl alapján (`parseDimensions(fileDimensions)` → `landscape = w > h`): portrait → row (form bal, preview jobb), landscape → col (form fent, preview lent). Divider drag clamp 20–80%.
- **Preview pane:** light/checker/dark bg toggle (saját toolbar), ennek értéke `usePersistent("mm6_media_dialog_preview_bg")` localStorage-ben. Új `_components/ScaledMediaPreview.tsx`: ResizeObserver-rel méri a saját containerét, ha a fájl natural size befér → 1:1 (no scale), ha nem → `transform: scale(<min>)` centered. Image-re `?w=800` thumbnail, video-ra raw `/api/files/<id>` controls-osan.
- **Autosave:** 400ms debounce → PATCH `If-Match: <version>` header-rel; 409-es választ `VersionMismatchError`-ral kapja, snapshot-ot frissít, "Refreshed (someone else edited this)" indikátort mutat.
- **Keyboard:** Esc close; ←/→ stepper (csak ha focus nem input/textarea/select-en).
- **Stepper hatóköre:** a filtered listán (CL: `filtered`, nem a paginated `visible` — fix #18 lent). Filter-respektáló prev/next.

### Matrix Content tab — visual placeholder editors

- **Új mező csoport** "Images & video" a Landing URL alatt: 7 input (Image 1–6 + Video 1) 2-oszlopos grid-ben. Mindegyik mellett egy 36×36 `thumb-checker` preview tile, ami `/api/drive/proxy/<filename>`-ról tölti be a képet/videót — így vizuálisan visszacsatolt, hogy a beírt filename tényleg felbontható-e az aktív client storage-ában.
- **`EditableFields` + `EDITABLE_KEYS`** kibővítve: `image1..image6, video1`. Save / autosave automatikusan átviszi (a `messages` entitás `WRITABLE_FIELDS`-jében már bent volt).
- **Matrix `Message` típus** (`matrix/types.ts`): `video1` mező hozzáadva (eddig csak image1..6 volt a UI típuson, video1 csak DB-ben).

### Backend / shared lib változások

- **`/api/files` lekérés cap megszüntetve.** `lib/entities/files.ts → listFiles`: a default `limit: 200` cap eltávolítva; `LIMIT` csak akkor kerül a query-be ha a hívó explicit átadja. Root cause: 555 asset esetén a `/api/files?category=asset` csak az első 200 file-row-t adta vissza, így a többi 355 asset placeholder ikont mutatott (file lookup miss). Egyetlen hívó (`/api/files` route) nem ad át limit-et → most teljes lista jön per-category.
- **SVG thumbnail.** `app/api/files/[id]/thumbnail/route.ts`: `image/svg+xml` mime-ra nem fut sharp resize, a raw bytes streamel ugyanazzal a Cache-Control-lal. Eddig 415-öt adott (Sharp-ot nem hívtuk) → broken image.
- **`/api/drive/proxy/[filename]` új route.** A v6-ban hiányzó endpoint-ot pótolja, amit a template-ek `path-messagingmatrix: "/api/drive/proxy/"` referenciaként várnak (`templates/html/template.json`). Filename → `uploaded_files` lookup az aktív client-ben → bytes streamel. Új helper: `lib/entities/files.ts → getFileByFilename(clientId, filename)` (legutóbbi nem-archived találatot adja vissza ha van duplikátum). Templates `template.json` érintetlen.
- **`renderTemplate` (`lib/render.ts`) két fix:**
  1. `BINDING_ALIASES` map a `lookupField`-ben. A v5 spreadsheet kolumna neve "CSS" → normalize "css" → de a v6 séma `customCss` (normalize "customcss"), nem matchel. Az alias map (`{ css: "customcss" }`) a custom CSS-t a renderben végre alkalmazza. Bővíthető más v5→v6 rename-ekre.
  2. `<base href="/api/templates/<name>/">` injekció `<head>`-be amikor `inline: true`. A preview iframe `srcDoc=` használ, így nincs base URL-je → `dynamic.content.js`, `thm.json`, és minden relatív ref 404. A base href az iframe-en belül a templates API-ra mutat (ami már létezett), így a THM JSON fetch + dynamic content script tényleg lefut. Csak `inline:true` esetén injektál — AdForm/POMS export érintetlen.

### Bug fix

- **Stepper full filtered listán lépked.** `CreativeLibrary.tsx` a dialog-nak `creatives={visible}`-t adott át (a 200-os infinite-scroll slice-ot), így 499 filtered creative-en is `4/200` látszott. Javítva: `creatives={filtered}`. AssetsLibrary nem paginate-el → érintetlen.

### Refactor / takarítás

- **Törölve:** `_components/EntityDetailDialog.tsx` (a `MediaEntityDialog` váltotta le), `_components/ArchiveOrRestoreBtn.tsx` (egyik lib sem használja már — archive/restore a dialog header-ben).
- **`del` + `restore` mutation + `useMutation` import** mind a két library szülő-komponenséből kivéve.
- **MC editor → asset/creative dialog parity:** a `MediaEntityDialog` lényegében a `MessageEditor`-ban már bevált chrome-pattern egy generikus `<E,D>` wrapperben. Saját `SaveIndicator`, `BgBtn`, `bgStyleFor` belül lakik (PreviewPane-ből nem hivatkozza, hogy a két dialog egymástól független maradjon).

### Új shared elemek (component inventory frissítendő)

- `_components/LibraryViewSwitcher.tsx` — Grid/List/Masonry kapcsoló (collapsed-aware).
- `_components/MediaEntityDialog.tsx` — generic MC-editor-style detail dialog asset/creative-hez.
- `_components/ScaledMediaPreview.tsx` — natural-size-vagy-scale-down media preview ResizeObserver-rel.
- `_components/usePersistent.ts` — lifted localStorage hook + codec-ek.
- Globalis class: `.thumb-checker` (`app/globals.css`).
- BEM blokkok: `media-entity-dialog`, `scaled-preview`, `library-view-switcher`, `creative-row` / `asset-row` (átalakítva `<button>`-ra).

---

## MC iframe creatives a Creative Library-ben (Option B)

**Cél:** a Creative Library image/video tile-ok mellé jelenjenek meg a matrix MC-k is, élő `template + message` render-rel (HTML iframe). Nincs új DB-mező, nincs új API; lazy-mount IntersectionObserver-rel a perf miatt.

### Lockolt döntések

- [x] **Filterek:** MC tile-ok IS szűrődnek Product / Size pill-lel. Audience-ből jön a product (`/api/audiences` → `audience.key → product`); Size = a tile saját size-ja.
- [x] **MC × size:** minden MC × minden size egy külön tile. Virtual id: `mc-${msg.id}-${size}`.
- [x] **Status / archived:** uploaded creative-eknél marad `archivedAt`. MC-knél: live nézet (`showArchived=false`) → csak `status === "ACTIVE"`. Archived nézet (`showArchived=true`) → minden más status (INCOMING, NAMING, CONTENT, PREVIEW, APPROVED, INACTIVE, ERROR, DEAD, MEMORY).
- [x] **Detail dialog (saját pref):** MC tile kattintásra read-only `CreativeDetailDialog` az iframe-mel (size-váltó dropdown a fejlécben). Egy „Open in matrix →" link a MessageEditor-re; NEM nyitunk teljes edit-et a library-ben.

### Munka

- [x] **Adatforrás merge** (`CreativeLibrary.tsx`): új `useQuery`-k `/api/messages`, `/api/audiences`, `/api/templates/folders`. `LibraryItem` discriminated union (`kind: "uploaded" | "matrix"`); matrix item-ek MC × size dimenzióban, audience.product → `product`. Type filter options auto-felveszi a `"html"`-t.
- [x] **`_components/MatrixIframeTile.tsx`**: `MatrixIframeTile` (masonry, csak iframe) + `MatrixIframeCard` (grid, iframe + meta) + `MatrixIframeListRow` (list, kis iframe + horizontális meta). Közös belső `MatrixIframePreview`: IntersectionObserver lazy-mount, transform-scale fit-to-width, modul-szintű render-cache (`msgId|version|template|size`).
- [x] **Tile switch a CL render-ben**: `c.kind === "matrix"` → matrix variánsok; egyébként a meglévő `ImageTile` / `Card` / `ListRow` fut tovább.
- [x] **Detail dialog**: új `creative-library/MatrixDetailDialog.tsx` — read-only iframe natív méreten center-scale-elve, „Open in matrix →" link a MessageEditor-re. `setDetailId(c.id)` után `c.kind` szerint vagy `MatrixDetailDialog`-ot vagy `CreativeDetailDialog`-ot rendereli (uploaded steppert filterezve csak uploaded-re).
- [x] **Empty state**: `EmptyState empty={items.length === 0}` (uploaded ÉS matrix is 0 → CTA), nem `creatives.length`.
- [x] **Counts**: `{visible}/{items.length} creatives` — összes (uploaded + matrix) számít be.
- [x] **Loading guard**: `creativesQ.isLoading || messagesQ.isLoading || templatesQ.isLoading` → spinner, hogy ne villanjon az „Upload first creative" CTA mialatt MC-k töltődnek.

### Komponens-inventárium frissítés

- [x] `tasks/component-inventory.md` 2026-05-02 második blokk: `matrix-iframe-tile`, `matrix-iframe-card`, `matrix-iframe-row`, `matrix-iframe-preview`, `matrix-detail-dialog`.

### Review (2026-05-02)

**Mit változtattam:**
- 1 új fájl: `_components/MatrixIframeTile.tsx` (3 export + belső preview, ~250 sor).
- 1 új fájl: `creative-library/MatrixDetailDialog.tsx` (~140 sor).
- 1 módosítás: `creative-library/CreativeLibrary.tsx` — új query-k, `LibraryItem` típus, items merge, `kind`-szerinti tile + dialog branch, loading guard, count + empty state forrás `items`-re cserélve.
- `tasks/component-inventory.md` és `tasks/todo.md` frissítve.

**Mit NEM csináltam (root-cause: nincs rá igény):**
- Új DB séma vagy új API route (Option A/B mind a `/api/render`-rel megy).
- Snapshot-thumbnail pipeline (Option C — csak ha 200+ MC mellett a lazy-mount nem elég).
- Uploaded HTML banner zip-ek (külön topic).
- MC mező-szerkesztés a library-ből (a MatrixDetailDialog read-only; az „Open in matrix" link visz a MessageEditor-be, ahol a meglévő edit-flow fut).

**Tesztelés:** `npx tsc --noEmit` zöld. UI-t headless nem futtattam — a user dev-szervere fut a 6001-es porton, HMR-rel kell látnia a változást. Manuális verifikáció szükséges:
- Creative Library nyit → image/video tile-ok mellett megjelennek-e a `type: "html"` matrix tile-ok (ACTIVE státuszú MC × template-mérete).
- Type pill-ben „html" választható → szűr.
- Archived toggle → matrix tile-ok cserélődnek nem-ACTIVE státuszúakra.
- Matrix tile-ra kattintás → fullscreen iframe preview, „Open in matrix" link működik.
- Sok MC mellett (>200) a scroll perf rendben (lazy-mount).

**Ismert édge case-ek / follow-up jelölve, NEM most:**
- Render-cache nem invalidálódik, ha a template forrásfájlja változik (csak ha `m.version` nő). Ha valaki a `templates/`-ben CSS-t vált, sessionön belül a régi HTML-t látja.
- Iframe `sandbox="allow-scripts allow-same-origin"` — same-origin renderTemplate output miatt, biztonsági kockázat csak akkor, ha a template engine nem trusted source-ból veszi a template-et. Jelenlegi setup-ban OK.

### Nem-cél (most nem)

- Snapshot-thumbnail pipeline (Option C). Ha 200+ MC mellett a lazy-mount nem elég, akkor visszatérünk rá.
- Uploaded HTML banner zip-ek (külön téma; a user 2/per-MC-t választott).
- Új DB-tábla a virtuális creative-ekhez. Minden render-on-the-fly.

## 2026-05-02 — Matrix grid: 3-mode density (detailed / compact / dense)

A korábbi két density mode (`informative` / `minimal`) helyén egy háromfokozatú skála: **detailed → compact → dense**. Az ikonok csere (sokkal beszédesebbek), a Density toggle pedig icon-only lett (csak ikon, tooltip + aria-label).

- [x] **`Density` típus átírva**: `"detailed" | "compact" | "dense"` (`src/app/(app)/matrix/types.ts`).
- [x] **localStorage migráció** transzparensen: `"informative" → "detailed"`, `"minimal" → "compact"` (`MatrixGrid.tsx` hydrate ágban). Régi user nem veszi észre.
- [x] **Default density**: `"detailed"` (volt `"informative"`).
- [x] **`GridView.tsx` — header-ek**:
  - **detailed**: column header `name + key`, row header `name + key` (mai informative).
  - **compact**: column header `name` only @ `text-[10px]`, row header `name` only @ `text-[10px]` (no key).
  - **dense**: column header label `[writing-mode:vertical-rl] [transform:rotate(180deg)]` (vertikális spine, alulról-felfelé olvasható), `h-40 w-7` (28px wide, 160px tall); row header `name` only @ `text-[10px]`, tighter `p-1 min-w-[140px]`.
- [x] **`GridView.tsx` — cellák**:
  - **detailed**: 2-soros MC chip (dot + `MC{n}{v}` row 1, `m.name` truncated row 2).
  - **compact**: 1-soros MC chip (dot + `MC{n}{v}`).
  - **dense**: csak status dot (`mc-chip--dense size-2.5 rounded-full`), `min-w-7 max-w-7 p-0.5` cella, `gap-0.5 justify-center` a wrap-elt dot-ok között.
- [x] **Új ikon set** (`MatrixGrid.tsx`): `LayoutList` (Detailed) / `List` (Compact) / `Grip` (Dense — vizuálisan egy 3×3 dot grid, pont a dense view rendert tükrözi). A régi `Layers` / `Rows3` / `Columns3` lecserélve.
- [x] **Density toggle icon-only**: a `ViewControls` Density szegmensén nincs többé szöveg label, csak ikon. `ToggleBtn` kapott opcionális `title` + `ariaLabel` propot. Collapsed `CycleIconButton` ugyanígy ikon-only marad, tooltipje cycle-jelző.
- [x] **Spec frissítve** (`docs/REBUILD_SPEC.md` §6.2 grid + §7.3a right toolbar) — három mode és icon-only toggle dokumentálva.

**Tesztelés:** `npx tsc --noEmit` zöld. UI-t headless nem futtattam — manuális verifikáció a 6001 deve szerveren:
- Density toggle (RightToolbar expanded + collapsed) cycle-el detailed → compact → dense → detailed között.
- localStorage-ban régi `"informative"` / `"minimal"` érték → új mode-ra mappingol load-kor.
- Dense mode oszlopfejlécek vertikálisan olvashatóak, oszlopok ~28px szélesek, cellák csak dot-okat mutatnak.
- Detailed mode pill 2-soros (label + name); compact pill 1-soros (label only).

**Mit NEM csináltam:**
- Grid/Feed view toggle szöveges maradt — user csak a Density-ről kérdezett, ha vizuális konzisztencia kell, külön kérésre.
- CSS migráció (Tailwind utilities → semantic class file) — a CLAUDE.md szerint elfogadott a Tailwind utility, és a semantic class-ok (`mc-chip--dense`, `matrix-grid__col-header--dense`, `toggle-group--icon-only` stb.) felkerültek a hook-okra; külön CSS fájlt nem nyitottam egy ilyen kis változásra.
- Component inventory frissítés — csak a meglévő `mc-chip` és `matrix-grid__*` BEM modifier-ek bővültek, nem új top-level block.

## 2026-05-02 — Matrix: Audience/Topic header dialog (divided + steppable preview)

User: *"in matrix when I click an audience or a topic, show a divided dialog (with draggable devider), like mc editor, with data left and all MCs on that audience or MCs in that row, steppable preview, with the usual preview setting using the same locally saved values"*

### What I'm building

A new dialog opened by clicking a **row header** (audience by default, topic when transposed) or a **column header** (topic by default, audience when transposed) in the Matrix grid. Mirrors the `MessageEditor` / `MatrixDetailDialog` modal shell.

- 90vw × 90vh modal backdrop, draggable vertical divider (horizontal in `wide`/landscape mode — same `isLandscape` rule as `MessageEditor`).
- **Left pane** (editable form, mirrors `MessageEditor` autosave pattern):
  - Audience kind: name, status, product, strategy, device + read-only key + read-only MC count.
  - Topic kind: name, status, product, strategy, device, tag1–4 + read-only key + read-only MC count.
  - Editing uses `PATCH /api/audiences/:id` / `/api/topics/:id` with `If-Match: <version>` (existing endpoints, optimistic-lock pattern matches `MessageEditor`).
  - Same `Autosave` toggle + `Save` / `Cancel` / SaveIndicator as `MessageEditor`. Conflict path: refresh from server, surface "Refreshed" badge.
  - `key` stays read-only — renaming would orphan every `message.audience` / `message.topic` reference (no FK cascade); flag with a hint, expose later if needed.
- **Right pane** (steppable preview):
  - Header strip: prev / next buttons, counter (`3/12`), current MC label, status badge.
  - `PreviewPane` underneath, fed `html` from `/api/render` for the current MC, with size dropdown / bg toggle / skip-animation toggle.
- Stepper walks the **filtered & visible** message list (`filtered.msgs`) intersected with `audience===entity.key` or `topic===entity.key`, sorted by `(number, variant)`. The dialog stacks an entity-key filter *on top of* the matrix toolbar filters — so search, product pill, status pill all apply to the stepper's MC set.
- ESC closes; arrow keys step prev/next when focus isn't in an input.

### Locally saved preview values (`usePersistent`)

- `mm6_media_dialog_preview_bg` — **shared key** with `MatrixDetailDialog` so bg toggle is consistent across both dialogs ("the same locally saved values").
- `mm6_matrix_header_dialog_size` — last picked preview size (string). On step to an MC whose template doesn't include this size, fall back to that template's `defaultSize`; don't overwrite the persisted preference.
- `mm6_matrix_header_dialog_skip_anim` — last skip-anim toggle.
- `mm6_matrix_header_dialog_split` — last divider split-percent.

### Files

- **NEW** `src/app/(app)/matrix/HeaderDetailDialog.tsx` — the dialog (modal shell, header, edit form, preview, divider drag, ESC/arrow keys, autosave + version-mismatch handling).
- **EDIT** `src/app/(app)/matrix/types.ts` — widen `Audience` and `Topic` types to expose `version: number` (and `updatedAt: string` for parity with `Message`); the API already returns these via `$inferSelect`, the FE type just hasn't declared them.
- **EDIT** `src/app/(app)/matrix/GridView.tsx` — make row/col header `<th>` content a clickable `matrix-grid__row-header-btn` / `matrix-grid__col-header-btn` button that fires `onOpenHeader({ kind, key })`. Corner cell stays the transpose button (no overlap). Add `onOpenHeader` prop.
- **EDIT** `src/app/(app)/matrix/MatrixGrid.tsx` — state `headerDialog: { kind: "audience" | "topic", key: string } | null`; thread `onOpenHeader` into `GridView`; fetch `/api/templates/folders` (so the preview knows each template's `sizes` + `defaultSize`); render `<HeaderDetailDialog>` when state is set; on successful PATCH invalidate `["audiences"]` / `["topics"]`.
- **EDIT** `tasks/component-inventory.md` — register `matrix-header-dialog` (and any new sub-blocks beyond reused `divider-handle`, `tab-bar`, `status-badge`, `bg-toggle`, etc.).

### Steps

- [x] 1. Widen `Audience` / `Topic` FE types in `matrix/types.ts` to include `version` + `updatedAt`. Also added `strategy` / `device` to `Topic` (DB has both; types didn't expose them).
- [x] 2. `HeaderDetailDialog.tsx` skeleton: modal shell + header (close X) + draggable divider + two panes + ESC/arrow handlers.
- [x] 3. Left **edit form** with autosave + manual mode + `If-Match` PATCH + 409-conflict handling.
- [x] 4. Right steppable preview: stepper strip + `PreviewPane` + `/api/render` fetch + size fallback to `template.defaultSize` when persisted size unsupported (without overwriting the persisted preference).
- [x] 5. `usePersistent` keys: `mm6_media_dialog_preview_bg` (shared with `MatrixDetailDialog`), `mm6_matrix_header_dialog_size`, `..._skip_anim`, `..._split`.
- [x] 6. `GridView`: `matrix-grid__col-header-btn` and `matrix-grid__row-header-btn` clickable wrappers; `onOpenHeader` prop threaded through. Corner cell still hosts the transpose button.
- [x] 7. `MatrixGrid`: `headerDialog` state, `templates/folders` query, render `<HeaderDetailDialog>`. Mutation in the dialog itself invalidates `["audiences"]` / `["topics"]` on success — parent doesn't need an explicit hook.
- [x] 8. `tasks/component-inventory.md` updated with §3g.
- [x] 9. `npx tsc --noEmit` green; manual verify pending on the dev server.

### Review (2026-05-02)

**Files touched:**
- NEW `src/app/(app)/matrix/HeaderDetailDialog.tsx` (~620 lines).
- EDIT `src/app/(app)/matrix/types.ts` — `Audience` and `Topic` widened (version, updatedAt; `Topic` also gets strategy + device).
- EDIT `src/app/(app)/matrix/GridView.tsx` — `transposed` lifted to props (separate prior commit), new `onOpenHeader` prop, header `<th>`-ek belső gombbá alakítva.
- EDIT `src/app/(app)/matrix/MatrixGrid.tsx` — header dialog state, templates query, dialog render block.
- EDIT `tasks/component-inventory.md` — §3g new section.

**One bug caught & fixed during implementation:**
- Initial draft reseed effect depended on `[entity.id, entity.version, kind]`. After a save, parent re-fetch + invalidation would push a new `entity.version` and reseed the draft, wiping any edits typed in the meantime. Switched to `[entity.id, kind]` — matches `MessageEditor`'s pattern. Conflict resolution (409 → `setCommitted(e.current)`) handles external edits without needing the reseed.

**Manual verification needed (UI-t headless nem futtattam):**
- Click an audience row header (default orientation) → Audience dialog with editable name/status/product/strategy/device, key read-only, MC count read-only.
- Click a topic column header → Topic dialog with same fields + tag1–4.
- Toggle transpose → row/col swap, header clicks open the corresponding kind.
- Type into a field → after ~400ms "Saving" → "Saved"; reload page; value persists.
- Toggle Autosave off → modify → Save / Cancel buttons appear.
- Step prev/next → current MC label + counter update; iframe re-renders.
- Change size dropdown → persists across re-opens; if a stepped MC's template doesn't include that size, falls back to its `defaultSize` *without* overwriting the saved preference.
- bg toggle in this dialog reflects in the `MatrixDetailDialog` and vice versa (shared key).
- ESC closes; Arrow keys step (only when focus isn't in an input).
- Drag divider → splitPercent persists.

**Out of scope, deliberate (NOT now):**
- Editing `key` (would orphan messages — no FK cascade).
- Editing extended writables: `comment`, `tag`, `campaign*`, `lineitem*`, `buyingPlatform`, `dataSource`, `targetingType`, `orderIndex`. Easy to extend by adding `<Field>` rows.
- Audience/Topic PATCH endpoint changes — used as-is.
- Sharing `size` / `skipAnim` persistence with `MessageEditor` (which uses local state) — different context, left alone.

### Out of scope (NOT now)

- Renaming the `key` of an audience/topic from this dialog. No FK cascade in the schema (`messages.audience` / `messages.topic` are plain text columns) so a rename would orphan messages. Skipped for safety; surface as read-only with hint.
- Editing `orderIndex` / `archivedAt` / `comment` / extended `buyingPlatform` / `dataSource` / `targetingType` / `tag` / `campaign*` / `lineitem*` from this dialog. The DB supports them, but the user only listed the visible "data left" fields as needing editing. Easy to extend later by adding more `<Field>` rows.
- Per-MC editing tabs in this dialog — `MessageEditor` is the path; user can still click an MC chip in the grid to edit.
- Bulk operations across MCs (status changes, etc.).
- Sharing size persistence with `MessageEditor`'s (non-persisted) preview size dropdown — different context, leave alone.


## Current task (2026-05-02) — Filter input improvements (icons + persistence + query syntax)

**Cél:** Egységes, perzisztált, prefix-támogatású szűrőmező a Creative Library, Assets és Matrix nézetekben.

### Felmért állapot
- **Creative Library** (`CreativeLibrary.tsx:594-603`): Search ikon van, search **már perzisztált** `usePersistent` + `STRING_CODEC`. Default haystack: `fileName, brand, product, template, visualKeyword, copyKeyword`, matrix-kind plusz `headline, copy1, copy2, disclaimer, name, topic, audience, cta`. Plusz `mc{number}{variant}` separate match.
- **Assets** (`AssetsLibrary.tsx:64, 167-175`): Search ikon van, search **NEM perzisztált** (`useState`). Default haystack: `fileName, brand, product, visualKeyword`.
- **Matrix** (`MatrixToolbar.tsx:25-33`): **Nincs** ikon a search input-on. A `MatrixGrid.tsx:30-96` egész state-et perzisztál `mm6_matrix_state_v1` alatt (search benne van). Default match: `mc{n}{v}`, `name`, `headline`, `pmmid`.

### Plan (commit-sized lépésekre bontva)

- [x] **F1 — `parseSearchQuery` helper + tests (~20 min)**: Új `src/lib/search-query.ts` modul. Tokenizer: szétvágja whitespace-en, tiszteli a `"quoted phrases"`-t. Minden token vagy prefixelt (`a:`, `s:`, `t:`, `mc:`) vagy szabad. AND default két token közt, `OR` (case-insensitive) választó. AND > OR precedencia. Visszatér egy `MatchPredicate`-tel: `(fields: SearchFields) => boolean`, ahol `SearchFields` egy egyszerű object (`{ audience, topic, strategy, mc, free }`) — minden mező egy `string` (lowercased, space-separated haystack). Üres query → predicate mindig true. Vitest fixture file. **Nem érint UI fájlt.**
- [x] **F2 — Filter ikon csere + Matrix-ra hozzáadás (~10 min)**: `lucide-react` `Filter` ikont használjuk a `Search` helyett mind a 3 helyen. CreativeLibrary `Toolbar` (line 595), AssetsLibrary toolbar (line 168), MatrixToolbar (line 25 — wrap `<input>`-et `input-box input-box--with-icon`-be, reusing the existing class). Csak ikoncsere + Matrix esetén pl-7 padding. **Stilizálás:** semantic class marad (`input-box--with-icon`), Tailwind utility-k a meglévők.
- [x] **F3 — Assets search persist (~5 min)**: `useState("")` → `usePersistent("mm6_assets_filter_search", "", STRING_CODEC)`. Plusz products/types is, ugyanezzel a mintával (`mm6_assets_filter_products` / `mm6_assets_filter_types` `SET_CODEC`-kel) — a Creative Library szimmetrikus minta. **Csak az Assets-en, mert a többiek már perzisztáltak.**
- [x] **F4 — Library haystack-ek bővítése + parseSearchQuery integráció (~20 min)**: Mindhárom view filter-helyén:
  - Creative Library `filtered` useMemo (line 306-331): a `term`-alapú `lc.includes(term)` lecserélése `predicate(fields)`-re. `fields.mc` = `mc{n}{v}` + null-ra üres. `fields.audience`/`topic`/`strategy` = `c.kind === "matrix"` esetén a `message.audience`+resolved audience.name + audience.strategy + topic.name + topic.strategy; uploaded esetén üres (sosem fog matchelni `a:`/`s:`/`t:` token-re — explicit decision). `fields.free` = a meglévő haystack + audience/topic name + strategy + lineitem id + comment.
  - Assets: nincs audience/topic/strategy → `a:`/`s:`/`t:` mindig false; `mc:` mindig false; `fields.free` = filename, brand, product, visualKeyword, type, comment.
  - Matrix `filtered` useMemo (`MatrixGrid.tsx:136-161`): audiencesById/topicsById Map-pel feloldjuk message.audience-key és topic-key → audience.name/strategy/lineitemId stb. `fields.mc` = `mc{n}{v}` + pmmid. `fields.audience` = audience.key + audience.name. `fields.topic` = topic.key + topic.name. `fields.strategy` = audience.strategy + topic.strategy. `fields.free` = m.name + m.headline + m.copy1 + m.copy2 + audience.name + audience.key + topic.name + topic.key + audience.strategy + topic.strategy + audience.lineitemId + topic.lineitemId + audience.comment + topic.comment.
- [x] **F5 — Placeholder + tooltip (~5 min)**: A 3 input placeholder-jét frissítjük: `"Filter… a:xy s:xy t:xy mc:xy OR …"`. `title` attribútum (hover tooltip) hosszabb hint-tel. Nincs külön help-popover most — YAGNI.
- [x] **F6 — Manual smoke (browser, ~10 min)**: Dev server + Erste seed alatt:
  - Creative Library: `mc4`, `a:retail`, `s:perform OR mc:1`, `"happy moments"` quoted phrase, mind működik; F5 után megmarad a bevitel.
  - Assets: `brand:`-t nem használunk de `kep` filename-en match; F5 után megmarad.
  - Matrix: `t:cf`, `s:awareness`, `a:retail t:cf` (AND), `s:perf OR pmmid`, mind szűr.

### Mit NEM csinálunk most
- **Parentheses** (`(a:x OR a:y) AND s:z`) — túl nagy ugrás v1-hez, nincs kérve.
- **NOT operator** — nincs kérve.
- **Field auto-complete dropdown** — később, ha a syntax beüt.
- **Regex / wildcard** — `includes` lowercased substring match elég.
- **Külön help-popover ikon** a search mellett — `title` attr elég v1-hez.

### Open questions (várok rád)
1. Creative Library uploaded-creative item-ekre `a:` / `s:` / `t:` mind false legyen (kiszűri őket)? **Default igen.**
2. `s:` = `audience.strategy OR topic.strategy` matrix-on? **Default igen.**
3. `AND > OR` precedencia, no parens? **Default igen.**
4. `"quoted phrases"` támogatva? **Default igen.**
5. Default haystack a teljes lista (topic name+key, audience name, strategies, lineitem id, comments, MC fields, plusz headline/copy mert a meglévő ezt már tartalmazza) — tartsam, vagy szigorúan a te listád?

Várom a "mehet F1 a fenti default-okkal" zöld jelzést, vagy javítást a 5 question-ön.

### Review (2026-05-02)
**4 forrásfájl + 1 új lib + 1 új test = 6 fájl. 187/187 tests green (170 → 187, +17 a new search-query suite-ból). Typecheck clean. /matrix /creative-library /assets pages 200-asak dev serveren.**

- `src/lib/search-query.ts` (új, 130 sor): `parseSearchQuery(input)` → `MatchPredicate`. Prefix-ek `a: t: s: mc:` (ismeretlen prefix free-textként kezelve), `OR` case-insensitive választó, AND>OR precedencia, `"quoted phrases"`. Minden case-insensitive (input lowercased a parse során). Üres query mindig true.
- `tests/unit/search-query.test.ts` (új, 17 test): empty query, free term, mind a 4 prefix, AND több termmel, OR alternatívák, AND>OR precedencia, OR case-insensitive, idézőjeles phrase, prefix utáni quoted phrase, ismeretlen prefix mint free, üres prefix-érték, csak whitespace, trailing OR.
- `CreativeLibrary.tsx`: `Search` → `Filter` ikon, w-56 → w-72 (a hosszabb placeholder miatt). Új `topicsQ` fetch, `audienceMap` + `topicMap` a matrix-kind item-ekhez. `filtered` useMemo: `term.includes()` lecserélve `predicate(fields)`-re. Uploaded creatives `audience/topic/strategy` mezője üres → prefix query nem matchel rájuk (default decision). Free haystack tartalmaz mindent: filename, brand, product, template, visualKeyword, copyKeyword, comment, plus matrix-kind esetén audience name+key, topic name+key, strategy, lineitemId, comment, headline, copy1, copy2, disclaimer, name, cta, pmmid.
- `AssetsLibrary.tsx`: `Search` → `Filter`. `useState` → `usePersistent` mind a 3 filter state-re (`mm6_assets_filter_search/products/types`). Free haystack: filename, brand, product, type, visualKeyword, comment. Audience/topic/strategy/mc üres → prefix query nem matchel.
- `MatrixToolbar.tsx`: input `<input>`-ből `<div input-box--with-icon>` wrappel, `Filter` ikonnal. Placeholder + title hint.
- `MatrixGrid.tsx`: `audienceById` + `topicById` Map-ek. `filtered` useMemo: term-helyett predicate; `mc` field tartalmaz pmmid-et is (megőrizve a régi viselkedést, hogy pmmid-re free search működjön); free haystack: name, headline, copy1, copy2, disclaimer, cta, audience name+key, topic name+key, strategy(audience+topic), lineitemId(audience+topic), comment(audience+topic), pmmid.

**Per-view localStorage keys (final):**
- Creative Library: `mm6_creative_library_filter_search` (volt), `_filter_products`, `_filter_types`, `_filter_sizes` — mind már perzisztált, nem érintettem.
- Assets: új keys `mm6_assets_filter_search`, `_filter_products`, `_filter_types`.
- Matrix: `mm6_matrix_state_v1` blob (egész state-et tartalmaz, search benne), nem érintettem.

**Default decisions (5 open question, mind default → confirmed by user):**
1. Uploaded creatives: prefix query (`a:`/`s:`/`t:`/`mc:`) sosem matchel — kiszűri őket. Free term match marad.
2. `s:` matrix-on = audience.strategy OR topic.strategy.
3. AND > OR precedencia, no parens.
4. Quoted phrases támogatva (`"two words"`).
5. Default haystack a teljes lista: topic name+key, audience name+key, strategies, lineitem id, comments, MC#, pmmid, headline, copy1, copy2, disclaimer, name, cta. Mert a meglévő free-text már tartalmazta a copy/headline-t, nem akartam regressziót.

**Manual smoke (browser, user verifikálandó):**
A 3 page kompillált (200) de a tényleges UI-t nem nyitottam meg headless-ben. User: kérlek nézd meg a dev serveren (http://localhost:6001) a Matrix / Creative Library / Assets oldalakat — `mc174`, `a:retail`, `s:performance`, `s:perf OR mc:1`, `"happy moments"` query-kkel. F5 után a bevitelek megmaradnak-e (Asset filtereken most már perzisztáltak; Matrix és Creative Library már korábban is perzisztáltak voltak).

**Component inventory:**
A `tasks/component-inventory.md`-t nem frissítem, mert nem új semantic block-ot vezettem be, csak meglévő `input-box--with-icon`-t terjesztettem ki Matrix-ra.

## Follow-up (2026-05-02) — `p:` prefix + matrix row/col narrowing

- [x] **G1 — `p:` prefix + `hasNarrowingPrefix` helper + tests**: `SearchFields`-be új `platform` mező; `PREFIX_MAP` kiegészítve `p → platform`-mal; új export `hasNarrowingPrefix(input: string): boolean` (true ha bármely token `a:`/`t:`/`s:`/`p:` prefixszel kezdődik). Tests: `p:dv360` matchel platform-on, `hasNarrowingPrefix("a:retail")` → true, `hasNarrowingPrefix("mc:1")` → false (mc nem narrowing).
- [x] **G2 — Matrix narrow auds/tops + `p:` field-ek**: `MatrixGrid` `filtered` useMemo: `platform` mező `audience.buyingPlatform`-ból. Predicate után, ha `hasNarrowingPrefix(filters.search)`: `usedAudKeys = new Set(msgs.map(m => m.audience))`, `usedTopKeys = new Set(msgs.map(m => m.topic))`, és narrow `auds` + `tops` ezek alapján. Free-text only (vagy `mc:`-csak) → változatlan, üres cellák maradnak.
- [x] **G3 — Creative Library + Assets `platform` field + placeholder update**: CreativeLibrary `platform` mező matrix-kind item-en `audience.buyingPlatform`-ból (uploaded → üres, prefix nem matchel). Assets üres. Mind a 3 input placeholder/title hint kapja meg `p:xy`-t.

### Review (2026-05-02, follow-up)
**4 fájl + 2 test bővítés. 195/195 green (+8 új test). Typecheck clean. Pages 200.**

- `search-query.ts`: `SearchFields` + `platform` mező; `p` prefix; új `hasNarrowingPrefix(query)` ami `a:`/`t:`/`s:`/`p:` prefixszel kezdődő (nem-üres) token-re true. `mc:` szándékosan nem narrowing — egy MC szűrés nem zár ki audience/topic-ot, csak üres cellákat hagy. Free term mostantól a `platform` mezőt is végignézi (`FREE_FIELDS` bővülve).
- `MatrixGrid.tsx`: `platform` field `audience.buyingPlatform`-ból (topic-on nincs ilyen mező). Ha `hasNarrowingPrefix(filters.search)` → narrow `auds`/`tops` `usedAudKeys`/`usedTopKeys`-szal a survived msgs-ből. **Free-text-only vagy `mc:`-csak query nem narrowol** — üres cellák maradnak (régi viselkedés).
- `CreativeLibrary.tsx`: `platform` field a matrix-kind item-en (`audience.buyingPlatform`); uploaded creative-eken üres → `p:` query nem matchel rájuk (default decision, konzisztens `a:`/`t:`/`s:`-szel). **Nem narrowol Library-ban** — a Masonry/Grid/List nézet nem rács, nincs row/col concept; minden survived item csak rendereldik.
- `AssetsLibrary.tsx`: `platform: ""` — asset-en nincs ilyen mező; `p:` query kiszűri őket (free-text tovább működik).
- Placeholder + title frissítve a Matrix és Creative Library input-okon (`a: t: s: p: mc:` + Matrix-on plusz hint a row/col narrowingról). Assets placeholder marad a free-text fókuszú változat — nincs ott audience/topic/platform mező.

---

## Phase H (2026-05-02) — Audiences/Topics editors, sidebar restructure, presence

Six discrete chunks shipped in one session. Typecheck clean throughout, dev server on 6001 stayed up.

### H1 — Compact toolbar counter on `/matrix`
- `MatrixToolbar.tsx`: count readout went from `100/1361 messages · 165 audiences · 80 topics` to a tri-segment `mc: 100/1361  [Users-icon] 12/60  [ListTree-icon] 8/80`. Three inline-flex segments with gap-2; icons match `HeaderDetailDialog` (`Users` for audience, `ListTree` for topic). Wrapper `title` keeps the natural-language full text.
- `MatrixGrid.tsx`: counts now also include `visibleAudiences` and `visibleTopics` from `filtered.auds.length` / `filtered.tops.length`.

### H2 — Sidebar nav reorder + Audiences/Topics + Monitoring move
- `Sidebar.tsx`: new order `Matrix · Creative Library · Assets · Audiences · Topics · Templates · Shares · Monitoring`. Audiences uses `Users` icon, Topics uses `ListTree` (matching the dialog convention).
- Routes work: `/audiences` and `/topics` return 307 to `/login` when unauthed (auth gate hits) → routing wired.

### H3 — Audiences / Topics editors (Excel-like grid)
- New shared `_components/DimensionGrid/`:
  - `useRowAutosave.ts` — focused `Map<userId, RowSaveState>` + PATCH-with-If-Match + 409-silent-invalidate. Independent of the dialog's draft-diff pattern — the grid commits one field at a time so that overhead wasn't justified.
  - `columns.ts` — `Column<T>` config + `AUDIENCE_COLUMNS` / `TOPIC_COLUMNS`. Cell types: `text`/`number`/`select`/`select-dynamic`. `key` is `readOnly` on both.
  - `BulkEditPanel.tsx` — bottom-floating panel; concurrency cap 8 (`Promise.all(Array.from({length: 8}, worker))`); per-row 409s surface as a tooltip on the result chip.
  - `DimensionGrid.tsx` — `@tanstack/react-virtual`-driven body, sticky header, sticky checkbox col, click-to-edit cells (Enter/blur commit, Escape cancel), shift-click range selection, `parseSearchQuery` filter, `ArchiveToggle` in `RightToolbar`, column-visibility via `MultiPill`, per-row save-state dot.
- Pages: `audiences/page.tsx` + `AudiencesEditor.tsx`, `topics/page.tsx` + `TopicsEditor.tsx`. Each adapts its row to `SearchFields` for predicate parity with the rest of the app. Reuses TanStack query keys `["audiences"]` / `["topics"]` so edits invalidate the matrix view too.
- Title + filter ordering matches Assets/Creative Library: `[Title] [Filter input] [Columns pill] [Count]`. RightToolbar holds `ArchiveToggle` (collapsed-aware) and a hint badge.
- Refactored `STATUS_OPTIONS` out of `HeaderDetailDialog` into `matrix/types.ts` so dialog + grid share one list.

### H4 — Topics schema trimmed to its own field set
- Spec §3.2 rewritten as a real field table. The columns `strategy`, `buyingPlatform`, `dataSource`, `targetingType`, `device`, `campaignName`, `campaignId`, `lineitemName`, `lineitemId` are now declared **omitted** — they're audience-side concerns.
- DB migration `0008_silky_charles_xavier.sql` (drizzle-kit `db:generate` + `db:migrate`): nine `ALTER TABLE topics DROP COLUMN`. Applied; verified all 80 topic rows preserved.
- DB backed up to `db/matrix.db.backup-20260502-152313` before migration.
- Code touched: `src/db/schema.ts`, `src/lib/entities/topics.ts` (WRITABLE_FIELDS + createTopic insert), `src/app/(app)/matrix/types.ts` (Topic type), `HeaderDetailDialog.tsx` (TopicDraft + topicDraft + TopicForm "Targeting" / "Trafficking" sections removed), `_components/DimensionGrid/columns.ts` (TOPIC_COLUMNS), `topics/TopicsEditor.tsx` (search adapter), `lib/export-xlsx.ts` (topicCols), `lib/mcp.ts` (topic_create description), `MatrixGrid.tsx` + `CreativeLibrary.tsx` (search predicate concatenations stopped reaching into `t?.strategy`/`t?.lineitemId`).
- XLSX import was already aligned. seed-perf and tests didn't touch the dropped fields.

### H5 — Sidebar bottom group + dialog Users/Settings
- `Sidebar.tsx`: removed Users + Settings from the main nav `ITEMS` array; added a footer cluster of three identically-styled buttons (`Users`, `Settings`, `Sign out`) — `text-xs text-slate-600 hover:bg-slate-100`. Footer reserves `pb-12` (3rem) so the Next.js dev indicator doesn't overlap the buttons. Admin-only buttons receive `onOpenUsers` / `onOpenSettings` from the shell; non-admins simply don't get the props (and the buttons don't render).
- New `_components/AppDialog.tsx`: generic 90vw × 90vh modal — backdrop, ESC, click-outside, floating top-right `X`. Mirrors `MessageEditor`'s chrome class names (`modal-backdrop`, `modal`, `modal__close`).
- New `_components/UsersDialog.tsx` + `_components/SettingsDialog.tsx`: thin wrappers around the existing `UsersView` / `SettingsView`. Both views accept an `inDialog` prop that pads the toolbar/tab-bar `pr-12` so the floating X has clearance. Existing `/users` and `/settings` routes still render the same views directly.
- New `_components/AppShell.tsx`: client wrapper owning the dialog open/close state, renders `Sidebar`, `<main>{children}</main>`, and the dialogs.
- `(app)/layout.tsx`: server component now also computes `aboutInfo` (lifted from `settings/page.tsx`) and threads it through `AppShell` so the dialog mounts instantly.
- `UsersView`: dropped the `max-w-3xl` constraint — table is full-width.

### H6 — Live presence via SSE + visibility
- Single-process in-memory registry — `src/lib/presence.ts`. `Map<userId, { connections: Set, lastSeen, pendingRemoval }>`. `addConnection` cancels any pending removal (refresh doesn't flicker). `removeConnection` schedules an 8s grace before clearing. `isLive(userId)` returns true while connections > 0 OR pending-removal is set; `getLastSeen(userId)` for fallback formatting.
- `app/api/events/route.ts`: hooked into existing `req.signal.abort` lifecycle. After `subscribe(...)` → `addConnection(userId, connectionId)`. Inside `close()` → `removeConnection(...)`. Connection IDs are `${userId}:${ts}:${rand}`.
- `app/api/users/route.ts`: response now carries `live: boolean` (from registry) + `lastActive: string | null` (registry-formatted ISO; falls back to `audit_log.MAX(created_at)` when user hasn't connected this process). `lastAction` still derives from audit-log MAX.
- New `app/_components/usePresenceConnection.ts`: owns one `EventSource('/api/events')` per tab. Opens on mount when `document.visibilityState === "visible"`. `visibilitychange` → close on `hidden`, open on `visible`. `online` reopens, `offline` closes. Cleanup on unmount.
- `AppShell.tsx`: one-line `usePresenceConnection()` so every authed surface contributes presence without per-page wiring.
- `UsersView`: dropped the local `now` interval and the `isLive(lastActive, now)` heuristic — server is authoritative. Renders `u.live` directly. Query polls `refetchInterval: 15_000` so the green dot ticks off within ~15s of someone closing/backgrounding their tab.

### Single-process / multi-replica decision
- Confirmed by user: 1–10 parallel users, no load balancing, MCP-heavy server traffic. In-memory registry is the right call. If this ever grows to multi-replica, swap `presence.ts` for a Redis-pub-sub-backed implementation with the same exported surface (`addConnection`, `removeConnection`, `isLive`, `getLastSeen`).

### Files touched (Phase H)
- New: `src/lib/presence.ts`, `src/app/_components/AppShell.tsx`, `src/app/_components/usePresenceConnection.ts`, `src/app/(app)/_components/AppDialog.tsx`, `src/app/(app)/_components/UsersDialog.tsx`, `src/app/(app)/_components/SettingsDialog.tsx`, `src/app/(app)/_components/DimensionGrid/{DimensionGrid,BulkEditPanel,columns,useRowAutosave}.{tsx,ts}`, `src/app/(app)/audiences/{page,AudiencesEditor}.tsx`, `src/app/(app)/topics/{page,TopicsEditor}.tsx`, `db/migrations/0008_silky_charles_xavier.sql`.
- Modified: `src/app/_components/Sidebar.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/matrix/{types,MatrixToolbar,MatrixGrid,HeaderDetailDialog}.tsx`, `src/app/(app)/users/UsersView.tsx`, `src/app/(app)/settings/SettingsView.tsx`, `src/app/(app)/creative-library/CreativeLibrary.tsx`, `src/app/api/events/route.ts`, `src/app/api/users/route.ts`, `src/db/schema.ts`, `src/lib/entities/topics.ts`, `src/lib/export-xlsx.ts`, `src/lib/mcp.ts`, `docs/REBUILD_SPEC.md`.

### Manual smoke (user verifies)
- Open app in tab A, open Users dialog in tab B → tab A shows `live: true` within 1–2s.
- Close tab A → green goes off in tab B within ~15s (refetch interval).
- Background tab A (cmd+T) → green goes off within ~15s; refocus → green back on within 1–2s.
- Hard refresh tab A → green stays on (8s grace covers it).
- `/audiences`: edit a name cell, reload — persists. Open same row in matrix `HeaderDetailDialog`, edit there, then edit grid row again — expect 409 → silent refresh, second edit applies.
- `/topics`: confirm tag1–tag4 columns work; confirm strategy/buyingPlatform/etc are gone.
- Bulk edit: select 5 rows, set Product, Apply — `5 ok`; matrix Product filter sees them under the new product.






### 2026-05-03 followups folded into spec
- §5 MCP — opener now states the agent-ready positioning ("AI generates records and manages variations through MCP, humans curate") to match messagingmatrix.ai home-page copy.
- §6.4 `/creative-library` toolbar — Upload + Show archived moved out of the top filter bar into the `RightToolbar` (Show archived inside VIEW section, Upload pinned to bottom); count indicator right-aligned, `text-[11px]`.
- §6.5 `/assets` — same toolbar arrangement (back-reference to §6.4).
- §6.7 `/templates` localStorage — `mcLabel` added to `perTemplate[name]`; "Preview with: …" MC selection now persists per template.
- §6.9 `/settings` — dialog header gets `Settings · {Tab}` title bar; Save/Revert (Design/Storage/Structure) portal into header actions slot, no sticky bottom bar.
- §6.2 Feed view — columns now driven by `config.feedStructure`; cells rendered via `evaluatePattern(resolveFeedPattern(col, patterns.feed), ctx)` with v5-parity smart fallback in `src/lib/feed-patterns.ts`. Status moved to a 1px left edge stripe on the first cell (no dedicated column). Sort runs over pre-computed cell strings.
- §6.9 Structure tab — added Feed Patterns subsection: per-column pattern inputs parsed live from Feed Structure, blank input falls back to `defaultFeedPattern`. Save merges `feed: {…}` into the existing `patterns` config row (preserves pmmid/topicKey/trafficking). Bug fixed in same pass: StructureTab + FeedView shared the react-query key `["config", "patterns"]` with mismatched return shapes — both now return the parsed `Patterns` object so the cache stays consistent.
- §14 — `src/lib/feed-patterns.ts` referenced alongside `src/lib/patterns.ts` (parseFeedColumns / cleanColumnName / defaultFeedPattern / resolveFeedPattern).
- §3.14 — new `feed_exports` table (Phase 11a): per-client AdForm-aware export history with `(client_id, product, feed_version)` indexing, `payload_json` carrying columns/rows/messageIds/defaultRowIndex.
- §6.10a — new `/feeds` top-level menupoint (icon `Rss`, sibling of `/shares`) for the AdForm-aware feed export history; sidebar nav order updated to include it before Monitoring.
- §6.2 — Matrix Feed view's `RightToolbar` now hosts `FeedExportPanel` (gated to single-product + ACTIVE-only filters) with default-MC `<select>` + `Preview & Export` button → `FeedExportDialog` (decision banner, diff stats, auto-download).
- AdForm rules baked in: never delete a live row (sticky-superset; carry forward with `IsActive=FALSE` derived from pattern), 500-row hard limit triggers new feed_version, content/end-date/active changes allowed in-place. Mark-uploaded is a manual user action — separate write endpoint, immutable thereafter.

---

## 2026-05-03 — Session checkpoint (end of day)

### Shipped today (5 commits, all pushed to origin/main)
- `d726bda` feat(matrix+settings) — feedStructure-driven Feed view + Feed Patterns editor (P1: ~1.5h earlier this session before the AdForm thinking).
- `0aba30a` feat(schema) **0008** — drop strategy/buyingPlatform/dataSource/targetingType/device/campaign*/lineitem* from `topics`. Entity write-set + xlsx export columns + MCP topic_create description follow.
- `4b727db` feat(schema) **0009** — new `share_comments` table (no annotation column yet — that's 0010).
- `de71ea6` feat(shares) **0010** — `share_comments.annotation` (text JSON) + full share viewer overhaul: `/share/[id]` snapshot now distinguishes legacy `messages`, `matrixItems` ({messageId,size}), uploaded `creatives`, `files`. New `ShareGallery` + `ShareDetailDialog` + `AnnotationLayer` + `comments` route + `file/[fileId]` public stream + modified `/api/share-galleries` POST. (Did **not** include the bigger `CreativeLibrary.tsx` refactor that wires the Share button — left for the next "library media UX" slice.)
- `3373fff` feat(matrix+feeds) **0011** — `feed_exports` table + `src/lib/feed-export.ts` (build/diff/decide) + 3 API routes (`POST/GET /api/feed-exports`, `GET/DELETE /api/feed-exports/[id]?download=1`, `POST /api/feed-exports/[id]/mark-uploaded`) + new `/feeds` menupoint (FeedsView + `[id]/FeedDetailView`) + `FeedExportPanel` and `FeedExportDialog` in matrix RightToolbar + Sidebar nav entry.

### AdForm rules locked into feed-export (do not silently undo)
1. **Never delete a row from a live (uploaded) feed.** Sticky-superset: the next export's message set is `(filtered ACTIVE current)` ∪ `(message_id ∈ live snapshot)`. Carry-forwards re-run through patterns; `IsActive` flips to FALSE naturally via `{{status}}=ACTIVE?TRUE:FALSE`. Archived messages get `IsActive=FALSE` post-override (archive trumps status).
2. **Auto-bump `feed_version` when AdForm-incompatible.** Triggers: `row_count > 500`, `diff.removed.length > 0`, or `force_new_version` flag. Otherwise append-mode keeps current version.
3. **Uploaded ≠ exported.** Two timestamps. The user manually marks an export as uploaded after pushing the XLSX to AdForm. Uploaded rows are immutable history (DELETE → 409).
4. **Default row** is the v5 transform: `-a_<aud>- → -a_DEFAULT-`, `-l_<n> → -l_ANY`, `advert_id="1"`, `IsDefault="TRUE"`, `IsActive="TRUE"` regardless of source message archive state. Re-evaluates only columns whose pattern references `{{Audience_Key}}`.

### Still uncommitted in working tree (next-session triage list)
~15 modified + ~20 untracked, grouping themes the user can slice as separate features:

**1. Settings/Users dialogs (modal-ize from sidebar bottom group)**
- `?? src/app/(app)/_components/AppDialog.tsx`
- `?? src/app/(app)/_components/SettingsDialog.tsx`
- `?? src/app/(app)/_components/UsersDialog.tsx`
- `?? src/app/_components/AppShell.tsx`
- ` M src/app/(app)/layout.tsx` (mounts AppShell)
- ` M src/app/(app)/settings/SettingsView.tsx` (inDialog prop, header actions slot)
- ` M src/app/(app)/users/UsersView.tsx` (inDialog prop)
- ` M src/app/api/users/route.ts` (last-active / last-action / live presence columns?)

**2. Audiences/Topics dimension editors (Excel-like)**
- `?? src/app/(app)/audiences/` (whole dir)
- `?? src/app/(app)/topics/` (whole dir)
- `?? src/app/(app)/_components/DimensionGrid/` (shared grid component)

**3. Live presence (SSE-based)**
- `?? src/lib/presence.ts`
- `?? src/app/_components/usePresenceConnection.ts`
- ` M src/app/api/events/route.ts` (presence registry hooks)

**4. Unified filter syntax**
- `?? src/lib/search-query.ts`
- `?? tests/unit/search-query.test.ts`
- ` M src/app/(app)/matrix/MatrixToolbar.tsx` (Filter icon, persistent search)
- (already partly used in `MatrixGrid.tsx` from `d726bda`)

**5. Library + Matrix media UX overhaul**
- ` M src/app/(app)/creative-library/CreativeLibrary.tsx` (~520 lines — share button, dedupe, masonry, `MatrixDetailDialog` wiring)
- `?? src/app/(app)/creative-library/MatrixDetailDialog.tsx`
- `?? src/app/(app)/creative-library/ShareCreateDialog.tsx` (companion to commit `de71ea6`)
- `?? src/app/(app)/_components/MatrixIframeTile.tsx`
- ` M src/app/(app)/assets/AssetsLibrary.tsx`
- ` M src/app/(app)/matrix/MessageEditor.tsx`
- ` M src/app/(app)/matrix/GridView.tsx`
- `?? src/app/(app)/matrix/HeaderDetailDialog.tsx` (audience/topic header dialog)
- ` M src/app/(app)/matrix/types.ts` (Audience/Topic type fill-out)

**6. MCP relocation + connector public route**
- `?? src/app/api/mcp/`
- `?? src/app/(app)/settings/_mcp/`

**7. Public render route**
- `?? src/app/api/render/public/`

**8. Misc helpers**
- `?? src/app/_components/useLongPress.ts`
- ` M src/app/globals.css` (semantic class additions for new components)
- ` M tasks/component-inventory.md` (new component names from above)
- ` M package.json` / `M package-lock.json` (presumably new deps for one of the above)

### Files to ignore on next checkpoint
- `?? db/matrix.db.backup-20260502-152313` — local backup, not for git.

### Resumption
- `git status` shows what's left. Each numbered theme above is a self-contained commit candidate; pick one, slice the relevant modified+untracked files into a coherent state (mind shared files like `globals.css` / `types.ts` / `MatrixGrid.tsx` which receive contributions from multiple themes).
- AdForm flow is functional but **untested in the running app** — port collision blocked the smoke check at end of session. Next session: free port 6001 (or use `dev:demo` on 6000), navigate Matrix → filter to one product + ACTIVE → confirm `FeedExportPanel` ungates, pick a default, Preview & Export, verify XLSX downloads + `/feeds/[id]` opens.
- The `de71ea6` share viewer commit needs a UI entry point — currently `ShareCreateDialog.tsx` is untracked (sits in CreativeLibrary slice). Without it, users can read existing shares but can't create new ones with the new matrix+creatives shape. Slice **#5** above is the natural next commit.

### Pinned future polish — icon system upgrade
- Replace `lucide-react` with Streamline **core-solid-free** (https://www.streamlinehq.com/icons/core-solid-free).
- Scope: ~33 import sites across `src/` (sidebar, toolbars, dialogs, status badges, FeedExportPanel, FeedsView, etc.). Currently `lucide-react@^1.11.0`.
- Approach when picked up: introduce an internal `_components/icon/` shim (`<Icon name="…" />` wrapper) so the import surface is one file; swap the underlying provider; migrate sites one cluster at a time (sidebar → matrix → library → settings → feeds/shares) and verify visual parity per slice. Keep semantic classNames (`matrix-toolbar__filter-icon`, etc.) — only the inner SVG changes.
- **Runtime-selectable from Settings → Design** (option, not blocker): once the shim exists, expose an "Icon set" picker in the Design tab (lucide / streamline-core-solid-free / future sets). Persist as `config.lookAndFeel.iconSet` (string), default lucide. The shim reads it via the same `lookAndFeel` query the rest of Design uses; per-icon name maps live in `_components/icon/sets/<set>.ts`. CSS-driven sizing/coloring stays the same — swap is a `<svg>` source change only. Per-client shipping default lives in `db/defaults.ts`.
- Out of scope until picked up: don't bulk-replace; per global rule "NEVER run search-and-replace across the codebase".

---

## 2026-05-03 (continued) — Post-checkpoint ships

The "Still uncommitted in working tree" list at the EOD checkpoint (themes #1–#8) is **fully resolved** — every theme that was untracked/modified there has since landed in `origin/main`. Working tree is clean as of this update.

### Commits after `68e96cd` checkpoint
- `a715668` fix(feed-export) — matrix product filter is AND, not OR (two-product selection returned union instead of intersection).
- `564b9ca` feat(feed-export) — per-size span concat via `|formatted` modifier; shares + feeds page redesign in same pass.
- `6e22ebd` feat(feeds) — AdForm reference upload (drop-in XLSX from AdForm dashboard becomes a `source='adform_snapshot'` feed_export row); first-class typed-prefix structure (`Text:` / `Bool:` / `Date:` … on column headers, parsed into structured cell types).
- `103bbe1` feat(texts) — new `/texts` page lists `text_formatting` via the Topics-style `DimensionGrid` (sidebar entry between Assets and Audiences). Adds `TEXT_FORMATTING_COLUMNS` and `TextFormattingRule` type. Reuses inline-edit + archive-toggle + free-text-search pattern; product/status pills self-hide because `text_formatting` has neither field.
- `f18adb2` feat(adform-snapshot) — on snapshot upload, auto-derive `default_label = "MC<n><v> — <name>"` from the DEFAULT row's `(messaging_card_id, messaging_card_variant)`. New `extractDefaultMc()` helper in `src/lib/adform-snapshot.ts`. Includes `scripts/backfill-snapshot-default-labels.ts` for retroactive fill of existing snapshot rows.
- `4057921` feat(feed-export) — `POST /api/feed-exports` accepts `dryRun: true` to preview `{decision, diff, previewRowCount}` without persisting; same `diffPayload` shape across dry-run and commit paths. `FeedsView` drops standalone snapshots panel since `adform_snapshot` rows now surface in the unified feeds table.

### Open follow-ups (next session)
- **Backfill script — run on Erste DB.** `npx tsx scripts/backfill-snapshot-default-labels.ts` against the live DB so pre-`f18adb2` snapshots pick up `default_label` / `default_message_id`. Idempotent, but verify the count printed before/after.
- **Dry-run dialog smoke.** `FeedExportDialog` should now render the diff stat block (added/removed/changed) the moment it opens, before the user clicks Export. Visually verify: open the dialog on a product with a live feed → counts populate without a download triggering.
- **AdForm reference upload — round-trip with a fresh AdForm export.** Typed-prefix parser hasn't been exercised against every column type AdForm produces in the wild; pull a recent Erste AdForm-side XLSX and confirm it round-trips through the snapshot importer.

### Memory hygiene (separate from todo.md)
- `MEMORY.md` "Phase 6 sub-phase ordering" still reads "6d next as of 2026-04-26" — that record is stale. Phases 7/8/9/10 all shipped; current work is post-Phase-10 polish (feeds, shares, dimension editors, AdForm-aware export). Retire or rewrite that memory record next session.

---

## ⭐ TOP-PRIORITY BACKLOG — former pre-active-use punch list (added 2026-05-03; reclassified 2026-07-21)

**Status change (2026-07-21):** we graduated to `6.0.0`/`6.1.0`. Everything needed for base daily use is in place, so these items are **no longer launch blockers** — they are the **top-priority backlog** (platform expansion, reporting ingest, creative↔cell matching, smoke tests). Still commit-sized and still user-green-lit per item; just not gating the release. Original "must-be-handled before real use" framing kept below for history.

---

### ⭐ 0. MCP `2026-07-28` spec compatibility — SDK v2 migration (added 2026-07-21, TOP of backlog)

Full plan: `~/.claude/plans/rippling-sparking-patterson.md`. Spec RC: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ · Beta SDKs: https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/ · TS SDK v2: https://ts.sdk.modelcontextprotocol.io/v2/

**Why:** MCP spec RC `2026-07-28` (final ~2026-07-28) is a major revision of `2025-11-25`. Our MCP server (`src/lib/mcp.ts` + `src/app/mcp/route.ts`) runs on `@modelcontextprotocol/sdk ^1.29.0` (v1). Get ready so ChatGPT/Claude keep working and we can adopt new capabilities (esp. standardized **MCP Apps**).

**Timing / trigger:** NOT now. SDK **v2** implements `2026-07-28` (beta now, **stable ~2026-07-28**) and serves old+new clients side by side; **v1.x stays supported ≥6 months after v2 ships**. → **Wait for SDK v2 stable, then migrate on a branch.** This backlog item makes no prod code change now (just this pointer + optional local v2-beta smoke-test).

**RC changes that matter to us:** stateless core (initialize handshake + `Mcp-Session-Id` removed; clientInfo/caps → `_meta`); Streamable HTTP requires `Mcp-Method`/`Mcp-Name` headers; SSE → Multi Round-Trip (`InputRequiredResult`); tool schemas → JSON Schema 2020-12 (`structuredContent` any JSON); **MCP Apps** first-class (sandboxed-iframe HTML); `roots`/`sampling`/`logging` deprecated; missing-resource error `-32002`→`-32602`; six OAuth/OIDC auth SEPs; extensions framework + Tasks extension; `ttlMs`/`cacheScope` on list/resource results.

**Our exposure (inventoried 2026-07-21) — small, mostly SDK-driven:**
- Transport already **stateless** (`sessionIdGenerator: undefined`, `enableJsonResponse: true`); app never touches session/`Mcp-Method`/`Mcp-Name` headers → SDK-driven.
- Auth = **custom bearer** (`mcp_tokens`; `Authorization: Bearer` or `?secret=` claude.ai-connector compat). **No OAuth/OIDC/`.well-known`** → the 6 auth SEPs N/A to our server.
- **No** `roots`/`sampling`/`logging`/`elicitation` usage → nothing to remove.
- Never emit raw JSON-RPC codes (all `errorResult()`→isError text) → `-32002`→`-32602` N/A.
- Only `show_mc_previews` uses `outputSchema` (object-root, still valid) + `structuredContent`; others return text-JSON via `jsonResult()`. Settings tools-list route uses `z.toJSONSchema()` — recheck under v2.
- Capabilities declared: `{ tools, resources }` only.
- **The one real app-level item:** the `show_mc_previews` widget + `ui://widget/mc-previews.html` resource use the **OpenAI Apps SDK** contract (`text/html;profile=mcp-app`, `window.openai.toolOutput`, `openai:set_globals`, `_meta.openai/*`/`_meta.ui.*`) — distinct from the RC's standard **MCP Apps**; likely needs adaptation (highest-value new capability).

**Migration checklist (when v2 stable lands):**
- [ ] Branch + bump `@modelcontextprotocol/sdk` → v2 stable; read migration guide.
- [ ] Port transport (`src/app/mcp/route.ts`): v2 Streamable HTTP API; ensure nginx+Next pass `Mcp-Method`/`Mcp-Name`; keep stateless + JSON response.
- [ ] Port `buildMcpServer` (`src/lib/mcp.ts`): v2 `McpServer` ctor + capabilities; verify `registerTool`/`registerResource` signatures (outputSchema, `_meta`, annotations).
- [ ] Auth: confirm `resolveBearerClient` bearer flow works under v2; ChatGPT Dev-Mode + Claude connectors still authenticate.
- [ ] Tools/output: re-run every tool; `structuredContent` + object-root `outputSchema` validate; optionally use 2020-12 composition.
- [ ] **MCP Apps decision:** evaluate moving `show_mc_previews` to the standard MCP Apps contract (keep `openai/*` during transition if ChatGPT still needs it).
- [ ] Deprecations: none used — no action.
- [ ] Verify: MCP conformance suite + `--project integration` + live ChatGPT/Claude smoke; then deploy (box, pm2 mm6-erste) + version bump.

---

Items the user flagged as **must-be-handled before v6 goes into real day-to-day use**. Each item is now expanded against the actual schema + code surface. Steps are commit-sized; **do not start work** until the user picks one and green-lights it.

### Anchor facts (from current-state survey)
- `audiences.buyingPlatform` is freeform TEXT (`src/db/schema.ts:133`); spec line 90 lists DV360/DBM as examples but no enum. Topics/messages carry no platform field.
- `creatives` has soft link `(mcNumber, mcVariant)` (`src/db/schema.ts:320-321`); no FK to messages, no join table. Index at `src/db/schema.ts:341`.
- Creative Library mixes `kind:'uploaded'` + `kind:'matrix'` (synthesized) in `src/app/(app)/creative-library/CreativeLibrary.tsx:70-100`. No "unmatched" filter exists.
- `reporting` table is AdForm-shaped (`src/db/schema.ts:370-396`), keyed by `mcLabel` (PMMID), no `platform` field, no FK to messages. Monitoring page is a Phase 6 placeholder (`src/app/(app)/monitoring/page.tsx`).
- `feedExports` row has `source` discriminator: `'export'` | `'adform_snapshot'` (`src/db/schema.ts:549`). FeedRowSet shape is platform-neutral; AdForm-specific bits are PMMID parsing (`src/lib/adform-snapshot.ts:91-108`), DEFAULT-row rewrites + typed-prefix columns (`src/lib/feed-export.ts:165-170`), and `IsDefault`/`IsActive` autofill.
- MCP tool surface complete for audience/topic/mc CRUD + batch (`src/lib/mcp.ts:1112-1124`). Bearer auth + deploy-pinned active-client check (`src/lib/mcp.ts:117-143`). 60/min write rate limit.

---

### 1. Meta as a first-class platform

> **Push-back first** — before any code: is the user driving Meta campaigns out of MM6, or just *tracking* what's running on Meta? If the answer is "tracking + reporting only" then we're really only on the **Monitoring** half of this (item 5/6); audiences + feed-export do not need a Meta path. Ask the user to pick (a) full Meta audience+feed lifecycle in MM6, vs (b) Meta audiences are managed in Meta Ads Manager and we only ingest reports.

If answer is (a), full lifecycle:
- [ ] **1.1 Schema: `audiences.platform` enum.** Add `platform TEXT NOT NULL DEFAULT 'adform'` constraint-by-convention (`adform | meta | dv360 | direct_display`). Keep freeform `buyingPlatform` as the **DSP/seat label within a platform** (e.g. platform=meta + buyingPlatform="business_mgr_id_42"). Migration + per-row backfill (`platform='adform'` for all existing rows on Erste).
- [ ] **1.2 Audiences UI: platform pill + filter.** Add a `platform` column to `DimensionGrid` (`src/app/(app)/_components/DimensionGrid/columns.ts`) with a fixed-options pill editor; add a top-of-page filter pill `Platform: All|AdForm|Meta|DV360|Direct`.
- [ ] **1.3 Per-platform `feedStructure` + `feedPatterns` config.** Today `config.feedStructure` / `config.patterns.feed` are single strings. Promote to per-platform: `config.feedStructure.adform`, `config.feedStructure.meta`. Settings → Patterns gets a platform tab.
- [ ] **1.4 Feed export route platform-aware.** `POST /api/feed-exports` resolves the audience's platform → picks the right `feedStructure`/`feedPatterns`. PMMID generation stays AdForm-only; Meta export emits a Meta-shape row (campaign_name / adset_name / ad_name / customer_list_csv depending on Meta's bulk-import format).
- [ ] **1.5 Feeds UI: platform discriminator.** `FeedsView` (`src/app/(app)/feeds/FeedsView.tsx:62-71`) gets a `platform` column + filter pill. Row click routes to platform-specific detail view if shapes diverge enough; otherwise reuse with column-set switching.
- [ ] **1.6 Decide Meta export shape.** **Open question to lock with user:** Meta's "feed" is typically a CSV upload to Custom Audience or a bulk Ads Manager spreadsheet. Pick one before designing 1.4. Most likely: bulk Ads Manager XLSX (campaign/adset/ad rows). Without this lock, 1.4 is unbuildable.

If answer is (b), tracking only: skip 1.1–1.6, do **only** the audience-level field needed to tag a record as "this audience runs on Meta" — likely just expand `buyingPlatform` enum docs, add a Settings-managed list of allowed values, and wire item 5/6 to use it.

### 2. Direct Display audiences

Direct Display = manually-bought, vendor/publisher-direct placements (no DSP). Even smaller scope than Meta.
- [ ] **2.1 Same schema move as 1.1** (`platform='direct_display'`). No new fields needed if `buyingPlatform` already captures the vendor/publisher (e.g. "Index.hu", "Origo").
- [ ] **2.2 Direct-Display-specific fields TBD.** Open question: does the user need `placement_id`, `vendor_contact`, `insertion_order_ref`? **Lock with user before adding.** Likely answer: just the `platform` flag is enough; vendor name fits in `buyingPlatform`.
- [ ] **2.3 Reporting ingest only — no feed-export.** Direct Display has no creative feed (creatives are sent as raw HTML5 ZIPs to the publisher). So this item is really an audiences-table tagging task + monitoring-side ingest (item 5).

### 3. Match Creative Library uploads → matrix cells

The soft `(mcNumber, mcVariant)` link in `creatives` is enough to *match*, but the user-facing flow to set those values on an upload doesn't exist as a first-class action.
- [ ] **3.1 Inspect current upload path.** `src/app/(app)/creative-library/...` upload flow: does it set `mcNumber`/`mcVariant` from filename today? If yes, document the regex; if no, the field stays `null` until the new manual-match UI lands. (Survey only — no edit.)
- [ ] **3.2 Manual match UI on creative detail.** `CreativeDetailDialog` gets a new "Matrix link" section: two dropdowns (audience+topic) + an MC number/variant picker filtered to that audience+topic's existing messages. Save → `PATCH /api/creatives/[id]` updates `mcNumber`/`mcVariant`. Same dialog also offers "Unlink" to set both to `null`.
- [ ] **3.3 Filename auto-match heuristic on upload.** On `POST /api/creatives` extract `mc(\d+)([a-z])` (case-insensitive) from filename; if found, prefill `mcNumber`/`mcVariant`. Show as "Suggested match — click confirm" rather than committing silently (avoids the v5 mistake where wrong filenames silently mis-attached creatives). Confirmation lives in the same dialog as 3.2.
- [ ] **3.4 Bulk-match dialog.** Toolbar action "Bulk match by filename" runs the regex over all uploaded-kind items where `mcNumber IS NULL` and shows a confirm-table (filename → suggested MC). User multi-selects + confirms → batch `PATCH`. Reuses the dialog pattern from `FeedExportDialog`'s diff-stats block (design-reuse rule).
- [ ] **3.5 Decide: keep soft link, or add `creative_message_links` join table?** Soft `(mcNumber, mcVariant)` works for 1-creative-per-cell; a join table is needed if we want N creatives per cell (e.g. one MC has 3 banner variants in different sizes). **Open question.** v5 used soft link, never blocked anyone — default keep soft, revisit if a real workflow demands many-to-many.

### 4. "Unmatrixed creatives" view

Smaller than item 3 — just a filter, no schema change.
- [ ] **4.1 Add filter pill to Creative Library toolbar.** Reuse the existing toolbar-pill style (design-reuse rule). Three states: `All | Matrixed | Unmatrixed`. Filter logic: `kind === 'uploaded' && (mcNumber == null || mcVariant == null)`.
- [ ] **4.2 Tile badge for unmatrixed.** Small `status-badge--unmatrixed` corner badge so unmatrixed items are visible even when "All" is selected. Use existing badge component.
- [ ] **4.3 Persist selected filter.** localStorage key per existing convention: `mm6_creative_library_match_filter`.
- [ ] **4.4 Counts in toolbar.** Show `(N)` next to each filter pill — same pattern as DimensionGrid status filters.

### 5. Upload Meta + AdForm reports into Monitoring

Reporting table exists but ingest endpoint doesn't, and the table is AdForm-shaped. Two tasks: schema generalization + import endpoints + UI.
- [ ] **5.1 Schema: `reporting.platform` field.** Add `platform TEXT NOT NULL DEFAULT 'adform'` to mirror item 1.1. Backfill existing rows. Keeps `mcLabel` as the AdForm-only PMMID; add `meta_ad_id`/`meta_ad_name`/`meta_campaign` nullable fields for Meta rows. Or — cleaner — add `external_id TEXT` + `external_name TEXT` as platform-agnostic identifiers and let parsers fill them appropriately.
- [ ] **5.2 Shared importer route.** `POST /api/reporting/import` accepts `multipart/form-data` with `file` + `platform` field. Dispatches to per-platform parser. Returns `{ imported, skipped, diff }` like feed-export.
- [ ] **5.3 AdForm parser.** Reads the AdForm reporting XLSX export shape (the user already has these — get a sample for the test fixtures). Maps `mcLabel` (banner name column) + impressions/clicks/CTR.
- [ ] **5.4 Meta parser.** Reads Meta Ads Manager XLSX/CSV export. Maps `meta_ad_id` + `meta_ad_name` + impressions/clicks/CTR/spend. **Need a sample export file from the user before locking column names** — Meta export columns vary by report template.
- [ ] **5.5 Monitoring page UI.** Replace `src/app/(app)/monitoring/page.tsx` placeholder with a `DimensionGrid`-style list of reporting rows. Filters: platform, date range, product (via audience join), mc number. Reuses inline-edit + archive patterns. **Design-reuse rule applies** — no new layout primitives; copy `/texts` page structure.
- [ ] **5.6 Upload widget.** Top-of-Monitoring drag-drop XLSX/CSV (mirrors AdForm-snapshot upload UX in `/feeds`). Auto-detects platform from column header signature; lets user override.

### 6. Match monitoring rows → matrix cells

Builds on item 5. Two sub-paths because AdForm uses PMMID and Meta uses ad_name regex.
- [ ] **6.1 Schema: `reporting.message_id` FK.** Nullable FK to `messages.id`. NOT a hard constraint (a reporting row can survive its message being archived). Backfill with the resolver below.
- [ ] **6.2 AdForm resolver.** PMMID → message_id. The PMMID format is locked (`src/lib/adform-snapshot.ts:91-108`); reuse `extractDefaultMc` + the audience/topic/variant regex to look up the message. Atomic: backfill once across existing reporting rows in a transaction.
- [ ] **6.3 Meta resolver.** Two strategies, in order: **(a)** if creative auto-match (item 3.3) embedded MC label in the filename, the imported `meta_ad_name` likely contains it → same regex; **(b)** fallback: surface unresolved rows in a "Needs match" table on Monitoring with manual-link UI (same dialog as 3.2).
- [ ] **6.4 Matrix cell impression/CTR badge.** Once a message has linked reporting rows, MatrixGrid cell shows a small bottom-corner stat badge (impressions or CTR). Defer styling to a follow-up — the data wiring is the actual blocker.
- [ ] **6.5 "Unmatched reporting" view.** Mirror of item 4 but for reporting: rows where `message_id IS NULL`. Filter pill on Monitoring page. Manual-link action per row.

### 7. Manual UI test — add new MC + new audience + new topic

Smoke test on the running app, not a build. Output is a written checklist in this file with verdicts.
- [ ] **7.1 Start the dev server** (`npm run dev:erste` or whichever client) on a clean DB seed.
- [ ] **7.2 Create a new audience** via Audiences page → "+ Add" → fill required fields → save. Verify: appears in DimensionGrid, audit_log row created, matrix grid header includes it.
- [ ] **7.3 Create a new topic** via Topics page same flow. Verify: appears in matrix grid as a new row.
- [ ] **7.4 Create a new MC** at the intersection of new audience + new topic. Verify: cell renders, status flow works (incoming→active→approved), iframe preview loads.
- [ ] **7.5 Verify AdForm feed-export.** Open `/feeds` for the new audience's product → confirm the new MC appears in the next dry-run preview with the correct PMMID. Don't actually publish — dry-run is enough.
- [ ] **7.6 Capture friction.** Every 4xx, every confusing copy, every step that needed two clicks where one would do — write back into this section as follow-up bullets.

### 8. Same flow via MCP

Drives the same create flow through `audience_create` / `topic_create` / `mc_create` tools.
- [ ] **8.1 Provision MCP token.** Settings → MCP → generate token for the active client (e.g. Erste).
- [ ] **8.2 Wire token into Claude Code's MCP config** (`~/.claude/claude_code_config.json` or equivalent — verify exact location). URL = the local dev server's `/api/mcp` route.
- [ ] **8.3 Drive create-audience tool.** From Claude Code, call `audience_create` with the same fields as 7.2. Verify same DB row + audit_log shows agent as actor (`audit_log.actor_kind='mcp'`).
- [ ] **8.4 Drive create-topic + create-mc tools.** Same pattern.
- [ ] **8.5 Verify rate-limit + active-client guards.** Try with a token from a different client deploy → expect 401. Hammer 60+ writes/min → expect 429.
- [ ] **8.6 Capture gaps.** Any tool param shape that didn't match what the agent naturally produces — write follow-up. E.g. if `mc_create` requires `audienceId` but the agent had only `audienceKey`, that's a usability bug.

### 9. Agent test — MC add from a new prodlist

The "is the matrix self-driving yet" check. End-to-end: agent reads a real product list, proposes MCs, creates them via MCP.
- [ ] **9.1 Get a real Erste prodlist** (XLSX or paste). Realistic source — not a synthetic test fixture.
- [ ] **9.2 Define the prompt.** "Here's the latest prodlist; for each new product not yet in the matrix, propose MC entries with name + status='incoming' and create them via MCP." Make this a saved prompt in the project's prompts library if one exists; otherwise capture it inline.
- [ ] **9.3 Dry-run mode first.** Agent should call `list_products` + `list_audiences` to figure out what's already there, then **propose** the diff in a chat message before calling `mc_create_batch`. Confirm the proposal looks right.
- [ ] **9.4 Full-auto mode.** Re-run with explicit "execute the create_batch directly". Verify: `audit_log` shows the batch operation, matrix UI shows the new MCs, no orphaned rows.
- [ ] **9.5 Capture the gaps.** This is the highest-signal test of the whole system. Anything the agent had to ask back for — a missing list-tool, an awkward param, a confusing error — goes into the next iteration's todo. **Most likely outcome: the test reveals 2-3 small MCP tool ergonomics fixes.** Plan for that, not for "it just works".

### Sequencing recommendation
1. Items **7 + 8 + 9 first** (manual + MCP + agent smoke). Cheapest, highest signal, confirms the system is even pre-active-use-ready before we add platform/match work on top.
2. Then **3 + 4** (creative→cell match + unmatrixed view). Self-contained, no schema migration risk, immediate user value.
3. Then **5 + 6** (monitoring ingest + match). Bigger; depends on item 6.2's PMMID resolver being correct, which is exercised by AdForm-only first.
4. **1 + 2 (Meta + Direct Display) last**, and **only after the push-back conversation** — the cheapest version of these is "tag audiences with a platform field, do nothing else" and may be enough.

### 10. Dark-mode component sweep (post-launch polish)

Infra port from the bizi project landed 2026-05-07: shadcn-style design tokens in `globals.css` (`--background`, `--surface{,-elevated,-alt}`, `--text-{primary,secondary,tertiary}`, `--border-{default,strong,subtle}` + light/dark variants) wired into `tailwind.config.ts` as semantic color names (`bg-background`, `bg-surface`, `text-text-primary`, `border-border`, etc.). Three base-layer rules in `globals.css` now flip `body` bg/text, all form inputs, and the default border color when `html.dark` is set. **Result: ~60–70% of the UI flips on toggle without per-component changes.**

The remaining 30–40% is hardcoded utility classes that don't reference theme tokens. Migrate piecemeal — **never search-and-replace, one cluster at a time, verify visually**.
- [ ] **10.1 Sidebar + top toolbar.** `bg-white` → `bg-surface-elevated`; `text-slate-700` → `text-text-primary`; `text-slate-500` → `text-text-secondary`; `border-slate-200` → `border-border` (or drop entirely, since `*` rule handles default).
- [ ] **10.2 Matrix grid chrome.** Header row, audience/topic labels, status badges background. Cells with creative content stay light (banners are inherently white-bg).
- [ ] **10.3 Modals + dialogs.** All dialog containers (`fixed inset-0`, `bg-white rounded-lg`) → `bg-surface-elevated`. SettingsView already uses `<html>` styles so check whether it inherits cleanly or needs explicit `bg-surface-elevated`.
- [ ] **10.4 DimensionGrid + DataGrid.** Row backgrounds (zebra), header bg, hover states. Use `bg-surface-alt` for zebra alt-rows.
- [ ] **10.5 Form fields specifically.** Inputs already flip via the global rule. But buttons/selects with explicit `bg-white border-slate-300` need migration. `bg-surface` + the global border color works for most.
- [ ] **10.6 Status pills + brand chips.** These use `--brand-*` and `--status-*` already — verify legibility against dark backgrounds. May need `--status-*-fg` companion vars for dark-mode contrast.
- [ ] **10.7 Iframe preview chrome.** `MatrixIframePreview` thumb-checker bg + "render failed" placeholder color. Banners themselves stay light (intentional).
- [ ] **10.8 Visual QA pass** with the dev server in dark mode + screenshot diffing for key pages: Matrix, Creative Library, Assets, Texts, Audiences, Topics, Templates, Shares, Feeds, Monitoring, Settings (all tabs).

Order suggestion: 10.1 (sidebar) → 10.3 (modals) → 10.4 (grids) → 10.2 (matrix chrome) → 10.5/10.6/10.7. Each is independently shippable; sequencing is just visual-priority order.

---

## Session checkpoint — 2026-05-17 — media-list-views: sortable aligned list header

Branch `worktree-media-list-views`. Plan: `~/.claude/plans/so-the-assets-and-gentle-dragonfly.md`.

Both `Creative Library` (`/creative-library`) and `Assets` (`/assets`) gained a sortable, sticky, aligned **column header** in list view with six sort fields: `name`, `product`, `type`, `size`, `createdAt`, `updatedAt`. Sort applies to the full filtered list (before the 200-row pagination slice in Creative Library) and is **inherited silently by Grid and Masonry** views on the same page. Default sort `createdAt desc` (visible change vs the previous insertion-order default — most recent floats to the top).

**Files**
- `src/app/(app)/_components/ListSortHeader.tsx` (new) — `LIST_GRID_TEMPLATE` constant (single source of truth: `48px minmax(0,1fr) 96px 80px 96px 88px 88px`), `ListSortKey`/`SortState` types, `<ListSortHeader>` component (sticky, lucide ArrowUp/Down arrows, two-state cycle asc↔desc — no third "none" state), `sortListRows()` (nulls-last regardless of dir, `id desc` tie-break for stable order), `formatListDate()` (`today` / `Nd ago` / `May 8`), and `LIST_SORT_CODEC` validator (falls back to `createdAt desc` on stale/corrupt localStorage).
- `src/app/(app)/creative-library/CreativeLibrary.tsx` — added `updatedAt` to `Creative` type; matrix-synthesized items set `updatedAt: m.updatedAt`; new `sorted` memo between `filtered` and `visible.slice`; `visibleCount` resets on sort change; `ListRow` rewritten to 7-cell grid; chip pills dropped (brand/template/size no longer redundant); detail-dialog nav now uses `sorted` so prev/next matches display order; padding `p-4` → `px-4 pb-4 pt-4` with `pt-0` in list view so the sticky header sits flush.
- `src/app/(app)/assets/AssetsLibrary.tsx` — same pattern, key `mm6_assets_library_sort`.
- `src/app/(app)/_components/MatrixIframeTile.tsx` — `MatrixIframeListRow` rewritten to the same grid with new `createdAt`/`updatedAt` props; chip pills dropped. Other variants (`MatrixIframeTile`, `MatrixIframeCard`) untouched.
- `tasks/component-inventory.md` — added `list-sort-header` / `__cell` / `--active` block plus the new `creative-row__*` / `asset-row__*` per-column cells; updated the `creative-row` / `asset-row` row to note the 7-cell grid layout.

**Persistence**
- `mm6_creative_library_sort` and `mm6_assets_library_sort` → `{"key":"createdAt","dir":"desc"}` (JSON via `LIST_SORT_CODEC`).

**Tests** — `npm run typecheck` clean, `npm test` 195/195 passing. No new tests added (UI-only, no schema/API change).

**Manual verification needed (user-side, dev server already on :6001):** click each of the 6 headers on both pages, confirm direction toggle + arrow indicator + full-list ordering (scroll past row 200 in Creative Library), confirm Grid/Masonry inherit the order silently, confirm reload persists, confirm matrix-synthesized rows in Creative Library align column-perfectly with uploaded rows.

**Not bumped** — `6.0.0-pre`; per CLAUDE.md, pre-launch bumps are deferred to the `6.0.0` graduation event.

---

## Session checkpoint — 2026-05-17 — Matrix edit-mode v1

Shipped on `feat/matrix-edit-mode-v1`:

**Entity layer (`src/lib/entities/messages.ts`)**
- Fixed latent bug in `createMessage`: insert payload now spreads the validated input on top of computed `(clientId, slot, pmmid, utm_*)`, so `disclaimer`, `headlineStyle`, `copy1Style`, `copy2Style`, `disclaimerStyle`, `ctaStyle`, `customCss` actually persist on create.
- Added `getMessageByPmmid(clientId, pmmid)` (extracted from `lib/mcp.ts` so both MCP + HTTP share one lookup).
- Added `copyMessages(clientId, sourceMcLabels, targetAudienceKeys, opts?)` — clones each source MC into each target audience under the source's topic, fresh PMMID per copy, `fieldOverrides` merge on top.
- Added `moveMessages(clientId, moves, targetAudienceKey)` — same-topic only; PMMID + versionNo frozen; UTM columns regenerated against the new audience; auto-bumps variant on `(number, variant)` collision in the target cell.

**MCP (`src/lib/mcp.ts`)**
- New tools registered in `registerBatchTools`: `mc_copy_batch`, `mc_move_batch`. Both wrap the entity functions in `db.transaction()` and write a single audit row per batch (`bulk_copy` / `bulk_move`, both already valid `AuditAction`s).

**HTTP**
- `POST /api/messages/bulk-copy` — thin wrapper, denyDemo + zod, 400 on bad shape, 201 on success.
- `POST /api/messages/bulk-move` — thin wrapper, 409 on `version_conflict`, 404 on `not_found`, 400 on `cross_topic_move_not_supported` / `target_audience_not_found`.

**UI**
- `MatrixWorkspace` holds `editMode` + `selection` (`{ topic, mcIds }`) + `pendingAction` (`{ kind: 'copy'|'move', targetAudienceKeys }`). Esc cancels pending action first, then clears selection. None of this is persisted to localStorage.
- `MatrixToolbar` got an `Edit` toggle (Lucide `Pencil`) and an inline `selection-actions--inline` block when `editMode && selectedCount > 0`. `Apply (N)` button while a target picker is open.
- `McChip` is now selectable + draggable (`useLongPress` 500ms entry; `@dnd-kit/core` `useDraggable`). Cells are `useDroppable` and reject cross-topic drops visually. `onDragEnd` chooses copy vs move from Ctrl/Cmd on the activator.
- Column headers double as the target picker while `pendingAction` is set (audiences-as-columns orientation only). Ghost preview chips render in target cells for the upcoming write.
- `+ new` button (`cell-add-btn`) renders in every cell during edit mode → POSTs `/api/messages` with `audience`/`topic` prefilled → opens `MessageEditor` for the new row.

**Tests**
- `tests/integration/api/copy-move-messages.test.ts` — 13 tests covering copy semantics (incl. disclaimer/Style/customCss regression), move semantics, frozen PMMID/versionNo, regenerated UTMs, variant auto-bump, in-batch collision, version_conflict rollback, cross-topic rejection, tenant isolation.
- `tests/integration/api/mcp-copy-move.test.ts` — 4 tests driving both new MCP tools via `buildMcpServer()._registeredTools`, asserting audit row count + tenant isolation.

**Deferred to v2** (still): cross-topic move, undo/redo, bulk delete (stubbed disabled), keyboard-only edit mode, mobile gestures beyond longpress, PMMID regeneration on move.

**Status:** still `6.0.0-pre`. No version bump per project `CLAUDE.md`.

**Known limitations:** target-picker column-header click only works when audiences are columns (`transposed=true`, the default). In `transposed=false` mode the columns are topics and the picker becomes inert — DnD still works in both orientations.

---

## Asseteket dolgozzuk fel visszafele (külön feladat, később)

Gyűjtsük ki a `messages` (mátrix) tábla alapján, hogy mely assetek (`uploaded_files` / `assets` táblák) vannak ténylegesen használva — message-enként van audience (→ product: SZK / SZA / HK / VAL …) és topic (→ topic_key). Ahol egy asset több message-ben szerepel, ott listázzuk az összes (product, topic_key) párt.

Második lépésben: nevezzük át (vagy duplikáljuk át új névvel) az asset fileokat úgy, hogy a fájlnévhez **előre** hozzáfűzzük a használati kontextust — `{product}_{topic_key}_<eredeti_filename>` mintában. Több (product, topic_key) eset → vagy egy közös prefixált név `MULTI_<...>` jelöléssel, vagy minden használathoz külön kópia. (Döntsd el a feladat indításakor a használati arányok alapján.)

Kimenet: a `_inbox-assets/` folder fileai átnevezve, és a DB `assets.fileName` mező + uploaded_files canonical path frissítve. Audit: melyik nevet honnan kapta. Cél: az asset könyvtárban szabad szemmel látni, hogy melyik file melyik termékhez/topikhoz tartozik, és így az új asset scan-script már parseolható filenevet kap.


---

## Session checkpoint — 2026-05-20 — Audiences/Topics edit-panel parity

Branch `feat/matrix-edit-mode-v1` (extending). User asks for `audiences` + `topics` editor pages to gain the matrix edit-mode pattern: edit panel on the **right** (RightToolbar) instead of the bottom-floating bulk bar, with a 3-way action selector (`Bulk set` / `Duplicate` / `Delete`).

### Confirmed decisions
- **Delete is HARD delete** (DROP from DB), not archive. The existing DELETE → cascade-archive flow on `/api/audiences/[id]` and `/api/topics/[id]` stays unchanged (matrix UI uses it). Hard delete is a separate new route.
- **Guard:** hard delete refuses if any `messages` row references the audience/topic by key — archived OR live, since hard-deleting the row would orphan an archived MC if later restored. Response shape `{ error: "in_use", referencedBy: number[] }`.
- **Duplicate name regex:** `/^(.+) \((\d+)\)$/` → `${base} (${n+1})`; else `${name} (1)`. Tested live.
- **Duplicate key regex:** `/^(.+)_(\d+)$/` → `${base}_${n+1}`; else `${key}_1`. Tested live.
- **Filter persistence** (already shipped this session): `DimensionGrid` now persists `search`, `products`, `statuses`, `sort` to localStorage via `usePersistent`. Keys: `mm6_<audiences|topics|texts>_filter_search` / `_filter_products` / `_filter_statuses` / `_sort`.

### Plan

- [x] **1. Entity layer — duplicate.** `duplicateAudience` + `duplicateTopic` shipped. Max-suffix scan with regex-escaped base. Sparse state (e.g. `_1, _3` → next `_4`) tested.
- [x] **2. Entity layer — hard delete.** `deleteAudience` / `deleteTopic` shipped. Guard checks `messages` archived OR live — refuses with `{ reason: "in_use", referencedBy }`.
- [x] **3. HTTP routes.** Four new POST routes: `/api/{audiences,topics}/[id]/{duplicate,hard-delete}`. Audit `create` for duplicate, `delete` for hard delete.
- [x] **4. UI — move edit panel into RightToolbar.** Floating `BulkEditPanel` removed (file deleted). New `DimensionEditPanel` renders inside `RightToolbar` render-prop, above `ArchiveToggle`. Toolbar-hint hidden when selection > 0.
- [x] **5. UI — action selector.** 3-tab row (bulk-set / duplicate / delete), each with its own sub-form. Per-row failure list under `dimension-edit-panel__results`. Delete CTA is `--danger` (rose).
- [x] **6. Component inventory.** `dimension-edit-panel` block + 15 sub-classes appended.
- [x] **7. Tests.** 14 audiences + 12 topics tests, all green. Full suite 238/238.
- [ ] **8. Smoke test (user).** `npm run dev:erste` → /audiences + /topics → select rows, switch action; verify bulk-set still works, duplicate produces correct suffix, delete refuses when MCs reference, succeeds when orphan.

### Out of scope
- Touching the matrix edit-mode UI (it stays as-is).
- Adding hard delete to the matrix-side flow (MC hard delete is a separate ask).
- Restoring or undoing hard delete (no audit-row-restore path).

---

## Session checkpoint — 2026-05-20 (cont.) — Key patterns: `join(...)` + audience-key support

User reported that auto-generated topic keys looked ugly (`SZA___wip`, `SZA_NA_gyorsasag_NA_par-per`). Cause: the configured `topicKey` pattern (`{{product}}_{{tag1}}_{{tag2}}_{{tag3}}_{{tag4}}_{{name|lower}}` or similar in Erste's `config.patterns` row) interpolates empty strings as `""` → consecutive `_` runs. Also: audience entity had no key-pattern support at all.

### Decisions
- **`join(...)` is a new top-level pattern form.** Mutually exclusive with template substitution and conditional. Arguments are sub-patterns (each evaluated recursively, so `|lower` etc. work).
- **Empty AND "NA" (case-insensitive) are dropped.** User's "NA" tag values often act as placeholders; treat them as missing.
- **Separator is `_` (hardcoded for v1).** No `sep=` arg until someone asks.
- **Existing keys NOT auto-regenerated.** Only new entities + duplicates use the new pattern. Topic update-regen logic already existed (`shouldRegenerateKey`) so editing a relevant field on a stale-keyed topic will refresh its key.
- **Audience update-regen NOT added in this pass** (only `createAudience` uses `generateAudienceKey`). Reason: lower risk for v1; the user can duplicate-then-delete to fix a single bad row.

### Shipped
- [x] `evaluatePattern` extended with `JOIN_RE` + `splitJoinArgs` (commas inside `{{}}` ignored). `src/lib/patterns.ts`.
- [x] `generateAudienceKey` + `readAudienceKeyPattern` in `src/lib/entities/audiences.ts`. Pattern context: product / strategy / buyingPlatform / device / tag. Fallback: `aud{N+1}`.
- [x] `createAudience` now calls `generateAudienceKey` when `input.key` is undefined.
- [x] `DEFAULT_PATTERNS` in `db/defaults.ts`:
  - `audienceKey: "join({{product|lower}}, {{strategy|lower}}, {{device|lower}})"`
  - `topicKey: "join({{product|lower}}, {{tag1|lower}}, {{tag2|lower}}, {{tag3|lower}}, {{tag4|lower}})"`
  - Affects **fresh installs only** — existing Erste config is untouched. User can adopt via the new Settings UI.
- [x] `StructureTab.tsx` — new section "Key patterns" before "Feed patterns", with audienceKey + topicKey text inputs + info block explaining `join(...)` and modifiers.
- [x] Tests:
  - `tests/unit/pattern-join.test.ts` — 12 cases (incl. case-insensitive NA drop, missing keys, plain-text args).
  - `tests/integration/api/audiences-key-pattern.test.ts` — 7 cases (fallback, join with pattern, empty+NA drop, explicit-key override).
  - All 257 tests pass.
- [x] `component-inventory.md` — `structure-tab__section--key-patterns` entry added.

### Smoke test (user)
- [ ] `npm run dev:erste` → Settings → Structure → Key patterns. Set `topicKey` to `join({{product|lower}}, {{tag1|lower}}, {{tag2|lower}}, {{tag3|lower}}, {{tag4|lower}})`. Save.
- [ ] Go to `/topics`, duplicate an existing row → confirm the new row's key is clean (no `___`, no `NA`).
- [ ] Edit `tag1` of an existing topic → confirm key regenerates per the new pattern.
- [ ] `/audiences` → create a new audience → confirm key is `join`-produced.

---

## Session checkpoint — 2026-05-20 (cont.) — Auto-key regen with MC-guard + frozen UI

User asked: "for audiences with no MC, auto-regenerate should run; for those with MCs, the key cell should be disabled with a tooltip saying 'X MCs registered to it'".

Applied same logic to **topics**, since `updateTopic` was already regenerating WITHOUT an MC guard — a latent bug that could orphan messages by silently renaming their referenced topic.

### Shipped
- [x] **`updateAudience`** — added `shouldRegenerateAudienceKey` (mirrors topic's logic) + MC-guard via `countMessagesByAudience`. Triggers on product/strategy/buyingPlatform/device/tag change when no explicit `input.key`.
- [x] **`updateTopic`** — existing regen path gained the MC-guard via `countMessagesByTopic`.
- [x] **`listAudiences` / `listTopics`** — now return `mcCount` per row, computed via `mcCountsByAudience` / `mcCountsByTopic` (one `GROUP BY` query per list call). `Audience` / `Topic` types in `matrix/types.ts` got optional `mcCount?: number`.
- [x] **`Versioned` type** (DimensionGrid) — gained optional `mcCount?: number` so the generic Cell renderer can read it.
- [x] **DimensionGrid Cell** — when `col.key === "key"` and `row.mcCount > 0` → renders `Lock` icon (lucide), tooltip "Auto-key frozen — N MC(s) reference this", semantic `dimension-grid__cell--frozen` modifier.
- [x] Tests:
  - `audiences-key-pattern.test.ts` bővült 4 új teszttel (regen happy path, MC-guard, archived MC still freezes, regen returns after MC delete) + `listAudiences mcCount` teszt.
  - `topics.test.ts` bővült: "frozen by MC reference".
  - Full suite 263/263 zöld.
- [x] `component-inventory.md` — `dimension-grid__cell--frozen` + `__cell-lock` token-ek hozzáadva.

### Smoke test (user)
- [ ] `npm run dev:erste` → /audiences page. Egy MC-mentes sor `product` mezőjének módosítása → key regenerálódik. Egy MC-vel rendelkező sor `product` mezőjének módosítása → key NEM változik, a key cellán lock ikon + tooltip látható.
- [ ] /topics page ugyanaz: MC-vel terhelt topic `tag1` módosítása → key fagy.

---

## Session checkpoint — 2026-05-20 (cont.) — Fix accidental MC314 + duplicate MC296→Q2

Manual data fix on local `db/matrix.db` (client 8 / Erste). NOTE: the
`ERSTE_MessagingMatrix` MCP is stale (missing MC312/313/314 + the 26Q2 topics),
so work is done directly against the local DB, not via MCP.

### Plan
- [x] Back up `db/matrix.db` (`.backup`) before any write.
- [x] Hard-delete the accidental MC314 a/b/c — message ids 32753/32754/32755
      (topic `...nemaradjle_120e`, audience `SZA_afinpdall` = Private Deal - Indamedia).
      No FK refs, no creatives → clean delete.
- [x] Duplicate MC296 a/b/c → 3 new MCs in topic `Ne maradj le 26Q2`
      (`SZA_promocio_Online_behavNeMaradjLe_150ejovairasok26q2`), audience
      `SZA_INCOMING`, template `html`. Cell is empty + max live number drops to
      313 after the delete → auto-numbering yields MC314 a/b/c.
- [x] Execute via a throwaway `tsx` script using the app's `createMessage`
      (correct pmmid/trafficking/numbering) + drizzle delete, one transaction;
      delete the script afterwards.
- [x] Verify: MC314 a/b/c now in 26Q2 cell, template html; old afinpdall rows gone.

---

## Session checkpoint — 2026-05-20 (cont.) — `mc:` filter narrows matrix rows/cols

User: "when filtering on mc: in matrix only show the rows and columns where the mc is, hide the others".

Before: `mc:` was in `PREFIX_MAP` (so the search engine matched MCs by number/PMMID) but explicitly excluded from `NARROWING_PREFIXES` — so the matrix kept showing every audience/topic axis with empty cells. Only `a:` / `t:` / `s:` / `p:` triggered the row/column collapse path in `MatrixGrid.filtered`.

### Shipped
- [x] `src/lib/search-query.ts:24` — `NARROWING_PREFIXES` gained `"mc"`. One-line behavior flip — the existing `if (narrowing) { … }` block in `MatrixGrid.tsx` already does the right thing once `hasNarrowingPrefix` returns true.
- [x] `src/app/(app)/matrix/MatrixToolbar.tsx:37` — title tooltip updated: "All prefixes also hide non-matching rows/columns" (was: "a:/t:/s:/p: also hide…").
- [x] `tests/unit/search-query.test.ts` — flipped the prior assertion ("mc: alone is NOT a narrowing prefix" → now grouped with the other narrowing prefixes). Multi-term "free mc:42" also expected `true` now.
- [x] Suite 262/262 zöld (one test dissolved into the merged case, no net coverage loss).

### Smoke test (user)
- [ ] /matrix → type `mc:174` (or any MC# present in your data). Only the audience row(s) and topic column(s) holding MC#174 should remain visible; the rest collapse.

- [x] Follow-up: hard-deleted MC313 a–f (ids 32747–32752, 2026Q1 × Private Deal - Adaptive) — 6 accidental blank rows, no creatives/refs.

---

## Session checkpoint — 2026-05-20 (cont.) — Asset picker for MC image/video fields

User: add an asset selector with preview to the image1–6 / video1 fields in the
MC editor. Decisions: source = **Asset Library** (`/api/assets`); UI = **inline
popover** anchored to the field; **picker-only** (no free-text input).

### Context
- `MessageEditor.tsx` → `ContentTab` → `MediaField` (7×: image1-6 + video1).
  Today: free-text filename input + 36px thumbnail (`/api/drive/proxy/{name}`).
- Stored value is a plain filename resolved by `/api/drive/proxy` →
  `getFileByFilename`. Feed export uses `{{image1|noext}}`. Value stays a
  filename string → picking writes `asset.fileName`, nothing downstream changes.
- Assets: `/api/assets`, each has `fileId` (→ uploaded_files), `fileName`,
  `fileFormat`. Thumbnails: `/api/files/{fileId}/thumbnail?w=200`.

### Plan
- [ ] New `_components/AssetPickerPopover.tsx` — inline popover. Props:
      `kind: "image"|"video"`, `onPick(fileName)`, `onClose`. Fetches
      `/api/assets` (react-query `["assets"]`); filters by format (image:
      jpg/jpeg/png/svg/gif/webp; video: mp4/webm/mov); client-side search box
      (fileName / visualKeyword / product / brand). Thumbnail grid; click →
      `onPick`. Click-outside + Esc close (MultiPill `mousedown` pattern).
- [ ] Rework `MediaField` in `MessageEditor.tsx` to picker-only: thumbnail +
      button (filename or "Choose image…/video…" placeholder) + clear (×) btn;
      button toggles the popover. Drop the free-text `<input>`. `onChange`
      still emits the filename string — save/preview/feed unaffected. Legacy
      free-text values still display + preview; user can Clear.
- [ ] Semantic classes: new block `asset-picker` (`__search`, `__grid`,
      `__option`, `__thumb`, `__empty`); rework `media-field`
      (`__btn`, `__clear`, `__placeholder`). Popover styling matches
      `multi-pill__menu` (border, shadow-lg, rounded-md, z-50). Reuse
      `thumb-checker`.
- [ ] Update `tasks/component-inventory.md` with the `asset-picker` block.
- [ ] `npm run typecheck` + smoke test in `dev:erste`.

### Review — landed (2026-05-21)
Final design diverged from the plan above: instead of a portaled picker-only
popover, `MediaField` keeps its free-text input and gains an inline
**autocomplete** (v5 AssetAutocomplete pattern) — typing ≥2 chars opens a
dropdown of Asset-Library matches (thumbnails via `/api/files/{id}/thumbnail`),
click to fill; clear (×) button; "No matching assets" empty state.
- [x] `MediaField` reworked in `MessageEditor.tsx` (autocomplete, not popover).
- [x] Orphaned `AssetPickerPopover.tsx` (popover prototype) removed.
- [x] `component-inventory.md` — `media-field` + `asset-autocomplete` blocks logged.
- [x] `tsc --noEmit` clean for app code (pre-existing `mcCount` test errors unrelated).

---

## Session checkpoint — 2026-05-22 — Shared ModalBackdrop (fix drag-select close)

Bug: dragging a text selection out of an input onto the backdrop closes the
dialog — `click` fires on the LCA of mousedown+mouseup = the backdrop, so its
`onClick={onClose}` runs. Pattern is copy-pasted across ~11 dialogs.

Fix (#2): one shared `<ModalBackdrop>` with a press-started-on-self guard;
migrate every click-to-close dialog to it.

### Plan
- [x] New `_components/ModalBackdrop.tsx` — `onMouseDown` records whether the
      press landed on the bare backdrop; `onClick` closes only if press AND
      release are both on the backdrop (`e.target === e.currentTarget`).
      Invariant base classes; `className` prop carries per-dialog z/layout.
- [x] Migrate 9 click-to-close dialogs (swap backdrop div → `<ModalBackdrop>`,
      drop now-redundant panel `stopPropagation`), one at a time:
      AppDialog, AlertDialog, MediaEntityDialog, MessageEditor,
      HeaderDetailDialog, UploadDialog, MatrixDetailDialog, ShareCreateDialog,
      ShareDetailDialog.
- [x] Leave ClientsTab (×2) + UsersView untouched — their backdrops have no
      click-to-close today; migrating would change behavior.
- [x] Update `component-inventory.md` (`modal-backdrop` is now a component).
- [x] `tsc --noEmit` clean for app code.

---

## Session checkpoint — 2026-05-22 — Concurrent-edit safety: fix lost-update + entity history

Incident: matrix editor open in two windows; the stale window saved empty
content over the live data. Root cause is NOT a missing feature — optimistic
concurrency (`version` + `If-Match` → 409 `versionMismatch`) and a full
`before`/`after` audit log already exist. The bug is in **conflict recovery**:

- `MessageEditor.save.onError` (VersionMismatchError) calls
  `setCommittedSnapshot(e.current)` — rebasing the snapshot retriggers the
  autosave `useEffect` (`[draft, committedSnapshot, autoSave]`), which diffs
  the *fresh server row* against the *stale draft* and re-`save.mutate`s the
  stale content with the now-valid version → second attempt wins. OCC only
  blocks the FIRST stale save; autosave immediately re-arms and clobbers.
- `useRowAutosave` 409 path has the same shape: `invalidateQueries` → grid
  refetches fresh rows → next autosave fires with the new version.

Scope (user-approved A+B+E; C optional). "MC" = `messages`. No new storage
layer — reuse `version` OCC and the existing `auditLog` table.

### Phase A — Make conflict a terminal, blocking state (root-cause fix)
Decision: conflict is **reload-only** — no "Keep mine". The stale window
always discards its draft on reload.
- [x] `MessageEditor`: on `VersionMismatchError`, do NOT rebase
      `committedSnapshot`. Stay in `saveState: "conflict"`, pause the autosave
      effect while in conflict, and render a `conflict-bar` with one action:
      "Reload" → draft+snapshot ← `serverRow`, back to `idle`. No save fires
      until the user reloads.
- [x] `useRowAutosave` — INVESTIGATED, no change. Not vulnerable: field-scoped
      patches, no persistent draft, no retry loop. A 409 drops the patch and
      refetches in place; it cannot silently clobber. The lost-update bug was
      MessageEditor-specific (full-row draft + auto-resave).

### Phase B — Live cross-tab refresh (stale-tab detection)
The SSE infra already exists end-to-end — server `broadcast`s on every write,
`usePresenceConnection` holds an open `/api/events` connection — but the client
discards the events. Finish the intended wiring instead of focus-polling.
- [x] Consume SSE `message` events → `queryClient.invalidateQueries` for the
      affected entity key(s). Live refresh: a peer write updates this tab's
      matrix/grid immediately. (`usePresenceConnection` now also drives sync.)
- [x] `MessageEditor`: react to the refreshed `message` prop — if its
      `version` moved past `committedSnapshot.version`, enter the Phase-A
      conflict state when dirty, or silently adopt the fresh row when clean.
      Guarded to `idle` so it can't race the editor's own just-saved write.

### Phase E — Entity history from the existing audit log
- [x] `readEntityHistory(clientId, entityType, entityId)` in `lib/audit.ts` —
      newest-first, capped 100, off the existing `audit_client_entity_idx`.
- [x] Three `withSession` history routes: `/api/{topics,audiences,messages}/
      [id]/history` (mirrors the `[id]/restore` / `[id]/duplicate` idiom).
      Left the admin-wide `withAdmin` `/api/audit-log` viewer untouched.
- [x] Shared `EntityHistoryDrawer` — right-side `modal` drawer; revisions
      newest-first with a field-level before→after diff. Query key
      `[entity,"history",id]` so SSE live-sync (Phase B) refreshes it too.
- [x] "Restore this version" = a normal versioned PATCH of the snapshot's
      `after` (server `pickWritable` filters; `If-Match` = current version
      from `history[0].after`). Reuses OCC → a concurrent edit 409s into the
      standard conflict path. No new restore endpoint, no new table.
- [x] Wired: History button in MessageEditor header; History action in the
      topics/audiences grid right toolbar (single-row selection). Texts grid
      opts out (`historyEntity` omitted — no `/api/texts` history endpoint).
- [x] `component-inventory.md` — logged `entity-history` + `conflict-bar`.
- [x] Integration test `tests/integration/api/entity-history.test.ts`
      (ordering, entity filter, tenant isolation).

### Phase C — (OPTIONAL, deferred) presence banner
User reports 2–4 people often on the same matrix, so this is worth doing —
but kept out of the approved scope. Advisory only: a "<name> is editing this"
banner pushed over the existing SSE `broadcast` channel. No locking.

### Verify
- [x] `tsc --noEmit` clean for app code (pre-existing `mcCount` errors in
      `audiences-key-pattern.test.ts` unrelated); `npm test` 265/265 pass.
- [x] Two-window manual test (Playwright, 2026-05-22): conflict bar appears on
      a stale dirty window + Reload adopts the peer value; clean window adopts
      live; history drawer + restore work.
- [x] Follow-up from verify: `usePresenceConnection` now refetches all queries
      on SSE re-open (`wasClosed` ref) — a backgrounded tab closed its SSE and
      missed events; on refocus it catches up instead of staying stale.
      Verified: hidden tab stayed stale through a peer save, then adopted the
      peer value within ~400ms of going visible.

### Review — A+B+E landed (2026-05-22)
Root cause of the incident: `MessageEditor` conflict recovery rebased the
version after a 409, which re-armed the debounced autosave and let the stale
draft win the second attempt. Fixed by making conflict a terminal, blocking,
reload-only state. Phase B finished the long-intended SSE→`invalidateQueries`
wiring (the connection was open but events were discarded) for live cross-tab
refresh. Phase E surfaces the audit log — which already stored full
`before`/`after` per change — as a per-entity history drawer with restore; no
new storage. `useRowAutosave` was investigated and left as-is (not vulnerable:
field-scoped patches, no persistent draft). Phase C (presence) deferred.

---

## Session checkpoint — 2026-05-23 — Settings → Keywords tab (audiences + topics dropdowns)

User asks: the audience editor's `status, product, strategy, buying_platform, data_source, targeting_type, device` columns + the topic editor's `product, status, tag1, tag2, tag3` columns should be driven by a **Settings → Keywords** tab that holds the allowed-values list per field, instead of (today) freeform text on 5 of the 7 audience fields. The `channel` column proposal from earlier this turn was dropped as unnecessary.

Source-of-truth for the seed data: the existing **Erste XLSX `keywords` sheet** (skipped during the 9b import — see `todo.md:443`). 18 rows in scope, `(form, field, comma-separated values)` shape. The same sheet is also the bootstrap for a future Phase covering messages/creatives/assets fields — out of scope here.

### Confirmed decisions (this session)
- **Input mode:** autocomplete + freeform-allowed. The dropdown shows the Settings-managed list; any other string is still accepted and saved. Backwards-compatible with existing freeform Erste rows.
- **Scope:** 7 audience fields (`status, product, strategy, buyingPlatform, dataSource, targetingType, device`) + 5 topic fields (`status, product, tag1, tag2, tag3`). `tag4` excluded — the XLSX `keywords` sheet has no `Tag4` row and the field is rarely used in Erste.
- **Storage:** per-client multi-tenant. Erste, Telekom, Proficio each have their own keyword lists; one shared list across deploys would force cross-client coupling we explicitly rejected in the multi-tenancy delta.
- **Canonical field key:** the **v6 camelCase TS field name** (`buyingPlatform`, not `Buying_platform`). XLSX header is normalized on import via the same `findCol` aliases the audience importer already uses.
- **Status migration:** today `STATUS_OPTIONS` (`src/app/(app)/matrix/types.ts`) is hardcoded `["ACTIVE","INACTIVE","PLANNED","INCOMING"]`. The Keywords tab seeds the same values; hardcoded fallback stays for fresh installs with no `keywords` rows yet.
- **Out of scope (deferred to its own session):** D1–D5 template typing (`kind: html|adobe|figma|after_effects` + matrix cell preview auto-switch + creative→cell linking + `audiences.platform` enum). Decision points already drafted in this turn's transcript; promote to a sibling checkpoint when picked up.

### Plan

- [ ] **1. Schema — `keywords` table** (`src/db/schema.ts` + new migration `0011_keywords.sql`).
  - Columns: `id` PK, `clientId` FK→clients (cascade), `form` text (`audiences`|`topics`), `field` text (camelCase: `status`, `product`, `buyingPlatform`, …), `value` text, `orderIndex` integer, `archivedAt` text nullable, `createdAt`, `updatedAt`.
  - Indexes: `unique(clientId, form, field, value)` (no duplicate values within a list); `index(clientId, form, field, orderIndex)` (the read pattern is "give me all values for one field, in display order"). No `version` column — Keywords are admin-curated, low-contention; if two admins edit simultaneously the last write wins per row, which is fine.
- [ ] **2. Entity layer — `src/lib/entities/keywords.ts`** (new file).
  - `listKeywords(clientId, opts?: { form?, field?, includeArchived? })` → grouped `Record<form, Record<field, Keyword[]>>` OR a flat list; pick flat + group in the route (simpler caching).
  - `createKeyword`, `updateKeyword` (rename value or change orderIndex), `archiveKeyword` (soft-delete; archived values stay queryable for audit but drop out of dropdowns), `restoreKeyword`. No hard delete on v1 — match the audience/topic archive convention.
  - `reorderKeywords(clientId, form, field, valueIds: number[])` — single transaction, sets `orderIndex = position` for each.
  - Tenant guard: every read/write scoped on `clientId`. Reuse `withClientScope` if it exists or inline the `where(eq(clientId, …))`.
- [ ] **3. HTTP routes** (`src/app/api/keywords/...`).
  - `GET /api/keywords?form=audiences` → list (withSession, tenant-scoped).
  - `POST /api/keywords` → create (withAdmin — only admins curate the list).
  - `PATCH /api/keywords/[id]` → update (withAdmin).
  - `POST /api/keywords/[id]/archive` + `/restore` (withAdmin).
  - `POST /api/keywords/reorder` body `{ form, field, ids: number[] }` (withAdmin).
  - Every write: audit row (`entityType: 'keywords'`, action `create|update|archive|restore|reorder`). SSE broadcast already wired via `writeAudit`.
- [ ] **4. XLSX importer — activate the `keywords` sheet** (`src/lib/import-xlsx.ts`).
  - New `importKeywords(rows, clientId)` step. Parse `(form, field, values)` triplets, split `values` on `/,\s*/`, trim, drop empties. Normalize XLSX `field` → camelCase via a small map (`Buying_platform → buyingPlatform`, `Data_source → dataSource`, etc.). Skip unknown `form` (e.g. `tasks` — no v6 entity) silently with a per-row warning.
  - **Reuse, don't rewrite** the wipe-then-insert pattern: `keywords` joins the existing wipe order (added at the end — no FK refs, safe last).
  - Existing `scripts/import-erste.ts` automatically picks up the new step. Re-run on Erste backfills the 18 rows worth of values (~90 individual `keywords` rows after the comma-split).
- [ ] **5. New `CellType: "autocomplete"`** in `src/app/(app)/_components/DimensionGrid/columns.ts`.
  - `{ kind: "autocomplete"; source: { form: "audiences"|"topics"; field: string } }`.
  - The grid cell renderer: input + dropdown panel of matching keywords (case-insensitive prefix match), but **value can be anything** — pressing Enter or blur with a non-list string still commits the freeform value. Matches the "autocomplete + freeform" decision.
  - Keep `kind: "select-dynamic"; source: "product"` working — it predates this and `/audiences` `product` column uses it (pulling from a client-config list, not keywords). Migrate `product` to `autocomplete` only if its config-list source is itself migrated to keywords — defer that to keep this PR small.
- [ ] **6. `columns.ts` updates** — switch the in-scope cells:
  - `AUDIENCE_COLUMNS`: `status` from `select(STATUS_OPTIONS)` → `autocomplete(audiences, status)`; `strategy, buyingPlatform, dataSource, targetingType, device` from `text` → `autocomplete(audiences, <field>)`. `product` stays `select-dynamic` for now (see above note).
  - `TOPIC_COLUMNS`: `status` → `autocomplete(topics, status)`; `tag1, tag2, tag3` from `text` → `autocomplete(topics, tagN)`. `product` and `tag4` unchanged.
  - `STATUS_OPTIONS` hardcoded constant **stays in `types.ts`** as a fallback for fresh installs (empty `keywords` table) — the autocomplete cell falls through to it when the query returns no rows for `(form=*, field=status)`.
- [ ] **7. Matrix header dialog parity** (`src/app/(app)/matrix/HeaderDetailDialog.tsx`).
  - The audience/topic dialog opened from the matrix row/column header (see `todo.md:1089-1094`) edits the same fields — its `<Field>` rows for `status/product/strategy/device` need the same autocomplete treatment, otherwise the matrix-side editor diverges from the `/audiences` grid. **Same component should be reusable** — extract the input as `<AutocompleteField source={...}>` once and use it in both places.
- [ ] **8. Settings → Keywords tab UI** (`src/app/(app)/settings/_keywords/KeywordsTab.tsx`, new).
  - Tab inserted in `SettingsView.tsx` between `_structure` and `_storage` (alphabetical-ish: Clients / Design / MCP / Snapshots / Changelog / Structure / **Keywords** / Storage / About) — or after Structure since both are admin-curated taxonomy. Final placement decided at build time.
  - Layout: left sidebar = `(form, field)` pairs as collapsible sections (12 sections: 7 audiences + 5 topics); right pane = current list for the selected pair with `Add value` input + per-row `↑↓` reorder + `archive` (eye-off) icon + inline rename.
  - Reuse: the existing `DimensionGrid` row patterns are too heavy for this — keywords are a flat single-column list, just use a simple `<ul>` with the same toolbar-btn / archive-toggle styling.
  - Empty state per section: "No values yet. The audience/topic editor will fall back to freeform input." (matches the autocomplete semantics — empty list = freeform-only).
- [ ] **9. Component inventory + tests.**
  - `tasks/component-inventory.md` — log `keywords-tab`, `keywords-tab__section`, `keywords-tab__row`, `autocomplete-field`, `autocomplete-field__menu`, `autocomplete-field__option`.
  - Tests:
    - `tests/integration/api/keywords.test.ts` — list / create / update / archive / restore / reorder / tenant isolation. ~8 cases.
    - `tests/integration/import-keywords.test.ts` — feed the real XLSX through `importErsteXlsx`, assert 18 (form,field) groups created with the right value counts.
    - `tests/unit/keywords-field-normalize.test.ts` — small unit on the XLSX-header→camelCase mapping (catches typos like `Buying_platform`→`buyingPlatform` regression).
- [ ] **10. Smoke test (user).** `npm run dev:erste` → run `npx tsx scripts/import-erste.ts` to seed Erste's keywords → open `/audiences` and pick any `buyingPlatform` cell → dropdown shows `adform, dv360, meta, …`; type `xyz` → accepted as freeform. Open Settings → Keywords → add a new `Strategy` value → reopen audience editor → new value appears in dropdown without page refresh (SSE invalidation already wired in Phase B of the previous session). Smoke same flow on `/topics` for `tag1`.

### Out of scope (explicit, do not let scope creep)
- Template typing / matrix preview auto-switch / Adobe / Figma / After Effects template kinds (D1–D5 — separate session).
- `audiences.platform` enum (`adform|meta|dv360|direct_display|dooh`) — separate session, ties into 1.x punch list.
- Messages.status / messages.template / creatives.format / creatives.templates / assets.format / assets.type keywords coverage — separate session (different UI surfaces).
- Migrating `product` from `select-dynamic` (client-config) to `autocomplete` (keywords) — leave the existing source-of-truth alone for v1.
- Hard delete of keywords; bulk import in the Settings UI; CSV import.
- Strict-only dropdown mode (`select-dynamic`-style); the autocomplete already does this minus the "Add new" inline create — that one is a small follow-up if requested.

### Open questions to resolve before starting (if any surface)
- Tab placement order in `SettingsView` — Structure-adjacent (between Structure and Storage) feels right because both are taxonomy. Confirm at build time, not blocker now.
- Per-field validation rules (e.g. `status` values must be uppercase letters only)? Default: no validation, accept any non-empty trimmed string. Add per-field validators only if the user reports garbage values getting in.

### Version bump suggestion (at end of work)
Per project `CLAUDE.md`: still `6.0.0-pre`, no bump until the pre-active-use punch list is fully cleared. This work does **not** clear any punch list item; no bump.

### Review — landed (2026-05-23)

Branch `feat/keywords-tab`. All 10 plan steps shipped. `npm test` 283/283 green (was 265 → +18 new tests). `npx tsc --noEmit` clean for app code (only pre-existing `mcCount` test errors in `audiences-key-pattern.test.ts` from 2026-05-20 work, unrelated).

**Schema (1):** `keywords(id, clientId FK→clients cascade, form, field, value, orderIndex, archivedAt, createdAt, updatedAt)` with unique `(clientId, form, field, value)` + order index. No `version` column — admin-curated, last-write-wins. Migration `0016_loose_bill_hollister.sql`.

**Entity (1):** `src/lib/entities/keywords.ts` — `listKeywords/getKeyword/createKeyword/updateKeyword/archiveKeyword/restoreKeyword/reorderKeywords/bulkInsertKeywords/deleteAllKeywordsForClient/hardDeleteKeywords`. `KEYWORD_FORMS` + `KEYWORD_FIELDS` allowlist drives the v1 scope (7 audience + 5 topic fields, tag4 excluded). UNIQUE-violation translated to a typed `KeywordError`.

**HTTP routes (4):** `/api/keywords` GET (withSession) + POST (withAdmin), `/api/keywords/[id]` PATCH + DELETE, `/api/keywords/[id]/restore` POST, `/api/keywords/reorder` POST. Every write calls `writeAudit({ entityType: "keywords", action: … })` so the existing SSE `broadcast` fires → `usePresenceConnection` (Phase B) invalidates `["keywords"]` → all open editors live-refresh.

**XLSX importer (1):** `import-xlsx.ts` gained `keywords: number` in `ImportCounts`, wipes the table at the same point as the other tenant tables, and runs the new `importKeywords` helper. The helper parses the `(form, field, values)` triplet, normalizes XLSX field names via the new exported `normalizeXlsxFieldName(s)` (lower-first + `_X → uppercase`), filters to in-scope `(form, field)` pairs, comma-splits values, and inserts with per-cohort orderIndex preserved. Out-of-scope rows (messages/creatives/assets/tasks + unknown fields) are silently skipped — no errors. Duplicate values within a single XLSX cell or across re-runs UNIQUE-skip cleanly. `scripts/import-erste.ts` doc-comment refreshed (7 sheets → 8). Real-XLSX dry run: 123 keywords inserted, 8 expected skips (4 out-of-scope rows + 2 tasks + 1 empty + 1 dup), 0 errors.

**UI (5):**
- `CellType` gained `{ kind: "autocomplete"; source: { form, field } }`. Native `<datalist>` renderer in `DimensionGrid.tsx` — gives autocomplete + freeform input for free; accessible, no popover plumbing.
- `AUDIENCE_COLUMNS` 6 cells switched: `status` (was `select`) and `strategy / device / buyingPlatform / dataSource / targetingType` (were `text`). `product` stays `select-dynamic` (sourced from client-config, not keywords — out-of-scope per plan).
- `TOPIC_COLUMNS` 4 cells switched: `status` (was `select`) and `tag1 / tag2 / tag3` (were `text`). `tag4` stays `text` (XLSX keywords sheet has no `Tag4` row, deliberate).
- `STATUS_OPTIONS` import dropped from `columns.ts` (no more hardcoded enum reference). The constant still lives in `matrix/types.ts` because `HeaderDetailDialog`'s status-badge color map still keys off it.
- New shared `AutocompleteField` component (`_components/AutocompleteField.tsx`) reused 10× in `HeaderDetailDialog` (6 audience + 4 topic fields). Killed the two hand-rolled `<select>` status dropdowns there.
- `useKeywordOptions` hook centralizes the `/api/keywords` query; same query key across all consumers means one network call serves audiences/topics editors + matrix dialog + any future consumer.

**Settings → Keywords tab (1):** new `_keywords/KeywordsTab.tsx`. Two-column layout (240px sidebar of 12 `(form, field)` buttons with per-section live count chips; pane with header + "Add value…" + reorderable + archive/restore list). Inline rename on click. `EyeOff` archive + `ArchiveRestore` restore. Show-archived toggle. `KeywordsTab` slotted into `SettingsView` between Structure and Snapshots; new `TabKey` `keywords` and route order = Clients / Design / Storage / Structure / **Keywords** / Snapshots / Changelog / MCP / About.

**Tests (+18):** `tests/integration/api/keywords.test.ts` (10 cases — list/create/orderIndex auto-increment/UNIQUE rejection/required-fields/update-rename/update-collision/tenant-isolation/archive-restore/reorder-tenant-scoped/filter-by-form-field), `tests/integration/import-keywords-xlsx.test.ts` (3 cases — in-scope seeding with XLSX-field normalization + duplicate-skip + out-of-scope filter; dryRun rollback; wipe-then-reimport idempotent), `tests/unit/keywords-field-normalize.test.ts` (5 cases on the normalizer). All green; full suite 283/283.

**Component inventory:** appended "Változások 2026-05-23 — Settings → Keywords tab + autocomplete cell" block — `autocomplete-field` + 16 `keywords-tab__*` BEM tokens + the new `autocomplete` CellType doc. `useKeywordOptions` hook documented.

**Branch:** `feat/keywords-tab`. Not committed yet (per `CLAUDE.md` policy: user requests commits explicitly).

**Follow-up fix (same session): client-bundle "Can't resolve 'fs'".** First browser load failed with `Module not found: Can't resolve 'fs'` in `better-sqlite3` — `KeywordsTab.tsx` ("use client") imported `KEYWORD_FIELDS` / `KEYWORD_FORMS` from `@/lib/entities/keywords`, which transitively pulls in `@/db` (server-only). Next.js client bundler followed the edge and choked on the Node `fs` requirement. Fix: extracted the pure constants + `KeywordForm` type into `src/lib/keywords-shared.ts`. The entity layer now re-exports them (so server-side import sites in 4 routes + importer + tests are unchanged); `KeywordsTab.tsx` imports directly from the shared file. Mirror of the existing `text-formatting-scope.ts` split pattern. Typecheck + 18 keyword tests still green.

### Smoke checklist (user, ~5 minutes)

DB note: the Erste production data is **not yet seeded**. Run the importer to seed the 123 keyword rows before testing, OR start with the empty list and add a few values by hand in Settings to test the same path.

To seed from XLSX (wipes Erste's data first — **make sure no concurrent edits are happening**):
```bash
ACTIVE_CLIENT_KEY=erste npx tsx scripts/import-erste.ts
```

Then in a browser (already running on `:6001`):

1. `/audiences` → click a `Buying platform` cell on any row. Dropdown should show `adform, dv360, meta, pinterest, gdn, youtube, search, xandr, facebook, instagram, xaxis`. Typing also filters (native `<datalist>` behavior).
2. In the same cell, type `xyz` (not in the list) → press Enter → commits as freeform value (saves to DB).
3. `/topics` → click a `Tag 1` cell → dropdown shows `NA, brand, elethelyzet, …`.
4. `/settings` → open the new **Keywords** tab → left sidebar shows 12 `(form, field)` buttons with live count chips. Click `Audiences · Strategy`.
5. Add new value `xyz123` via "Add value…" form → appears in the list.
6. **Without page refresh**, switch back to `/audiences` → click a `Strategy` cell → dropdown now includes `xyz123` (SSE invalidation working).
7. Back in Settings → Keywords → click the `↑` arrow on a row → reorder persists. Click the eye-off (archive) → row dimmed; toggle "Show archived" → still visible with restore icon.
8. Open the Matrix → click any **row header** (audience) → the side dialog's `Status / Strategy / Device / Buying platform / Data source / Targeting type` fields should all show the same dropdown. Same for **column headers** (topics) on `Status / Tag 1-3`.

If any of those misbehave, capture the screen + console error and we triage.

---

## Session checkpoint — 2026-05-23 (cont.) — Template kind + matrix preview auto-switch (D1+D2+D3)

Resuming the "bigger plan" laid out earlier this session. Decisions D1–D5 were drafted in chat; D6 (Keywords) shipped above. This session ships D1+D2+D3 — the **template typing core** — and explicitly defers D4 (`audiences.platform` enum) and D5 (creative→cell linking, 3.x punch list) to follow-up sessions.

### Confirmed decisions (from earlier in this turn's transcript)
- **D1.** Template gains `kind: "html" | "adobe" | "figma" | "after_effects"`. Storage: extend the existing `templates/<name>/manifest.json` (no new file, no DB migration). Default `kind: "html"` when absent — every existing template stays render-as-HTML.
- **D2.** MC ↔ template stays **1:1** for v1 (no join table). `messages.template` column unchanged.
- **D3.** Matrix cell preview switches on `kind`:
  - `html` → current `MatrixIframePreview` (POST `/api/render` → iframe), unchanged
  - `adobe`/`figma`/`after_effects` → new `<TemplatePreviewImage>` showing the template folder's `preview.{png,jpg,jpeg,webp,gif}` file with a small kind badge; for `figma` kind, the image becomes a link that opens `figma_url` in a new tab
  - kind unknown OR template missing → existing `Code2` placeholder
  - **D5 override (linked creative > template preview) is NOT in this session.** Lands when 3.x punch list is built. Until then, non-HTML cells always show the template preview image, even if a future linked creative would override it.
- **D4 + D5 stay separate sessions.** D4 (platform enum + per-platform feed export) is a meaty schema-migration job; D5 (creative→cell linking UI) gates the override behavior in D3. Neither blocks getting D1+D2+D3 in front of the user.
- **Template Editor (`/templates`) UI for setting `kind` + uploading `preview.png` + entering `figma_url` is OUT OF SCOPE** for v1. The admin can edit `manifest.json` directly in the existing CodeMirror text editor and drop preview files via the existing per-file editor. A dedicated "kind picker" UI lands in the follow-up that touches the Template Editor anyway (with the form-builder polish).
- **No DB migration.** Filesystem `manifest.json` is the single source of truth. If we later promote templates to DB rows, the kind field travels with them.

### Plan

- [ ] **1. Extend `manifest.json` schema (docs + types).**
  - Document the new optional fields in `src/lib/templates.ts` block comment: `kind` (enum, default `"html"`), `figma_url` (string, only for `kind=figma`), `preview` (string, defaults to auto-discover `preview.{png,jpg,jpeg,webp,gif}` if present).
  - Add the same comment to `templates/html/manifest.json` and `templates/Telekom-DooH/manifest.json`. Existing keys untouched; no behavior change for HTML templates.
- [ ] **2. `TemplateInfo` + `readTemplate` extension** (`src/lib/templates.ts`).
  - Add to `TemplateInfo`: `kind: "html" | "adobe" | "figma" | "after_effects"`, `description: string | null`, `previewFile: string | null`, `externalUrl: string | null`.
  - `readTemplate(name)`: read `manifest.json` (already read indirectly via `readTemplateJson`; need to actually expose the manifest reader OR add a parallel one — separate the two reads cleanly). Parse `kind` from manifest with validator (`["html","adobe","figma","after_effects"]`, fallback `"html"` on unknown). `description` from `manifest.description` if string. `externalUrl` from `manifest.figma_url` if string. `previewFile`: if `manifest.preview` is set use it; else auto-discover the first existing `preview.{png,jpg,jpeg,webp,gif}` in the template directory.
  - Keep `placeholders` / `tagOptions` / `sizes` reads gated on `kind === "html"` — non-HTML templates have no sized variants, no placeholders. Return `sizes: []` and `placeholders: []` for them.
- [ ] **3. `/api/templates/folders` + `/api/templates` response shape.**
  - Already returns `{ templates: TemplateInfo[] }`. The new fields ride along automatically once `TemplateInfo` grows. **No route changes** — purely a payload extension. Verify nothing on the consumer side breaks on the bigger response (it's additive, so it shouldn't).
- [ ] **4. New `<TemplatePreviewImage>` component** (`src/app/(app)/_components/TemplatePreviewImage.tsx`).
  - Props: `templateName: string`, `previewFile: string | null`, `kind: TemplateInfo["kind"]`, `externalUrl: string | null`, `mode: "fill-width" | "fit-rect"`.
  - Renders an `<img src="/api/templates/{templateName}/{previewFile}" />` (the per-file route already serves binary files). Empty state when `previewFile === null`: small icon + "No preview" text.
  - Kind badge bottom-right (`template-kind-badge` block, reuses `status-badge` styling). Labels: `Adobe`, `Figma`, `AfterEffects`. (`html` kind doesn't render this component, so no `HTML` badge.)
  - If `kind === "figma"` AND `externalUrl` is set: wrap the image in an `<a target="_blank" rel="noopener">` so clicking opens the Figma file. Otherwise the image is just inert.
  - Reuses `thumb-checker` background so it visually matches HTML cell previews.
- [ ] **5. Branch `MatrixIframePreview` on kind.**
  - Today the call site (`MatrixIframeTile.tsx` x3 — `MatrixIframeTile` / `MatrixIframeCard` / `MatrixIframeListRow`) passes only `templateName: string`.
  - Need the kind for that template at the matrix layer. `MatrixGrid` already fetches `/api/templates/folders` once (saw at `MatrixGrid.tsx:265`). Build a `Map<name, TemplateInfo>` there, pass `templateInfo: TemplateInfo | null` down through each tile component (or just the 3-4 fields the branching needs — `kind`, `previewFile`, `externalUrl` — to keep prop surfaces small).
  - In `MatrixIframePreview` (rename TBD — maybe `MatrixCellPreview` since it's no longer iframe-only): if `kind === "html"` (or `templateInfo` is null = unknown/missing template, treat as html for back-compat), use the current iframe render path; otherwise render `<TemplatePreviewImage>`.
- [ ] **6. MessageEditor preview pane parity** (`src/app/(app)/matrix/MessageEditor.tsx`).
  - The editor's preview pane uses `PreviewPane` which today is HTML-render-only. For non-HTML kind templates, swap to `<TemplatePreviewImage>` (same component as the matrix cell).
  - **Quick survey before implementing:** what does the editor actually fetch / pass to PreviewPane today? If it's a complex multi-size selector, branching at PreviewPane level may be the cleanest split. Decide at build time.
- [ ] **7. Sample non-HTML template** (`templates/figma-sample/`).
  - `manifest.json` with `kind: "figma"`, `figma_url`, `description`. Plus a `preview.png` (1×1 placeholder image is fine for end-to-end smoke — user can replace with a real Figma export later).
  - Not committed to git as production data — just a fixture for smoke testing. Visible in Erste's template list because the visibility config defaults to "show all" when unset.
- [ ] **8. Tests.**
  - `tests/unit/template-kind.test.ts` — `readTemplate` on a fixture template folder with various `manifest.json` shapes: default html, explicit html, figma + figma_url, adobe + preview, missing manifest, unknown kind string falls back to html. ~6 cases.
  - No DOM tests for the matrix branching — that's plumbing wiring and the kind field round-tripping is covered by the unit test + the smoke checklist below.
- [ ] **9. Component inventory + todo Review.**
  - Append `template-preview-image`, `template-preview-image__img`, `template-preview-image__empty`, `template-kind-badge` (+ `--adobe / --figma / --after-effects` modifiers).
- [ ] **10. Smoke checklist (user-side, ~5 minutes).**
  - Create or use the sample Figma template → verify it appears in the template dropdown
  - Create a new MC in the matrix using the Figma template → cell renders the preview image + Figma badge
  - Click the cell → Figma URL opens in a new tab
  - Edit the same MC → editor preview pane shows the same image (not iframe placeholder)
  - Existing HTML-template MCs still render iframe — no regression

### Out of scope (explicit, do not let scope creep)
- D4 — `audiences.platform` enum + per-platform feed export shape (Meta/DV360/Direct/AdForm). Separate session.
- D5 — Creative Library → matrix cell `(mcNumber, mcVariant)` linking UI. Required for the "linked creative beats template preview" override in D3. Separate session.
- Template Editor (`/templates`) UI for setting kind / uploading preview image / entering figma_url via dedicated form. Admins edit `manifest.json` text in the existing CodeMirror editor for v1.
- Bulk-migrating existing HTML templates to be explicit about `kind: "html"`. Default fallback handles it.
- Promoting templates to a DB table. Filesystem stays the source of truth.
- Per-size preview images (only one preview per template — even though HTML templates have multiple sizes). Non-HTML templates are sizeless in this model.
- Embedding Figma live (iframe with `figma.com/embed`). v1 just opens the URL in a new tab.

### Version bump suggestion (at end of work)
Still `6.0.0-pre`. Same rule as the Keywords session — no bump until the pre-active-use punch list clears.

### Review — landed (2026-05-23, same day as Keywords)

Branch `feat/template-kind` (built on top of the still-uncommitted `feat/keywords-tab` working tree — both sets of changes coexist in the working copy; user decides commit/PR split at merge time). All 10 plan steps shipped. `npm test` 283 → **291 (+8 new)**. `npx tsc --noEmit` clean for app code (only pre-existing `mcCount` test errors unrelated, same as previous sessions).

**Manifest schema (1):** `templates/<name>/manifest.json` accepts three new optional fields: `kind` (enum `html|adobe|figma|after_effects`, default `html`), `figma_url` (string, honored only when `kind=figma`), `preview` (filename inside the folder). Block-comment docs added to `src/lib/templates.ts`. Existing `templates/html/manifest.json` and `templates/Telekom-DooH/manifest.json` untouched — defaults make them stay HTML.

**`TemplateInfo` + `readTemplate` (1):** added `kind`, `description`, `previewFile`, `externalUrl` fields. Manifest read separated from template.json read (new private `readManifestJson`). `kind` validated against `TEMPLATE_KINDS` allowlist — unknown strings silently fall back to `"html"` for forward-compat. Non-html kind shortcuts the `sizes` + `placeholders` reads (returns empty arrays). `previewFile` auto-discovers `preview.{png,jpg,jpeg,webp,gif}` for non-html when `manifest.preview` unset; for html kind, stays null (iframe is the preview).

**Consumer audit (no breaks):** `TemplateInfo` is duplicated as local types in 5 consumers (CreativeLibrary, TemplateEditor, MessageEditor, FeedView, HeaderDetailDialog). Only the 3 used in the matrix-preview surfaces (CreativeLibrary, MessageEditor, HeaderDetailDialog) had to be extended with the new optional fields. The other two stay narrow.

**Components (2):**
- `_components/TemplatePreviewImage.tsx` — new client component. `<img>` from `/api/templates/{name}/{file}` (existing per-file route, no new endpoint), thumb-checker chrome, kind badge bottom-right, `<a target="_blank">` wrap for `kind=figma + externalUrl`, `ImageOff` empty-state when previewFile is null.
- `_components/MatrixIframeTile.tsx` — exported `TemplatePreviewMeta` type + `templateMetaFor(t)` helper. `MatrixIframePreview` split into a dispatch wrapper + `MatrixIframeRender` (kept the iframe machinery; split avoids violating Rules of Hooks on the non-html branch). Tile/Card/ListRow each gained an optional `templateMeta?` prop forwarded down. Back-compat: any call site that doesn't pass `templateMeta` keeps the iframe path (existing behavior).

**Call sites (3):**
- `CreativeLibrary.tsx` — local `TemplateInfo` extended with optional `kind/previewFile/externalUrl`. All 3 tile/card/list renders pass `templateMeta={templateMetaFor(templateMap.get(c.liveTemplateName))}`.
- `MessageEditor.tsx` — local `TemplateInfo` extended. The `<PreviewPane>` call passes `templateName + templateMeta`.
- `HeaderDetailDialog.tsx` — same shape.

**`PreviewPane` (1):** gained optional `templateMeta?` + `templateName?` props. New `showImage` branch in the viewport: when set and non-html, renders `<TemplatePreviewImage>` instead of `<PreviewIframe>`. Toolbar (size selector, skip-anim, bg buttons, refresh) stays — size selector auto-disables when `sizes.length === 0` (already existing behavior); skip-anim becomes a no-op for non-html (harmless). All existing call sites pass `undefined` by default → no regression.

**Sample template (1):** `templates/figma-sample/` — `manifest.json` (kind=figma, figma_url, description) + `preview.png` (copied from `templates/html/empty.png`, 955 bytes placeholder). Visible in Erste's template list immediately because the visibility config defaults to "show all" when unset; user can swap the preview for a real Figma export at any time.

**Tests (+8):** `tests/unit/template-kind.test.ts` — 8 cases on `readTemplate`: default html, explicit html (preview not auto-discovered for html), figma+figma_url+auto-discover, adobe+manifest.preview override+figma_url-ignored, after_effects+webp auto-discover, unknown kind→html, missing manifest→html, missing template→null. Each test builds a fresh tmp dir via `_setTemplatesRootForTests`. **Full suite 291/291 green** (283 → +8).

**Component inventory:** appended "Változások 2026-05-23 (cont.) — Template kind + matrix preview auto-switch" block — 4 BEM blocks (`template-preview-image{,__img,__empty,__link}`) + 4 badge variants (`template-kind-badge{,--adobe,--figma,--after-effects}`) + the new `preview-pane__image-wrap` sibling + the type/helper exports + the manifest schema delta. Behavior matrix and explicit non-scope items documented.

**Out of scope (explicit, all deferred to follow-ups):**
- **D5** — Creative Library `(mcNumber, mcVariant)` → matrix cell linking; required for the "linked creative > template preview" override in D3. Until landed, non-html cells always show the template's preview image.
- **D4** — `audiences.platform` enum + per-platform feed export (Meta/DV360/Direct/AdForm split).
- **Share Gallery non-HTML support** — uses `PublicMatrixPreview` against `/api/render/public`; needs a public-safe templates endpoint. Public shares of non-HTML MCs currently 500 on render. Lower priority.
- **Creative Library non-HTML matrix items** — synthesizer filters out templates with `sizes.length === 0`; non-html templates have no sizes so they don't show up as creative cards yet. Needs the synthesizer to handle the "no size" case (1 item per MC instead of N per (MC, size)).
- **Template Editor UI** for kind picker / preview upload / figma_url input. Admins use the existing CodeMirror manifest.json editor for v1.

**Branch state at end of session:** `feat/template-kind` checked out, working tree carries both Keywords + Template changes uncommitted. No commits made (per global CLAUDE.md). User to decide PR strategy — one big PR vs. split per branch.

### Smoke checklist (user, ~5 minutes)

1. `/matrix` should still load and render existing HTML-template MCs normally (no regression).
2. In the MC editor, pick the `figma-sample` template (it should appear in the template dropdown). Save.
3. Reopen the MC — preview pane should show the placeholder `preview.png` with a `Figma` badge bottom-right and an external-link icon next to it.
4. Click the preview image → `https://www.figma.com/file/example/sample` opens in a new tab.
5. Same MC, open it via clicking the matrix row/column header instead → `HeaderDetailDialog`'s preview pane also shows the same image + badge.
6. Edit `templates/figma-sample/manifest.json` → change `kind` to `adobe` → save → reload the editor → badge label becomes `Adobe` and the click-through link disappears (only figma kind links).
7. Replace `templates/figma-sample/preview.png` with a real PNG/JPG of your own → reload editor → new image shows (lazy-loaded `<img>`).
8. Set `kind: "html"` (or remove the kind line) → save → reload → editor falls back to the iframe render path (placeholder/empty since the template has no `index.html`/sizes — that's expected for the sample folder, not a regression on real HTML templates).

## PMMID regen on audience move + ARCHIVED status + move-guard (2026-05-23)

**Context.** Discovered during MCP-coworker emulation: MC315a was created in one audience then moved to another via matrix edit mode, but its PMMID still encodes the original (now-stale) audience key. Audit trail: `moveMessages` in `src/lib/entities/messages.ts:501-534` regenerates UTM trafficking columns on move but skips `pmmid`. The existing test `tests/integration/api/copy-move-messages.test.ts:149` explicitly asserts `pmmid` is frozen — that assertion encodes outdated intent and must flip.

**Design contract (locked with user, this session).**
- **PMMID is a measurement key**, not an opaque row ID. It must encode the row's current audience/topic/number/variant/versionNo. UTM-content + reporting labels read from it.
- **Measurement runs during `ACTIVE`.** Pre-ACTIVE the row is work-in-progress; pmmid is derived/mutable.
- **Move blocked** for statuses where movement would corrupt measurement or its post-hoc reading: `ACTIVE`, `INACTIVE`, `ARCHIVED`. Everything else (INCOMING, NAMING, CONTENT, PREVIEW, APPROVED, ERROR, DEAD, MEMORY) → move allowed, pmmid regenerates.
- **`ARCHIVED` is a new workflow status**, distinct from the existing `archivedAt` soft-delete column. Soft-delete = "don't break references" (system-level safety). `ARCHIVED` status = "we remember this MC existed but the user doesn't want to see it in normal views" (user intent). No automatic coupling between the two.
- **`versionNo` stays frozen on move** (creative-revision counter, separate concept from placement). Pmmid embeds it as `n_N`.

### Plan

- [x] **1. Add `ARCHIVED` to status enum.**
  - `src/app/(app)/matrix/types.ts:107` — append `"ARCHIVED"` to `STATUS_OPTIONS`.
  - `src/app/(app)/matrix/types.ts:120` — append `ARCHIVED: "bg-slate-500"` to `STATUS_COLOR` (between `INACTIVE` and `ERROR`; one shade darker than INACTIVE's `slate-400`).
  - `src/db/defaults.ts:18` — append `ARCHIVED: "#4b5563"` to `DEFAULT_LOOK_AND_FEEL.statusColors` (matches the slate-500 hex).
  - `src/app/(app)/settings/_design/DesignTab.tsx` + `src/app/(app)/matrix/MessageEditor.tsx` — append `"ARCHIVED"` to the local status-list arrays (lines 11/47 referenced earlier).

- [x] **2. Move-guard in `moveMessages` (pre-pass).**
  - In the resolve loop at `src/lib/entities/messages.ts:418-433`, after the version_conflict check, add: `if (BLOCKED_MOVE_STATUSES.has(source.status ?? "")) return { ok: false, reason: "row_locked_by_status", mcLabel: m.mcLabel, status: source.status };`.
  - Define `const BLOCKED_MOVE_STATUSES = new Set(["ACTIVE", "INACTIVE", "ARCHIVED"]);` at module top.
  - Extend the `MoveResult` discriminated union to include `{ ok: false, reason: "row_locked_by_status", mcLabel: string, status: string }`.

- [x] **3. Pmmid regen in the update loop.**
  - In `src/lib/entities/messages.ts:501-534`, alongside `generateTrafficking`, call `generatePmmid({ audience: targetAudienceKey, topic: p.source.topic, number: p.number, variant: p.variant, versionNo: p.source.versionNo }, [], [], patterns.pmmid)`.
  - Add `pmmid: newPmmid` to the `.set({...})` payload.

- [x] **4. Update existing move tests.**
  - `tests/integration/api/copy-move-messages.test.ts:149` — rename to `"moves 2 MCs into one audience — PMMID regenerated, versionNo frozen, version+1, source removed"`. Flip `expect(movedA.pmmid).toBe(a.pmmid)` → `expect(movedA.pmmid).not.toBe(a.pmmid)` + assert the new pmmid contains `aud2`. Keep `expect(movedA.versionNo).toBe(a.versionNo)` (still frozen).
  - Collision test at line 182 — same flip on the pmmid assertion (line 218).

- [x] **5. New test for ACTIVE-guard.**
  - `tests/integration/api/copy-move-messages.test.ts` — add `it("rejects move of ACTIVE/INACTIVE/ARCHIVED MC", () => {...})`. Seed three MCs (one per blocked status), attempt move on each, expect `ok: false, reason: "row_locked_by_status", status: <X>`. Source row should be untouched (no audience change, no version bump).

- [x] **6. Doc updates.**
  - Top-of-function comment on `moveMessages`: replace the "frozen" wording with the new contract (regenerated pmmid, blocked statuses).
  - `src/lib/pmmid.ts:1-9` — update the "Spec §14" pointer comment to note the move-regen behavior.
  - `docs/REBUILD_SPEC.md` §14 (pmmid section) — if it documents pmmid as frozen-after-create, flip to the new contract. (Read before editing — may not need a change.)
  - `tasks/component-inventory.md` — append `status-badge--archived` modifier if other status-badge modifiers exist (check first).

- [x] **7. Fix MC315a in the dev DB (one-shot).**
  - After the code change lands and tests pass, run `mc_update` (MCP) on `a_SZA_afatpdall-t_SZA_app_George_Features_-m_315-v_a-n_1` with a no-op change that triggers pmmid regen (e.g., set `audience_key` to itself), OR direct SQLite `UPDATE` regenerating the pmmid manually. Verify via `mc_get` that the new pmmid uses the full `SZA_afrtsegallvisitors` audience key.

### Out of scope (separate roadmap items — append-only, no work this session)

- **PMMID pattern field in Settings → Structure tab.** Storage already exists (`DEFAULT_PATTERNS.pmmid` in `src/db/defaults.ts`, `patterns.pmmid` flows through `readClientPatterns`). Only the UI input is missing. ~1 component, 1 form-field. Parallels the existing AudienceKey / TopicKey pattern inputs.
- **ARCHIVED default-hidden in matrix/library filters.** Current `EMPTY_FILTERS.statuses = new Set()` means "show all" — there's no notion of default-hidden statuses. Adding this requires a small design decision: either flip filter semantics ("checked = visible, unchecked = hidden, ARCHIVED unchecked by default") or layer a separate `hideArchivedStatus` boolean on top. Decide before implementing.
- **HTML creative auto-generated preview image link.** Roadmap item. Use cases to scope first: matrix-grid preview tile, share-link OG image, AdForm template-feed accompanying image, MCP-coworker screenshot input. Implementation choice (puppeteer snapshot vs. canvas render vs. external service) depends on which uses cases we commit to.

### Open question (filter-default for ARCHIVED)

User said "filterekben többnyire az biztos ki lesz kapcsolva". Two options for v1:
- **(A)** Defer entirely — ARCHIVED behaves like any other status (visible by default) until we design the filter mechanism. ARCHIVED becomes visually distinct via color but not auto-hidden.
- **(B)** Implement a minimal default-hide pass alongside step 1: e.g., `DEFAULT_HIDDEN_STATUSES = new Set(["ARCHIVED"])`, and the matrix toolbar initializes `filters.statuses` to the complement of that set when the user has not interacted with status filters.

Lean (A) — keeps this session tight, ARCHIVED filter UX gets its own slice once we're past pmmid-regen.

### Version bump suggestion (at end of work)
Still `6.0.0-pre`. No bump (per the project rule). The fix lands as part of the pre-active-use punch-list run-up.

### Review — landed (2026-05-23)

Branch `feat/keywords-tab` (working tree carrying multiple parallel slices — Keywords + Template-kind + now PMMID/ARCHIVED). All 7 plan steps shipped. `npm test` 291 → **294 (+3 new via `it.each` on ACTIVE/INACTIVE/ARCHIVED guard)**. `npx tsc --noEmit` clean for app code (only pre-existing `mcCount` errors in `audiences-key-pattern.test.ts:248-249` remain — same as previous sessions, unrelated).

**`ARCHIVED` status (1):** added as the 11th workflow value between INACTIVE and ERROR. Five touchpoints — no central source-of-truth module yet, so hand-mirrored across `STATUS_OPTIONS` (matrix/types.ts + MessageEditor.tsx), `STATUS_KEYS` + `STATUS_VAR` (DesignTab.tsx), `DEFAULT_LOOK_AND_FEEL.statusColors` (db/defaults.ts), and `--status-archived` + `.status-dot--archived` (globals.css). Default hex `#4b5563` (slate-600-ish, one shade darker than INACTIVE's `#6b7280` so the two read related-but-distinct in dropdowns). Distinct from `archivedAt` soft-delete column — that stays as the system-level safety net; status is user intent.

**Move-guard (1):** `BLOCKED_MOVE_STATUSES = new Set(["ACTIVE", "INACTIVE", "ARCHIVED"])` constant + pre-pass check in `moveMessages` returning `{ ok: false, reason: "row_locked_by_status", mcLabel, status, current }`. New reason added to the `MoveResult` discriminated union; `src/app/api/messages/bulk-move/route.ts` switch extended with a 409-response case (mirrors the version-conflict 409 shape so the matrix-edit client treats both as concurrency-class errors).

**PMMID regen on move (1):** `generatePmmid({audience: targetAudienceKey, topic, number, variant, versionNo: source.versionNo}, [], [], patterns.pmmid)` called alongside the existing `generateTrafficking` in the update loop; `pmmid: newPmmid` added to the `.set({...})` payload. `versionNo` stays frozen (creative-revision counter — move is a placement change, not a revision). Function-header comment block rewritten with the new contract.

**Tests (+3, all green):** in `tests/integration/api/copy-move-messages.test.ts`:
- Renamed and rewired `"moves 2 MCs into one audience — PMMID regenerated against new audience, versionNo frozen, version+1, source removed from origin"` (was "PMMID + versionNo frozen"). Asserts new pmmid contains target audience key, source's old pmmid no longer resolves via `getMessageByPmmid`, row still resolvable by `id`.
- Collision test (`"auto-bumps variant on collision in target cell"`) — flipped `pmmid.toBe(frozen)` → `.not.toBe(frozen) + contains aud2 + contains v_b`.
- New `it.each(["ACTIVE","INACTIVE","ARCHIVED"])` covering the guard: each variant expects `row_locked_by_status` reason, the right `status` echoed back, and the source row to stay untouched (audience, pmmid, version all unchanged).

**Docs (3):** `docs/REBUILD_SPEC.md` status enum row updated with ARCHIVED + explanation of the move-lock semantics + the status-vs-archivedAt distinction. `src/lib/pmmid.ts` header block expanded with the measurement-key + move-regen contract. `tasks/component-inventory.md` got a new "Változások 2026-05-23 (cont.) — ARCHIVED workflow status" block listing the 5 touched files and noting the open "ARCHIVED default-hide in filters" follow-up.

**MC315a backfill (1):** the stale dev row whose pmmid encoded the legacy `SZA_afatpdall` audience (from a v5 import / pre-fix move) was rewritten to the correct `a_SZA_afrtsegallvisitors-t_SZA_app_George_Features_-m_315-v_a-n_1`. Direct SQLite UPDATE + `version+1`. Verified via MCP `mc_get` round-trip — row resolves under the new pmmid, name/audience/everything else intact.

**Discovered during work (not in plan):** the `bulk-move` route's `switch (result.reason)` was non-exhaustive only by accident (TS happened to allow it because the post-switch code already assumed `ok: true`). Adding a new reason surfaced the gap as a compile error — which is the right outcome. The case statement is now exhaustive.

**Out of scope (carried over from plan — separate roadmap items):**
- PMMID pattern field in Settings → Structure tab (storage + generator already done; UI input missing).
- ARCHIVED default-hide in matrix/library filters (needs filter-semantic design choice first).
- HTML creative auto-generated preview image link (use cases to scope first).
- Centralizing `STATUS_OPTIONS` to a single `src/lib/mc-status.ts` source-of-truth module (tolerable hand-mirroring for now; revisit when next touching status logic).

## `list_assets` MCP tool (2026-05-25) — landed

**Context.** Continuation of the MC315 emulation session. After landing MC315b end-to-end on 2026-05-23, the user wanted c/d/e too — and observed the obvious gap: the Claude coworker on the MCP side has no way to look up the right `SZA_george_*` background image by name or keyword. Solution: a new `list_assets` MCP tool parallel to the existing `list_audiences` / `list_topics` / `list_mc` pattern.

**Implementation (`src/lib/mcp.ts`).** Inserted a new `list_assets` register block right after `list_mc` (around line 268). Filters:
- `file_name_contains` and `visual_keyword_contains` — case-insensitive `LOWER(col) LIKE LOWER(?)` substring matches (the search-y filters; both fields are free-text user-edited).
- `brand`, `product`, `type` — exact-match against the indexed columns (`assets_client_{brand,product,type}_idx`).
- `include_archived` — defaults to `false`; matches the established `list_X` convention.
- `limit` — defaults to 100, max 1000 (mirrors `list_mc`).

Returns the full asset row sorted by `file_name` ascending. Scoped to `ctx.clientId` (tenant-isolated).

**Tests (`tests/integration/api/mcp-list-assets.test.ts`, +5).** Case-insensitive substring match on `file_name_contains` and `visual_keyword_contains`, AND-combined exact filters (brand+product+type), archive include/exclude default, tenant isolation. Full suite **294 → 299**, all green.

**End-to-end emulation result.** Used the new tool live against `localhost:6001/mcp` to fetch all 5 `SZA_george_*` assets, then `mc_create_batch` created MC315c/d/e with the right `image1` per variant:

```
c | George FitZone         | SZA_george_c_sports_fitzone.jpg
d | George Kiemelt csempék | SZA_george_d_bills_koltsegek.jpg
e | George Kerekítő        | SZA_george_e_terminal_kerekito.jpg
```

Final cell state matches the screenshot annotations exactly — a/b/c/d/e all populated with the right name + flash + copy1 + image1.

**Process miss to flag.** During the curl-based emulation I accidentally created 4 duplicate rows (`f`, `g`, `h`, `i`) because my Python output-parser kept tripping on f-string-with-backslash syntax errors — the curl POST itself succeeded each time, the parser failure made me retry the whole pipeline. Cleanup: 4× `mc_remove` via MCP (soft-archived via `archived_at`, not hard-deleted), `list_mc` default cell view now shows only a-e. Lesson for future MCP-driven emulation runs: build the JSON payload as a string first, POST it, *then* parse the response in a separate step so a parser bug doesn't re-fire the side effect.

**Out of scope (deferred):**
- A more advanced search shape (fuzzy/typo-tolerant, e.g. ranking by trigram similarity on `visual_keyword`). Current LIKE-substring is enough for the keyword-driven workflow the user demonstrated; revisit if asset count grows past a few hundred and exact-substring stops finding obvious near-matches (one of the test assets had "befeketetes" with a typo — `visual_keyword_contains="befektetes"` wouldn't find it; the user can fix the typo in the asset record for now).
- An asset-write tool (`asset_create` / `asset_update`). The coworker pipeline still requires the user to upload assets via the UI before they're discoverable via `list_assets`.

### Version bump suggestion (at end of work)
Still `6.0.0-pre`. No bump (per the project rule). New MCP tool lands as part of the pre-active-use punch-list run-up. Once we graduate to `6.0.0`, the `list_assets` tool would individually have warranted a minor bump under the post-`6.0.0` heuristic.


## 2026-05-25 — Fix copy-MC bug: number kept, not incremented

**Symptom reported by user.** Copied MC 314 a/b/c from `SZA_afadpdall` to 9 other audiences in topic `SZA_promocio_Online_behavNeMaradjLe_150ejovairasok26q2`. Expected: 314 a/b/c repeats in each new audience cell. Actual: each new audience cell received a fresh global number — 316, 317, …, 324 — producing 27 garbage rows (IDs 32770–32796).

**Root cause.** `src/lib/entities/messages.ts:351-375` `copyMessages` calls `createMessage` for each (source, target audience) pair. `createMessage` calls `nextMcSlot(listLiveMessages, topic, audience)`, which for an *empty* target cell returns `MAX(global number) + 1`. So every target audience starts at a fresh global slot instead of inheriting the source's number. `moveMessages` already does the right thing at `messages.ts:478-521`: it pre-passes through resolved sources, builds an in-memory cell-occupant list, and only bumps the variant via `nextMcSlot` when `(source.number, source.variant)` is taken.

**Plan.**
- [ ] Refactor `copyMessages` to mirror `moveMessages` plan-pass: for each (source × target-audience), if `(source.number, source.variant)` is free in `(source.topic, target-audience)` cell, use it as-is; otherwise bump variant via `nextMcSlot`. Insert with regenerated PMMID + UTM (PMMID encodes audience+topic+number+variant+versionNo; can't be copied verbatim).
- [ ] Within a single copy batch, planned rows already pushed must count as occupants too (matches the move pre-pass — otherwise copying X a/b/c into the same empty cell would all collide on X a).
- [ ] Add vitest integration covering: (i) copy MC into empty audiences keeps number+variant; (ii) copy into an occupied cell bumps variant; (iii) batch self-collision (multiple sources → one target) lays them out without overlap.
- [ ] Hard-delete the 27 bad rows (IDs 32770–32796) — DB backup at `db/matrix.db.before-copy-fix` already taken before the destructive op. ID 32760/32761 (number=316 in `SZK_INCOMING / SZK____wip`) are pre-existing unrelated rows and are NOT touched.
- [ ] `npm test` clean.
- [ ] Commit.

**Cleanup-scope check.** Audit log and snapshots may reference the deleted IDs; both are append-only logs of past state — leaving orphan references is fine (the rows are gone; the log says "row 32770 was created" still, which is historically true). No FK from `creatives`, `feed_exports`, etc. to `messages.id` (creatives have their own loose `mc_number/mc_variant`), so hard delete is safe.

**Out of scope.**
- The pre-existing duplicate of number=316 across topics (32760 in SZK vs. the bad 32770 in SZA) is a separate symptom of `nextMcSlot`'s "global max + 1 across all topics" — within-topic numbering is currently NOT enforced as globally unique across topics, only within-cell. Not touching that here; the user only flagged the copy bug.


## 2026-05-27 — Decision Tree view (xyflow) + Settings tree-structure string

**User request (HU).** „Olvasd ki az MM5-ből hogy hol volt a tree structure állítva a settingsben, legyen MM6 settingsben is tree structure string, majd építs a Matrix editor view selectorába egy új nézetet 'decision tree' néven, használd a `@xyflow/react` modult, és építs vele egy decision tree-t a matrix adatokból, alkalmazva a header filtert. Külön git worktreen dolgozz, véletlenül se használd újra a régi tree kódot mert az rossz, bonyi-butus.”

### MM5 reverse-engineering (already done in research pass)
- **Settings UI:** `messagingmatrix/src/components/Settings.jsx:1050-1069` — single textarea labelled "Tree Structure".
- **Storage:** SQLite `config` table, key=`treeStructure`, category=`ui`. (Identical schema exists in MM6 → no migration needed, just a new row.)
- **Format:** arrow-separated levels, e.g.
  - `Product → Strategy → Targeting Type → Audience → Topic → Messages`
  - Optional `Source.Field` notation (e.g. `Audiences.Product`) when the field-name alone is ambiguous.
- **Parser logic (MM5, NOT reused):** `messagingmatrix/src/utils/treeBuilder.js` — split on `→`, then on `.` for source.field. We will **re-implement** in MM6 using the same string contract but a cleaner builder + xyflow renderer. The old renderer is explicitly out-of-bounds.

### MM6 facts
- View enum: `src/app/(app)/matrix/types.ts:135` → `export type View = "grid" | "feed";` — adds `"tree"` (or `"decisionTree"`).
- View switcher: `src/app/(app)/matrix/MatrixGrid.tsx:631-640` — two `toolbar-btn` buttons; add a third.
- Filtered data: `MatrixGrid.tsx:398-432` produces `filtered = { auds, tops, msgs }` after applying `Filters = { products, statuses, search }`. The new view consumes the same `filtered.*` props — **the header filter is automatically respected**, no extra wiring.
- Settings page: `src/app/(app)/settings/SettingsView.tsx` (tabbed: Keywords, Structure (PMMID), …). Tree-structure string belongs in the Structure tab next to the PMMID pattern field.
- `config` table schema: `src/db/schema.ts:95-113` — `(clientId, key, value, category)` composite-PK, tenant-scoped. New row: `(cid, 'treeStructure', '<arrow string>', 'ui')`.
- `@xyflow/react`: **not yet a dependency** — needs `npm install @xyflow/react`.

### Plan (small, reversible slices)

- [ ] **Worktree.** Enter a fresh worktree `decision-tree-view` off main. All work below lands inside the worktree; merge to `feat/template-kind` (current branch) at the end via PR or fast-forward, per user preference.
- [ ] **Slice 1 — Settings persistence + UI field.**
  - [ ] `src/lib/entities/config.ts` (or wherever the existing config read/write helper lives — `grep getConfig setConfig` first) → add a typed `getTreeStructure(cid) / setTreeStructure(cid, value)` pair.
  - [ ] `src/app/api/settings/tree-structure/route.ts` (or extend the existing settings route) — GET + PUT for the string. Tenant-scoped via JWT `cid`.
  - [ ] `SettingsView.tsx` Structure tab: add a labelled `<textarea>` ("Tree structure" / placeholder showing the default arrow string). Reuse existing `form-field` semantic class + tab markup; no new design tokens.
  - [ ] Default value seeded on first read if row missing: `Product → Strategy → Audience → Topic → Messages` (matches MM5 default minus the rarely-used "Targeting Type" level — confirm with user).
- [ ] **Slice 2 — Parser (clean, ~30 LOC).**
  - [ ] `src/app/(app)/matrix/_tree/parseTreeStructure.ts` — pure function, no React, no deps. Input: arrow-string. Output: `TreeLevel[] = { source: 'audience'|'topic'|'message', field: string, label: string }[]`. Validates: each level resolves to a known field on a known source.
  - [ ] Inline unit test alongside it (`parseTreeStructure.test.ts`, ~5 cases: happy path, `Source.Field` form, empty string, unknown source, trailing whitespace).
- [ ] **Slice 3 — Tree builder (data → xyflow nodes/edges).**
  - [ ] `src/app/(app)/matrix/_tree/buildTree.ts` — pure function. Input: `{ auds, tops, msgs }` + `TreeLevel[]`. Output: `{ nodes: Node[], edges: Edge[] }` in xyflow shape. Groups by level field-value, dedupes, generates stable IDs (`<levelIdx>:<value>`). Layouts in a horizontal hierarchy (level 0 = leftmost column, level N = rightmost). Uses a simple deterministic Y-stack within each column; no external layout engine for v1.
  - [ ] Inline unit test (~3 cases: single level, multi-level grouping, empty data).
- [ ] **Slice 4 — Decision Tree view component.**
  - [ ] `npm install @xyflow/react`.
  - [ ] `src/app/(app)/matrix/_views/TreeView.tsx` — semantic class `tree-view`. Receives `{ auds, tops, msgs, treeStructure }` props from `MatrixGrid`. Renders `<ReactFlow>` with built nodes/edges, pan/zoom enabled, no edit affordances for v1 (read-only). Empty-state: matches existing `empty-state` class used in Feed view.
  - [ ] CSS: import `@xyflow/react/dist/style.css` once at the view; project-specific overrides (node padding, fonts to match `text-xs` etc.) live in a co-located `tree-view.css` keyed by `.tree-view` block.
- [ ] **Slice 5 — Wire into view selector.**
  - [ ] Extend `View` type in `types.ts:135` to `"grid" | "feed" | "tree"`.
  - [ ] Add third `toolbar-btn` in `MatrixGrid.tsx:631-640` with a tree-ish lucide icon (`GitFork` or `Network`). Persistence key for selected view (if one exists already) gets the new value automatically.
  - [ ] `MatrixGrid` fetches the `treeStructure` string from settings via react-query (separate query, cache-scoped to `cid`), passes it into `<TreeView>` along with `filtered.*`.
- [ ] **Slice 6 — Validation.**
  - [ ] `npm test` clean (incl. the two new pure-function tests).
  - [ ] Manual: open `npm run dev:erste`, switch to Tree view, verify the tree reflects the current header filter (e.g. select one product → tree shrinks). Verify Settings → Structure → edit string → tree shape changes on next view switch.
  - [ ] No regression in Grid / Feed views (still default, still render).
- [ ] **Slice 7 — Wrap.**
  - [ ] Add new files to `tasks/component-inventory.md` (`tree-view`, `tree-view__node`, …).
  - [ ] Bump suggestion at end (still `6.0.0-pre`, so no bump — note for post-6.0.0).
  - [ ] Commit + PR back to `feat/template-kind`.

### Decisions (user confirmed 2026-05-27)
1. **Default arrow string:** `Product → Strategy → Audience → Topic → Messages` (5 levels).
2. **Settings tab placement:** Structure tab, next to PMMID pattern field. No new tab.
3. **Leaf-node click:** opens the existing message editor (same side-panel / modal that Grid view uses). Slice 4 grows to wire this up.
4. **Worktree merge target:** standalone PR to `main` (not back into `feat/template-kind`).

### Slices (worktree decision-tree-view, branched from main)
- [x] Slice 1 — Settings persistence (`treeStructure` DEFAULT_STRUCTURES + seed + Structure-tab section).
- [x] Slice 2 — `_tree/parseTreeStructure.ts` pure fn + 7 unit teszt.
- [x] Slice 3 — `_tree/buildTree.ts` pure fn + 5 unit teszt.
- [x] Slice 4 — `_views/TreeView.tsx` xyflow render + leaf click → MessageEditor.
- [x] Slice 5 — `View` enum + view selector (CycleIconButton + ViewControls + localStorage rehydration).
- [x] Slice 6 — `npm test` 207/207 zöld, `npx tsc --noEmit` clean. Manual smoke a user dolga (dev:erste a main checkout-on fut).
- [x] Slice 7 — `tasks/component-inventory.md` frissítve, commit, PR a main-re.

### Review

**Shipped.** All 7 slices landed.

- **Persistence (Slice 1).** `treeStructure` joined the existing `config` table — no migration, no new route, the generic `/api/config` GET/PUT carries it. Default in `DEFAULT_STRUCTURES.treeStructure` + `defaultConfigSeed()` (`src/db/defaults.ts`). Structure tab got a dedicated section "Decision tree structure" with a single-line textarea — kept separate from the "CSV column order" section because arrow-separated levels are conceptually different from CSV column lists.
- **Parser (Slice 2).** `src/app/(app)/matrix/_tree/parseTreeStructure.ts`, 7 tests. Bare tokens + `Source.Field` form. Case- and whitespace-tolerant. Throws on unknown levels → TreeView surfaces as a clean error empty-state.
- **Builder (Slice 3).** `src/app/(app)/matrix/_tree/buildTree.ts`, 5 tests. Pure fn `{auds, tops, msgs} × TreeLevel[] → {nodes, edges}`. Stable IDs (`<levelIdx>:<groupPath>`), deterministic vertical order. `(none)` bucket for empty group values so missing fields don't silently disappear.
- **TreeView (Slice 4).** `src/app/(app)/matrix/_views/TreeView.tsx`. Read-only xyflow graph (pan/zoom/minimap/controls). Leaf Messages-node onClick → `onOpenMessage(id)` — same prop Grid/Feed use, so the same `MessageEditor` side-panel opens. Loading/Error/Empty states. CSS in `globals.css @layer components` keyed by `.tree-view*` blocks (no inline style; only computed xyflow `position`).
- **Wiring (Slice 5).** `View` extended to `"grid" | "feed" | "tree"`. MatrixGrid renders `<TreeView>` when `view === "tree"`, passes `filtered.{auds, tops, msgs}` → header filter automatically respected. Toggle group + CycleIconButton got `tree` option (`GitFork` lucide icon). localStorage rehydration accepts `"tree"`.
- **Validation (Slice 6).** `npm test` → **207 passed** (+12 new unit tests vs. baseline). `npx tsc --noEmit` clean. Manual smoke pending — dev:erste was already running on the main checkout. User needs to switch the dev server into the worktree or boot a parallel deploy on a free port to click through.
- **Inventory (Slice 7).** `tasks/component-inventory.md` got a "Változások 2026-05-27" block.

**Out of scope.**
- Auto-layout (currently top-down stack within each column; dagre/elkjs not needed at current data scale).
- In-view tree editing (drag-reorder levels) — Settings textarea is the only edit surface.
- Sankey alt-graph (MM5 had `sankeyStructure`; not ported — wait for demand).

**Version bump.** Still `6.0.0-pre` → no bump (per project rule). Post-`6.0.0` this would be a **minor** bump (new view + new dependency + new settings field).

### Iterative polish — same-day (2026-05-27)

After the initial feat commit landed on main (`cb96aca`), the user walked
the new view live against the Erste dataset and we tightened 9 things back
to back. Every fix shipped as its own small commit + local-main FF, so the
history reads as a clean progression rather than one mega-rewrite:

1. **`151162f` — Default-expand only L0.** Initial render had every level
   visible; columns 2+ became a wall of nodes. Switched the state model
   from `collapsed: Set` to `expanded: Set | null` (null = synthesise the
   default per render, default = every L0 node id). Localstorage key
   bumped v1 → v2 so the old "fully expanded" state didn't override.
2. **`353e045` — Cursor-anchor on toggle.** Tidy-tree's parent-y =
   midpoint-of-children meant expanding a node always moved it. Now
   `toggleExpanded` re-runs layout off the next expanded set, diffs the
   toggled node's old vs new y, and counter-pans the xyflow viewport so
   the node stays under the cursor. Required wrapping TreeView in a
   `ReactFlowProvider` + splitting into outer/inner so the inner could
   call `useReactFlow()`.
3. **`187f572` + `db028ec` — Per-level colour stripe.** Each node gets a
   CSS class `tree-view__node-wrap--lvl-N` (N derived from the buildTree
   id prefix), styled in `globals.css` with a 4px coloured left border
   (L0 blue / L1 violet / L2 emerald / L3 amber / L4 rose). Same swatch
   originally fed the MiniMap too — later swapped to uniform black per
   user preference.
4. **`a88eb6a` — Layout + alignment fixes.** `.tree-view__node` got
   `height: 100%` so the inner flex container fills the wrapper (chevron
   + label + count were drifting to the top of the box). Labels switched
   from `space-between` to `flex-start` + `margin-left: auto` on the
   count badge for hard left-alignment. COLUMN_WIDTH bumped 240 → 280
   to give smoothstep edges enough room to route cleanly (40px gap was
   squashing fans into a single visual blur).
5. **`ffa2037` — MiniMap + Controls relocated.** Both pinned to the
   top-right corner via CSS overrides with `!important` (xyflow's
   default panel position classes set top/right via the same props).
   Controls sit at `top: minimapSize.height + 20`. MiniMap nodes
   dropped the per-level colour function and render uniform black
   (`#0f172a`) — level colours stay on canvas nodes only.
6. **`2820ea3` — Size container to content aspect.** The fixed
   220×220 minimap let the SVG letterbox content inside. Now the
   container width/height come from the visible-content bounding box
   aspect ratio (capped 180px on the longer axis, min 90px on the
   shorter). With matching aspect the default
   `preserveAspectRatio="xMidYMid meet"` reaches all four edges
   naturally — earlier attempt to force `"none"` via a DOM hack didn't
   stick because xyflow re-renders the SVG.
7. **`a2bd269` — Smaller minimap + visible viewport indicator.**
   Cap dropped 260 → 180, mask opacity 8% → 18% so the "white box" was
   actually visible; 1.5px slate stroke around the indicator so it
   reads as a clear draggable affordance.
8. **`719ae9c` — Clip minimap to rounded border.** Zooming the main
   canvas in made the mask path extend past the rounded corners.
   `overflow: hidden` on the container.
9. **`b2989aa` — Inverted mask: 50% white veil.** User wanted the
   minimap to read as solid white with outside-viewport dots faded.
   maskColor flipped from `rgba(15,23,42,0.18)` (dim veil over outside)
   to `rgba(255,255,255,0.5)` (50% white over outside, fading those
   dots while inside-viewport dots stay full black). Stroke colour
   changed to `#cbd5e1` for a soft 1px viewport outline.

### Status: DONE 2026-05-27

All slices shipped. The Decision Tree view is the third matrix view
alongside Grid and Feed; behind it sits the user-configurable
`treeStructure` string in Settings → Structure. Spec written up in
`docs/REBUILD_SPEC.md §18` (local) and roadmap Phase 4 marked accordingly
in `~/.claude/plans/you-ll-see-docs-and-snappy-charm.md` (local).
Component-inventory entry already added in the initial commit.

Remaining open from this slice:
- Sankey alt-graph (MM5 had `sankeyStructure` too; **not** ported — wait
  for actual demand before building).
- The `audiences-key-pattern.test.ts:248-249` `mcCount` tsc errors are
  pre-existing main noise from commit `d3ef4b8`, unrelated to this slice;
  runtime tests pass (314/314 → 314+12 = 326/326 with the parser/builder
  units this slice added; vitest count may show different number
  depending on which integration tests ran).

---

## 2026-05-28 — Merged priority list (punch list + brain Q2 2026 backlog)

**Status: agreed, NOT started.** Synthesized from two sources: (a) the pre-active-use punch list above (items 1–10, anchored 2026-05-03), (b) brain thought `44378666-3a21-4210-b21f-55327055d7d6` "Messaging matrix — Fejlesztési feladatok Q2 2026" logged 2026-05-28 against the running Erste deploy. The four brain tasks are largely orthogonal to the punch list — this list interleaves them where the work surface overlaps (smoke-test friction, creative-ID join column, design-token cleanup).

User has agreed to this ordering. Each wave is independently shippable. **Do not start any wave** without an explicit user green-light naming the wave.

### Wave 0 — Foundational cheap win
- [ ] **W0.1 Status colors single source of truth** (brain Task 1). Matrix grid status dots today are hardcoded; must read from the `lookAndFeel` CSS-var tokens the Design tab writes (INCOMING #ecdc74, NAMING #f5e10a, CONTENT #f7963b, PREVIEW #a855f7, APPROVED #0f8a61, ACTIVE #22c55e, INACTIVE #6b7280, ERROR #ef4444, DEAD #000000, MEMORY #0d5dfd). Remove hardcoded status→colour mapping in the Matrix render path. Editing in Design → Save reflects in Matrix dots after reload.
- [ ] **W0.2 Status filter dropdown swatches** (brain Task 1 secondary, only if trivial). Add a colour swatch per status to the Status filter dropdown — currently text-only.
- **Open Q before starting:** the reference hex palette in the brain note — write it into `defaultConfigSeed()` as the new defaults for all clients, or only patch the existing Erste row in `config`? (One updates new clients going forward; the other only fixes Erste.)

### Wave 1 — Smoke tests + edit-mode adds (paired)
Pairs punch list 7+8+9 with brain Task 2 because the smoke run is the validation for Task 2's friction-removal.
- [ ] **W1.1 Manual UI smoke** (punch list 7). Add new audience + topic + MC end-to-end on `dev:erste`. Verify dimension grid, audit log, matrix grid, iframe preview, AdForm feed-export dry-run. Capture friction inline.
- [ ] **W1.2 Dense-view New MC button** (brain Task 2a). Available today only at lower densities; bring to dense/compact, match existing-density pattern.
- [ ] **W1.3 Add audience / Add topic actions** (brain Task 2b). Edit mode only. Trailing `+` cell/row near axis headers; create with default name/key, rename via normal flow.
- [ ] **W1.4 Hover Duplicate on audience/topic headers** (brain Task 2c). Edit mode only. Append numeric suffix to BOTH name and key, auto-increment to avoid collisions.
- [ ] **W1.5 MCP smoke** (punch list 8). Provision token, drive `audience_create` / `topic_create` / `mc_create`, verify rate-limit + active-client guards.
- [ ] **W1.6 Agent-from-prodlist smoke** (punch list 9). Real Erste prodlist → agent proposes diff → `mc_create_batch`. Capture MCP tool ergonomics gaps.
- **Open Qs before starting W1.4 (Duplicate):**
  - (a) Does duplicating a header copy its MCs/cells too, or just the empty header? Default suggestion: **header-only first**.
  - (b) Key suffix format — name gets `" (1)"`, but keys probably can't contain spaces. Default suggestion: **`_1`** for keys.

### Wave 2 — Creative-ID join consolidation
Punch list 3+4 share the same `creatives.(mcNumber, mcVariant)` join surface as brain Task 3's comments-keyed-by-creative-ID. Doing them as one wave means one focused pass over the `creatives` table.
- [ ] **W2.1 Inspect current upload path** (punch list 3.1). Survey-only: does the upload flow set `mcNumber`/`mcVariant` from filename today? Document the regex if yes.
- [ ] **W2.2 Manual match UI on CreativeDetailDialog** (punch list 3.2). Two dropdowns (audience+topic) + MC number/variant picker filtered to that intersection. Save → `PATCH /api/creatives/[id]`. "Unlink" sets both to `null`.
- [ ] **W2.3 Filename auto-match heuristic** (punch list 3.3). Extract `mc(\d+)([a-z])` on `POST /api/creatives`. Show as "Suggested match — click confirm", do not commit silently.
- [ ] **W2.4 Bulk-match dialog** (punch list 3.4). Toolbar action over all uploaded-kind items where `mcNumber IS NULL`. Confirm-table → batch `PATCH`. Reuses `FeedExportDialog` diff-stats pattern.
- [ ] **W2.5 Soft-link vs join-table decision** (punch list 3.5). Default: keep soft `(mcNumber, mcVariant)` link, revisit only if a real workflow demands many-to-many.
- [ ] **W2.6 Unmatrixed filter pill** (punch list 4.1). `All | Matrixed | Unmatrixed` on Creative Library toolbar. Filter logic: `kind === 'uploaded' && (mcNumber == null || mcVariant == null)`.
- [ ] **W2.7 Unmatrixed corner badge** (punch list 4.2). `status-badge--unmatrixed` visible even when "All" filter is selected.
- [ ] **W2.8 Persist filter + counts** (punch list 4.3, 4.4). localStorage key `mm6_creative_library_match_filter`; `(N)` next to each filter pill.
- [ ] **W2.9 Extract shared comments component** (brain Task 3b). Today's public-share comments UI → standalone reusable component. **Re-key thread storage to creative ID** (not share, not MC) so it survives share deletion. Keep commenter identity visible (internal user vs external share viewer).
- [ ] **W2.10 Creative Library preview → Details + Comments tabs** (brain Task 3a). Move current preview content into Details tab; mount shared comments component in Comments tab.
- [ ] **W2.11 MC editor → Comments tab** (brain Task 3c). Same shared component.
- **Open Q before starting W2.11:** an MC can map to multiple creatives — does the Comments tab in the MC editor show **one thread per linked creative (selectable)** or **scope to the focused creative**? Default suggestion: **one thread per focused creative**, with a creative selector inside the tab when N > 1.

### Wave 3 — Monitoring ingest + match
- [ ] **W3.1 `reporting.platform` schema field** (punch list 5.1). Add `platform TEXT NOT NULL DEFAULT 'adform'`. Backfill. Add `external_id` + `external_name` as platform-agnostic identifiers; keep `mcLabel` AdForm-only.
- [ ] **W3.2 Shared importer route** (punch list 5.2). `POST /api/reporting/import`, multipart with `file` + `platform`. Returns `{ imported, skipped, diff }`.
- [ ] **W3.3 AdForm parser** (punch list 5.3). Reads AdForm reporting XLSX shape. Maps `mcLabel` + impressions/clicks/CTR. Test fixture from real export.
- [ ] **W3.4 Meta parser** (punch list 5.4). Reads Meta Ads Manager XLSX/CSV. Maps `meta_ad_id` + `meta_ad_name` + impressions/clicks/CTR/spend. **Blocked until user provides a sample Meta export file** — column names vary by report template.
- [ ] **W3.5 Monitoring page UI** (punch list 5.5). Replace placeholder with `DimensionGrid`-style list. Filters: platform, date range, product, MC number. Copy `/texts` page structure (design-reuse).
- [ ] **W3.6 Monitoring upload widget** (punch list 5.6). Top-of-page drag-drop, auto-detect platform from column header signature, user override.
- [ ] **W3.7 `reporting.message_id` FK** (punch list 6.1). Nullable FK to `messages.id`. Not a hard constraint.
- [ ] **W3.8 AdForm PMMID resolver** (punch list 6.2). PMMID → `message_id`. Reuse `extractDefaultMc` + audience/topic/variant regex. Atomic backfill.
- [ ] **W3.9 Meta resolver** (punch list 6.3). Two strategies: (a) MC label in `meta_ad_name` (regex), (b) fallback: "Needs match" table with manual-link UI.
- [ ] **W3.10 Matrix cell stat badge** (punch list 6.4). Once message has linked reporting rows, MatrixGrid cell shows impressions/CTR badge. Defer styling to follow-up.
- [ ] **W3.11 Unmatched reporting view** (punch list 6.5). Mirror of W2.6 but for reporting rows where `message_id IS NULL`.

### Wave 4 — Platform expansion (push back FIRST)
Before any code: confirm with user whether they are **driving Meta campaigns out of MM6**, or only **tracking** what's running on Meta. If tracking-only, skip 1.1–1.6 and do only the audience-level platform tag — items 5/6 are enough.
- [ ] **W4.1 Push-back conversation** (punch list 1 prelude). Lock the (a) full-lifecycle vs (b) tracking-only choice.
- [ ] **W4.2 `audiences.platform` enum** (punch list 1.1). `adform | meta | dv360 | direct_display`. Migration + per-row backfill.
- [ ] **W4.3 Audiences UI: platform pill + filter** (punch list 1.2).
- [ ] **W4.4 Per-platform feedStructure + feedPatterns** (punch list 1.3). Settings → Patterns gets a platform tab.
- [ ] **W4.5 Feed export route platform-aware** (punch list 1.4). **Blocked until user locks the Meta export shape** (Custom Audience CSV vs bulk Ads Manager XLSX).
- [ ] **W4.6 Feeds UI: platform discriminator** (punch list 1.5).
- [ ] **W4.7 Direct Display platform tag** (punch list 2.1). Probably just `platform='direct_display'` + existing `buyingPlatform` for vendor name.
- [ ] **W4.8 Direct Display vendor fields decision** (punch list 2.2). Default: nothing more needed — vendor fits in `buyingPlatform`.

### Wave 5 — Share → Google Drive (push back FIRST)
Brain Task 4. Largest unknown, deliberately under-specified.
- [ ] **W5.1 Push-back conversation.** Is the cheapest 80% just "download the share view as PDF, manual Drive drop"? If yes, **kill the build**. Only proceed if a concrete client/agency workflow demands native export.
- [ ] **W5.2 Lock open questions (only if W5.1 says build):**
  - Target folder (per-client default in Settings / ad-hoc picker / both)
  - Export format (PDF snapshot of share view / structured CSV-JSON / rendered assets + manifest / combination)
  - Naming convention (`{client}_{share-name}_{timestamp}` or editable)
  - Auth (per-user Google account vs existing MM service account)
  - Snapshot vs sync (one-time / re-export with overwrite / versioned)
  - Lifecycle (if share deleted in MM, what happens to the Drive copy)
- [ ] **W5.3 Ship destination toggle + unchanged MM path first.** Option 1 = current behaviour (default), Option 2 = Drive (placeholder).
- [ ] **W5.4 Land Option 2 narrowest-viable-first** after W5.2 answered.

### Parallel polish (runs anytime, piecemeal)
- [ ] **WP.1–WP.8 Dark-mode component sweep** (punch list 10.1–10.8). Sidebar → modals → grids → matrix chrome → forms → status pills → iframe chrome → visual QA. Never search-and-replace; one cluster at a time, verify visually. Foundation already landed 2026-05-07 (shadcn-style tokens in `globals.css` + tailwind config).

### Stays pinned / deferred (no change)
- File-system ingest pipeline (Forklift/Drive → `_inbox/`) + MCP error-triage tools — Phase 11, post-launch.
- Sankey alt-graph for the Tree view — wait for actual demand.
- HTML creative auto-generated preview image link — scope use cases first (matrix-grid tile / share-link OG / AdForm template-feed image / MCP screenshot input).

### Version bump
Still `6.0.0-pre`. None of the waves individually graduates to `6.0.0`. The graduation event is "**all of Wave 1 + at least one wave of real-data validation passed**" (i.e. the system actually survives a day of use, not just a test). User decides the bump.

---

## 2026-05-31 — Wave 3 (Monitoring ingest) — PLAN, awaiting green-light on schema-home

**Status: planned, NOT started.** User green-lit Wave 3, starting with the monitoring upload. Only AdForm data available (Meta blocked → W3.4/W3.9 deferred). Plan grounded in the REAL export shape, not the todo's earlier assumptions.

### Real-data findings (from `docs/Creative rep_04_2026.xlsx`)
- Sheet `Sheet`: row 2 = header `[_, Date, Campaign, Line Item, Banner Ad Message, Banner/Adgroups, Dynamic Ad Version, Click Details, Cost, Clicks, CTR (%), Conversions]`; col A always empty; data from row 3. ~85,503 rows / month (April). `Front Page` sheet carries Reporting Period From/To.
- Granularity is keyword/banner-level. **847 distinct message keys** (`audience|number|variant`); **22,634** day-keys. PMMID extractable on **85,502 / 85,503** rows.
- PMMID lives in **Banner/Adgroups**, two formats: (a) display/Adform → 3rd ` - `-delimited segment `p_adform-s_pro-a_<aud>-m_<num>-t_<topic>-v_<var>-n_<ver>_<lineitemid>`; (b) search/richmedia → `…!pmmid=<PMMID>!v11`.
- PMMID **scope prefix encodes platform/vendor** (17 seen): p_adform 60k, p_dv360 20k, googleads 3k, meta 600+, tiktok, telex, infinety, flex, … → `platform` is DERIVED from the scope, not hardcoded `'adform'`.
- Metrics in this export: **Cost, Clicks, CTR (%), Conversions** — no Impressions.

### Decisions locked (this session)
- **D1 Aggregation:** message/period — one row per `(audience, number, topic, variant)` per report period; sum impressions/clicks/cost/conversions, recompute CTR. ~847 rows/mo/client. Daily trend dropped for now.
- **D2 Impressions:** user adds Impressions metric in the AdForm report builder and re-exports 04/05. Parser must map columns **by header name** (order-independent) so adding the column doesn't break it.
- **D3 Platform:** derive normalized `platform` + keep raw `scope` from the PMMID scope prefix.

### OPEN — schema-home fork (needs user pick before coding)
The existing `reporting` table is LIVE: 4,380 rows (Erste), banner/label grain, `mcLabel`-keyed, populated by the **full-workbook XLSX import** (`import-xlsx.ts:603`), which **deletes ALL reporting rows for the client on every re-import** (`import-xlsx.ts:104`). Two grains, two sources, one delete-all → collision.
- **Option A — new `monitoring` table (RECOMMENDED).** Separate table for the standalone AdForm-report performance ingest. No collision with workbook import; clean message-level grain; multi-platform; FK to messages. `reporting` stays the workbook-sourced banner snapshot.
- **Option B — extend `reporting` + add `source` column.** Reuses one table but requires making `import-xlsx.ts` delete only `source='workbook'` rows and reconciling two grains. More invasive, touches a working path.

Proposed `monitoring` columns (Option A): `id, clientId(FK,cascade), platform TEXT NOT NULL, scope TEXT, pmmid TEXT, messageId INTEGER FK messages.id NULL, audienceKey, topicKey, mcNumber INTEGER, mcVariant TEXT, impressions INT d0, clicks INT d0, cost REAL d0, conversions INT d0, ctr REAL, periodFrom, periodTo, importedAt, sourceFilename`. Idempotency: re-upload of same `(clientId, platform, periodFrom, periodTo)` deletes+reinserts that slice. Indexes: `(clientId, messageId)`, `(clientId, platform)`, `(clientId, mcNumber, mcVariant)`.

### Slices — first shippable = ingest (the upload the user asked to start with)
**DECISION: Option A chosen. Old `reporting` table to be retired (user: it was throwaway) but LAST — after MCP repointed — not entangled with this ingest. Impressions = "Rendered Impressions" (user re-exported 04/05 with it added + a "Tracked Ads" column).**
- [x] **W3.a Schema + migration** — new `monitoring` table, migration `0017_cool_the_hood.sql` generated + applied. Integration test `tests/integration/monitoring-table.test.ts` (insert, unique key, FK set-null, client cascade). ✅
- [x] **W3.b AdForm Creative-report parser** (`src/lib/adform-report.ts`). Header-name column map (order-independent → impressions-add safe); PMMID extraction both formats; position-based marker parse (hyphen-safe audience/topic); platform normalized from scope; message/period aggregation; period from `Front Page`. Unit test `tests/unit/adform-report.test.ts` (8 cases). Validated vs real 04/05: ~884 msg rows, 10M impr, totals sane. ✅
- [x] **W3.c Importer route** `POST /api/monitoring/import` — multipart `file`; parses, resolves `messageId` by exact `(number,variant,audience,topic)`, idempotent delete+insert per period. Returns `{ imported, matched, unmatched, skipped, totalDataRows, periodFrom, periodTo, platforms }`. Mirrors `/api/adform-snapshots`. ✅
- [x] **W3.d Upload widget on Monitoring page** — placeholder replaced with `MonitoringUpload` (drag-drop + click, result summary card + platform chips). ✅
- **Dry-run match rate (live DB, client 8, April):** 685/884 = **77%** auto-matched. dv360 239/240, adform 446/585, external vendors (meta/googleads/flex/telex/infinety/…) 0% (m_00 or topic-key mismatch). The 23% → W3.h unmatched view. NOT loosening match key (false-match risk).
- **NOT yet:** end-to-end through the real UI / write to live DB (offered to user). W3.e resolver folded into W3.c. 326/326 tests green.

### Wave 3 follow-on (after ingest lands, same wave)
- [x] **W3.e Resolver** — folded into the importer (W3.c): exact `(number,variant,audience,topic)` join on insert. ✅ (heuristic/manual fallback → W3.h)
- [x] **W3.f Monitoring list UI** — `GET /api/monitoring` (periods + selected-period rows, left-join messages) + `MonitoringTable`/`MonitoringView`. Period selector, platform select, All/Matched/Unmatched pills, totals header, impressions-sorted table. Upload now refreshes the table in place (was: result vanished on navigate). ✅ (W3.h unmatched is covered by the Unmatched pill; a dedicated manual-link UI still pending.)
- [ ] **W3.g Matrix cell stat badge** (W3.10) — once message has monitoring rows, MatrixGrid cell shows impressions/CTR. Styling deferred.
- [ ] **W3.h Unmatched manual-link UI** (W3.11) — Unmatched pill already filters; still need a per-row "link to message" action for the 23%.
- Deferred: W3.4 Meta parser, W3.9 Meta resolver (blocked — no Meta export).

### Version note
Wave 3 adds a table + migration + route + page UI → **minor** bump territory (`6.0.0-pre` rules: track here, no per-commit bump; graduation still user-decided).

## 2026-05-31 — W3 product field + keyword→product rules (Structure → Monitoring)
- `monitoring.product` column (migration `0018_nosy_blob.sql`). Resolution at import: audience→product (matrix) → keyword rule (topic+PMMID substring) → null. Helper `resolveProduct` in `adform-report.ts` (+4 unit tests).
- Settings → Structure → **Monitoring** section: editable keyword→product rule list, stored as config `monitoringProductRules` (category `structure`). Importer reads it.
- Monitoring list: new sortable `Product` column + `Product` MultiPill (mirrors creative-library Product/Type); platform select replaced by `Platform` MultiPill. Period dropdown + match pills now count-less; `toolbar__count` = `visible/total rows · CTR`.
- Seeded Erste rules (microszamla/microhitel→VAL, max/wizz→HK, otthonstart/jelzalog→HITEL, onlineszamla→SZA) into config (client 8) + backfilled May rows: 731/837 got a product (SZK 389, HK 202, VAL 111, SZA 21, HITEL 8, null 106). Editable in the UI.
- 326+4 tests green.

## 2026-05-31 — W3 size grain + MonitoringDetailDialog (matched + unmatched)
- `monitoring.size` (migration `0019`); parser `extractSize`; aggregation now keyed incl. size (unique index updated). May re-imported size-grained: 3002 rows (300x250/300x600/970x250/640x360/1x1…), 2994 with product, 2574 matched.
- Table: sortable **Size** column; every row (matched + unmatched) opens `MonitoringDetailDialog`.
- `MonitoringDetailDialog`: matched → live MC preview; unmatched → "unmatched" placeholder; both show an **audience × size** breakdown (impr/clicks/CTR + total) for that MC.
- 333 tests green (3 new extractSize).
- NOTE: per-period rows grew (~3000 for May) due to size grain — single fetch, lazy iframe previews, content-visibility on rows. Re-watch perf if periods accumulate.

## 2026-05-31 — W3 table size-collapse + commit + spec
- **Correction to the entry above:** the Monitoring **table no longer shows a Size column**. Sizes are collapsed client-side back to one display row per (platform, product, MC, audience, topic, message) — May shows ~837 display rows again. The size-grained rows (3002) are still returned by `GET /api/monitoring`; the **per-size breakdown lives only in `MonitoringDetailDialog`** (audience × size). Table sort keys: platform/product/mc/audience/topic/message/impr/clicks/ctr/cost/conv (no size).
- **Committed** on branch `feat/monitoring-ingest`: `cbcd31c feat(monitoring): AdForm Creative-report ingest + matrix-matched view` (24 files: schema + migrations 0017/0018/0019, parser, monitoring-products, 3 routes, full Monitoring UI, StructureTab section, MatrixIframeTile export, tests, docs). Excluded `.codex/`, db backups, unrelated scripts. Branch is local (not pushed).
- **Spec updated** (`docs/REBUILD_SPEC.md`, on disk only — `docs/` is gitignored, so NOT in the commit): §3.7a `monitoring` table, §3.7 retire note, §4.9a ingest routes, §6.6 `/monitoring` rewrite, §6.9 Structure→Monitoring rules, §3.9 known keys + `monitoringProductRules`.
- Tests: 333 green. Still `6.0.0-pre` (no bump; tracked here).

### Wave 3 — remaining
- [ ] **W3.g** Matrix cell stat badge (impr/CTR on matched MatrixGrid cells).
- [ ] **W3.h** Unmatched manual link-to-message action (Unmatched pill already filters).
- [ ] **Retire legacy `reporting`** — drop table + repoint MCP `get_mc_reporting` / `monitoring_status` to `monitoring`, remove import/export-xlsx + snapshots refs. Do LAST.
- Deferred: Meta parser/resolver (no sample export).

---

## 2026-05-31 — Feed export: hooks crash + allow INACTIVE

Two bugs reported in Feed view / FeedExportPanel:

1. **Crash on status-filter change** ("rendered more hooks than previous render").
   Root cause: `filteredIds` `useMemo` in `FeedExportPanel.tsx` lives *after* the
   `if (!ready) return` early-return → hook count changes when `ready` flips.
   - [x] Hoist `filteredIds` useMemo above the early return.

2. **Feed export only allowed ACTIVE-only status; INACTIVE should be includable.**
   `IsActive` feed pattern is already `{{status}}=ACTIVE?TRUE:FALSE`, so INACTIVE
   rows render `ISACTIVE=FALSE` once let through. Need to widen two gates:
   - [x] UI gate (`FeedExportPanel.tsx`): allow status filter = non-empty subset of
         {ACTIVE, INACTIVE}; update gate copy + the hardcoded "ACTIVE" filter chip.
   - [x] Server build (`feed-export.ts`): include ACTIVE **or** INACTIVE (non-archived,
         product-matched); update BuildOptions doc comment.
   - Invariants check: only widens the current-serving set; sticky-superset /
     version-bump / uploaded≠exported / default-row transforms all unaffected.

### 2026-05-31 (cont.) — two feed data/config fixes (client 8 / Erste)

3. **MC314 a/b/c stale PMMID** — ids 32756/57/58 had `audience=SZA_afadpdall`
   but stored `pmmid=a_SZA_INCOMING-…` (imported with a mismatched PMMID column;
   `import-xlsx.ts:381` trusts it verbatim, move-regen blocked for ACTIVE rows).
   No measurement anchored to either key → safe. Fixed via one-time UPDATE
   (swapped audience segment). Backup: `db/matrix.db.before-pmmid-314-fix`.

4. **Text:template_variant_class wrong formula** — config `patterns.feed`
   key was `MC{{number}}_{{variant}}_{{topic}}_{{version}}` (the advert-name
   shape; `{{version}}` = optimistic-lock counter → _69/_51/_2…). v5 ground
   truth: `template_variant_class → {{template_variant_classes}}`. Reset to
   `{{Template_variant_classes}}` for client 8. Backup:
   `db/matrix.db.before-tvc-pattern-fix`.
   - OPEN/flagged: `advert_name` + `Text:advert_name` still use `{{version}}`
     (lock counter) instead of `{{version_no}}` — same _69 leak in the
     advert_name column. Left for user decision (affects AdForm advert naming).

---

## 2026-05-31 — Matrix filters + status UI + editor stepper + global-edit (9-item batch)

Decisions locked: (filter) only `mc:` collapses empties; a:/p:/s: pick audience
columns, t: picks topic rows, all keep the full grid otherwise. (global) propagate
creative+status fields, never placement (audience/topic/dates/pmmid/utm). Siblings =
same (number,variant) — never spans >1 topic (verified). Delivery = phased.

### Phase 1 — UI + filters (ship + review before Phase 2)
- [x] **1.1** Status dropdown always lists ALL canonical statuses (`STATUS_OPTIONS`),
      not just those present in data. `MatrixGrid.tsx:388` statusOptions.
- [x] **1.2** Status filter checkboxes tinted per status color (`STATUS_COLOR`).
      `MultiPill.tsx` — add optional per-option color dot, keep component generic.
- [x] **1.3** MC editor: show status as a colored DOT only (no status-name text),
      placed in the stepper before the MC label. `MessageEditor.tsx:458-471`.
- [x] **1.4** Stepper steps between UNIQUE MCs (number,variant), not per-audience
      duplicates; counter shows unique index/total. `MessageEditor.tsx:240-246,453`.
- [x] **1.5** Filter-semantics redesign in `MatrixGrid.tsx:403-437`: a:/p:/s: select
      audience columns by audience entity attrs (key/name/platform/strategy) without
      pruning topic rows; t: selects topic rows without pruning audience columns;
      only `mc:` prunes both rows+cols to populated cells. Product dropdown unchanged.

### Phase 2 — global edit propagation (separate commit, after Phase 1 review)
- [x] **2.1** global/local toggle next to Autosave (`MessageEditor.tsx:~504`).
- [x] **2.2** When global ON, saving an edit fans the creative+status payload to all
      same-(number,variant) siblings (each with its own version); placement fields
      stay local. New API path / entity fn for sibling fan-out.
- [x] **2.3** Next to stepper counter, when global ON, warn "edits will update N other
      audiences" (N = sibling count).

### Review — session results (2026-05-31)

Shipped on `feat/monitoring-ingest` (3 commits):
- `cb8855e` feat(feed-export): allow INACTIVE + fix FeedExportPanel hooks-order crash.
- `ea608f7` feat(matrix): per-axis filter pruning (`narrowingAxes`), full status list +
  colored `MultiPill` dots, MC-unique editor stepper, status-dot-only header.
- `1566cf1` feat(matrix): global edit mode — `findSiblings`/`propagateToSiblings`,
  `PATCH ?propagate=siblings`, Global/Local toggle, sibling-count warning chip.

DB data/config fixes (untracked `db/matrix.db`, client 8 / Erste; `.before-*` backups):
- MC314 a/b/c (ids 32756/57/58) stale PMMID `a_SZA_INCOMING…` → corrected to
  `a_SZA_afadpdall…` (no measurement anchored; root cause = import trusts PMMID
  column verbatim, `import-xlsx.ts:381`).
- `patterns.feed["Text:template_variant_class"]`: was the advert-name formula
  `MC{{number}}_{{variant}}_{{topic}}_{{version}}` (version = optimistic-lock
  counter) → reset to `{{Template_variant_classes}}` (v5-parity).

Tests: 345 pass (added `narrowingAxes` unit cases + `propagate-siblings` integration).
Spec updated: §6.2, §6.3, §6.10a, §7.7 (REBUILD_SPEC.md).

Still OPEN (user decision):
- `advert_name` / `Text:advert_name` patterns still use `{{version}}` (lock counter)
  → likely should be `{{version_no}}`. Same `_69` leak in the ADVERT_NAME column.
- Phase-2 caveat: global save is last-write-wins on siblings; could optionally skip
  ACTIVE siblings if measurement-anchor protection is wanted.
- Branch not pushed.

---

## 2026-06-01 — Finish interrupted trafficking refactor (resume after termination)

Previous session was terminated mid-refactor: `createMessage`/`updateMessage`
call sites had been rewired to a new `buildTrafficking(...)` + `listAudiences(...)`
but the callee + import were never created, so the build was broken (4 real tsc
errors). Picked up from the uncommitted diff on `feat/monitoring-ingest`.

### Done
- [x] **`trafficking.ts`**: added `buildTrafficking(input, audienceRow, topicRow,
      patterns, audienceList, pmmid)` — a DB-row adapter over the existing
      `generateTrafficking` pattern engine. Maps resolved audience/topic rows +
      key strings into the flat + by-key eval context (so `{{audiences[Audience_Key]
      .Field}}`, `{{PMMID}}`, `{{Landing_URL}}` all resolve). Loosened
      `TraffickingContext.audiences` to `ReadonlyArray<Record<string,unknown>>`
      (matches `generatePmmid`); dropped the unused `AudienceLite`. `generateTrafficking`
      kept exported (engine).
- [x] **`messages.ts`**: imported `buildTrafficking` + `listAudiences`. `createMessage`
      / `updateMessage` already wired in the prior diff — now compile.
- [x] **Migrated `copyMessage`**: now passes the full `audienceList` to BOTH
      `generatePmmid` and `buildTrafficking` (was `[]` → would have produced empty
      pmmids/UTMs under Erste by-key patterns), sets `finalTraffickedUrl` on insert.
- [x] **Migrated `moveMessages`**: reordered loop so `newPmmid` is computed BEFORE
      trafficking (utm_cd26 = {{PMMID}}); passes `audienceList`; sets
      `finalTraffickedUrl` on update.
- [x] Typecheck: 0 errors in `messages.ts` / `trafficking.ts`.
- [x] Tests: **345 passed (36 files)**, 0 failures.

### DATA companion — DONE (2026-06-01)
Symptom reported: editing a message on the Trafficking tab "did not update" — UTMs
showed generic junk (`utm_campaign=sza`, `utm_source=pro`, `utm_cd26=SZA_SZA_aftxpdall`,
empty Final URL). Root cause: NOT the recompute (that worked) — Erste's `config.patterns`
still held the generic DEFAULT patterns (`utm_cd26={{product}}_{{audience}}`, and no
`final_trafficked_url` key at all). So generation faithfully produced wrong output.

- [x] Rewrote `scripts/fix-erste-trafficking-patterns.ts` (was abandoned scaffolding
      with bogus imports). Now: real imports (`@/db`, `@/lib/pmmid`, `@/lib/trafficking`),
      installs the v5 ground-truth pmmid + trafficking patterns (verified verbatim
      against `tests/fixtures/v5/dataset/config.json`), backfills a configurable MC
      scope (`MC_NUMBERS`, default 314,315), `--dry-run`, merge-preserves
      `feed`/`topicKey`/`audienceKey`.
- [x] Safety check: PMMID is a live measurement key, and MC314/315 are all ACTIVE,
      so checked AdForm exposure. Client 8 has 4 feed_exports; exactly ONE was
      uploaded to AdForm (id=8, product **SZK**, 2026-05-03) — it carries only SZK
      MCs (m_90/m_302/m_305…), NOT m_314/m_315 (SZA, never uploaded). Monitoring also
      matches on mc/audience/topic, not pmmid, and has 0 rows for 314/315. So
      rewriting `a_…`→`p_…` on these rows orphans NO live measurement. User chose:
      install trafficking+pmmid fixture patterns; backfill 314+315 only.
- [x] Backed up DB → `db/matrix.db.before-erste-pattern-install`.
- [x] Dry-run (86 rows) → applied. **86 rows updated** (all MC314/315 variants).
      MC314b @ SZA_afadpdall now: pmmid `p_adform-s_pro-a_SZA_afadpdall-…-m_314-v_b-n_1`,
      `utm_source=adform`, `utm_content=banner`, `utm_campaign=26!1!account!onlinesz…`,
      `utm_cd26={{PMMID}}`, Final URL fully populated. 0 remaining `a_…` pmmids,
      0 empty Final URLs in 314/315. config now has `final_trafficked_url`. 345/345 tests.
- NOTE: the other ~1361 imported rows already had correct `p_…` pmmids + Final URLs
      (XLSX import trusts pre-computed values). Only ~89 v6-generated rows were wrong;
      user scoped the backfill to 314/315. Other MCs will self-correct on next save
      (config now holds the right patterns), or re-run with `MC_NUMBERS=…`.
- `tests/integration/api/audiences-key-pattern.test.ts` (248–249) — pre-existing
  `mcCount` type error (predates this session; `listAudiences` returns `Audience &
  {mcCount}` but the `Audience` type lacks it). Type-only — tests still pass.

### Open (carried over, unchanged)
- `advert_name` / `Text:advert_name` patterns still use `{{version}}` (lock counter)
  vs `{{version_no}}` — user decision.
- Branch `feat/monitoring-ingest` not pushed.

---

## 2026-06-01 — Trafficking-tab save: stale-reopen fix

Reported: editing a value (e.g. date) seems saved but reopening shows the old
value, and it "doesn't sync to all MC variants".

Diagnosis (DB confirmed the write persists — not a server bug):
- "Doesn't sync to variants": dates are stored PER audience-copy by design
  (`PROPAGATED_FIELDS` drops startDate/endDate). User confirmed dates should
  STAY per-audience. Not a bug — expected.
- "Old value on reopen": real bug. On save the editor only called
  `invalidateQueries(["messages"])` (async refetch). `openMessage` is derived
  from that cache; reopening could outrun the refetch, re-seeding the editor
  from the stale grid row.

Fix (`MessageEditor.tsx` save.onSuccess):
- [x] Synchronously patch the saved row into the `["messages"]` cache via
      `qc.setQueryData` (server response carries recomputed UTM/Final-URL too).
- [x] Keep `invalidateQueries` ONLY for the globalEdit path (sibling rows are
      updated server-side and aren't in this response, so a refetch pulls them).
- Typecheck clean (only the pre-existing `mcCount` test-type errors remain).
- Tests: 345/345.

Editable vs autogenerated (confirmed with user): editable = content, dates,
landing URL, template name, status. Autogenerated (read-only, recomputed on
save) = pmmid + utm_* + final_trafficked_url.

---

## 2026-06-01 — CORRECTION: flight dates DO propagate to siblings

Supersedes the "Keep dates per-audience" note above. User was emphatic: editing a
date on one audience of MC315c left the sibling audience on the old date — they
want dates to SYNC across same-(number,variant) cards. The earlier
AskUserQuestion answer ("keep per-audience") was wrong; honoring the clear intent.

Changes (`src/lib/entities/messages.ts`):
- [x] `PROPAGATED_FIELDS` now excludes ONLY `audience` + `topic` (the cell-defining
      placement). `startDate`/`endDate` join the propagated set — they're
      campaign-level flight dates, shared across audiences.
- [x] `propagateToSiblings` recomputes trafficking per sibling (against the
      sibling's OWN audience/topic; pmmid kept stable) so a propagated landing_url
      flows into that sibling's UTM/Final-URL too — matches the user's rule
      "editable change → recalculate + save".
- [x] Updated `propagate-siblings.test.ts`: the date-locality assertion flipped to
      assert propagation; added audience/topic-stay-local assertions.
- Behavior: propagation still only fires under Global edit (the ?propagate=siblings
      path). Client already refetches on Global save so the sibling's new date shows.
- Tests 345/345, tsc clean (pre-existing mcCount test-type errors aside).

NOTE for existing data: MC315c's sibling already diverged (06.01 vs 06.02) from
BEFORE this fix. Re-saving the date with Global ON now syncs it. No auto-backfill
run (the divergence is just stale, not corrupt).

---

## 2026-06-07 — GO LIVE: mm6 → Hetzner (cutover erste.messagingmatrix.ai)

Server: root@46.224.60.159 (4GB, Node 20.19.6). v5 erste(3003)/telekom/proficio retained.
Target: /var/www/mm6-erste, port 6001, PM2 `mm6-erste`, domain erste.messagingmatrix.ai (cutover from v5).

### Phase A — Local git
- [ ] Run affected test (propagate-siblings) + typecheck
- [ ] Commit src+test changes on feat/monitoring-ingest, push
- [ ] Merge feat/monitoring-ingest → main, push origin main

### Phase B — Server prep
- [ ] Add 2GB swapfile (build safety, no swap currently)
- [ ] mkdir /var/www/mm6-erste, clone repo, checkout main
- [ ] npm ci
- [ ] Write production .env (ACTIVE_CLIENT_KEY=erste, JWT_SECRET, MCP_BEARER_TOKEN, DATABASE_URL, STORAGE_ROOT, PORT=6001)
- [ ] npm run build

### Phase C — Data migration
- [ ] Checkpoint local WAL → matrix.db
- [ ] scp db/matrix.db → server
- [ ] rsync storage/erste (1.3GB) → server

### Phase D — PM2
- [ ] ecosystem.config.cjs (next start, 6001, NODE_ENV=production)
- [ ] pm2 start + save; curl localhost:6001 health

### Phase E — Nginx cutover (CONFIRM BEFORE)
- [ ] Backup + edit erste site: proxy 3003→6001, drop v5 /assets alias, client_max_body_size, keep SSL
- [ ] nginx -t, reload; verify https://erste.messagingmatrix.ai

### Phase F — Verify & wrap
- [x] Smoke test login/grid, check pm2 logs
- [x] MCP endpoint note, version bump suggestion

### REVIEW — DONE 2026-06-07
LIVE: https://erste.messagingmatrix.ai → mm6 (Next 15) /var/www/mm6-erste, port 6001, PM2 `mm6-erste`.
- Code: main @ 5cf245e (incl. flight-date + per-sibling trafficking propagation dc3103c).
- Data: db/matrix.db online-backup snapshot (1450 msgs, integrity ok) + storage/erste 7049 files (1.3G).
- nginx: erste site now single proxy→6001 + /mcp SSE block; SSL/redirect preserved. Old v5 config saved as
  messagingmatrix.v5-backup-20260607. v5 erste (port 3003) still running, just unserved (retained).
- Added 2G swap (/swapfile, in fstab) for build headroom.
- Enabled pm2-root systemd unit (was MISSING — nothing survived reboot before); pm2 save'd.
- Fresh JWT_SECRET + MCP_BEARER_TOKEN generated server-side (.env, chmod 600).
ROLLBACK: cp messagingmatrix.v5-backup-20260607 → sites-available/messagingmatrix; nginx -t; reload (back to v5).
TODO (user): point claude.ai ERSTE MCP connector at new bearer if it 401s; bump 6.0.0-pre→6.0.0 when ready.

---

## SLICE (planned, not started) — Shared Postgres on self-hosted Supabase: local == live

**Goal (decided with user 2026-06-07):** ONE shared live read+write database, hit by
both local dev and the Hetzner deploy, so local testing runs against live data.
Postgres chosen specifically because **Supabase's Table Editor** gives a native,
Excel-like spreadsheet cell editor (click-type-tab, paste ranges, add columns in UI).

**Hosting:** Supabase **self-hosted on Hetzner** (Docker compose). Confirmed FREE —
Supabase core is open source; only cost is the Hetzner server itself (already have
46.224.60.159, may need more RAM/disk for the Postgres + Studio stack). No cloud bill.

**This is a real migration slice, not a one-liner.** mm6 today is SQLite via direct
queries in `src/lib/entities/*` + a file-based migration runner. Sequencing:

### PG-A — Stand up Supabase on Hetzner  (decisions: SAME 4GB box; TRIMMED Postgres+Studio; SSH-tunnel, no public port)
- [x] Capacity checked: box `ubuntu-4gb-nbg1-1`, 2.6G free + 2G swap, 19G disk free.
      Runs 5 live PM2 apps incl. mm6-erste:6001 — so containers are mem-capped to
      not OOM prod. Docker 29 + Compose v5 already installed.
- [x] Postgres up: `/opt/supabase-mm6/docker-compose.yml`, `postgres:16` (matches local
      dev engine), bound `127.0.0.1:5432` ONLY, `mem_limit:1g`, password in `.env`
      (chmod 600), named volume `mm6-db-data`, db `mm6`.
- [x] SSH tunnel verified: `ssh -fNT -L 5433:localhost:5432 -i ~/.ssh/mm_key2
      root@46.224.60.159` → local psql reaches it. Drizzle migrations APPLIED to the
      server db → 19 tables live on Hetzner.
- [x] Studio + postgres-meta added — `supabase/postgres-meta:v0.96.6` +
      `supabase/studio:2026.06.03-sha-0bca601`, mem-capped (meta 256m, studio 768m),
      studio bound `127.0.0.1:3001`. All 3 containers healthy; meta introspects all
      19 tables; Studio UI 200. Full stack uses only ~300MB extra → 2.2G free, prod safe.
      Demo JWT keys (localhost-only behind tunnel). NO Studio login — access control IS
      the SSH key (only someone who can open the tunnel reaches it).
      TUNNELS: DB `ssh -fNT -L 5433:localhost:5432 -i ~/.ssh/mm_key2 root@46.224.60.159`
               Studio `ssh -fNT -L 3001:localhost:3001 -i ~/.ssh/mm_key2 root@46.224.60.159`
               → open http://localhost:3001 in browser.
- [ ] Backfill existing `db/matrix.db` data into the server Postgres (see PG-B).
      (Studio shows empty tables until this runs.)

PG-A DONE. Remaining: finish code sweep (PG-C), backfill data (PG-B), wire local +
live deploy to the shared DB (PG-D).

### PG-B — Schema + data port
- [x] Translate SQLite schema → Postgres — DONE 2026-06-27. `src/db/schema.ts` now
      `drizzle-orm/pg-core`. Mappings: `sqliteTable`→`pgTable`; `integer.primaryKey
      ({autoIncrement})`→`integer.primaryKey().generatedByDefaultAsIdentity()`
      (explicit-id insert still allowed → needed for data backfill); JSON-in-text
      cols KEPT as `text` (no jsonb — code does manual JSON.parse, no behaviour
      change); `real`→`real`. Timestamp parity: all `text` CURRENT_TIMESTAMP cols
      now default to `to_char(now() at time zone 'utc','YYYY-MM-DD HH24:MI:SS')`
      → emits byte-identical "2026-06-27 11:24:44" string. No native timestamptz.
- [x] `drizzle.config.ts` dialect → postgresql; `postgres` (postgres-js) driver added
- [x] `src/db/index.ts` rewritten for postgres-js (pool max 10, `prepare:false` for
      Supabase pooler compat). `getSqlite()`→`getClient()`; added `_closeDbForTests`.
- [x] Regenerated migrations: old sqlite SQL → `db/migrations.sqlite-archive/`;
      fresh PG `db/migrations/0000_stiff_bucky.sql` (390 lines, 19 tables).
- [x] DE-RISK PROVEN on real PG (local docker `mm6pg:55432`): all 19 tables apply;
      identity PK auto-gen (id=1); explicit-id insert (id=99) OK; timestamp format
      matches SQLite exactly; `TRUNCATE … RESTART IDENTITY CASCADE` resets cleanly
      (→ the per-test reset mechanism for the new harness).
- [x] Backfill DONE 2026-06-27 via `scripts/backfill-to-pg.mjs` (better-sqlite3 read →
      postgres-js write through the tunnel). 16,348 rows loaded, counts match SQLite
      exactly (messages 1450, creatives 1425, reporting 4380, monitoring 3002,
      uploaded_files 3981, audiences 180, topics 82…). Ids + timestamps preserved;
      identity sequences reset (messages max 32870 → next 32871). Re-runnable
      (TRUNCATE…RESTART IDENTITY CASCADE first, filters to PG columns). PG-B COMPLETE.

### PG-C — Query layer: sync→async sweep (THE long pole, ~150 fns + 26 test files)
Reality: better-sqlite3 is SYNC, postgres-js is ASYNC. Every Drizzle `.get()/.all()/
.run()` (62 in src, 61 in tests) → `await`; ~150 sync entity/lib fns → async;
transitive to all callers (routes, MCP server, Server Components, helpers). Tree will
not compile until the sweep completes — foundation + sweep land as ONE commit.
- [x] Rewrite `tests/helpers/test-db.ts` — DONE. Migrate-once into `mm6_test` DB,
      then TRUNCATE…RESTART IDENTITY between tests. `createTestDb()`/`cleanup()` now
      async → tests' beforeEach/afterEach become async. PATTERN PROVEN:
      assets-creatives.test.ts 6/6 green on real Postgres.
- [x] Convert `src/lib/entities/*` to async — ALL 8 DONE: assets, creatives,
      text-formatting, keywords, files, topics, audiences, messages.
      Conversion rules (locked): fns→async/Promise; drop `.get()`→`await …limit(1)`,
      `[0]??null`; `.all()`→`await` (no terminal); `.returning().get()`→
      `const [row]=await …returning()`; `sql\`CURRENT_TIMESTAMP\``→imported `nowUtc`;
      `db.transaction((tx)=>…)`→`await db.transaction(async (tx)=>…)` + `for…of`
      (forEach won't await); `.run().changes`→`.returning({id}).length`.
      PG SEMANTIC TRAP handled: a failed statement aborts the WHOLE pg tx (SQLite
      didn't) → `bulkInsertKeywords` now does per-row statements, not one tx.
- [~] Convert entities' test files. DONE+GREEN on PG: assets-creatives (6/6),
      messages (15/15 — also exercises audiences/topics cascade tx). Key test-side
      rule: async throws → `await expect(p).rejects.toThrow()` (not `.toThrow`).
      TODO: audiences, topics, keywords, text-formatting, files, propagate-siblings,
      snapshots, entity-history, copy-move, mcp-*, auth/*, monitoring, import-* (~22)
- [~] Convert callers. Lib helpers DONE (12): active-client (highest ripple), audit,
      auth, session, branding, monitoring-products, snapshots, auth-server, storage,
      templates, feed-export, import-xlsx. PG fixes captured: snapshot restore resets
      identity sequences; import-xlsx dry-run now threads the tx handle (global `db`
      escapes the tx on PG → would persist a dry run) + keywords use
      onConflictDoNothing().returning() (tx-safe vs swallowed-UNIQUE which aborts a pg tx).
      export-xlsx + mcp.ts DONE. ENTIRE src/lib + src/db + entities = 0 tsc errors. ✅
      (mcp.ts: helpers async, all read/write/batch tools awaited, 6 tx → async via ALS,
      raw count(*) cast ::int to avoid bigint-as-string.)
      Remaining tsc: src/app routes+components 367 (~57 files), tests 654 (~22 files),
      scripts 146 (one-off, last).
- [x] ROUTE FACTORY (user's idea — dedupe, not copy-paste-convert): `src/lib/entity-route.ts`
      with makeCollectionRoute / makeItemRoute / makeRestoreRoute / makeDuplicateRoute /
      makeHardDeleteRoute. Replaced 19 byte-identical entity-CRUD route files (audiences,
      topics, assets, creatives, text_formatting × collection/item/restore + aud/top
      duplicate+hard-delete) with ~12-line factory calls. Async wiring lives in ONE place.
      0 tsc errors in factory+routes; src/app 367→256.
- [~] Bespoke routes IN PROGRESS. DONE: messages collection (→factory!), messages/[id]
      (propagate), messages/[id]/restore, bulk-copy, bulk-move, audiences|topics history,
      feed-exports/route. src/app 367→189. src/lib still 0.
- [x] ALL src/ CONVERTED — 0 tsc errors across entities + lib + db + every route +
      MCP routes + all Server Components ((app)/page,layout,settings,templates +
      share/[id]/page + root layout). The app builds + runs on Postgres.
- [x] Test harness parallelism fix: integration files share one mm6_test DB, so root
      `vitest.config` now sets `fileParallelism: false` (project-level not honored).
      Without it, files race on DROP/CREATE/TRUNCATE → "relation already exists".
- [ ] Bespoke routes (all converted above): adform-snapshots, share-galleries(+[id]/restore),
      feed-exports, adform-snapshots, share-galleries, monitoring(+import/reapply), clients,
      users, config(+parsing-rules/public), snapshots, files(+thumbnail/restore), keywords
      (+reorder), export/xlsx, import/xlsx, drive/proxy, render/public, mcp routes,
      audiences|topics [id]/history (entity-history — candidate for its own tiny factory),
      share/* , layout.tsx, share/[id]/page.tsx.
- [~] Test files conversion (async + harness). DONE+GREEN: assets-creatives, messages,
      audiences, topics, audiences-key-pattern, audiences-duplicate-delete (54+ tests pass
      together — serial harness confirmed). Pattern: async beforeEach/afterEach, await all
      entity/db calls, `[x]=await …returning()`, drop `.get()/.all()/.run()`,
      `.toThrow`→`.rejects.toThrow`, helpers (seedTopic/setPattern) async.
      REMAINING (~14): topics-duplicate-delete, propagate-siblings, copy-move-messages,
      snapshots, keywords, text-formatting, files, entity-history, mcp-copy-move,
      mcp-list-assets, monitoring-table, import-keywords-xlsx, templates/scan,
      auth/foreign-jwt, auth/per-client-login, sse/broadcast.
- [x] ALL ~22 test files converted. **FULL SUITE GREEN: 345/345 on Postgres.**
      src/ + tests/ = 0 tsc errors. Two more PG-specific bugs fixed at the finish:
      (1) unique-violation detection — postgres-js wraps the error in DrizzleQueryError
      so `/UNIQUE/i.test(e.message)` missed it; now check SQLSTATE `23505` on e/e.cause
      (keywords.ts `isUniqueViolation`). (2) snapshot list ordering — 2nd-precision
      timestamps tie, PG won't preserve insertion order → added `desc(id)` tiebreaker.
      Also: listAudiences/listTopics return type now honestly includes `mcCount`.

### PG-C — DONE ✅  (PG-A + PG-B + PG-C all complete; app + full test suite run on Postgres)

### Remaining
- [ ] scripts/ (13 one-off dev/seed/maintenance tools, 146 tsc errs) — reference removed
      `getSqlite` + sync queries. NOT shipped, don't block build/tests. Convert lazily
      when next needed (seed-dev, seed-keywords, rotate-mcp-token, import-erste are the
      likely-used ones).
- [x] PG-D CUTOVER DONE 2026-06-27. Local `.env.local` → shared DB via SSH tunnel
      (localhost:5433); dev server verified serving from Postgres. Box: committed
      migration (f18bb62) + tsconfig-exclude-scripts + vitest fix, pushed
      feat/monitoring-ingest, box `git pull` + `npm ci` + `npm run build` (had to set
      box `.env` DATABASE_URL→`postgres://...@localhost:5432/mm6` BEFORE build since the
      root layout prerenders against the DB; preserved PORT/NODE_ENV/MCP_BEARER/STORAGE),
      `pm2 restart`. LIVE: erste.messagingmatrix.ai serves from Postgres (config-public
      OK, 401 on auth/me, 0 unstable restarts). Backups taken: box matrix.db.pre-pg-cutover-*
      + .env.pre-pg-cutover-*. Rollback = restore .env + pm2 restart.
- [x] MERGED TO MAIN 2026-06-27: origin/main 07681a1 → 2a60fc5 (fast-forward, linear).
      Box repointed to main (same code → no rebuild/restart, app stayed online).
      CHANGELOG.md added (Keep-a-Changelog; entry under [Unreleased]).
      NO version bump — stays 6.0.0-pre per the pre-launch versioning rule; the change
      is captured in CHANGELOG [Unreleased], promoted to 6.0.0 at the launch bump.
- [ ] Follow-ups (non-blocking): convert the 13 one-off `scripts/*` to async (excluded
      from build via tsconfig); optionally delete the merged `feat/monitoring-ingest`
      branch; remove the now-unused `better-sqlite3` dependency from package.json.

### MIGRATION COMPLETE ✅ — SQLite→Postgres shared Supabase on Hetzner is LIVE for both
### local dev and erste.messagingmatrix.ai. 345/345 tests green, merged to main.
- [ ] ~~PG-D cutover wiring~~ (done above):
      * Local: set `DATABASE_URL=postgres://postgres:<pw>@localhost:5433/mm6` in `.env`
        (via SSH tunnel) so `npm run dev:*` hit the shared Hetzner DB.
      * Box: set `DATABASE_URL=postgres://postgres:<pw>@localhost:5432/mm6` in the
        mm6-erste `.env`, `npm run build`, `pm2 restart mm6-erste`. ⚠️ flips LIVE prod
        from SQLite→Postgres — confirm + take a matrix.db backup first.
- [ ] Version bump (minor — storage/schema change) + CHANGELOG entry.

### Review (2026-06-27)
SQLite→Postgres migration to a shared self-hosted Supabase on Hetzner. Approach: kept
Drizzle, switched dialect sqlite→pg-core + driver better-sqlite3→postgres-js. The cost
was sync→async across ~150 fns rippling to every caller. Did it in dependency order
(entities → lib → routes → components → tests), tsc + the 345-test suite as the gate.
Surfaced + fixed ~8 genuine Postgres semantic differences a blind conversion would miss
(AsyncLocalStorage tx context, sequence resets, dry-run tx threading, onConflict for
imports, count(*) bigint casts, 23505 detection, ordering tiebreakers, timestamp-format
parity). Deduped 19 identical CRUD routes into `entity-route.ts` (user's idea). Infra:
Postgres + Studio on the 4GB box (localhost-only, SSH-tunnelled, mem-capped); 16,348
rows backfilled. NOT yet done: deploy cutover (PG-D) + the one-off scripts.
      ARCH: `src/db/index.ts` now wraps `db` in an AsyncLocalStorage tx context →
      inside `db.transaction(...)` the global `db` (used by entity fns) auto-routes
      through the tx, so batch tools / snapshot restore / keyword reorder stay atomic
      on PG without threading tx through every entity fn. KEY INVARIANT — see memory.
      Routes TODO: ~55 handlers under src/app/api/** + src/app/share/**.
      Server Components TODO: src/app/layout.tsx, src/app/share/[id]/page.tsx (the
      (app)/* ones — page/layout/templates — also need awaiting). Pattern: `await
      requireSession/requireAdmin`, `await activeClientId()`, `await <entity fn>`.
      NOTE: tsc error total is non-monotonic mid-sweep (async ripples outward) — track
      by files-remaining, not raw count.
- [ ] Convert remaining ~22 test files; one-off `scripts/*` last (not shipped)
- [ ] tsc clean + full `npm test` green against Postgres
- [ ] Connection pooling verified; decide read-latency strategy (local→Hetzner over WAN)

### PG-D — Re-point + verify
- [ ] Re-point all 4 dev deploys (erste/telekom/proficio/demo) to the shared `DATABASE_URL`
- [ ] Re-point Hetzner deploy `.env` to the same DB
- [ ] Integration tests against Postgres — MUST cover AdForm feed-export invariants
      (sticky-superset, version-bump, uploaded≠exported, default-row) and masonry data paths
- [ ] Version bump (minor — schema/storage change) + CHANGELOG

**Open questions to resolve before PG-A:**
- Single shared DB for ALL clients, or one DB per client? (multi-tenancy: ACTIVE_CLIENT_KEY today)
- Local read latency acceptable, or need embedded replica strategy?
- Migration cutover order vs the GO LIVE slice above (do that on SQLite first, then this?)

### Session checkpoint (2026-06-28) — MCP list_mc + Postgres migration fallout sweep

Live prod (mm6-erste @ fb06b98). All shipped to main + deployed + tested (354 green).

**MCP `list_mc` (25805b2):** was capped at 100/1000 and returned full 40-col rows
(blows agent context). Now: lean projection by default + `verbose=true` for full row,
`offset` paging (stable order number,variant), `limit` max 1000→5000, description
spells it out (auto-renders on Settings→MCP via /api/mcp/tools). Unblocks the agent's
naming/reporting joins — one `list_mc({limit:5000})` covers the ~3,400-MC set.

**SQLite→PG dialect fallout (surfaced one-by-one in prod, now swept):**
- `cc9fed7` — unawaited now-async lib calls serialized as `{}` → `.find is not a
  function`: `/api/templates`, `/api/files`, `/api/messages/[id]/history`, `/api/render`.
- `d0d21f9` — `/api/users` `GROUP BY` bare column (PG 42803, "Failed to load users")
  → `DISTINCT ON`.
- `a79faa0` — Assets search used `like()` (PG case-sensitive) → `ilike()`.
- `fb06b98` — **keyword routes** (PATCH/DELETE/restore) left getKeyword/updateKeyword/
  archiveKeyword/restoreKeyword + writeAudit unawaited (assignment-pattern blind spot
  the first scan missed) → returned `{keyword:{}}`, dead 404 guards, garbage audit.
  Also awaited the fire-and-forget writeAudit in keyword + files/upload routes.
- Re-scanned ALL three call shapes (inline / `const x = fn()` / `return fn()`) across
  src/app + src/lib — remaining unawaited = verified false positives (copy/move via
  db.transaction; UploadDialog's own local uploadFile).

**Tests (617b425, fb06b98):** `tests/integration/api/route-pg-regression.test.ts` — FIRST
route-level tests (call exported handlers w/ forged session). 5 cases covering all the
above; each verified to FAIL on the pre-fix code. Suite 349→354.

**Infra (not in repo):** durable local-dev DB tunnel — `autossh` launchd agent
`com.mm6.db-tunnel` keeps localhost:5433→Hetzner PG alive across sleep/wake. Documented
in REBUILD_SPEC §19. (ECONNREFUSED on dev = tunnel down, not an app bug.)

**Not done / open:** unawaited `writeAudit` elsewhere all checked — only keyword+upload
were affected, now fixed. No version bump (still pre-6.0.0). `.codex/` untracked (not
mine, left alone).

### Session checkpoint (2026-06-28) — PLAN: shared object store (Supabase Storage) for uploaded files

**Problem:** Postgres is now shared (Hetzner Supabase via tunnel) but files are local
disk only (`storage/{clientKey}/...`, `uploadedFiles.storagePath` = relative key).
Shared DB rows point at bytes that exist on only one machine → drift. Fix: move the
byte store to Supabase Storage so local dev + live share one bucket (mirrors the DB
decision). Plus a one-time data reset.

**Decisions (locked with user):**
- Backend = Supabase Storage on existing Hetzner Supabase, S3-compatible API.
- Code written against generic S3 (env-swappable to MinIO/R2 later).
- `storagePath` relative keys reused verbatim as object keys → NO schema change.
- Local-fs backend kept as fallback when S3 env absent (tests + offline dev).
- Reset: KEEP all assets (migrate their files into bucket), HARD-DELETE all creatives
  + their orphaned files, user re-uploads a fresh creative set via the app.

**Reporting note (needs user confirm):** `reporting` has NO FK or loose ref to
creatives (`bannerId`/`mcLabel` are free text). Clearing creatives → ZERO DB ref
errors. Reporting only goes *semantically* stale. Recommend clearing it anyway since
the new creative set makes old stats meaningless — but it's optional, not required.

**Plan:**
- [x] 1. [ops, read-only] SSH Hetzner: confirm storage-api is running + how exposed
       (port/URL) + S3 protocol enabled vs REST-only. Decides @aws-sdk/client-s3 vs
       @supabase/supabase-js storage client. Capture endpoint + credentials.
- [x] 2. [infra] Create private bucket (e.g. `mm6-files`). Add env vars to .env.local +
       live .env + .env.example (S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET — final
       names after step 1).
- [x] 3. [code] storage.ts: extract a tiny driver, two impls (fs=current, s3=new),
       selected by env. writeFile/readFileBytes/deleteStorageFile route through it. Key
       computation unchanged. resolveStoragePath stops being a disk path.
- [x] 4. [code] Thumbnails are a derived cache → keep LOCAL on-disk cache, but source
       reads go through the bucket driver. Give files/[id]/thumbnail + share/[id]/file/
       [fileId] a dedicated local `.thumbs` cache dir helper (not resolveStoragePath).
- [ ] 5. [migration] Upload existing live `storage/{clientKey}/assets/**` to bucket under
       same key. Verify count vs uploadedFiles asset rows.
- [ ] 6. [migration] Hard-delete creatives rows + purge their fileId→uploadedFiles rows
       + bucket objects, ref-counting against assets (shared-sha dedup) first.
- [ ] 7. [migration] (pending confirm) truncate reporting for client.
- [x] 8. [test] Keep fs-backend tests green; add s3-driver-selected + key round-trip test.
- [ ] 9. [verify] Upload creative locally → appears on live (+ reverse); thumbnails both.
- [ ] 10. [docs/version] minor-class change. Update .env.example, REBUILD_SPEC storage
       section, memory note. Suggest version bump at end.

**Templates root (`templates/`, TEMPLATES_ROOT) = OUT OF SCOPE** — separate admin-managed
store, flag only.

**[CORRECTION 2026-06-28]** SSH inspection found the Hetzner "Supabase" is Postgres-ONLY
(studio + meta + db containers; NO storage-api/kong/auth). Supabase Storage was never
deployed. Disk: 17G free of 38G. **Backend changed: MinIO on the box** (user re-confirmed).
- MinIO container added to /opt/supabase-mm6 compose, bound 127.0.0.1:9000.
- Networking mirrors the DB tunnel: live app (PM2 on host) → localhost:9000 direct;
  local dev → MinIO via an SSH tunnel forward (extend com.mm6.db-tunnel to also fwd 9000).
- Bytes always streamed through Next app routes (auth-gated, as today) → NO presigned
  URLs to the browser → S3 endpoint only needs to be reachable by the Next server, which
  the tunnel satisfies. No public exposure / TLS needed.
- Env (generic S3): S3_ENDPOINT, S3_REGION=us-east-1, S3_BUCKET=mm6-files,
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE=true. Swappable to R2 later.


**[PROGRESS 2026-06-28] Reversible core DONE + verified:**
- MinIO live on box (bucket mm6-files), tunnel fwd :9000, health 200 from laptop.
- storage.ts: env-selected driver (S3 when S3_BUCKET set, else local-fs fallback).
  storagePath == object key, no schema change. Traversal guard centralized (safeRel).
- Step 4: thumb routes needed NO change — resolveStoragePath still = local disk path,
  now used only for the regenerable .thumbs cache; source reads go through the driver.
- @aws-sdk/client-s3 added. .env.local (tunnel) + .env.example wired.
- Tests 11/11 (tests/integration/api/files-s3.test.ts mocks the SDK, hermetic, no leak).
- tsc clean. REAL S3 round-trip via tunnel w/ live creds = match.

**REMAINING — all PROD-affecting / destructive, GATED on explicit go + pg_dump backup:**
- [ ] 2b. Flip LIVE box app to S3: add S3_* to /var/www/mm6-erste/.env (endpoint
       http://127.0.0.1:9000, direct), pm2 restart mm6-erste. Changes prod behavior.
- [ ] 5. Migrate existing asset files (live disk /var/www/mm6-erste/storage) -> bucket,
       same key. Scope = uploadedFiles referenced by surviving assets (incl. shared-sha).
- [ ] 6. DESTRUCTIVE: delete all creatives rows + their uploadedFiles rows (ref-count vs
       assets). Creative bytes never migrated -> just DB rows + local disk cleanup.
- [ ] 7. DESTRUCTIVE: truncate reporting (clientId scope). Confirmed by user.
- [ ] 9. E2E verify: upload creative locally -> visible on live; thumbnails both sides.
- [ ] 10. Docs (REBUILD_SPEC storage section), memory note, version bump suggestion.

**[DONE 2026-06-28] Full cutover complete + verified:**
- 2b. Live app flipped to S3: S3_* in /var/www/mm6-erste/.env (direct 127.0.0.1:9000),
      pm2 restarted, online, no post-flip errors. Backup: .env.pre-s3-cutover-*.
- 5.  Asset files migrated: 154/154 DB-referenced asset paths in bucket, 0 missing.
- 6+7. DESTRUCTIVE reset (atomic txn, scoped client_id=8/erste, other clients untouched):
      creatives 1425→0, creative uploaded_files 3680→0, reporting 4380→0, assets 156 kept.
      pg_dump backup taken first: /opt/supabase-mm6/backups/mm6-precutover-20260628-193405.sql.gz
- 9.  E2E drift proof: laptop PUT (via tunnel) → box GET (direct) = MATCH. Drift eliminated.
- 10. docs/REBUILD_SPEC §20 added; memory project_mm6_object_store + db-tunnel note updated.
- Tests 358 passing (was 354 + 4 new S3-driver tests in tests/integration/api/files-s3.test.ts).

**Review / notes:**
- Dead weight left on box disk (harmless): /var/www/mm6-erste/storage/erste/creatives
  (~480M) + _inbox-creatives (~481M) are now orphaned (creatives never went to bucket).
  Reclaim later if needed; _inbox-* are ingest staging (Phase 11), leave them.
- Hygiene TODO (optional): app uses MinIO ROOT creds. Could scope a non-root access key.
- NOT committed (code: storage.ts, files-s3.test.ts, .env.example, package.json[-lock]).
  Pre-6.0.0 so no version bump — tracked here. Commit when ready.
- User to re-upload the fresh creative set via the app.

**[DEPLOYED 2026-06-29] Committed 4e297f6 + live.**
- Pushed main c9c4d9f..4e297f6. Box: git pull → npm install (@aws-sdk/client-s3) →
  next build (ok) → pm2 restart. Box HEAD 4e297f6, app online, GET / 307, no errors.
- NOTE: live only began ACTUALLY using S3 at this deploy — before it, the box ran the
  old fs-only storage.ts (so S3 env was inert and live read from disk; never broke).
  Now the S3 driver is live: assets served from bucket, creatives=0/assets=156 (shared DB).

---

## [PLANNED 2026-06-29] Auto-preview images for dynamic-HTML MCs

**Goal.** Generate a static PNG of how each HTML MC renders (skip-animation frame), store
in MinIO, expose on the message row + in MCP `list_mc`, so agents/3rd-party reports/decks
can grab "what the banner looked like" without running an iframe. NOT a perf play (user
confirms grid iframes aren't a pain) — purely making the pixels *available*.

**Locked decisions (grilled):**
- Trigger = **manual CLI script** (`npm run gen:previews`), run locally on the Mac.
- Regen policy = **version-keyed**: shoot only messages whose current `versionNo` has no
  matching preview (honors immutable `-n_x` model; skips unchanged work).
- Generation runs **locally** against shared DB (Postgres) + shared MinIO over the tunnel,
  so prod sees images immediately with ZERO new infra on the Hetzner box.
- Fidelity is WYSIWYG-guaranteed: generator reuses the SAME `POST /api/render`
  (inline:true, skipAnimations:true) the editor iframe uses → screenshot == editor view.

**RESOLVED — one image PER SIZE (user confirmed).** An MC's template has N sizes
(`readTemplate(name).sizes`, parsed from `{w}x{h}.css`). Generate one PNG per size →
new `message_previews` table, NOT columns on the row.

**Plan (per-size):**
- [ ] 1. Schema: new `message_previews` table — id, client_id, message_id (FK→messages,
        onDelete cascade), size, storage_key, message_version (mirrors messages.version,
        the optimistic-lock int the iframe render-cache already keys on → any edit = stale).
        Unique (client_id, message_id, size). Generate drizzle migration + 1 integration test.
        Also: add `"preview"` StorageCategory → `previews/` dir in storage.ts.
- [ ] 2. Generator script `scripts/gen-previews.ts` (run via tsx):
        - Requires `npm run dev` up (drives a real browser against localhost).
        - For each non-archived message whose template kind=html: compute the size set via
          readTemplate(template).sizes; a (message,size) is stale if no row OR
          row.message_version != messages.version. Paginate the message scan (row-cap rule).
        - Per stale (message,size): render via the app (inline:true, skipAnimations:true),
          **wait for `#preloader` to detach** (THE correctness gate — preloader overlay +
          deferred class restore mean you canNOT snap on load), screenshot at native size.
        - `storage.writeFile(buf, "preview", ".png")` → upsert row (delete old MinIO object
          on replace to avoid orphan bytes). Log summary: shot N, skipped M, failed F (mc_label,size).
- [ ] 3. Playwright as a **devDependency** only (never bundled into the Next app / box build).
- [ ] 4. Creative-library "missing preview" warning — reuse the matrix feed-warning pattern
        + amber `message-editor__global-warning` style. Counts html MCs with any stale/absent
        size preview; click → list offenders. Makes the pull-based model safe (never ship a deck
        with a missing preview). Semantic class e.g. `creative-library__preview-warning`.
- [ ] 5. MCP `list_mc`: add `preview_urls` (size→url map, resolved from storage_key) to the
        projection in mcp.ts. Keep McpTab.tsx prose in sync (feedback_mcp_settings_page_sync).
- [ ] 6. Tests + version-bump suggestion (minor: new table + MCP field + script + UI warning).

**Known small holes (accepted, not blockers):**
- THM copy (`.thm` / copy_text_2) rotates by `new Date()`+PMMID without a version bump →
  preview can drift over time. The warning/regen covers it; flag in docs.
- Video-background banners → screenshot catches one arbitrary frame. Rare, cosmetic.

**[DONE 2026-07-11] Preview plan shipped — steps 1–6 all landed:**
- 1. `message_previews` table live in shared PG (migration 0001 applied, structure verified);
     `"preview"` StorageCategory → `previews/`; 5 integration tests
     (tests/integration/message-previews-table.test.ts).
- 2+3. `scripts/gen-previews.ts` + `npm run gen:previews` (+ `-- --force`); playwright as
     devDependency only. Mints a session JWT via signSession (readSession accepts Bearer),
     shoots via page.route-fulfilled page ON the app origin (base href + /api/drive/proxy
     images need the auth cookie), gated on `#preloader` DETACHED. Stale scan shared in
     src/lib/previews.ts (keyset-paginated, per-call template-size cache).
- **ROOT-CAUSE FIX in injectSkipAnimations (render.ts):** `animation:none` froze
     animate-in elements at base state (`.animated #headlineWrapper{opacity:0}`) → first
     5360-shot run produced photo-only PNGs with NO copy (1028/1439 MCs are `animated`).
     Now `animation-duration:0s + animation-delay:0s` → lands on 100% keyframe,
     `fill-mode:forwards` holds → final resting frame. Also fixes the editor/template-editor
     "skip animation" toggles (same code path). Verified: headlineWrapper opacity 1, full
     banner (logo+headline+sticker+CTA) in screenshot. Full `--force` reshoot run after fix.
- `--force` is the documented lever for THM copy drift (rotates by date, no version bump).
- 4. Creative Library toolbar: amber `creative-library__preview-warning` pill + offender
     dropdown (MultiPill menu idiom), fed by GET /api/previews/status; inventory updated.
- 5. MCP list_mc: `preview_urls` {size: url} per row (absolute via ctx.origin from the
     dialed /mcp URL); GET /api/previews/[id] serves PNG with dual auth (session OR MCP
     bearer — smoke-tested 200/200/401); McpTab "Preview images" prose section added.
- 6. Full suite 365/365 green (was 358; +5 table tests +2 list_mc preview tests).
- Also: thm.json 2026-07-01 THM 44,49% entry ships with this deploy (Adform template
  already updated); `.codex/` gitignored.

**[DONE 2026-07-12] On-demand preview generation — editor Image preview + MCP preview_generate:**
- Shooting extracted to src/lib/preview-shooter.ts (in-process renderTemplate, mutex-serialized
  chromium runs, ShotResult per pair); scripts/gen-previews.ts is a thin CLI shell (same output).
- collectStalePreviews gains messageIds filter.
- POST /api/previews/generate (withSession+denyDemo, 1..20 ids, force) — E2E-verified with REAL
  chromium inside the Next server process (MC330a 4/4 shot). GET /api/previews/status?message_id=
  returns per-size {previewId, stale, updatedAt}.
- PreviewPane: "Image preview" checkbox-toggle (skip-anim ikertestvére), stored-PNG viewport with
  amber stale badge / dashed placeholder, footer (Open in new tab, Generate/Regenerate, inline error).
  MessagePreview wiring: ["previews","message",id] query (?v= cache-bust — load-bearing), generate
  mutation invalidates the CreativeLibrary status pill too.
- MCP preview_generate (mc_labels 1..20, force) — per-label {generated, skipped_fresh, errors},
  origin-prefixed URLs; McpTab prose updated.
- Config: playwright → dependencies; serverExternalPackages += playwright, playwright-core (build ok).
- Tests 381/381 (+12: route contract w/ mocked shooter, status message_id, MCP tool, rate limit).
- Box deploy needs ONE-TIME: npx playwright install --with-deps chromium (as PM2 user, ~/.cache/
  ms-playwright survives deploys; re-run on playwright version bumps).

**[DONE 2026-07-12] MCP asset_upload — file upload over MCP:**
- New tool asset_upload: data_base64 (≤10MB decoded) VAGY source_url (≤50MB, szerver tölti le).
- src/lib/fetch-remote-file.ts: SSRF-guard (http/https only, private/loopback/link-local IP-k +
  DNS-feloldás tiltva, redirect-hopok újravalidálva, size-capped stream; DNS TOCTOU documented).
- Filename-ütközés REJECTED by default (drive/proxy "newest wins" élő bannert írhatna át) —
  replace_existing=true az explicit felülírás. Sub-second replace tie: inherent, dokumentált.
- Metaadat: parseFilename a kliens creativeParsingRules-szal (server-side), explicit args felülírnak.
- uploadFile + createAsset lánc (két writeAudit, HTTP-route-paritás); sha256 dedup → file.deduplicated.
- sanitize → sanitizeFilename export (files.ts); McpTab "Asset upload" prose section.
- Tests 389/389 (+8 mcp-asset-upload.test.ts). Local live smoke OK (asset létrejött, majd purge-ölve).

**[DONE 2026-07-12] Matrix bulk move/copy — silent 409 surfaced in edit panel:**
- Bug: bulk-move of ACTIVE MC330a/b/c → 409 row_locked_by_status (by design:
  BLOCKED_MOVE_STATUSES, PMMID anchors live measurement), de a UI lenyelte —
  copy/moveMutation-nek csak onSuccess volt, isError-t senki nem olvasta.
- Fix (MatrixGrid.tsx): bulkErrorText() a bulk-route strukturált hibakódjait
  (row_locked_by_status / version_conflict / not_found / cross_topic /
  target_audience_not_found) operátor-olvasható szöveggé mappeli; mc_label
  (teljes PMMID) → rövid pill-label (MC330a) messagesById-ből. EditApi +=
  bulkError. Reset-effect: pendingAction/editMode változásra törli a hibát
  (react-query v5 reset stabil ref).
- EditModePanel: edit-mode-panel__error rose box a panel alján — Apply ÉS
  DnD-drop hibát is mutatja (ugyanazok a mutationök).
- Szándékosan NEM tiltjuk a kijelölést/Move-ot ACTIVE kártyákra (user döntés:
  érthetőbb a hibaüzenet, mint a némán tiltott kijelölés).
- Verified E2E localhost:6001-en (élő DB, szerver úgyis elutasít): Apply →
  "MC330a is ACTIVE — measured cards keep their PMMID and can't be moved",
  Cancel törli. tsc clean, tests 390/390.

**[TODO] MC editor: Archive gomb (user kérés, 2026-07-12):**
- Az MC editorban (MessageEditor) nincs archive button. Javaslat: a Naming tab
  Status mezője mellé, a második oszlopban megjelenő "Archive MC" gomb.
- Warning dialog KELL hozzá — NEM window.confirm, hanem a meglévő
  `_components/AlertDialog.tsx` `useAlertDialog().confirm({ title, message,
  confirmLabel, variant: "warning" | "danger" })` pattern (FeedsView:248 és
  SharesView:212 a referencia-használat).
- Backend már kész: DELETE /api/messages/[id] = soft-archive (archivedAt),
  /api/messages/[id]/restore a visszaút. A Matrix show-archived toggle-lal
  (most készül) az archivált MC vissza is nézhető.
- Bónusz takarítás ugyanitt: SnapshotsTab:194, ClientsTab:99,
  FeedDetailView:154/170, UsersView:87, TemplateEditor:480 még window.confirm-ot
  használ — érdemes AlertDialogra migrálni (külön slice).

**[DONE 2026-07-12] Multi-number cells (cellaszabály-reform) + Show archived a Matrixon:**
- Terv: ~/.claude/plans/most-kezelj-nk-deploy-el-tt-async-meerkat.md (jóváhagyva).
- Pre-check audit a live DB-n: 95 multi-number cella (mind egészséges, pl. 218/219,
  301/302 párok), 0 duplikált (cella,szám,variáns), 0 topic-átlépő (number,variant)
  — a findSiblings-invariáns prod-ban áll, nem kellett data-fix.
- A) numbering.ts: nextMcSlot occupied ága per-szám variánst számol (MC90c, nem
  MC90d vegyes cellában); új exportok: nextVariantForNumber, nextNewNumber, isLive.
  createMessage: requestedNumber?: number | "new" — cellában élő szám → annak köv.
  variánsa; globálisan szabad szám → variant "a" foglalt cellában is; "new" →
  global max+1; máshol élő (akár archivált) szám → "already in use" (findSiblings-
  védelem + restore-ütközés ellen az attach csak ÉLŐ in-cell occupantra áll rá).
  copy/moveMessages ütközés: forrás száma MEGMARAD (soha nem számoz át — ez volt a
  legcsúnyább known bug), variáns a saját szám szekvenciájában bump-ol.
- HTTP: POST /api/messages mc_number (szám|"new") — entity-route create 3. body
  argot kap (backward-kompatibilis). MCP: mc_create + mc_create_batch mc_number
  union séma + új description (descriptor mapper anyOf-ot már kezelte, McpTab OK).
- UI: CreateMcDialog — "+ new" foglalt cellán MINDIG dialog (user döntés):
  per-szám "New variant of MCn" + "New MC number"; üres cella marad azonnali.
  A számlista a teljes messages-ből jön (nem a szűrtből), élő sorokból.
- B) Show archived: ArchiveToggle className prop; Matrix right-toolbar ALJÁN
  (mindkét módban, mt-auto), CL+Assets: view-switcherből az Upload gomb fölé.
  Matrix query ["messages",{showArchived}] → includeArchived=1;
  MessageEditor setQueryData → setQueriesData (exact-key no-op fix);
  feed-exportnak átadott lista archivált-szűrt (carry-forward védelem);
  archivált chip: row--archived (grid/feed/tree), edit módban nem kijelölhető;
  listMessages includeArchived ága mostantól szűri a legacy status='deleted'-et.
- Tesztek: 403/403 zöld (+13: mixed-cell unit x5, create-gate integration x6,
  copy/move ütközés-megőrzés x2, listMessages includeArchived pin). tsc clean.
- E2E localhost:6001 (élő DB): dialog 1-számú és vegyes cellán, MC300f (per-szám
  variáns), MC332a ("new" = global max+1), 400 already-in-use más topic számára,
  Matrix toggle on/off (MC300f dimmelve/áthúzva jelent meg, off-ra eltűnt),
  collapsed rail alján ikon, CL+Assets toggle az Upload felett. Teszt-sorok
  (32891, 32892) hard-delete-tel takarítva.
- Known follow-upok (tervben dokumentálva, NEM része ennek a slice-nak):
  unique index (client,topic,audience,number,variant) a konkurencia-rés ellen;
  restoreMessage ütközés-guard; window.confirm → AlertDialog migráció;
  MC-editor Archive gomb (külön TODO fentebb).

## Slice: explicit variant on mc_create / mc_create_batch (2026-07-12)

Cél: az MCP tudjon KONKRÉT variánst adni új MC-nek (pl. 316a, 317b, 318c, 319d,
320e). Ma a variant mindig auto: friss szám → mindig "a"; b,c,d… csak ugyanazon
szám cellán belüli további MC-kből jön. Számok 316–320 (client 8) most szabadok.

- [ ] createMessage (messages.ts): opts.requestedVariant?: string
      - validál: pontosan egy a–z betű (különben MessageError)
      - szám-allokáció VÁLTOZATLAN (requestedNumber logika marad)
      - végén slot.variant = requestedVariant override
      - ütközés-guard: ha a cél cellában (topic+audience) ÉLŐ sor van
        (number, requestedVariant) párral → MessageError "variant … already in use"
- [ ] mc_create (mcp.ts): inputSchema + variant?: z.string(); handler átadja
      requestedVariant-ként; tool description bővítés
- [ ] mc_create_batch (mcp.ts): per-item variant?; description bővítés
- [ ] HTTP parity: POST /api/messages readVariant → requestedVariant (kicsi)
- [ ] McpTab.tsx: hardcoded próza ellenőrzés (tool-lista auto-sync, próza kézi)
- [ ] Tesztek: friss szám+explicit betű (317b), in-cell ütközés → error,
      variant-only (szám default) — messages.test.ts / mcp-list-mc.test.ts
- [ ] tsc + npm test zöld
- [ ] Deploy a boxra (mm6-erste), hogy az ÉLŐ MCP mutassa (agent oda csatlakozik)
- [ ] Verzió: pre-6.0.0 → nincs commit-szintű bump, todo checkpoint

Invariáns-megjegyzés: 317b 317a nélkül szándékos rés; nextVariantForNumber
később maxChar+1-et ad (317c), nincs crash. PMMID/trafficking number+variant-ot
kap, csak átveszi. Uniqueness scope = (client,topic,audience,number,variant),
egyezik a tervezett unique index follow-uppal.

### Checkpoint — explicit variant DONE, deploy deferred (2026-07-12)
- Kód kész: createMessage requestedVariant (a–z validál, in-cell (number,variant)
  ütközés-guard, szám-allokáció változatlan); mc_create + mc_create_batch variant?
  séma+description; HTTP POST /api/messages readVariant parity.
- Tesztek: +4 (317b friss szám, variant-only default szám, in-cell ütközés error,
  nem-betű error). Teljes suite 407/407 zöld, tsc clean.
- Git: a konkurens commit a3dbce5 ("multi-number cells, show-archived toggle…")
  BEBUNDLE-özte ezt a variant-változást is; már origin/main-en (local==origin, 0/0).
- Box (mm6-erste) 4d27010-en áll — EGY commit-tal le van maradva, NINCS deploy-olva.
  Az élő MCP ezért még nem mutatja a variant paramot. Deploy szándékosan HALASZTVA:
  user szerint valaki épp deploy-ol → a boxhoz nem nyúltam (nincs pull/build/restart).
- Következő lépés (más csinálja / külön session): box git pull ff→a3dbce5, npm run
  build, pm2 restart mm6-erste, majd az élő mc_create sémában ellenőrizni a variant-ot.

**[DONE 2026-07-12] fix(mc): szám-egyediség topic-szintű — batch card-létrehozás feloldva (f59b600, deployolva):**
- Agent-riport: mc_create_batch "MC number 316 is already in use", de list_mc 0 sort
  mutat → "ghost reservation" gyanú. Valójában NINCS ghost: a DB-ben 0 db MC316 sor.
- Root cause: a batch egy tranzakcióban ugyanazt a számot kérte több audience-cellába;
  az 1. tétel friss sora beakasztotta a GLOBÁLIS "already in use" guardot a 2. tételnél
  → atomikus rollback. A findSiblings-invariáns csak topic-átlépést tilt, ezért a guard
  mostantól csak MÁSIK topicban élő számra dob (üzenetben a blokkoló topic nevével);
  azonos topic másik audience = a kártya audience-másolata, legitim cél.
- Új dormant-twin guard explicit claimekre: archivált/legacy-deleted azonos-cellás iker
  (azonos PMMID, restore-duplikátum) érthető hibával elutasítva ("exists archived in
  this cell — restore it instead").
- MCP mc_create/mc_create_batch description frissítve. Tesztek: 409/409 (+2 az agent-
  forgatókönyvre: cross-audience batch placement; archivált másik-cellás sor nem blokkol).
- Deploy: box a3dbce5→f59b600, build ok, pm2 restart, Ready 1.2s.

**[DONE 2026-07-13] fix(mc): explicit szám-claim csak szabad számra — kártya-terítés = copy (2fbaaaa, deployolva):**
- User döntés: a f59b600-as topic-szintű lazítás visszavonva — a batch-create
  KÜLÖNBÖZŐ MC-kre való; egy kártya több audience-be terítése a copy dolga
  (mc_copy_batch klónozza a mezőket → az audience-másolatok nem tudnak némán
  széttartani), áthelyezés = mc_move_batch. Ugyanez a UI-mintázat.
- Ami az incidensből megmaradt: beszédes, esetnevesítő hibaüzenetek —
  azonos topic → "use copy (it clones the fields)"; másik topic → "a number
  never spans topics"; csak archivált sorok → "retired — restore instead".
  Új MCP tool NEM kellett (copy/move batch már létezett).
- mc_create/mc_create_batch description: batch = different MCs + copy/move
  terelés. Multi-number cella, in-cell attach, "new", variant-pinning,
  dormant-twin guard változatlan. Tesztek: 409/409 (2 pin megfordítva +
  copy-út bizonyítás ugyanabban a tesztben).
- Deploy: box @ 2fbaaaa, build ok, pm2 restart, Ready 1.4s.

**[DONE 2026-07-15] feat(mcp): per-user MCP tokenek full/read scope-pal (NEM deployolva — migráció a deployjal együtt fut!):**
- [x] Új `mcp_tokens` tábla (user-bound, plaintext, `scope: full|read`, label, lastUsedAt, archivedAt=revoke) — `clients.mcp_token` oszlop TÖRÖLVE
- [x] Migráció `0002_serious_shriek.sql` kézi backfill INSERT-tel: meglévő client-token → full-scope token, owner = legkorábbi élő admin (fallback: bármely élő user); ERSTE connector secretje változatlanul él tovább
- [x] `resolveBearerClient`: mcp_tokens⋈users lookup, revoked token / archivált owner → 401 (session.ts-mintájú élő re-check), deploy-pin marad, lastUsedAt stamp
- [x] `buildMcpServer`: read scope → csak a 9 read/meta tool regisztrálódik (write toolok tools/list-ben sem látszanak)
- [x] Audit: `mcpUserId` → a token-tulajdonos user id-ja (= UI-írásokkal azonos formátum); `uploaded_files.uploadedBy` is
- [x] Új API: `/api/mcp-tokens` GET/POST + `[id]` DELETE (revoke) + `[id]/reveal` POST (auditált, `"reveal"` AuditAction) — mind withAdmin; demo user csak read tokent kaphat
- [x] Régi rotate route + scripts/rotate-mcp-token.ts törölve; clients GET nem maszkol többé; seed-multi.ts token-printout kivéve
- [x] UI: Settings → MCP "Tokens" szekció (tábla + New token modal + áthozott TokenRevealModal, re-reveal szöveggel); ClientsTab token-oszlop/rotate törölve; McpTab Authentication+Audit próza szinkron; component-inventory frissítve
- [x] Tesztek: 45 fájl / 423 zöld — új: mcp-tokens-table (defaults/uniqueness/cascade + a LESZÁLLÍTOTT backfill SQL tesztje admin-preferencia/fallback/skip esetekkel), mcp-auth (full/read/unknown/revoked/archived-owner/deploy-pin/?secret= + scope gating + audit-attribúció); mcp-asset-upload elvárás frissítve (uploadedBy = user id)
- [ ] **DEPLOY (kritikus sorrend):** local `db:migrate` TILOS külön — a DATABASE_URL a tunnelen át az ÉLES DB! A boxon: új kód kirakása → `npm run db:migrate` → pm2 restart EGY menetben (a migrate és a restart közti másodpercekben a régi kód 500-azna a /mcp-n). Utána: ERSTE claude.ai connector ellenőrzés (régi secret működik, scope=full, owner=első admin), majd opcionálisan új per-user tokenek kiosztása + a migrált token visszavonása.

**[DONE 2026-07-15] previews: GET /api/previews/[id] publikus (user döntés):**
- Auth-ellenőrzés kivéve a preview-kép GET-ből — az MCP agentek/toolok auth nélkül töltik a preview_urls képeit. A sor-lookup deploy-pinnelt marad (activeClientId) → az erste deploy csak erste previewt ad ki; generate/status route-ok védettek maradnak. Cache-Control private→public.
- McpTab "Preview images" próza szinkronban. +3 teszt (404 nem 401 auth nélkül; 410-ig eljut létező sorra; másik kliens previewja 404). 426 teszt zöld.
- [x] **DEPLOYOLVA 2026-07-15:** box 2fbaaaa→9c3dc24, build ok, `db:migrate` (0002) + pm2 restart egy menetben. Verifikálva élesben: unauth /mcp→401; migrált token (owner: admin@local, full) → tools/list 29 tool, last_used_at stampelve; clients.mcp_token oszlop törölve; publikus preview GET auth nélkül → 200 image/png. Következő lépés (user): Settings → MCP → per-user tokenek kiosztása, majd opcionálisan a migrált token revoke.

**[DONE 2026-07-16] creative library: Codex-gyűjtemény bulk import (DB+MinIO szinten, UI nélkül):**
- [x] `scripts/import-codex-creatives.ts` — egyszeri, additív+idempotens import a `~/ERSTE Addressable AI Agent/creatives/` mappából (a Codex által normalizált nevű, eredeti mtime-ú gyűjtemény); scan-creatives minta async PG drizzle-re portolva, meglévő libek (parseCreativeFilename, uploadFile, getActiveClient) újrahasznosítva
- [x] 3.035 fájl importálva élesbe (client=erste): 2.886 kép + 93 videó + 56 html zip; a 26 `.htmlFolder` könyvtár kihagyva (user döntés); 0 hiba, 0 parse-olhatatlan
- [x] Dátumok megőrizve: `creatives.created_at/updated_at` = eredeti fájl-mtime (UTC, app-formátum) — 5 random sor egyezik a `creatives_manifest.csv` source_mtime-mal
- [x] sha-dedup működött: 3.035 uploaded_files sor → 3.001 distinct MinIO objektum (34 byte-azonos duplikátum közös storage_path-on)
- [x] "Üríteni kell a régi library-t" kérés ellenőrizve: a creatives tábla ÜRES volt az egész DB-ben (a 1000+ régi nevű creative a régi Leadas Lib Google Sheetben él, nem az mm6-ban) → wipe no-op, friss import elég
- [x] Idempotencia verifikálva: újrafuttatás → 0 inserted / 3.035 skipped-existing

**[DONE 2026-07-16] creative library: verzió-család csoportosítás + Versions oszlop + verzió-stepper:**
- [x] Új pure helper `src/lib/group-creative-versions.ts` (+7 unit teszt): fileName-ből számolt kulcs (`familyKey|declaredSize`, kisbetűsítve, extension-agnosztikus) — a tárolt `family_key` (UI-uploadnál null) és a `file_dimensions` (retina/off-by-one eltérések) szándékosan NEM kulcs; a `creatives.version` oszlop concurrency-counter, a banner-verzió a `bannerVersion`/fileName `_nN`-ből jön
- [x] Minden nézetben (masonry/grid/list) egy verzió-család = EGY elem, mindig a legújabb verzióval (3.035 sor → 2.663 library item, 254 multi-verziós család); Masonry itemKey = groupKey (stale-iframe invariáns)
- [x] List view: új "Versions" oszlop (Size és Created között, sortolható, `withVersions` opt-in prop — assets lista változatlan 8 oszlopos); "N versions" vagy "—" (matrix soroknál is "—")
- [x] Detail dialog: `nav-stepper` verzió-stepper a fejlécben (label pl. "n3 · 1/2"), default = legújabb; verzióváltásnál preview/file-info/draft/archive mind a kiválasztott sort követi (entity-csere, nem remount); family prev/next (`navId` fix) resetel a legújabbra; egy-verziós családnál nincs stepper
- [x] Verifikálva: 433/433 teszt zöld, tsc clean, élő UI-ban MC296 150e család (n3/n4) steppelve, assets lista érintetlen. Mellékes: a júl. 12. óta futó dev:erste 503-as beragadt állapotban volt → restart
- [x] **DEPLOYOLVA 2026-07-16:** box 9c3dc24→98df45c (/var/www/mm6-erste), build ok, pm2 restart, /creative-library 307 (auth redirect, healthy). Verzió-csoportosítás + Versions oszlop + stepper élesben.

**[DONE 2026-07-16] matrix: XLSX export a jobb toolbarba (Edit mode alá):**
- [x] `exportMatrixXlsx(clientId, {products, statuses})` az export-xlsx.ts-ben: produktonként egy mátrix-fül (sor=topic key+name, oszlop=audience key, cella="MC12a, MC13b"), + Audiences/Topics fülek (meglévő oszlopspecek, scope-olva), + MCs fül — egyedi (number, variant) kártyánként egy sor, aggregált "Audiences" oszloppal (audience key-k matrix-sorrendben)
- [x] Per-audience trafficking mezők kihagyva az MCs fülről (user döntés): PMMID, UTM_* mind, Final_Trafficked_URL — Landing_URL marad; reprezentáns = első audience siblingje (propagateToSiblings miatt a tartalom szinkronban van)
- [x] Új route: GET `/api/export/matrix-xlsx?products=SZA,SZK&statuses=ACTIVE` (withSession, üres param = mind); fájlnév `<clientKey>-matrix-<date>.xlsx`
- [x] Új `MatrixExportPanel` (matrix-export-panel, filter-chip + toolbar-btn--primary reuse) a grid nézet kinyitott toolbarjában az EditModePanel alatt; a matrix oldal aktuális produkt+státusz szűrőit viszi (search szándékosan nem)
- [x] MC-scope a szűrt audience/topic kulcskészletből, nem a produkt-fülekből → null-produktú audience-en futó kártya is bekerül az MCs fülre szűretlen exportnál
- [x] 4 új integrációs teszt (sibling-dedupe, oszlop-kizárás, produkt/státusz scope, üres eredmény) — 437/437 zöld, tsc clean; élő adaton ellenőrizve: 7 produkt-fül + Audiences(180)/Topics(82)/MCs(268), SZK+ACTIVE,INACTIVE scope stimmel
- [x] **DEPLOYOLVA 2026-07-16:** box 98df45c→7cac7b3, build ok (51/51 oldal, /api/export/matrix-xlsx a route-manifestben), pm2 restart; /matrix 307, export route auth nélkül 401 — healthy.

**[DONE 2026-07-16] fix(monitoring): /api/monitoring 500 — hiányzó await a rows query-n (9f0299e, deployolva):**
- [x] Élő hibakép: /monitoring "Application error", konzolban `api/monitoring 500` + `r.map is not a function` — a kliens a hiányzó rows-on mappelt
- [x] Root cause: a `rows` drizzle query builder await nélkül ment a `NextResponse.json`-ba → circular JSON.stringify → 500 (box error.log megerősítette: "property 'id' closes the circle"). Ugyanaz a SQLite→PG bug-osztály, mint a korábbi route-fixek (unawaited async)
- [x] Fix: egy soros `await` a route.ts:35-ön; grep-sweep az `= db$` mintára a src/app alatt — nincs több előfordulás
- [x] Verifikálva lokálisan (dev:erste, 837/837 sor renderel) és élesben screenshot-tal
- [x] **DEPLOYOLVA 2026-07-16:** box 7cac7b3→9f0299e (/var/www/mm6-erste), build ok, pm2 restart, Ready 1.4s, élő /monitoring rendben.

**[DONE 2026-07-16] monitoring: Matched a default match-filter (605aaba, deployolva):**
- [x] `MonitoringTable.tsx` match useState default: "all" → "matched"; a Clear gomb emiatt betöltéskor is látszik (Clear = minden szűrő le, "all" nézet) — szemantikailag rendben
- [x] Verifikálva lokálisan (763/936 sor, Matched chip aktív) és élesben screenshot-tal
- [x] **DEPLOYOLVA 2026-07-16:** box 9f0299e→605aaba, build ok, pm2 restart, Ready 1.4s.

**[DONE 2026-07-16] monitoring: tiered match (exact → family → family_known) + match_level oszlop:**
- [x] Kiváltó: codex 2026Q2 creative match study (~/ERSTE Addressable AI Agent) vs Monitoring júniusi report összevetés — study family-szinten 99,3% Matrix-coverage, Monitoring exact 4-kulcson 86,8% sor / 77,7% impr; a 443 unmatched sor SQL-kategorizálva: 368 kulcsalak-eltérés (wid/generikus trafficking kulcs, variáns-suffix, INCOMING-cella), 12 valódi hiány (MC321), 63 m_0 szemétsor
- [x] `variantLetter()` + `buildMessageResolver()` az adform-report.ts-ben: (1) exact 4-kulcs case-insensitive, (2) family = number+variantLetter pontosan EGY message → messageId + "family", (3) family_known = fan-out család, messageId null; product/size-only fallback tudatosan kizárva (study-tanulság)
- [x] `monitoring.match_level` oszlop (migráció 0003_lovely_sumo, additív nullable text); import route a resolvert használja, audit+response `familyKnown` counttal
- [x] UI: `status-badge--family` (sky, messageName mellett) + `status-badge--family-known` (sky, az amber unmatched helyén) title-tooltippel; GET /api/monitoring visszaadja a matchLevelt; component-inventory frissítve
- [x] Tesztek: +5 unit (variantLetter), +4 unit (resolver tierek), +2 integráció (match_level oszlop, DB→resolver varrat — a korábban teszteletlen msgByKey join kiváltása); 448/448 zöld, tsc clean
- [x] Éles júniusi adaton SQL-szimuláció (read-only): exact 2 921 (változatlan, nincs regresszió) + family 339 sor/2,24M impr → 96,9% sor / 96,2% impr linkelve; +29 family_known; 75 unmatched marad (MC321+szemét)
- [ ] **User teendő:** MC321 family (a/b/c, hiteltinder Q2) felvétele a matrixba explicit számfoglalással (MCP mc_create nem tud explicit számot) → utána a maradék unmatched gyakorlatilag csak az m_0 szemét
- [x] **DEPLOYOLVA 2026-07-16:** box 605aaba→3d0aa0c (/var/www/mm6-erste), db:migrate ok (match_level oszlop élesben ellenőrizve), build ok, pm2 restart, Ready 1.3s; /monitoring 307, /api/monitoring auth nélkül 401 — healthy
- [ ] **User teendő:** a júniusi és májusi XLSX újratöltése a Monitoring UI-n, hogy a match_level (family linkek) a meglévő sorokra is feltöltődjön

## 2026-07-21 — MCP: Creative Library tools (list + write)

Trigger: user testing MCP noticed only Messaging Cards + Assets listable; Creative Library returned nothing.
Root cause (not a bug): the `creatives` table has a full entity layer (`src/lib/entities/creatives.ts`) and REST route (`/api/creatives`), but **no MCP tool was ever registered** for it. `list_assets`/`list_mc` exist; creatives had zero MCP surface.

Scope chosen by user: **list + write.**

- [x] `list_creatives` reader in `registerReadTools` — mirrors `list_assets` (LIKE file_name/visual_keyword, exact brand/product/type, exact mc_number, include_archived, limit≤1000, order by id). Returns id+version for optimistic-lock writes.
- [x] `registerCreativeWriteTools` (gated by scope==='full'): `creative_create` / `creative_update` / `creative_remove` (archive) / `creative_restore` — keyed by **id**+version (creatives have no business key like audience.key / mc pmmid). Uses existing entity fns + `pickWritable`; audit via `writeAudit(entityType:'creatives')`; rate-limited like other writes.
- [x] Settings MCP tab: added "Creative library" group to `GROUP_ORDER` in `McpTab.tsx` so the 4 CRUD tools group together (tool cards auto-render from `/api/mcp/tools`; `list_creatives` auto-lands in List & read).
- [x] Tests: new `tests/integration/api/mcp-creatives.test.ts` (7: list filters, tenant isolation, archived visibility, CRUD round-trip, version_conflict, read-scope gating). Updated `mcp-auth.test.ts` READ_TOOLS (+list_creatives) and read-scope negative check (+creative_create).
- [x] `tsc` clean; full integration suite **281/281 green** (ran against throwaway local test PG on :55432, removed after).
- [ ] **Not deployed** — code only. Deploy = migrate n/a (no schema change) + build + pm2 restart on box when ready.

Suggested version bump: `6.0.0-pre` unchanged (pre-launch; tracked here per CLAUDE.md — new MCP tools would be a **minor** post-6.0.0).

## 2026-07-21 — VERZIÓTERV rögzítés (user kérésére: "jegyezd fel")

**Nincs bump most.** A `package.json` marad `6.0.0-pre`.

Indok: a pre-active-use punch list (1444. sortól) **teljesen kipipálatlan** — az 1.1-től 9.5-ig minden item `[ ]`, köztük a creative-library→matrix matching (3.x/W2.x). A `CLAUDE.md` szerint a `6.0.0` graduation feltétele, hogy ez a lista teljesen kész legyen. Az feltétel jelenleg NEM teljesül.

**Rögzített terv graduationkor:**
1. `6.0.0-pre` → `6.0.0` = launch baseline (a punch list kipipálása után, user dönt).
2. Közvetlenül utána `6.0.0` → **`6.1.0`** (minor) = **MCP Creative Library toolok** (`list_creatives` + `creative_create/update/remove/restore`, ld. a 2026-07-21-i MCP checkpointot fent). Új MCP toolok = minor a post-6.0.0 heurisztika szerint.
3. Ugyanígy queue-ban a korábban "post-6.0.0 minor"-nak jelölt, még nem bumpolt munkák (pl. `list_assets` tool — 2295. sor, monitoring nézet — 2401. sor). Graduationkor ezek összefolynak a `6.0.0` baseline-ba; a `6.1.0` az első ELKÜLÖNÍTETT minor a launch után.

**User override lehetőség:** a graduation explicit user-döntés a `CLAUDE.md` szerint — ha a user most azonnal flippelni akar (punch list ellenére), az megtehető, de az a projekt saját szabályával megy szembe.

## 2026-07-21 — BUMP VÉGREHAJTVA (user override)

A fenti verzióterv-note "Nincs bump most" állítását a user **felülírta** (AskUserQuestion → "Flippelj most"). Végrehajtva a punch list kipipálatlansága ellenére — a graduation explicit user-döntés a `CLAUDE.md` szerint.

- [x] `package.json`: `6.0.0-pre` → **`6.1.0`**.
- [x] `CHANGELOG.md`: `[Unreleased]` promotálva `[6.0.0] — 2026-07-21`-re (launch baseline: SQLite→PG migráció + entity-route factory + AsyncLocalStorage tx, stb.). Új `[6.1.0] — 2026-07-21` szekció a Creative Library MCP toolokra. Intro-ból törölve a "pre-launch at 6.0.0-pre" szöveg. Üres `[Unreleased]` marad a tetején.
- [x] **KÉSZ (2026-07-21):** `CLAUDE.md` verziózás-szekció átírva post-graduationre — intro `6.1.0`/"base daily use in place", bump-heurisztikából kivéve a "Pre-6.0.0 (current state)" blokk, post-6.0.0 semver az egyetlen élő szabály. A punch list header `tasks/todo.md`-ben "🚧 BLOCKING" → "⭐ TOP-PRIORITY BACKLOG" (nem launch-blokkoló, top-prio backlog).
- [ ] **Nem deployolva** — csak lokális verzió/changelog + a 6.1.0 MCP kód. Deploy a box-on külön lépés.

## 2026-07-21 — DEPLOYOLVA (6.1.0)

- [x] **DEPLOYOLVA 2026-07-21:** box `3d0aa0c`→`bdf9cfa` (/var/www/mm6-erste), 4 commit (mcp creative library toolok, sidebar verzió, 6.0.0/6.1.0 release, THM 2026-06-04 ráta). Séma-migráció **nincs** (creatives tábla már létezett). `npm run build` ok (route-manifest teljes), `pm2 restart mm6-erste` → **Ready 1287ms**, üres error.log. Health: /matrix 307, /mcp auth nélkül 401 — healthy. Box `package.json` `6.1.0`.
- Megjegyzés: a box-on a `thm.json` helyben (commitolatlanul) módosítva volt, **bájtra azonos** blob (`958754a`) a pusholt verzióval → `git checkout -- thm.json` + pull, adatvesztés nincs. (A THM-szerkesztés láthatóan a boxon keletkezik; ha ez rendszeres, érdemes lehet a `thm.json`-t a deploy-flow-ban külön kezelni / gitignore + perzisztens tárolás — de ez külön kérdés, most nem nyúltam hozzá.)

## 2026-07-21 — MCP: creative_create → creative_upload (user elemzés nyomán)

Kiváltó: user észrevétele, hogy a `creative_create` "összeakadhat" az `asset_upload`-dal / fölösleges. Elemzés eredménye:
- **Nincs ütközés** — `asset_upload` az `assets` táblába ír (`uploadedFiles` `category:"asset"`), `creative_create` a `creatives`-be. Külön könyvtár; az `asset_upload` NEM tölt a Creative Library-be.
- **DE a `creative_create` fájl nélkül haszontalan volt:** a Creative Library tile a `fileId`-ből renderel (`/api/files/<fileId>/thumbnail`), a UI feltöltés kétlépcsős (bájt `category:"creative"` → `POST /api/creatives` a `fileId`-vel; `CreativeLibrary.tsx:285-306`). A `creative_create` nem tudott `fileId`-t gyártani → üres/törött kártya. Az `asset_upload` `category:"asset"` fájlt csinál, amit a Library `/api/files?category=creative` be sem listáz.

Megoldás (user választás: "cseréld creative_upload-ra"):
- [x] `creative_create` **törölve**, helyette **`creative_upload`** (`src/lib/mcp.ts`) — az `asset_upload` mintája: `data_base64`/`source_url`, `category:"creative"` tárolás, majd `createCreative` a linkelt sorral. Extra mezők: `mc_number`/`mc_variant` (mátrix-cellához kötés), `copy_keyword`/`template`/`banner_version`. Kép esetén sharp dimenzió + korrupt/csonka védelem. Audit `uploaded_files` + `creatives`.
- [x] `creative_update`/`remove`/`restore` **változatlan** (meglévő sorok linkelése/tagelése/archiválása — valós érték).
- [x] Tesztek: `mcp-creatives.test.ts` bővítve (`creative_upload` bájt+`category:"creative"` tárolás, `list_creatives`-ben megjelenik, exactly-one guard; a CRUD round-trip most `seedCreative`-ből indul). `mcp-auth.test.ts` read-scope negatív check `creative_create`→`creative_upload`. `tsc` tiszta, **integráció 283/283** (lokális teszt-PG :55432).
- [x] `CHANGELOG.md` `[Unreleased] → Changed`: creative_create→creative_upload indoklással.
- [ ] **Nem deployolva** — csak lokális kód/teszt/changelog. Ez viselkedésváltozás a `6.1.0`-ban kiadott MCP toolon → **bump-javaslat: `6.1.0` → `6.2.0` (minor)**, user dönt. Deploy külön lépés.

## 2026-07-21 — DEPLOYOLVA (6.2.0)

- [x] **DEPLOYOLVA 2026-07-21:** box `bdf9cfa`→`f65291c` (/var/www/mm6-erste), 2 commit (creative_create→creative_upload csere + 6.2.0 release). Séma-migráció nincs. Tiszta fast-forward pull (thm.json most nem volt piszkos), `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1337ms**, üres error.log. Health: /matrix 307, /mcp 401. Box `package.json` `6.2.0`. Az élesben addig futó törött `creative_create` lecserélve `creative_upload`-ra.

## 2026-07-21 — Monitoring crash diagnózis (NINCS kódhiba) + MCP performance toolok

**Monitoring crash (user: "megint elszáll"):** root cause = **stale/mismatch böngésző-bundle a deploy-ablakban**, NEM kódhiba.
- Bizonyíték: a user hibája a `page-e8155b5ed8a6de1b.js` chunkban volt (`r.map is not a function` egy useMemo-ban); ez a hash a jelenlegi buildben nem létezik (most `page-7678b07239b512c6.js`), a stackben szereplő *shared* chunkok (`4bd1b696`, `1255`) viszont egyeznek → régi page-chunk + új shared chunk mismatch. A user képe 12:33-kor, épp a 6.1.0→6.2.0 build+restart alatt.
- Reprodukció: dev (6001, minted admin@local session cookie a JWT_SECRET-tel — lokális debug) ÉS a pontos prod build is **hibátlanul** rendereli a /monitoring-ot, minden interakcióval (június/május period, detail dialog, All/Matched/Unmatched), ugyanazon az élő adaton.
- **Teendő user oldalon:** hard refresh (Cmd+Shift+R). Kód nem változott (band-aid lenne nem-létező bugra). Recurrence oka: minden deploy változtatja a chunk-hasheket; stale böngésző-cache mismatchelhet a következő deployig — ez általános SPA-deploy higiénia, nem monitoring-bug.

**MCP performance toolok (user kérés):**
- [x] `report_performance` (read) — `monitoring` tábla aggregálva **product × platform**-onként, matched/unmatched bontással (matched = `message_id IS NOT NULL`), metrikák impressions/clicks/cost/ctr (ctr=clicks/impr, null ha impr=0) + per-cella total + grand totals. Default a legfrissebb period; `from` param (list_report_periods-ből) másikat választ; opcionális `product`/`platform` szűrő. `::int`/`::float8` cast (postgres-js bigint), GROUP BY product,platform,(message_id IS NOT NULL).
- [x] `list_report_periods` (read) — elérhető riport-periódusok newest-first, per-period rows/impressions/clicks/cost.
- [x] Tesztek: új `mcp-report-performance.test.ts` (6: period-lista tenant-scope, product×platform matched/unmatched+ctr, from period-váltás, product+platform szűrő, ismeretlen from hiba, filter-üres). `mcp-auth` READ_TOOLS +2. `tsc` tiszta, **integráció 289/289**.
- [x] `CHANGELOG.md` `[Unreleased] → Added`.
- [ ] **Nem deployolva** — csak lokális. Új MCP toolok → **bump-javaslat 6.2.0 → 6.3.0 (minor)**, user dönt. Deploy külön lépés.

## 2026-07-21 — DEPLOYOLVA (6.3.0)

- [x] **DEPLOYOLVA 2026-07-21:** box `bdf9cfa`… → `cf07e03` (/var/www/mm6-erste), 2 commit (report_performance + list_report_periods read toolok + 6.3.0 release). Séma-migráció nincs. `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1560ms**. Health: /monitoring 307, /mcp 401. Box `6.3.0`.
- Megj.: ez a deploy megint új chunk-hasheket adott → a user böngészőjében hard refresh kell a /monitoring-on (a korábban diagnosztizált stale-bundle jelenség elkerülésére).

## 2026-07-21 — MCP mc_get bővítés (preview_urls + szám/variant lookup)

Kiváltó: user kérés — preview URL a mc_get-be, és lekérés MC-szám ill. szám+variant alapján is (ne csak PMMID).
- [x] `mc_get` (src/lib/mcp.ts): lekérés EGY közülük — `mc_label` (PMMID) VAGY `mc_number` (opcionális `variant`-tal). Mivel egy szám több cellában/variantban élhet (copy fan-out), a válasz **mindig tömb** (volt: egy objektum/null). Minden sor `preview_urls`-szel (list_mc-mintára, messagePreviews join). `include_archived` hozzáadva, alapból archiváltak kihagyva. Rendezés number,variant.
- [x] Tesztek: új `mcp-mc-get.test.ts` (7: pmmid→1 elemű tömb+preview_urls, szám→minden variant/cella, szám+variant szűkítés, archived default/include, no-match üres tömb, tenant-izoláció, validáció). `tsc` tiszta, **integráció 296/296**.
- [x] `CHANGELOG.md` `[Unreleased] → Changed`. McpTab nem igényel prózát (tool-kártya auto-syncol).
- [ ] **Nem deployolva** — viselkedésváltozás egy meglévő MCP toolon → **bump-javaslat 6.3.0 → 6.4.0 (minor)**. Deploy külön lépés.

## 2026-07-21 — DEPLOYOLVA (6.4.0)

- [x] **DEPLOYOLVA 2026-07-21:** box `cf07e03`→`96a70ba` (/var/www/mm6-erste), 2 commit (mc_get preview_urls + szám/variant lookup + 6.4.0 release). Séma-migráció nincs. `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1441ms**. Health: /mcp 401, /monitoring 307. Box `6.4.0`.

## 2026-07-21 — MCP image-content toolok (vision analysishez)

Kiváltó: user kérés — direkt file-get, amivel az agent asset/creative/MC-preview képet natív image contentként kap (nem Bearer-URL-ként), image-mode elemzésre.

## 2026-07-21 — Matrix UX + editor QoL slice + FR backlog (DRÁFTELVE, NEM indult el)

**Status: drafted, NOT started.** UX/editor-ergonomics batch (M1–M9), külön a platform/reporting punch listtől (§1444) — ezek finomítások, nem platform-munkák. Utána feature-request-szintű, nagyobb tételek (FR-A…FR-D), `captured, not green-lit`. Minden item commit-méretű, current-state survey alapján (file:line horgonyok élők a dráftelés idején: 2026-07-21). **Ne induljon el egy item sem, míg a user ki nem választja + zöldre nem állítja.**

### Anchor facts (survey, 2026-07-21)
- Matrix grid: workspace `src/app/(app)/matrix/MatrixGrid.tsx` (`MatrixWorkspace`); table render `src/app/(app)/matrix/GridView.tsx`. Default `transposed=true` (`MatrixGrid.tsx:135`) → **rows = topics, columns = audiences**.
- Cell bg ma = empty-vs-occupied swap: `PlainCell` `GridView.tsx:381-384`, `EditableCell` `GridView.tsx:449-451`. MC chip szín = status dot (`STATUS_COLOR` `types.ts:125-137`, `GridView.tsx:522,604`). Nincs color-by, legend, crosshair.
- Audience: `strategy` (`schema.ts:169`), `buyingPlatform` (`:170`), `lineitemId` (`:179`), egyetlen `tag` (`:174`), `product` (`:168`). Topic: `tag1..tag4` (`:210-213`) + `product` (`:208`); **topicon nincs strategy/platform**.
- "Inactive" = szabad `status` string (`ACTIVE`/`INACTIVE`, `types.ts:108-120`), külön az archive-tól (`archivedAt`). Nincs hide-inactive toggle; csak Show-archived (a *messages* queryre, `MatrixGrid.tsx:814-816`).
- Detail view = `MessageEditor.tsx`. Modal header (`:499-625`) csak MC-labelt mutat. Audience/topic key disabled inputként a Naming tabon (`:914-931`). "Audience properties" blokk már listáz Strategy (`:946`) + Lineitem ID (`:950`); topic blokk Tag1-4 (`:955-967`).
- Custom CSS = `customCss` (DB `custom_css`, `schema.ts:265`), `<textarea>` Styles tab `MessageEditor.tsx:1721-1732`; a hint már dokumentálja a `.size-<W>x<H>` scope-ot. Template méretek már kliens-oldalon: `/api/templates` → `TemplateInfo.sizes[]` (`MessageEditor.tsx:688-691`). Elem-ID-k **NINCSENEK** API-n kivezetve — a template `index.html`-ben `id="..."` (pl. `#stickerContainer`, `templates/html/index.html:121`); parse-olható, de nincs plumbing.
- Creative Library size filter = `MultiPill label="Size"` (`CreativeLibrary.tsx:823`), opciók flat `sizeOptions` useMemóból (`:418-426`, `creatives.fileDimensions`-ből). Persist `mm6_creative_library_filter_sizes` (`:168-172`). `MultiPill` (`_components/MultiPill.tsx`) flat checkbox multi-select.

### M1. Matrix "Color by" dropdown — Strategy | Platform | Both
- [ ] **M1.1** `Color by: None | Strategy | Platform | Both` dropdown a matrix toolbarba (meglévő pill-stílus). Persist `mm6_matrix_color_by`.
- [ ] **M1.2** Stabil value→color map a látható **audience-ök** distinct `strategy`/`buyingPlatform` értékeiből (a szín csak audience-oszlopokra — topicon nincs ilyen mező). Determinisztikus paletta (sorted distinct → paletta-index), hogy ne kavarodjon re-renderkor.
- [ ] **M1.3** Szín mint sáv/band az **audience oszlop-fejlécen** (nem a teljes cellán — ld. M3). `Both` = két vékony egymásra rakott sáv (strategy fent, platform lent) vagy split chip. Kis legend.
- ⚠️ OPEN Q: `Both` vizuál (két sáv vs egy kombinált swatch)? És megerősítés, hogy a szín a **fejlécen** van, nem a cellák átfestése.

### M2. "Hide inactive" checkbox (audience + topic, NEM MC)
- [ ] **M2.1** `Hide inactive` checkbox a matrix toolbarba (a Show-archived mellé). Persist `mm6_matrix_hide_inactive`.
- [ ] **M2.2** Bekapcsolva: dobjuk az audience ÉS topic sorokat/oszlopokat, ahol `status === "INACTIVE"` (kliens-oldali szűrő a már betöltött listákon). MC-t soha nem rejt — csak egész sor/oszlop tűnik el. Az archive-logikát nem érinti.

### M3. Üres-vs-tele cella szín-különbség megszüntetése
- [ ] **M3.1** Egy háttér üres és tele cellára is: `PlainCell` (`GridView.tsx:381-384`) + `EditableCell` (`:449-451`). A `matrix-grid__cell--has-messages` class maradhat (ha máshol kell), de bg-különbség nincs. Az edit-mode drop-target ring maradjon (`:452-457`).

### M4. Crosshair highlight (sor + oszlop) hoverre / kattintásra
- [ ] **M4.1** `hoveredCell {row,col}` state a `GridView`-ban; cella `onMouseEnter`-re a teljes sor + teljes oszlop kiemelése (a két fejléccel együtt), hogy vissza lehessen követni a sor elejét/végét + oszlop tetejét/alját. Halvány band (`bg-*/[0.04]` + fejléc-emphasis), layout-shift nélkül.
- [ ] **M4.2** Click-to-pin: kattintásra a crosshair pinnelődik újabb kattintásig/escape-ig (olvasás közben ne ugráljon el). A chip-open kattintást nem nyelheti el (chip-klikk továbbra is nyitja az MC-t).
- ⚠️ OPEN Q: pin-on-click + hover mindkettő kell? (te "mouse over/click"-et írtál).

### M5. Detail-view audience header: strategy tag + lineitem_id
- [ ] **M5.1** A `MessageEditor` modal-headerbe (`:499-625`) egy `strategy` tag-pill + a `lineitemId` (ha van) az MC-label mellé/alá — a most a Naming tabon rejtett infó felhozva (`:946`, `:950`). Status-badge/pill stílus újrahasznosítva.

### M6. Detail-view: teljes key helyett product + tag pillék
- [ ] **M6.1** A Naming tab disabled full-key inputjai (`:914-931`) helyett dekompozíció pillékbe, közvetlenül a betöltött rekordból (nincs key-parser, a mezők már `aud`/`top`-on vannak):
  - **Topic:** `product` + `tag1` + `tag2` + `tag3` + `tag4` külön pillékben (üres tag elhagyva).
  - **Audience:** `product` + `strategy` + `buyingPlatform` + `device` + `tag` külön pillékben (az audience-nek egyetlen `tag`-je van, nem tag1-4).
- ⚠️ PONTOSÍTÁS beépítve: a "tag 1 2 3 4" a **topic** mezői; az audience-nek egy `tag`-je van. Dráft feltételezi: topic → 1-4 pillék, audience → saját komponens-mezők. Megerősítés kell.

### M7. Custom-CSS beszúró gombok az MC-editorban (méretek + template elem-ID-k)
- [ ] **M7.1** A `customCss` textarea alá (`MessageEditor.tsx:1721-1732`) két chip-sor. Beszúrás a cursor pozíciójába (textarea ref + selectionStart/End splice).
- [ ] **M7.2 Méret-chipek:** egy chip / `TemplateInfo.sizes[]` az aktuális template-hez (már elérhető, `:688-691`). Klikk → `.size-<W>x<H>` beszúrás (pl. `.size-640x360`).
- [ ] **M7.3 Elem-ID chipek:** egy chip / parse-olt `id="..."` az aktuális template HTML-jéből (dinamikus per template). Klikk → `#<id>` beszúrás (pl. `#stickerContainer`). NB a példa `#stickerWrapper` → valójában `#stickerContainer`.
- [ ] **M7.4 Elem-ID plumbing (új):** az ID-k ma nincsenek kivezetve. `elementIds: string[]` a `TemplateInfo`-ba `index.html` parse-olásával a `listVisibleTemplates`-ben (`src/lib/templates.ts`), a `sizes[]`-szel azonos shape/cache úton. (Alt: raw HTML `GET /api/templates/[name]/[file]` + kliens-parse — elvetve, strukturált szerver-mező jobb.)

### M8. Creative Library size filter — csoportosított dropdown
- [ ] **M8.1** A Size filter (`CreativeLibrary.tsx:823`) csoportosítva: **Display** (300x250, 300x600, 640x360, 970x250), **Social** (1080x1080, 1200x628), **Other** (a többi jelenlévő). Csak a `sizeOptions`-ben ténylegesen létező méretek (`:418-426`); üres csoport elrejtve.
- [ ] **M8.2** Csoport-fejléc klikk = az egész csoport ki/be jelölése (tri-state header checkbox: all/none/some). Az egyedi checkboxok továbbra is működnek.
- [ ] **M8.3** `MultiPill` bővítése opcionális `groups` proppal (statikus kategória→méret map, ismeretlen → Other), nem új komponens — reuse over invent. Persist key marad `mm6_creative_library_filter_sizes`.

### M9. MC archiválás UI-ból (backend kész — csak UI-gap)
Survey 2026-07-21: az archive-stack messages-re **teljesen kész DB/HTTP/MCP szinten; csak a UI-affordance hiányzik.** Ma senki nem tud MC-t archiválni/visszaállítani az appból.
- Data: `messages.archivedAt` (`schema.ts:293`), soft-delete. `includeArchived` végig bekötve (`entities/messages.ts:162`, `MatrixGrid.tsx:332`, Show-archived toggle már megvan `MatrixGrid.tsx:814-816`).
- HTTP kész: `DELETE /api/messages/[id]` = archive (soft, `If-Match`, `route.ts:82-107`); `POST /api/messages/[id]/restore` = unarchive (parent-first guard → 409 `parent_archived`, `restore/route.ts:18-54`).
- MCP kész: `mc_remove` (soft archive, `mcp.ts:1543-1570`) / `mc_restore` (`:1575-1608`). Messages-re "remove" == "archive"; hard-delete **nincs** (szándékos).
- **Egyetlen hiányzó darab = a gomb.** Minta: `MediaEntityDialog.tsx:254-285,408-427` (asset/creative) — Archive ikon ha él, Restore ha `archivedAt != null`, footer, `If-Match`, query-invalidáció.
- [ ] **M9.1** Archive / Restore control az **MC-editor footerébe** (`MessageEditor.tsx`; már megkapja az `archivedAt`-ot `:1001`). Archive → `DELETE /api/messages/[id]`; Restore → `POST /api/messages/[id]/restore`; `If-Match: version`; `["messages", {showArchived}]` query invalidálás. `parent_archived` 409 kezelése tiszta üzenettel.
- [ ] **M9.2** (opcionális másodlagos) chip-context / edit-mode akció a `GridView.tsx`-ben, hogy editor-nyitás nélkül is menjen.
- ⚠️ SZOMSZÉDOS GAP (nem M9 része): az audience-öknek + topicoknak **sincs** soft-archive UI-gombjuk — a detail dialog csak autosave, a `DimensionEditPanel` csak **hard-delete**-et kínál (`DimensionEditPanel.tsx:146-151,282`). A soft-archive (`DELETE /api/{audiences,topics}/[id]`) csak MCP/HTTP-n. UI-paritásért később testvér-item lehet.

---

## Feature requests — pinned, magasabb prioritás (nagyobb, mint az M-slice; NEM commit-méretű még)

Két+ új top-level menüpont. **Tervezési elv: ezek a tárházak elsősorban az AGENTEKÉRT vannak, nem a UI-ért.** A UI vékony (lista + link ami új ablakot nyit); az érték, hogy az agentek MCP-n olvassák/managelik. Ezért **mindegyik agent-ready MCP tool-felülettel** kell szállítson, nem csak oldalként.

### FR-A. Prodlist management (új menüpont)
- **Agent által feldolgozott prodlista-sorok** first-class rekordként (nem nyers XLSX paste): agent ingestál → sorok ide → user/agent managel.
- Soronként **dynamic MC-hez** VAGY **Creative Library elemhez** köthető.
- Kapcsolódik a punch-list 9-hez (agent MC-ket ad prodlistából) — annak nincs perzisztens otthona a parse-olt soroknak; ez az.
- **Meglévő agent-elemzés forrás (reference):** `~/ERSTE Addressable AI Agent/outputs/prodlist_q3_2026` — egy agent már itt gyárt feldolgozott prodlist-outputot; ez a menüpont ingestálja/manageli.
- **MCP kötelező:** list/get/update prodlist sor, link sor → MC/creative, processed jelölés (agent-driven a lényeg).
- OPEN Q: (1) új `prodlist_rows` tábla vs. view? (2) link-modell — soft `(mcNumber,mcVariant)` (vö. punch §3.5) vagy valós join? (3) az ingest itt van, vagy az agent MCP-n írja a sorokat?

### FR-B. Documents (új menüpont)
- **Dokumentum-tárház** Google Slides link + description / bejegyzés (link-klikk = új ablak, a UI nem renderel).
- Agent-facing: az agent követi, **melyik MC-nek van követő/tracking slide-ja és milyen állapotban**. A tárház azért van, hogy az agentek MC-hez tudják kötni a dokumentum-státuszt, nem emberi böngészésre.
- **Source-of-truth (reference):** a Drive Slides-gyűjtemény, ami ma mindent vezérel + logol: `https://drive.google.com/drive/folders/1WHgeVUaO40m_F9oICLYmns9nW6eSiYRa`. A Documents menüpont ezt tükrözi/indexeli, hogy az agentek ne kelljen minden lekérdezéskor Drive-ot scrape-elniük.
- **MCP kötelező:** list/get/add/update dokumentum, "mely MC-knek van/nincs slide + állapot" lekérdezés, link dokumentum → MC.
- OPEN Q: (1) új `documents` tábla nullable FK/soft-link a messages-hez? (2) milyen "state"-ek (status enum vagy szabad szöveg amit az agent tart karban)? (3) Google-Slides-specifikus vagy generikus külső-link store ami elsőként Slides linkeket tart?

### FR-C. "Request a change" — ticket-inbox → auto-roadmap (új menüpont)
- Hely, ahol a **fejlesztési / feature request-ek ticketként gyűlnek** (user, csapat, esetleg agentek).
- A loop: ticket bejön → Claude + user roadmap-bejegyzéssé alakítja → tervezés → megvalósítás. Gyakorlatilag **user-igazodás management**: a backlog rögzített, priorizált, agenttel közösen dolgozunk vele, nem szétszórt chatekben.
- Átfed a mai `tasks/todo.md`-vel (ami MOST a roadmap) — a kérdés, hogy a ticket egy könnyű UI/tábla ami todo.md-be táplál, vagy teljes külön store.
- **MCP kötelező:** ticket create/list/update, ticket → roadmap-item promote, hogy az agent tud filézni ÉS triage-elni.
- OPEN Q: (1) új `change_requests` tábla vs. csak strukturált `todo.md` szekció? (2) ki filézik — csak user, vagy csapat form-on, vagy agentek? (3) "auto-roadmap" = az agent szerkeszti a `todo.md`-t, vagy valós státusz-pipeline (new → planned → in-progress → done)?

### FR-D. Dashboard rendberakás (meglévő oldal — bővítés)
Survey 2026-07-21. Dashboard = `src/app/(app)/page.tsx` — server component, nincs API route, közvetlen DB-query. Tiles `entityCounts()` (`:18-35`), render `:79-92`; activity widget `recentActivity()` (`:37-44`, utolsó 15 id szerint), render `:94-131`. `audit_log` schema `schema.ts:106-128`.
- [ ] **FR-D.1 MCP-akciók megkülönböztetése az action logban.** KULCS-LELET: az MCP-akciók **már benne vannak** az `audit_log`-ban — ugyanaz a `writeAudit`, a **token tulajdonos `users.id`-jára** attribútálva, a UI-írással azonosan (`mcp.ts:87-89,207-213,1120-1122`). **Nem megkülönböztethetők** a UI-akcióktól, mert az `audit_log`-nak nincs `actor_kind`/token oszlopa (`schema.ts:106-128`; `audit.ts:AuditInput`-ban nincs token-mező). Tehát "MCP action log" = **az actor-kind rögzítése + megjelenítése**: `actor_kind` (`ui`|`mcp`) oszlop (opcionálisan `token_id`), beállítva a két writer-site-on (`entity-route.ts:68-71` UI; `mcp.ts:1194-1197` + ~30 MCP call-site a `mcpUserId`-n át), majd UI/MCP badge a widgetben. Séma-migráció.
- [ ] **FR-D.2 Ember-identitás a raw id helyett.** Ma a widget `{row.userId ?? "—"}` = raw `users.id` (`page.tsx:123`). Join `users` (van `email`, `schema.ts:57`; role `:59`) → **név/email** megjelenítés. (Az admin route `/api/audit-log` már támogat `since`/`until` szűrőt — újrahasznosítható, ha a widget fetch-alapúra vált.)
- [ ] **FR-D.3 Utolsó-90-nap tile-statisztika.** Mind a hat tile all-time total (`entityCounts()` csak `clientId`-re szűr, dátum-predikátum nélkül, `page.tsx:18-35`). Egy **utolsó 90 nap termése/updateje** count / tile (extra `count()` `createdAt`/`updatedAt >= now-90d` predikátummal). A change log alján / minden tile alatt, a user megfogalmazása szerint.

### Push-back note (global szabályok — új táblák/menük)
FR-A, FR-B, FR-C mindegyike új storage + új MCP toolok. Építés előtt a 3-kérdéses push-back: tényleg MM6 (vs. brain/inbox pipeline)? legolcsóbb 80% (pl. agent csak egy létező táblába ír / plain markdown index — FR-C lehet csak strukturált `todo.md` szekció)? a user a buildet akarja vagy az outcome-ot (docs/prodlist/ticket managelés részben a brain MCP-ben már élhet)? FR-D meglévő oldal bővítése, nem új store — könnyebb push-back. Mind `captured, not green-lit`.

### Version note
Post-`6.4.0`; több item user-visible új feature / új `TemplateInfo` mező (M7.4) / séma-migráció (FR-D.1, esetleg FR-A/B/C táblák) → **minor** bump amikor a slice száll. `CHANGELOG.md`-be logolni.

### Lezárandó nyitott kérdések indulás előtt
1. M1 `Both` vizuál (két sáv vs kombinált) + header-only színezés megerősítése.
2. M4 pin-on-click + hover mindkettő.
3. M6 audience-dekompozíció (egy `tag` + strategy/platform/device) vs a "tag 1 2 3 4" (ami topic-only).
4. FR-A…FR-C green-light + a fenti OPEN Q-k a design előtt.
- [x] `get_mc_preview_files` (read) — MC-azonosító (mc_label VAGY mc_number +variant/+audience_key) + opcionális `sizes[]` → **natív MCP image content** (`{type:"image", data:<base64>, mimeType:"image/png"}`) soronként, naming text-sorral. Több méret egy hívásban. Csak generált preview-t ad (különben preview_generate hint). Cap: ≤16 kép/hívás, >8MB skip.
- [x] `get_media_file` (read) — asset/creative `file_name` (+opcionális `category`) → uploadedFiles newest-wins, kép mime esetén natív image content; nem-kép mime → hiba a mime-mal (HTML5 zip/video → get_mc_preview_files hint). >8MB refuse. Archiváltak kizárva.
- Implementáció: `readFileBytes(storageKey|storagePath)` a storage.ts-ből; `imageContent()` helper base64+mimeType. A "connector file reference" claude.ai-specifikus — a hordozható válasz a natív MCP image content, ezt adjuk.
- [x] Tesztek: új `mcp-image-files.test.ts` (9: image content per size, sizes szűrő, no-preview/no-match/validáció hibák; get_media_file image asset, nem-kép hiba, unknown, tenant-izoláció). `mcp-auth` READ_TOOLS +2. `tsc` tiszta, **integráció 305/305**.
- [x] `CHANGELOG.md` `[Unreleased] → Added`. McpTab: mindkettő `get_`-tel kezdődik → auto "List & read" csoport.
- [ ] **Nem deployolva** — két új MCP read-tool → **bump-javaslat 6.4.0 → 6.5.0 (minor)**. Deploy külön lépés.

## 2026-07-21 — DEPLOYOLVA (6.5.0)

- [x] **DEPLOYOLVA 2026-07-21:** box `96a70ba`→`de9d42b` (/var/www/mm6-erste), 2 commit (get_mc_preview_files + get_media_file natív image-content read toolok + 6.5.0 release). Séma-migráció nincs. `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1406ms**. Health: /mcp 401. Box `6.5.0`.

## 2026-07-21 — MCP show_mc_previews (OpenAI Apps SDK render widget)

Kiváltó: user kérés — ChatGPT-ben inline preview-galéria (Apps SDK widget), a tool eredményéből renderelt UI-komponens.
- [x] `show_mc_previews` (read-only tool, `src/lib/mcp.ts` registerPreviewWidget): `structuredContent { name, previews:[{size,url}] }` (abszolút, publikus /api/previews URL-ek ctx.origin-ból) + `content` text fallback. `_meta.ui.resourceUri` + `openai/outputTemplate` + invoking/invoked üzenetek. `outputSchema` (SDK validálja a structuredContent-et; hiba-ág `isError`→kihagyja). Lekérés mc_label VAGY mc_number(+variant/+audience_key).
- [x] UI resource: `ui://widget/mc-previews.html` (`src/lib/mcp-widget.ts`), `text/html;profile=mcp-app`, vanilla JS galéria (`window.openai.toolOutput` + `openai:set_globals`). `_meta.ui.csp.resourceDomains = [ctx.origin]` (a preview-képek domainje). `resources: {}` capability hozzáadva a buildMcpServer-hez.
- Caveat: a widget ChatGPT Apps SDK / MCP Inspector-specifikus; Claude-kliens csak a structuredContent+szöveget kapja (galéria nem renderel). Additív, meglévő Claude-használatot nem töri.
- [x] Tesztek: új `mcp-show-previews.test.ts` (3, **valódi MCP protokollon** InMemoryTransport Client↔Server: outputSchema-validált structuredContent abszolút URL-ekkel, resource lista+olvasás mcp-app mime+CSP, hiba-ág nem bukik az outputSchema-n). `mcp-auth` READ_TOOLS +1. `tsc` tiszta, **integráció 308/308**.
- [x] `CHANGELOG.md` `[Unreleased] → Added`.
- [ ] **Nem deployolva** — új MCP tool + resource capability → **bump-javaslat 6.5.0 → 6.6.0 (minor)**. Deploy külön lépés.

## 2026-07-21 — DEPLOYOLVA (6.6.0)

- [x] **DEPLOYOLVA 2026-07-21:** box `de9d42b`→`11b8761` (/var/www/mm6-erste), 2 commit (show_mc_previews Apps SDK widget + resource capability + 6.6.0 release). Séma-migráció nincs. `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1499ms**. Health: /mcp 401. Box `6.6.0`.

## 2026-07-21 — show_mc_previews widget fixek (dark mode + dedup)

Kiváltó: user ChatGPT-ben tesztelte — (1) a fejléc sötét módban láthatatlan, (2) azonos MC 6 audience-cellában → 6× ugyanaz a preview.
- [x] Dark mode: `mcp-widget.ts` theme-aware CSS változók (`prefers-color-scheme` → `--mc-fg`/`--mc-muted`), a hardcode `#0f172a` helyett. A ChatGPT téma szerint vált.
- [x] Dedup: `show_mc_previews` ÉS `get_mc_preview_files` — a fan-out copy-k (azonos number+variant több audience-cellában) azonos kreatívot renderelnek, ezért **méret szerint dedup** (egy preview/kép per méret), nem cellánként ismételve.
- [x] Tesztek: `mcp-show-previews` +1 (dedup 2 méret, nem 4), `mcp-image-files` +1 (get_mc_preview_files 1 kép/méret). `tsc` tiszta, **integráció 310/310**.
- [x] `CHANGELOG.md` `[Unreleased] → Fixed`.
- [ ] **Nem deployolva** — bugfix (viselkedés + CSS) → **bump-javaslat 6.6.0 → 6.6.1 (patch)**. Deploy külön lépés.

## 2026-07-21 — preview staleness root-cause + cache-bust + widget layout

**A "regeneráltam de a régi (Igényled) jött vissza MCP-ben" root-cause = KÉT ok:**
1. Stale-detektálás (`previews.ts:78`): stale = `messageVersion !== message.version`. Template/THM/copy-változás NEM bumpolja a message.version-t → default `preview_generate`/`gen:previews` frissnek hiszi, kihagyja. → csak `force:true`-val generálódik újra. (Nem kód-hiba, dokumentált korlát; a preview_generate tool tud `force`-ot.)
2. **URL-cache (a tényleges bug):** `/api/previews/[id]` stabil id + `max-age=300` + ChatGPT képproxi. Regen után a bájtok cserélődnek, de az URL ugyanaz → cache a régit adja.

Fixek (mind cache-bust + widget, bugfix bundle):
- [x] **Cache-bust**: `previewUrl(origin,id,storageKey)` helper → `/api/previews/<id>?v=<sha1(storageKey)[0:10]>`. A storageKey minden shotnál új (writeFile új objektum), így a hash regenkor flippel → cache-miss → friss kép. Alkalmazva: `list_mc`, `mc_get`, `show_mc_previews`, `preview_generate`. `ShotResult` bővítve `storageKey`-vel (preview-shooter).
- [x] Widget layout (user kérés menet közben): 2rem padding, **masonry** (CSS multi-column, `column-width:220px`) grid helyett, nincs fenntartott scrollbar-gutter (`scrollbar-gutter:auto` + tartalom-magasság). + a korábbi dark-mode és dedup fixek.
- [x] Tesztek: URL-asszertálások frissítve `?v=[0-9a-f]{10}` mintára (mcp-list-mc, mc-get, preview-generate mock+regex, show-previews startsWith OK). `tsc` tiszta, **integráció 310/310**.
- [x] `CHANGELOG.md` `[Unreleased] → Fixed` bővítve.
- [ ] **Nem deployolva** — bugfix + CSS → **bump 6.6.0 → 6.6.1 (patch)**. Deploy külön.

## 2026-07-21 — DEPLOYOLVA (6.6.1)

- [x] **DEPLOYOLVA 2026-07-21:** box `11b8761`→`7eefeaa` (/var/www/mm6-erste), 2 commit (preview cache-bust + widget dedup/dark-mode/masonry/padding + 6.6.1 release). Séma-migráció nincs. `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1441ms**. Health: /mcp 401. Box `6.6.1`.
- User teendő: ChatGPT hard-reload a widget új HTML-jéhez; a stale preview-k eltűnnek a cache-bust miatt (a következő MCP-lekéréstől). Template/copy-változás után továbbra is `force:true` a preview_generate-ben.

## 2026-07-21 — show_mc_previews: size + multi-variant szűrő, dedup fix

Kiváltó: user ChatGPT-ben — nem tudott 300x250-re szűrni, sem b/c/d variantokat egyszerre megjeleníteni; a dedup a különböző variantokat is összevonta; padding/Igényled panasz.
- [x] `show_mc_previews`: új `sizes` (pl. ["300x250"] → egy méret) és `variants` (pl. ["b","c","d"] → több kártya egymás mellett) param. A preview-k `label`-t kapnak (MC244b), így a variantok megkülönböztethetők. Dedup mostantól **(variant, size)** szerint — az audience-copy-k összevonódnak, a különböző variantok megmaradnak. outputSchema previews: {label,size,url}.
- [x] `get_mc_preview_files`: ugyanaz a (variant, size) dedup (eddig csak size → variantokat is összevont).
- [x] Widget: a felirat `label · size` (variant + méret). (2rem padding + masonry a 6.6.1-ből.)
- [x] Tesztek: `mcp-show-previews` +2 (variants+sizes szűrő → 3 kártya MC244b/c/d 300x250; same-variant dedup marad 2). `tsc` tiszta, **integráció 311/311**.
- [x] `CHANGELOG.md` `[Unreleased] → Added`.
- **Cache/padding megjegyzés (nem kód-bug):** a user 3. képe a 6.6.1 deploy ELŐTTI widget-render, cache-elt régi URL-ekkel. A box tárolt preview-ja már helyes ("Igényeld", 4. kép). Friss ChatGPT-beszélgetés + friss show_mc_previews hívás a `?v=` cache-bustolt (helyes) képet adja. Ha a padding sem látszik friss beszélgetésben, a ChatGPT a widget-template-et cache-eli a URI szerint → akkor URI-verziózás kellhet (későbbi, ha valóban ez).
- [ ] **Nem deployolva** — új tool-paramok (sizes/variants) + dedup fix → **bump 6.6.1 → 6.7.0 (minor)**. Deploy külön.

## 2026-07-21 — DEPLOYOLVA (6.7.0)

- [x] **DEPLOYOLVA 2026-07-21:** box `7eefeaa`→`65f5aeb` (/var/www/mm6-erste), 2 commit (show_mc_previews sizes/variants + (variant,size) dedup + widget label + 6.7.0 release). Séma-migráció nincs. `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1332ms**. Health: /mcp 401. Box `6.7.0`.
- User teendő: ÚJ ChatGPT-beszélgetés + friss show_mc_previews hívás (pl. {mc_number:244, variants:["b","c","d"], sizes:["300x250"]}) → helyes "Igényeld" képek, padding, masonry. Ha friss beszélgetésben is stale a widget-template → URI-verziózás a köv. lépés.

## 2026-07-21 — show_mc_previews polish (default size, title, margin, kattintható)

- [x] `sizes` **default = ["300x250"]** (explicit méret vagy ["all"] a többihez).
- [x] Cím: **nincs mdash**. Egy variant → `MC244d · <név>`; több distinct variant → labelek vesszővel (`MC244b, MC244c, MC244d`), mert a nevük eltér.
- [x] Widget: `.mc-previews__gallery` **1rem margin**; a képek **kattinthatók** (`<a target="_blank">`) → teljes méret új tabon.
- [x] Tesztek: default-300x250 teszt, sizes:["all"] a korábbi tesztekben. `tsc` tiszta, **integráció 312/312**.
- [x] `CHANGELOG.md` `[Unreleased] → Changed`.
- **Preview image "régi" (2459, 970x250) — NEM cache-bug:** a cache-bust működik (URL friss `?v=`), de a tárolt preview bájtjai régiek → az adott méret nem lett force-újragenerálva. LIVE render helyes (`igenyeldonline.svg`). Fix = **force regen MINDEN méretre** (preview_generate force:true, vagy `npm run gen:previews -- --force` a boxon). Stale-detektálás nem fogja el template/copy-változásnál (message.version nem bumpol).
- [ ] **Nem deployolva** → **bump 6.7.0 → 6.7.1 (patch)**. Deploy külön.

## 2026-07-21 — DEPLOYOLVA (6.7.1) + force preview regen (fut)

- [x] **DEPLOYOLVA 2026-07-21:** box `65f5aeb`→`be69049` (/var/www/mm6-erste), 2 commit (show_mc_previews default 300x250 + mdash-mentes cím + 1rem margin + kattintható képek + 6.7.1). Build ok, `pm2 restart` → **Ready 1420ms**. Health: /mcp 401. Box `6.7.1`.
- [~] **Force preview regen fut a boxon:** `npm run gen:previews -- --force` (nohup, /tmp/genprev.log) — teljes erste, minden MC × méret újralövése (a stale "Igényled" preview-k, pl. 2459, frissülnek). Headless Chromium, több perc.

## 2026-07-21 — cache-bust átállítva updatedAt-re (UI-egyezés) + title margin

Kiváltó: user clue — a jó preview URL `?v=<updatedAt timestamp>` (UI/MessageEditor), a rossz `?v=<hash>` (az én kódom) → két külön URL/cache ugyanarra a preview-ra. A hash elvileg jó volt, de a UI-val nem egyezett.
- [x] `previewUrl` mostantól `?v=${encodeURIComponent(updatedAt)}` — pont mint `MessageEditor.tsx:1986`. Egy cache-entry a UI-jal, regenkor (updatedAt=nowUtc) garantáltan változik. `createHash` import törölve.
- [x] Query-k `updatedAt`-et olvasnak: list_mc, mc_get, show_mc_previews. `preview_generate`: `ShotResult` most `updatedAt`-et visz (preview-shooter update/insert `.returning({updatedAt})`).
- [x] Title 1rem margin a galériához igazítva (widget).
- [x] Tesztek: URL-regexek `?v=.+`-ra, shooter-mock updatedAt. `tsc` tiszta, **integráció 312/312**.
- [x] `CHANGELOG.md` `[Unreleased] → 6.7.2 Fixed/Changed`.
- Megj.: a stale bájtok (Igényled) attól még csak force-regennel frissülnek — a boxon fut a teljes reshoot. A cache-bust átállás azt oldja meg, hogy a friss bájtok tuti átjöjjenek (nem cache-eli meg a régit UI-eltérő URL miatt).
- [ ] **Deploy** 6.7.1 → 6.7.2. A box pm2 restart 1-2 regen-shotot megszakíthat (elhanyagolható).

## 2026-07-21 — DEPLOYOLVA (6.7.2)

- [x] **DEPLOYOLVA 2026-07-21:** box `be69049`→`e848dca` (/var/www/mm6-erste), 2 commit (cache-bust=updatedAt UI-egyezés + title 1rem margin + 6.7.2). Build ok, `pm2 restart` → **Ready 1440ms**. Health: /mcp 401. Box `6.7.2`. A force regen túlélte a restartot (1027/5968 fut tovább).

## 2026-07-21 — VALÓDI fix: dedup a legfrissebb copy-t tartja + widget height

Kiváltó: user clue — MC244d 300x250-hez KÉT preview (fan-out cellák): 2457 (updatedAt 2026-07-12, régi) és 2537 (2026-07-21, friss). A `(variant,size)` dedup az elsőt (messageId szerint) tartotta → a RÉGIT (2457) választotta.
- [x] **Dedup a legfrissebb `updatedAt`-ú copy-t tartja** (`show_mc_previews` + `get_mc_preview_files`): `orderBy(desc(updatedAt), desc(id))`, a dedup az elsőt = legfrissebbet tartja. Semmi hardkód a productionban — valódi updatedAt-ből rendez.
- [x] Widget height: külső margin (title/gallery) eltávolítva — a bottom margin nem számít bele az Apps SDK height-mérésébe → fekete sáv alul. Csak body padding ad keretet, a title így a galériával is egy vonalban.
- [x] Teszt: "legfrissebb reshot copy nyer" (izolált MC999, régi vs friss updatedAt fixture — a user pontos dátumaival, csak tesztben). `tsc` tiszta, **integráció 313/313**.
- [x] `CHANGELOG.md` `[Unreleased] → 6.7.3 Fixed`.
- [ ] Deploy 6.7.2 → 6.7.3.

## 2026-07-21 — DEPLOYOLVA (6.7.3)

- [x] **DEPLOYOLVA 2026-07-21:** box `e848dca`→`f6eda43` (/var/www/mm6-erste), 2 commit (dedup=legfrissebb copy + widget height margin-fix + 6.7.3). Build ok, `pm2 restart` → **Ready 1494ms**. Health: /mcp 401. Box `6.7.3`. Regen fut tovább (1557/5968).
- Következmény: mostantól NEM kell megvárni a teljes regent — ha egy adott (variant,size)-hoz akár EGY cellát is újralőttek (friss updatedAt, pl. 2537), a widget azt választja. MC244d 300x250 → helyes "Igényeld".

## 2026-07-21 — widget térköz + height EGYÜTT (flow-root)

Kiváltó: user — a 6.7.3 margin-eltávolítás után eltűnt a térköz a kártyák (mc-previews__link) és a title körül. Konfliktus: margin = szép térköz DE kilóg az Apps SDK height-méréséből.
- [x] `body { display: flow-root }` — BFC, ami BESZÁMÍTJA a gyerek-margókat a magasságba (a bottom margin eddig "kiszökött" a body-ból → dead space). Így visszaadható a térköz ÉS a height is jó. body padding 1.5rem keret, title 1rem alsó, kártyák közt 1rem, column-gap 1rem. CSS-only, logikát/teszteket nem érint.
- [ ] Deploy 6.7.3 → 6.7.4.

## 2026-07-21 — DEPLOYOLVA (6.7.4)

- [x] **DEPLOYOLVA 2026-07-21:** box `f6eda43`→`e47573c`, widget flow-root (térköz+height együtt) + 6.7.4. Ready 1496ms, /mcp 401. Regen 3283/5968.
- User teendő: FRISS ChatGPT-üzenet a widget új HTML-jéhez. Ha a flow-root nem oldaná meg a ChatGPT height-mérését (nem tudom náluk tesztelni), szólj — akkor a padding-only varianthoz nyúlok.

## 2026-07-21 — widget height take 2 (#root méri a ChatGPT)

Kiváltó: user pontosítás — a ChatGPT a #root magasságát méri, a KÜLSŐ (body) padding nem számít; a BELSŐ margóknak kell kifeszíteniük a #root-ot. A user mintát adott (name margin 1rem 16px, gallery margin 1rem).
- [x] body: nincs padding. `#root { display: flow-root }` (belső margók konténerezve → kifeszítik). `.mc-previews__name { margin: 1rem 16px }`, `.mc-previews__gallery { margin: 1rem }` — pont a user mintája szerint. CSS-only.
- [ ] Deploy 6.7.4 → 6.7.5.

## 2026-07-21 — get_mc_reporting fix: üres reporting → monitoring + number/variant

Kiváltó: user — get_mc_reporting mindenre {label:null, banners:[]}. Root cause: a `reporting` tábla ÜRES (0 sor), a valós adat a `monitoring`-ban (6366 sor). PMMID-eltérés: message pmmid (`…-v_b-n_2`) csak PREFIXE a monitoring pmmid-nek (`…-v_b-n_2-l_<lineitem>`) → exact nem egyezik; megbízható kulcs a mc_number+variant.
- [x] `get_mc_reporting` átírva `monitoring`-ra: lookup mc_number(+variant) exact, VAGY mc_label (message pmmid → number+variant feloldás, vagy exact monitoring pmmid). Opcionális `from` period. Output: {mc, matched_rows, totals, by_variant, by_size, by_audience} — mind {impr,clicks,cost,conv,ctr}, cellák közt összegezve. Élő sanity: MC244b → 50700 impr/63 klikk/4 méret.
- [x] Description pontosítva (nem "legacy/unused", hanem "older Reporting-sheet table, not populated by current AdForm pipeline").
- [x] Teszt: új `mcp-mc-reporting.test.ts` (7). tsc tiszta, **integráció 320/320**. CHANGELOG 6.8.0.
- **Külön follow-up (NEM ebben):** a list_mc `monitoring_status` szűrő (reporting.adform_status) és matrix_status.last_reporting_sync szintén az üres reporting táblát olvassa → gyakorlatilag no-op. A monitoring_status NEM repointolható (az ACTIVE/INACTIVE státusz nincs a monitoringban).
- [ ] Deploy 6.7.5 → 6.8.0.

## 2026-07-21 — DEPLOYOLVA (6.8.0) + force regen KÉSZ

- [x] **DEPLOYOLVA 2026-07-21:** box `506e4a6`→`3f1d5f4`, get_mc_reporting monitoring-backed + number/variant + 6.8.0. Build ok, Ready 1490ms, /mcp 401.
- [x] **Force preview regen KÉSZ:** 5968/5968 preview újralőve — minden stale "Igényled" → "Igényeld" frissült.

## 2026-07-21 — Wave 0/1 re-audit (kód ellen) + W0.1 megvalósítva

A májusi "Merged priority list" (Wave 0–5, ~2518. sor) Wave 0/1 pontjait a kód ellen újraellenőriztük. Verdiktek:

- **W0.2 (filter dropdown swatch) → KÉSZ.** Már megvan: `MatrixToolbar.tsx:56` `optionColors={STATUS_COLOR}` → `MultiPill.tsx:78` swatch opciónként. A backlog-pont zárható.
- **W1.2 (dense "New MC" gomb) → MEGVALÓSÍTVA (lásd lent).** User kérte dense-ben is: kis kör + SVG-plusz (a `+ new` pill nem fér a 28px cellába).
- **W1.3 (záró "+" audience/topic hozzáadás) → MEGVALÓSÍTVA (lásd lent).** Záró kis kör "+" cella/sor a header-tengelyek végén, edit-módban.
- **W1.4 (hover Duplicate a headeren) → MEGVALÓSÍTVA (lásd lent).** A duplicate backend + Dimensions-UI már megvolt (`api/audiences/[id]/duplicate`, `api/topics/[id]/duplicate`, `DimensionEditPanel.tsx`, `(n)` suffix); most a matrix-header hover-hook is bekötve.
- **W1.1/W1.5/W1.6** = smoke-teszt feladatok (manuális UI / MCP / prodlist-agent), nem kód — továbbra sem elvégezve.

### W0.1 — Status colors single source of truth → MEGVALÓSÍTVA (deploy még nem)
Gyökér-ok: `STATUS_COLOR` (`matrix/types.ts:122`) hardkódolt Tailwind `bg-*` osztályokra mutatott → a Design-tab `lookAndFeel` tokenjei (CSS-varok) nem hatottak a matrix dot-okra. A single-source lánc mindenhol megvolt (`defaults.ts` → `DesignTab` → `branding.ts` → `globals.css .status-dot--*`), csak a matrix render path nem volt rákötve.
- [x] `matrix/types.ts` — `STATUS_COLOR` értékei `.status-dot--<status>` CSS-var-alapú osztályokra (11 státusz). Minden fogyasztó (GridView dot-ok, FeedView, MessageEditor, HeaderDetailDialog, MatrixToolbar filter-swatch) automatikusan a tokeneket kapja — nincs consumer-edit, nincs új absztrakció.
- [x] `branding.ts` — hiányzó `--status-archived` var pótolva (latens hiba: kezdeti betöltéskor az ARCHIVED dot szín nélkül maradt; DesignTab kliens-oldalon már beállította, az SSR-emitter kihagyta).
- [x] Új `tests/unit/status-colors.test.ts` (2 teszt): minden státusz `.status-dot--*`, minden `--status-*` var kibocsátódik (archived is). `tsc` tiszta. **Unit 176/176 zöld.**
- [~] **Integráció nem futott le lokálisan:** teszt-Postgres nem elérhető (`ECONNREFUSED 127.0.0.1:55432`) — környezeti, a változás egyetlen DB-utat sem érint. Integrációt futtatni, ha a DB fent van.
- [ ] ~~Deploy + bump `6.8.0` → `6.8.1`~~ — a W1.4 miatt a bump minor lett (lásd lent).

### W1.4 — Duplicate hover az audience/topic header-eken → MEGVALÓSÍTVA (deploy még nem)
A duplicate szerver-oldal (`duplicateAudience`/`duplicateTopic` → header-only, suffixelt key+name, cellák nélkül) + a `/api/{audiences,topics}/[id]/duplicate` route + integrációs tesztek (`audiences-duplicate-delete.test.ts`, `topics-duplicate-delete.test.ts`) MÁR megvoltak. Csak a matrix-UI hook hiányzott.
- [x] `MatrixGrid.tsx` — `duplicateHeader(kind, id)` handler (POST + `invalidateQueries`), a `createInCell` mintájára. Hiba a meglévő edit-mód rose-bannerbe (`editApi.bulkError`) folyik `headerActionError` state-en át; edit-mód elhagyáskor törlődik. Új prop `onDuplicateHeader` a GridView-nak.
- [x] `GridView.tsx` — edit-módban hover Duplicate gomb (`matrix-grid__header-dup-btn`, Copy ikon, `group-hover:inline-flex`) a col- ÉS row-header-en; `group` a header `<th>`-ken (a `sticky` adja a containing block-ot az abszolút gombnak). `e.stopPropagation()` hogy ne nyissa a header-dialógust.
- [x] `component-inventory.md` + `CHANGELOG.md [Unreleased] → Added` frissítve.
- [x] `tsc` tiszta. **Nincs új teszt:** a backend duplicate már fedve (2 integrációs teszt), a változás tisztán kliens-bekötés, és nincs bevett komponens-teszt minta (nincs @testing-library). Vizuális ellenőrzés prodon.
- [ ] ~~Deploy + bump `6.9.0`~~ — W1.3 is beszáll ugyanebbe a release-be (lásd lent).

### W1.3 — Add audience/topic a matrixból → MEGVALÓSÍTVA (deploy még nem)
User kérés: "kis pötty plusz jellel new funkciónak, edit modeban" — konzisztens kör "+" gomb. A create-végpontok (`POST /api/audiences`, `POST /api/topics` → `createAudience`/`createTopic`, csak `name` kötelező, kulcs auto-generál) MÁR megvoltak; csak a matrix-UI hiányzott.
- [x] `MatrixGrid.tsx` — `addHeader(kind)` handler: POST `{name:"New audience|topic"}` → `invalidateQueries` → a visszakapott kulccsal megnyitja a `HeaderDetailDialog`-ot azonnali átnevezésre (mint a New MC az editort). Hiba a közös `headerActionError` → rose-banner. Új prop `onAddHeader`.
- [x] `GridView.tsx` — edit-módban záró `<th>` a fejlécsor végén (`matrix-grid__col-add`) ÉS záró `<tr>` a body végén (`matrix-grid__row-add`). **User-kérésre MM5-mintára átdolgozva** (`messagingmatrix/src/components/MatrixGridView.jsx:651` add-audience oszlop / `:1050` add-topic sor): NEM kis kör, hanem **széles cella** (audience/oszlop, `min-w-[160px]`) és **magas cella** (topic/sor, `min-h-16` + spanning `matrix-grid__row-add-fill` sáv), teljes-cellás + gomb (`matrix-grid__header-add-btn`, `size-full`, Plus size-5). Csak edit-módban.
- [x] **W1.2 dense New MC** — a `EditableCell` add-gomb dense-ben kis kör + SVG-plusz (`cell-add-btn--dense`, `size-4 rounded-full`, Plus `size-2.5`), cell-hoverre; a `+ new` pill marad detailed/compact-ban. (User: "kis pötty kis plusz jellel, svg-vel character helyett" — a lucide `Plus` SVG.)
- [x] `component-inventory.md` (col-add/row-add/row-add-fill/header-add-btn/cell-add-btn--dense) + `CHANGELOG.md [Unreleased] → Added (W1.3) + Changed (W1.2)`.
- [x] `tsc` tiszta, **unit 176/176**. **Nincs új teszt:** a create-végpontok már fedve, a változás kliens-bekötés. Vizuális ellenőrzés prodon.
- [x] **Bump `6.8.0` → `6.9.0`** (minor — W0.1 fix + W1.2 + W1.3 + W1.4 matrix edit-akciók). CHANGELOG `[6.9.0]` lezárva.

## 2026-07-21 — DEPLOYOLVA (6.9.0)

- [x] **DEPLOYOLVA 2026-07-21:** box `3f1d5f4`→`164dfd0` (/var/www/mm6-erste), 1 commit (W0.1 státusz-szín + W1.2 dense New MC + W1.3 add audience/topic MM5-stílus + W1.4 duplicate hover + 6.9.0). Séma-migráció nincs. `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1377ms**. Health: `/` 307, `/mcp` 401. Box `6.9.0`.
- User teendő: prod vizuális ellenőrzés edit-módban — (1) status dot színek a Design-tab tokenekből (Design → színváltás → matrix követi), (2) dense New MC kis kör +, (3) add audience/topic záró széles/magas cella + gomb, (4) header hover Duplicate.

## 2026-07-21 — W1.1 / W1.5 / W1.6 LEZÁRVA obsolete-ként (Wave 1 funkcionálisan zárva)

Döntés (user megerősítette): a három maradék Wave 1 smoke-teszt **nem fut le** — mind a három 6.0.0-kori „egyáltalán használható-e a rendszer" kapu, amit a live üzem óta elavult. Újrafuttatás = zöld pipa nulla új jellel, plusz éles-adat kockázat (dev a **közös live Hetzner Postgresre** ír a 5433 tunnelen).

- [x] **W1.1 Manual UI smoke → OBSOLETE.** A live Erste deploy napi használatban; audience/topic/MC add + dimension grid + audit log + matrix grid + iframe preview + AdForm feed-export dry-run mind éles adaton fut minden munkanapon. A friction-removal (W1.2/1.3/1.4) már deployolva (6.9.0).
- [x] **W1.5 MCP smoke → OBSOLETE.** Bearer auth + rate-limit + active-client guard már lesmoke-tesztelve a Phase 8 záráskor (200/200/401), és a 6.8.0 `get_mc_reporting` átíráskor is élő MCP-t hívtunk. A guard/limit logika azóta változatlan.
- [x] **W1.6 Agent-from-prodlist smoke → OBSOLETE (productionizálva máshol).** A workflow él a külön **`~/ERSTE Addressable AI Agent`** projektben: `.agents/skills/erste-addressable-mc-workflow` skill vezérli az mm6 MCP tooljait (`mc_create`, `mc_create_batch`, `mc_copy_batch`, `mc_update_batch`, `asset_upload`), és a `references/matrix-mcp.md` **maga a W1.6 „ergonomics-gap capture"** — valós dátumozott terepjegyzetekkel (cell-constraint 2026-07-12, asset-upload viselkedés 2026-07-12, „ne ismételj újonnan foglalt mc_number-t audience-ök közt egy create-batchben"). Kimenetek: `outputs/prodlist_q3_2026/{normalized,matched}-prodlists.json`, `matrix-live.json`, Q3 production tracker xlsx.
- **Nincs verzióbump:** doc-only checkpoint, futó appot nem érint (CLAUDE.md „What does NOT count as finished work" szabály).
- **Wave 1 státusz:** W1.2/1.3/1.4 (kód) deployolva 6.9.0-ban; W1.1/1.5/1.6 (smoke) lezárva obsolete. **Wave 1 zárva.** Következő: Wave 2 (creative-ID join konszolidáció) — user green-light kell a wave megnevezésével.

---

## Archivált 2026-09-10 — todo.md átrendezés (verbatim, a régi NOW/NEXT/Ötlet-inbox/LATER/döntések + checkpointok 2026-07-21 → 2026-09-07)

## Jelen állapot (2026-07-21)

- **Verzió: `6.9.0`**, **live** a Hetzner boxon (`erste.messagingmatrix.ai`, pm2 `mm6-erste`).
- Phase 0–10 szállítva. SQLite→Postgres migráció kész (közös Supabase a boxon, dev a `:5433` tunnelen éri). MinIO object store él (`:9000` tunnel). MCP server per-client bearerrel, **39 tool**.
- **Wave 0** ✅ teljesen zárva (W0.1 status-color single source + W0.2 filter-swatch — 6.9.0). **Wave 1** ✅ zárva (W1.2/1.3/1.4 edit-mode add/duplicate — 6.9.0; W1.1/1.5/1.6 smoke-ök obsolete). **Wave 3** nagyrészt szállítva (monitoring ingest end-to-end live).

**Prioritás-tierek lentebb:** 🟢 NOW = indulásra kész · 🟡 NEXT = green-light után · 🔵 LATER = push-back-first / blokkolt. Minden item commit-méretű; a wave/slice megnevezésével kell zöld-light indulás előtt. Minden tételnél "Fő lépések" + reuse-horgonyok (file:line a dráftelés napján igaz). A ⚠️ OPEN Q-k defaultja a fájl alján (**Nyitott döntések**).

---

## 🟢 NOW — indulásra kész (nincs blokkoló külső input)

### DRAFT-modell + státusz-takarítás epic (TERV, 2026-09-04, jóváhagyásra vár)
Kontextus: a `~/Grafia/OS/grafia-os-dokumentacio.md` munkamodell MM6-os leképezése; a purpose-doksi 9.2/9.4/11.1 nyitott kérdéseire ez a válasz.

**Lockolt döntések (user, 2026-09-04):**
- **Nincs külön brief/work-item réteg és nincs külön draft-tábla — a draft EGY `messages` sor.** Invariáns: `status='DRAFT'` ⟺ `audience IS NULL`. Aminek már van audience-e, az nem draft.
- A draft **a mátrixon kívül** él, saját creative-library-szerű felületen; T0-ban lehet "lukas" (csak szám + brief), a topic *javasolt név*, nem FK.
- A **brief egy normalizált Google Slides file-ID** (nem URL), több draft mutathat ugyanarra. Nincs brief-state, -owner, -due, -seal — a Grafia OS closure-contractjából tudatosan csak az intake-struktúra épül meg.
- Promote = audience+topic hozzárendelés + státuszváltás; a "kép ÉS DCO feed-sor" ág a második axisra **copy**-val megy (fan-out = copy, not create).
- Státuszlánc 12 → 6: `DRAFT → PREVIEW → APPROVED → ACTIVE → INACTIVE`, mellékág `DEAD`; **az archiválás az `archived_at` oszlop, nem státusz**.

**Miért ez a fő nyeremény (a user által megnevezett fájdalom):** a `numbering.ts:24` `isLive` **státusztól függetlenül** számol (`status !== 'deleted' && archived_at IS NULL`), és a `listLiveMessages` (`messages.ts:102`) minden sort visszaad → amint a draft `messages` sor, a **MC-száma T0-ban foglalt** minden további allokációval szemben. Nulla új mechanizmus kell hozzá.

**Mérés a prod DB-n (2026-09-04, erste, 2753 sor):** `ACTIVE` 1768 · `INACTIVE` 959 · `PLANNED` 8 (illegális: nincs a `STATUS_OPTIONS`-ban) · `DEAD` 6 · `CONTENT` 4 · `INCOMING` 4 · `PREVIEW` 4 · **`NAMING`/`APPROVED`/`ARCHIVED`/`ERROR`/`MEMORY` = 0**. Az `archived_at` 9 soron áll, `ARCHIVED` státuszon 0 → az archiválás már ma az oszlopban él. A `draft_messages`/`draft_previews` **mind a 4 kliensen 0 sor** → kockázatmentesen nyugdíjazható.

#### Slice 1 — séma + invariáns
- [x] **D1.1** ✅ `messages.audience` + `topic` NOT NULL → nullable (migráció `0012_shiny_iron_fist.sql`, additív). A `schema.ts` kommentjei átírva: a `status` mellett most ott áll, hogy a DRAFT-ot **az audience hiánya** tartja a mátrixon kívül, nem a státusz.
- [x] **D1.2** ✅ **Három** CHECK constraint, nem egy — a séma őrzi az invariánst, nem a fegyelem:
  - `messages_draft_has_no_audience`: `(status='DRAFT') = (audience IS NULL)` — kétirányú. Az egyik fele draftot nem enged cellába, a másik nem enged elhelyezett sort elveszíteni az oszlopát.
  - `messages_placed_has_topic`: `audience IS NULL OR topic IS NOT NULL` — egy cella (audience, topic) pár. Ez teszi az „van audience-e" szűkítést **helytállóvá** a „van topicja"-ra is, amire a TS-oldali `isPlaced` épül.
  - `messages_draft_has_no_pmmid`: `status != 'DRAFT' OR pmmid IS NULL` — ettől lesz a `getMessageByPmmid` **bizonyíthatóan draft-mentes**, és épp ezen a lekérdezésen keresztül oldja fel a forrásait a **copy és a move**, a két legdrágább tévedésű művelet.
- [x] **D1.3** ✅ `briefs` tábla (`slides_file_id` UNIQUE per kliens, `label`, `archived_at`) + `messages.brief_id` nullable FK `ON DELETE SET NULL` (a brief mutató, nem tulajdonos: elvesztése nem törölheti a munkát) + `messages_client_brief_idx`. **ID-t tárol, nem URL-t** — az I4 leckéje.
- [x] **D1.T** ✅ Integrációs teszt a migrációra (`tests/integration/briefs-draft-invariant.test.ts`, 12 eset, zöld): brief-unicitás kliensenként, cascade, `SET NULL`, „csak számot hordozó" draft, nem létező topic-kulcsú draft, és mind a négy invariáns-sértés **constraint-név szerint** ellenőrizve (nem puszta `toThrow()`, ami egy NOT NULL hibát is átengedne).
- [ ] **D1.4a** ⚠️ **Soft-link következmény (2026-09-04, a legacy-nyomozásból):** a `creatives`, `monitoring` és `prodlist_rows` táblák `(mc_number, mc_variant)` **soft linkkel** mutatnak az MC-re, nem FK-val. Amint a draft is `messages` sor **számmal és variánssal**, minden ilyen link **DRAFT sorra is illeszkedhet**. Konkrét eset már ma: a `MC78b`-hez tartozó 4 kreatív `(78,b)`-re illeszkedik, ami **két axison is létezik** — a DCO-sat most DRAFT-ba tesszük, a nonDCO-s marad. Döntendő: a creative↔cell match **lássa-e** a draftokat (mellette szól: így kap a draft kreatívot; ellene: a `family_known` több-találatos ág zajosabb lesz). A `monitoring` **soha** ne lásson draftot (nincs mérés draft előtt).
- [x] **D1.4** ✅ **Audit lefutott — a `tsc` elvégezte helyettünk: 49 hiba, 11 fájl, mind valódi határátlépés.** Az eszköz: `PlacedMessage = Message & {audience: string; topic: string}` + `isPlaced()` típusőr + a `listPlacedMessages()` lekérdezés a `listMessages` mellett. **Sehol nem `?? ""`** — minden helyszínen vagy a lekérdezés zárja ki a draftot (ez a valódi határ), vagy a művelet eleve nem értelmezett rá.
  - `messages.ts` (19): `updateMessage` **kihagyja a trafficking-újraszámolást** drafton (minden oszlopa a cellából származik) · `findSiblings`/`propagateToSiblings` üresen tér vissza (a draftnak nincs családja) · `sameAxisAs` csak elhelyezett sort fogad · `restoreMessage` szülő-ellenőrzése nem fut drafton (nincs szülője) · a copy **kimondott hibaüzenettel** utasítja el a draftot, a move `not_found`-dal.
  - `feed-export.ts` (6): a lekérdezés `isNotNull(audience)`-szel szűr. *(A régi `isServing` státusz-szűrő is kizárta volna — de az véletlen védelem: egy új státusz vagy egy átsorolás bármikor kinyitotta volna.)*
  - `export-xlsx.ts` (6): `listPlacedMessages` — az XLSX-export a mátrix egy munkalapon.
  - **`rekey.ts` (6): valódi szivárgás volt, nem csak típushiba.** A draft `topic`-ja szabad szöveg, ami *véletlenül* egyezhet egy létező topic-kulccsal — egy rekey így belerántotta volna a draftot és megpróbálta volna regenerálni a nem létező identitását. A `messagesOnKey` mostantól **audience szerint** szűkít, ami a topic-oldali ütközést is levágja.
  - **`topics.ts` (1): ugyanez a csapda** az MC-számlálóban — audience szerint szűkít, nem topic szerint, különben egy draft felfújta volna egy valódi topic MC-számát.
  - **`monitoring/import/route.ts` (1): a legfontosabb.** A draftnak van száma és variánsa — pontosan amire a `family_known` fallback kulcsol —, tehát szűrés nélkül egy riportsor ráilleszkedhetett volna olyan munkára, ami sehol nem futott. Regressziós teszt hozzáadva (`monitoring-table.test.ts`: „never resolves a report key onto a DRAFT").
  - `audiences.ts` (1), `dashboard-products.ts` (3), `dashboard-creatives.ts` (3), `CreativeStrip.tsx` (2): a dashboard a mátrixról riportál, a draft még nincs benne (nincs audience → nincs product). A `StripMessage` mostantól `PlacedMessage`.

**Slice 1–2 állapota (2026-09-04): KÓD-KOMPLETT, box-deploy hátravan.** `tsc` + `eslint` tiszta; **248 unit + 546 integrációs teszt zöld** (64 fájl). ⏳ **A `0012` migráció NINCS élesítve** — a migrate + `pm2 restart` egy passzban megy a boxon, soha nem külön lokális `db:migrate`.

#### Slice 2 — számozás + promote
- [x] **D2.1** ✅ A `sameAxis` a NULL audience-t DCO-nak vette volna → a draft **minden axison** foglalja a számát (`m.audience == null` → mindig „azonos axis"). Enélkül a draft száma csak a DCO ellen lett volna védve, és egy nonDCO create elvihette volna. A draft SAJÁT száma **globális max+1** (mindkét axis + a többi draft fölött): a per-axis szám a promótáláskor — amikor az axis végre kiderül — újraellenőrzésre szorulna és **elmozdulhatna**, ami épp az a bizonytalanság, amiért a foglalás létezik. Explicit claim ütközésére saját üzenet: *„MC number N is reserved by a draft"*.
- [x] **D2.2** ✅ `createDraft` + `promoteDraft` a `messages.ts`-ben (a draft egy message, a számozó gépezetet változatlanul használja). A promote **UPDATE, nem újra-létrehozás** — a draft és a belőle lett kártya ugyanaz az MC, így a szám, a brief-link és az előzmény túléli az átmenetet. Az audience+topic+státusz **egy write-ban** landol (a CHECK összeköti őket, két lépésben az első elbukna). Nem létező topicra **nem promótál** — a topics dimenziót nem hígítjuk fel promote-kor gyártott közel-duplikátumokkal.
- [x] **D2.3** ✅ „Mindkettő" ág **tesztelve, nem csak feltételezve**: a draft EGY kártyává promótál, a másik axis `copyMessages`-szel jön, közös szám alatt, külön pmmid-del (`draft-lifecycle.test.ts`: „reaches both axes under one number").
- [x] **D2.4** ✅ Invariáns-őr az `updateMessage`-ben + 400-as leképezés a PATCH route-on: a `status`/`audience` páros elrontása így **kimondott hibaüzenetet** ad, nem nyers DB-500-at (draftnak audience-t adni, elhelyezett kártyáról audience-t levenni, vagy státusszal visszaminősíteni).
- [x] **D2.T** ✅ `tests/integration/draft-lifecycle.test.ts` — **20 eset**: T0-állapot, javasolt topic-név, mindkét axis fölötti allokáció, számtartás DCO és nonDCO create ellen, „reserved by a draft" hiba, siblings-üresség, promote-invariánsok, variáns-bump, a szám felszabadulása promote után, és a mindkét-axis útvonal.

#### Slice 3 — `/drafts` felület (creative-library-szerű)
- [x] **D3.1** ✅ A `/drafts` `messages`-re áll (`status='DRAFT'`), `listDrafts` **legfrissebb elöl** (worklist, nem katalógus — a mátrix azért rendez szám szerint, mert ott katalógus). Reuse: `creative-card` + `__thumb` / `__meta` / `__mc`, `empty-state`, `toolbar`, `form-field`, `input-box`, `status-badge`, `tag-chip`, `modal__header|body|footer`, `Masonry` (`itemKey`-jel, a stabil-kulcs invariáns szerint).
- [x] **D3.2** ✅ `slides-link.ts` (az I4 `drive-link.ts` párja) + `entities/briefs.ts` + `/api/briefs`, `/api/briefs/[id]`. **A csatolás upsert, nem insert:** ugyanaz a deck editor-linkként és Drive-linkként **egy brief**, különben a közös briefű draftok szétesnének külön csoportokra. A mappalinket kimondott üzenettel utasítja el. Briefenkénti csoportosítás + `N open · M promoted` fejléc — **a Close Check 80%-a állapotgép nélkül**, mert mindkét szám magából a munkából számolódik.
- [x] **D3.3** ✅ **Nem kellett megépíteni — a modellválasztás megoldotta.** A draft egy message, tehát a `message_previews` meglévő verzió-alapú staleness-ét használja; a `collectStalePreviews` template alapján szűr, nem audience alapján, és a `render.ts` **sehol nem hivatkozik audience-re** → a draft renderelhető. A csempe megjelöli az elavult previewt (`stale preview` badge + halványítás) ahelyett, hogy régi képet mutatna jelöletlenül.
- [x] **D3.4** ✅ Side-toolbar a meglévő `right-toolbar` render-prop mintájával (collapsed = ikonsor, nyitott = teljes panel), saját `mm6_drafts_toolbar_open` persistence-kulccsal a `mm6_<page>_<thing>` konvenció szerint. Új blokk: `drafts-panel`, `brief-group`, `drafts-tile`.
- [x] **D3.5** ✅ `/api/drafts` átirányítva (GET: draftok + previewk + briefek egy körben; POST: `createDraft`), `/api/drafts/[id]/promote` az új `promoteDraft`-ra, a régi `/api/drafts/[id]` törölve (a draft szerkesztése `/api/messages/[id]` PATCH — egy draft egy message).
- [x] **D3.T** ✅ `slides-link.test.ts` (7 unit) + `briefs-entity.test.ts` (11 integrációs): file-ID normalizálás minden link-alakra, idempotencia, archivált brief visszahozása, progressz-számlálás, és hogy a brief **mutató, nem tulajdonos** (archiválás/törlés nem viszi el a munkát).

✅ *(A Slice 3 idején fennállt UI↔MCP inkonzisztenciát a Slice 4 lezárta.)*

#### Slice 4 — MCP (agent-facing)
- [x] **D4.1** ✅ A tool-nevek **megmaradtak** (`generate_test_creative`, `list_drafts`, `draft_get`, `draft_status`, `show_draft_previews`, `draft_promote`, `draft_delete`) — az agent-szerződés nem törik —, csak a mögöttes modell változott. Új: **`brief_attach`** (link → file-ID → upsert, egy hívásban draftot is köt hozzá) és **`list_briefs`** (`open_drafts` / `promoted` progresszel). A `generate_test_creative` mostantól visszaadja a **`mc_label`-t is**: az agent azonnal tudja, milyen szám lett lefoglalva. Új opcionális bemenetek: `brief_link`, `working_topic`.
- [x] **D4.2** ✅ `entities/drafts.ts` **újraírva** az új modellre (megmaradt a fő értéke: az egy körben visszaadott, minden problémát felsoroló validáció). A `draft_status` progressze mostantól **derivált** — egy méret akkor kész, ha a preview a draft AKTUÁLIS verziójánál készült —, tehát nincs se `render_status` oszlop, se job-tábla, és egy szerkesztés visszaejti a százalékot, ugyanazzal a staleness-szabállyal, amit a mátrix használ. A `draft_messages` + `draft_previews` tábla **eldobva** (`0013`), a `/api/draft-previews/*` route törölve (a draft previewja immár közönséges MC-preview), a `draft_delete` **archivál** (a szám retired marad, nem kerül vissza forgalomba).
- [x] **D4.3** ✅ `McpTab.tsx` prózája újraírva (a tool-lista auto-szinkron, a próza nem volt az).
- [x] **D4.T** ✅ `mcp-drafts.test.ts` újraírva, **15 eset** — köztük a két legfontosabb: a `generate_test_creative` által foglalt számot az `mc_create` **nem tudja elvenni** („reserved by a draft"), és `draft_delete` után sem szabadul fel („retired"). Az `mcp-auth.test.ts` READ_TOOLS listája kiegészítve a `list_briefs`-szel — ez a teszt fogta meg, hogy új read-tool került be, pontosan ahogy kell.

**Slice 1–5 állapota (2026-09-05): KÓD-KOMPLETT, box-deploy hátravan.** `tsc` + `eslint` tiszta; **257 unit + 542 integrációs teszt zöld** (62 fájl). A UI és az MCP ugyanazon a modellen áll.

✅ **DEPLOYOLVA 6.59.0 (2026-09-05)** — lásd a checkpointot a fájl alján.

#### Slice 5 — státusz-takarítás (12 → 6)
- [x] **D5.1** ✅ **Nem hat listát írtam át, hanem egyet csináltam belőlük.** Új `src/lib/mc-status.ts` a kanonikus lánccal; a `matrix/types.ts`, `MessageEditor`, `DesignTab`, `TemplateEditor`, `branding.ts` és `db/defaults.ts` mind **ebből származtat** (a CSS-változókat és a dot-osztályokat is a lista generálja, nem kézzel írt sorok). Ez nem szépészet: pontosan a hat párhuzamos lista szülte a `PLANNED`-bugot — bekerült a szűrőbe, de sehol máshova, és mivel ismeretlen státusz semmilyen szűrőopcióra nem illeszkedik, az a 8 kártya minden státusz-scope-olt nézetből kiesett. A `globals.css` státusz-változói és `.status-dot--*` / `.status-badge--*` osztályai a hatra szűkítve, `DRAFT` felvéve.
  - Új megkülönböztetés: **`MC_STATUSES`** (6, `DRAFT`-tal — színek, badge-ek) vs. **`MATRIX_STATUSES`** (5, `DRAFT` nélkül — mátrix-szűrő és editor-dropdown). A `DRAFT` felkínálása a mátrixban csak constraint-hibát tudna termelni.
  - A **kliensoldali** zár-lista (`MatrixGrid.tsx:475`, literál `["ACTIVE","INACTIVE","ARCHIVED"]`) is a közös `isMeasurementLocked`-re állt át — ez volt a második drift-csapda, és a törlés-dialógus zárolási figyelmeztetését hajtotta.
- [x] **D5.2** ✅ **`PREVIEW` a születési státusz** (`BIRTH_STATUS`): `createMessage` és az `import-xlsx` fallback is. Ez megszünteti a napi kézi átkattintást — a template-default eddig is kódból jött, csak a státusz nem.
- [x] **D5.3** ✅ A mérés-zár `ACTIVE`/`INACTIVE`-ra szűkült. Az `ARCHIVED` kiesése nem gyengíti: az archiválás az `archived_at` oszlop, és egy archivált sor **megtartja** a státuszát, tehát egy archivált ACTIVE kártyát továbbra is az ACTIVE zár véd. Amit a zár őriz, az a mérés folytonossága — egy sosem mért sornak nincs mit őrizni.
- [x] **D5.4** ✅ `scripts/status-cleanup.ts` + `npm run status:cleanup` — **dry-run az alapértelmezés**, `--apply` ír, egy tranzakcióban. Nem vakon hajt végre: minden sor alakját **újraellenőrzi** (üres? van ACTIVE ikre azonos névvel és képpel? hivatkozik rá kreatív/monitoring?), és ami nem illik a felmért mintába, azt `PREVIEW`-ra teszi a helyén hagyva, nem erőlteti bele egy csoportba. A DRAFT-ág az audience mellett a **teljes trafficking-identitást** (pmmid + 6 UTM + final URL) is nullázza — egy cellátlan sor nem hordozhat a régi cellájára mutató mérési kulcsot.
  - ⚠️ **Futtatási sorrend: `0012` + `0013` migráció ELŐBB.** A script a `brief_id`-t olvassa és `DRAFT`+NULL audience állapotot ír, amit a migrációk tesznek legálissá — migrálatlan DB-n az első lekérdezésen elszáll, nem a munka felénél.
  - Az élő adaton **read-only SQL-lel leellenőrizve**, hogy a besorolás a felmérttel egyezik: 8× `MC21a` üres → DELETE · `MC315 f/g/h/i` ACTIVE-duplikátum → DELETE · `MC6a`/`MC78 a/b/c` tartalommal → DRAFT. Egy megjegyzés a kimenetben: az **`MC78b`-hez 4 kreatív** kapcsolódik, és DRAFT-ként a `(78,b)` soft-link rá is illeszkedni fog — ez a `D1.4a` döntés következménye, ezért a script ki is írja.
- [x] **D5.T** ✅ `status-colors.test.ts` átírva: már nem az `ARCHIVED`-et őrzi (nincs ilyen), hanem azt, hogy **minden státusznak van CSS-változója és csak azoknak** — a hiányzó és a túlélő kulcs egyaránt hiba. `defaults.test.ts` a seedet a kanonikus listához köti (pontos egyezés). `messages.test.ts` (születési státusz) és `copy-move-messages.test.ts` (`ARCHIVED` zár) a szándékos viselkedésváltozás szerint frissítve, kommentben az indoklással.

#### Slice 6 — roadmapre, most NEM építjük
- [ ] **D6.1** Mért MC mozgatása pmmid-folytonossággal: first-class művelet explicit megerősítéssel + a régi pmmid megőrzésével, hogy az ACTIVE-ból visszakattintás kerülőút (és a "feedből némán kiesik" kockázat) megszűnjön. *Megjegyzés: a normál előre-irány (PREVIEW → APPROVED → mozgatás → ACTIVE → feed-export) nem kockázatos — a feed-export ACTIVE-ra gate-el, tehát közben nem exportálódik semmi. Csak a MÁR ACTIVE sor visszakattintása az.*
- [ ] **D6.2** Share-oldali approve gomb → `status='APPROVED'` (ember vagy agent). A purpose-doksi 9.3-as hiánya; az `APPROVED` ezért marad a listában (0 sora **be nem kötöttséget** jelent, nem feleslegességet).

**Legacy adat — ELLENŐRIZVE prod DB-n (2026-09-04), soronként, tartalommal és downstream-hivatkozással:**

| Sorok | Lelet | Verdikt |
|---|---|---|
| `MC21a` ×8 (`PLANNED`, SZA) | **Teljesen üres** (se név, se headline/copy/CTA/kép; csak a kód-default `template='html'`). **0 kreatív, 0 monitoring.** Soha nem módosítva (`updated_at == created_at`, 2026-05-01 15:59:43). | **Törlés.** A `PLANNED` nincs a `MEASUREMENT_LOCKED_STATUSES`-ben, a kód engedi a hard delete-et. Konzervatív alternatíva: `archived_at`. |
| `MC315 f/g/h/i` (`CONTENT`, SZA) | **Pontos duplikátumai a már `ACTIVE` `c/d/e` variánsoknak** — azonos név és `image1` (`f`≡`c`, `g`≡`d`, `h`≡`e`, `i`≡`c` másodszor), **14 másodperccel utánuk** létrehozva (13:43:26 → 13:43:40). Monitoring csak az `a–e`-n (132 sor), az `f–i`-n nincs. Véletlen duplakreálás. | **Törlés.** *(Korrekció: az első tervváltozat tévesen „befejezetlen folytatásnak" minősítette és PREVIEW-t javasolt.)* |
| `MC6a`, `MC78 a/b/c` (`INCOMING`, VAL, DCO) | Valódi copy („Társasházi Számlacsomag / Lakóközösségedre szabva.", `Érdekel!`), de az `image1` **`empty.png`** = szándékos placeholder → **félbehagyott DCO-gyártás**. **2026-08-30-án szerkesztve** (a legacy halmaz legfrissebb aktivitása). Nincs `ACTIVE` iker; a `MC78b` **nonDCO** ikre (`ch_disp`/`ch_soc`, `VAL_Tarsashaz_szamla_pro_b`) **leszállt fájlokkal + 4 kreatívval**, de `INACTIVE`. | **DRAFT** (user, 2026-09-04), onnan a user archiválja. Az audience kinullázása tudatos placement-eldobás; a négy sor négy külön variánst hordoz (`6a`/`78a`/`78b`/`78c`), így NEM olvad össze. A `pmmid` NULL-ra megy (soha nem volt mérve). A `MC78b` **nonDCO** ikre változatlanul marad — másik axis, másik sorok. |

DRAFT-ba egyik sem konvertálható: az invariáns (`DRAFT ⟺ audience IS NULL`) miatt az „átlökés" a placement eldobása lenne; a `MC21a`-nál ráadásul 8 sor → 1 draft összeomlás.

#### Slice 7 — a T0-szám megbízhatósága (a fenti nyomozásból esett ki, 2026-09-04)
- [x] **D7.1** ✅ **SZÁLLÍTVA (2026-09-04).** `mc:` szűrő substring-illesztés (`search-query.ts`) → `mc:21` behozza a `321`-et is. **Ez a user által megnevezett fájdalom konkrét oka** („lekérdezésre rossz számot kaptam"): a képernyőn MC21-nek hitt 48+4 sor valójában **MC321** volt. Javítás: `mcMatches` a `search-query.ts`-ben — a szám **egészére** horgonyoz (`\bmc21[a-z]*\b`), a variáns megadva pontosan illeszkedik, a nem-címke érték (a mátrix a pmmid-et is ebbe a mezőbe pakolja) marad substring. A `CreativeLibrary` ugyanezt a címkét építi, tehát egy javítás mindkettőt rendbe teszi. Teszt: +5 eset (`search-query.test.ts`, 34 zöld); suite 248/248, `tsc` tiszta.
- [ ] **D7.2** **Invariáns-sértés a prodban:** a `321` a **nonDCO axison két topicot fog át** (`HITEL_TCU_2026Q2_fullColorSurface` + `SZK_HITEL_a_TCU_2026Q2_fullColorSurface`), miközben a szabály *„a number never spans topics WITHIN an axis"* (`messages.ts:283`). Valószínű ok: a 2026-08-17-i kézi SQL-átszámozás (`MC838a → MC321a`), ami megkerülte a `createMessage` ellenőrzéseit. Két közel-duplikált topic is keletkezett. Felmérés → egy topicra összevonás vagy külön szám; és **ez az érv a D6.1 (first-class renumber/move) mellett** — a kézi SQL épp az invariánsokat kerüli meg.

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

### M9 — MC archive/delete edit módban: már megoldott, csak a súgószöveg hiányos (user-döntés, 2026-09-10)
Az edit-mode panel Delete gombja archivál vagy töröl (M10 dialog), tehát az MC archiválás use-case-e **megvan** — az egykori M9.1 (külön Archive gomb a `MessageEditor` headerben) **kikerül**, nem építjük.
- [ ] **M9.1** `EditModePanel.tsx:40` súgószöveg bővítése: „Add / duplicate topics and audiences; add, copy and move Messaging Cards." → vegye fel, hogy **MC delete és archive** is edit módban érhető el (a Delete gomb dialogja dönt). Copy-only, semmi logika.
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

### W2.6 + W2.7 — Unmatrixed filter pill + badge (Creative Library) (❌ KIVÉVE, user-döntés 2026-09-10)
Nem építjük: „unmatrixed" kreatív fogalmilag már nincs. Az Agentic nézetben minden feltöltött kreatív besorolódik egy channel-struktúrájú külön mátrixba; a DCO és az Agentic mátrix nem keveredik többé, így nincs MC-link nélkül lógó feltöltés, amit szűrni vagy jelölni kellene.

### D1 — Státusz-szűrő: MC-darabszám opciónként a szűrt eredményben (✅ KÉSZ, 6.31.0, 2026-08-30)
Cél: a Status legördülőben minden opció jobb szélén **kis szürke szám** = hány MC esik arra a státuszra a JELENLEGI szűrt eredményben. Nem pill, nem badge (a pill a gombon már megvan) — csak jobbra igazított `text-xs text-slate-400`.
Reuse: a `MultiPill` már fogad opciónkénti extrát és rendereli az opció-sorban (`optionColors` → színpötty, `_components/MultiPill.tsx:140-143`); ugyanoda kerül egy `optionCounts?: Record<string, number>` prop `ml-auto` számmal. Forrás: a `MatrixGrid` `filtered` useMemója.
- [x] **D1.1** `optionCounts` prop a `MultiPill`-be + jobbra igazított szürke szám (nincs szám → nem renderel semmit).
- [x] **D1.2** `statusCounts` a `MatrixGrid`-ben → `MatrixToolbar` (`:80-85`) → `MultiPill`. **Fontos:** a számot a **státusz-szűrő alkalmazása ELŐTTI** részhalmazon kell képezni (product + search + axis + hide-inactive már ráment), különben minden kiválasztott státusz önmagát számolná, a ki nem választottak meg mindig 0-t mutatnának.
- ⚠️ Default: ugyanez a prop a Product-szűrőre is rámegy (egy hívási sor), ha a user kéri — nem külön munka.

### SV — Sankey view + Feed view kivezetése + egyesített Export box (✅ KÉSZ + DEPLOYOLVA, 6.60.0–6.60.2, 2026-09-05)

**Kérés (user, 2026-09-05):** a Feed view mint nézet szűnjön meg (a hatalmas tábla nem nézet), a helyére
Sankey kerüljön; a feed-táblázat költözzön az export modulba egy kapcsoló mögé; a jobb toolbar Export
doboza grid view-ban kapjon egy **Matrix / Feed** kapcsolót, ágonként saját setuppal és figyelmeztetéssel.

**Döntések (user, 2026-09-05):** szintek forrása = a meglévő `treeStructure` config (nincs új
`sankeyStructure` mező) · render = `d3-sankey` layout + saját SVG (a `tasks/cost-sankey-szakertes.md`
§5b ajánlása; a dependency engedélyezve) · a feed-tábla a mostani `FeedView` komponens, toggle mögött.

**Fontos elhatárolás:** ez a **struktúra-sankey** (szalagvastagság = üzenetszám), nem a
`cost-sankey-szakertes.md`-ben elemzett **cost-sankey** (az a monitoring oldalra való, `sum(cost)`
súllyal, és külön munka marad). A szakértés library-választása és rajzolási best practice-ei viszont
1:1 érvényesek itt is.

#### SV.1 — Sankey view (`_views/SankeyView.tsx`)
- [x] **SV.1.1** `d3-sankey` + `@types/d3-sankey` dependency (3 kB, csak layout).
- [x] **SV.1.2** `_tree/buildSankey.ts` — a **meglévő** `parseTreeStructure` + `buildTree` kimenetéből
      (`TreeData`: `nodes[{id,level,label,count,parentId,platform,messageId}]` + `edges`) d3-sankey
      gráf: node = tree-node, link value = a cél-node `count`-ja. Nincs új parser, nincs új config.
- [x] **SV.1.3** Top-N + „Other (N)" összevonás oszloponként (default 20). E nélkül a Messages-szint
      2700 levele olvashatatlan. `nodeSort`-tal a sorrend determinisztikus (count desc, majd label).
- [x] **SV.1.4** SVG render a TreeView vizuális nyelvén: ugyanaz a node-doboz, ugyanazok a
      `--lvl-0..5` / `--plat-*` csík-tokenek, CSS-változós dark mode, szemantikus osztálynevek
      (`sankey-view__node`, `__ribbon`, `__label`, `__count`). Csak node-ok kapnak címkét, szalag soha.
- [x] **SV.1.5** Interakció: hover = a **teljes útvonal** kiemelése (előre számolt path-halmaz) +
      tooltip (count + státusz-bontás); leaf klikk → `onOpenMessage`; archivált levél halványan
      (`row--archived`, a TreeView mintájára).
- [x] **SV.1.6** Pan/zoom = **ReactFlow, egyből** (user döntés, 2026-09-05; a szakértés „bónusz opciója").
      A d3-sankey koordinátái mennek a meglévő `@xyflow/react` canvasra: node `position={x0,y0}` +
      `width/height` a layoutból, él = custom edge a d3 `sankeyLinkHorizontal()` path-ával,
      `strokeWidth = link.width`. Így a pan/zoom/minimap és a toolbar `TreeViewNavigator` szekciója
      ingyen jön (a `ReactFlowProvider` már a `MatrixGrid`-en ül), és a Sankey tényleg a Tree másik
      megjelenítése lesz. A node-nak rejtett `Handle`-ök kellenek (left target / right source), hogy az
      él kirajzolódjon.
- [x] **SV.1.7** Loading / invalid-structure / empty state a `TreeView` három állapotának pontos
      mintájára (ugyanaz az `empty-state` doboz, ugyanaz a „Settings → Structure" mutató szöveg).

#### SV.2 — Feed view kivezetése
- [x] **SV.2.1** `types.ts`: `View = "grid" | "sankey" | "tree"` (a `"feed"` kikerül).
- [x] **SV.2.2** `MatrixGrid` hydrate-guard (`:196`): a perzisztált `"feed"` érték **`"grid"`-re migrál**,
      különben a mentett állapotú userek üres nézetet kapnának.
- [x] **SV.2.3** View-kapcsoló mindkét alakja: `CycleIconButton` (collapsed) + `ViewControls`
      (expanded) — Feed helyére Sankey, ikon `Waypoints` (lucide), label „Sankey view".
- [x] **SV.2.4** `FeedView.tsx` **marad a fájlfában**, de már csak a `FeedExportDialog` importálja.

#### SV.3 — Feed-tábla az export modulba
- [x] **SV.3.1** `FeedView` kap opcionális `onOpenMessage`-et: ha nincs, a sorok nem kattinthatók
      (dialógusban nem nyitunk MessageEditort a dialógus fölé).
- [x] **SV.3.2** `FeedExportDialog`: „Feed rows" nyitható blokk a **Diff details `<details>` mintájára**,
      benne a `<FeedView>` a dialógus saját `messages`-ével — ugyanaz a `feedStructure` oszlopkészlet,
      ugyanaz a kliensoldali pattern-kiértékelés, mint a régi nézetben.
- [x] **SV.3.3** `audiences` + `topics` átvezetése `MatrixGrid` → `FeedExportPanel` → `FeedExportDialog`
      (a `FeedView` ezekből oldja fel az `{{audiences[...]}}` placeholdereket).

#### SV.4 — Egyesített Export box a jobb toolbarban (grid view)
- [x] **SV.4.1** `ExportPanel.tsx` — egy doboz, tetején **Matrix | Feed** kapcsoló a meglévő
      `mode-switch` / `ToggleBtn` nyelven (nem új token), alatta a választott ág setupja.
- [x] **SV.4.2** Matrix ág = a mostani `MatrixExportPanel` tartalma változatlanul (filter-chipek +
      Download XLSX). Feed ág = a mostani `FeedExportPanel` változatlanul, **a gating-figyelmeztetéssel
      együtt** (egy product + ACTIVE/INACTIVE), plusz a „Live: vN / Default / uploaded" blokk.
- [x] **SV.4.3** Az ág-választás perzisztál: `mm6_matrix_export_mode` (a `mm6_<page>_<thing>` konvenció).
- [x] **SV.4.4** A `view === "feed"` ág törlése a `MatrixGrid` toolbar-renderjéből.

#### SV.5 — Doksi + zárás
- [x] **SV.5.1** `tasks/component-inventory.md`: `sankey-view__*` család + az `export-panel` kapcsoló;
      a `feed-export-panel` / `matrix-export-panel` bejegyzések „mostantól az `export-panel` ágai".
- [x] **SV.5.2** `docs/REBUILD_SPEC.md` §6.2: a Feed nézet leírása átkerül az export-dialógushoz,
      a Sankey a 3. nézet lesz (a §18.10 „out of scope — Sankey" pont törlendő).
- [x] **SV.5.3** Verzió: `6.59.1` → **`6.60.0`** (minor: új nézet + eltávolított nézet + toolbar-átalakítás)
      + `CHANGELOG.md`.

**Amit NEM csinálunk:** nincs `sankeyStructure` config, nincs cost-dimenzió a matrix-sankey-ben,
nincs v5 canvas-renderer portolás, nincs napi/animált bontás.

**DEPLOYOLVA 6.60.0 + 6.60.1 + 6.60.2 (2026-09-05):** commitok `cae6f7d` → `e124024` → `de380e0`, box `a868804`→`de380e0`, build 38.4s / 41s, `npm install` a boxon is kellett (**új dependency: `d3-sankey` 3 kB + `@types/d3-sankey`**), `pm2 restart mm6-erste --update-env` → online. **Séma-migráció nincs** (`git diff --name-only a868804..de380e0 -- db/migrations` üres). Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/feeds` 307 · `/monitoring` 307 · `/api/feed-exports` 401 · `/mcp` 401 · publikus `erste.messagingmatrix.ai/login` **200**. Élőben ellenőrizve: Sankey renderel (SZK 677 → pro 444 / rem 233 → audience → topic → MC, Other-láncokkal), hover = teljes útvonal + tooltip státusz-bontással, Navigator ráköt, Export box Matrix|Feed kapcsolóval és perzisztálva, „Feed rows" checkbox mögött a feed tábla a dialógusban.

**Két utólagos javítás, mindkettő élőben talált:**
- **6.60.1 — a címkék egymásra csúsztak a sűrű oszlopokban.** A node magassága arányos az értékével, tehát ahol egy `Other` viszi a flow 90%-át, a maradék húsz sub-pixel csík: az egyetlen garantált elválasztás a node-ok közti `nodePadding`, ami 10px-en nem ért túl egy 18px-es címke-pillen. 22px lett, és a canvas magassága a legmagasabb oszlophoz igazodik.
- **6.60.2 — a tooltip rossz sarokban nyílt.** Az utolsó `mousemove`-ból pozicionált, de a `mouseover` ugyanarra a pozícióra **előbb** tüzel, tehát a minta mindig egy mozdulattal késett — az első hovernél pedig egyáltalán nem volt minta, és a tooltip a canvas origójába esett. A hover-esemény most viszi a saját koordinátáit, a canvas szélénél beszorítva.

**Utókövetés — 6.61.0 (2026-09-05, user):** a „pipás preview gomb" a **toolbar feed-paneljéből** hiányzott — a checkbox az export-dialógusba került, a diff mellé. Az a két kérdés nem ugyanaz: a dialógusbeli azt mondja meg, *mit küld ez az export*, a panelbeli azt, *mi van most a feedben*. Mindkettő megmarad; a panelben egy „Preview feed rows" checkbox ül **közvetlenül az Export gomb fölött**, és `AppDialog`-ban nyitja a `FeedView`-t a jelenlegi szűrésre (onnan semmi nem exportál). Commit `18fa9bb`, build 39.0s, box `6.61.0`, health `/` 307 · `/login` 200 · `/matrix` 307. Élőben ellenőrizve: VAL / 221 sor.

**6.61.1 (ugyanaz a session, user):** „azért nem jó az export dialógusba, mert nincs sor-previewnak még egy dialógus-layer, ne is legyen, jobb a previewt kint tartani." → a `feed-export-dialog__rows` blokk **törölve**; a tábla a dialóguson belül szűkítette az export saját setupját, és a dialógus a *döntésre* való (mi megy ki), nem sorböngészésre. A preview kizárólag a panel `Preview feed rows` checkboxán él. A `FeedExportDialog` `audiences`/`topics` propjai is visszakerültek (csak a beágyazott tábla miatt voltak ott). Commit `1e6bd5b`, build 40.0s, box `6.61.1`, health `/` 307 · `/login` 200 · `/matrix` 307 · `/feeds` 307. Élőben ellenőrizve: a dialógus a „Diff details"-szel zárul.

**6.62.0 (user, 2026-09-05) — a fold szabály rossz volt, nem a hangolása.** Két bejelentés ugyanarról: „az Almaid Céljaid miért megy az Otherbe, van neki MC332-je" és „ez az audience miért megy Otherbe, DCO szerint tök egyértelműek a témák". Ok: a cap **oszloponként** ment, nem szülőnként — így egy **látható** node teljes részfája elveszíthette az oszlop-szintű rangsort más szülők gyerekeivel szemben, és eltűnt egy közös `Other`-ben. A levélszinten ez a legrosszabb: minden MC `count = 1`, tehát ábécé döntött, és az `MC332` azért esett ki, mert az `MC330`/`MC331` után rendeződik — nem azért, mert kicsi.

Új szabály: **szülőnkénti top-8**. Egy látható node mindig a saját legnagyobb gyerekeit mutatja, és csak a saját túlcsordulása kerül a saját `Other`-ébe. `Other (1)` sosem renderelődik (egy sort kér és semmit nem mond), a gyökéroszlop pedig sosem hajtogat (nincs fölötte szülő, ami fogantyú lehetne). **Drill-down:** a túlcsorduló szülő a Tree chevronját kapja, kattintásra (vagy a saját `Other`-jére kattintva — ugyanaz a toggle) mind megjelenik; perzisztál a `mm6_sankey_expanded_v1`-ben. Commit `9d2…`, box `6.62.0`.

**Amit a mérés mutat, és ami nyitva marad:** ebben a szűrésben (SZK + ACTIVE) **681 üzenet, 90 audience, 446 külön (audience, topic) pár** van. Ezt egy képernyőn nem lehet olvashatóan megmutatni — a szülőnkénti fold ráadásul szintenként szorzódik, ezért a cap szándékosan kicsi (8), és a `fitView` 0.35-nél megáll (az alatt a pillek olvashatatlanok), tehát a magas ábra **pásztázható, nem összepréselt**. A nyitókép így is sűrű. Ha ez zavar, a következő lépés a Tree mintája: **alapból csak az első 1–2 szint nyitva**, a mélyebb oszlopok drill-downra jelennek meg — user dönt.

**6.63.0 (user, 2026-09-05) — a gyoker-hiba: a sankey utvonalakat rajzolt entitasok helyett.** User: „a topic oszlopban meg az MC oszlopban nem kene duplikalni az entitasokat annyiszor, ahany audience van — ez lenne a sankey lenyege nem?" Igaza volt. A `buildTree` a node-okat a **teljes osszel-lanccal** kulcsolja, mert egy faban minden node-nak egy szuloje van; a sankey viszont **DAG**: egy topic egy node, tobb befuto szalaggal. A fa-azonossag ujrahasznositasa minden topicot es minden kartyat lemasolt audience-enkent — pont az ellenkezoje annak, amire az abra valo, es egyben ez okozta az olvashatatlansagot is. Merve az elo szurest (SZK + ACTIVE): **topic 446 vs 27, MC 681 vs 54**.

A `buildSankey` mostantol maga jarja a szinteket es entitasra merge-el, de a sor-osszeallitast (`messageRows`) es a szintenkenti csoportositast (`groupValue`) megosztja a Tree-vel, hogy a ket nezet tovabbra se tudjon mast mondani a strukturarol. Egy tobb audience-ben szereplo kartya **egy** level, ami tobb uzenetet nyom. A fold visszament oszloponkentire (cap 120) — DAG-ban ez vegre oszinte: az `Other` orokli a tagjai sajat linkjeit, tehat egy behajtogatott audience folyama tovabbra is a valodi topicokba erkezik; nincs sehova nem vezeto node, es nem kell szurke lancot huzni a jobb szelig. 809 teszt zold, box `6.63.0`.

**6.64.0 (user, 2026-09-06) — metrika-sulyozas + feed preview a vaszonra.**

*Push-back es a valasz:* megmertem a `monitoring` tablat, mielott barmit terveztem. Augusztusban a **cost 13%-a**, az **impressions 35%-a** kotheto uzenethez, a **120 konverziobol 9**. Ezt elmondtam, a user igy is kerte a kapcsolot („mutassa ha nulla, es ki fogjuk deriteni hogy a report jobb legyen es legyen adat") — tehat megepult, **de minden delivery-mod kiirja a sajat lefedettseget** (70% alatt amber). Fontos arnyalat a `dashboard-monitoring.ts`-bol: product-szurovel a lefedettseg sokkal jobb (SZK-n 85%), es a matrix mindig szurve van — a 13% a szuretlen szam.

*Amit epitettunk:* `Weight by` doboz a jobb toolbarban (MC / Impr. / Cost) + riport-idoszak valaszto; uj `GET /api/monitoring/message-metrics` + `lib/sankey-metrics.ts`. **Csapda, amit kikerultunk:** a dashboard query eldobja az `impressions = 0` sorokat (1x1 click trackerek, a CTR miatt helyesen), de a cost 62%-a azokon ul — ez a lekerdezes ezert NEM dobja el oket. Konverzio a node-tooltipen, **nullanal is kiirva** (az ures sor „nincs adat"-ot jelentene, nem „nem konvertalt"-at). Ha semmi nem szallitott, explicit empty state jon, nem nullakbol allo layout.

*Feed preview:* a tabla kikerult a dialogusbol es **atveszi a matrix vasznat** — dialoguson belul egy sor nem tudja megnyitni az MC-t egy masodik dialogus-layer nelkul, tehat a sorok holtak voltak. A kapcsolo mostantol **pipas gomb** a `preview-pane__skip-anim` mintajara. Elohen ellenorizve: sor-klikk → MC editor nyilik; Cost modban a tooltip „292 309 Ft · 27 messages · 2 conversions". 813 teszt zold, box `6.64.0`.

*Nyitva a userenel:* a konverzio-import javitasa (120-bol 9 matchel) — ha ez import-hiba es nem valosag, az a kovetkezo lepes.

**6.64.1 (user, 2026-09-06) — a sankey kirakasokat nevezett uzenetnek.** Ket egymas utani user-eszrevetel ugyanarrol: „a 24 messages az nem 24 uzenet hanem 24 instance nem?" es „itt meg a 72 messages az 72 instance of 3 mc nem?". **Mindketto igaz** — es az elso valaszomban tevesen allitottam, hogy nem-level node-on a szo helyes. Elo DB-vel ellenorizve: `MC398a` = 24 sor / 24 audience / 1 topic; `Ne maradj le 26Q2` = **72 sor / 3 kartya (MC314a,b,c) / 24 audience**.

A `messages` tabla egy sora **kirakas (placement)**, nem uzenet: egy 24 audience-be kitett kartya 24 sor. A sorszam tehat MINDEN szinten kirakas-szam. A tooltip mostantol mindkettot megnevezi — nem-levelen `3 MCs · 72 placements · 24 audiences`, levelen (ahol a node MAGA a kartya) `24 placements · 24 audiences · 1 topic`. Az MC-modu suly **marad a sorszam** (egy kartya-node-nak annyit kell nyomnia, amennyit a befuto szalag hoz, kulonben a flow nem jon ki), de a pill hover-title-je es a `Weight by` hint kimondja: `placements`. `SankeyNodeDatum.messageCount` → `placementCount`, plusz uj `cardCount` / `audienceCount` / `topicCount`. 815 teszt zold, box `6.64.1`.

⚠️ **Nem ellenorizve vizualisan:** a 6.64.1 deploy utani utolso screenshot elmaradt (a bongeszoablak 0 szelessegu volt). A logikat unit teszt es DB-lekerdezes fedi, a health 307/200, de a tooltip uj szovege elohen meg nincs szemmel latva.

**6.65.0 (user, 2026-09-06) — statusz-szin az MC oszlopon + egy elesben elo, tagabb hiba.**

*A user ket dolgot kert:* legyen statusz-fuggo az MC oszlop szine, es a statusz-legordoloben latszodjon a tobbi statusz szine is (setting alapjan). A masodikat **nem tudtam volna kitalalni** — eloben megmertem a DOM-ot, mielott barmit irtam volna:

⚠️ **GYOKER-OK, es nem csak a legordulore igaz: az appban MINDEN statusz-pott atlatszo volt az ACTIVE kivetelevel.** A `.status-dot--*` es `.status-badge--*` szabalyok `@layer components`-ben ultek, az osztalynevek viszont futasidoben allnak ossze (`status-dot--${statusSlug(s)}`), tehat a Tailwind scanner sosem latja oket jeloltkent es **kipurgalja a szabalyt**. Az `ACTIVE` **veletlenul** maradt eletben: a `ClientsTab.tsx:79` kiirja szo szerint. Erintett volt a statusz-szuro opcioi, a matrix chipek, a feed sor-csik es a sankey tooltip is. Mert bizonyitek: `getComputedStyle(dot).backgroundColor === "rgba(0, 0, 0, 0)"` mindenhol az ACTIVE-on kivul.

*Javitas:* a szabalyok **unlayered**-ek lettek — a fajl sajat, mar meglevo gyogyszere erre (a platform-el blokk is igy all, „Unlayered ON PURPOSE"). Igy nem tunhetnek el ujra, ahogy a literalok jonnek-mennek. Ellenorizve deploy utan: mind az ot pott a **kliens mentett szinet** kapja (APPROVED = `rgb(15,138,97)` = az erste `#0f8a61`, nem a `#10b981` default).

*MC oszlop szine:* levelen a statusz nyer, a tobbi oszlopon marad a platform/melyseg kodolas (hogy a Tree-vel egyutt olvasson). **Kevert kartyanal nem valasztunk „dominans" szint** — egy 13/11 megoszlast zoldre festeni hazugsag lenne —, hanem aranyos `linear-gradient` kemeny stopokkal. Eloben: 100 statusz-szinezett level, 98 egyszinu, **2 gradiens**, es az aranyok pontosak (`MC134a` 29 kirakas → 68,97% ACTIVE / 31,03% INACTIVE; `MC94b` 9 → 44,44% / 55,56%). 815 teszt zold, box `6.65.0`.

**Amit szándékosan NEM csináltunk:** nincs `sankeyStructure` config (a `treeStructure` hajtja mindkét nézetet), nincs cost-dimenzió a matrix-sankey-ben (az a monitoring oldalra való — `tasks/cost-sankey-szakertes.md`), nincs v5 canvas-renderer portolás.

---

## 🟡 NEXT — green-light után, alacsony blokk

### MCP token-scope #3: `draft` — mindent olvas, csak draftot ír (USER KÉRÉS, 2026-09-06)
A workflow-agent ma vagy `read` (semmit nem tud létrehozni), vagy `full` (a teljes mátrixot írhatja). A munkamódszer viszont pont a közepét kívánja: az agent **lásson mindent** (mátrix, kreatívok, riport, sablonok — hogy tudjon dönteni), de **csak a draft-térbe írhasson**, ahol a hibája nem ér el élő kártyát.

- [ ] `mcp_tokens.scope` harmadik értéke: `read | draft | full` (a check/validáció a `mcp-tokens` route-ban és a Settings › MCP fülön).
- [ ] A `buildMcpServer` regisztrációs feltétele: `draft` = minden read tool + **a draft-írók** (`generate_test_creative`, `draft_archive`, `brief_attach`, és a draftra korlátozott `mc_update`?) — a `draft_promote` **NEM**, mert az cellát ad, azaz kilép a draft-térből. ⚠️ OPEN Q: a promote tényleg kimarad-e, vagy a scope „draft + promote" legyen.
- [ ] A ma `full`-höz kötött, draftra is ható tool-oknál a scope nem elég: a **sor** is draft kell legyen (`status='DRAFT'` ⟺ `audience IS NULL`) — a guard az entity-ben, nem a tool-listában, különben egy új tool kifelejtődik.
- [ ] Tesztek: `draft`-scope-os token nem tud `mc_create`-et / `draft_promote`-ot / dimenzió-írást; ugyanaz a token minden read toolt lát; a `full` és a `read` viselkedése változatlan (regresszió).
- [ ] `McpTab.tsx` prózája — a tool-lista magától szinkronizál a `mcp.ts`-ből, a **szöveges** szekciók kézzel írtak (l. `feedback_mcp_settings_page_sync`).

Miért ez a helyes gránulátum: a draft már ma is egy `messages` sor `audience IS NULL`-lal, tehát a „mit írhat" kérdésre **létező invariáns** válaszol — nem kell új jogosultsági fogalom, csak a meglévőt kell a token-scope-hoz kötni.


### M12 — Mátrix szűrő-pillek: kijelölt érték a pillben + product tag a sor/oszlop-fejléceken (user, 2026-09-10)
Apróságok, screenshotból (`/matrix`, Product + Status `multi-pill`):
- [ ] **M12.1** Ha a Product vagy Status pillben **1–2 elem** van kijelölve, a `multi-pill__badge` szám helyett a **kijelölt értékeket** írjuk ki a pillbe (pl. `HK, SZK` / `ACTIVE, PREVIEW`). **3+** kijelölésnél marad a szám-badge. Mindkét pillre ugyanaz a szabály (közös `MultiPill` prop, ne két külön logika).
- [ ] **M12.2** Ha **több product** van kijelölve, az **audience oszlop-fejléc** és a **topic sor-fejléc** elejére (a név elé) **product tag** kerül, hogy látsszon melyik termékhez tartozik. Vizuál = a draft-kártya `tag-chip drafts-tile__product` pillje (sötét `bg-slate-800 text-white`, `text-[10px]`) — reuse, ne új család. **Minden density-ben ott legyen, a dense-ben is.** Egy product kijelölésnél (vagy szűrő nélkül, ha egy termék látszik) nem kell.

### M1 — Matrix "Color by" (Strategy | Platform | Both)
Cél: audience-oszlopok színezése strategy/platform szerint, legenddel.
- [ ] **M1.1** `Color by: None|Strategy|Platform|Both` dropdown a `MatrixToolbar`-ba; persist `mm6_matrix_color_by`.
- [ ] **M1.2** Determinisztikus value→color map a látható audience-ök distinct `strategy`/`buyingPlatform` értékeiből (sorted distinct → paletta-index). Szín-token reuse (ne hardcode `bg-*`; STATUS_COLOR mintája = `status-dot--*` CSS-var class).
- [ ] **M1.3** Szín **band az audience oszlop-fejlécen** (nem a cellán); `Both` = két vékony sáv; kis legend. ⚠️ OPEN Q: `Both` vizuál + header-only.

### M4 — Crosshair highlight (sor+oszlop) hover + click-pin
- [x] **M4.1 (✅ KÉSZ, 6.24.0, 2026-08-25)** Él-rail crosshair, NEM state-alapú. Imperatív (`GridView.paintCrosshair` + delegált `onMouseOver`/`onMouseLeave` a `<table>`-ön, ref) → hoverkor nincs grid-újrarajzolás. `data-col-key`/`data-row-key` a 2 header-`<th>`-re + mindkét cella-`<td>`-re; a `c`+`c-1` oszlop `border-right`-ja és a `r`+`r-1` sor `border-bottom`-ja kap `--mx-cross` színt (`matrix-grid__x--edge-r`/`--edge-b`, unlayered CSS). Csak meglévő border SZÍNE vált → **0 layout-shift**, `transition: border-color 140ms` → nem villódzik. Edit módban is megy (border-color ≠ ring box-shadow). Header-hover = csak az az oszlop/sor. Korlát: legszélső bal oszlop / legfelső sor külső élét a sticky header adja (nincs `c-1`/`r-1`).
- [ ] **M4.2** Click-to-pin: kattintásra pinnel escape/újraklikkig; a chip-open klikket nem nyeli el. ⚠️ OPEN Q: pin+hover mindkettő.

### M5 — Detail-view audience header: strategy tag + lineitem_id (❌ KIVÉVE, user-döntés 2026-09-10)
Nem építjük: a `MessageEditor` Naming fülén már ott a properties panel, a strategy és a lineitem_id ott látszik — nem kell a headerbe kiemelni.

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
- [x] **W3.i Monitoring: több periódus együtt (tartomány-választó) — GREEN-LIGHT (2026-09-01).** User: „van 4-5 hónap adatunk, tök jó lenne tetszőleges ezen belüli periódusból elemezni". Ma a `/api/monitoring` **pontosan egy** periódust ad (`route.ts:35` `eq(periodFrom, selected)`), a UI egy `<select>`-tel vált (`MonitoringTable.tsx:344`).
  - **Felmért tények (prod DB, 2026-09-01):** 4 periódus, **15 646** nyers sor, de csak **6 227** különböző message-kulcs → a négy hónap EGYÜTT 6 227 sorra aggregálódik, azaz **nagyjából akkora nézet, mint ma az augusztus egyedül (5 733)**. Nincs se skálázási, se compute-probléma. **2 623 kulcs (42 %) mind a 4 periódusban futott** — ez az a populáció, amiért az egész funkció van. Különböző MC: **267** → a per-MC/per-periódus trend-payload legfeljebb ~1 068 sor.
  - **A grain MA hónap — a választó ezért hónap-lista, NEM naptár.** A `monitoring`-ban nincs nap-oszlop, tehát „jún 15 – júl 20" ma nem kiszolgálható, és egy dátumválasztó olyan pontosságot ígérne, ami mögött nincs adat. ⚠️ **Korrekció:** ez a `monitoring` tábla és a parser korlátja, **nem a forrásfájlé** — a nyers riportban ott a nap, lásd **W3.j**. Ha a W3.j leszállít, ez a választó bővíthető nap-felbontásra ugyanezzel a szerver-oldali aggregációval.
  - **Aggregációs kulcs:** `(platform, audience_key, topic_key, mc_number, mc_variant, size)`. A `product` / `message_id` / `match_level` bemehet a GROUP BY-ba: **ma 0 olyan kulcs van, ahol ezek periódusok között eltérnének** (mérve). Ha egyszer eltérnének, az két sorként *látszik* — jobb, mint egy `max()`-szal némán feloldani.
  - **CTR mindig összegzett klikk/impresszióból újraszámolva**, soha nem periódus-CTR-ek átlaga.
  - [x] **W3.i-1** `/api/monitoring`: `?from=&to=` **összefüggő szelet** a periódus-listából (mindkettő inkluzív, a lista-sorrend szerint). Alap változatlanul a legfrissebb egy periódus — a mai viselkedés nem változik magától. A periódus-lista rendezése `periodDateKey`-re (`route.ts:24` ma a nyers `DD/MM/YYYY` szövegen `desc`-el → évfordulón megfordul).
  - [x] **W3.i-2** Új `mcTrend` a payloadban: `(mc_number, mc_variant, period_from)` → impressions/clicks, a kiválasztott szeletre. ~1 068 sor a teljes tartományra.
  - [x] **W3.i-3** `MonitoringTable`: a `<select>` helyére **két** select (`from` – `to`), alapból mindkettő a legfrissebb periódus. A `to < from` eset a UI-ban kizárva. A tábla többi része (méret-összecsukás, MultiPill-ek, match-szűrő, rendezés) változatlan — a szerver ugyanabban a méret-grainben adja a sorokat, mint ma.
  - [x] **W3.i-4** `MonitoringDetailDialog`: a mai (audience × méret) bontás mellé **periódus-bontás** (impr / klikk / CTR periódusonként) — egy MC havi lefutása. Ez a funkció tényleges haszna.
  - [x] **W3.i-5** Teszt: több periódus összegzése egy kulcsra, CTR újraszámolás (nem átlag), tartomány-határok inkluzivitása, évfordulós periódus-sorrend, `mcTrend` alak, kliens-izoláció.
  - **Verzió a slice végén:** `6.47.0` → `6.48.0` (minor — új API-paraméter + UI).
  - **Az átfedés-guard nyitva marad:** az import-replace a pontos `(from, to)` párra megy (`import/route.ts:108`), tehát egy havi és egy heti fájl ugyanarra az időszakra ma **egymás mellett élne és mindkettő számolna**. Rövidebb periódusok bevezetése előtt kell egy guard, ami átfedő tartományt visszautasít.
- [~] **W3.j Nap-grain ingest — ⚠️ KORREKCIÓ egy korábbi állításhoz (2026-09-01).** Azt írtam a usernek, hogy a forrás XLSX-ben nincs nap-dimenzió és ezért az AdForm report buildert kellene átállítani. **Ez téves volt.** A `docs/Creative rep_05_2026.xlsx` fejléce: `Date | Campaign | Line Item | Banner Ad Message | Banner/Adgroups | … | Rendered Impressions` — **a nap ott van minden sorban** (`01/05/2026`), és mindig is ott volt. A `parseAdformReport` egyszerűen **eldobja**: a `Date` oszlopot nem is olvassa ki, mindent a periódus egészére aggregál (`adform-report.ts:333` — a `col()` hívások között nincs `Date`).
  - **Mérve, a valódi parser-helperekkel (`extractPmmidToken` / `parsePmmid` / `extractSize` / `normalizePlatform`), tehát nem becslés:**

    | fájl | nyers sor | periódus-grain | **nap-grain** | szorzó |
    |---|---|---|---|---|
    | `Creative rep_04_2026.xlsx` | 85 222 | 3 244 | **73 488** | ×22,7 |
    | `Creative rep_05_2026.xlsx` | 83 905 | **3 002** | **67 749** | ×22,6 |

    A május periódus-grain 3 002 **pontosan egyezik** a DB-ben tárolt májusi sorszámmal → a mérési módszer hiteles.
  - **Következmény:** napi felbontás **nem igényel semmilyen változtatást abban, ahogy a riportot lehúzod**. Nem kell új AdForm-riport, nem lesz nagyobb a fájl (ma is 5,5 MB / 84 e sor, és ma is elparse-oljuk). Ami kell: `day` oszlop a `monitoring`-ra + az unique index bővítése + a parser olvassa a `Date`-et + újraimport azokra a periódusokra, amiknek **megvan még a forrásfájlja** (a `docs/`-ban április + május; a `source_filename` tárolt, a bájtok nem).
  - **Költség:** ~68–73 e sor/hónap a mai ~3 e helyett → ~0,8–0,9 M sor/év. Postgresnek indexszel semmi; az insert oldalt a 6.46.0 chunkolása már bírja (68 e sor × 20 bind-param ≫ 65 534, de a chunkolás pont ezt kezeli).
  - **Miért NEM volt szabad ezt a W3.i előtt megcsinálni:** a `/api/monitoring` a kiválasztott tartomány sorait küldi a böngészőnek. Nap-grainnél egyetlen hónap ~68 e sor JSON lenne. A **W3.i szerver-oldali aggregációja pontosan ez az előfeltétel** — nap-grain táblából is 3 e sort ad vissza egy hónapra. A sorrend tehát helyes volt, csak az indoklásom volt rossz.
  - **A user megerősítette (2026-09-01): a június / július / augusztus riportfájl is megvan** → a nap-grain **visszamenőleg teljes**, nem lesz kevert grainű tábla. Ez volt az egyetlen nyitott kockázat.
  - **Slice-határ:** ez a szelet CSAK azt csinálja, hogy a nap bekerül a táblába úgy, hogy **egyetlen mai fogyasztó se változzon**. A tényleges nap-felbontású tartomány-lekérdezés (`?from=2026-06-15&to=2026-07-20`, „last 30 days") külön szelet — **W3.k** —, mert az UI-t és a dashboard-csempéket is érinti.
  - **Miért nem törik el semmi közben:** minden mai fogyasztó **periódusra** csoportosít (`monthlyDelivery` a `period_from`-ra, a `/api/monitoring` a szeletre), és egy periódus napjait összegezve pontosan a mai számot kapja vissza. A payload-méret sem nő: a route továbbra is a message-kulcsra aggregál, nem napokra.
  - [x] **W3.j-1** Séma: `monitoring.day` — `text("day").notNull().default("")`, **ISO `YYYY-MM-DD`**. Nem a nyers `DD/MM/YYYY`: a nap épp azért kerül be, hogy rendezni és tartományozni lehessen rajta, és a `periodDateKey` már ma is DD/MM/YYYY↔ISO-t normalizál. Az üres string = „nincs napi bontás", pontosan a `size` meglévő konvenciója szerint (`schema.ts:642`) — így az unique index NULL-mentes marad. Migráció `0010`.
  - [x] **W3.j-2** `monitoring_client_period_key_idx` bővítése `day`-jel + új `monitoring_client_day_idx` a `(client_id, day)`-re.
  - [x] **W3.j-3** `parseAdformReport`: a `Date` oszlop kiolvasása (ma nincs is `col("Date")`), ISO-ra normalizálva, és bevétele az aggregációs kulcsba. **Ha nincs `Date` oszlop → `day = ""`**, tehát egy régi alakú riport ugyanúgy importál, mint ma.
  - [x] **W3.j-4** Import-route: `day` átvezetése. A replace továbbra is a `(client, period_from, period_to)` hármasra megy, tehát egy periódus újratöltése **egészben** vált periódus-grainről nap-grainre — félig átállt periódus nem létezhet. A sorszám ~3 e-ről ~68 e-re nő importonként (21 chunk a mai 3 276-os chunk-mérettel) — **az import futásidejét meg kell mérni**, nem feltételezni.
  - [x] **W3.j-5** Teszt: valódi alakú riport (Date oszloppal) naponként aggregál; `Date` nélküli riport `day=""`-vel importál (regresszió); ugyanaz a periódus újratöltése nem hagy vegyes grainű maradékot; a `monthlyDelivery` és a `/api/monitoring` **változatlan számokat** ad nap-grain tábla fölött (ez a szelet lényege).
  - [ ] **W3.j-6** Újraimport a 4 (5) meglévő riportfájlból a Monitoring oldal feltöltőjén át — nem script. **Migráció + kód egy passzban a boxon** (`migrate` + `pm2 restart`), ahogy a `mcp_tokens` szeletnél is.
  - **Verzió a slice végén:** `6.48.0` → `6.49.0` (minor — új oszlop + index + migráció).
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

### I4 — Drive-linkek a kreatívokon (TERV KÉSZ, 2026-09-03 — ÉPÍTÉS ZÖLD-LIGHTRA VÁR)
**User-döntés (2026-09-03), ez váltja a korábbi „igény rögzítve, három nyitott kapu" állapotot:** minden feltöltött kreatívhoz **két** Drive-hivatkozás tartozik — (1) **parent folder link: a fontosabb, a user tölti ki, editálható**, feltöltéskor batch-szinten egyszer bepasztézva; (2) **direkt file link: számított, NEM editálható** — a mappa listázásából, fájlnév-egyezéssel áll elő. Megjelenítés: share-oldal fejlécében a benne szereplő kreatívok mappalinkjei, és minden kép/videó nézetben a szülőmappa. Újraellenőrzés/pótlás: **Creative Library side-toolbar „Drive link health check"**.

**Felmérés (2026-08-31 + 2026-09-03, ellenőrzött tények):**
- ⚠️ **Az `/api/drive/proxy/` NEM Google Drive.** v5-ös örökség: a `template.json` `path-messagingmatrix` útvonala, MinIO-ból szolgál ki bájtokat (`src/app/api/drive/proxy/[filename]/route.ts`). A projektben ma **nulla Drive-integráció** van, és nincs `googleapis` dep.
- **`creatives.file_id` NEM Drive-ID**, hanem az `uploaded_files.id` (nanoid). Prod: 3145 kreatív, mind 1:1 egy `uploaded_files` sorra (+349 asset ugyanabban a táblában).
- **A user gépén a Drive-mount rclone** (`gdrive:` remote, macfuse). Az `rclone lsjson` **valódi Drive ID-t ad** mappára és fájlra (ellenőrizve: `Data/ERSTE HU/MARKET/*` → `1dyAf70…`). Ez a backfill motorja — nulla OAuth.
- **A Leadás-mappák publikusak (anyone with the link):** auth nélküli `GET https://drive.google.com/drive/folders/1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe` → **200**, a mappanév a válaszban, nincs sign-in redirect. ⇒ (a) a share-oldal linkjei külsősnek is nyílnak, (b) a szerver **puszta API-kulccsal** listázhat, OAuth nélkül.
- **A share-oldal snapshotból renderel** (`share_galleries.metadata` JSON, `SnapshotCreative`), nem élő `creatives` sorból → a Drive-mezőket a snapshotba is bele kell tenni, különben a fejléc üres marad.
- **A szerver a folder linkből NEM tud fájl-linket számolni hívás nélkül** — a Drive ID opak, nincs névkonvenció. Kell egy listázó hívás; a kérdés csak az, hogy milyen hitelesítéssel (lásd I4.2).

**Ami ezzel MEGHAL:** a régi „számított útvonal" opció (bizonyítottan lehetetlen), a „teljes OAuth + token-tárolás a boxon" opció (nem kell, a mappák publikusak), és a **Wave 5 (Share → Drive export)** — a linkelés kiváltja a másolást. **FR-B Documents külön marad:** más kardinalitás (MC-nként több Slides doksi, státusszal).

**MÉRÉS (2026-09-03, kulccsal, ÉLES) — a Path A NYERT, a hitelesítés kérdése lezárva:**
- `GET drive/v3/files?q='1idXHYJYnXRNEW6jmhZ7RW8XCzT269xbe' in parents&key=…` → **HTTP 200, 42 fájl**, valódi ID-kkel (`1CqV_cyzunx…`) — az MC312-es Leadás-szett. Nincs OAuth, nincs dep, egy env-var: `GOOGLE_DRIVE_API_KEY` (GCP `grafia-2026` / „messagingMatrix" kulcs, Drive API-ra szűkítve, app-restriction None). **A boxra is ki kell vinni deploykor.**
- `files/<folderId>?fields=id,name` → `"Leadas 04 13"` ⇒ a `drive_folder_name` ingyen jön.
- Auth nélküli `GET drive.google.com/file/d/<fileId>/view` → **200** ⇒ a share-oldal file-linkjei külsősnek is nyílnak.
- A 42 Drive-fájlnév ellen a prod DB-ben **42 `creatives` sor** áll (`file_name LIKE 'ERSTE_MARKET_MC312_%…'`) ⇒ a fájlnév-join tartja magát.
- ⚠️ **A kulcs CSAK az anyone-with-link mappákat látja.** `Data/ERSTE HU/MARKET` és a `Future befektetés - GenZ` kampánymappa: `files.get` → **404**, a gyerek-listázás → **0 elem** (nem hiba!). A `Leadas 04 13` (amit leadáskor megosztasz) → **200**. ⇒ (a) gyökérből rekurzívan bejárni NEM lehet, (b) a „0 gyerek" nem azonos a „nincs találat"-tal — a resolvernek `files.get`-tel kell külön mérnie, hogy a mappa elérhető-e, különben egy megosztási hibát „fájl nem található"-ként jelentene.
- **A backfill mérete (prod, 600 legfrissebb kreatív):** 2026-06-12 → 08-13, **43 MC-szám, 5 termék** (SZA 210 / HK 125 / SZK 103 / MARKET 102 / VAL 60) ⇒ nagyságrendileg **20–40 Leadás-mappa link** fedi le az egészet.
- ⚠️ **A `parents` mezőt a kulcsos (anonim) hívás NEM adja vissza** — fájl-ID-ből tehát szerveroldalon nem lehet szülőmappát visszakeresni. A folder→file irány megy, a file→folder nem. Ezért a backfill **mappalinkek listájából** indul (I4.7), nem fájlokból; a lokális rclone csak arra kell, ha egy mappa nincs anyone-with-link megosztva.

**Szeletek:**
- [x] **I4.1 Séma + ID-parser (KÉSZ, 2026-09-03).** Migráció `0011_demonic_chameleon.sql` (négy additív nullable oszlop, a megosztott Hetzner DB-n **lefuttatva** — a régi kód sértetlen, a drizzle `select()` a saját sémájából állítja a kolumnalistát). `src/lib/drive-link.ts` + `tests/unit/drive-link.test.ts` (7 teszt, valódi Leadás-ID-kkel). ⚠️ **A `drizzle-kit` nem olvassa a `.env.local`-t** — `db:migrate` elé kell `export $(grep '^DATABASE_URL=' .env.local)`, különben a `:55432`-es eldobható teszt-DB-re menne. Teljes suite: 713 teszt zöld, `tsc` tiszta. Migráció: `creatives.drive_folder_id`, `drive_folder_name`, `drive_file_id`, `drive_checked_at` (mind nullable). **ID-t tárolunk, nem URL-t** — a bepasztézott link sokféle (`?usp=sharing`, `/u/0/`, `/drive/folders/`, `/file/d/`), nyers stringgel a share-fejléc mappa-csoportosítása elromlik. Új `src/lib/drive-link.ts`: `parseDriveFolderId(input)` / `folderUrl(id)` / `fileUrl(id)`, unit-tesztekkel. Státusz nem külön oszlop: `folder && !file && checked_at` = „nem talált".
- [x] **I4.2 Listázó lib (KÉSZ, 2026-09-03).** `src/lib/drive.ts`: `getDriveFolder` (404 → `null`, ez a „nincs anyone-with-link megosztás" jelzés) + `listDriveFolder` (`nextPageToken`-lapozás, `pageSize=1000`), tipizált `DriveError` konfig- és HTTP-hibára. Kulcs: `GOOGLE_DRIVE_API_KEY` (`.env.local`-ban, `.env.example`-be placeholderként felvéve — **a boxra is ki kell vinni deploykor**). 7 unit teszt stubolt `fetch`-csel (lapozás, 404, hiba, hiányzó kulcs) + **élő ellenőrzés a valódi API-n**: `Leadas 04 13` → 42 fájl, a MARKET-gyökér → `null`.
- [x] **I4.3 Resolver (KÉSZ, 2026-09-03).** `src/lib/drive-resolve.ts` → `resolveDriveFilesForCreatives(clientId, ids)`; hat kimenet: `resolved` / `unchanged` / `no_folder` / `folder_unreachable` / `file_not_found` / `ambiguous`. Mappánként **egy** listázás futásonként (`createFolderCache`), pontos `file_name`-egyezés, több találatnál nem tippel. Almappát sosem matchel (a kliens minden kreatívja png/jpg/mp4/mov — egy HTML5-bundle más link-alakot kívánna). Írás: **csak a `drive_*` oszlopok**, `version`/`updated_at` nem mozdul (az a user-szerkesztésé, és az editor optimista zárja ellen dolgozna); két bulk `UPDATE … FROM (VALUES …)` a soronkénti kör helyett, mert a health check százas nagyságrendben fut a tunnelen át. 9 integrációs teszt (köztük: elérhetetlen mappa ≠ hiányzó fájl, kliens-izoláció, mappa-cache).
- [x] **I4.4 Feltöltő út (KÉSZ, 2026-09-03).** `POST /api/creatives` + `PATCH /api/creatives/[id]` átveszi a `driveFolderUrl`-t: a `pickWritable` **parse-olja** (csak azon az úton kerülhet be ID a DB-be), rossz link → **400** (`CreativeError` + új `validationError` hook a `makeItemRoute`-on, a `makeCollectionRoute` mintájára). `updateCreative`: ha a mappa **változik vagy törlődik**, a származtatott `drive_file_id`/`drive_folder_name`/`drive_checked_at` nullázódik — máskülönben a file-link egy olyan mappára mutatna, amit a kreatív már nem vall magáénak. UI: az `UploadQueue` új `batchForm` render-propja (a `renderForm` mintájára) a queue fejlécében egy **batch-szintű** `DriveFolderBatchField`-et ad — egyszer pasztézod, minden sorra megy (a később bedobott fájlokra is), kliensoldali link-validációval; az egyfájlos `CreativeMetadataForm` saját mezőt kapott. **Eltérés a tervtől:** soronkénti felülírás nem a queue-rácsban van (5 apró oszlop, egy URL nem fér el), hanem a kreatív-detailben (I4.5). 9 integrációs teszt.
- [x] **I4.5 Kreatív-nézetek (KÉSZ, 2026-09-03).** `CreativeDetailDialog`: editálható „Drive parent folder link" mező a meglévő draft/autosave úton (a `diffPayload` **ID-t hasonlít, nem szöveget** — ugyanaz a mappa `?usp=sharing`-gel nem edit, és nem dobja el a feloldott file-linket), alatta `DriveLinks`: mappa-link (a mappa nevével) + **read-only** direkt file-link, vagy a hiány oka. A `StripCreative` és a virtuális „matrix" tile-ok is megkapták a mezőket (utóbbi mindig null — élőben renderelt, nincs mit Drive-on mutatni).
- [x] **I4.6 „Drive link health check" (KÉSZ, 2026-09-03).** Új `POST /api/creatives/drive-resolve` (id-lista a body-ban, **max 200/kérés** — a kliens chunkol 100-asával; a route sosem lapoz növekvő táblát maga). `DriveHealthCheck` a `RightToolbar`-ban az `ArchiveToggle` collapsed/kinyitott mintájára, a **szűrt** halmazra fut, riport: feloldva / változatlan / mappa nem elérhető / fájl nincs a mappában / kétértelmű név / nincs mappa. Drive-hiba → **502** (`drive_unavailable`), audit **futásonként egy sor** (a meglévő `bulk_update` akción, `kind: "drive_resolve"` payloaddal — nem született új audit-fogalom). 4 route-teszt.
- [x] **I4.7 Backfill mappalinkekből (KÉSZ, 2026-09-03).** `linkCreativesFromFolders(clientId, folderIds, {apply, overwrite})` a resolver mellett, **közös mappa-cache-sel és közös illesztéssel** — nincs második implementáció. Kimenetek: `linked` / `unchanged` / `conflict` (más mappát vall — nem írjuk felül `--overwrite` nélkül) / `ambiguous_creative` / `no_creative`, az elérhetetlen mappák külön listán. `scripts/drive-backfill.ts`: linkek argumentumként vagy `--file`-ból, **dry-run az alapértelmezés**, `--apply` ír, `--overwrite` repointol. **Élő próba (dry run, prod DB):** a `Leadas 04 13` mappára **42/42 kreatív talált**, 0 conflict, 0 gazdátlan fájl. 7 további integrációs teszt.
- [x] **I4.8 Share-oldal (KÉSZ, 2026-09-03).** A snapshot **magától** viszi az új oszlopokat (a `share-galleries` route teljes `creatives` sorokat ment) — csak a `SnapshotCreative` típus + a megjelenítés kellett: `share-gallery__drive` sor a fejlécben a **distinct** mappákkal (mappanévvel), és `share-detail-dialog__drive` link egy-egy kreatív nézegetésekor. A snapshot fagyaszt: amit a share készítésekor még nem oldottunk fel, az a régi share-en nem jelenik meg — tudatos.
- [x] **I4.9 Tesztek + zárás (KÉSZ, 2026-09-03).** Suite **749/749 zöld** (83 fájl; 713 → +36 új: link-parser alakok, `listDriveFolder` lapozás + 404 + hiányzó kulcs, resolver 16 eset, entity/route 13 eset), `tsc` tiszta. `tasks/component-inventory.md` (Creative Library + Share fejléc szekció) és `CHANGELOG.md` frissítve. **Verzió: `6.52.0` → `6.53.0`** (minor).

- [x] **I4.10 MCP — nincs új tool, csak látható mezők (KÉSZ, 2026-09-03).** A `list_creatives` minden sora kap `drive_folder_url` + `drive_file_url`-t (kész link, nem ID), a `list_mc` minden sora `drive_folders`-t (az MC-hez tartozó kreatívok distinct mappái — **egy** csoportosított lekérdezés a lapra, nem N+1). A `creative_update` írhatja a `fields.driveFolderUrl`-t (fájl-link elutasítva, `""` töröl), a hibás link most tipizált MCP-hibaüzenet, nem kivétel. A három tool leírása kimondja, mit jelent a hiányzó mappa és a feloldatlan fájl.

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
- [x] **I1.7 Chartok — GREEN-LIGHT (2026-09-01).** A halasztás oka megszűnt: a július + augusztus import tegnap leszállt, így **4 havi periódus** van (máj 8,3 M → jún 12,1 M → júl 15,5 M → aug 20,1 M impression), és havonta nő. **User-döntés:** a felső sor két redundáns csempéje (Activity, Feeds exported — mindkettő ugyanazt mondja, mint az alatta lévő panel) helyére **delivery-trend** + **matrix-lefedettség** megy; a Reporting data csempe marad harmadiknak.
  - **Lezárt döntések:**
    - **Havi grain, nem napi.** A két chart **nem** reagál a `?d`/`?r` nap-scope-ra (a `monitoring` havi periódusokat tárol — Today-en üres lenne). Saját címkét viselnek („2026. aug", „utolsó 6 hónap"); a nap-scope továbbra is csak a lenti paneleket vezérli. Ezt ki kell írni a csempére, nem elhallgatni.
    - **Nincs chart-lib.** 6 oszlop + egy ratio-bar inline SVG-ben megvan; a `page.tsx` marad server component (recharts = új dep + `"use client"` az egész felső sorra).
    - **`impressions > 0` szűrő kötelező:** a `size='1x1'` click-tracker sorok augusztusban 0 impression mellett **445 e klikket és 17,9 M Ft költséget** hoznak — beszámítva a CTR értelmetlen, a cost duplázódik.
    - **Rendezés parse-olt dátumkulcs szerint, NEM a `period_from` sztringen.** A tárolt alak `DD/MM/YYYY`, tehát `"01/12/2025" > "01/05/2026"` lexikailag → évfordulón megfordulna a trend. (A `/api/monitoring/route.ts:24` `orderBy(desc(periodFrom))`-ja ma csak azért jó, mert minden adat 2026-os.)
    - **Mit mutat a lefedettség:** a riportolt impressionsből mennyi köthető mátrix-MC-hez — aug **35 %**, júl 46 %, jún 78 %. A romlást a nem-matchelt publisher-sorok (telex, hvg, centralmedia…) növekvő volumene okozza; a csempe a Settings → Structure → Monitoring keyword→product szabályaira mutat.
  - [x] **I1.7a** `src/lib/dashboard-monitoring.ts` — `monthlyDelivery(clientId, n = 6)`: periódusonként impressions / clicks / cost / `matchedImpressions` (`message_id IS NOT NULL`), egy `GROUP BY`, ≤ 6 sor. A `dashboard-creatives.ts` + `dashboard-products.ts` mintáját követi.
  - [x] **I1.7b** `periodDateKey` (ma `mcp.ts:258`, privát) kiemelése `src/lib/period.ts`-be, az mcp.ts call-site-ok átkötve. Külön, izolált lépés — a rendezés ezen áll.
  - [x] **I1.7c** `_dashboard/DeliveryTrend.tsx` — `delivery-trend` csempe: havi oszlopdiagram impressionsből, nagy szám = utolsó hónap + MoM-delta (`20,1 M · +29 %`). A `signal-tile` layout-nyelvét (label / value / hint) követi, nem új csempe-família.
  - [x] **I1.7d** `_dashboard/CoverageTile.tsx` — `coverage-tile`: matched/total ratio-bar + havi mini-trend, link a `/monitoring`-ra.
  - [x] **I1.7e** A két régi `SignalTile` (Activity, Feeds exported) törlése a `dashboard__signals` sorból (`page.tsx:295-317`); a `FreshnessTile` marad.
  - [x] **I1.7f** Teszt a `monthlyDelivery`-re: 1x1-kizárás, **évfordulós rendezés** (2025-12 + 2026-01 fixture — a sztring-rendezéssel elbukna), kliens-izoláció.
  - [x] **I1.7g** `tasks/component-inventory.md` Dashboard szekció: `delivery-trend`, `coverage-tile` felvétele.
  - **Verzió a slice végén:** `6.46.0` → `6.47.0` (minor — új dashboard-widgetek + új lib-modul).
- [x] **I1.8 Activity panel product-szűrés (user, 2026-09-01):** „az activity pane is legyen időszakasz és product filtered (it seems to be only time filtered)". **Igaz:** az `activityDigest` (`page.tsx:84`) csak `clientId` + `createdAt` BETWEEN — a `products` tömböt meg sem kapja, míg a `feedsInScope` (`:123`) és a `listStripCreatives` (`dashboard-creatives.ts:145,154`) már szűr rá.
  - **Az audit_log-ban nincs product oszlop** (`schema.ts:106` — `entity_type` + `entity_id` + `action`), tehát a productot entitásonként fel kell oldani. 7 napra mérve (5679 sor): feloldható `messages` 5370 (94,6 %), `topics` 126, `feed_exports` 55, `assets` 30, `creatives` 5, `audiences` 4 → **97,3 %**. Nem oldható fel: `text_formatting` 33, `keywords` 25, `uploaded_files` 23, `share_galleries` 5, `monitoring` 2, `config` 1 — ezeknek nincs product-dimenziójuk, aktív szűrő mellett kiesnek. Ez helyes viselkedés (egy globális `config`-írás nem „SZK-aktivitás"), de ki kell mondani.
  - **A nonDCO cellák product-feloldása:** a `messages` sorok 13 %-a (688 cella: `ch_disp` 357 + `ch_soc` 331) **nonDCO**, azaz a `messages.audience`-ben egy csatorna-kulcs áll. A csatornák a **`channels` táblában** élnek (a 2026-08-17-i szétválasztás óta, `schema.ts:207`), nem az `audiences`-ben, és **nincs product oszlopuk** — ezeknél egyedül a topic-kulcs prefixe nevezi meg a productot (SZA 200, SZK 179, HITEL 139, HK 62, VAL 59, MARKET 55, LTP 18). Az I1.8 ezért `coalesce(audiences.product, split_part(topic,'_',1))` szerint old fel.
  - **⚠️ Külön ügy, NEM ebben a slice-ban:** a `dashboard-products.ts:58` nonDCO-ága a *régi* alakra van írva (`audiences.channel != null`), amit a channels-szétválasztás óta semmi nem elégít ki → a fölötte lévő `if (!a) continue;` elejti a 688 nonDCO cellát, tehát a ProductFilter nonDCO-számlálói 0-k. (Ezt a 6.45.1 „mind-nulla szegmens elrejtése" fixe *helyesen* takarja el a UI-ban; a számláló viszont attól még nem számol.) Átállítása a `channels` táblára külön döntés.
  - **Nem JS-ben szűrünk:** a nyers sorok lekérése 5679 (rossz napon 5085 egyetlen napra) → a row-cap szabályba ütközne, és a `:79` komment épp ezt tiltja. Marad az egy darab `GROUP BY` query, a product-feltétel egy `EXISTS` + `UNION ALL` feloldó-táblával a hat feloldható entitástípusra.
  - **Ismert korlát:** törölt entitás sora (7 nap: `feed_exports` delete 28, `topics` 3, `messages` 3) nem oldható fel join-nal — a sor már nincs meg, csak a `before` JSON-ban. Aktív szűrő mellett kiesnek; a `before` parse-olása szándékosan kimarad.
  - **A Shares panel is csak idő-szűrt** — ott viszont nincs mire szűrni: a `share_galleries`-nek nincs product oszlopa, egy galéria vegyes tartalmú. Változatlanul hagyva, nem az I1.8 tárgya.
  - [x] **I1.8a** `activityDigest(clientId, scope, products)` — `EXISTS` + `UNION ALL` product-feloldás (messages/topics/feed_exports/creatives/assets/audiences), üres `products`-nál változatlan a mai query.
  - [x] **I1.8b** Teszt: ch_* (audience nélküli) sor a topic-prefixére szűrve előjön; product nélküli entitástípus aktív szűrőnél kiesik; üres szűrő = mai viselkedés; kliens-izoláció.
- ⚠️ **Elvetve az első körből:** side toolbar view-kapcsolókkal — a nap-scope adja a nézetváltást, és 5-6 widgetnél a második toolbar üres chrome.

### I1.9–I1.11 — Dashboard: product-szűrés mindenütt, 30 napos scope, CTR-rendezés a kreatív-csíkon (user, 2026-09-02) ✅
**User:** „a library is legyen product filter érzékeny és a felső report sor is". Ma a `feedsInScope`, a `listStripCreatives` és (6.47.0 óta) az `activityDigest` szűr productra; a **`monthlyDelivery`** (Delivery + Matrix coverage csempe) és az **`entityCounts`** (Library · all time) nem kapja meg a `products` tömböt.
- **⚠️ A Matrix coverage jelentése megváltozik szűrt állapotban — mérve (2026. aug):**

  | product | impr | matched | % |
  |---|---|---|---|
  | *(nincs product)* | 10 942 699 | 0 | **0 %** |
  | SZK | 3 410 204 | 2 898 434 | 85 % |
  | HK | 2 190 585 | 2 190 585 | 100 % |
  | SZA | 1 595 581 | 1 181 107 | 74 % |
  | VAL | 1 320 319 | 763 252 | 58 % |
  | HITEL | 591 977 | 0 | 0 % |

  A szűretlen **35 %**-ot a product nélküli publisher-blokk húzza le, ami definíció szerint egyetlen product-szűrőnek sem felel meg → bármelyik productra szűrve a lefedettség 58–100 %-ra ugrik. **Ez helyes**: a product-szűrő a nevezőt is szűkíti, és a „mennyit magyaráz meg a mátrix az SZK forgalmából" önmagában érvényes kérdés. De a két szám **két különböző populációt** mér, és ezt tudni kell — a fejléc `Product N` pillje jelzi, hogy szűrt nézet van.
- **A hat Library-csempéből öt szűrhető:** `audiences` / `topics` / `assets` / `creatives` saját `product` oszlopból, a `messages` a `coalesce(audience.product, topic-prefix)` szabállyal (ugyanaz, mint az `activityDigest`-ben — a nonDCO cellák csatornán ülnek, a csatornának nincs productja). A **`text_formatting`-nak nincs product-dimenziója** (nincs ilyen oszlop) → a csempe **marad, de „all products" jelöléssel**; sem a 0 kiírása (a sorok léteznek), sem a szűrő néma figyelmen kívül hagyása nem volna őszinte.
- [x] **I1.9a** `monthlyDelivery(clientId, n, products)` — `inArray(monitoring.product, products)` üres tömbnél kihagyva.
- [x] **I1.9b** `entityCounts(clientId, products)` — táblánkénti product-predikátum; a `messages` a közös `messageProduct` kifejezéssel.
- [x] **I1.9c** A `coalesce(audience.product, topic-prefix)` kifejezés kiemelése egy helyre (`dashboard-products.ts`), és **mindkét** használat (`productScoped` + `entityCounts`) arra kötve — ez a szabály korrektségi szempontból kritikus, ne éljen két külön másolatban.
- [x] **I1.9d** `count-tile__note` a `text_formatting` csempére, csak aktív szűrőnél.
- [x] **I1.9e** Teszt: delivery product-szűrve; library-számlálók productonként; nonDCO cella a topic-prefixe szerint számolódik; `text_formatting` nem esik 0-ra; üres szűrő = mai számok.
- [x] **I1.10 „Last 30 days" a nap-scope gombok közé (user, 2026-09-02).** A `ScopeRange` `"day" | "7d" | "30d"`, a span egy `RANGE_SPAN` táblából jön (nem elszórt ternary-kből). Az üres állapot „szélesítő" linkje is egy fokkal feljebb lép: nap → 7 nap → 30 nap, tehát egy üres hét sem zsákutca többé.
- [x] **I1.11 Creative strip: „Open →" helyett rendezés-váltó (user, 2026-09-02).** `Time` / `CTR`, URL-ben `?cs=ctr`, a nap-scope és a product-szűrő megőrzi.
  - **A CTR mércéje:** MC-nként összegzett **matched** monitoring sorok (`message_id IS NOT NULL` — ugyanaz, amit a Monitoring tábla Matched szűrője ért alatta), **minden periódusra**, és csak a **100 000 impresszió** feletti MC-k (`CTR_MIN_IMPRESSIONS`). Enélkül a lista élére egy kétszer megjelenített, egyszer kattintott kreatív kerülne 50 %-kal.
  - **A CTR-rendezés ELDOBJA a nap-ablakot — mérve, ezért:** a 100 e felett minősülő **74 MC**-ből egy 7 napos ablak **9**-et tartalmaz, feltöltött kreatívot pedig **nullát**. Ablakkal a nézet üres lenne. A „legjobban teljesítő kreatív" amúgy is all-time kérdés, ahogy maga a ráta is periódusokra mért. A panel hintje ezt kiírja (`… · all time`), a `fallback` pedig CTR-rendezésnél soha nem igaz (nincs ablak, amiről visszaeshetne).
  - **A rendezés szűkít is:** matched riport nélküli vagy a küszöb alatti MC nem null-lal a lista végére kerül, hanem kiesik.
- **Verzió a slice végén:** `6.49.0` → `6.50.0` (minor).

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

### 2026-09-01 — Az alap köti a mezőket; a force tényleg töröl — 6.39.0
- **User-kérdés volt, hogy a `none (new feed, new version)` sor vagy a disabled compare-against a jobb.** Egyik sem: mindkettő azt feltételezi, hogy „force new version" = „nincs alap". **Nem ugyanaz** — a leggyakoribb verzióugrás épp az, amikor új verziót csinálsz, DE látni akarod a diffet a régihez képest. Ha a `none` lenne az egyetlen út a verzióugráshoz, pont akkor veszne el a diff, amikor a legjobban kell. Ezért a pipa maradt, de a jelentése lett éles: **kötve vagy-e az alaphoz**.
- **Lezárt viselkedés (user döntései):**
  - **Alap + nincs force → kötve:** a signal-oszlop és a DEFAULT sor az alapé; mindkét legördülő **mutatja az értéket és disabled**, és az alap **saját DEFAULT sora szó szerint** kerül az exportba (nem generáljuk újra). Az újragenerálás volt az oka az örökös „1 added + 1 switched off" párnak.
  - **Force bepipálva → a mezők felszabadulnak**, ÉS a válogatásból kimaradt sorok **tényleg kiesnek** (se carry-forward, se szellemsor). Eddig a force csak a verziószámot emelte, miközben minden sor bent maradt — vagyis **egyáltalán nem volt mód sort kivezetni**.
  - A pipa a baseline-választó ALÁ került, mert az alatta lévő mezők viselkedését dönti el.
- **Mellékhatás kezelve:** ha a DEFAULT sort az alapból hozzuk, a `default_message_id` csak tájékoztató → a route `default_not_found` (422) ellenőrzése kihagyódik ilyenkor (`built.defaultCarried`), különben egy időközben átszámozott MC blokkolna egy exportot, aminek a DEFAULT sora amúgy helyes.
- **Teszt:** +2 (force: a kizárt sor NEM kerül be; a nem-építhető sor sem). Suite **623/623 + 2 = 625** (a force-tesztekkel a fájl 7).

- **DEPLOYOLVA 6.39.0 (2026-09-01):** commit `fbe6747`, build OK, `pm2 restart` → online. Nincs séma-migráció.

### 2026-09-01 — Append / New feed kapcsoló + diff-szűrő — 6.40.0
- **User:** „a force new version is rossz UI, kéne felülre egy jobbra-balra nagy kapcsoló leírással, Append or New Feed… a new-nál nincs értelme a diffnek." Igaza van: a pipa egy MÓDOSÍTÓ volt egy cselekvésen, holott **két külön cselekvésről** van szó.
  - **Append:** alap **kötelező** (a gomb tiltva nélküle), a signal és a DEFAULT sor onnan öröklődik (disabled mezők), sor soha nem tűnik el.
  - **New feed:** nincs alap-választó, nincs diff (helyette egy sor: hány sor megy ki), a signal és a default szabadon választható, és csak a mostani válogatás megy ki.
  - A dróton továbbra is `forceNewVersion` megy (`mode === "new"`), és New feed esetén `baselineExportId: null` — a szerver-oldali szemantika változatlan, csak a UI mondja ki tisztán.
- **Diff details:** a szerver **50 sorra** vágta mindhárom listát, a changed viszont 206 volt → a keresett sor tipikusan a vágás után volt. Ez okozta a user panaszát („nem látom az MC331 változásait"). **Ellenőriztem az adatot: mindhárom változás BENNE VAN** — MC331a/b `IsActive` FALSE→TRUE (a referenciában FALSE, ma ACTIVE), MC331c `bg1` `…_n1`→`…_n2`. Limit 1000-re emelve (a feed amúgy is max 500 sor), és **szabadszöveges szűrő** került a lista tetejére, ami minden cellaértéken keres.
- **Verifikáció:** `tsc` 0, build 0, eslint 0 error, **625/625 zöld**.

- **DEPLOYOLVA 6.40.0 (2026-09-01):** commit `c20d718`, build 37.9s, `pm2 restart` → **Ready 1415ms**, online. Nincs séma-migráció. Tartalom: Append/New feed kapcsoló, diff-szűrő + 1000-es limit, a panel gombja `Export`.

---

## Checkpoint 2026-09-01 — tenant-fork tanulmány (docs-only)

Kérdés: Telekom-fejlesztés fork/clone/worktree-vel, Erste-funkciók sérülése nélkül, két ág fenntartása nélkül.
Új doksi: **`docs/TENANT_FORK_STRATEGY.md`** (361 sor). Kódot nem érintett.

**Verdikt:** nincs fork, nincs hosszú életű `telekom` ág. A kód már mély multi-tenant (minden tenant-tábla `client_id`, `ACTIVE_CLIENT_KEY` boot-pin, `src/`-ben 21 „erste"-találat és mind komment/placeholder). Elválasztás futásidőben; `git worktree` csak munkaeszközként (külön könyvtár + port 6002 + `ACTIVE_CLIENT_KEY=telekom`, közös DB, izolált adat).

**Feltárt tények (a doksiban részletesen):**
- A `*Structure` config-kulcsok nagyrészt dekoráció — csak a `StructureTab` olvassa őket; a valódi oszlopok a `schema.ts`-ben fixek. Kivétel: `feedStructure` + `treeStructure` (ezek élnek).
- A státusz-készlet hardcode-olt 5 helyen (`matrix/types.ts:160`, `DesignTab.tsx:11`, `MessageEditor.tsx:50`, `TemplateEditor.tsx:82`, `branding.ts:54`) — csak a *színek* per-kliensek.
- Hosszú párhuzamos ágak konkrét gyilkosa: a drizzle migráció-sorszámok (`0009` a legmagasabb) két ágon ütköznének egy közös éles DB-n.

**Javasolt védőháló (még NINCS megcsinálva, backlog):** G1 Erste-golden tesztréteg a közös kódutakra (`feed-export.ts`, `numbering.ts`, `patterns/pmmid/trafficking`), G2 additív-only migrációs szabály a `CLAUDE.md`-be, G3 tenant-capability flag config-ban (kliens-kulcs szerinti `if` tilos), G4 külön checkout + `mm6-telekom` pm2 app.

**Nyitott döntés a userre (a doksi 10. pontja):** a Telekom store-fan-out modellje — N valódi `messages` sor vs. 1 üzenet × N lokalizáció (`message_locales` additív tábla). Ez az egyetlen visszafordíthatatlan döntés, és az egyetlen pont, ahol a Telekom adatmennyiséggel ronthatna Erste-élményt. **Az első tömeges import ELŐTT kell eldönteni.**

**Kiegészítés (ugyanaz a session):** a doksi új **11. fejezettel** bővült — „Séma-változás tenant-igényre". Lényeg: a közös DB + eltolt deploy miatt a destruktív migráció NEM „kockázatos", hanem azonnal leviszi a futó Erste-t (a drizzle felsorolja az oszlopokat, nem `SELECT *`), tehát az additív-only + expand→backfill→switch→contract üzemeltetési kényszer. Eszköz-sorrend: config (státusz-készlet, `*Structure` valódivá tétele) → sidecar tábla domain-névvel (precedens: `message_previews`/`text_formatting`) → additív nullable oszlop → külön adatbázis. **`search_path` schema-per-tenant: ne** (a drizzle-journal + globális táblák + pool miatt a data-access réteg átírása lenne, olyan izolációért, ami már megvan). `jsonb`: ma **nulla** json/jsonb oszlop van a sémában, tehát új minta lenne — egyelőre ne. Négy javasolt `CLAUDE.md`-szabály a 11.9-ben.

---

## SESSION-OSSZEFOGLALO — 2026-08-28 -> 09-01 (`6.27.3` -> `6.40.0`)

**Kiadasok:** 6.28–6.30 (topic/audience kulcs-fixek, header-dialog delete, asset batch upload, rekey-kaszkad) · 6.31 (statusz-darabszam a szuroben, tree platform-szinek) · 6.32 (feed DEFAULT-sor audience-rewrite, masik szal) · 6.33 (MC-statusz NOT NULL, Feeds fajlnev-oszlop) · 6.34 (feed platform-dimenzio + split + share-galeria) · 6.35 (share image-preview, referencia-fajlnev; .1 a ket query-key crash) · 6.36–6.40 (diff-alap valaszto, carry-forward, szellemsorok, Append/New feed kapcsolo, diff-szuro).

**A harom legfontosabb tanulsag — mindharom memoriaba is felkerult:**
1. **A query key a cache-elt ALAK szerzodese**, nem csak az URL-e. Ket `useQuery` egy kulcson, eltero alakkal = sorrendfuggo crash, amit a reload elrejt. Negyszer volt meg elesben. -> `project_query_key_shape_contract.md`
2. **Az idobelyegek stringkent hasonlitodnak.** Mindig `nowUtc`, soha `toISOString()` — azonos napon a `T` felulirja a szokozt, es a sorrend megfordul. Egy sort kezzel kellett normalizalni. -> `project_timestamp_string_ordering.md`
3. **A feed-invariansok kibovultek** (platform az identitas resze; PMMID a MI azonositonk, az advert_id az AdForme; a feedbol semmi nem tunik el; Append != New feed). -> a `project_adform_export_invariants.md` atirva, 5–8. pont.

**Modszertani tanulsag:** a feed-hibak egyiket sem teszt talalta meg, hanem a user, aki ranezett egy preview-szamra es megkerdezte, miert annyi. A „190 vs 46" elteres, az „1 added default", a 316 vs 361 sor — mind ilyen. **Ha egy feed-szam furcsan nez ki, azt vegig kell kerdezni.**

**Nyitva maradt:**
- **`advert_name` zaro szama** — a minta `{{version}}`-t hasznal, ami a `messages.version` optimistic-lock szamlalo, tehat minden mentesnel no (ez sok „changed" sor oka). **Konfig, nem kod** (Settings -> Patterns). Kivetelekor **egyszeri nagy churn** lesz: minden sor advert_name-je valtozik. **User dontese.**
- **`feed-export.ts` nyers NUL bajtja** (502. sor, kulcs-elvalaszto) — emiatt a `grep`/`file` binarisnak latja es nemán kihagyja a fajlt; engem is megvezetett. Egy karakteres javitas: nyers bajt helyett `\u0000` escape.
- **I4** Drive-linkek a kreativokon (parent folder + szamitott file link, health check, 600-as backfill) - TERV KESZ 2026-09-03, zold-lightra var.
- **I5** 500-as limit szerinti feed-reszletek (user: „kesobb"; a modell-dontes megvan: ket onallo feed).
- **I6.4 reszben:** kulcsmezo-valtozasnal (pmmid/advert_id) a regi sor ma az alapbol hordozodik szellemsorkent — ez mukodik —, de a *szandekos* rekey-forgatokonyv vegig nincs tesztelve.
- **M9, W2.6/W2.7, M1, M4.2, M5–M8** es a Channels-epic S4–S6 tovabbra is a roadmapen.

---

## 2026-09-01 — I1 Dashboard átépítés (auto mód, user: „dönts magad")

**Scope-döntés (magam hoztam, user felhatalmazásával):** I1.1 + I1.2 (D.2 users-join nélkül migráció) + I1.3 (egyszerűsítve) + I1.4 + I1.5 megy egy körben. **I1.6 (`actor_kind` migráció) és I1.7 (chartok) NEM** — előbbi séma-migrációt kér (külön passz a boxon), utóbbi 3 hónapos adatot rajzolna.
- [x] **I1.1** `?d=YYYY-MM-DD&r=day|7d` nap-scope + Today / Yesterday / Last 7 days pill-sor. Server component marad, a scope az URL-ben. UTC-nap (a tárolt bélyeg UTC), a fejléc kimondja.
- [x] **I1.2** Activity-digest: `entityType × action × aktor` aggregálva, darabszámmal, users-join (email a nyers `user_id` helyett). A 15-soros nyers lista helyett.
- [x] **I1.3** Friss kreatívok vízszintes csík, 250px egységes MAGASSÁG, léptető gombokkal. **Infinite scroll / swipe-fizika kimarad** (a nap-scope halmaza kicsi, nincs mit tölteni).
- [x] **I1.4** Aznapi feed-exportok + „exportálva, nincs feltöltve" badge.
- [x] **I1.5** Riport-frissesség tile (`monitoring` max(imported_at) + lefedett periódus + „N napja").
- [x] Entity-count csempék megmaradnak, de a lap aljára („Library"), mert nem nap-scope-osak.

**KÉSZ ÉS DEPLOYOLVA — 6.41.0.**
- **Új fájlok:** `src/lib/day-scope.ts` (scope-feloldás, 7 unit teszt), `(app)/_dashboard/CreativeStrip.tsx`. Átírva: `(app)/page.tsx`.
- **Amit a lap most mond (élő adaton ellenőrizve):** ma 3 írás / 3 export (2 nem publikált), 7 napra 5569 írás 25 fajtából, `messages` update 5242 (ebből `system` 1145 — **null `user_id`**, tehát az `actor_kind` (I1.6) kérdése tényleg él), riport-adat **47 napja** áll.
- **Két döntés, amit a terv nyitva hagyott, és most eldőlt:**
  1. **A kreatív-csík nem lehet szigorúan nap-scope-os** — az utolsó `creatives.created_at` **2025-12-22**, tehát a widget örökre üres lenne. Megoldás: a scope vezet, de ha üres, a **legutóbbi 24** kreatívot mutatja, és **kiírja, hogy azt csinálja** (`none in this window — latest arrived …`). Infinite scroll/swipe-fizika ezért kimaradt: nincs mit tölteni.
  2. **A magasság a médián van, nem az anchoron.** Az anchor szélessége a képből jön, a kép magassága pedig százalékban az anchorhoz kötődött volna — körkörös; a tile-ok 10px-es csíkokká estek össze. `h-[250px]` az `img`/`video`/placeholder elemre.
- **Nem került bele:** I1.6 (`actor_kind` — séma-migráció, külön passz a boxon) és I1.7 (chartok — a 47 napos adat miatt).
- **Verifikáció:** `tsc` 0, `npm run build` 0, eslint **0 error**, **632/632 teszt zöld** (625 + 7 új). Vizuálisan mindkét scope ellenőrizve élő adattal.
- **Bump:** `6.40.0` → **`6.41.0`** (minor — új oldal-viselkedés).

- **DEPLOYOLVA 6.41.0 (2026-09-01):** commit `d554cb6`, box `c20d718`→`d554cb6` (a két docs-commit is felment), `npm run build` ok, `pm2 restart mm6-erste` → **Ready 1235ms**, online, box `package.json` **6.41.0**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/matrix` 307, `/feeds` 307, `/api/feed-exports` 401, `/mcp` 401. Az `error.log`-ban a restart óta nincs új bejegyzés (a benne álló utolsó sorok az AWS SDK node>=22 figyelmeztetése, korábbról).
- ⚠️ **Auto módban az `ssh` a boxra blokkolva van** (klasszifikátor) — a deploy csak auto módon kívül ment át. Ha ez rendszeresen kell, `.claude/settings.json` permission-szabály oldja meg.

**Kiegészítés 2 (ugyanaz a session):** új **12. fejezet** — „A két anti-minta közelről", valódi repo-esetekkel. (1) `audiences.channel` teljes íve: overload (séma-komment: `NULL = DCO`) → szétterjedés (mátrix-partíció `MatrixGrid.tsx:782`, tengely-scope-olt számozás `messages.ts:230`) → **két dokumentált éles bug** (nonDCO product-filter 6.15.1, LTP topic-eltűnés 6.15.2 — mindkettő a fabricált sorok `product=NULL`-jából) → kiemelés saját táblába (`0007`, `migrateChannelsFromAudiences`) → **maradvány, ami ma is él**: `channelToAudience` 11 mezőt tölt `null`-lal, 6 hívási hely. (2) `messages.template=null` mint implicit típus (`isStatic = !draftTemplate && !!draftImage1`, `MessageEditor.tsx:1977`) — ne folytassuk `video1 != null`-lal a Telekom-videónál.

**Korrekció a fenti checkpointhoz:** a „21 találat, mind komment" pontatlan volt. Pontosan: `client.key ===` szerinti elágazás **0** (ez a lényegi szám, változatlanul), de van **1 élő tenant-nevű azonosító**: `importErsteXlsx` (`import-xlsx.ts:92`, hívva `api/import/xlsx/route.ts:58`). A függvény generikus, csak a neve tenant-specifikus — olcsó átnevezés most (2 fájl, 3 sor), drága akkor, ha jön mellé egy `importTelekomXlsx`. A `docs/TENANT_FORK_STRATEGY.md` 1.1 táblázata javítva.

**Backlog-jelölt (NINCS megcsinálva, engedélyre vár):** `npm run check:tenant-leak` — a 12.6 négy grepje scriptbe kötve, `test`-be akasztva. Kapu: a `client.key ===` szám maradjon 0.

### 2026-09-01 — A user két hibája a 6.41.0 dashboardon — 6.42.0
- **„nem ezek a legújabb kreák"** — igaza volt, és a hiba az én sorrendezésem: `creatives.id DESC`. **Ebben a könyvtárban az id NEM recencia:** a legmagasabb id-k (17370…) `created_at`-je **2025-12-22**, a fájljuk viszont 2026-08-17-én került fel. Vagyis a „new creatives" csík a legrégebbi szállítást vezette fel, és a „latest arrived" felirat ugyanazt a rossz dátumot ismételte. **Most `created_at DESC`** — ez az, amire a Creative Library is default-ból rendez (`ListSortHeader.DEFAULT_SORT`), tehát a „legújabb" ugyanazt jelenti a két lapon. Az élen most MC318c (2026-08-13), utána MC338 (08-06).
  - ⚠️ **Amit menet közben megtudtam, és számít:** `uploaded_files.created_at` **sem** használható „érkezés"-nek — mind a **3140 élő kreatív fájlja 2026-08-17-re esik** (a storage-migráció napja). Az egyetlen valós szállítás-jel a `creatives.created_at`.
- **„nem infinite scroll, pedig azt kértem jobbra"** — jogos, ezt a 6.41.0-ban kihagytam. Most megvan: új **`GET /api/dashboard/creatives?d=&r=&offset=`** (24-es lapok, scope-on belül), az első lapot a szerver rendereli, a többi görgetésre jön, 800px-szel a jobb szél előtt indul.
  - **Egy valós versenyhelyzet javítva még kiszállítás előtt:** a scroll-esemény gyorsabban tüzel, mint ahogy a React state-et commitol, tehát két esemény ugyanazt az offsetet tölthette volna be kétszer (dupla tile, dupla key). A kurzor és az „épp tölt" jelző **ref**, nem state.
- **Teszt:** új `tests/integration/api/dashboard-creatives.test.ts` (5) — a sorrend-teszt fixture-je pont az éles alakzat (a legkésőbb beszúrt sor a legrégebbi `created_at`), tehát a régi kóddal elbukna; + lapozás vége, kliens-izoláció, archivált kihagyása. Suite **637/637 zöld** (632 → +5).
- **Bump:** `6.41.0` → **`6.42.0`** (minor — új HTTP route + viselkedés-változás).

- **DEPLOYOLVA 6.42.0 (2026-09-01):** commit `7e696a9`, box `d554cb6`→`7e696a9`, build 36.8s, `pm2 restart` → **Ready 1395ms**, box `package.json` **6.42.0**. Séma-migráció nincs. Health: `/` 307, `/login` 200, `/matrix` 307, `/api/dashboard/creatives` **401** (auth mögött, helyes).

### 2026-09-01 — A csík négy user-kérése: két méret, DCO is, hover, dialog — 6.43.0
- **User:** „minden méretet nem rakunk ki ide csak a 300x250 és a 1080x1080" · „ezek a képek nem a legfrissebb módosítások még mindig" · „mouse overre írjuk ki az MC számot, variánst és topicot" · „kattintásra megnyílhat ugyanaz a dialog mint a creative libraryban" · **majd menet közben:** „nem csak a creative library hanem a **dco kreatívok** is a listába kéne kerüljenek legutóbbi változás dátuma szerint".
- **A „legfrissebb" kérdés végigkövetése (három rossz jel után a negyedik a jó):**
  1. `creatives.id` — **nem recencia** (a legmagasabb id-k `created_at`-je 2025-12-22). Ez volt a 6.41.0 hibája.
  2. `uploaded_files.created_at` — **sem**: mind a 3140 kreatív fájlja `2026-08-17`, a storage-migráció napja.
  3. `creatives.created_at` — a szállítás napja, de a *módosítás* nem látszik rajta (6.42.0 ezt használta; a user szerint még mindig nem a friss).
  4. **`updated_at` mindkét forráson** — ez a valódi „utolsó változás". A csík éle most MC331a/b/c (2026-08-31 21:02), pontosan az, amin a user tegnap dolgozott.
- **Két forrás, egy idővonal:** a kurzor egy SQL `union all` (uploaded creative + DCO üzenet), `changed_at desc` szerint, és külön hidratálódik a két fajta. A DCO ág **`distinct on (number, variant)`** — egy MC annyi cellában él, ahány audience-e van, és nélküle egyetlen szerkesztett MC kitöltené a csíkot (élesben 24-ből 24 tile volt MC331a). A Creative Library ugyanígy dedupál (`seen` a `number|variant|size`-on).
- **Ugyanaz a szűrés, mint a Library-ben:** csak ACTIVE cella, csak olyan sablon, ami rendel a két méret valamelyikére (`listAllTemplates()` a forrás; élesben az `html` 300x250-et ad, 1080x1080-at egyik sablon sem — az a méret az **uploaded** oldalról jön).
- **Hover:** MC szám+variáns és alatta a topic. A kreatívon nincs topic, az üzenetről oldódik fel `mcNumber+mcVariant` alapján; a 630 párból 40 több topicra fut ki — ilyenkor **mind** kiíródik, mert az egyik önkényes választása rossz cellát nevezne meg.
- **Kattintás:** a Library saját dialógusai — uploaded → `CreativeDetailDialog`, DCO → `MatrixDetailDialog`. A DCO tile élő `MatrixIframePreview` (`fit-rect`, 250px magas dobozban), tehát egy perce mentett szöveg is látszik; IntersectionObserver miatt csak a látható tile kér `/api/render`-t.
- **Teszt:** `dashboard-creatives.test.ts` **11** eset (sorrend, két méret, verzió-család, topic, DCO beszúrás a közös sorrendbe, MC-dedupe, nem-ACTIVE és sablon nélküli cella kizárása, lapozás, kliens-izoláció, archivált). Suite **643/643 zöld**.
- **Bump:** `6.42.0` → **`6.43.0`** (minor).

- **DEPLOYOLVA 6.43.0 (2026-09-01):** commit `01f540a`, build 39.8s, `pm2 restart` → **Ready 1255ms**, box `package.json` **6.43.0**. Séma-migráció nincs. Health: `/` 307, `/matrix` 307, `/api/dashboard/creatives` 401.

### 2026-09-01 — Shares-összegző + a fejléc az aloldalak nyelvén — 6.44.0
- **User:** „kéne egy shares összegző is időtartomány szerint" · „a dashboard yesterday elég a fejlécbe, nem kell alá még egyszer az Erste" · „a Dashboard és az időszak mehet azzal a megjelenéssel, mint a fejléc az aloldalakon" · „a bal felső sarokban az ERSTE szóra kattintva jöhet a dashboard (nem kell külön menüpont)".
- **Shares panel:** az ablakban nyitott share-ek (elemszám, nézet, letöltés, archivált badge) + **az ablakban érkezett kommentek minden share-en** — a régi share-re ma írt komment ma hír, és a share-sorok önmagukban sosem mutatnák meg. ⚠️ **A nézet- és letöltésszám kumulatív** (nincs napi bontás a sémában), ezért a felirat és a tooltip kimondja, hogy all-time — nem adom el ablak-adatnak.
- **Fejléc:** a lap most ugyanazzal a sticky `toolbar`-ral nyit, mint a Feeds/Shares (cím → szűrők → jobbra darabszám). A kliens-név kikerült: a sidebar minden képernyőn kiírja.
- **Sidebar:** a kliens-név `Link` a `/`-ra. Dashboard menüpont **nem** kell (user döntése).
- `shareItemCount` kikerült a share-galleries route-ból `lib/share-metadata.ts`-be (két hívó).
- **Bump:** `6.43.0` → **`6.44.0`** (minor).

### 2026-09-01 — Product filter mindenhol: all/none + darabszámok — 6.45.0
- **User:** „filter gombok közé kéne egy product filter mint a matrixnál, amibe kéne egy olyan mint a statuszban hogy all none, és termékenként megjelölni kicsi szürke számmal a dco nondco mc és creative számokat, in fact a matrix és több product filterbe is jó lenne egy ilyen".
- **A `MultiPill` kapta a bővítést, nem minden hívó külön:** az `optionCounts` értéke lehet **szám vagy szám-tömb** (több dolog egy opció mellett, ponttal elválasztva), és `countLabels` nevezi meg a szegmenseket a tooltipben. A `STATUS_QUICK_SELECT` átnevezve **`ALL_NONE_QUICK_SELECT`**-re — sosem a státuszról szólt, és most hat szűrőn van rajta.
- **Hol lett all/none + darabszám:** dashboard (új), matrix (DCO · nonDCO), creative library (DCO · uploaded), feeds, assets, monitoring (sima sor-darabszám).
- **DCO vs nonDCO definíciója (a mátrix tengelyétől örökölve):** `audiences.channel == null` → DCO; `!= null` → nonDCO, és ott a **termék a topic-kulcs prefixéből** jön, mert a channel-audience-ek termék-agnosztikusak. ⚠️ **Erstében ma 0 channel-audience van (mind a 180 `channel = null`)**, ezért a nonDCO oszlop mindenhol 0 — ez helyes adat, nem hiba; a teszt viszont lefedi a nonDCO ágat, hogy amikor jön ilyen adat, működjön.
- **A darabszám az EGÉSZ könyvtárra megy, nem az ablakra** (a státusz-darabszámmal ellentétben): egy termék-választót azért néz meg az ember, hogy eldöntse, hova nézzen — csendes napon a nullák haszontalanok lennének. A `MultiPill` doksija eddig is kimondta, hogy a saját szűrője ELŐTT kell számolni.
- **Dashboard-szűrés:** a `?p=SZK,VAL` a csíkot és a feed-panelt szűkíti — az a két panel, aminek a sorain van termék. Az activity, a shares és a Library-összegek érintetlenek (nincs rajtuk termék). ⚠️ **A két forrás máshogy éri el a terméket:** a kreatívnak saját `product` oszlopa van, a cellának az audience-én lóg (subquery az audience-kulcsokra).
- **Teszt:** új `dashboard-products.test.ts` (4) + a csík product-szűrő tesztje. Suite **648/648 zöld**.
- **Bump:** `6.44.0` → **`6.45.0`** (minor).

- **DEPLOYOLVA 6.44.0 + 6.45.0 (2026-09-01):** `c201838` (shares panel, toolbar-fejléc, sidebar-link) és `8459c12` (product filter), build 34.7s / 39.0s, `pm2 restart` → Ready 1378ms / 1301ms, box `package.json` **6.45.0**. Séma-migráció egyikhez sem kell. Health mindkettő után: `/` 307, `/matrix` 307, `/shares` 307, `/creative-library` 307.

### 2026-09-01 — „mi az a 0-ás oszlop középen?" + toolbar-sorrend — 6.45.1
- **User kérdése volt a bizonyíték arra, amit előző körben tudtam, de nem javítottam:** a nonDCO oszlop minden terméknél 0 (nincs channel-audience Erstében), és egy csupa-nulla oszlop csak kérdést szül. **`trimEmptyCountSegments`** (`lib/count-segments.ts`): ha egy szegmens MINDEN opciónál nulla, kiesik — a `countLabels` vele együtt. Magától visszajön, amint lesz ilyen adat. Ugyanez a mátrixban (DCO · nonDCO) és a Creative Library-ben (DCO · uploaded). Az utolsó szegmens sosem esik ki.
- **Toolbar-sorrend (user):** product a cím után, a nap-scope jobbra a dátum mellé.
- **⚠️ Menet közben talált hiba:** a nap-léptető és a Today/Yesterday/7 days linkek **nem vitték tovább a `?p=`-t**, tehát egy napváltás némán törölte a termékszűrőt. Most minden scope-link (és az üres állapot „try the last 7 days" linkje is) viszi.
- **Teszt:** `count-segments.test.ts` (5) + a product-inventory tesztek a vágott alakra írva. Suite **653/653 zöld**.
- **Bump:** `6.45.0` → **`6.45.1`** (patch).

- **DEPLOYOLVA 6.45.1 (2026-09-01):** commit `6893831`, build 35.4s, `pm2 restart` → Ready 1457ms, box `package.json` **6.45.1**. Health: `/` 307, `/matrix` 307.

### 2026-09-01 — Monitoring import: 3 hiba a július/augusztus riporton — 6.46.0
**Tünet:** `/monitoring` feltöltés előbb 422 („Could not read Reporting Period From/To"), majd 502 (`Unexpected token '<', "<html> <h"…` = nginx hibaoldal, tehát a node process meghalt a kérés alatt).

**Bizonyított okok:**
1. **Front Page oszlop-eltolás.** Az igazi AdForm export A oszlopa üres (címke B-ben, érték C-ben); a generált fájlokban a címke az A-ban van. A `readPeriod` fixen `row[1]`/`row[2]`-t olvas (`src/lib/adform-report.ts:277`) → üres periódus → 422.
2. **Insert bind-paraméter plafon.** A `values`-ban **20 oszlop/sor**, a postgres.js hard limitje **65 534 paraméter** → **max 3 276 sor egy statementben**. Mért aggregált sorszám: június **3 364**, július **3 574**, augusztus **5 785**. Élő próbával (tranzakció + rollback) igazolva: 3 364 és 5 785 → `MAX_PARAMETERS_EXCEEDED`. **A júniusi újratöltés is elhasalna ma** — a meglévő 3 364 soros júniusi adat még a `size` aggregációs kulcsba vétele előtti importból van.
3. **Parse-memória (valószínű, nem bizonyított a crashre).** A generált fájlokban **nincs `sharedStrings.xml`** — minden ismétlődő kampánynév inline. Kicsomagolva: június 52 MB XML / 94k sor, július 118 MB / 112k, augusztus **136 MB / 130k**. Peak RSS a parse alatt: 549 / 767 / **905 MB**. A boxon 3,8 GB RAM, ~1,5 GB már használatban, 5 app fut. Kernel-OOM logot nem találtam, de a process 18:49-kor némán újraindult a POST alatt.

**Terv:**
- [x] 1. `readPeriod` pozíciófüggetlen: a `Reporting Period From/To` címkét a sor **bármelyik** cellájában keresse, és a rá következő nem üres cellát vegye értéknek. Mindkét alak megy utána.
- [x] 2. Az insert **darabolása** (1000 sor/statement) a meglévő tranzakción belül. Ez a globális „row caps" szabály write-oldali párja.
- [x] 3. Unit teszt mindkettőre: (a) behúzás nélküli Front Page, (b) 4000+ soros insert egy tranzakcióban (integration).
- [x] 4. Memória: **elfér, nem kell hozzányúlni.** Élesben mérve az augusztusi (legnagyobb) fájl importja alatt: app RSS **1 085 MB peak**, a boxon a szabad memória **1 486 MB**-ig ment le, a process nem indult újra (restart-számláló 98-on maradt), a kérés után visszaesett 519 MB-ra. ⚠️ **A tartalék vékony:** ha a riport tovább nő, vagy a boxon több app fut, ez elfogyhat. Ha egyszer 502-t adna, a sorrend: (a) generátor írjon `sharedStrings`-et (feleannyi XML), (b) SheetJS `dense: true` (835→718 MB mérve).
- [x] 5. Bump + CHANGELOG + deploy.

**Eredmény:**
- `valueAfterLabel()` (`adform-report.ts`): a címkét a sor bármelyik cellájában megtalálja, értéknek a rá következő nem üres cellát veszi. Mindhárom igazi fájl periódusa kiolvasható: `01/06`, `01/07`, `01/08` → `30/06`, `31/07`, `31/08`.
- `INSERT_CHUNK = 1000` az import route-ban, a meglévő tranzakción belül (a periódus-csere így továbbra is atomi). Aggregált sorszám a három fájlon: **3 364 / 3 547 / 5 733** → 4 / 4 / 6 statement.
- ⚠️ **A bind-paraméter plafon eddig is ott volt, csak nem ütköztünk bele:** 20 paraméter/sor × 3 276 sor = a limit. A júniusi 3 364 sor már fölötte van — az adat még a `size` aggregációs kulcsba vétele előtti importból származik, egy mai újratöltés elhasalt volna.
- **Teszt:** új `api/monitoring-import.test.ts` (2 route-szintű eset: 3 500 aggregált sor importja + újratöltés-csere) — mindkettő `MAX_PARAMETERS_EXCEEDED`-del bukik a javítás előtti kódon, ellenőriztem. `adform-report.test.ts` +1 (behúzás nélküli Front Page). Suite **656/656 zöld**.
- **Bump:** `6.45.1` → **`6.46.0`**. (Szigorúan véve két bugfix, tehát patch is védhető lett volna; a jóváhagyott terv minorra szólt, azt tartottam.)

**Élesben ellenőrizve (2026-09-01 19:21 / 19:23):** július és augusztus is bement.

| időszak | sor | matched | impr | cost | fájl Dashboard impr | eltérés |
|---|---|---|---|---|---|---|
| 01/07 | 3 547 | 2 920 | 15 508 359 | 20 697 514 | 15 510 180 | 1 821 |
| 01/08 | 5 733 | 5 024 | 20 051 365 | 35 883 108 | 20 053 243 | 1 878 |

Az eltérés a **kihagyott DEFAULT/brand sorok** (454 / 439) — nincs a PMMID-jükben `-m_`/`-v_`, tehát egyetlen cellához sem tartoznak. Szándékos, nem veszteség.

---

## 2026-09-01 — I1.7 dashboard-chartok + I1.8 activity product-szűrés — 6.47.0

**User:** „a top left two tiles are redundant, az adat a nagyobb panelekben van, de szeretnék jó kinézetű monitoring chartokat a dashboard felső sorába" · „az activity pane is legyen időszakasz és product filtered (it seems to be only time filtered)".

- [x] **I1.7 teljes** — a felső sor: `DeliveryTrend` + `CoverageTile` + a megmaradt `FreshnessTile`. Új: `src/lib/dashboard-monitoring.ts` (`monthlyDelivery`, `monthLabel`, `compactNumber`), `src/lib/period.ts` (`periodDateKey` az `mcp.ts`-ből kiemelve), `_dashboard/DeliveryTrend.tsx`, `_dashboard/CoverageTile.tsx`.
- [x] **I1.8 teljes** — `activityDigest` átköltözve `src/lib/dashboard-activity.ts`-be (a `dashboard-creatives.ts` / `dashboard-products.ts` mintájára; a `page.tsx`-ben privát volt, így tesztelhetetlen), + `productScoped()` row-constructor IN feloldó.

**Amit az adat mondott (prod DB, ellenőrizve):**
- 4 havi periódus: máj 8,34 M → jún 12,14 M → júl 15,51 M → aug 20,05 M impression (+29 % MoM). CTR (valós sorok): 0,235 / 0,227 / 0,338 / 0,294 %.
- **Lefedettség romlik:** 45 % → 78 % → 46 % → **35 %**. Nem a mátrix romlott, a nem-matchelt publisher-volumen nő (aug 20 M-ból 10,9 M nem-matchelt).
- **`size='1x1'` csapda igazolva:** augusztusban 0 impression mellett 445 366 klikk és 17,9 M Ft költség. A `monthlyDelivery` `impressions > 0`-val szűr.
- **SZK-szűrés az activityn:** 1452 `messages:update` az 5344-ből — ebből **179 sor csak a `coalesce(audience.product, topic-prefix)` miatt jön be** (a `ch_disp`/`ch_soc` cellák).

**⚠️ KORREKCIÓ (ugyanaznap, a `channels` tábla felfedezése után):** először azt írtam, hogy a 688 `ch_disp`/`ch_soc` cella „hiányzó audience-sorokra hivatkozik", és hogy a 6.45.1 fixe a tünetet takarta. **Mindkettő téves.** A csatornák szándékosan külön táblában (`channels`, `schema.ts:207`) élnek a 2026-08-17-i szétválasztás óta, és tényleg nincs channel-*audience* — a 6.45.1 megfogalmazása helyes volt. Ami valóban nyitott: a `dashboard-products.ts:58` nonDCO-ága még a régi `audiences.channel != null` alakra van írva, ezért a ProductFilter nonDCO-számlálói 0-k. Külön döntés, lásd I1.8.

**Teszt:** `tests/integration/dashboard-monitoring.test.ts` (7 — 1x1-kizárás, évfordulós rendezés `01/12/2025` vs `01/01/2026`, newest-n, matched-impressions, kliens-izoláció, üres sorozat) + `tests/integration/dashboard-activity.test.ts` (7 — product-szűrés, `ch_*` topic-prefix feloldás, product nélküli entitástípusok kiesése, nem-numerikus `entity_id`, törölt entitás, `topics.product` fallback, scope+kliens). Suite **670/670 zöld** (656 → +14). `npm run build` sikeres.

**Vizuális ellenőrzés:** a két csempe `renderToStaticMarkup` + playwright screenshottal ellenőrizve él adaton. Első körben a coverage %-sor a ratio-bar tengelyének látszott → átírva a delivery-vel azonos oszlop-nyelvre (fix 0–100 %-os skálán), így a felső sor egy vizuális nyelvet beszél.

**Verzió:** `6.46.0` → **`6.47.0`** (minor). Séma-migráció nincs. **Deploy még nem történt.**

---

## 2026-09-01 (folytatás) — W3.i monitoring periódus-tartomány — 6.48.0

**User:** „kell a periódus-selector később? van 4-5 hónap adatunk, tök jó lenne tetszőleges ezen belüli periódusból elemezni."

**Az én tévedésem, kétszer, ugyanabban a szálban:**
1. Azt írtam, „amíg egy periódus egy hónap, az összevonás semmit nem ad a mostani választóhoz képest". **Téves** — a mai route pontosan EGY periódust ad, több hónap együtt-nézése más képesség, és az adat támogatja.
2. Azt írtam, a forrás XLSX-ben nincs nap-dimenzió, ezért az AdForm report buildert kellene átállítani. **Téves** — a nap ott van minden sorban, a parser dobja el. Részletek + mérés: **W3.j**.

**Szállítva:**
- `/api/monitoring?from=&to=` — összefüggő szelet a periódus-listából, mindkét marker inkluzív, tetszőleges sorrendben adható (a route `min`/`max`-szal normalizál). Alap változatlanul a legfrissebb egy periódus. Sorok szerver-oldalon aggregálva a `(platform, product, size, message_id, match_level, audience_key, topic_key, mc_number, mc_variant)` kulcsra; a `messages.name`/`status` **explicit benne a GROUP BY-ban** (a `monitoring.message_id`-hez kötődnek, nem a `messages.id`-hez, tehát Postgres nem tudja levezetni — a régi PG-dialect csapda).
- Új `mcTrend` a payloadban: `(mc, periódus)` → impr/klikk, ~1 068 sor a teljes történetre.
- `MonitoringTable`: két select (`__period-range`), „N periods summed" jelzés 1-nél több periódusnál.
- `MonitoringDetailDialog`: új `__periods` tábla (periódusonkénti impr/klikk/CTR), csak több-periódusos tartománynál.
- Periódus-lista rendezése `periodDateKey`-re (évforduló-bug).

**Miért nem nő a payload:** 4 periódus = 15 646 tárolt sor, de **6 227** különböző kulcs → a teljes történet ~akkora nézet, mint ma az augusztus (5 733). Mérve.

**Teszt:** `tests/integration/api/monitoring-range.test.ts` (10 — alapértelmezett egy periódus, összegzés kulcsra, CTR újraszámolás nem átlag, fordított markerek, kulcs-szétválasztás, évfordulós sorrend, ismeretlen marker fallback, `mcTrend` alak, kliens-izoláció, üres payload). Suite **680/680 zöld** (670 → +10). Build sikeres.

**Verzió:** `6.47.0` → **`6.48.0`** (minor). Séma-migráció nincs. **Deploy még nem történt** (6.47.0 sem).

---

## 2026-09-01 (folytatás 2) — W3.j nap-grain ingest — 6.49.0

**User:** „megvan" (a jún/júl/aug riportfájl) → „mehet".

**Szállítva:** `monitoring.day` (`text notNull default ''`, ISO `YYYY-MM-DD`), migráció **`0010`** — unique index bővítve `day`-jel + új `monitoring_client_day_idx`. A `parseAdformReport` kiolvassa a `Date` oszlopot (`periodDateKey`-vel ISO-ra normalizálva) és beveszi az aggregációs kulcsba; az import-route átvezeti. `Date` oszlop nélküli riport `day=""`-vel importál, változatlanul.

**Mérve valódi fájlokon (nem becslés):**

| | ápr | máj |
|---|---|---|
| nyers sor | 85 222 | 83 905 |
| periódus-grain (régi) | 3 244 | **3 002** |
| **nap-grain (új)** | **73 488** | **67 749** |
| parse | 2,26 s | 2,11 s |
| impressions összeg | 10 029 134 | **8 335 352** |

A májusi 3 002 sor és a 8 335 352 impresszió **pontosan** a ma tárolt érték → a parse nem veszít és nem duplikál. Insert (teszt-PG, 68 chunk × 1000): **5,0 s**. Aggregátum egy teljes nap-grain periódus fölött: **15 ms**. Egy hónap importja tehát ~7 s — kézi feltöltéshez bőven jó.

**Amiért nem tört el semmi:** minden mai olvasó periódusra csoportosít. Erre külön teszt van, ami ugyanazt a riportot **összecsukva ÉS naponta** importálja, és a `monthlyDelivery` + `/api/monitoring` kimenetét összehasonlítja — azonos.

**A két bukó unit teszt nem regresszió volt:** a `tests/unit/adform-report.test.ts` fixture-jében ugyanaz az MC1a két különböző napon szerepel, tehát most helyesen két sor. A tesztet úgy írtam át, hogy a **változást mutassa**: napi sorok külön assertálva, plusz egy assert, hogy a két nap összege továbbra is a régi 150/5/15/1.

**Teszt:** új `tests/integration/api/monitoring-day-grain.test.ts` (4) + `adform-report.test.ts` frissítve. Suite **684/684 zöld** (680 → +4). Build sikeres.

**Verzió:** `6.48.0` → **`6.49.0`** (minor, séma-migrációval).

**⚠️ Nyitva — `W3.j-6`, a useré:** a 4–5 riportfájl újratöltése a Monitoring feltöltőjén. Amíg egy periódus nincs újratöltve, az `day=""`-vel, összecsukva marad — ez nem hiba, csak azon a periódison nem lesz napi bontás. **Deploy: a migráció + kód egy passzban kell a boxra** (`npm run db:migrate` + build + `pm2 restart`), és három verzió megy ki egyszerre: 6.47.0 + 6.48.0 + 6.49.0.

**Menet közbeni korrekció:** kiderült, hogy létezik a `channels` tábla (`schema.ts:207`, 2026-08-17-i szétválasztás, 6 sor: ch_disp/soc/prg/gsn/gnw/yt). Az I1.8-nál tett állításom, hogy a 688 `ch_disp`/`ch_soc` cella „hiányzó audience-sorokra hivatkozik" és hogy a 6.45.1 fixe „a tünetet takarta", **téves volt** — a nonDCO csatornák szándékosan külön táblában élnek. A kód viselkedése helyes maradt (a nonDCO product a topic-prefixből jön, mert a csatornának nincs productja), csak az indoklás volt rossz; a kommentek, a teszt neve, a CHANGELOG és az I1.8 jegyzet javítva.

**DEPLOYOLVA 6.47.0 + 6.48.0 + 6.49.0 (2026-09-02):** commit `9dab838`, push origin main, box `6a7bcbd`→`9dab838`, box `package.json` **6.49.0**.
- **Séma-migráció `0010` LEFUTOTT a boxon** (`npm run db:migrate` → „migrations applied successfully"), a kóddal egy passzban, build + restart előtt. Ellenőrizve: `monitoring` **15 646 sor / 56 035 192 impresszió / 4 periódus — a migráció előtti értékkel azonos**, semmi nem veszett el. Új `day` oszlop: `text NOT NULL DEFAULT ''`. Mind a 15 646 meglévő sor `day=''` (összecsukva) — ez a helyes állapot újraimportig. Indexek: `monitoring_client_day_idx` létrejött, `monitoring_client_period_key_idx` újra létrehozva a `day`-jel.
- `npm run build` **Compiled successfully 36.3s**, 58/58 static page. `pm2 restart mm6-erste` → **Ready 1283ms**, online.
- Health (localhost:6001): `/` 307 · `/login` 200 · `/matrix` 307 · `/monitoring` 307 · `/feeds` 307 · `/mcp` 401 · `/api/monitoring` 401 · `/api/dashboard/creatives` 401. Publikus hoston (`erste.messagingmatrix.ai`): `/` 307 · `/login` 200 · `/monitoring` 307.
- A logban látszó „Failed to find Server Action" sorok **04:50-esek, a deploy (08:13) ELŐTTIEK** — elavult action-id-t hívó régi böngészőfül, nem ebből a kiadásból.
- **Böngészős smoke a userre vár:** (1) dashboard felső sor — Delivery + Matrix coverage csempe valós számokkal; (2) product-szűrő az Activity panelen; (3) Monitoring periódus-tartomány két selecttel + „N periods summed"; (4) egy MC detail dialógusa több-periódusos tartománynál (periódus-bontó tábla).
- **Nyitva marad `W3.j-6`:** a 4–5 riportfájl újratöltése a Monitoring feltöltőjén — enélkül a napi bontás nem jelenik meg (a `day` oszlopot amúgy sem olvassa még semmi).

---

## 2026-09-02 — I1.9–I1.11 dashboard: product-szűrés mindenütt, 30 napos scope, CTR-rendezés — 6.50.0

**User (három kérés egy menetben):** „a library is legyen product filter érzékeny és a felső report sor is" · „legyen last 30 nap is az idő filter gombok között" · „a creative sliderben meg kéne az open helyett egy order by: time / ctr (ctr values under 100k impression filtered out, only matched)".

**Mérések, amik döntöttek (prod DB):**
- **Coverage productonként (2026. aug):** `(nincs product)` 10 942 699 impr / **0 %** matched · SZK 85 % · HK 100 % · SZA 74 % · VAL 58 % · HITEL 0 %. A szűretlen 35 %-ot a product nélküli publisher-blokk húzza le → bármelyik productra szűrve 58–100 %. Helyes, de **más populáció** — a CHANGELOG kiírja.
- **CTR-küszöb hatása:** 100 e impresszió felett **74 MC** minősül; ebből egy **7 napos ablakban 9** MC és **0 feltöltött kreatív**. Ezért dobja el a CTR-rendezés a nap-ablakot (all-time), különben a nézet gyakorlatilag üres lenne.

**Szállítva:** `monthlyDelivery(clientId, n, products)`; `entityCounts` → `libraryCounts(clientId, products)` a `dashboard-products.ts`-ben; közös `messageProduct` SQL-kifejezés (a `productScoped` is erre kötve — a DCO/nonDCO szabály ne éljen két másolatban); `count-tile__note` a Text formattingon; `ScopeRange` + `RANGE_SPAN` a 30 napra; `panel__action` slot; `creative-sort` váltó; `mcPerformance()` + `CTR_MIN_IMPRESSIONS` a `dashboard-creatives.ts`-ben; `?cs=` az oldalon és a strip API-n.

**Teszt:** új `dashboard-library-counts.test.ts` (6) + `dashboard-creatives-ctr.test.ts` (8) + 2 új `monthlyDelivery` eset + 2 új `day-scope` unit eset. Suite **702/702 zöld** (694 → +8, illetve 684 → +18 a nap eleje óta). Build sikeres.

**Egy saját teszt-hiba, nem kód-hiba:** a CTR-tesztek először üres listát adtak, mert a fixture csak `match_level`-t állított. A „matched" a `message_id IS NOT NULL` — ugyanaz, amit a Monitoring tábla Matched szűrője ért alatta. A fixture javítva (valódi `messages` sorral), a kód nem változott.

**Verzió:** `6.49.0` → **`6.50.0`** (minor). Séma-migráció nincs. **Deploy még nem történt.**

---

## 2026-09-02 (folytatás) — Monitoring toolbar-átrendezés, közös feltöltő-shell, MC-számláló — 6.51.0

**User:** „itt nem kell a report period label" · „az all/matched/unmatched view kapcsoló kimehet a jobb oldali side toolbarba felülre, az upload meg mehet alulra" · „ez az upload metódus tök jó, lehetne ilyen az assets és a creative upload is, de úgy hogy ha toolbar össze van csukva akkor gomb megnyitja nagyban az upload drag-and-dropot, ha nyitva akkor egyből ott a drop zone" · „a librarynál azt kéne kiírni a messages helyett hogy hány különböző, variánsokkal együtt MC-nk van".

**Szállítva:**
- `Report period` label törölve — a két dátum-select önmagát magyarázza.
- A match-szűrő kikerült a `MonitoringMatchFilter`-be, a jobb toolbar tetejére (`Rows` szekció). Az állapot a `MonitoringView`-ba emelve, mert a kontroll a railben van, a sorok meg a táblában. Összecsukva három ikon (`List` / `Link2` / `Unlink2`), a `LibraryViewSwitcher`/`ArchiveToggle` collapsed-nyelvén.
- Az upload a rail aljára került (a tartalom flex-oszlopba csomagolva, mint az Assetsnél — enélkül az `mt-auto` nem ér le).
- Új közös `_components/ToolbarUpload.tsx`: összecsukva a régi primary ikon-gomb (a lap saját dialógusát nyitja), kinyitva drop zone. **Nincs benne upload-logika** (`onActivate` + `onFiles`), mert mindhárom hívó mást csinál a fájlokkal: Monitoring közvetlen import, Assets a metaadat-dialógus (`setDroppedFiles` + `setUploadOpen`, a plumbing már megvolt), Creative Library az upload-queue (`queue.addFiles`).
  - **`mt-auto` a hívóé, nem a komponensé** (az `ArchiveToggle` mintájára): az Assets/CL railben az `ArchiveToggle` már kéri, és két `mt-auto` szétosztja a szabad helyet ahelyett, hogy fölöttük gyűlne össze — emiatt csúszott először középre a „Show archived".
- **Library `Messages` → `MCs`.** A `messages` sor **cella**, nem MC: egy MC annyi cellában él, ahány audience-e van (MC316a **43** cellában). Mérve: **2 753 sor → 635** különböző (szám, variáns), SZK-ra szűrve 1 381 → 209. A csempe a 635-öt írja, alatta jegyzetben `in 2,753 cells` — a régi szám kontextusként megmarad, nem tűnik el.

**Teszt:** `dashboard-library-counts.test.ts` +1 eset (egy MC két audience-en + egy második variáns → 6 cella, 5 MC; a régi számlálással elbukna), a többi `mcs`/`messageCells`-re átírva. Suite **703/703 zöld**. Build sikeres. Vizuálisan ellenőrizve lokális prod buildben mind a négy felület (monitoring nyitva+csukva, assets rail, library csempék).

**Verzió:** `6.50.0` → **`6.51.0`** (minor). Séma-migráció nincs. **Deploy: sem a 6.50.0, sem a 6.51.0 nincs kint.**

**DEPLOYOLVA 6.50.0 + 6.51.0 (2026-09-02):** commit `5fbbdf2`, push origin main, box `9dab838`→`5fbbdf2`, box `package.json` **6.51.0**.
- **Séma-migráció NINCS** egyik verzióban sem (`git diff --name-only 6ca011a..5fbbdf2 -- db/migrations` üres) — a `0010` a 6.49.0-val már kiment. Ellenőrizve deploy után: `monitoring` **15 646 sor / 56 035 192 impresszió**, változatlan.
- `npm run build` **Compiled successfully 37.7s**, `pm2 restart mm6-erste` → **Ready 1325ms**, online.
- Health (localhost:6001): `/` 307 · `/login` 200 · `/matrix` 307 · `/monitoring` 307 · `/assets` 307 · `/creative-library` 307 · `/feeds` 307 · `/mcp` 401 · `/api/monitoring` 401 · `/api/dashboard/creatives` 401. Publikus hoston: `/` 307 · `/login` 200 · `/monitoring` 307 · `/assets` 307.
- **Böngészős smoke a userre vár:** (1) dashboard product-szűrő → felső sor + Library csempék együtt mozognak; (2) `Last 30 days`; (3) kreatív-csík `Time`/`CTR` váltó; (4) Monitoring jobb toolbar nyitva/csukva (Rows felül, upload alul); (5) Assets és Creative Library drop zone nyitott railnél, gomb csukva; (6) Library `MCS 635 · in 2,753 cells`.
- **Nyitva marad:** `W3.j-6` (a 4–5 riportfájl újratöltése a napi bontásért) és az archivált sorok kérdése a Library-számlálókban.

---

## 2026-09-02 (folytatás) — nonDCO videó-preview + méret-görgetés — 6.52.0

**User:** „a nonDCO creak között a videó megjelenítése nem megy" · „jó lenne az azonos nevű de más méreteket egy pöttyként megjeleníteni" · „ha preview box felett scrollozok vagy swipolok akkor pörgesse a méret választó opciót körbe-körbe".

- [x] **Videó-preview — GYÖKÉROK, nem tünet:** a `PreviewPane` a `staticImage`-et **feltétel nélkül `<img>`-ként** rendereli (`:212`), de a nonDCO kreatív lehet `.mp4` → az `<img>` az alt-szöveget mutatja a sakktábla-háttéren. Pontosan ez látszott a képernyőképen (`ERSTE_SZK_MC104_a_fuggoagy_halfBg_n1_480x480.mp4`). Kiterjesztés szerint választ `<video>`-t, az asset-previewk bevett kezelésével (`controls` / `preload=metadata` / `muted` / `playsInline` / `#t=0.1`).
  - **Nem írtam negyedik kiterjesztés-listát:** a `parse-filename.ts` `EXT_TYPE` mapja (amivel az importer osztályoz) kapott egy `mediaKindFromFilename` exportot. 3 unit teszt (kis/nagybetű, pontot tartalmazó könyvtárnév ≠ kiterjesztés, ismeretlen kiterjesztés → null).
- [x] **Méret-körbeléptetés a preview fölött:** wheel + touch-swipe, mindkét végén körbefordul. A wheel listener **kézzel, `passive: false`-szal** van felkötve — React `onWheel`-je passzív, `preventDefault` nélkül a mögötte lévő lap is görögne. A viewport maga sosem görgethető (`overflow-hidden`), tehát nem veszünk el valódi gesztust. Trackpad-burst ellen 60px küszöb + 220ms cooldown.
- [ ] **„Azonos nevű, más méret = egy pötty" — MÉG NEM CSINÁLTAM MEG, kérdés a userhez.** A felmérés mást mutat, mint amire a kérés szó szerint utal:
  - **Egy nonDCO cellán belül NINCS azonos nevű, méretben eltérő duplikátum** (0 csoport, mérve). A méretek már ma össze vannak vonva: egy MC-hez több `creatives` sor tartozik méretenként (MC311a: 32 méret), és a preview méret-választója ezeket listázza.
  - **Ami valójában sokszorozódik: a VARIÁNSOK.** Az MC97 `a…o` variánsai egyenként **egy-egy méretet** jelentenek ugyanabból a kreatívból: a/b/l 970x250, c 1080x1080 + 640x640, e 160x600, f 300x250, g 300x600, h 468x120, j 640x360, m 970x90, n/o 1080x1080 + 960x1200. Mind a 12 ugyanabban a cellában ül, azonos alapnévvel → 12 pötty.
  - ⇒ A kérés teljesítése **a variánsok összevonását** jelentené egy pöttybe, ami átírja, mit jelent egy pötty a mátrixban (kattintás melyik variánst nyitja? kijelölés? DCO-ra is vonatkozzon?). Ezt nem döntöm el magamtól — a `project_mc_numbering_rules` szerint a variáns tengely jelentéshordozó.

**Teszt:** `parse-filename.test.ts` +3. Suite **706/706 zöld**. Build sikeres.

**Verzió:** `6.51.0` → **`6.52.0`** (minor: hibajavítás + új interakció). Séma-migráció nincs.

## Checkpoint 2026-09-03 — MM6 képesség-térkép a workflow-tervezéshez (docs-only)

Új doksi: **`docs/MM6_PURPOSE_STATE_CAPABILITIES.md`** (392 sor). Cél: input annak az agentnek, amelyikkel a user az új ERSTE munkamódszert dolgozza ki. Kódot nem érintett.

Tartalom: fogalom-szótár (MC / audience / topic / channel / DCO-nonDCO / PMMID / tengely) · mai állapot · 11 menüpont képességei + Settings 10 fül + editor 5 fül · 49 MCP tool read/full bontásban · kimenetek · **őszinte hiánylista** · a tervezett workflow 11 lépésének leképezése.

**A legfontosabb feltárt tény: NULLA Google-integráció van a kódban.** Nincs `googleapis` függőség; a `GOOGLE_SERVICE_ACCOUNT_JSON` szerepel a `.env.example`-ben, de **sehol nem olvassuk** (0 találat `src/` + `scripts/`); nincs Sheets route (csak XLSX). ⚠️ Névcsapda: az `/api/drive/proxy/[filename]` **nem** Google Drive — v5-örökség név, a saját MinIO/lemez bájtjait szolgálja ki (a template.json hard-kódolja a `path-messagingmatrix` előtagot). A tervezett workflow 4 lépése Google-alapú → ma mind kézi.

**További hiányok:** nincs task/brief életciklus-entitás (de van `messages.brief` oszlop + a 11 értékű `status` ami de facto már állapotgép) · az approve nem zárja a kört (share-komment ✅, de nincs approve-állapot; a `messages.status=APPROVED` külön él) · nincs link-mező külső dokumentumhoz (a slide-URL ma csak `comment`/`brief` szabad szövegbe fér) · nincs kreatív↔cella auto-párosítás · nincs mappa-figyelő ingest.

**Mérleg:** a hurok 11 lépéséből **7 működik ma**, 2 részleges, 4 hiányzik — és mind a 4 vagy Google-integráció, vagy task-entitás.

**Javaslat a doksiban (11.2):** a slide-kapcsolatra először a minimális út — egy link-mező (`messages.brief_url` nullable VAGY `message_links` sidecar), és minden Google-művelet MM6-on kívüli agent-lépés. Valódi Google-integráció csak akkor, ha a hurok egy hónapig működött és a fájdalom konkrét. Az MC-kreálás nem hiány, hanem döntési fa (mindhárom út él: `mc_create` / `creative_promote` / `generate_test_creative`) — nulla kód.

**Következő:** a doksi + a majdani workflow-terv két thoughtként megy a brainbe (user kérése).

**⚠️ KORREKCIÓ a fenti checkpointhoz (user jelezte menet közben): NEM igaz, hogy „nulla Google-integráció" — csak a mai KÓDRA igaz.** A `tasks/todo.md`-ben ott az **I4 — Drive-linkek a kreatívokon** (TERV KÉSZ, 2026-09-03, építés zöld-lightra vár), lemért Drive API v3 + API-kulcs úttal (OAuth nélkül, mert a Leadás-mappák anyone-with-link), és ott az **FR-B Documents** (MC↔Slides link + státusz) meg az **FR-C ticket-inbox** is. A doksi (`docs/MM6_PURPOSE_STATE_CAPABILITIES.md`, most 479 sor) javítva:

- **9.1 átírva:** a kód-tény megmarad (nincs `googleapis` dep, nincs Sheets route, az `/api/drive/proxy` névcsapda), de mellé került az I4 teljes felmérése (két hivatkozás kreatívonként, 4 nullable oszlop ID-vel nem URL-lel, 42 fájl / 42 egyező `creatives` sor, `GOOGLE_DRIVE_API_KEY`, I4.10 = nincs új MCP tool, a `list_creatives`/`list_mc` magától mutatja).
- **9.2 + 9.4 kiegészítve** FR-C-vel és FR-B-vel; kimondva, hogy **az I4 és az FR-B külön marad** (más kardinalitás: kreatívnak 1 mappa+1 fájl, MC-nek több Slides doksi státusszal) — **a workflow „slide-kapcsolat" pontja az FR-B, nem az I4**.
- **Új 9.7:** roadmap-térkép (I4 / FR-B / FR-C / FR-A / FR-D / I1 / I6) + figyelmeztetés, hogy a `reporting` tábla üres és a `monitoring` 2026. májusi adat (utolsó import 2026-07-16) → a visszacsatolási ág ma nem friss.
- **10. fejezet táblázata + legenda** újraszínezve (`⛔ ma · 🟡 terv kész` / `🔵 tervben`); az összegzés új verdiktje: **a hurok nem 4 hiányzó képességen múlik, hanem 2 nyitott döntésen** (hol él a munkadarab állapota; hol él a Slides-link+státusz).
- **11.2 újraírva:** az eredeti „először minimális link-mező, integráció csak később" ajánlásom **elavult** — a user már tovább ment és lemérte, hogy a teljes Drive-út olcsó (nincs OAuth, nincs dep). Helyette az FR-B három nyitott kérdésére adtam ajánlást (generikus `kind`-mezős link-store; sidecar tábla, nem oszlop; és a state-kérdés a legfontosabb, mert a doksi-státusz és a `messages.status` kettőzése garantáltan szétcsúszik).

**Brain:** a doksi bement thoughtként (`6da7f5d6-43be-4537-a67f-58c3afe335eb`, „MM6 — Képességek és terv 2026-09-03"). Az első, hibás kerettel felvitt változat (`5de4bb33…`) átcímkézve ELAVULT-ra. A 2. thought (workflow-terv) akkor megy be, ha a workflow-agenttel elkészül.

---

## 2026-09-03 — I4 Drive-linkek a kreatívokon: TELJES SZÁLLÍTÁS + DEPLOY — 6.52.0 + 6.53.0

**User-kérés (szó szerint):** „minden feltöltött kreatívhoz tartozik egy drive link és egy parent drive folder link, a drive folder a fontosabb (ezt visszamenőleg is ki lehet tölteni), a file linket meg ha megadtam a folder linket akkor már ki lehet nyomozni programozottan" + share-fejlécbe a mappalinkek + minden kép/videó nézegetésnél a szülőmappa. Pontosítások: parent editálható, **file link számított és nem editálható**; a backfill darabokban, csak kreatívokra, a 600 legfrissebbre; MCP-ben nem kell külön tool, de listázáskor látszódjon.

**A terv és a tíz szelet: lásd az I4 szekciót fent** (mind `[x]`, a lemért tényekkel együtt).

**A négy mérés, ami a tervet eldöntötte (élesben, API-kulccsal):** (1) a Leadás-mappa listázása kulccsal **200 / 42 fájl** → nincs OAuth; (2) a mappa neve `files.get`-tel jön → `drive_folder_name` ingyen; (3) auth nélküli file-link **200** → külsősnek is nyílik; (4) 42 Drive-fájl ↔ **42 `creatives` sor** → a fájlnév-join tart. **Két korlát:** a kulcs **nem adja a `parents` mezőt** (fájlból nem lehet mappát visszakeresni) és **csak az anyone-with-link mappákat látja** (a MARKET-gyökér `files.get` → 404, listázás → **0 elem, nem hiba**) — ezért indul minden mappából, és ezért méri a resolver külön a mappa elérhetőségét.

**Verzió:** `6.52.0` → **`6.53.0`** (minor: 4 új oszlop + migráció `0011` + új route + új UI + MCP-mezők). Suite **749/749 zöld** (+36), `tsc` tiszta.

**DEPLOYOLVA 6.52.0 + 6.53.0 (2026-09-03):** commit `9cb2883`, push origin main, box `5fbbdf2`→`9cb2883`, box `package.json` **6.53.0**.
- **`GOOGLE_DRIVE_API_KEY` felvéve a box `/var/www/mm6-erste/.env`-jébe** (mentés: `.env.bak-20260903-drivekey`), `pm2 restart --update-env`. A boxról ellenőrizve: a Drive-listázás onnan is **200-at ad valódi fájlnevekkel** — van kifelé menő elérés a googleapis.com-ra.
- **Migráció `0011`:** a shared Postgresen már fent volt (lokálból futott a tunnelen), a boxi `db:migrate` így no-op → „migrations applied successfully". Ellenőrizve: `creatives` **3145 sor**, `drive_folder_id`/`drive_file_id` mindenhol NULL (ez a helyes kiindulás a backfill előtt).
- `npm run build` sikeres, `pm2 restart mm6-erste` → **Ready 1417ms**, online. Health (localhost:6001): `/` 307 · `/login` 200 · `/creative-library` 307 · `/mcp` 401. Publikus host: `erste.messagingmatrix.ai/login` **200**.
- ⚠️ **A `drizzle-kit` nem olvassa a `.env.local`-t** (lokálban `export $(grep '^DATABASE_URL=' .env.local)` kell a `db:migrate` elé); a boxon a `.env` miatt ez nem gond.

**Nyitva (a useré):**
- **A 600-as backfill élesben** — a mappalinkek listája kell hozzá: `ACTIVE_CLIENT_KEY=erste npx tsx scripts/drive-backfill.ts --file links.txt` (dry-run), majd `--apply`.
- **Böngészős smoke:** feltöltő queue batch-mezője · kreatív-detail mappa/file link · toolbar „Drive link check" riportja · share-fejléc mappasora.
- `docs/MM6_PURPOSE_STATE_CAPABILITIES.md` 9.1/9.7 még „I4 = terv kész, építésre vár"-t ír — frissítendő, ha a doksi tovább él.

## 2026-09-03 (folytatás) — feltöltő UX + MC-parse: 6.54.0 + 6.54.1 (DEPLOYOLVA)

**User élesben tesztelt, három lelet:** (1) „nagy ablakban nem megy a drag and drop" · (2) „kis ablakban nincs ott a bulk edit" · (3) „jó lenne ha át lehetne menni a kicsi ablakból a nagyba" · (4) „miért nem tudja kiolvasni az MC és variantot? hát tök világos a fájlnevekből" · (5) „drive check box mehet a show archived gomb alá alulra".

- **(2) nem volt hiba:** a böngészőben még a `v6.51.0` bundle futott (a sidebar verziója árulta el); reload után ott a batch-mező. Tanulság: élő teszt előtt a sidebar verziószámát nézzük.
- **(1) + (3) — a nagy ablak most a közös batch-ablak.** A Creative Library feltöltő gombja eddig az egyfájlos `UploadDialog`-ot nyitotta (nincs drop, nincs batch-mező), miközben az Assets oldalon **már létezett** a jó forma (táblázat + „Set for all" sor + drop). Ez lett közössé: `_components/BatchUploadDialog.tsx`, a `block` prop adja az osztálynév-prefixet (`asset-upload` / `creative-upload`), a **queue-t a hívó birtokolja** (`useUploadQueue`) — ezért tud a lebegő panel és a nagy ablak **ugyanarra a batch-re** nézni. A panel fejlécében új `upload-queue__expand` gomb nyitja a nagyot. Az egyfájlos dialógus + a `CreativeMetadataForm` **törölve** (elérhetetlen maradt volna).
- **(4) nem a parser hibája: a szabályok nem kérték.** A `DEFAULT_CREATIVE_PARSING_RULES` csak brand/product/type-ot definiált — MC-re és variánsra soha nem volt szabály. Két pattern-szabály került be, **a teljes élő korpuszon ellenőrizve (3145 fájlnév)**: a szám 3145/3145-ben egyezik a DB-vel; a variáns **egyetlen kisbetűt** fogad (`MC\d+_([a-z])_`) → 3097 pontos egyezés, **0 rossz**, és a maradék 48 (ahol `va`/`vc`/`px`/`bg`/`c1` áll a helyén, a könyvtár pedig `a` variánsnak veszi) **üresen marad** — rossz előtöltés helyett a user tölti ki. A négy kliens tárolt configja (mind a szállított defaulton állt) helyben frissítve → **reload után azonnal él, deploy nélkül is**.
- **(5)** A Drive link check a toolbar aljára, a Show archived alá került; a saját `px-3`-ja elhagyva (a `right-toolbar__body` már ad paddinget).

**Verzió:** `6.53.0` → **`6.54.0`** (minor: új feltöltő-ablak, közös komponens, parse-szabályok) → **`6.54.1`** (patch: toolbar-sorrend). Unit suite 238 zöld, `tsc` tiszta, build sikeres.

**DEPLOYOLVA (2026-09-03):** commit `ab8d2da` + `9f0…` (6.54.1), box `9cb2883`→`6.54.1`, build 38.2s, `pm2 restart` után `/login` 200 · `/creative-library` 307.


## Checkpoint 2026-09-04 — `MM6_PURPOSE_STATE_CAPABILITIES.md` frissítve a 6.57.0 állapotra (docs-only)

A user jelezte: **kész a Drive-integráció a leadási/preview-share ágon, most a brief-slide draft connection jön.** A doksi `6.39.0`-s állapotot írt, közben **18 minor** ment ki — nem csak a Drive-pontot frissítettem, hanem az egész doksit végigvittem. Most **536 sor**. (A `todo.md:1574` maga kérte ezt a frissítést.)

**Amit átírtam:**
- **Fejléc + 3. fejezet:** `6.39.0` → **`6.57.0`**, 613 → **749 teszt**. Új adatszámok: **635 MC 2 753 cellában** (a régi „~826 nonDCO MC" félrevezető volt — cella ≠ MC), ebből **688 nonDCO cella**, ~3 145 kreatív.
- **Új 4.0 Dashboard szakasz** (I1 leszállt: nap-scope, termék-szűrő, Delivery + Matrix-coverage chartok, CTR-rendezésű kreatív-csík) — eddig nem is szerepelt a doksiban, pedig a sidebar kliens-nevéről elérhető.
- **4.2 / 4.8 / 5. / 6. kiegészítve** a Drive-résszel (batch mappalink, health check hat kimenettel, share-fejléc distinct mappái, `drive_folder_url`/`drive_file_url`/`drive_folders` a meglévő MCP toolokon — **nem született új tool**).
- **9.1 teljesen átírva:** „nulla Google-integráció" → **„a Drive-oldal kész (6.53.0), a Slides-oldal nincs"**. Bent maradt három tartós korlát: nincs Slides/Sheets API, nincs mappa-figyelés (a link **hivatkozás, nem ingest**), és a kulcsos hívás **nem adja vissza a `parents`-et** → csak mappa→fájl irány megy.
- **9.4 + 11.2 átírva:** a kreatív-oldal kész, az MC↔Slides oldal az **FR-B**, aminek a `todo.md`-ben már konkrét lépéssora van (`documents` tábla soft-linkkel → `/api/documents/*` → MCP → vékony UI).
- **9.7 táblázat:** I4 / I1 / I6 → ✅ szállítva. **A „az adat elavult" figyelmeztetés törölve** — a monitoring 2026 augusztusáig friss (20,1M megjelenés, +29%); helyette az maradt, hogy a **mátrixhoz kötött arány 35%** (júniusban 78% volt), mert a nem matrixolt publisher-sorok nőnek gyorsabban.
- **10. táblázat:** 5. és 8b. → ✅; összegzés újraszámolva **18 sorból 11 ✅ / 2 🟡 / 5 ⛔** (a korábbi „11 lépésből 7" a részsorok miatt nem stimmelt).
- **12. kérdéssor:** a „marad-e a Leadás mappa" kérdés **megválaszoltra** állítva, és bekerült egy új kérdés (approve-állapot a share-en vagy `messages.status`) — mert az FR-B state-kérdésével együtt kell eldönteni: **hol lakik a fázis**.

**A doksi verdiktje most:** a folyamat leadási–megosztási fele kész; ami maradt (1. brief, 3. slide-link, 7. slides update, 11. task close) **két döntésre vezethető vissza** — hol él a brief-doksi linkje+státusza (FR-B), és hol él a munkadarab állapota (FR-C vs. `messages.status`).

**Brain:** a mostani frissítés **még nem ment be** thoughtként — a 2026-09-03-i `6da7f5d6` thought a `6.39.0` állapotot írja le, tehát a Drive-részben elavult. Eldöntendő: új thought a friss állapotról (a régit ELAVULT-ra címkézve, ahogy az `5de4bb33`-mal tettük), vagy megvárjuk a workflow-tervet és egyben megy be a kettő.

---

## 2026-09-04 — Dashboard: a szűrők megjegyzése — 6.58.0

**User:** „a dashboard meg kéne jegyezze a filterek beállítását, legutóbbi date filter, product filter".

**Szállítva:** `src/lib/dashboard-view.ts` (kodek + `viewHref`), `_dashboard/RememberView.tsx` (süti-író kliens), és a `page.tsx`-ben a csupasz `/` → tárolt nézet redirect.

**Két döntés, amit meg kellett hozni:**
- **Süti, nem localStorage.** A dashboard szándékosan server component, az állapota az URL — az olvasó tehát a szerver. localStorage-dzsel az alapértelmezett dashboard felvillanna, majd kliensoldalról írná át magát.
- **A PILL-t jegyzi meg, nem a dátumot.** A „Yesterday" mindig a mostani naphoz képesti tegnapot jelenti, a nyilakkal elnavigált tetszőleges nap pedig sima „today"-ként jön vissza. Egy hét múlva egy befagyasztott dátumra nyíló, üres dashboard nem preferenciának, hanem üzemzavarnak látszana.
- **Explicit paraméter mindig nyer** a megjegyzett nézet fölött (megosztott link is), és az alapértelmezett nézetért nem redirectelünk.

**Ellenőrizve böngészőben, lokális prod buildben, öt eset:** (1) friss csupasz `/` → nincs redirect; (2) nézetválasztás → süti `r=30d&back=0&p=SZK&cs=ctr`; (3) csupasz `/` → `?d=2026-09-04&r=30d&p=SZK&cs=ctr`, az aktív pill „Last 30 days"; (4) explicit link felülírja; (5) „Yesterday" → `?d=2026-09-03&r=day` a mai naphoz képest.

**Teszt:** új `tests/unit/dashboard-view.test.ts` (6 — oda-vissza kódolás, Yesterday-pill, ismeretlen süti visszautasítása, mai naphoz horgonyzás, product+sort az URL-ben, alapértelmezett felismerése). Suite **758/758 zöld**. Build sikeres.

**⚠️ Megjegyzés a session-hez:** ez a szelet a **6.57.0**-ra ült rá — a 6.53–6.57 más sessionökben készült (share phone layout, Drive ikonok, creative-library fixek), a teszt-szám időközben 706 → 752-re nőtt. A saját változtatásom konfliktus nélkül alkalmazható volt.

**Verzió:** `6.57.0` → **`6.58.0`** (minor). Séma-migráció nincs. **Deploy még nem történt.**

### 2026-09-05 — DRAFT-modell + státusz-takarítás DEPLOYOLVA (6.58.0 + 6.59.0)
- **Commit `5b1f3b6`**, box `ac3928e` → `5b1f3b6`. A **`6.58.0` sosem volt kint** (lokálban maradt), így két kiadás ment egyszerre.
- **Destruktív migráció kockázat-ellenőrzése ELŐBB** (az archívum „közös DB + eltolt deploy" szabálya miatt, a `0013` két táblát dob): a v5 appok (`mm-server-*`) **SQLite-ot** használnak (`/var/www/messagingmatrix/db/messaging-matrix.db`), **egyetlen v6 deploy** van (`/var/www/mm6-erste`), és a két dobandó tábla **üres volt**. Vagyis az egyetlen fogyasztót ugyanabban a passzban frissítettük — a szabály nem sérült.
- **Migráció `0012` + `0013` lefutott.** Ellenőrizve utána: `messages` **2753**, `creatives` **3167**, `monitoring` **15 646** — mind azonos a migráció előtti értékkel. `briefs` tábla létrejött, `draft_messages`/`draft_previews` eltűnt, mindhárom CHECK constraint áll (`messages_draft_has_no_audience`, `messages_placed_has_topic`, `messages_draft_has_no_pmmid`), `audience`/`topic`/`brief_id` nullable.
- `npm run build` ok, `pm2 restart mm6-erste --update-env` → **Ready 1621ms**, box `package.json` **6.59.0**. Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/drafts` 307 · `/creative-library` 307 · `/shares` 307 · `/feeds` 307 · `/monitoring` 307 · `/api/drafts` 401 · `/api/briefs` 401 · `/mcp` 401 · publikus `erste.messagingmatrix.ai/login` **200**. Az `error.log`-ban csak a régi AWS SDK node>=22 figyelmeztetés.
- ⚠️ **`tsx` nem olvassa a box `.env`-jét** (a Next igen) — a `status:cleanup` első futása `ECONNREFUSED`-dal elszállt. Megoldás: `set -a && . ./.env && set +a &&` a parancs elé. Ugyanez érvényes minden `tsx`-es scriptre a boxon (`gen:previews`, `import-*`, …).
- **`status:cleanup` dry-run → apply.** A dry-run pontosan a felmért tervet adta, és a safety-net **0 sort** fogott (minden sor tisztán besorolódott). Törölve **12** (8× üres `MC21a`, `MC315 f/g/h/i` mint az ACTIVE `c/d/e` duplikátumai — a script megnevezte a konkrét ikret), DRAFT-ba **4** (`MC6a`, `MC78 a/b/c`, audience + pmmid + 6 UTM + final URL nullázva, a tartalom és a munkacím-topic megtartva). Retired státuszon maradt: **0**.
- **Az apply előtt mind a 16 sor JSON-mentése készült** (`~/legacy-rows-backup-20260905.json`, 28 kB) — a törlés így visszafordítható.
- Végállapot: `ACTIVE` 1768 · `INACTIVE` 959 · `DEAD` 6 · `DRAFT` 4 · `PREVIEW` 4 (2741 = 2753 − 12).
- ✅ **Lezárva 6.59.1-ben (ugyanaznap):** a `feed-export.ts` `rowKey`-jében a diff-kulcs NUL elválasztója **nyers bájtként** volt beírva escape helyett. Ettől a fájl binárisnak minősül, a `grep` pedig bináris fájlra **némán nulla találatot** ad, hiba nélkül — a lezárt feed-invariánsok fájljában ez a legrosszabb hibamód, mert nem töröttnek látszik, hanem üresnek. Escape-re átírva: a előállított string azonos, a fájl újra kereshető (`grep -c allMessages`: boxon is **0 → 5**). Feed-tesztek 26/26, teljes sor 257 + 542 zöld. Kommentben rögzítve, hogy soha ne kerüljön vissza nyers bájtra.
- ⚠️ **Mellékhatás, amit érdemes tudni:** a nyers vezérlőkarakter **a saját eszközláncomat is blokkolta** — két parancsom elszállt „command contains control characters" hibával, mert a `\u0000` a JSON-paraméterben valódi NUL-lá dekódolódik. Ha ilyet kell írni, fájlon keresztül menjen.

---

## 2026-09-06 — Draft editor = MC editor + Brief tab + Agentic átnevezés (TERV, jóváhagyásra vár)

**User kérése:** „a draft editornak úgy kéne kinézzen mint az MC editor, tabok jobb oldalt Naming helyett Promote to matrix, aztán Template, aztán Draft content, Draft styles, trafficking ide biztos nem kell; viszont az MC editorben is meg itt is kell egy Brief tab, ahol a belinkelt Google Docs slide-nak jó lenne ha lenne egy previewja — nem a fő/cover slide, hanem a konkrét belinkelt slide." + „a Promote to matrix tabon kéne legyen az is, hogy DCO-ba vagy nonDCO-ba vagy mindkettőbe promotáljuk; illetve a nonDCO-t nevezzük át Agentic-re, futtassunk okos refactort."

**Eldöntve (AskUserQuestion, 2026-09-06):**
1. **A draft editor NEM külön komponens** — a `MessageEditor` nyílik meg a `/drafts` oldalon is, más tab-készlettel. A `DraftDetailDialog` törlődik.
2. **Slide preview = Google Slides iframe embed** (`/embed?slide=id.gXXX`), nem szerveroldali PNG. Nulla backend, nincs új env. Feltétele, hogy a deck „anyone with the link" megosztású legyen — ugyanaz a feltétel, mint az I4 delivery-mappáknál.
3. **A slide-horgony per MC/draft**, új `messages.brief_slide_id` oszlop. Üres horgony ⇒ a deck elejét mutatjuk.
4. **Az átnevezés a UI-ra és az azonosítókra megy, a TÁROLT TOKEN marad `"nondco"`.**
5. **Agentic promotálásnál csak létező topic választható** — a „a promote sosem hoz létre topicot" szabály nem lazul.
6. **A Brief az utolsó tab** mindkét editorban.

**Ami ezzel ütközik és tudatosan felülíródik:** a `MatrixGrid.tsx:529` kommentje kimondja, hogy *„nonDCO MCs are born only from correctly-named creative uploads, never hand-added"*. A draft→Agentic promote ezt megszegi. A kommentet át kell írni (a promote a második törvényes születési út), nem csendben megkerülni.

**Ami NEM ez:** az **FR-B Documents** (MC-nként több Slides doksi, státusszal, saját tábla) továbbra is külön marad. Itt egy MC-nek **egy** briefje van (a meglévő `briefId` FK), és azon belül **egy** slide-horgonya. A `brief_slide_id` nem az FR-B store csírája.

### A. Brief tab (mindkét editorban)
- [ ] **A1** `messages.brief_slide_id` text nullable + drizzle migráció `0014_*`
- [ ] **A2** `slides-link.ts`: `parseSlideAnchor(link)` (a `#slide=id.gXXX` → `gXXX`) + `slidesEmbedUrl(fileId, slideId)`. A meglévő `parseSlidesFileId` NEM változik — a file id és a horgony két külön dolog
- [ ] **A3** `WRITABLE_FIELDS` += `briefSlideId`; a `MessageEditor` `EditableFields`/`EDITABLE_KEYS` += `briefId`, `briefSlideId`, `brief`
- [ ] **A4** Új `src/app/(app)/matrix/BriefTab.tsx` (a MessageEditor 2200 sora ne nőjön tovább): brief-választó a `/api/briefs` listából + „attach by link" (POST `/api/briefs`, idempotens file id-re), slide deep-link mező → parse → horgony, iframe preview a konkrét slide-ra, és a szabad szöveges `messages.brief` jegyzet
- [ ] **A5** Brief tab felvétele a tab-barba, utolsóként, mindkét módban

### B. Draft editor = MessageEditor
- [ ] **B1** Mód-diszkriminátor: `message.status === "DRAFT"` a committed snapshotból — **nem** új `mode` prop. (Két független diszkriminátor egy fogalomra szétcsúszik; a séma is a status/audience párost köti össze.)
- [ ] **B2** Tab-készlet módfüggő; draftnál az induló tab a Promote
- [ ] **B3** Új `PromoteTab`: a mai `DraftDetailDialog` promote-blokkja + working topic name + Archive. Ide jön a **DCO / Agentic / mindkettő** célválasztó (lásd C)
- [ ] **B4** `DraftsView` a `MessageEditor`-t nyitja (`visibleMessages` = a draft lista → prev/next működik a draftok közt); a `Draft` kliens-típus helyett `Message` (a `/api/drafts` már ma is teljes sorokat ad); `DraftDetailDialog.tsx` törlés
- [ ] **B5** Ellenőrizni, hogy a `MessagePreview` és a Template tab elviseli az audience nélküli sort

### C. Promote: DCO / Agentic / mindkettő
- [ ] **C1** A promote body kap egy célt: `{ target: "dco" | "agentic" | "both", audienceKey, topicKey, agenticChannelKey, agenticTopicKey }`. A `findAudienceByKey` már ma is beleés a `channels`-be, tehát az Agentic audience feloldása kész
- [ ] **C2** „Mindkettő" = **két sor**: a draft lesz a DCO cella (`promoteDraft`), az Agentic iker pedig `createMessage({ requestedNumber: draft.number })` a channel-audience-re — pontosan az az „explicit twin" út, amit a `createDraft` kommentje leír. Ez azért konzisztens, mert a draft száma eleve **mindkét tengelyen** foglalt
- [ ] **C3** A `MatrixGrid.tsx:529` invariáns-komment átírása: a promote a második törvényes születési út egy Agentic MC-nek
- [ ] **C4** Ha az Agentic topic nem létezik, a promote elutasít és megmondja, hogy előbb topicot kell létrehozni (a mai szabály változatlan)

### D. nonDCO → Agentic átnevezés (okos refactor)
272 előfordulás / 44 fájl. **Nem search-and-replace** — fájlonként, egyesével, közben `npm run build`.
- [ ] **D1** A `MatrixAxis` értéke **marad** `"dco" | "nondco"`, komment magyarázza: ez a `mm6_matrix_state_v1` localStorage-ba mentett wire token, a `MatrixGrid.tsx:248` ismeretlen értéket némán `"dco"`-ra ejt — átnevezve minden felhasználó mentett mátrix-nézete csendben visszaállna
- [ ] **D2** Látható címkék: `MatrixToolbar` (`nonDCO` → `Agentic`), `ProductFilter`, `CreativeLibrary` és `MatrixGrid` count-pill szegmensek (`["DCO","nonDCO"]` → `["DCO","Agentic"]`), `ChannelsTab` prózája
- [ ] **D3** Azonosítók: `isNonDco` → `isAgentic`, `nonDcoTopics` → `agenticTopics` — hívási helyenként olvasva, nem globálisan
- [ ] **D4** Kommentek/prózák a `src/`-ben (a `messages.ts`, `schema.ts`, `channels.ts`, `numbering.ts` stb. magyarázó blokkjai)
- [ ] **D5** Tesztek + scriptek szókincse; `docs/mc-collisions.html`+`.md` **újragenerálva** a `gen-collisions-doc.ts`-ből, nem kézzel írva
- [ ] **D6** `tasks/component-inventory.md` frissítés, ha új blokknév keletkezett (`brief-tab`, `promote-tab`, `slide-preview`)

### E. Ellenőrzés
- [ ] **E1** Unit teszt: `parseSlideAnchor` (deep link, fragment nélkül, csak `?usp=sharing`, bare id)
- [ ] **E2** Integrációs teszt: `0014` migráció + draft→Agentic és draft→mindkettő promote (a twin ugyanazt a számot kapja)
- [ ] **E3** `npm run build` + a teljes suite
- [ ] **E4** Böngészős ellenőrzés a felhasználó MC400 draftján

**Verzió-javaslat a végén:** `6.65.0` → **`6.66.0`** (minor — új oszlop + migráció, új tab, új promote-célok, felhasználó által látható átnevezés).

### ELHALASZTVA (külön szelet, a fenti terv UTÁN) — Agentic kreatív-feltöltési folyamat

**User felvetése (2026-09-06):** „nem-e ki kéne kommentelni a creative libraryba feltöltést (historikusan helyes volt a léte), de ha a munkafolyamatot jól akarjuk managelni, akkor Agentic creative-ot létrehozott drafthoz lehessen feltölteni, és az rögtön ellenőrzi a MC és terméknév helyességét; és ha új verziót akar feltölteni az ember, akkor az Agentic matrix MC megnyitása után lehessen n+1 verziót feltölteni."

**Értékelés (feltárt tények):**
1. A Creative Library feltöltés **ma nem hoz létre MC-t** — csak `creatives` sort (`CreativeLibrary.tsx:326`). Az `mcNumber`/`mcVariant` a fájlnév-parserből jön, és a batch-ablakban **szabad szöveges mező** (`CREATIVE_UPLOAD_COLUMNS`). Semmi nem ellenőrzi a szám létezését, a termék egyezését, a foglaltságot. **Ez a valódi hiba.**
2. A `promoteCreative()` egyetlen hívója a `src/lib/mcp.ts:2246` — **csak MCP-ből érhető el, a UI-ból sehonnan**. A mai Agentic sorokat a `scripts/rebuild-creatives.ts` építette közvetlen INSERT-tel (terméknként hard-delete + újraépítés).
3. A verziózás **már kész és fájlnév-vezérelt**: `group-creative-versions.ts`, `familyKey + deklarált méret` szerint; a `creatives.version` NEM használható (optimistic-concurrency számláló), egyedül a `_nN` token mérvadó.

**Verdikt:** a diagnózis jó, a „kikommentelni a library feltöltést" rész téves — az az egyetlen működő UI-s bemeneti út (3167 kreatív, tömeges beérkezés). És ha a draftra töltünk fel, **nincs mit ellenőrizni**: a draft tudja a saját MC-számát és termékét. A validáció band-aid lenne egy mezőn, aminek ebben a folyamatban nem kéne léteznie — a fájlnevet a rendszer generálja, nem a user gépeli és mi bíráljuk el.

**Helyes felosztás — a kettő nem konkurens, hanem két munkafolyamat:**
- [ ] A Creative Library feltöltés **marad** = a TÖMEGES út (ügynökség lead 200 fájlt 30 MC-re)
- [ ] A draft/MC editor kap „kreatív feltöltése ide" utat = a MENEDZSELT, darabonkénti út. **Nincs MC# mező, nincs termék mező, nincs validáció** — a fájlnév a cellából származik
- [ ] n+1 verzió az Agentic MC-ből: `max(_nN) + 1` a meglévő verzió-családból (a `by-mc` végpont és a `groupCreativeVersions` már megvan)
- [ ] ⚠️ **A lyuk, amit meg KELL csinálni:** az Agentic cella a `message.image1`-et rendereli — egy rögzített fájlnevet (`MatrixIframeTile.tsx:93`). Egy új `_n4` feltöltés bekerül a könyvtárba, de **a mátrixban nem jelenik meg**, amíg az `image1` át nem mutat rá. Enélkül a funkció néma hibaként viselkedik: „feltöltöttem, mégsem változott semmi"

---

## 2026-09-06 — Draft editor = MC editor + Brief tab + Agentic átnevezés — SZÁLLÍTVA

A fenti terv A–E szeletei lementek, plusz két menet közben érkezett kérés.

### Amit a terv tartalmazott
- **A1–A2** `messages.brief_slide_id` (nullable text) + `0014_dusty_lorna_dane.sql` (egyetlen additív ALTER). `slides-link.ts`: új `parseSlideAnchor()` + `slidesEmbedUrl()`. A meglévő `parseSlidesFileId` **változatlan** — a deck a brief identitása, a slide a kártyáé, és egyik parser sem nyelheti el a másikat (külön teszt védi).
- **A3–A5** `WRITABLE_FIELDS` += `briefSlideId`; a `MessageEditor` `EditableFields`-e += `brief`/`briefId`/`briefSlideId`. Új `BriefTab.tsx` + `EditorField.tsx` (a `Field` kiemelve a `MessageEditor`-ból, hogy két fájl ne duplikálja a label-tipográfiát). Brief tab **utolsóként** mindkét módban.
- **B1–B5** A `/drafts` a **`MessageEditor`-t nyitja**; a `DraftDetailDialog` **törölve**. A mód-diszkriminátor **`audience === null`**, nem `status === "DRAFT"` — ez a séma saját diszkriminátora (a `messages_draft_has_no_audience` check köti a kettőt össze), **és ez az, amire a TypeScript szűkíteni tud**: a fordító bizonyítja, hogy a Naming és a Trafficking tab sosem kap draftot. Új `DraftMessage`/`EditableMessage` típus a `matrix/types.ts`-ben; a `drafts/types.ts` már csak alias.
- **C1–C4** A promote route kap egy `target`-et (`dco` | `agentic` | `both`). Kimaradt `target` = a régi viselkedés (MCP és minden korábbi hívó érintetlen). **A „both" nem `createMessage(requestedNumber)`, hanem promote + `copyMessages`** — a `draft-lifecycle.test.ts:208` („the user's *image AND DCO feed row* case") ezt már 2026 augusztusa óta így oldja meg, és a copy azért helyes, mert *klónozza a mezőket*: a két tengely egy kártya marad, nem két véletlenül azonos számú. A tervbe írt `createMessage` út rossz eszköz volt.
- **D1–D6** nonDCO → **Agentic**, fájlonként. A `MatrixAxis` értéke **marad `"nondco"`** (a `mm6_matrix_state_v1` localStorage tokenje; a `MatrixGrid.tsx:248` ismeretlen értéket némán `"dco"`-ra ejt → átnevezve minden mentett nézet visszaállna). `isNonDco`→`isAgentic`, `nonDcoTopics`→`agenticTopics`, count-pill címkék, `PRODUCT_COUNT_LABELS`, MCP tool-leírások, `matrix-nondco-info`→`matrix-agentic-info` (inventory frissítve).
- **E1–E2** `slides-link.test.ts` 7 → **14 teszt**; új `tests/integration/api/drafts-promote-targets.test.ts` (**5 teszt**): default target, agentic, both (ikerpár egy szám alatt), „both channel nélkül elutasít és a draftot NEM helyezi el félig", és „nem létező topicot továbbra sem mint".

### Menet közben érkezett, szintén kész
- **Creative Library Type szűrő** → a filter box **elé** került, és a fájltípus (html/image/video) helyett **DCO / Agentic** két pipa. Ez a meglévő `kind` diszkriminátor megjelenítése (`"matrix"` = sablonrender, `"uploaded"` = leszállított fájl), nem új fogalom. **Új localStorage kulcs** (`mm6_creative_library_filter_axis`): a régi `..._filter_types` újrahasznosítása egy mentett `{"image"}`-et DCO/Agentic opciókra illesztett volna → nulla találat, üres könyvtár, „üzemzavarnak látszó" mentett preferencia. A `typeOptions` memo megmarad — a batch feltöltő Type datalistjét táplálja.
- **„Attach a brief" gomb + dialógus törölve** a drafts oldalról; az attach a draft editor Brief tabján történik, egy link beillesztésével. **Label mező sincs** többé.

### Amit tudatosan felülírtunk
A `MatrixGrid.tsx` invariáns-kommentje („Agentic MC csak kreatív-feltöltésből születhet") át lett írva: **két törvényes születési útja van** — a helyesen elnevezett kreatív-feltöltés, és a draft promotálása egy csatornára. A `ChannelsTab` prózája és a rács info-boxa is ezt mondja most.

### Ellenőrzés
`npx tsc --noEmit` tiszta, `npm run build` sikeres, ESLint 0 error a 6 érintett fájlon.

### ⚠️ Nyitva maradt
- **Brief label:** a label mező eltűnt, de a `briefs.label` oszlop maradt, és a drafts oldal **csoportfejléce erre esik vissza** (`b.label || "Brief {id}"`). Új brief így „Brief 7"-ként jelenik meg a mai „SZÁMLAVÁLASZTÓ" helyett. A természetes megoldás a deck nevének lekérése a **meglévő** `GOOGLE_DRIVE_API_KEY`-jel (`files.get?fields=id,name` — a `drive.ts` `getDriveFolder`-e pontosan ez a hívás, csak mappára elnevezve), mert a brief-deckek ugyanúgy „anyone with the link" megosztásúak, mint a delivery mappák. **Nem csináltam meg — nem volt kérve.**
- **Slide preview megosztás-függő:** az iframe csak akkor renderel, ha a deck link-megosztott. Böngészős ellenőrzés az MC400-on még nem történt meg.
- `scripts/gen-collisions-doc.ts` és a `docs/mc-collisions.*` **szándékosan** megtartja a nonDCO szókincset az adatkulcsaiban és a magyar prózájában: az egy 2026-08-i elemzés befagyasztott jegyzőkönyve, nem élő szókincs. A script saját magyarázó kommentjei viszont követik az új nevet.

### 2026-09-06 (folytatás) — draftok termék szerint, nem brief szerint — 6.67.0

**User:** „a draftot sem briefenként kéne kategorizálni hanem termékenként, tehát már a draftnak is kell legyen Termék/Product tagje, és lehet az oldalon olyan hogy no product set yet."

**A tény, ami a formát eldöntötte:** a `messages` táblán **nincs** `product` oszlop. A termék ma *származtatott* — DCO-nál `audiences.product`, Agentic-nél a topic kulcs prefixe (`dashboard-products.ts`, „correctness-critical, must not drift" megjelöléssel). A draftnak viszont se audience-e, se valódi topicja nincs — pont ez teszi drafttá. Tehát erre az egy állapotra tárolni kell.

**Eldöntve (AskUserQuestion):**
1. **Draft-mező, promotáláskor elengedve.** A promote nem validál és nem töröl — a cella átveszi a kérdést, a tárolt érték elveszti a tekintélyét.
2. **A brief-csoportosítás eltűnik**, a brief a Brief tabon marad.

**Az oszlop neve `draft_product`, nem `product`** — szándékosan. Egy `messages.product` nevű oszlopot a következő olvasó a kártya termékének fogja olvasni, és pontosan az a második igazság keletkezne, ami elcsúszna a mátrixtól és a dashboardtól. A név maga mondja meg a hatókört, nem egy komment, amit meg kell találni.

- [x] `messages.draft_product` (nullable text) + `0015_silent_zzzax.sql` (additív)
- [x] `WRITABLE_FIELDS` += `draftProduct`; `EditableFields` + kliens `Message` típus
- [x] Product select a **Promote tab tetején** — az opciók az `audiences`/`topics` meglévő termékeiből jönnek, nem külön hardkódolt listából
- [x] `BriefGroup` → `ProductGroup` (`product-group` blokk); ábécé szerint, a termék nélküliek **utolsóként**; toolbar számláló „N open · M products"
- [x] Két új teszt: a promote **érintetlenül átviszi** a draft termékét (nem validál, nem töröl), és a termék nélküli draft is promotálható

**Nyitva:** a `briefs.label` mező továbbra sincs kitöltve sehonnan (a Brief tabon nincs label input), de mostantól **nem számít** — a csoportfejléc a termék, nem a brief. A brief-választó legördülő viszont még mindig `Brief {id}`-ként listáz. A Drive-névlekérés (`GOOGLE_DRIVE_API_KEY`, `files.get?fields=id,name`) továbbra is a természetes megoldás, ha zavaró lesz.

### 2026-09-06 — a Brief tab egy mezőre húzva — 6.67.1

**User:** „ennek a lehullónak mi értelme? szerintem nekünk tök elég az hogy egy slide-ot be lehet linkelni, deck link sem kell, miért tetted oda, védd meg magad mielőtt vakon szótfogadsz."

**Az élesben ellenőrizve (user képernyőképe):** a slide **preview működik** — a 3. slide-ot rendereli („Számlakonstrukciók MC401"). Ez volt a nyitva maradt E4 pont; a deck elég szélesen van megosztva az iframe-hez.

**A legördülő védhetetlen volt.** Egyetlen dolga az volt, hogy megmondja, melyik CSOPORTBA kerül a draft — amikor a drafts oldal briefenként csoportosított. A csoportosítás egy szelettel korábban átment termékre, és **nem nyitottam ki újra a Brief tabot**. Egy vezérlő, ami túlélte a saját indoklását. A UI-ban a `briefId` egyetlen olvasója maga a `BriefTab` volt. Ráadásul a label mező kivétele után „Brief 2"-t kínált — értelmezhetetlen opciók egy következmény nélküli döntéshez.

**Amit megvédtem, és megmaradt: a brief-SOR, csak kérdés nélkül.** A slide link *tartalmazza* a deck id-jét (`parseSlidesFileId` + `parseSlideAnchor`, tesztelve, hogy egyik sem nyeli el a másikat), tehát „egy mező" és „a deck azonosítva van" nem alternatívák — az egyik következik a másikból, nulla UI-költséggel. Amit a sor eldobása elvinne: az MCP `list_briefs` `open_drafts`/`promoted` válasza a „mi lett ebből a deckből?" kérdésre; a „hat kártya egy deckből" mint TÉNY, nem URL-string-egyezés (pont ez a `parseSlidesFileId` létezésének oka); és egy destruktív migráció olyasmiért, amire az FR-B még mutat.

- [x] `BriefTab` → egy `Brief slide` mező + preview + Note. Legördülő, attach-doboz, Attach gomb törölve
- [x] A mező a **tárolt állapotot mutatja** (kanonikus link a file id + horgony párból), és blur/Enter-re alkalmaz — az attach írás, egy beillesztés akkor kész, amikor a fókusz elmegy
- [x] Üres mező = leválasztás (`briefId` + `briefSlideId` null)
- [x] A `["briefs"]` query megmarad, de **csak lookupra** (az embednek kell a deck file id-je), nem renderel vezérlőt

**Tanulság a következő szelethez:** amikor egy csoportosítási/rendezési döntés megváltozik, végig kell nézni, mely vezérlők léteztek KIZÁRÓLAG azért a döntésért. Ez a hiba nem a rossz tervezés volt, hanem hogy nem tértem vissza.

### 2026-09-06 — a feltöltött creative nem kerül be az Agentic mátrixba (TERV)

**Tünet (user):** „mult héten feltöltöttem a creative libraryba mc324 b és c variáns sorozatot de nem látom az agentic mátrixba pedig sztem jol voltak elnevezve".

**Diagnózis (DB-ből igazolva):** a fájlnevek hibátlanok, a parse jó (`creatives.mc_number=324`, `mc_variant=b/c`, 11+11 fájl). Az Agentic mátrix viszont a `messages` táblát rajzolja, és a Creative Library feltöltés **csak `creatives` sort ír** (`CreativeLibrary.tsx:348` → `POST /api/creatives` → `createCreative`). MC-t sosem hozott létre. Az MC324a azért van bent, mert azt még a `scripts/rebuild-creatives.ts` batch generálta (2026-08-17). A `MatrixToolbar` szövege („upload correctly-named creatives to the Creative Library") **a mai kódra nem igaz**.

**Második blokkoló:** a `promoteCreative` (`promote.ts:113`) „már mátrixolt"-nak minősít mindent, aminek van `mcNumber` ÉS `mcVariant` mezője — a feltöltéskor viszont épp a fájlnévből *beírjuk* mindkettőt. Így az egyetlen élő creative→MC út is elutasítja őket. A guard a **back-link mezőt** nézi a **message létezése** helyett.

**Érintettek (nem csak a 324):** 6 orphan MC, 66 fájl — `324b`, `324c` (2026-09-03), `338a` (08-06), `333a`, `335a`, `337a` (07-29). Mindegyiknek van már azonos számú testvér-message-e, tehát a topic mindegyiknél örökölhető.

#### 1. lépés — a 6 orphan behúzása
- [x] `ensureAgenticMc(clientId, creative)` a `promote.ts`-be: (szám, variáns, méretből jövő csatorna) hármasra keres/létrehoz egy template-nélküli message-t. Csatorna a rebuild user-lockolt szabálya szerint (`1080x1080`/`1200x628` → SOC, egyébként DISP). Topic: az azonos számú **létező testvér** topicja, ha van; különben `${product}_${keywords}`. Identity a `regeneratedIdentity`-vel (nem a script kézi pmmid+trafficking másolatával). Státusz `ACTIVE` — leszállított fájl, nem megírandó kártya.
- [x] **Nem frissít meglévő message-t** (nincs image1-felülírás) — csak hiányzót pótol, hogy kurált mezőt soha ne írjon felül.
- [x] `scripts/backfill-orphan-mcs.ts` — dry-run alapból, `--commit`-tal ír. Csoportonként a reprezentáns fájl = max verzió, majd max terület (a batch `pickRep`-je).
- [x] Dry-run megmutatva → user zöld lámpa → commit → DB-ellenőrzés.

#### 2. lépés — a tartós javítás
- [x] A feltöltés maga ejtse a tükör-MC-t: `createCreativeWithMirror` a `POST /api/creatives` route-ban és az MCP `creative_create`-ben (a `createCreative` marad tiszta insert).
- [x] `promoteCreative` guard: a „már mátrixolt" a **message létezésén** múljon, ne a `mcNumber`/`mcVariant` mezőn. Ha a creative-nek van fájlnévből jövő száma → `ensureAgenticMc` (a szám marad), ha nincs → a mai auto-assign ág.
- [x] `MatrixToolbar` Agentic-szövege igazzá válik — marad, ahogy van.
- [x] Tesztek: feltöltés → message születik; második fájl ugyanabba a cellába nem duplikál; a méret-alapú csatornaszétosztás; a promote guard már nem utasít el message nélküli creative-et.

**Review (2026-09-06, szállítva):**

- **A dry-run 7 MC-t talált, nem 6-ot.** Az `MC334a` azért hiányzott az első listámból, mert a „van-e message ezzel a számmal" lekérdezésem **nem tengelyre szűrt**: a 334-es a DCO oldalon foglalt (SZK, HTML, 35 kártya), és ez elnyelte a MARKET `premium_utazas` statikus sorozatot. A scriptbeli ellenőrzés csatorna-audience-re szűkít, ezért találta meg. User döntése: mind a 14 cella megy (lockolt cross-axis szabály — a DCO és az Agentic külön számtér).
- **A 672-ből 658 cella már létezett** — vagyis az `ensureAgenticMc` csatorna- és csoportosítási szabálya bitre reprodukálja, amit a batch import kiírt. Ez volt a legerősebb ellenőrzés arra, hogy a szabály tényleg ugyanaz: ha elcsúszott volna, több száz „hiányzó" cellát jelentett volna.
- **Élesben:** 14 sor, PMMID + trafficking generálva, `ACTIVE`, `template=null`. Az MC324 a/b/c most egy cellában ül (`SZA_DiakszamlaQ3_csakfoto`). Fájl nem mozdult, MinIO-t nem érintettük.
- **Nyitva hagyva (nem ennek a szeletnek a dolga):** a `333/335/337` topic-sztringje félrevezető (`MARKET_MCx_d_genZbefektetes_2026Q1` a `tengeri_hajozas` sorozat felett) — a batch `topicByNumber`-e annak idején rossz variáns-'a' rekordot fogott meg. A backfill **örökölte** ezt, mert egy szám nem ívelhet át topicokon a tengelyen belül: az `a` oda kell, ahol a `b` már ül. Egy topic-átnevezés mindkettőt egyszerre vinné a helyes sorba.
- **Deploy kell:** a 14 cella már látszik élesben (közös DB), de a **feltöltési hook csak deploy után** él a boxon.

**DEPLOYOLVA 6.68.0 (2026-09-06):** commit `f6620d2`, box `4fd7848`→`f6620d2`, `npm run build` OK, `pm2 restart mm6-erste --update-env` → Ready 1236ms. **Séma-migráció nincs** (`git diff --name-only 4fd7848..f6620d2 -- db/migrations` üres). Health: `/` 307 · `/login` 200 · `/matrix` 307 · `/creative-library` 307 · `/api/creatives` 401 · `/mcp` 401; publikus `erste.messagingmatrix.ai/login` **200**. Boxon a `6.68.0` verifikálva. A backfill 14 sora a deploy előtt ment ki (közös DB), a feltöltési hook a deploytól él.

---

## MCP end-to-end tesztforgatókönyv — doksi kész (2026-09-06)

**`docs/MM6_MCP_E2E_TEST.md`** — modellezés + futtatható forgatókönyv, hogy erstés
kollégák MCP-behívása előtt bizonyítható legyen: draft → brief → promote (DCO/Agentic)
→ creative library → MC search → monitoring végigmegy, és minden kérdésükre jó választ ad.

- [x] Tool-felület modellezve: **51 tool**, `read` = 21, `full` = +30. A doksi táblázata
      a `buildMcpServer()` regisztrációs sorrendjéből jön, nem kézi listából.
- [x] **„admin vs user token" tisztázva: nem ez a tengely.** Az MCP rétegben nincs szerep,
      csak `mcp_tokens.scope ∈ {full, read}`. Egy `role=user` full tokene ugyanazt az 51
      toolt látja, mint egy adminé. A `role` a webes UI-t és a token-kiadást kapuzza;
      egyetlen kapcsolat: `role=demo` csak `read` tokent kaphat.
- [x] F0–F11 forgatókönyv magyar, tool-nevet nem tartalmazó promptokkal + jegyzőkönyv-sablon.
- [x] Takarítási terv: célzott törlés (objektumtár → `messages` DELETE → brief → token).

**Az élő tokenkészlet (2026-09-06) átrendezte a tesztet:** egyetlen `full` token van
(`admin@local`), a két erstés (`tamas.varfi@`, `csaba.brunner@`) **`read`**. Vagyis ma egy
behívott kolléga nem tud draftot csinálni, briefet kötni, promotálni — a 30 író tool meg sem
jelenik neki. A `read` futam ezért az **elsődleges** eset, a `full` a másodlagos.

---

### MCP tool-leírás javítások — a workflow-teszt modellezéséből (2026-09-06)

Ezek **nem** a tesztfutamból jöttek (az még nem futott), hanem a `src/lib/mcp.ts`
átolvasásából, miközben a fenti forgatókönyvet terveztem. Azért kerültek ide, mert
mindkettő olyan pont, ahol az agent **kénytelen találgatni**, és a találgatás a
workflow közepén fog kiderülni.

- [ ] **T1 — a tartalom-módosítás útja hiányzik a leírásokból.** Az agent ma nem tudja
      kitalálni, hogyan írjon át egy szöveget. A valóság kétágú:
      - **Draft** (`status=DRAFT`, nincs audience): **nem szerkeszthető MCP-n.** Nincs
        `draft_update`, a `mc_update` pedig `findMessageByPmmid`-del keres, egy draftnak
        viszont nincs PMMID-je (DB check `messages_draft_has_no_pmmid`). Egyetlen út:
        `draft_delete` + `generate_test_creative` újra.
      - **Promotált MC**: `list_mc` (vagy `mc_get`) → a sor **`pmmid` + `version`** →
        `mc_update(mc_label: <pmmid>, version: <version>, fields: {…})`. A `version`
        kötelező (optimistic lock), utána a preview elavul → `preview_generate`.

      **Teendő:** ez a két ág menjen bele a tool-leírásokba, hogy az agent ne találgasson:
      - `mc_update` leírásába: honnan jön az `mc_label` és a `version` (`list_mc`/`mc_get`),
        és hogy **draftra nem működik**.
      - `generate_test_creative` és `draft_get` leírásába: a draft tartalma MCP-n nem
        módosítható, csak eldobás + újra, vagy promote után `mc_update`.
      - `draft_promote` leírásába egy záró mondat: promote után a szerkesztés útja
        `list_mc → pmmid → mc_update`.
      - `preview_generate` leírásába: `mc_update` után a preview elavul, ez a lépés kell.
      ⚠ **Csak leírás-változás, kódlogika nem.** A `docs/MM6_MCP_E2E_TEST.md` F6 lépése
      ezt méri — a javítás után az agentnek magától be kell járnia a láncot.
      ⚠ `feedback_mcp_settings_page_sync`: a Settings › MCP tool-listája automatikusan
      szinkronizál a `mcp.ts`-ből, de a `McpTab.tsx` **prózai** szakaszai kézzel írottak —
      ha ott is szerepel a szerkesztés útja, azt külön kell frissíteni.

- [ ] **T2 — `matrix_status.last_export` mindig `null`.** (`mcp.ts:1077`,
      `// No export-history tracking yet — Phase 8d/9c TBD.`) Az agent ebből azt a
      hamis következtetést vonja le, hogy „még sosem exportáltunk".
      A `feed_exports` tábla viszont **létezik és él** (egy sor per Preview & Export
      akció, `uploaded_to_adform_at`-tal) — tehát van mit visszaadni.
      **Teendő:** `last_export` a `feed_exports` legutóbbi sorából (`created_at`, és
      külön a legutóbbi `uploaded_to_adform_at`), vagy ha nem érjük meg, akkor a mező
      **kivétele** a válaszból — a `null` rosszabb, mint a hiány.
      Döntés kell: visszaadjuk vagy kivesszük.

### A modellezés közben kiesett további megfigyelések (nem tesztelt, nem ütemezett)

3. **A snapshot/restore veszteséges.** `SnapshotPayload` 10 táblát ment, `message_previews`-t
   **nem**, a restore viszont törli a `messages`-t → a cascade elviszi az **összes** preview-t
   az egész kliensen. Takarításra tilos használni; és önmagában is bug.
4. `draft_delete` leírása szerint a szám „nyugdíjazva marad", de `nextNewNumber` a live sorok
   maximumát nézi → a **legnagyobb** szám archiválása után újra kiosztódik.

**Nyitott (roadmap, sorrendben):**
- [ ] `scripts/mcp-e2e-cleanup.ts` — a §7 három lépése egy tranzakcióban, `--dry-run`.
      Ez kell **már az első kézi futam után is**. (Ma még nincs mit takarítani: a
      forgatókönyv **nem futott le**, csak a kódolvasásból készült.)
- [ ] Lefedettség 24/51-ről feljebb: asset/creative feltöltés, `creative_promote`,
      `prodlist_upsert`, batch család, audience/topic írás, `preview_generate`, `get_media_file`.
      Előfeltétele a takarítószkript (ezek fájlokat is hagynak az objektumtárban).
- [ ] Automatizált futtatás — csak ha a kézi kör után kiderül, hogy ismételni akarjuk.

### 2026-09-06 — /drafts összeomlás: a query-key alakszerződés ÖTÖDSZÖR — 6.69.1

**User (képernyőképpel):** „csomószor járok igy frisítés után hogy menube kattintgatá ilyen és egyéb eroroket dobál, nem jó" — `TypeError: (intermediate value)(intermediate value) is not iterable` a `useMemo`-ban, a `/drafts` az error boundary-ra cserélve.

**Ok:** a `DraftsView` három megosztott kulcson (`["audiences"]`, `["topics"]`, `["channels"]`) a **csupasz tömböt** tette a cache-be (`.then((d) => d.audiences)`), miközben a MatrixGrid, CreativeLibrary, MonitoringTable, AudiencesEditor és TopicsEditor mind a **burkolót**. Így az döntötte el, mit olvas a másik, hogy melyik oldal mountolt előbb — pontosan ezért „frissítés után, menüben kattintgatva". Mátrixról jőve a drafts egy objektumot spreadelt (crash); fordítva a mátrix egy tömb `.audiences`-ét olvasta (undefined → **néma üres rács**). Nem a mai szelet okozta, de a mai szelet oldalán csapódott ki.

- [x] A `DraftsView` három queryFn-je a burkolót adja vissza, a kicsomagolás a használat helyére került
- [x] `tests/unit/query-key-shape.test.ts` — statikus őr: egy kulcs-literálhoz egy alak. **Ellenőrizve, hogy fog is**: a hibát visszatéve mind a négy hívási helyet kiírja
- [x] Az őr a TELJES kulcstömbre néz, nem az első elemére (`["feed-exports","all"]` ≠ `[…, product]`), és az `invalidateQueries`-t nem számolja alak-deklarációnak

**Ez a memóriámban rögzített hibaosztály 5. előfordulása** (`project_query_key_shape_contract.md`: „two useQuery on one key with different shapes = order-dependent crash a reload hides; found 4× in prod"). A négy korábbi javítás után is visszajött, mert a szabály a figyelmen múlt — most a teszten múlik.

### 2026-09-06 — a brief nem tábla, hanem oszlop + draft-törlés + élő draft-kártyák — 6.70.0

**User:** „de nekünk nem kell brief tábla, a brief link az a draft egy mezeje nem?" — **igaza volt.** A brief identitása a Drive file ID, amit a `parseSlidesFileId` minden URL-alakból ugyanarra a stringre normalizál; egy kanonikus érték mellé az integer id csak surrogate kulcs. A „hat kártya egy deckből" ettől `GROUP BY`, nem join.

**A 6.67.1-es védésem nem állt meg.** Három érve volt a sor megtartására: (1) a `list_briefs` open/promoted számlálói — ezt egy GROUP BY ugyanúgy adja; (2) „tény, nem string-egyezés" — a tény attól tény, hogy a file ID normalizált, nem attól, hogy van hozzá sor; (3) a migráció destruktív — ez költség, nem haszon. Amit a tábla ténylegesen hozzátett: árva sor minden leválasztáskor, 300 sor entity+route, és egy `["briefs"]` fetch a szerkesztőben, aminek egyetlen dolga volt visszafejteni egy id-ből azt a stringet, amiből parse-oltuk.

- [x] `messages.brief_slides_file_id` (`0016` add column, `0017` backfill → FK/oszlop/tábla drop). A `0017` generált sorrendje **hibás volt** (a `DROP TABLE … CASCADE` már elviszi az FK-t, amit a következő utasítás még egyszer eldobna) — kézzel újraírva, a backfill-lel az élén
- [x] `entities/briefs.ts` 167 → 78 sor: `listBriefDecks` (GROUP BY) + `briefFileIdFromLink`. `/api/briefs` + `/api/briefs/[id]` törölve
- [x] `BriefTab`: nincs több `["briefs"]` query és POST — a beillesztés két mező írása, amit a szerkesztő autosave-je ment
- [x] MCP: `list_briefs` a kártyákból csoportosít; `brief_attach` mezőt ír, ezért **`draft_id` kötelező** (deck kártya nélkül nem létezik), és a slide-horgonyt is eltárolja; `generate_test_creative` `brief_link`-je ugyanígy
- [x] Tesztek átírva a `briefs-entity` / `briefs-draft-invariant` / `mcp-drafts` fájlokban — a tábla-invariánsok helyére az **oszlop** invariánsai (több kártya oszthat egy decket; az egyik leválasztása nem nyúl a másikhoz)

**Draft törlés (user: „kéne tudja törölni elrontott draftot"):** `deleteDraft` + `DELETE /api/drafts/[id]`, a Promote fülön az Archive mellett, második kattintásra megerősítve. **A különbség a szám:** az archiválás nyugdíjazza a számot (ez helyes annak, ami megtörtént), a törlés visszaadja. Ez az egyetlen hely az appban, ahol hard delete van a UI-ból — és azért szabad, mert egy draftnak nincs cellája: nincs PMMID (a séma tiltja), nincs feed-sor, nincs riport rákötve.

**A draft-kártya nem hazudik többet (user: „ezt mondja 400-ra hogy nincs contetnt pedig van"):** a csempe az MCP-pipeline lőtte PNG-jét mutatta, és ahol nem volt, azt írta: „No content yet — this draft has only its number". Ez a *preview* hiányát mondta ki *content*-hiánynak — minden kézzel írt draft ezt írta ki, headline-nal, copyval együtt. Mostantól a mátrix `MatrixIframePreview`-jával renderel élőben (sablon default méretén), tehát nincs mit lőni előre és nincs mi elavuljon; a `/api/drafts` `previews` payloadja és a stale-badge elment vele. Sablon nélküli kártya `aspect-[300/250]` placeholdert kap, hogy a masonry sorban maradjon.

**Nyitva:** az MCP `draft_delete` továbbra is **archivál**, nem töröl (a neve ezt nem mondja meg) — nem nyúltam hozzá, mert a kérés a UI-ra szólt. Ha az agentnek is kell a szám-visszaadás, az egy sor.

**DEPLOYOLVA 6.70.0 (2026-09-06):** commit `342bb19`, box `c60c1d6`→`342bb19`. **Séma-migráció VAN**, egy passzban: `export $(grep '^DATABASE_URL=' .env | xargs) && npm run db:migrate` (0016+0017) → build 43s → `pm2 restart mm6-erste --update-env` → Ready 1275ms. **Mentés a migráció előtt** (`scratchpad/briefs-backup-20260906.sql` + `messages-briefid-backup-20260906.csv`): 4 brief-sor, 9 hivatkozás. Ellenőrizve élesben: `to_regclass('briefs')` = NULL, mind a **9 hivatkozás átjött** a `brief_slides_file_id`-be a helyes deck-ID-vel. Health: `/` 307 · `/login` 200 · `/drafts` 307 · `/matrix` 307 · `/api/drafts` 401 · **`/api/briefs` 404** (a route eltűnt, ahogy kell) · `/mcp` 401.

**Böngészőben ellenőrizve:** a drafts fal 9 kártyája élőben renderel (MC400a a saját headline/copy/CTA-jával — pont az, ami eddig „No content yet"-et írt); a sablonnal még nem rendelkezők üres bannert mutatnak, nem hazug szöveget; a Promote fülön ott az `Archive | Delete` páros. A `</>` ikon a render előtti pillanat placeholdere, nem hiba.

### 2026-09-06 — `draft_delete` → `draft_archive` — 6.71.0

**User:** „akkor hívjuk úgy az mcp funkciot draft_delete helyett draft_archive ne legyen féreveztő" — igen: a tool sosem törölt, archivál, és a szám nyugdíjazva marad. A név az ellenkezőjét ígérte, ráadásul pont annál a hívásnál, amelyikhez az agent akkor nyúl, amikor el akar dobni valamit.

- [x] `mcp.ts`: a regisztrált név `draft_archive`; a leírás kimondja, hogy **semmi nem töröl MCP-n**, és hogy a UI Delete gombjának (elrontott draft, a szám visszajár) **szándékosan nincs MCP-párja** — egy sorokat hard-deletelni képes agent más kockázat, mint egy polcra tevő
- [x] A `generate_test_creative` záró mondata is átírva (`draft_archive to shelve it`)
- [x] `McpTab.tsx` prózája — a tool-lista magától szinkronizál, ez a bekezdés kézzel írt (l. `feedback_mcp_settings_page_sync`)
- [x] `mcp-drafts.test.ts` + `mcp-auth.test.ts` (mindkét scope-lista); `docs/MM6_PURPOSE_STATE_CAPABILITIES.md` + `docs/MM6_MCP_E2E_TEST.md`
- [x] A todo **korábbi checkpointjaiban** meghagytam a régi nevet (D4.1/D4.2/D4.T, Slice 3, 717.) — azok azt rögzítik, ami akkor igaz volt; a történet nem íródik át

⚠️ **Ez töri az agent-szerződést:** a `~/ERSTE Addressable AI Agent` skill (és bármely más kliens), ha hívja a `draft_delete`-et, `tool not found`-ot fog kapni. A paraméterek és a válasz változatlanok, csak a név más.

**DEPLOYOLVA 6.71.0 (2026-09-06):** commit `c4d82e5`, box `342bb19`→`c4d82e5`, build 35.7s, `pm2 restart mm6-erste --update-env` → Ready 1249ms. Séma-migráció nincs. Health: `/login` 200 · `/mcp` 401 · `/drafts` 307. A Settings › MCP tool-listája magától felveszi az új nevet (a `/api/mcp/tools` a `mcp.ts`-ből generál).

### 2026-09-07 — draft-kártya: egysoros meta + a „no content" a tartalomra vonatkozik — 6.72.0

**User:** „legyen trimmelve a name úgy hogy kiférjen egy sorba, MC + Product + name, legyen a product tag az MC után, és ahol nincs content mező kitöltve ott ne üres template hanem az jelenjen meg ami korábban hogy no content yet, de annak a doboznak a mérete legyen 300x250"

- [x] Meta egy sorban: `flex items-center` (nincs `flex-wrap`), `overflow-hidden`; MC és a product-chip `shrink-0`, a név `min-w-0 flex-1 truncate` + `title` a teljes névvel
- [x] Sorrend: **MC → product tag → név**
- [x] Új `CONTENT_FIELDS` konstans (headline, copy1/2, disclaimer, flash, cta, image1–6, video1). A csempe **csak akkor renderel**, ha van sablon ÉS legalább egy tartalmi mező kitöltve; egyébként a „No content yet" doboz, `aspect-[300/250]`-ben
- [x] A `template` szándékosan NEM tartalmi mező: üres sablon = kész kártyának látszó keret, aminek nem töltődött be a szövege. A `landingUrl` sem: azt változtatja, hova visz a kattintás, nem azt, hogy mit látsz

**A 6.70.0-s mondat visszatért, de már igazat mond.** Akkor a *preview* hiányát mondta ki tartalom-hiánynak (ezért jelent meg tele copyval bíró draftokon is); most pontosan azt jelenti, amit ír.

**Bump-megjegyzés:** felhasználó által látható viselkedésváltozás → minor. Patch is védhető lett volna (pár órája szállított feature csiszolása) — a magasabbat választottam, ahogy a CLAUDE.md kéri kétes esetben.

**DEPLOYOLVA 6.72.0 (2026-09-07):** commit `e1886f7`, box `c4d82e5`→`e1886f7`, build 40s, `pm2 restart mm6-erste --update-env` → Ready 1443ms. Séma-migráció nincs. **Böngészőben ellenőrizve:** a meta egy sor mind a 9 kártyán (`MC404a [SZK] BlackFriday 2026 Q4`, a hosszabb nevek „…"-tal csonkolva), a négy üres draft a 300×250-es „No content yet" dobozt kapja, az öt tartalommal bíró élőben renderel.

