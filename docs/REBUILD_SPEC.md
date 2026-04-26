# MessagingMatrix v6 — Rewrite Specification

## Context

The current app (`/Users/robertbeliczki/messagingmatrix`, v5.2.0) is a React+Vite SPA with an Express backend where **Google Sheets is the source of truth** for all matrix data (audiences, topics, messages, assets, creatives, text formatting, reporting). SQLite is only a read cache. This worked for solo use but produces multiple pain points:

- Every save is a full-table rewrite to Sheets (~5s) → slow, conflict-prone
- Matrix render stalls on large datasets because change tracking recomputes against Sheets shape
- MCP writes can be clobbered by the UI's full-table Save
- AI assistant code (Claude/Gemini/Grok + prompts) bloats the bundle and is unused in the intended workflow
- Masonry view relies on shortest-column layout that reflows heavily
- No real concurrent-edit story; a team of 1–3 workers + agents cannot safely edit in parallel

This document specifies a **greenfield Next.js 15 app** with **SQLite as the source of truth**, XLSX + Google Sheets as export/import surfaces (not runtime dependencies), local file storage, optimistic row-level locking for multi-user editing, a modernized MCP surface for agents, and **zero AI functionality**. UI look and behavior matches v5 1:1 unless noted.

This spec is the input for a one-shot rebuild — a different engineer or AI should be able to implement from this document without reading the v5 React/Express code.

---

## 1. Architecture Overview

### 1.1 Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router, RSC) | Single process; API routes under `app/api/*` |
| Language | TypeScript everywhere | |
| DB | SQLite via `better-sqlite3` + Drizzle ORM | WAL mode, 5s busy timeout, single file `db/matrix.db` |
| Auth | JWT (HS256, 5-day exp) in httpOnly cookie + bearer fallback | Roles: admin / user / demo |
| Realtime | SSE for cache-invalidation broadcasts | No WebSocket needed for optimistic locking |
| File storage | Local disk under `storage/` with SQLite registry | Served via Next.js static + auth-gated route for private files |
| XLSX | `xlsx` (SheetJS) | In-process for export/import |
| Google Sheets export | `googleapis` | One-shot push; not a live dependency |
| MCP | `@modelcontextprotocol/sdk` Streamable HTTP | Mounted at `/mcp`, bearer auth |
| Styling | Tailwind + shadcn/ui + Lucide icons | Match v5 color system |
| Matrix virtualization | `@tanstack/react-virtual` | Needed for fast render on 1000+ messages |
| Masonry | CSS `column-count` with `break-inside: avoid` + `@tanstack/react-virtual` fallback for >500 items | No JS reflow; better than v5 shortest-column algo |
| State | Zustand (matrix in-memory state) + TanStack Query (server state) | |

### 1.2 Data flow (new vs old)

```
v5: Sheets → Load → React Memory (useMatrix) → Save (full rewrite) → Sheets
v6: SQLite ←────────────→ Next.js API ←────────────→ Zustand (client)
                  ↑                                        ↑
                  │                                  optimistic mutations
                  │                                        │
               MCP tools                              XLSX / GSheets
             (read + write)                          export/import
```

