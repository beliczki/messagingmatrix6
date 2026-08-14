# Changelog

All notable changes to MessagingMatrix v6 are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [6.12.2] — 2026-08-14

### Changed
- **Inactive audiences/topics are visually marked in the matrix.** Column and
  row header text of INACTIVE audiences/topics renders pale gray
  (`text-text-tertiary`, dense vertical labels included); header background
  and behaviour unchanged.

## [6.12.1] — 2026-08-14

### Fixed
- **MC editor no longer conflicts with itself during autosave.** Slow typing
  (especially in style / image-name fields, whose keystrokes queue extra
  render/proxy requests ahead of the PATCH) could fire two overlapping saves
  with the same `If-Match`, so the second 409'd and the editor showed
  "Someone else saved changes…" and halted autosave. Saves are now strictly
  serialized (in-flight guard, drift re-armed against the fresh snapshot;
  manual Save double-click included), the stale-tab check ignores older rows
  echoed back by the editor's own SSE invalidate (only a genuinely NEWER
  version counts as a peer edit), and seven stale-closure `setDraft` spreads
  became functional updates. Real two-tab conflict detection is unchanged.
- **`seed-channel-audiences` script crash on the box** — unawaited
  `getActiveClient()` (SQLite→PG cutover leftover) made `client.id` undefined
  (`UNDEFINED_VALUE`). Nine sibling scripts carry the same latent bug —
  triaged as a NOW roadmap item (retire-vs-fix per script).

## [6.12.0] — 2026-08-13

### Added
- **Agentic test-creative production over MCP.** New `generate_test_creative`
  tool stages a draft creative OUTSIDE the matrix (new `draft_messages` table —
  no audience/topic/MC number) from a template + content fields + uploaded
  image filenames + a size list, then renders each size to a PNG asynchronously
  on the shared server-side Chromium. Agents poll `draft_status` for
  percent/elapsed/per-size preview URLs (migration `0006`).
- **Draft MCP tool set.** `list_drafts`, `draft_get`, `draft_status` and the
  `show_draft_previews` Apps-SDK gallery widget (reusing the MC previews
  widget) are read-scope; `generate_test_creative`, `draft_delete` (hard
  delete incl. preview PNGs) and `draft_promote` (into a matrix cell via the
  standard numbering/PMMID/trafficking pipeline, back-linked through
  `promoted_message_id`) are full-scope.
- **Drafts page.** Thin `/drafts` view (sidebar: Drafts) with masonry preview
  tiles, live render-progress polling, and a detail dialog offering Promote
  (audience + topic picker) and Delete. Public PNG serve route
  `/api/draft-previews/[id]` mirrors `/api/previews/[id]`.

### Changed
- **Preview shooter generalized.** `preview-shooter.ts` now exposes a generic
  `shootItems` (persistence supplied per item); `shootPreviews` keeps its
  exact signature and behaviour for message previews. Draft renders queue on
  the same one-Chromium mutex as message preview shoots.

## [6.11.0] — 2026-07-22

### Added
- **DCO / nonDCO matrix axis.** A segmented toggle in the matrix header switches
  the grid between DCO (template-driven messages) and nonDCO (static image
  creatives). The two worlds partition cleanly on `audiences.channel` (NULL vs a
  prodlist channel), so DCO never shows the channel columns and vice versa. The
  choice persists in `mm6_matrix_state_v1`.
- **Static creatives become first-class MCs.** A nonDCO MC is a template-less
  `messages` row (`image1` = the creative file), so it gets an MC number and is
  addressable everywhere — including MCP `list_mc` / `mc_get` with zero MCP
  changes. Preview surfaces (grid tiles + the editor pane) render the image
  directly instead of attempting an HTML render.
- **`creative_promote` MCP tool.** "Matrixize" an uploaded creative into a nonDCO
  MC: creates the message on the channel-audience at an auto-derived topic (from
  the filename, freeze-safe reuse-before-create) and back-links the creative via
  `mc_number`/`mc_variant`. Channel comes from an explicit arg or a prodlist
  familyKey match.
- **Prodlist ingest (FR-A, deliverable-grain).** New `prodlist_rows` table with
  `list_prodlist` (read) + `prodlist_upsert` (idempotent batch write) MCP tools —
  the source of the 6 channel-audiences (DISP/SOC/PRG/GSN/GNW/YT) and of the
  creative→channel classification.
- **`audiences.channel` column** + `scripts/seed-channel-audiences.ts` to seed the
  6 channel-audiences for a client.

## [6.10.0] — 2026-07-22

