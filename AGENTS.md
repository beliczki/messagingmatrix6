# AGENTS.md

Project-level guidance for every agent working in this repo: Claude Code, Codex and the Chief Architect. The user's global rules in `~/.agents/AGENTS.md` (the same file as `~/.claude/CLAUDE.md`) apply on top of this file. Claude Code reads this file through `CLAUDE.md`.

## Meaning: Drive folder and semantic model

- **Project Drive folder:** `~/GoogleDrive/Data/MessagingMatrix/`. Supporting documents go here, not into the repo. Client deliverables (exports, shared sheets) go to the client folders, `~/GoogleDrive/Data/ERSTE HU/_messagingmatrix.ai/` and `~/GoogleDrive/Data/Telekom/_messagingmatrix.ai/`.
- **Semantic model:** none yet. A study and roadmap towards one exists: the Google Doc "A kódtól a megbízható rendszermodellig — MM6 és Bizi" (2026-11-02, re-read 2026-11-05); customBrain holds it as "Messaging matrix — Szemantikai modell roadmap". Its first model stage, a readable semantic model, has not been built. Until it exists, a plan says that no model covers the change.
- **Meaning documents that exist.** Give the date of the one you rely on, and check `git log` for code that changed after it:
  - `mm6-docs/REBUILD_SPEC.md` in the Drive folder: the v6 design spec, with the multi-tenancy delta D1–D11 layered on top (file dated 2026-09-06).
  - `mm6-docs/MM6_PURPOSE_STATE_CAPABILITIES.md` in the Drive folder: purpose, state and capabilities as of 6.39.0 (2026-09-06). Likely out of date.
  - `MM6_SYSTEM_OVERVIEW.md` in the Drive folder (2026-05-15).
  - The other studies and reports from the former `docs/` are in the Drive folder's `mm6-docs/`; its Erste spreadsheets are in the ERSTE client folder's `mm6-docs/` (moved 2026-11-22).
  - `docs/` stays gitignored as a scratch folder: `scripts/gen-*` write their reports there (move them to Drive), and `import-erste`, `reimport-media` and `seed-keywords` default to the Erste source sheet there, so pass its path.

## Where plans live
- **`tasks/todo.md`** — lean active roadmap + recent checkpoints. **Read first, read fully** (kept small on purpose). New session checkpoints append to the bottom; open work is the "Nyitott roadmap" section.
- **`tasks/todo-archive.md`** — full verbatim history (Phase 0–10 logs, every deploy/session checkpoint 2026-04 → 2026-11-11, ~9100 lines). The long-term memory — nothing gets deleted, only appended. Read it (tail/offset/grep) when you need the detail behind a roadmap pointer. When `todo.md`'s checkpoints pile up, roll the old ones into here and leave a one-line pointer.
- **`REBUILD_SPEC.md`** (Drive folder, `mm6-docs/`) — v6 design spec; multi-tenancy delta D1–D11 layered on top.
- **`tasks/component-inventory.md`** — semantic class names already in use. Check before inventing a new block name.

## Versioning

Semver (`major.minor.patch`), tracked in the single `package.json` at repo root. The current version is the one in that file. **Graduated to `6.0.0` on 2026-07-21.** Everything needed for base daily use is in place — the system is live. The former "pre-active-use punch list" at the bottom of `tasks/todo.md` is **no longer a launch blocker**; it is now the **top-priority backlog** (platform expansion — Meta/DV360/Direct Display, reporting ingest, creative↔cell matching, smoke tests). Regular post-`6.0.0` semver is the live rule from here.

**After finishing any shipped work — a completed plan, a bug fix, a new route/page/MCP tool, a schema migration, a dependency upgrade — remind the user to bump the version before wrapping up.** Don't bump silently. Surface a suggestion in the form:

> Suggested bump: `6.1.0` → `6.1.1` (patch). Reason: <one sentence>.

### Bump heuristic

Regular semver is live (we are post-`6.0.0`). Bump on finished work, per category:
- **patch** (e.g. `6.1.0` → `6.1.1`): bug fix, doc-only change, internal refactor with no behaviour change, copy or CSS-only tweak, env-var rename with backwards-compatible fallback.
- **minor** (e.g. `6.1.0` → `6.2.0`): new feature or page, new MCP tool, new HTTP route, new DB column / index / table, new dimension-grid column, schema migration, new pattern-token, or any user-visible behaviour change. Breaking changes still allowed on minor bumps until the API stabilizes.
- **major** (`6.x.y` → `7.0.0`): incompatible schema/API break that needs explicit migration steps. **User decides — never auto-suggest a major bump.**

If the finished work is ambiguous (e.g. touches multiple categories), propose the higher bump and explain both options in one line — let the user decide.

### Changelog
- Log every bump in `CHANGELOG.md` at the repo root (already exists, "Keep a Changelog"-style: prepend a `## [6.1.1] — 2026-MM-DD` section then bullets, newest on top under `[Unreleased]`).
- One line per shipped change, grouped under `Added` / `Changed` / `Fixed` / `Removed`.
- The changelog is the user-facing record; commit messages are the developer-facing record. Don't duplicate — summarize.

