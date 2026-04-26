# MessagingMatrix v6 — checkpoint after `/clear` (2026-04-26)

Roadmap lives in `~/.claude/plans/you-ll-see-docs-and-snappy-charm.md`.
Spec: `docs/REBUILD_SPEC.md`.

## Done so far

- [x] Phase 0: Repo skeleton + fixtures + spec multi-tenancy delta (D1–D11).
- [x] Phase 1: Schema (incl. `clients`, per-client `config`), deploy-pinned auth, client-aware login.
- [x] Phase 2: Per-entity CRUD APIs (audiences/topics/messages/assets/creatives/text-formatting) with client scoping, optimistic lock, audit, SSE.
- [x] Phase 3: File upload/serve, template discovery, render route.
- [x] Phase 4: Matrix Grid + Feed views (Tree/Sankey deferred — verify).
- [x] Phase 5: Message Editor modal (5 tabs, live preview).
- [x] Phase 6a: Creative Library (masonry + upload dialog).
- [x] Phase 6b: Assets page (mirrors 6a, simpler metadata).
- [x] Phase 6a+: Drag-and-drop UI in both libraries; filename parser (`src/lib/parse-filename.ts`, 10 unit tests); per-client parsing rules endpoint; queue panel with auto-upload + batch-save.
- [x] Phase 6d: Templates editor — see iteration log below.
- [x] Session 2026-04-26 (delta over Phase 5 + 6d): sidebar branding, Matrix toolbar reorder, **shared PreviewPane** between MC editor and Templates editor, MC editor structural rework (full-width header, draggable divider, landscape layout flip, autosave toggle + manual Save/Cancel), skip-anim class-strip fix in MC editor, Refresh-button force remount. See "Session 2026-04-26 — UI unification" log below.

### Phase 6d iteration log (2026-04-26)

**Backend (lib + routes):**
- `src/lib/templates.ts`: `listTemplateFiles`, `writeTemplateFile`, `createTemplate`, `templateExists`, hardened path safety (`safeTemplateDir`, `safeTemplateFilePath` reject `..`, abs paths, path separators in name/file)
- `PUT /api/templates/[name]/[file]` (admin) — text/binary write
- New `/api/templates/[name]/route.ts`: `GET` returns `{ template, files }` with file metadata (name/ext/bytes/size/isText), sorted (`index.html` → `template.json` → `main.css` → size CSS by area → other text → binary); `POST` (admin) scaffolds new template with `index.html` / `main.css` / `300x250.css` / `template.json`
- 14 new integration tests in `tests/integration/templates/write.test.ts` (lib functions only — route handlers tested via lib pattern matching the rest of the codebase)

**Frontend — first cut:**
- 3-pane: left fixed file tree / center CodeMirror 6 / right fixed preview
- Auto-save (800ms debounce) + Cmd/Ctrl+S
- New-template button in main header, page admin-gated