### Changed
- **MCP report tools accept a plain ISO `from` date.** `report_performance` and
  `get_mc_reporting` previously matched `from` by exact string against the stored
  `period_from` (`"01/06/2026 00:00:00"`, DD/MM/YYYY), so an agent passing ISO
  (`2026-06-01`) got a silent empty result that looked like "no data". A shared
  `resolvePeriodFrom` helper now normalizes DD/MM/YYYY ↔ ISO, and `get_mc_reporting`
  returns an error listing the available periods (instead of a silent empty) when
  `from` matches nothing.

### Removed
- **`list_mc` `monitoring_status` filter.** It queried the legacy `reporting`
  table, which the current AdForm pipeline never populates (and `monitoring` has
  no status column), so the filter always returned zero rows — a trap that
  misled agents into thinking "no active MCs". Removed the parameter, its dead
  code path, and the description mention.

## [6.9.0] — 2026-07-21

### Added
- **Add an audience/topic straight from the matrix (W1.3).** In edit mode the
  grid grows an MM5-style trailing add cell at the end of each axis — a wide
  whole-cell `+` column for the column axis and a tall `+` row for the row axis;
  clicking it creates a header with a default name (key auto-generates
  server-side) via the existing `POST /api/{audiences,topics}` route, refetches,
  and opens the header dialog for an immediate rename.
- **Duplicate an audience/topic straight from the matrix headers (W1.4).** In edit
  mode, hovering an audience or topic header shows a Duplicate button that clones
  the header (suffixed key + name, no cells) via the existing
  `/api/{audiences,topics}/[id]/duplicate` route and refetches the grid. Failures
  surface in the edit-mode error banner.

### Changed
- **The in-cell "New MC" affordance now shows in dense view too (W1.2).** Dense
  cells are too narrow for the `+ new` pill, so they get a small round `+` icon
  button (revealed on cell hover) — consistent with the wider densities.

### Fixed
- **Matrix status dots now follow the Design-tab colour tokens (W0.1).** The
  matrix grid, feed, message editor, header dialog and status-filter swatches
  read `STATUS_COLOR`, which mapped each status to a hardcoded Tailwind `bg-*`
  class — so editing status colours in Settings → Design had no effect on the
  matrix. `STATUS_COLOR` now points at the CSS-var-backed `.status-dot--*`
  classes (single source of truth). Also fixed a latent gap: `lookAndFeelToCssVars`
  never emitted `--status-archived`, so ARCHIVED dots were unstyled on first paint.

## [6.8.0] — 2026-07-21

### Fixed
- **`get_mc_reporting` was querying the empty `reporting` table** and returned
  `{label:null, banners:[]}` for every input. It now reads the `monitoring` table
  (the live report source), so it actually returns data.

### Changed
- **`get_mc_reporting` gains MC number/variant lookup + richer output.** Look up by
  `mc_number` (+ optional `variant`, the reliable key) or `mc_label` (a message
  PMMID is resolved to its number+variant, since the monitoring PMMID carries an
  extra `-l_<lineitem>` suffix; a full monitoring PMMID matches exactly). Optional
  `from` scopes to one report period. Returns `{ mc, matched_rows, totals,
  by_variant, by_size, by_audience }`, each a `{impressions,clicks,cost,
  conversions,ctr}` block, summed across the audience cells a number+variant spans.

## [6.7.5] — 2026-07-21

### Fixed
- **`show_mc_previews` widget height, take 2.** ChatGPT measures the `#root`
  element height, not the body, so OUTER (body) padding is not counted. Frame
  spacing is now inner margins on the title (`1rem 16px`) and gallery (`1rem`),
  with `#root { display: flow-root }` so those inner margins are contained and
  stretch `#root` to the correct height.

## [6.7.4] — 2026-07-21

### Fixed
- **`show_mc_previews` widget spacing + height, together.** `display: flow-root`
  on the body makes it a block-formatting context, so inner margins are contained
  and counted in the height the Apps SDK reports (a bottom margin previously
  escaped the body, causing dead space). Restored the 1rem spacing around the
  title and between cards, with a 1.5rem body-padding frame.

## [6.7.3] — 2026-07-21

### Fixed
- **Preview dedup now keeps the NEWEST reshot copy of a fan-out variant.** The
  same MC number+variant lives in several audience cells, each with its own
  preview row regenerated at different times. The `(variant, size)` dedup picked
  the first by message id, which could be a stale copy while a fresher one exists
  (e.g. MC244d 300x250 served the 2026-07-12 render instead of 2026-07-21).
  `show_mc_previews` and `get_mc_preview_files` now order by `updated_at` desc, so
  the most recently reshot copy wins.
- **`show_mc_previews` widget height.** Removed the outer 1rem margins on the
  title/gallery — a bottom margin is not counted in the height the Apps SDK
  reports, which left dead space under the widget. Spacing now comes only from the
  body padding, which also lines the title up with the cards.

## [6.7.2] — 2026-07-21

