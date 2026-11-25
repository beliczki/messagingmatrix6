## Deploy

Where it runs: `~/.agents/infra-map.md`, "Box B", the rows `mm6-erste` and `mm6-telekom`. Box-level facts (access, capacity, paths, ports) live there, never in this public repo. One codebase, one deploy per tenant; both tenants share one Postgres and one MinIO.

**Command.** On the box: `mm6-deploy <tenant>`. Its source is `deploy/bin/mm6-deploy`. It pulls (`--ff-only`), runs `npm ci` when the lockfile changed, builds into `.next-build` while the live app keeps serving, puts up the maintenance page, swaps the build in, restarts the pm2 app, waits for `/login` to answer 200, takes the page down and deletes `.next-old`. It stops before touching anything if the box's installed copy differs from the repo's.

**Before.**
- Robi's go, per tenant. A deploy is a non-trivial plan: planning review first (global rules).
- Push first: the box deploys what is on `origin`.
- Check free disk and memory (the box is the capacity risk, see the infra-map) and note the box's current HEAD, the rollback point.
- Order: `telekom` first, then `erste`.
- Daytime is fine: the build takes about 45–160 s, and the outage is about a second behind the maintenance page.
- **A release that changes `templates/`:**
  - A tenant whose `.env` sets `TEMPLATES_ROOT` reads its templates from outside the checkout. Since 2026-09-12 that is `telekom`; the infra-map, "Box B", has the folder. A deploy does not change that folder, so the release reaches only the tenants without `TEMPLATES_ROOT`.
  - `render.ts` and `templates.ts` read templates from disk on every call, so `git pull` makes the new files live before the build has finished. If the build fails, `git reset --hard` back to the old HEAD.
  - The template editor writes into the effective root. Before deploying, `git status --porcelain templates/` must be empty on every tenant that reads the checkout. If it is not, stop and ask Robi: someone has hand-edited a template. `git pull --ff-only` stops on a hand-edited file that it would change. An edit the pull does not reach stays live outside git, and a rollback `git reset --hard` deletes it.
  - Learned from the 6.134.0 deploy, 2026-11-25.

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