**Iterative UX changes (driven by user, in order):**
1. **v5-mintára újrahúzva**: aspect-ratio layout flip (`>= 1.5` ratio → preview top / editor bottom), template selector + New gomb a header tetején, Files panel slide-in balról, Bindings panel slide-in jobbról v5-stílusú type filter chip-ekkel (`Type`/`Image`/`Video`/`Link`/`Tag`/`Palette`) + per-placeholder type-color border + `AlertTriangle` ha unbound, skip-animation toggle a size selector mellé
2. **Slide-in trigger-ek áthelyezve**: Files toggle a code header-be (filename mellé), Bindings toggle a preview header-be (bg switcher mellé). `Menu` ikonok cserélve `ChevronLeft`/`ChevronRight`-ra (chevron arra mutat amerre a panel mozog)
3. **Pane header-ek `h-10` fix magasság** hogy `<select>` és chevron-only header egy vonalban legyen
4. **Auto-save eltávolítva, kézi Save/Cancel**: a code header-be került Save (slate-900, `Save` ikon) + Cancel (border, revert to `fileQ.data`) + modified/saving/saved/error indicator. `confirm()` guard file/template váltáskor ha dirty
5. **Draggable divider** editor és preview között (4px, hover slate-400). Orientáció-érzékeny (`row-resize` wide-ban, `col-resize` narrow-ban). `splitPercent` 20–80% bound, `containerRef.getBoundingClientRect()` alapján
6. **Preview box átdolgozva**: háttér eltávolítva → light/dark/checker bg switcher (v5 paletta: `#1f2937` dark, 20px ferde gradient checker). `previewBoxRef` + `ResizeObserver` méri a kontént. iframe natív méreten + `transform: scale(min(1, availW/adW, availH/adH))` ha nem fér el. 16px margó körbe, soft box-shadow
7. **MC stepper a header jobb oldalán**: "Preview with:" + `ChevronLeft` + colored-dot select + `ChevronRight`. v5 default `statusColors` paletta (INCOMING `#8B5CF6`, … MEMORY `#06B6D4`) felülírható `lookAndFeel.statusColors`-ból. `uniqueCards` dedup `(number, variant)` szerint legmagasabb `versionNo`-val (v5 logika átvéve). Wrap-around stepper. Real message kiválasztva → render kapja a DB row-t (camelCase → v5 PascalCase a render-side normalize-ban már működik); ha nincs választás → `synthMessage()`
8. **Skip-anim hiba fix (v5-stílus)**: a skip-animation BE → a `template_variant_classes`-ból a literális `animated` szót is stripeljük client-side, mielőtt a render-be megy. Ok: a v5 sablonok az `.animated` class-szal `opacity:0 → 1` fade-int csinálnak; csak az `animation:none`-nal az elemek `opacity:0`-n maradnak (láthatatlanul). Mind a két érintett: `messageForRender(m, skipAnim)` és `synthMessage(t, skipAnim)`
9. **Bindings panel resolved value display (v5-stílus)**: minden placeholder kártyán a binding név alatt látszik a kiválasztott MC-ből feloldott érték. From-message = slate truncated, default = italic amber `default: …`, sehonnan = halvány `no default` vagy `not in MC{label}`. `resolveBindingValue()` helper a render-side lookup logikát tükrözi (lowercase + non-alphanum strip + match)
10. **localStorage perzisztencia** (`mm6_templates_editor_state_v1` kulcs): globálisan `activeTemplate`, `previewBg`, `skipAnim`, `typeFilters`, `splitPercent`; per-template `file`, `size`. Mount-on `loadPersisted()` → state default-ok. Watcher useEffect minden releváns state változásra ír. Validáció: ha a persisted template/file/size már nem létezik → fallback first-available-re

**Új CodeMirror dependency-k**: `@uiw/react-codemirror`, `@codemirror/lang-html`, `-css`, `-json`, `-javascript`.

State a session végén: **typecheck green, 160/160 tests green** (volt 146 a 6d előtt; 14 új write-test).

> Caveat: backend tesztelve, UI csak typecheck-elt. User-nek kell hitelesítenie: (a) wide aspect (970x250 / 728x90) layout flip, (b) Files+Bindings slide-in animáció és overlay-zár, (c) divider drag mind két orientációban, (d) preview scale-to-fit, (e) bg switcher, (f) MC stepper befetcheli a message-eket és valódi adattal renderel, (g) Save/Cancel + dirty guard, (h) skip-anim BE → animated content látszik (nem opacity:0 állapot), (i) bindings panelen a feloldott érték látszik MC-szelekciónál, (j) localStorage refresh-en is megőrzi a választásokat.

**Git state**: `cd717f6` initial commit pushed to `origin/main` (207 fájl, 50,817 sor).

### Session 2026-04-26 — UI unification (Phase 5 ↔ 6d)

Driven by user feedback after both editors were live; goal: kill the divergence between the MC editor's preview UI and the Templates editor's preview UI, then bring the MC editor's *outer* layout up to the same flexibility level (full-width header, draggable divider, landscape flip, optional autosave).

