# AGENTS.md

Project-level guidance for every agent working in this repo: Claude Code, Codex and the Chief Architect. The user's global rules in `~/.agents/AGENTS.md` (the same file as `~/.claude/CLAUDE.md`) apply on top of this file. Claude Code reads this file through `CLAUDE.md`.

## Meaning: Drive folder and semantic model

- **Project Drive folder:** `~/GoogleDrive/Data/MessagingMatrix/`. Supporting documents go here, not into the repo. Client deliverables (exports, shared sheets) go to the client folders, `~/GoogleDrive/Data/ERSTE HU/_messagingmatrix.ai/` and `~/GoogleDrive/Data/Telekom/_messagingmatrix.ai/`.
- **Semantic model:** none yet. A study and roadmap towards one exists: the Google Doc "A kódtól a megbízható rendszermodellig — MM6 és Bizi" (2026-11-02, re-read 2026-11-05); customBrain holds it as "Messaging matrix — Szemantikai modell roadmap". Its first model stage, a readable semantic model, has not been built. Until it exists, a plan says that no model covers the change.
- **Meaning documents that exist.** Give the date of the one you rely on, and check `git log` for code that changed after it:
  - `docs/REBUILD_SPEC.md`: the v6 design spec, with the multi-tenancy delta D1–D11 layered on top (file dated 2026-09-06).
  - `docs/MM6_PURPOSE_STATE_CAPABILITIES.md`: purpose, state and capabilities as of 6.39.0 (2026-09-06). Likely out of date.
  - `MM6_SYSTEM_OVERVIEW.md` in the Drive folder (2026-05-15). `docs/` has the same copy.
  - `docs/` is gitignored, so these files exist only on Robi's Mac. Moving them to the Drive folder is open work.

## Where plans live
- **`tasks/todo.md`** — lean active roadmap + recent checkpoints. **Read first, read fully** (kept small on purpose). New session checkpoints append to the bottom; open work is the "Nyitott roadmap" section.
- **`tasks/todo-archive.md`** — full verbatim history (Phase 0–10 logs, every deploy/session checkpoint 2026-04 → 2026-07, ~4000 lines). The long-term memory — nothing gets deleted, only appended. Read it (tail/offset/grep) when you need the detail behind a roadmap pointer. When `todo.md`'s checkpoints pile up, roll the old ones into here and leave a one-line pointer.
- **`docs/REBUILD_SPEC.md`** — v6 design spec; multi-tenancy delta D1–D11 layered on top.
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
- Running multiple deploys in parallel: `npm run dev:erste` (port 6001), `dev:telekom` (6002), `dev:proficio` (6003), `dev:demo` (6000). All share one Postgres on the Hetzner box, reached locally through the SSH tunnel on `localhost:5433`; `ACTIVE_CLIENT_KEY` picks the client.
- Tests: `npm test` (vitest). The integration suite needs a throwaway docker Postgres on `:55432` (`docker start mm6-test-pg`). New schema migrations should land with at least one integration test exercising the migration path.
