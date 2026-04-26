# Tests

This directory holds the test suite for v6. Strategy and tree shape are defined in [`docs/REBUILD_SPEC.md`](../docs/REBUILD_SPEC.md) §16.

## Layout (target — built test-first as features land)

- `unit/` — pure logic, reads `fixtures/v5/` golden outputs as the v5 contract
- `integration/` — API + MCP route handlers against a fresh SQLite per test
- `components/` — React Testing Library (jsdom)
- `e2e/` — Playwright (chromium)
- `fixtures/v5/` — captured v5 behavior, **the contract** v6 must reproduce (do not edit by hand)
- `fixtures/scenarios/` — hand-crafted edge-case scenarios
- `helpers/` — `test-server.ts`, `test-db.ts`, `html-normalize.ts`, `xlsx-compare.ts`, etc.

## Fixtures

`fixtures/v5/` was captured from the v5 codebase via `scripts/capture/` in the v5 repo. Hashes live in `fixtures/v5/manifest.json` for drift detection. To recapture (deliberate, with changelog entry), re-run the v5 capture scripts and re-copy.

## Runners

See `docs/REBUILD_SPEC.md` §16.5 for `vitest.config.ts` projects, `playwright.config.ts`, and the `package.json` scripts (`test`, `test:watch`, `test:e2e`, `test:fast`, `test:all`).