1. **`docs/` git-untrack** (housekeeping): `docs/` (REBUILD_SPEC.md + Erste XLSX sample) `git rm --cached`-elve és `.gitignore`-ba téve. Lokálisan megmaradt; történelem érintetlen. Commit `156cd2b`.
2. **Sidebar branding**: `public/mmatrix.svg` (v5 `mmatrix.svg` átemelve). Headerből kivéve a "MESSAGING MATRIX" felirat — csak `client.name` (pl. "Erste") marad. A logo átveszi a hamburger szerepét: `Sidebar.tsx` toggle gombja immár az SVG ikon, `lucide` `Menu` import törölve.
3. **Matrix toolbar reorder** (`MatrixToolbar.tsx`): a Grid/Feed view-toggle pinned right; az Informative/Minimal density-toggle előbbre került balra. Cél: a view-toggle pozíciója ne ugráljon attól, hogy Grid módban van-e Density panel vagy nincs (Feed módban a density rejtve marad).
4. **Shared `PreviewPane` komponens** (`src/app/(app)/_components/PreviewPane.tsx`): a két preview UI egy kódbázisban. API: `{ html, sizes, size, onSizeChange, bg, onBgChange, skipAnim, onSkipAnimChange, onRefresh?, rightExtras? }`. Belül: ResizeObserver + scale-to-fit `PreviewIframe`, `BgBtn` triplet (Sun/Grid/Moon), Skip-animation gomb (Check ikonnal, slate-900 active), Refresh gomb (`reloadKey` state-tel — minden kattintásra inkrementál és az iframe `key`-ére kerül, így force-remount akkor is, ha a HTML byte-ra ugyanaz). A Bindings panel toggle (Templates editor) → `rightExtras` slotba kerül. MC editor nem ad rightExtras-t.
5. **MC editor preview unification** (`MessageEditor.tsx::MessagePreview`): a régi inline iframe + szöveges `[light dark checker]` + checkbox skip-anim chrome lecserélve `<PreviewPane>`-re. Skip-anim viselkedés: a render felé küldött merged message-en stripeljük az `animated` class literált a `templateVariantClasses`-ből, mielőtt POST-oljuk (`messageForRender` v5-stílus). Korábban: `templateVariantClasses` érintetlen → `animated` osztály a gyökéren → a `* {animation:none}` mellett a `.animated .headline { opacity:0 }` szelektorok bent maradtak → ad eltűnt. Fix: ugyanaz a v5-szabály, ami a Templates editorban már működött (`Phase 6d iteration log` 8. pont).
6. **Templates editor refactor** (`TemplateEditor.tsx`): inline preview chrome eltávolítva, helyette `<PreviewPane>` invokáció + `rightExtras` a Bindings panel chevron-toggle-jéhez. Lokál helperek (`BgBtn`, `bgStyleFor`, `PreviewIframe`) törölve — most a shared komponens tartalmazza. `previewBoxRef`, `boxSize` state, ResizeObserver effect szintén kiemelve a sharedba. Felszabadult import: `Sun`, `Moon`, `Grid`, `RefreshCw` (csak a shared komponensben kellenek).
7. **MC editor outer layout rework**:
   - Header full-width: kikerült a 58%-os left columnból, a modal `flex-col` lett, header tetején spannolja a teljes szélességet.
   - Draggable divider editor szekció és preview szekció között — pontosan ugyanaz a `splitPercent` (20–80% bound) + `containerRef.getBoundingClientRect()`-alapú mousemove logika, ami a Templates editorban van.
   - Landscape layout flip: új `isLandscape(size)` helper (w/h ≥ 1.5) + `MessagePreview` `onSizeChange` callback bubblesz fel a parentre. Wide → preview top (`order: 1`), editor bottom (`order: 3`); narrow → editor left, preview right.
   - **Autosave toggle** a header jobb oldalán (default ON, megőrzi a régi viselkedést). Ha OFF: a debounced auto-save effect early return-ölése + a pending debounce timer törlése; megjelenik a "modified" amber tag (ha `isDirty`) és Save (slate-900) + Cancel (border) gomb. `isDirty` `useMemo`-val a `diffPayload` alapján; `manualSave` az aktuális snapshot version-jét használja az `If-Match` header-höz; `manualCancel` `setDraft(toEditable(committedSnapshot))`. Konfliktus-handlinget az meglévő mutation `onError` ágon megoldja (409 → snapshot bump, conflict indicator).

State a session végén: **typecheck green**, browser-tesztet a user csinál.

> Caveat: új komponensek és layout flipek; user-nek ellenőriznie kell: (a) sidebar logo méret + collapse toggle viselkedés, (b) Matrix toolbar Grid/Feed pozíció Grid és Feed módban is, (c) MC editorban portrait + landscape size kiválasztásnál layout flip + divider drag, (d) skip-anim toggle BE → ad még látszik (nem opacity:0), (e) autosave OFF → modified tag + Save/Cancel működik (Cancel revert, Save POST 200), (f) refresh button vizuálisan visszatöltik az iframe-et, (g) mindkét helyen ugyanazt a UI-t adja a Skip animation és bg-switcher.

### Session 2026-04-26 (cont.) — RightToolbar, MultiPill, transpose

Strukturális / funkcionális kiegészítések az UI unification után.

