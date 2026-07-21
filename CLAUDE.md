# CLAUDE.md

Project-level guidance for Claude Code working in this repo. The user's global rules in `~/.claude/CLAUDE.md` apply on top of this file.

## Where plans live
- **`tasks/todo.md`** — canonical session checkpoint + roadmap. Read first. Update as work progresses; expand the bottom of the file rather than rewriting.
- **`docs/REBUILD_SPEC.md`** — v6 design spec; multi-tenancy delta D1–D11 layered on top.
- **`tasks/component-inventory.md`** — semantic class names already in use. Check before inventing a new block name.

## Versioning

Semver (`major.minor.patch`), tracked in the single `package.json` at repo root. **Graduated to `6.0.0` on 2026-07-21; currently `6.1.0`.** Everything needed for base daily use is in place — the system is live. The former "pre-active-use punch list" at the bottom of `tasks/todo.md` is **no longer a launch blocker**; it is now the **top-priority backlog** (platform expansion — Meta/DV360/Direct Display, reporting ingest, creative↔cell matching, smoke tests). Regular post-`6.0.0` semver is the live rule from here.

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
- Pure tooling / config changes that don't affect the running app (e.g. editing `tasks/todo.md`, adding a `.claude/` setting, updating a README).
- Reverts of unmerged work.

## Workflow notes specific to mm6

- The `tasks/todo.md` file is large and append-only — read with `tail` / offset rather than the full file. Each session's checkpoint goes at the bottom.
- The `.claude/settings.json` Stop-hook will warn if `src/` has uncommitted changes but `tasks/todo.md` wasn't updated this session. Update the checkpoint before `/clear`.
- Running multiple deploys in parallel: `npm run dev:erste` (port 6001), `dev:telekom` (6002), `dev:proficio` (6003), `dev:demo` (6000). All share the same SQLite at `db/matrix.db`.
- Tests: `npm test` (vitest). 167+ tests as of Phase 10. New schema migrations should land with at least one integration test exercising the migration path.
