# AGENTS.md

Project-level guidance for Codex working in this repo. The user's global rules in `~/.Codex/AGENTS.md` apply on top of this file.

## Where plans live
- **`tasks/todo.md`** — canonical session checkpoint + roadmap. Read first. Update as work progresses; expand the bottom of the file rather than rewriting.
- **`docs/REBUILD_SPEC.md`** — v6 design spec; multi-tenancy delta D1–D11 layered on top.
- **`tasks/component-inventory.md`** — semantic class names already in use. Check before inventing a new block name.

## Versioning

Semver (`major.minor.patch`), tracked in the single `package.json` at repo root. Currently `6.0.0-pre` (pre-launch). Once the pre-active-use punch list at the bottom of `tasks/todo.md` is cleared and the system enters real daily use, bump to `6.0.0` and switch to regular semver from there.

**After finishing any shipped work — a completed plan, a bug fix, a new route/page/MCP tool, a schema migration, a dependency upgrade — remind the user to bump the version before wrapping up.** Don't bump silently. Surface a suggestion in the form:

> Suggested bump: `6.0.0` → `6.0.1` (patch). Reason: <one sentence>.

### Bump heuristic

Pre-`6.0.0` (current state, `6.0.0-pre`):
- Don't bump on individual commits — we're shipping toward the `6.0.0` graduation event. Track work in `tasks/todo.md` instead.
- The next bump is `6.0.0-pre` → `6.0.0`, decided by the user when the pre-active-use punch list is fully checked.

Post-`6.0.0` (regular semver):
- **patch** (`6.0.0` → `6.0.1`): bug fix, doc-only change, internal refactor with no behaviour change, copy or CSS-only tweak, env-var rename with backwards-compatible fallback.
- **minor** (`6.0.0` → `6.1.0`): new feature or page, new MCP tool, new HTTP route, new DB column / index / table, new dimension-grid column, schema migration, new pattern-token, or any user-visible behaviour change. Breaking changes still allowed on minor bumps until the API stabilizes.
- **major** (`6.x.y` → `7.0.0`): incompatible schema/API break that needs explicit migration steps. **User decides — never auto-suggest a major bump.**

If the finished work is ambiguous (e.g. touches multiple categories), propose the higher bump and explain both options in one line — let the user decide.

### Changelog
- Log every bump in `CHANGELOG.md` at the repo root (create the file on the first bump if it doesn't exist yet, with a "Keep a Changelog"-style structure: `## [6.0.1] — 2026-MM-DD` then bullets).
- One line per shipped change, grouped under `Added` / `Changed` / `Fixed` / `Removed`.
- The changelog is the user-facing record; commit messages are the developer-facing record. Don't duplicate — summarize.

### What does NOT count as "finished work" for a bump suggestion
- Work-in-progress commits within a multi-step plan (only suggest at the end of the plan).
- Pure tooling / config changes that don't affect the running app (e.g. editing `tasks/todo.md`, adding a `.Codex/` setting, updating a README).
- Reverts of unmerged work.

## Workflow notes specific to mm6

- The `tasks/todo.md` file is large and append-only — read with `tail` / offset rather than the full file. Each session's checkpoint goes at the bottom.
- The `.Codex/settings.json` Stop-hook will warn if `src/` has uncommitted changes but `tasks/todo.md` wasn't updated this session. Update the checkpoint before `/clear`.
- Running multiple deploys in parallel: `npm run dev:erste` (port 6001), `dev:telekom` (6002), `dev:proficio` (6003), `dev:demo` (6000). All share the same SQLite at `db/matrix.db`.
- Tests: `npm test` (vitest). 167+ tests as of Phase 10. New schema migrations should land with at least one integration test exercising the migration path.