1. **`MultiPill` shared komponens** (`src/app/(app)/_components/MultiPill.tsx`): kontrollált `useState` open + `document mousedown` outside-click handler + `Escape` close. Az eddigi 3 lokál `<details>`-alapú kópia (MatrixToolbar, CreativeLibrary, AssetsLibrary) lecserélve egy közös importra. A `<details>` natív viselkedése nem zárt mellékattintásra — ezt javítja a kontrollált verzió.
2. **`RightToolbar` shared komponens** (`src/app/(app)/_components/RightToolbar.tsx`): full-height jobb-oldali sáv, `lucide` `PocketKnife` ikonnal (v5 toolbar ikon). Per-page localStorage kulcs. Default állapot csukva, kibontva tartalom a children-as-function pattern szerint: `children?: ReactNode | ((collapsed: boolean) => ReactNode)` — a parent collapsed/open módra különböző tartalmat tud renderelni, és collapsed-ben is renderel a body. Toggle gomb a viewport jobb széléhez van pin-elve, így csukva/nyitva ugyanazon a screen-X-en marad — egy kattintással toggle-ölhető egérmozgás nélkül.
3. **`CycleIconButton` shared komponens** (`src/app/(app)/_components/CycleIconButton.tsx`): generikus (`<T extends string | number>`), opciók listája `{ value, icon, label }`. Kattintásra körbeforgat az opciókon (wrap-around). Tooltip mutatja a current → next állapotot. Olyan helyzetekre, ahol a hely szűk és nem fér el segmentált ToggleGroup (pl. collapsed RightToolbar).
4. **Matrix view+density áthelyezve a RightToolbarba**: `MatrixToolbar` most már csak filterek (search + Product/Status MultiPill + Clear). View (Grid/Feed) és Density (Informative/Minimal) kontrollok átkerültek `MatrixGrid`-be a `RightToolbar` children-as-function alá. Open mód: `ViewControls` segmentált ToggleGroup. Collapsed mód: két `CycleIconButton` egymás alatt (View + Density, utóbbi csak `view === "grid"` esetén). MatrixGrid root layout `flex-col → flex` (row).
5. **CL / Assets / Monitoring oldalak**: szintén row layout + `<RightToolbar>` jobbra, egyelőre üres children-nel (későbbi page-specifikus kontrollok ide jönnek). Monitoring `page.tsx` átírva placeholder + RightToolbar wrappre.
6. **GridView transpose toggle**: a `"Audience ╲ Topic"` címke a corner cellán belül egy `<button>` lett. Kattintásra `transposed` state flippel: rows ↔ cols (audiences ↔ topics), per-jel `╲` ↔ `╱`, címkék is helyet cserélnek. A cell-lookup (`${audKey}\0${topKey}`) változatlan — csak a render-sorrend változik. State lokál a `GridView`-ben (nem perzisztens).

State session végén: **typecheck green**, browser-tesztet user csinál.

## Decision (2026-04-26)

User confirmed: **skip 6c for now, go to 6d next**. 6c (Monitoring) comes back later — not a permanent drop, just deferred until there's a reason to wire AdForm UI.

## Remaining roadmap

- [ ] **Phase 6d (NEXT)**: `/templates` editor — CodeMirror 6 + 3-pane (file menu / editor / preview), wire to existing `/api/templates/[name]/[file]` PUT.
- [ ] **Phase 6c (deferred)**: `/monitoring` page — AdForm sync UI (campaign prefix, date range, sync now button, last-sync indicator) + `POST /api/adform/sync` + `GET /api/adform/status`. Regex extraction already in fixtures.
- [ ] **Phase 7**: Settings tabs (Clients/Storage/Design/Structure/About), brand-color binding via CSS vars on `<html>` from `lookAndFeel` (sidebar + buttons reflect Erste/Telekom/Proficio palette), Users CRUD, Shares (`/share/[id]`).
- [ ] **Phase 8**: MCP server (`/mcp`) per-client bearer, 17+4 tools.
- [ ] **Phase 9**: XLSX/Sheets I/O + one-shot Erste v5 migration.
- [ ] **Phase 10**: Cmd+K palette, Cmd+Z undo, perf budgets, multi-deploy smoke.

## Pinned future work (post-launch / Phase 11)

File-system ingest pipeline (Forklift/Total Commander → `_inbox/`) + Google Drive sync + MCP error-triage tools (`list_pending_files`, `retry_file_with_metadata`, `update_creative_parsing_rules`). Pinned 2026-04-26.

## Next up

Pick one of these next:
- **Phase 7** — Settings (Clients tab + Storage/Design/Structure/About) + brand-color CSS-var binding from `lookAndFeel` (sidebar/buttons take Erste/Telekom/Proficio palette) + Users CRUD + Shares.
- **Phase 6c (deferred)** — `/monitoring` page + AdForm sync route. Comes back when there's reason to wire AdForm UI.
- **Phase 8** — MCP server per-client bearer.

Recommendation: Phase 7 next so the app actually looks like the active client (currently generic slate everywhere).
