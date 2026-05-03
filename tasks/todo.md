# MessagingMatrix v6 — checkpoint after `/clear` (2026-04-27)

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
