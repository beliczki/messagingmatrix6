# Changelog

All notable changes to MessagingMatrix v6 are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