### Fixed
- **Preview URL cache-buster now uses `updated_at`, matching the matrix editor.**
  The MCP tools previously keyed `?v` on a hash of the storage key, a different
  scheme from the UI's `?v=<updated_at>` — so the same preview had two URLs and
  two cache entries. All preview URLs (`list_mc`, `mc_get`, `show_mc_previews`,
  `preview_generate`) now use the row's `updated_at` (bumped on every reshoot),
  identical to `MessageEditor.tsx`, so one cache entry is shared and a regenerate
  reliably invalidates it.

### Changed
- `show_mc_previews` widget: the title gets the same 1rem margin as the gallery so
  it lines up with the cards.

## [6.7.1] — 2026-07-21

### Changed
- **`show_mc_previews` polish.** `sizes` now DEFAULTS to `["300x250"]` (pass other
  sizes explicitly, or `["all"]` for every size). Title no longer uses an em-dash:
  a single variant shows `MC244d · <name>`, multiple distinct variants list their
  labels (`MC244b, MC244c, MC244d`) since their names differ. Widget: 1rem gallery
  margin, and each preview is now a link that opens the full-size image in a new
  tab.

## [6.7.0] — 2026-07-21

### Added
- **`show_mc_previews`: size + multi-variant selection.** New optional inputs
  `sizes` (e.g. `["300x250"]` to show ONE size), `variants` (e.g. `["b","c","d"]`
  to show several distinct cards side by side). Preview items now carry a `label`
  (`MC244b`) so variants are distinguishable in the gallery. Dedup is now by
  `(variant, size)` — a variant fanned out across audiences collapses to one, but
  distinct variants each stay (previously same-size distinct variants were wrongly
  collapsed). Same `(variant, size)` dedup applied to `get_mc_preview_files`.

## [6.6.1] — 2026-07-21

### Fixed
- **Preview URLs are cache-busted** (`?v=<hash-of-storage-key>`) in `list_mc`,
  `mc_get`, `show_mc_previews` and `preview_generate`. The preview row id is stable
  across regenerates while the bytes change, so the old URL kept serving the
  pre-fix image from the browser / CDN / ChatGPT image-proxy cache — regenerating
  "didn't take". The hash flips exactly when the stored image changes. (Note:
  template / THM / copy edits don't bump `messages.version`, so a plain
  `preview_generate` treats those sizes as fresh — pass `force: true` to reshoot.)
- **`show_mc_previews` widget: dark-mode header + duplicate previews + layout.** The
  gallery name/labels track the ChatGPT theme (theme-aware CSS vars via
  `prefers-color-scheme`) instead of a hardcoded dark color invisible on dark
  backgrounds. Previews are deduped to one per size — a card fanned out across N
  audience cells no longer shows each size N times (same size-dedup applied to
  `get_mc_preview_files`). Layout: 2rem padding, masonry (CSS multi-column) instead
  of a fixed grid, and no reserved scrollbar gutter (grows to content height).

## [6.6.0] — 2026-07-21

### Added
- **MCP: `show_mc_previews` OpenAI Apps SDK render widget.** A read-only tool that
  returns `structuredContent { name, previews:[{size,url}] }` (absolute, public
  preview URLs) plus a registered UI resource (`ui://widget/mc-previews.html`,
  `text/html;profile=mcp-app`) so ChatGPT / MCP Inspector render the previews as an
  inline `<img>` gallery. Wired via `_meta.ui.resourceUri` +
  `openai/outputTemplate`; the widget CSP `resourceDomains` is set to the deploy
  origin. Non-widget clients (e.g. Claude) still get the structuredContent + a text
  summary. Declared the server `resources` capability. Complements
  `get_mc_preview_files` (raw bytes for model vision) — this one is the human-facing
  visual card.

## [6.5.0] — 2026-07-21

### Added
- **MCP: image-content file tools for vision analysis.** `get_mc_preview_files`
  returns rendered MC preview screenshots as **native MCP image content** (inline
  image/png bytes, not an auth-token URL) — identify by mc_label or
  mc_number(+variant/audience_key), optional `sizes` filter, multiple sizes per
  call, each image preceded by a naming text line. `get_media_file` returns an
  uploaded asset or creative (by `file_name`, optional `category`) as native
  image content. Both are read-scope; guards: 8MB per-file inline cap, ≤16
  previews per call, non-image files rejected with their mime type.

## [6.4.0] — 2026-07-21

### Changed
- **MCP `mc_get`: preview_urls + number/variant lookup.** Now returns each MC
  with its `preview_urls` map (same shape as `list_mc`), and looks up by EXACTLY
  ONE of `mc_label` (PMMID) or `mc_number` (optionally narrowed by `variant`).
  Since a number can span several cells/variants (card fan-out is a copy), the
  result is now **always an array** (was a single object/null); `include_archived`
  added, archived rows excluded by default.