Matrix data is **persisted on every mutation** (unlike v5's in-memory-until-Save model). No "dirty" badge; changes land in SQLite immediately. Undo/history are server-side (see §5.7).

### 1.3 Process topology

- Single Next.js server process (matches current Hetzner deployment style)
- PM2 for prod (`npm run pm2:start` equivalent)
- Worktree/instance system preserved (`instances/` directory snapshots DB + env)

---

## 2. Roles & Permissions

| Role | Login | Read matrix | Edit matrix | Admin (users/config/settings) | MCP |
|---|---|---|---|---|---|
| admin | ✅ | ✅ | ✅ | ✅ | ✅ (own bearer) |
| user | ✅ | ✅ | ✅ | ❌ | ✅ |
| demo | ✅ | ✅ | ❌ | ❌ | ❌ |
| public | public share links only | read-only on `/share/[id]` | comments only | ❌ | ❌ |

Permissions enforced in API route middleware — not only client-side.

---

## 3. Data Model (SQLite source of truth)

All entities have `id` (integer, autoincrement), `created_at`, `updated_at`, and `version` (integer, starts at 1, incremented on every update — used for optimistic locking). String IDs are reserved for `users`, `share_galleries`, `uploaded_assets` only.

### 3.1 `audiences`

| Field | Type | Required | Notes |
|---|---|---|---|
| id | INTEGER PK | | |
| key | TEXT UNIQUE NOT NULL | ✅ | `aud1`, `aud2`, …, auto-generated from `order_index` unless user overrides |
| name | TEXT NOT NULL | ✅ | Display name |
| order_index | INTEGER | ✅ | Display order (matrix columns) |
| status | TEXT | | ACTIVE / INACTIVE / "" |
| product | TEXT | | Free-form; used for filter & product hierarchy |
| strategy | TEXT | | Prospecting / Retargeting / custom |
| buying_platform | TEXT | | DV360, DBM, … |
| data_source | TEXT | | CRM, GA360, … |
| targeting_type | TEXT | | Segment, Lookalike, … |
| device | TEXT | | Mobile / Desktop / All |
| tag | TEXT | | |
| comment | TEXT | | |
| campaign_name, campaign_id, lineitem_name, lineitem_id | TEXT | | External campaign ids |
| version | INTEGER | ✅ | Optimistic-lock column |

Indexes: `key`, `product`, `order_index`.

### 3.2 `topics`

Same header fields as audiences plus:
- `tag1`, `tag2`, `tag3`, `tag4` (TEXT) — hierarchical tags used in key generation
- `created` (TEXT, ISO date)

Key generation:
- If `config.patterns.topicKey` is set: evaluate template (e.g., `{{product|lower}}_{{tag1|lower}}`). Modifiers: `|upper`, `|lower`, `|trim`, `|noext`.
- Fallback: `top{order_index}`.
- Key regenerates when product/tag1-4 change.

### 3.3 `messages`

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| number | INTEGER NOT NULL | Part of MC label |
| variant | TEXT NOT NULL | lowercase [a-z] |
| audience | TEXT NOT NULL | → audiences.key |
| topic | TEXT NOT NULL | → topics.key |
| version_no | INTEGER DEFAULT 1 | Message revision counter (not optimistic-lock version) |
| version | INTEGER | Optimistic-lock column (renamed for clarity) |
| pmmid | TEXT | Auto-generated from `config.patterns.pmmid` |
| status | TEXT | INCOMING / NAMING / CONTENT / PREVIEW / APPROVED / ACTIVE / INACTIVE / ERROR / DEAD / MEMORY / deleted (soft-delete) |
| start_date, end_date | TEXT | ISO |
| template | TEXT | Template folder name under `templates/` |
| template_variant_classes | TEXT | space-separated CSS classes |
| name | TEXT | Display name |
| headline, copy1, copy2 | TEXT | |
| image1, image2, image3, image4, image5, image6 | TEXT | File ID in `uploaded_assets` (or Drive ID during migration) |
| video1 | TEXT | |
| flash, flash_style | TEXT | Badge / animated field |
| cta | TEXT | |
| landing_url | TEXT | |
| comment | TEXT | |
| utm_campaign, utm_source, utm_medium, utm_content, utm_term, utm_cd26, final_trafficked_url | TEXT | Auto-generated from `config.patterns.trafficking` |
| brief | TEXT | JSON — `{ brief: "…", generated: { field: ["v1","v2"] } }` (freeform notes, no AI) |

Indexes: `(topic, audience)`, `status`, `number`, `pmmid`.

**MC label:** derived (not stored) as `MC{number}{variant}` → `MC282a`.

**Numbering rules (applied server-side on create):**
- Empty cell → `number = MAX(all numbers) + 1`, `variant = 'a'`, `version_no = 1`
- Occupied cell → `number = existing cell number`, `variant = next letter after MAX(variant in cell)`
- Version bump → same `number + variant + audience + topic`, `version_no = MAX + 1`

**Soft delete:** `status = 'deleted'`; row stays for history. All reads filter by default.

### 3.4 `assets` (image/video asset library)

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| brand, product, type, visual_keyword | TEXT | Filter taxonomy |
| file_id | TEXT | → `uploaded_files.id` |
| file_name, file_format, file_size, file_dimensions | TEXT | Derived / cached |
| comment | TEXT | |
| version | INTEGER | Optimistic lock |

Indexes: `brand`, `product`, `type`, `file_id`.

### 3.5 `creatives` (pre-built ad files)

Same shape as `assets` plus:
- `copy_keyword`, `template`, `banner_version` (TEXT)
- `mc_number`, `mc_variant` (optional link to message)

Indexes: `brand`, `product`, `file_id`, `(mc_number, mc_variant)`.

### 3.6 `text_formatting`

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| text_original | TEXT NOT NULL | Source string |
| text_formatted | TEXT NOT NULL | Replacement string |
| formatting_scope | TEXT | `""` = all sizes, or CSV like `"300x250,728x90"` |
| formatting_mc_scope | TEXT | `""` = all MCs, or space/CSV-separated MC labels (`MC282a MC283b`) |
| version | INTEGER | |

Scope parsing: empty → universal; otherwise split on `,` or whitespace, trim, lowercase.

### 3.7 `reporting` (AdForm sync output — now in SQLite, not Sheets)

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| level | TEXT | `banner` or `label` |
| mc_label | TEXT | `MC282a` (extracted) |
| size | TEXT | `300x250` or `""` for label rows |
| banner_id, banner_name | TEXT | Empty for label rows |
| adform_status | TEXT | `live` / `inactive` |
| impressions, clicks | INTEGER | |
| ctr | REAL | `clicks/impressions`, 4-decimal |
| campaign_id, campaign_name | TEXT | For label rows, empty if mixed across campaigns |
| synced_at | TEXT | ISO |

Indexes: `mc_label`, `(mc_label, size)`, `level`.

### 3.8 `users`

| Field | Notes |
|---|---|
| id TEXT PK | UUID |
| email TEXT UNIQUE | |
| password TEXT | bcrypt (upgrade from v5's SHA-256 — migration hashes plaintext-unknown to force reset) |
| role TEXT | admin / user / demo |
| created_at, updated_at | |

### 3.9 `config` (key-value store)

| Field | Notes |
|---|---|
| key TEXT PK | |
| value TEXT | JSON stringified |
| category TEXT | patterns, lookAndFeel, structure, storage, adform |
| description TEXT | |
| updated_at | |

**Known keys:** `patterns`, `lookAndFeel`, `googleDrive` (deprecated after migration), `audienceStructure`, `topicStructure`, `messagesStructure`, `creativeStructure`, `feedStructure`, `visibleTemplates`, `adformLastSync`, `spreadsheetExportLast`, `creativeParsingRules`.

`patterns` value shape:
```json
{
  "pmmid": "a_{{audience}}-t_{{topic}}-m_{{number}}-v_{{variant}}-n_{{version_no}}",
  "topicKey": "{{product|lower}}_{{tag1|lower}}",
  "trafficking": {
    "utm_campaign": "{{product|lower}}_{{year}}",
    "utm_source": "{{strategy|lower}}",
    "utm_medium": "display",
    "utm_content": "MC{{number}}{{variant}}",
    "utm_term": "",
    "utm_cd26": "{{product}}_{{audience}}"
  },
  "feed": { "field1": "{{headline|upper}}" }
}
```

`lookAndFeel` value shape: `logo`, `headerColor`, `buttonColor`, `secondaryColor1..4`, `pageTitle`, `fontFamily` (Inter / Poppins / Novatica / TeleNeo), `capsuleDesign` (bool), `cobranding: { enabled, logoUrl }`, `statusColors: { INCOMING: "#…", … }`.

### 3.10 `share_galleries`

| Field | Notes |
|---|---|
| id TEXT PK | shareId (nanoid, 16 chars) |
| title, description | |
| created_by | user email |
| metadata TEXT | JSON — `{ creatives: [...], textFormatting: [...], comments: [...], baseColor }` |
| created_at, updated_at | |

Public URL: `/share/[shareId]`. No file generation on disk — HTML rendered on request.

### 3.11 `uploaded_files` (unified file registry)

Single table for all user-uploaded binaries (replaces v5's dual `assets` + `uploaded_assets`):

| Field | Notes |
|---|---|
| id TEXT PK | UUID |
| filename TEXT | Sanitized final filename |
| original_filename TEXT | |
| storage_path TEXT | Relative to `storage/` (e.g. `assets/2026/04/abc.jpg`) |
| mime_type, size_bytes | |
| dimensions TEXT | `WIDTHxHEIGHT` for images/videos |
| sha256 TEXT | Dedup / integrity |
| uploaded_by | user id |
| category TEXT | `asset` / `creative` / `template-file` / `share-file` |
| created_at | |

Indexes: `sha256`, `category`, `(category, created_at)`.

### 3.12 `templates` (filesystem, not DB)

Each template is a folder under `templates/{name}/`:
- `index.html` — placeholder syntax `{{placeholder_name}}`
- `template.json` — bindings (see v5 shape, §4.6 below)
- `{width}x{height}.css` — one per size (source of truth for available sizes)
- `main.css`, `dynamic.content.js`, `empty.png`, `emptyvideo.mp4`
- Optional: `thm.json`, `manifest.json`

Discovery: scan `templates/` on boot, watch for changes in dev.

### 3.13 `audit_log` (new — replaces client-side action history)

| Field | Notes |
|---|---|
| id INTEGER PK | |
| user_id | |
| entity_type | audiences / topics / messages / … |
| entity_id | |
| action | create / update / delete / bulk_move / bulk_copy |
| before TEXT | JSON snapshot (for update/delete) |
| after TEXT | JSON snapshot (for create/update) |
| created_at | |

Powers server-side undo (last 50 actions per user) and a future admin audit UI.

---

## 4. Backend API (Next.js route handlers under `app/api/`)

All endpoints JSON unless noted. Auth: JWT in `Authorization: Bearer` or `auth_token` httpOnly cookie. Write endpoints require `If-Match: <version>` header (or `version` in body) for optimistic locking; mismatch → 409 with current version + row.

### 4.1 Auth

- `POST /api/auth/login` — `{ email, password }` → `{ token, user }`, sets cookie
- `POST /api/auth/logout` → clears cookie
- `GET /api/auth/me` → current user
- `POST /api/auth/change-password` — `{ currentPassword, newPassword }` (self) or admin can pass `userId`

### 4.2 Matrix data (CRUD per entity)

Each of `audiences`, `topics`, `messages`, `assets`, `creatives`, `text_formatting`:

- `GET /api/{entity}` — list, optional filters via query
- `GET /api/{entity}/[id]` — single
- `POST /api/{entity}` — create (server fills id/key/number/variant/pmmid/trafficking)
- `PATCH /api/{entity}/[id]` — partial update; requires version
- `DELETE /api/{entity}/[id]` — soft delete for messages; hard for others; requires version
- `POST /api/{entity}/bulk` — `{ creates: [], updates: [], deletes: [] }` atomic txn

Messages-specific:
- `POST /api/messages/move` — `{ ids: [], targetAudience, targetTopic, mode: "move"|"copy" }`
- `POST /api/messages/search?q=…&limit=50` — full-text (SQLite FTS5 virtual table on name/pmmid/headline/copy1/copy2/cta)
- `POST /api/messages/regenerate-pmmid` — admin bulk
- `POST /api/messages/new-variant` — `{ fromId }` → copy as next variant letter

### 4.3 Config

- `GET /api/config` (admin) — all keys
- `GET /api/config-public` (public) — only `lookAndFeel` + `pageTitle` (for login page / shares)
- `PATCH /api/config` (admin) — `{ key: value, … }`

### 4.4 Files & uploads

- `POST /api/files/upload` (multipart) — `{ file, category }` → `{ id, storage_path, dimensions, … }`
  - Writes to `storage/{category}/{yyyy}/{mm}/{uuid}.{ext}`
  - Extracts dimensions via `image-size` / `ffprobe` for video
  - Computes sha256 for dedup
- `GET /api/files/[id]` — serve file (auth-gated based on category; `asset`/`creative` require login, `share-file` public via share token)
- `GET /api/files/[id]/thumbnail?w=400` — on-the-fly resize cached under `storage/.thumbs/`
- `PATCH /api/files/[id]` — rename / move category
- `DELETE /api/files/[id]` — soft delete (mark row, keep file 30d)
- `GET /api/files?category=asset&q=…` — list with search

**Migration from Drive:** optional admin endpoint `POST /api/migrate/drive-pull` — for each unique Drive ID referenced in messages/assets/creatives, download via service account, insert into `uploaded_files`, rewrite reference columns.

### 4.5 Templates

- `GET /api/templates` — list visible templates with dimensions (from `.css` filenames) and placeholders (from `template.json`)
- `GET /api/templates/folders` — all folders (admin, for visibility toggles)
- `GET /api/templates/[name]` — `{ template, files }` for one template:
  - `template`: same shape as `GET /api/templates` items (sizes, defaultSize, placeholders, tagOptions)
  - `files`: array of `{ name, ext, bytes, size?, isText }` sorted as `index.html` → `template.json` → `main.css` → size CSS (by area asc) → other text → binary; hidden files (`.DS_Store`, dotfiles) excluded
- `GET /api/templates/[name]/[file]` — read file (binary or text via mime)
- `PUT /api/templates/[name]/[file]` (admin) — write file. Body is `text/plain` for text files. Path-traversal hardened: rejects `..`, absolute paths, path separators in name/file
- `POST /api/templates/[name]` (admin) — create new template. Scaffolds `index.html`, `main.css`, `300x250.css`, `template.json` (with v5-style binding-messagingmatrix placeholders for headline/copy/cta/url/name). Name validated against `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`. Returns 409 on duplicate, 400 on invalid name

### 4.6 Template render

- `POST /api/render` — `{ templateName, size, messageData, textFormatting }` → HTML string
  - Loads `index.html` + CSS, replaces `{{placeholder}}` per `template.json` bindings
  - Applies text-formatting spans for matching scope
  - Used for preview iframe and share HTML

### 4.7 Shares

- `GET /api/shares` (user's shares)
- `POST /api/shares` — `{ creatives: [...], title, baseColor, textFormatting }` → `{ shareId }`
- `GET /api/shares/[id]` — share metadata (public, no auth)
- `POST /api/shares/[id]/comments` — public `{ author, text, anchor?: {x,y,w,h}|{x,y} }`
- `DELETE /api/shares/[id]` (owner/admin)
- `GET /share/[id]` — Next.js page (public)
- `GET /api/shares/[id]/zip` — server-streamed ZIP of all rendered HTML + CSS + assets

### 4.8 Users (admin)

- `GET /api/users`
- `POST /api/users` — `{ email, password, role }`
- `PATCH /api/users/[id]`
- `DELETE /api/users/[id]`

### 4.9 AdForm sync (unchanged extraction logic)

- `POST /api/adform/sync` — `{ dateFrom, dateTo, campaignPrefix }` → `{ bannerCount, matchedCount, syncedAt }`
  - Reads from `data/adform-report.xlsx` (or live API if `ADFORM_CLIENT_ID` set)
  - **Preserves exact regexes from v5 `services/adformSyncService.js`:**
    - Direct MC: `/MC(\d+)([a-z])/i`
    - PMMID MC: `m_(\d+)` + `v_([a-z])(?:[_-]|$)/i`
    - Drop `m_00`
    - Size: `(\d+)\s*x\s*(\d+)`, drop `1x1`
    - CTR: `clicks/impressions`, `.toFixed(4)`, 0 when impressions=0
  - Writes banner + label rollup rows to `reporting` table (DELETE all + INSERT in txn)
- `GET /api/adform/status` — last sync timestamp & counts

### 4.10 Spreadsheet I/O (export + import, XLSX & Google Sheets)

**XLSX export:**
- `GET /api/export/xlsx` → binary `.xlsx` download with sheets: Audiences, Topics, Messages, Assets, Creatives, TextFormats, Reporting. Column order from `config.*Structure` values.

**XLSX import:**
- `POST /api/import/xlsx` (multipart) — `{ file, mode: "replace"|"merge", dryRun: bool }` → `{ diff: { audiences: { added, modified, deleted }, topics: {…}, … }, errors: [] }`
  - `replace` = wipe and reinsert; `merge` = upsert by `key`/MC label
  - `dryRun` returns diff without applying

**Google Sheets export (one-shot push):**
- `POST /api/export/sheets` — `{ spreadsheetId?, createNew?: bool }` → `{ spreadsheetId, url }`
  - Uses service account; creates new sheet or overwrites specified tabs
  - Stores last export timestamp in `config.spreadsheetExportLast`

**Google Sheets import:**
- `POST /api/import/sheets` — `{ spreadsheetId, mode, dryRun }` → same diff shape as XLSX import

### 4.11 Events (live invalidation)

- `GET /api/events` (SSE) — server pushes `{ entity, ids, action, byUser }` events after every write
  - Clients invalidate TanStack Query cache for matching keys
  - Keepalive ping every 15s
  - Auto-reconnect on client side

### 4.12 Audit / Undo

- `GET /api/audit?entity=&userId=&limit=50`
- `POST /api/audit/undo` — `{ auditId }` reverses a specific action (checks version still matches)

---

## 5. MCP Server (`/mcp`) — v6

Transport: Streamable HTTP (stateless). Auth: `MCP_BEARER_TOKEN` via `Authorization: Bearer` or `?secret=` (for claude.ai connectors). Writes go **directly to SQLite** — no Sheets clobber caveat from v5.

### 5.1 Tool surface (17 from v5 + 4 new batch tools = 21 total)

**Write (single):**
- `audience_create`, `audience_update`, `audience_remove`
- `topic_create`, `topic_update`, `topic_remove`
- `mc_create`, `mc_update`, `mc_remove`

**Write (batch — new):**
- `audience_create_batch` — `{ audiences: [...] }` — atomic txn
- `topic_create_batch`
- `mc_create_batch` — especially valuable for agent bulk-fill of a campaign
- `mc_update_batch` — `{ updates: [{ mc_label, fields }] }`

**Read:**
- `list_audiences({ product? })`
- `list_topics({ product? })`
- `list_mc({ topic_key?, audience_key?, product?, status?, monitoring_status?, limit? })`
- `mc_get({ mc_label })`

**Reporting:**
- `get_mc_reporting({ mc_label })` → `{ label: {…rollup…}, banners: [...] }`

**Meta:**
- `list_templates()` — with sizes + placeholder bindings
- `list_products()` — unique products across audiences+topics
- `matrix_status()` — `{ audiences, topics, messages: { total, by_status }, last_reporting_sync, last_export }`

### 5.2 Deferred (v6.1)

- `mc_preview_image` — renders a message+template+size to PNG via Puppeteer (requires headless Chrome in the deploy image; out of initial scope)
- `mc_search` — semantic search over matrix state (would reintroduce an embedding model; defer)

### 5.3 Behavioral improvements over v5 MCP

- Writes are transactional and persisted in SQLite — UI live-updates via SSE (§4.11), no clobber risk
- Returns include `version` so agents can chain optimistic updates
- Audit-logged (`byUser = "mcp:<tokenOwner>"`)
- Rate-limited per token (configurable in `config.mcp.rateLimit`, default 60 writes/min)

---

## 6. Frontend — Page-by-Page Spec

Global layout: collapsible left sidebar (matches v5), top-left hamburger + top-right fullscreen, user chip + version + logout in sidebar footer. Header color & accent colors pulled from `config.lookAndFeel`. Keyboard shortcut `Cmd/Ctrl+K` opens a global command palette (new — search messages, jump to page, trigger export).

### 6.1 `/login` — public

- Glassmorphism card, animated gradient background (match v5)
- Fields: email, password, Sign In button with loading state
- Error banner below button
- Cobranding logo slot (from `/api/config-public`)

### 6.2 `/matrix` — main workspace

**Sub-views (toggled from floating toolbar, same as v5):**

1. **Grid** — audience rows × topic columns
   - Two density modes: **informative** (2×2 cells with thumbnails + MC labels + status color) and **minimal** (3×3 dots only)
   - Virtualized rows/cols via `@tanstack/react-virtual` for 500+ audience or topic counts
   - Cell click → open MessageEditor dialog for that (audience, topic)
   - Cell right-click → context menu: Add MC, Copy cell, Paste cell, Clear cell, Copy MC link
   - Shift+drag across cells → range select; ranged actions: bulk status change, bulk move
   - Drag an MC badge from one cell to another → move; Alt+drag → copy
   - Long-press on mobile = right-click
   - Space+drag = pan canvas; scroll = zoom (matches v5)
   - Undo (`Cmd/Ctrl+Z`) calls `/api/audit/undo` for the last action by this user

2. **Tree** — vertical or horizontal orientation
   - Product → audiences / topics → MCs
   - Sliders: node size (0.5–2×), layer height/width, scale base (10–100)
   - D-pad navigation (↑/↓/←/→ or on-screen pad); center button fits view
   - Click node to select; double-click to open editor

3. **Sankey** — flow or circular
   - Left: audiences; Right: MCs (grouped by topic); flow width ∝ count
   - Sliders: flow height, level spacing, text size
   - Hover ribbon → tooltip with count + status breakdown

4. **Feed** — table view of all messages
   - Columns: MC Label, Status (colored chip), Product, Audience, Topic, Template, Headline, Copy1 (truncated), CTA, Created, Modified, Actions
   - Click header → sort asc/desc (indicator arrow)
   - Multi-select with checkbox column; Shift+Click = range
   - Row action buttons on hover: Edit, Duplicate as new variant, Delete
   - **Export Filtered Feed** button: XLSX of currently filtered rows (same columns as visible)

**Toolbar (floating, draggable, position persisted in localStorage):**

- View buttons (Grid density / Tree orientation / Sankey layout / Feed) — second click toggles sub-mode
- Zoom: −, %, + (applies to grid/tree/sankey), "fit" button
- Filters (pills with count badges):
  - **Products** (multi-select checkboxes)
  - **Status** (multi-select, chips with status color)
  - **Audience text** (freeform substring, matches name + key)
  - **Topic text** (freeform substring)
  - **MC / name / images** (freeform, matches MC label, message name, image filenames)
- Tree/Sankey sliders (as above)
- D-pad (tree only)

**Right panel — Matrix State** (bottom bar in v5, right panel in v6, height resizable):
- Tabs: Audiences | Topics | Messages | Text Formatting | Keywords | Reporting
- Each tab = table view with inline editing of the current tab's entity
- Change tracking **removed** (changes land immediately); replaced with "Recent activity" feed (last 20 audit_log entries)
- Undo button = calls `/api/audit/undo` for most recent entry by this user

**Data:** loaded via TanStack Query; mutations are optimistic with rollback on 409.

### 6.3 Message Editor (modal on `/matrix`)

- Full-screen dialog, close = ESC (no unsaved warning — everything is live)
- Left: form, 5 tabs (Naming / Content / Styles / Trafficking / Template *— no "Generate" tab*)
  - **Naming:** MC Number (readonly), Variant (readonly, but "new variant" button creates next), Message Name, Product (derived from audience)
  - **Content:** Headline, Copy1, Copy2, Disclaimer, Flash text, CTA, Landing URL. Each text field has an inline "formatting rules" popover — "+ add rule" opens a mini-form (original text, formatted text, scope sizes, scope MCs) that writes to `text_formatting` table.
  - **Styles:** Headline / Copy1 / Copy2 / Flash / CTA / Disclaimer style fields (CSS classnames or inline), plus a full Custom CSS textarea (CodeMirror, CSS mode)
  - **Trafficking (readonly):** PMMID, UTM fields, Final URL — all derived from `config.patterns.trafficking`
  - **Template:** dropdown of templates (filtered by `config.visibleTemplates`), template variant classes (multi-select chips based on `template.json` `tag`-type options)
- Right: live preview
  - Size selector (derived from template's `.css` files)
  - Background toggle: light / dark / checkerboard / custom color picker (persisted per user)
  - Skip-animation toggle
  - Iframe rendered via `POST /api/render` (debounced 200ms)
- Header: MC navigator — prev/next arrows cycle through filtered messages, counter `5/12`, status chip with color
- Asset picker: clicking an image/video placeholder opens a modal with filterable asset grid (from `/api/files?category=asset`) + an "Upload new" button inline
- Save is automatic (300ms debounce); tiny "saving…" indicator in the header; turns green check on success, red ✕ + retry on error (shows server error)

### 6.4 `/creative-library`

Toolbar (horizontal, top):
- Product filter (multi), Type filter (Dynamic HTML / Adobe generated — toggle group), Size filter (multi), Status filter (multi), Live-in-AdForm toggle (live/not-live/all)
- Text search (filename / product / MC label)
- View mode toggle: **Masonry** (default) or **List**
- Sort (list mode): Name (MC number numeric, filenames alphabetical) / Size (area) / Template / Date / Product / CTR (nulls last). Direction toggle, persisted.
- Color picker for gallery background (persisted per user per page)
- Action buttons: Upload, Select mode (→ bulk Share / Export / Delete)

**Masonry view (improvement over v5):**
- CSS `column-count` with media queries: 1/2/3/4 cols by viewport
- `break-inside: avoid` on cards
- Fixed aspect-ratio thumbnail container (no height-recalc jitter)
- For >500 items, virtualize rows using `@tanstack/react-virtual` with variable-height row measurement
- Each card: thumbnail (HTML rendered via `iframe srcdoc` from `/api/render` for dynamic creatives; `<img>` for static), hover overlay (product, MC label, variant, dimensions, comment-count badge)
- Click → CreativePreview modal

**List view** — table with columns above + 16×16 thumbnail column.

**CreativePreview modal:**
- Prev/Next navigation through filtered set
- Full preview pane (centered, max viewport)
- Details: filename, product, size, template, status, date, CTR/impressions
- Download button (ZIP for dynamic with all assets, binary for static)

**Upload dialog (multi-step):**
1. Drag/drop or picker
2. Per-file metadata form (Brand, Product, Type, Visual_keyword, Visual_description, MC_Number, MC_Variant) with auto-parse from filename using `config.creativeParsingRules`
3. Confirm → per-file progress bar → success

### 6.5 `/assets`

Same layout/behavior as Creative Library but for generic media assets:
- Filters: Product, Type, Format (file ext), Dimensions, Text search
- Same Masonry/List toggle, same sort controls
- Upload flow same as Creative Library (different category)
- Preview: image/video viewer with download

### 6.6 `/monitoring`

Toolbar (floating right):
- Campaign prefix input (default `26!`)
- Date From / Date To (date pickers, default = last 30d)
- **Sync Now** button
- Last sync timestamp
- Product filter (multi)
- "Show unmatched" toggle

Main: banner-level performance list (v5.2.0 style)
- Columns: MC Label, Size, Banner Name, Product, Status (live/inactive color chip), Impressions, CTR, Thumbnail (tiny)
- Sortable headers, default sort by CTR desc
- Row click → small side panel with matched message data + reporting rollup

### 6.7 `/templates` — admin-only template editor

Single-page editor (no separate list page). Non-admin users see "Admin only" panel.

**Header (top bar):**
- Left: template selector `<select>` (all templates from `GET /api/templates/folders`), "New" button (admin), `N templates` counter
- Right: **MC navigator** for preview data — `Preview with:` label + prev chevron + colored-dot select (status color from `lookAndFeel.statusColors` with v5 default palette fallback) + next chevron. Wrap-around stepping. `— sample data —` is the default option (uses `synthMessage()` with friendly stubs). When a real MC is selected, the message row is passed to `/api/render` directly (camelCase keys; render-side normalize handles v5 PascalCase bindings).

**MC list (`uniqueCards`):** dedup messages by `(number, variant)`, keep highest `versionNo`, exclude `status === "deleted"`, sort by `number asc, variant asc`. Sourced from `GET /api/messages` (active client only).

**Main area** is split into **editor** and **preview** panes by a **draggable divider** (4px, hover-darkens, orientation-aware cursor: `row-resize` when wide layout, `col-resize` otherwise). `splitPercent` is the preview's share of the container; bound 20–80%. Tracked via `containerRef.getBoundingClientRect()` during mousemove.

**Layout flip threshold:** if `previewSize` width/height ≥ 1.5 (landscape — 640x360, 970x250, 728x90, etc.) → preview on top, editor on bottom. Otherwise side-by-side (300x250, 300x600 stay side-by-side).

**Editor pane:**
- Header (`h-10`): chevron-toggle for **Files slide-in** + filename + modified/saving/saved/error indicator on the left; **Cancel** + **Save** buttons on the right (both disabled when not dirty / saving). `Cmd/Ctrl+S` triggers save. No auto-save — explicit only.
- Body: CodeMirror 6 with language auto-detect (HTML/SVG → `lang-html`, CSS → `lang-css`, JSON → `lang-json`, JS → `lang-javascript`)
- Binary files (png/jpg/mp4/etc.) → read-only message; not editable in this UI

**Files slide-in (from left, 320px):**
- Triggered from editor header chevron
- File list with bytes shown (sorted as in §4.5)
- `confirm("Discard unsaved changes in {filename}?")` if switching files while dirty
- Click overlay or chevron-left in panel header closes; Esc also closes

**Preview pane:**
- Header (`h-10`): size selector + skip-animation toggle (Check icon, slate-900 active) on the left; **bg switcher** (segmented Sun / Grid / Moon — light/checker/dark, v5 paletta with `#1f2937` dark and 20px ferde gradient checker) + refresh button + chevron-toggle for **Bindings slide-in** on the right
- Body: full-bleed centered iframe at native ad dimensions (e.g. 970x250). `previewBoxRef` measured by `ResizeObserver`. iframe applies `transform: scale(min(1, (boxW - 32) / adW, (boxH - 32) / adH))` with `transform-origin: center` if it doesn't fit. Soft box-shadow. No background unless overridden by bg switcher (light = white, dark = `#1f2937`, checker = gradient pattern).
- Render call: `POST /api/render` with `{ templateName, size, inline: true, skipAnimations, message: selectedCardOrSynth }`. Debounced 200ms. Re-fires on file save, template/size/skipAnim/MC change.

**Bindings slide-in (from right, 384px):**
- Triggered from preview header chevron
- Type filter chips (`Type` text, `Image`, `Video`, `Link` url, `Tag`, `Palette` style) with v5-color-coded active state; All / None toggle; `Filter` icon
- Per-placeholder card: 3px left border in type color, type icon, `{{name}}` mono, `←` arrow, binding name (or `AlertTriangle` + "Unbound" rose if no binding). Default value shown small below. For `tag` type, first 4 options shown as pink chips
- Footer hint: "Edit bindings via `template.json` in the files panel" (no inline editor in v6.0 — stretch goal)

**Save/cancel semantics:**
- Save = `PUT /api/templates/[name]/[file]` with the buffer; on 200 invalidates `templates/detail` query and re-fires preview render
- Cancel = restores buffer to `fileQ.data` (last server-loaded content); does not hit API
- Dirty state = `buffer !== last loaded content`; `confirm()` guard on file/template switch when dirty

**New template button:**
- Inline form: name input (pattern `[a-zA-Z0-9][a-zA-Z0-9._-]*`), Create button, Cancel
- On success → `POST /api/templates/[name]` → invalidates `templates/all` query, switches to the new template
- Errors shown inline (409 = "exists", 400 = "invalid_name")

**Stretch goals (post-v6.0, not built):**
- Persist `splitPercent`, `previewBg`, `skipAnim` to localStorage
- Inline binding editor (rewrite `template.json` per-placeholder)
- Valid JSON / Valid HTML badges with warning panel
- Last-modified file auto-open

### 6.8 `/users` (admin)

- Table: Email, Role chip, Created, Actions
- Add User modal: email + role dropdown + password + confirm, validation min 6 chars
- Change Password modal: new + confirm
- Delete confirmation (not self, not only-admin)

### 6.9 `/settings` (admin)

Tabs: **Storage / Design / Structure / About** (no Prompts, no Models — AI removed).

**Storage:**
- File storage info (disk usage, total files, thumbnails cache size, cleanup button)
- AdForm: XLSX path (default `data/adform-report.xlsx`), live API creds (Client ID / Secret / Token URL / API Base / Scope — all optional)
- Spreadsheet integration (export only): Google service account JSON upload, Default export spreadsheet ID, "Export now" button, last export timestamp

**Design:**
- Page title, Font family (Inter / Poppins / Novatica / TeleNeo), Capsule design toggle
- Cobranding: toggle + logo URL with preview
- Color scheme: Main, Secondary 1–4, Button (color picker + hex input each)
- Status colors: grid of color pickers per status (INCOMING, NAMING, CONTENT, PREVIEW, APPROVED, ACTIVE, INACTIVE, ERROR, DEAD, MEMORY)
- Template visibility: grid of on/off cards per template folder (from `/api/templates/folders`), saves to `config.visibleTemplates`

**Structure:**
- Audience Structure (CSV of column names, defines spreadsheet-export column order)
- Topic Structure, Messages Structure, Creative Structure
- Feed Structure (textarea, prefixed CSV: `Text:pmmid, AdformSignal:ADFPLAID, Asset:background_image_1, …`)
- Creative Parsing Rules (per-field rule builder: fixed / pattern / segment / after_segment / extension_type / last_segment)
- Patterns (pmmid, topicKey, trafficking.*, feed.*) — textarea per field with placeholder chip helper showing available `{{vars}}` and modifiers

**About:**
- Version from `package.json` (display `v{APP_VERSION}`)
- Build date
- DB size, file count
- No external links unless explicitly configured

Save button is sticky bottom-right; saves only the dirty tab.

### 6.10 `/share/[id]` — public preview gallery

- Masonry grid of creatives (same CSS-column approach)
- Left sidebar (toggleable): title, creator, date, filters (if baseColor set or multiple products), comments list grouped by asset
- Card click → full preview modal:
  - Image/HTML render (aspect-ratio preserved)
  - Comments section (per asset): list + add comment form (name + text + visual markup — click/drag on preview to place point or rect, anchor stored as `{x%, y%}` or `{x%,y%,w%,h%}`)
  - Prev/Next nav through gallery
  - Download this asset button
- Download All button → calls `/api/shares/[id]/zip`

No auth; comments include author name (plain string, not user-linked).

### 6.11 Global command palette (`Cmd/Ctrl+K` — new)

- Fuzzy search across: page names, message MC labels, audiences, topics, templates
- Actions: jump to page, open MC in editor, trigger XLSX export, trigger AdForm sync (admin), toggle theme

---

## 7. UI Conventions

### 7.1 Colors & theming
- Tailwind tokens resolved from `config.lookAndFeel` at runtime (CSS vars set on `<html>`)
- Status colors: CSS vars `--status-incoming`, `--status-naming`, etc.

### 7.2 Keyboard shortcuts
| Key | Action |
|---|---|
| Cmd/Ctrl+K | Command palette |
| Cmd/Ctrl+S | Save (in editors where applicable) |
| Cmd/Ctrl+Z | Undo last action (server-side audit undo) |
| ESC | Close modal / exit selection mode |
| Space (hold) | Pan in grid/tree/sankey |
| Arrow keys | Navigate tree nodes |

### 7.3 Icons
Lucide React throughout. Menu icons match v5 (Table / Image / Package / BarChart3 / FileCode / UsersIcon / SettingsIcon).

### 7.4 Fonts
Local-loaded (`public/fonts/`): Novatica, TeleNeo. Remote (via next/font): Inter, Poppins.

### 7.5 Empty states
Every list has a branded empty state (icon + "No X found" + primary action button where relevant).

### 7.6 Error handling
- Server errors → red toast bottom-right with "Retry" button where safe
- 409 optimistic-lock errors → toast "This was edited by another user — reloading latest" + silent refetch
- No `?.`/`??`/try-catch to paper over missing data; validate at system boundaries only

---

## 8. Non-functional Requirements

### 8.1 Performance
- Matrix render (grid mode) < 50ms for 100×100 cells × 3 MCs each (~30k items) via virtualization
- Masonry first paint < 200ms for 500 items
- Template preview iframe re-render < 200ms after field edit (debounced 200ms + server render < 50ms)
- AdForm sync of 10k banner rows < 5s

### 8.2 Concurrency
- Optimistic row-level locking via `version` column; 409 on conflict
- SSE broadcast of all writes → clients invalidate matching TanStack Query keys
- MCP writes go through same API layer as UI → no divergence risk
- No session-based locks, no distributed locks (single Next.js process)

### 8.3 Reliability
- Nightly automatic SQLite backup to `backups/matrix-YYYY-MM-DD.db` (kept 14 days)
- File storage: soft-delete with 30-day retention before actual unlink
- Audit log retained forever (small footprint); used for server-side undo

### 8.4 Deployment
- PM2 ecosystem config matches v5 style
- `.env` example with every required var documented (see §11)
- `update.sh` script for deploy pulls
- Instance switch preserved (`instances/` snapshots DB + storage + .env)

---

## 9. Spreadsheet I/O — Bidirectional

### 9.1 XLSX export (`/api/export/xlsx`)
Workbook with one sheet per entity. Column order from `config.*Structure`. Reporting sheet included. Download filename: `messagingmatrix-export-YYYY-MM-DD.xlsx`.

### 9.2 XLSX import (`/api/import/xlsx`)
Two modes:
- **Replace** — truncate target tables, insert all rows from file. Requires admin + explicit confirm.
- **Merge** — upsert by natural key (`audiences.key`, `topics.key`, `messages.number+variant`, `assets.id`/`creatives.id` if present, else skip). Rows missing from file are left alone.

`dryRun: true` returns diff without committing.

### 9.3 Google Sheets export (`/api/export/sheets`)
Optional — requires service account JSON in config. Creates a new sheet or overwrites specified tabs. Sheet IDs remembered in `config.spreadsheetExportLast` so "Export now" overwrites same sheet by default.

### 9.4 Google Sheets import (`/api/import/sheets`)
Same modes as XLSX import. Uses Sheets API to read tabs matching the structure config. For one-time migration from v5 to v6.

### 9.5 Migration path from v5
One-shot script `scripts/migrate-from-v5.js`:
1. Pull all tabs from v5 Sheets via service account
2. Pull all unique Drive IDs, download files into `storage/`
3. Rewrite asset/creative/message image* fields from Drive ID → new `uploaded_files.id`
4. Import users, config, share_galleries from v5 SQLite
5. Re-run AdForm sync to populate `reporting` table

---

## 10. File Storage (local disk)

Structure under `storage/`:
```
storage/
  assets/{yyyy}/{mm}/{uuid}.{ext}
  creatives/{yyyy}/{mm}/{uuid}.{ext}
  share-files/{shareId}/…   (for generated share ZIPs, cached)
  .thumbs/{fileId}-{w}.{ext} (on-demand resized thumbnails)
  .deleted/{yyyy}/{mm}/…    (soft-deleted files awaiting cleanup)
```

- Files served via `/api/files/[id]`; direct disk path never exposed
- `sha256` dedupe: upload computes hash, if existing row found, reuse file and point new logical reference at it
- Thumbnails generated via `sharp` on first request, cached under `.thumbs/`
- Nightly cleanup: hard-unlink files in `.deleted/` older than 30d

---

## 11. Environment Variables

| Var | Required | Notes |
|---|---|---|
| `PORT` | default 3000 | Next.js port |
| `JWT_SECRET` | ✅ | For auth tokens |
| `DATABASE_URL` | default `file:./db/matrix.db` | SQLite path |
| `STORAGE_ROOT` | default `./storage` | File storage dir |
| `MCP_BEARER_TOKEN` | ✅ | Enables `/mcp` |
| `ADFORM_REPORT_PATH` | optional | XLSX fallback |
| `ADFORM_CLIENT_ID`, `ADFORM_CLIENT_SECRET`, `ADFORM_TOKEN_URL`, `ADFORM_API_BASE`, `ADFORM_SCOPE` | optional | Live API |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | optional | For one-shot Sheets export/import |
| `NODE_ENV` | | |

**Removed from v5:** `VITE_ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROK_API_KEY`, `VITE_API_URL`, `JWT_EXPIRATION` (hardcoded 5d), `GOOGLE_SERVICE_ACCOUNT_PATH` (replaced by inline JSON env).

---

## 12. Explicitly Out of Scope (removed vs v5)

- `/api/claude/*`, `/api/gemini/*`, `/api/grok/*` (all AI provider endpoints)
- `/api/ai-prompts/*` and the `AI/` directory
- `/api/ai-data-structure`
- Message Editor "Generate" tab
- AI model / prompt settings tabs
- `@anthropic-ai/sdk` dependency
- Anything related to AI assistants, streaming, embeddings, or prompts
- v5 cache-sync machinery (`services/syncService.js`, `src/services/sheets.js`) — Sheets is not runtime
- v5 MCP Sheets caveat ("UI Save clobbers MCP writes") — no longer applies
- `/api/drive/*` as a runtime dependency — replaced by `/api/files/*` (Drive only used once for migration)
- IMAP dependencies (`imapflow`, `mailparser`) — unused in v5, dropped

---

## 13. Implementation Order (for the one-shot)

1. **Scaffold** — Next.js 15 + TypeScript + Tailwind + shadcn + Drizzle + `better-sqlite3`. Auth middleware + JWT + login page.
2. **Schema + migrations** — all 13 tables (§3), plus FTS5 virtual table for messages search.
3. **Entity CRUD APIs** (§4.2) with optimistic locking + audit logging.
4. **File upload + serve** (§4.4, §10). Thumbnailing via `sharp`.
5. **Template filesystem + render API** (§4.5, §4.6).
6. **Matrix page** — Grid view first, then Feed, Tree, Sankey. Virtualization day one.
7. **Message Editor modal** — 5 tabs, live preview iframe, auto-save with debounce.
8. **Creative Library + Assets** — masonry via CSS columns; virtualized fallback for >500.
9. **Monitoring + AdForm sync** — preserve v5 extraction regexes verbatim.
10. **Templates editor** (§6.7) — single-page editor with template selector + MC navigator stepper, CodeMirror 6 with explicit Save/Cancel (no auto-save), draggable divider, aspect-ratio layout flip (≥1.5), preview scale-to-fit with light/dark/checker bg, slide-in Files panel + Bindings panel.
11. **Users + Settings + Shares**.
12. **MCP server** (§5) — port v5 tools, add 4 batch variants.
13. **XLSX import/export**; Google Sheets import/export behind service account config.
14. **SSE events** — wire up TanStack Query invalidation on the client.
15. **Migration script** from v5 (§9.5).
16. **Command palette** (`Cmd/Ctrl+K`).
17. **Audit undo** on `Cmd/Ctrl+Z`.

---

## 14. Critical Files & Logic to Preserve Verbatim

- **AdForm MC label + size extraction regexes** (from v5 `services/adformSyncService.js`)
- **Pattern evaluator** placeholder + modifier syntax (`{{var|lower}}`, conditional `{{var}}=value?yes:no`)
- **PMMID / trafficking URL construction**
- **MC numbering rules** on insert (empty cell vs occupied)
- **Text formatting span application at render time** (scope matching by size + MC label)
- **Template `template.json` binding shape** (`type`, `binding-messagingmatrix`, `path-*`)

---

## 15. Verification Plan

Once implemented:

1. **Schema smoke** — Run migrations on empty DB; insert one of each entity via API; verify audit rows created; verify `version = 1`.
2. **Optimistic locking** — Two browsers edit same message; second save returns 409 with current version; second browser auto-refetches; retry succeeds.
3. **SSE** — User A edits, User B's grid updates without refresh within 1s.
4. **MCP** — From Claude Desktop, run `mc_create_batch` with 10 messages; verify rows appear in grid live; verify audit entries.
5. **Masonry** — Load Creative Library with 1000 creatives; measure FCP < 200ms; scroll smoothness (no jank).
6. **Matrix render** — 100×100 grid with 30k MCs; zoom/pan 60fps; filter change <100ms.
7. **XLSX round-trip** — Export XLSX; wipe DB; import in replace mode; compare row counts + checksums of non-timestamp columns.
8. **Google Sheets migration** — Run v5 migration script on a v5 snapshot; verify all messages/audiences/topics/files carry over.
9. **AdForm** — Load same XLSX v5 used; compare Reporting table row-by-row (should be byte-identical except `synced_at`).
10. **Undo** — Delete an audience, `Cmd/Ctrl+Z`, audience restored with previous version; all dependent messages still point to its key.
11. **Share gallery** — Create share, open in incognito, add comment, verify appears on refresh.
12. **Permissions** — demo user sees UI but all mutation APIs return 403.

---

---

## 16. Testing Strategy (TDD against v5 as contract)

### 16.1 Philosophy

Every module in v6 is implemented **test-first**, with v5's observable behavior captured as fixtures serving as the contract. This means: before v6 writes a single line of feature code, we run scripts against v5 to produce a set of golden outputs. v6 tests then assert equality.

**Coverage shape (locked):**
- **Critical preserved logic** → 100% branch coverage, locked via v5 fixtures (AdForm extraction, pattern evaluator, PMMID, MC numbering, CTR, text formatting scope, template render, XLSX shape)
- **Rest of system** → happy path + key error cases only, not exhaustive
- **UI** → Playwright E2E for each page (user flow smoke) + React Testing Library for complex widgets (MessageEditor, MatrixGrid, MasonryGrid, TemplateEditor)
- **Gated** → Vitest watch locally + pre-commit hook for fast subset (<30s) + full CI suite including Playwright

### 16.2 Stack

| Purpose | Tool | Notes |
|---|---|---|
| Unit + integration test runner | **Vitest** | Fast, native ESM, fits Next.js 15 |
| Component testing | **React Testing Library + Vitest** | jsdom env |
| E2E | **Playwright** | Chromium only at first; add Firefox/WebKit later if needed |
| API testing | Next.js route handler called directly (no HTTP) or `node:fetch` against spawned `next dev` | Whichever is simpler per route |
| MCP testing | Lightweight in-test HTTP client speaking the MCP streamable protocol | |
| Pre-commit | **husky + lint-staged** | Runs unit + integration + typecheck |
| CI | **GitHub Actions** | Full suite, Node 20 + 22 matrix |

### 16.3 Phase 0 — v5 Behavior Capture (runs BEFORE v6 implementation starts)

A one-time capture pass, script `scripts/capture-v5.js` in the v6 repo (but pointed at a running v5 instance). Produces `fixtures/v5/` directory checked into v6 repo:

```
fixtures/v5/
├── dataset/                       # Seed data snapshot (scrubbed, small, stable)
│   ├── audiences.json             # 5 audiences, covering every product
│   ├── topics.json                # 5 topics, covering tag1-4 combos
│   ├── messages.json              # 25 messages: every status, every template,
│   │                              #   empty cells, occupied cells with variants,
│   │                              #   all product combos
│   ├── assets.json                # 10 assets
│   ├── creatives.json             # 10 creatives
│   ├── text-formatting.json       # 5 rules with varied scopes
│   ├── config.json                # All config keys as v5 has them
│   └── users.json                 # 3 users: admin, user, demo
├── api-responses/                 # Every GET endpoint on the dataset
│   ├── cache-audiences.json
│   ├── cache-topics.json
│   ├── cache-messages.json
│   ├── cache-assets.json
│   ├── cache-creatives.json
│   ├── templates.json
│   ├── config-basic.json
│   └── ...
├── adform/
│   ├── input.xlsx                 # Sample v5 xlsx (or real, scrubbed)
│   └── expected-reporting.json    # Exact rows v5 writes to Reporting sheet
├── pattern-evaluator/
│   └── cases.json                 # 50+ {pattern, context, expected} triples
│                                  # Covers pmmid, topicKey, trafficking.*, feed.*
├── pmmid/
│   └── cases.json                 # 20 {message, audience, topic, expected_pmmid}
├── mc-numbering/
│   └── cases.json                 # Empty cell / occupied cell / version bump scenarios
├── template-render/
│   └── {templateName}/{size}/{messageId}.html   # v5 render output per combo
├── xlsx-export/
│   └── full.xlsx                  # v5 XLSX export of the dataset
├── mcp-tools/
│   └── {toolName}/
│       ├── input-01.json
│       └── output-01.json         # One sample per tool, covering variants
└── text-formatting/
    └── cases.json                 # {rules, text, mc_label, size, expected}
```

Capture script does, for each fixture type:
1. Seed v5 instance with `fixtures/v5/dataset/` via the Sheets API
2. Run v5 operations (API GETs, AdForm sync, MCP tool calls)
3. Save outputs to JSON/XLSX under `fixtures/v5/`
4. Compute hash of each fixture; write `fixtures/v5/manifest.json` with hashes for drift detection

**Rule:** the capture script is write-once. If v5 behavior needs to be recaptured (bug fix, etc.), it's a deliberate commit with a changelog entry explaining why the fixture changed.

### 16.4 Test Tree in v6 Repo

```
tests/
  unit/                            # Pure logic, no I/O, <5ms each
    pattern-evaluator.test.ts      # Reads pattern-evaluator/cases.json, 50+ cases
    adform-extract.test.ts         # MC regex (direct + PMMID form + m_00 + 1x1),
                                   #   size regex, CTR calc — 30+ edge cases
    mc-numbering.test.ts           # Reads mc-numbering/cases.json
    pmmid.test.ts                  # Reads pmmid/cases.json
    ctr-calc.test.ts
    text-formatting-scope.test.ts  # Reads text-formatting/cases.json
    xlsx-column-order.test.ts      # structure config → column order
    topic-key-generator.test.ts    # Pattern → key, with fallback to top{order}
    filename-parser.test.ts        # Creative parsing rules

  integration/                     # Spin up SQLite, call route handlers
    api/
      auth-login.test.ts
      audiences.test.ts            # CRUD + optimistic lock (409 path) + audit row
      topics.test.ts
      messages.test.ts             # Create in empty vs occupied cell, soft delete
      messages-search.test.ts      # FTS behavior
      messages-move.test.ts        # Move + copy
      files-upload.test.ts         # Upload + sha256 dedup + thumbnail generation
      shares.test.ts               # Create + comment + public access
      adform-sync.test.ts          # Feed fixtures/v5/adform/input.xlsx,
                                   #   assert DB reporting rows == expected-reporting.json
      render.test.ts               # For each {template,size,message} in dataset,
                                   #   render and assert equal to fixture HTML
      import-xlsx.test.ts          # Import fixtures/v5/xlsx-export/full.xlsx,
                                   #   assert DB state matches dataset
      export-xlsx.test.ts          # Export DB (after import) → compare cell-by-cell
                                   #   with fixtures/v5/xlsx-export/full.xlsx
      export-sheets.test.ts        # Mock googleapis; assert correct API calls
    mcp/
      audiences.test.ts            # For each tool, call with fixture input,
                                   #   assert response == fixture output
      topics.test.ts
      messages.test.ts
      batch-tools.test.ts          # New batch tools; spec-based (no v5 fixture)
      auth.test.ts                 # Bearer query + header; 401 on wrong; 503 if unset
    concurrency/
      optimistic-lock.test.ts      # Two parallel PATCHes to same row; one 200, one 409
      mcp-vs-ui-broadcast.test.ts  # MCP write → SSE event received by subscriber
      sse-reconnect.test.ts
    audit/
      undo.test.ts                 # Create → update → undo → original state restored

  components/                      # React Testing Library, jsdom
    MessageEditor.test.tsx         # Tab switching, form state, debounced save,
                                   #   preview iframe re-renders on field change
    MatrixGrid.test.tsx            # 100x100 with virtualization,
                                   #   filter change invalidates correctly
    MasonryGrid.test.tsx           # <500 uses CSS columns, >=500 virtualizes,
                                   #   break-inside: avoid prevents card split
    TemplateEditor.test.tsx        # File switching, save button state,
                                   #   HTML warnings panel, JSON validity badge
    FilterPills.test.tsx
    CommandPalette.test.tsx

  e2e/                             # Playwright, chromium
    auth.spec.ts                   # Login happy + wrong password + logout
    matrix-grid.spec.ts            # Open /matrix, filter by product, add MC,
                                   #   edit in modal, delete, Ctrl+Z undo
    matrix-tree.spec.ts            # Switch to tree, navigate with arrows,
                                   #   verify orientation toggle
    matrix-sankey.spec.ts
    matrix-feed.spec.ts            # Sort, multi-select, bulk status change,
                                   #   export filtered feed as xlsx
    message-editor.spec.ts         # Open MC, switch tabs, edit headline,
                                   #   verify preview updates within 500ms,
                                   #   add text formatting rule, save,
                                   #   verify rule persists after reload
    creative-library.spec.ts       # Filter dynamic+static, toggle live,
                                   #   sort by CTR, open preview, download,
                                   #   verify masonry doesn't jitter on scroll
    assets.spec.ts                 # Upload, fill metadata, verify registry entry
    monitoring.spec.ts             # Trigger sync (with fixture xlsx),
                                   #   verify rows appear, sort by CTR
    templates.spec.ts              # Open template editor, edit index.html,
                                   #   verify preview updates, save, verify persists
    shares.spec.ts                 # Create share, open in fresh browser context,
                                   #   add comment with visual anchor,
                                   #   verify comment on reload
    users-admin.spec.ts            # Add user, change password, delete
    settings-admin.spec.ts         # Change header color, verify applies live
    import-export.spec.ts          # Export XLSX, wipe DB, import in merge mode,
                                   #   verify row counts match
    mcp-via-claude.spec.ts         # MCP tool calls via HTTP client,
                                   #   verify SSE broadcasts to open UI tab

  fixtures/
    v5/                            # Captured outputs, see 16.3
    scenarios/                     # Hand-crafted scenarios for edge cases

  helpers/
    test-server.ts                 # Spawn Next.js with in-memory SQLite
    test-db.ts                     # Fresh DB per test; seed helpers
    test-user.ts                   # createUser() + loginAs() helpers
    test-mcp-client.ts             # Streamable HTTP MCP client
    html-normalize.ts              # Strips whitespace, sorts attrs, removes
                                   #   known-variable bits (timestamps, UUIDs)
    xlsx-compare.ts                # Cell-by-cell XLSX comparison
                                   #   ignoring metadata (creator, date)
    seed.ts                        # Load fixtures/v5/dataset/ into DB
```

### 16.5 Runner Configs

**`vitest.config.ts`** — three projects:
- `unit` (jsdom) — tests/unit/**
- `integration` (node) — tests/integration/**
- `components` (jsdom) — tests/components/**

Runs serially within a project to avoid SQLite contention; projects parallel.

**`playwright.config.ts`** — spawn `next dev` once per run, one worker (SQLite serial), fresh DB per spec via global setup hook.

**`package.json` scripts:**
- `test` — full Vitest suite (~30s target)
- `test:watch` — Vitest watch (dev loop)
- `test:e2e` — Playwright (~3-5min)
- `test:fast` — unit + integration only (pre-commit, <20s)
- `test:all` — `test && test:e2e`

**Pre-commit (`.husky/pre-commit`):**
1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:fast`
(Playwright NOT in pre-commit — too slow.)

**CI (`.github/workflows/test.yml`):**
- Lint → typecheck → `test` → `test:e2e` → coverage report
- Fails PR if coverage on `src/lib/**` (critical logic) drops below 100%

### 16.6 TDD Loop — What the developer does

For each item in §13 Implementation Order:

1. **Write failing test first.** For preserved logic, test reads from `fixtures/v5/`. For new behavior (batch MCP tools, optimistic lock, command palette), test encodes the spec.
2. **Run Vitest watch.** See red.
3. **Implement minimal code** until green.
4. **Add next test** for next branch / edge case.
5. **Refactor** with safety net.
6. **Commit.** Pre-commit runs fast subset.

For UI items:
1. Write component test first (render + basic interaction) → implement.
2. Write Playwright spec for the user-facing flow → implement glue.

**Rule:** No feature merges to `main` without:
- Unit test for any logic branch
- Integration test for any API endpoint
- Component or E2E test for any UI behavior

### 16.7 Hard-to-Test Scenarios — Concrete Approach

| Scenario | How |
|---|---|
| Optimistic lock collision | Two `fetch()` calls started with `Promise.all`, both with same `If-Match` version. Assert one returns 200, one returns 409 with correct current version in body. |
| SSE broadcast | Test subscribes via `new EventSource()`, triggers a PATCH via API, awaits an event matching the entity+id with 1s timeout. |
| Template render byte equality | Both HTML strings passed through `html-normalize.ts` (strip whitespace, alphabetize attrs, strip known-variable bits like `data-ts=`, `data-id=` that inject timestamps or uuids). Then `expect(a).toBe(b)`. |
| XLSX byte equality | Parse both files via `xlsx` lib, iterate cells, compare values. Ignore sheet-level metadata (creator, creation date). Column order enforced via `config.*Structure` so deterministic. |
| Masonry with 1000 items | Component test mounts with 1000 items, asserts `document.querySelectorAll('.masonry-card').length <= 80` (approx 4 cols × 20 rows visible). Playwright test scrolls 500px, asserts no `layout` event in PerformanceObserver. |
| MCP tool behavior | `test-mcp-client.ts` speaks the streamable HTTP protocol to the running server, calls `tools/call` with name + args, asserts response. |
| AdForm sync equivalence | Feed `fixtures/v5/adform/input.xlsx` to v6 sync. Query `reporting` table. Compare row-by-row to `fixtures/v5/adform/expected-reporting.json` sorted by (level, mc_label, size). |
| Migration from v5 | Run `scripts/migrate-from-v5.js` against a checked-in v5 DB snapshot. Assert v6 DB tables have expected row counts; spot-check 10 random rows field-by-field. |

### 16.8 What NOT to test (and why)

- Next.js routing, RSC, middleware plumbing — framework responsibility
- SQLite transactions, WAL — `better-sqlite3` responsibility
- Drizzle query generation — lib responsibility
- `sharp`, `xlsx`, `image-size` internals — lib responsibility
- Tailwind class generation, CSS without interaction
- Type correctness — TypeScript is its own layer, run via `tsc --noEmit` in CI
- Third-party UI primitives (shadcn/ui) unless we override behavior

### 16.9 Success Criteria for "rewrite done"

- [ ] All unit tests green (100% coverage on `src/lib/**`)
- [ ] All integration tests green; every preserved-logic test reads from v5 fixtures
- [ ] All Playwright specs green
- [ ] Migration script runs cleanly on a real v5 snapshot; v6 DB validates against a manual spot-check list
- [ ] Performance budgets met:
  - Matrix grid render <50ms for 30k MCs
  - Masonry FCP <200ms for 500 creatives
  - Template preview re-render <200ms after field edit
  - AdForm sync of 10k banners <5s
- [ ] Side-by-side visual QA: every page of v6 inspected against the same page in v5 with identical seed data. Deviations recorded as either "intentional v6 improvement" or bug.
- [ ] MCP tool suite validated by running a real Claude Desktop / claude.ai connector end-to-end

### 16.10 Interview Capture — Decisions Made

- **Coverage depth:** critical-logic 100% + rest smoke-tested
- **v5 capture:** full behavior capture into `fixtures/v5/` as step zero
- **UI testing:** Playwright E2E per page + RTL component tests for complex widgets (MessageEditor, MatrixGrid, MasonryGrid, TemplateEditor)
- **Test gating:** Vitest watch locally + pre-commit fast subset (unit + integration + typecheck, <30s) + full CI including Playwright

---

## 17. Multi-Tenancy Delta (added 2026-04-26)

The original spec (§1–§16) assumed a single-tenant deploy. v6 must instead serve **multiple clients (Erste, Telekom, Proficio, …) from a single SQLite file**, with each running process locked to one client at boot. This section defines the delta. Where it conflicts with §1–§16, this section wins.

### 17.1 Goal

- One DB file, source of truth for all clients.
- Each deploy is **deploy-pinned** to one client via `ACTIVE_CLIENT_KEY` env var.
- Per-client `lookAndFeel`, sources (Drive/Sheets/AdForm), users, and matrix data.
- Templates remain a shared global folder; per-client visibility flags decide what each client sees in dropdowns.
- v5 → v6 migration runs **once for Erste**; Telekom and Proficio start greenfield.

### 17.2 New table: `clients`

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| key | TEXT UNIQUE NOT NULL | `erste`, `telekom`, `proficio` — matches `ACTIVE_CLIENT_KEY` env var |
| name | TEXT | Display name |
| status | TEXT | `active` / `archived` |
| mcp_token | TEXT | Per-client MCP bearer; rotatable from Settings |
| created_at, updated_at | | |

On first boot, if `ACTIVE_CLIENT_KEY` does not match an existing row, the row is auto-created with default `lookAndFeel` and `*Structure` config (so a fresh deploy doesn't crash on first login).

### 17.3 Schema changes to §3 tables

Every tenant-scoped table gets a `client_id INTEGER NOT NULL REFERENCES clients(id)` column and a composite-prefixed index. Affected tables (from §3):

- `audiences`, `topics`, `messages`, `assets`, `creatives`, `text_formatting`, `reporting`, `share_galleries`, `uploaded_files`, `audit_log`

Every existing index from §3 becomes `(client_id, …)`. Example: `messages` index `(topic, audience)` → `(client_id, topic, audience)`. Unique constraints are likewise scoped: `audiences.key` is unique per `client_id` (not globally), so two clients can both have `aud1`.

### 17.4 `config` becomes per-client

Spec §3.9 `config(key, value, category)` becomes:

| Field | Notes |
|---|---|
| client_id | FK to clients |
| key | TEXT |
| value | TEXT (JSON stringified) |
| category | TEXT |
| description, updated_at | |

PK: `(client_id, key)`.

All §3.9 known keys (`patterns`, `lookAndFeel`, `*Structure`, `googleDrive`, AdForm, `creativeParsingRules`, `visibleTemplates`, `spreadsheetExportLast`, `adformLastSync`) become per-client.

A new `system_config(key, value)` table (no `client_id`) holds cross-tenant settings: JWT secret rotation marker, global MCP rate limits, backup schedule, current `active_client_key` (mirrors env for read-only display).

### 17.5 `users` table — per-client

Spec §3.8 `users` gains `client_id INTEGER NOT NULL`. Unique constraint becomes `(client_id, email)` — the same email may exist for multiple clients as separate rows with independent passwords. Login resolves user by `(active_client_id, email)`. JWT carries `client_id` for defense in depth.

### 17.6 Active-client resolution

- Read `ACTIVE_CLIENT_KEY` env var at server boot. Fail fast if unset.
- Resolve `active_client = clients.where(key=ACTIVE_CLIENT_KEY)`. If missing, auto-create with defaults (and a warning log).
- Cache `active_client_id` for the process lifetime.
- Every API route in §4 asserts `req.jwt.client_id === active_client_id`. Mismatch → 403.
- Every DB query is filtered by `active_client_id` at the data-access layer (Drizzle helpers). Tests in `tests/integration/concurrency/cross-client-leak.test.ts` confirm no endpoint leaks foreign rows.

### 17.7 Login + branding flow updates

Spec §4.3 `/api/config-public`: returns `lookAndFeel` + `pageTitle` for the **active client only** (no query param). The login page (§6.1) consumes this for branded glassmorphism and CSS-variable theming on first paint.

### 17.8 Settings page additions (extends §6.9)

New tab **Clients** (admin-only), inserted as the first tab. Tab order becomes: **Clients / Storage / Design / Structure / About**.

Clients tab content:
- Table: Key, Name, Status, MCP token (masked), Created. Active row is highlighted ("This deploy serves: …").
- Buttons: **New client** (key + name, scaffolds default config), **Archive**, **Rotate MCP token**, **Seed from another client** (copies `lookAndFeel` and `*Structure` only — never user data).
- Read-only for non-admin users (still visible so they know which client this deploy is).

Storage / Design / Structure / About continue to edit the **active client only** — no behavior change vs §6.9 except they read from `config(client_id=active, …)`.

### 17.9 MCP scoping (extends §5)

- Each client row has its own `mcp_token`, generated on client creation, displayed once.
- `/mcp` resolves the client by bearer; if the resolved client_id ≠ active_client_id, return 401 (a stolen Telekom token is useless on the Erste deploy).
- Per-client rate limits live in `config(client_id, key='mcp.rateLimit')`, default `{ writesPerMinute: 60 }`.

### 17.10 File storage layout (extends §10)

```
storage/
  {clientKey}/assets/{yyyy}/{mm}/{uuid}.{ext}
  {clientKey}/creatives/{yyyy}/{mm}/{uuid}.{ext}
  {clientKey}/share-files/{shareId}/…
  {clientKey}/.thumbs/{fileId}-{w}.{ext}
  {clientKey}/.deleted/{yyyy}/{mm}/…
```

Sha256 dedup is **intra-client only** (dedup key = `(client_id, sha256)`). A Telekom asset uploaded to Erste must not become a Telekom-readable file.

### 17.11 Migration script (replaces §9.5) — Erste only

`scripts/migrate-from-v5.js` invocation:

```
node scripts/migrate-from-v5.js --client erste \
  --v5-db ../messagingmatrix/db/matrix.db \
  --v5-sheets-id $ERSTE_SHEET_ID \
  --drive-creds service-account.json
```

Steps:
1. Ensure `clients` row for `erste` exists (create if missing).
2. Run the existing v5 → v6 import (spec §9.5 steps 1–5) **scoped** so every inserted row gets `client_id = erste.id`.
3. Move files into `storage/erste/…` (not `storage/…`).
4. Verify post-migration: spot-check 10 random messages against v5; verify all `uploaded_files` resolve.

Telekom and Proficio are not migrated — admins log in to a fresh Telekom/Proficio deploy and start populating data manually (or via MCP / XLSX import scoped to that deploy's active client).

### 17.12 Templates (clarifies §3.12)

Templates remain a single shared `templates/{name}/` folder. No per-client folder. `config(client_id, key='visibleTemplates')` is a JSON object (template name → boolean) controlling dropdown visibility per client. v5 already worked this way; no template restructuring needed.

### 17.13 Tests added beyond §16

In addition to §16's tree, the following are mandatory:

```
tests/integration/concurrency/
  cross-client-leak.test.ts      # For each entity endpoint, request with
                                 #   forged JWT carrying foreign client_id.
                                 #   Assert 403, no row written/read.
tests/integration/api/
  clients.test.ts                # Clients CRUD + auto-create on boot
  auth-login-per-client.test.ts  # Same email under two clients with
                                 #   different passwords; both deploys log in
tests/integration/mcp/
  mcp-bearer-mismatch.test.ts    # Telekom token against Erste deploy → 401
tests/e2e/
  multi-deploy.spec.ts           # Spawn two next dev's with different
                                 #   ACTIVE_CLIENT_KEY against same DB;
                                 #   verify branding differs and no data leaks
```

### 17.14 Out of scope for v6.0

- A "control plane" UI that shows all clients in one view. Each deploy is single-client. If global admin views are needed later, build a separate deploy that reads the unified DB read-only.
- Runtime client switching from the UI. The only way to change which client a process serves is to edit `.env` and redeploy.
- Cross-client asset sharing.

### 17.15 Implementation order delta (extends §13)

§13 step 1 ("Scaffold") gains: read `ACTIVE_CLIENT_KEY`, fail fast if unset, auto-create client row.
§13 step 2 ("Schema + migrations") gains: `clients`, `system_config`, `client_id` on every tenant-scoped table, composite indexes, per-client `config` PK.
§13 step 3 ("Entity CRUD APIs") gains: client-scoping at the data-access layer; `cross-client-leak.test.ts` runs against every endpoint.
§13 step 11 ("Users + Settings + Shares") gains: Clients tab, per-client user CRUD.
§13 step 12 ("MCP server") gains: per-client bearer tokens; bearer/active mismatch → 401.
§13 step 15 ("Migration script") narrows to Erste only.

End of spec.
