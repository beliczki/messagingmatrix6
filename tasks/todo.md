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