### What does NOT count as "finished work" for a bump suggestion
- Work-in-progress commits within a multi-step plan (only suggest at the end of the plan).
- Pure tooling / config changes that don't affect the running app (e.g. editing `tasks/todo.md`, adding a `.claude/` or `.codex/` setting, updating a README or this file).
- Reverts of unmerged work.

## Workflow notes specific to mm6

- `tasks/todo.md` is the lean active file — read it fully. Each session's checkpoint appends to the bottom. History lives in `tasks/todo-archive.md` (large, append-only — read with `tail`/offset/grep); roll old checkpoints there when `todo.md` grows.
- Running multiple deploys in parallel: `npm run dev:erste` (port 6001), `dev:telekom` (6002), `dev:proficio` (6003), `dev:demo` (6000). All share one Postgres on the Hetzner box, reached locally through the Mac's SSH tunnel to it (see `~/.agents/infra-map.md`, "Mac"); `ACTIVE_CLIENT_KEY` picks the client.
- Tests: `npm test` (vitest). The integration suite needs the throwaway docker Postgres `mm6-test-pg` (`docker start mm6-test-pg`; its port is in the infra-map, "Mac"). New schema migrations should land with at least one integration test exercising the migration path.

## Deploy

Where it runs: `~/.agents/infra-map.md`, "Box B", the rows `mm6-erste` and `mm6-telekom`. Box-level facts (access, capacity, paths, ports) live there, never in this public repo. One codebase, one deploy per tenant; both tenants share one Postgres and one MinIO.

**Command.** On the box: `mm6-deploy <tenant>`. Its source is `deploy/bin/mm6-deploy`. It pulls (`--ff-only`), runs `npm ci` when the lockfile changed, builds into `.next-build` while the live app keeps serving, puts up the maintenance page, swaps the build in, restarts the pm2 app, waits for `/login` to answer 200, takes the page down and deletes `.next-old`. It stops before touching anything if the box's installed copy differs from the repo's.

**Before.**
- Robi's go, per tenant. A deploy is a non-trivial plan: planning review first (global rules).
- Push first: the box deploys what is on `origin`.
- Check free disk and memory (the box is the capacity risk, see the infra-map) and note the box's current HEAD, the rollback point.
- Order: `telekom` first, then `erste`.
- Daytime is fine: the build takes about 45–160 s, and the outage is about a second behind the maintenance page.

**During.** Sample free memory while it builds. If available memory falls under about 120 MB, kill the `next build`.

**Migrations.**
- Local `DATABASE_URL` points at the live database: never run `db:migrate` locally.
- `mm6-deploy` does not migrate. A deploy that brings a new `db/migrations/*.sql` goes in one pass on the box: pull, then `export $(grep '^DATABASE_URL=' .env | xargs) && npm run db:migrate`, then `mm6-deploy <tenant>`.
- Both tenants share the database, so the migration reaches both at once, and the other tenant runs its old code on the new schema until its own deploy. Keep migrations additive (old code must keep working), and deploy the second tenant right after.
- Generate migrations from `main` only.
- Write the rollback statement (e.g. the `DROP COLUMN`) into the plan before deploying.
- Note (2026-11-22): this sequence is assembled from the manual deploys of 6.33–6.73 and the script; no migration deploy alongside `mm6-deploy` is recorded in `tasks/todo.md`.

**Rollback.**
- The build fails: nothing was touched, the old build keeps serving.
- The app does not come up: the maintenance page stays on and `.next-old` is kept. Swap it back, `pm2 restart` the app, `mm6-maint off <tenant>`.
- After a successful deploy `.next-old` is already gone: `git revert`, push, `mm6-deploy` again. If the lockfile moved, that deploy runs `npm ci` by itself.

**After.**
- HEAD is the pushed commit and `package.json` has the new version.
- The pm2 app is online, and its restart count went up by one only.
- `/login` answers 200 and a share page answers 200 (that request adds one to its view count).
- A new route answers 401 without a session.
- The error log has no new lines, and no `.next-old` or `.next-build` is left.
- `/_next/image` answers 404 (`images.unoptimized` since Next 16.4.5).

**Lessons from this repo.**
- Behind nginx, `req.url` carries the local bind address, not the public host. Build absolute URLs with `requestOrigin()` (`src/lib/mcp.ts`): x-forwarded-host, then Host, then `req.url`.
- The build prerenders the root layout against the database, so `DATABASE_URL` must be valid before `npm run build`.
- On the box the storage root sits on a different filesystem from the temp directory: stage files with `copyFile`, never `rename` (`EXDEV`).
- Building in place killed the live app for the whole build, which is why the build goes to `.next-build`.
- The installed copy of the deploy script drifted from the repo once, which is why it compares itself with the repo's copy.
