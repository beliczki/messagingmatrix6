# Changelog

All notable changes to MessagingMatrix v6 are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