## [6.3.0] — 2026-07-21

### Added
- **MCP: monitoring performance read tools.** `report_performance` aggregates
  imported monitoring reports by **product × platform**, each split into matched
  vs unmatched (matched = report row resolved to a matrix message), with
  impressions / clicks / cost / ctr per bucket plus per-cell and grand totals.
  Defaults to the newest report period; `from` selects another; optional
  `product` / `platform` filters. `list_report_periods` lists the available
  report periods (newest first, with per-period totals) so an agent can discover
  which `from` values exist. Both are read-scope tools.

## [6.2.0] — 2026-07-21

### Changed
- **MCP: replaced `creative_create` with `creative_upload`.** The `6.1.0`
  `creative_create` only wrote a metadata row and could not attach a file, so it
  produced blank Creative Library tiles (the tile renders from the uploaded file by
  `fileId`; `asset_upload` stores `category:"asset"` files, which the Creative Library
  does not list). `creative_upload` mirrors `asset_upload` — accepts `data_base64` /
  `source_url`, stores bytes as `category:"creative"`, then creates the linked
  `creatives` row (with optional `mc_number` / `mc_variant` to bind it to a matrix
  cell). `creative_update` / `creative_remove` / `creative_restore` are unchanged.

## [6.1.0] — 2026-07-21

### Added
- **MCP: Creative Library tools.** `list_creatives` (read; case-insensitive
  `file_name_contains` / `visual_keyword_contains` LIKE search, exact
  `brand`/`product`/`type`/`mc_number` filters, `include_archived`, `limit` ≤ 1000;
  each row returns `id` + `version`) plus the write set `creative_create` /
  `creative_update` / `creative_remove` (archive) / `creative_restore` (scope `full`
  only, `id` + `version` optimistic lock, rate-limited, audited). Closes the gap where
  the `creatives` table had a full entity layer and REST route but no MCP surface —
  unlike assets (`list_assets`) and messaging cards (`list_mc`).
- Settings → MCP tab: a "Creative library" group in the tool listing so the four CRUD
  tools render together (`list_creatives` lands under "List & read").

## [6.0.0] — 2026-07-21

_First numbered release — graduation from `6.0.0-pre`._

### Changed
- **Database: migrated from SQLite to a self-hosted Supabase Postgres on Hetzner.**
  Local development and the live deploy now read/write the same database, so local
  testing runs against live data. Kept Drizzle ORM; switched the dialect from
  `sqlite-core` to `pg-core` and the driver from `better-sqlite3` to `postgres-js`.
  The data-access layer is now async end to end (entities, lib, ~60 route handlers,
  the MCP server, and Server Components).
- Timestamp columns keep their exact SQLite text format (`YYYY-MM-DD HH:MM:SS`, UTC)
  via a shared `nowUtc` default, so no stored values drift across the move.
- Test harness now targets a shared `mm6_test` Postgres database (migrate-once +
  `TRUNCATE … RESTART IDENTITY` per test); integration test files run strictly
  serially (`fileParallelism: false`).

### Added
- `src/lib/entity-route.ts` — a CRUD route factory (`makeCollectionRoute` /
  `makeItemRoute` / `makeRestoreRoute` / `makeDuplicateRoute` / `makeHardDeleteRoute`)
  that collapses 19 previously byte-identical entity-CRUD route files.
- `scripts/backfill-to-pg.mjs` — one-shot SQLite→Postgres data backfill (idempotent,
  preserves ids + timestamps, resets identity sequences).
- AsyncLocalStorage transaction context in `src/db` so entity functions that use the
  module-global `db` participate in an enclosing `db.transaction(...)` — keeping batch
  MCP tools, snapshot restore, and keyword reorder atomic on Postgres.

### Fixed
- Snapshot restore now resets identity sequences after re-inserting rows with explicit
  ids (SQLite advanced them implicitly; Postgres does not).
- Unique-violation detection uses SQLSTATE `23505` (postgres-js wraps the error in a
  `DrizzleQueryError`, so the constraint text is on `.cause`, not `.message`).
- XLSX dry-run import threads the transaction handle so a "dry" run cannot leak writes;
  keyword imports use `onConflictDoNothing()` (a failed statement aborts a whole
  Postgres transaction, unlike SQLite).
- `count(*)` aggregates cast to `::int` / `::float8` to avoid bigint-as-string results;
  list orderings gained id tiebreakers for second-precision timestamp ties.

### Removed
- The `better-sqlite3` runtime path (`getSqlite`) and the SQLite Drizzle migrations
  (replaced by a single generated Postgres migration).

### Notes
- The 13 one-off `scripts/*` (dev/seed/maintenance) still reference the removed SQLite
  handle and are excluded from the app build's type-checking; they need an async pass
  before use.
