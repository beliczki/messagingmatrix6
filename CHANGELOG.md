# Changelog

All notable changes to MessagingMatrix v6 are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [6.68.0] — 2026-09-06

### Fixed
- **A correctly-named creative now reaches the Agentic matrix.** Uploading to
  the Creative Library wrote a `creatives` row and nothing else, so every MC
  named by a filename after the last batch import stayed invisible in the
  matrix — the Agentic grid draws `messages`. The upload now creates the cell
  the filename names, on the channel its declared size implies, in the topic
  that number already occupies. 14 delivered cells across MC324b/c, 333a, 334a,
  335a, 337a and 338a were backfilled.
- **Promote stopped calling a creative "already matrixed" for being named.**
  The guard read `mc_number` + `mc_variant`, which the Creative Library fills
  from the filename at upload — so it refused the very files that had no matrix
  card. It now asks the matrix. A creative that names its own MC is promoted at
  that number instead of being allocated a new one.

### Added
- `scripts/backfill-orphan-mcs.ts` — dry-runs inside a rolled-back transaction,
  writes with `--commit`.

## [6.67.1] — 2026-09-06

### Changed
- **The Brief tab is one field: paste the slide link.** The deck picker, the
  "attach a deck by link" box and its Attach button are gone. A Slides link
  already carries both facts — the deck and the page — so the deck is resolved
  behind the paste instead of being asked about. The picker's only job had been
  choosing which group a draft landed in, and grouping moved to product in
  6.67.0; it outlived its reason and, with the label field also gone, had been
  offering unreadable "Brief 2" options for a choice with no consequence.
  Briefs are still stored as rows keyed on the Drive file id, so "these cards
  came from one deck" stays a fact rather than a string match, and MCP's
  `list_briefs` keeps answering what came of each deck.

## [6.67.0] — 2026-09-06

### Changed
- **Drafts are grouped by product, not by brief.** Product is how the rest of
  the app partitions work — the matrix filter, the creative library, the
  dashboard — and the brief was answering a different question. Drafts with no
  product yet gather in a "No product set yet" group at the end. The brief is
  still attached to each card and lives on its Brief tab; it just no longer
  decides the page's shape.

### Added
- **A draft carries its own product** (`messages.draft_product`, set on the
  Promote tab). A placed card's product is derived from its cell —
  `audiences.product` on the DCO axis, the topic key prefix on the Agentic one
  — but a draft has neither, so for that one state it has to be stored.
  Promotion hands the question back to the cell and the stored value stops
  being read. The column is named `draft_product` rather than `product`
  precisely so it cannot be mistaken for a second source of truth about a
  placed card's product.

## [6.66.0] — 2026-09-06

### Added
- **The drafts page opens the matrix editor.** A draft was already the same
  `messages` row as a card, but it had its own cramped dialog while cards got
  the full editor. Now there is one editor with two tab sets: a draft shows
  `Promote | Template | Content | Styles | Brief`, a placed card shows
  `Naming | Template | Content | Styles | Trafficking | Brief`. Which one you
  get is decided by `audience === null` — the schema's own discriminator, tied
  to `status='DRAFT'` by a check constraint, and the one TypeScript can narrow
  on, so the compiler proves the Naming and Trafficking tabs never receive a
  draft. Preview pane, autosave, conflict handling, revision history and
  prev/next stepping all come along for free.
- **Brief tab, on drafts and on cards.** Attach the Slides deck the work came
  in on and preview the exact slide it was briefed on — not the deck's cover.
  Pasting a slide deep link sets both the deck and the slide in one go. The
  deck stays one brief however it was linked (identity is the Drive file id),
  while the slide anchor is per card in the new `messages.brief_slide_id`,
  because several cards are briefed on different pages of one deck.
- **Promote a draft to DCO, Agentic, or both.** "Both" is promote **plus copy**,
  not two promotes: a draft is one row and can become only one card, so the
  second axis is a clone that keeps the number, the topic and the content —
  one card in two worlds rather than two that happen to share a number.

### Changed
- **nonDCO is now called Agentic** throughout the UI, the identifiers and the
  MCP tool descriptions. The stored axis token stays `"nondco"`: it is
  persisted in `mm6_matrix_state_v1` and an unrecognised value falls back to
  DCO, so renaming it would have silently reset every saved matrix view.
- **The Creative Library's Type filter moved ahead of the filter box and now
  filters DCO vs Agentic** instead of file type. It exposes the `kind` split
  the library already had (`matrix` = template render, `uploaded` = delivered
  file). It uses a new storage key — reusing the old one would have matched a
  saved `{"image"}` against the new options and opened the library empty.
- **Attaching a brief happens in the draft, not from the toolbar.** The
  separate "Attach a brief" button and dialog are gone, and so is the label
  field: paste the link on the Brief tab and you are done.
- **An Agentic MC now has two documented births**, not one: a correctly-named
  Creative Library upload, or promoting a draft onto a channel. The invariant
  comment, the Channels settings copy and the grid's info box all say so.

## [6.65.0] — 2026-09-06

### Fixed
- **Every status dot in the app was transparent except ACTIVE.** The
  `.status-dot--*` and `.status-badge--*` rules lived in `@layer components`,
  but no consumer writes those class names out — they are all built at runtime
  as `status-dot--${statusSlug(s)}`. Tailwind's scanner therefore never saw them
  as candidates and purged the rules. `ACTIVE` survived by pure accident:
  `ClientsTab.tsx` happens to write `status-dot--active` literally. So the
  status filter's option dots, the matrix chips, the feed row stripe and the
  sankey tooltip all rendered their colour as `rgba(0,0,0,0)` for five of the
  six statuses. The rules are now unlayered — the file's existing remedy for
  exactly this, already used by the platform-edge block — so they cannot go
  missing again as literals come and go elsewhere.

### Added
- **The sankey's MC column is coloured by status.** On a leaf the useful
  question is what state the card is in, so status wins there; the other columns
  keep the platform/depth encoding the tree uses, so the two views still read
  alike. A card put out across several audiences can hold more than one status,
  and picking a "dominant" one would paint a 13/11 split solid green — so a
  mixed card gets a proportional gradient with hard stops and shows the split it
  actually has, with the counts named in the tooltip. Colours come from the
  `--status-*` variables, so Settings → Design carries through.

## [6.64.1] — 2026-09-06

### Fixed
- **The sankey called placements "messages".** A row of `messages` is a
  placement, not a message: one card put out in 24 audiences is 24 rows. So a
  topic holding three cards across 24 audiences read as "72 messages" — 72
  different things, when there are three. The tooltip now names both: a non-leaf
  says `3 MCs · 72 placements · 24 audiences`, and a leaf — where the node *is*
  one card — says `24 placements · 24 audiences · 1 topic` instead. The MC-mode
  weight is still the row count (a card node must weigh what its ribbon carries,
  or the flow stops adding up), but the pill's hover title and the `Weight by`
  hint now say `placements` outright.

## [6.64.0] — 2026-09-06

### Added
- **Weight the sankey by delivery, not just by structure.** A `Weight by`
  switch in the right toolbar — `MC` / `Impr.` / `Cost` — drives the ribbon
  widths and the node numbers, with a report-period selector beside it
  (`monitoring` is monthly, so a period is the finest slice that exists). New
  `GET /api/monitoring/message-metrics`, aggregating impressions, cost and
  conversions per message for one period.
  - **Every delivery mode states its own coverage**, because only monitoring
    rows the importer could tie to a matrix message can be drawn on the matrix's
    structure. On the live August report that is 13% of the cost — a weighted
    diagram that stayed quiet about the other 87% would read as "this is where
    the money went" while showing an eighth of it. Under 70% the line turns
    amber.
  - Unlike the dashboard's query this one keeps `impressions = 0` rows. There
    they are the 1x1 click trackers that wreck CTR; here dropping them would
    delete 62% of the spend.
  - A selection where nothing delivered gets an explicit empty state rather than
    a laid-out graph of zeroes.
- **Conversions on the node tooltip**, shown even when zero — a blank would read
  as "no data" when it means "nothing converted", and those are different
  answers. (Today the report attributes 9 of August's 120 conversions to a
  message; the number is there so that gap is visible rather than assumed.)

### Changed
- **The feed preview takes over the matrix canvas instead of opening a dialog.**
  A table inside a dialog cannot open a row's MC without stacking a second
  dialog on it, so rows were dead. On the canvas a row click opens the editor
  like anywhere else. The toggle is now a check button in the export panel,
  matching the preview pane's `Skip animation` control, and switching view
  clears the preview.

## [6.63.0] — 2026-09-05

### Fixed
- **The sankey drew paths where it should have drawn entities.** A tree node is
  a path — `buildTree` keys nodes on the whole chain of ancestors, because in a
  tree every node has exactly one parent. A sankey node is a thing: one topic is
  one node, with ribbons arriving from every audience that uses it. Reusing the
  tree's node identity duplicated every topic and every card once per audience,
  which is the opposite of what the diagram is for — and it is also what made it
  unreadable. On the live Erste filter the two identities differ by an order of
  magnitude:

  | level | as paths | as entities |
  |---|---:|---:|
  | topic | 446 | **27** |
  | MC | 681 | **54** |

  The sankey now walks the structure levels itself and merges on the entity,
  sharing the row assembly and per-level grouping with the tree so the two views
  still cannot disagree about what the structure is. A card carried by several
  audiences is one leaf weighing several messages.
- **Folding is a safety valve again, not a routine crop.** With entity nodes the
  columns are small, so the cap went back to per column — and in a DAG that is
  finally honest: an `Other` inherits its members' own links, so a folded
  audience's flow still arrives at the real topics it feeds. Nothing is left
  leading nowhere and no grey chain has to be strung to the right edge. The cap
  is 120, expandable per column by clicking the `Other`, and `Other (1)` is
  still never rendered.

## [6.62.0] — 2026-09-05

### Fixed
- **A node you can see is now a node you can follow.** The sankey capped each
  *column* at its top 20, which broke the diagram's basic promise: a visible
  audience's every topic could lose the column-wide ranking to other audiences'
  topics and vanish into one shared `Other`, so hovering a node plainly on
  screen led into grey nothing. At the leaf level it was worse — every MC has a
  count of 1, so the tie broke alphabetically and `MC332` fell out simply for
  sorting after `MC330` and `MC331`.
  - The cap is **per parent** now. A visible node always shows its own largest
    children, and only its own overflow folds into its own `Other`. An audience
    with four topics shows four topics and no `Other` at all.
  - Folding a single leftover is skipped — `Other (1)` costs a row and says
    nothing.
  - The root column is never folded: it is the entry point, and there is no
    parent above it whose pill could serve as the handle.

  - The cap is **8 per parent**, deliberately small: per-parent folding
    multiplies down the levels, and the live Erste filter alone holds 90
    audiences over 446 distinct audience/topic pairs. The initial fit also stops
    zooming out at 0.35 — below that the pills are unreadable, so a tall diagram
    opens legible and pans rather than being crushed to fit.

### Added
- **Drill into a fold.** A parent whose children overflow carries the tree's
  chevron; clicking it — or clicking its `Other`, which is a shortcut for the
  same toggle — shows all of them, and clicking again collapses back. What you
  opened is remembered in `mm6_sankey_expanded_v1`, so a branch you drilled into
  is still open when you come back.

## [6.61.1] — 2026-09-05

### Removed
- **The feed-rows block is out of the export dialog.** Putting the table there
  cramped the export's own setup, and the dialog is not the place to browse
  rows — it is the place to decide what goes out. The preview lives outside it,
  on the toolbar panel's `Preview feed rows` checkbox, and only there.

## [6.61.0] — 2026-09-05

### Added
- **Preview feed rows, from the toolbar panel.** The feed table was reachable
  only from inside the export dialog, next to the diff — which answers "what is
  this export sending", not "what does the feed hold right now". A checkbox
  above the Export button now opens the same table for the current selection as
  its own preview, with nothing exported from there. Both places keep their
  copy: one is the pre-flight look, the other the in-flight one.

## [6.60.2] — 2026-09-05

### Fixed
- **The sankey tooltip could open in the wrong corner.** It was placed from the
  last sampled mousemove, but `mouseover` fires before the `mousemove` at the
  same position — so the position was always one move stale, and on the first
  hover after mount there was nothing sampled at all and the tooltip landed at
  the canvas origin. The hover now carries its own coordinates, clamped so the
  box stays on the canvas near an edge.

## [6.60.1] — 2026-09-05

### Fixed
- **Sankey labels sat on top of each other in dense columns.** A node's height
  is proportional to its value, so in a column where one `Other` node holds 90%
  of the flow the remaining twenty are sub-pixel slivers — the gap between
  stacked nodes is the only separation the layout guarantees, and at 10px it did
  not clear an 18px label pill. The gap is now 22px, and the canvas grows with
  the tallest column to make room for it.

## [6.60.0] — 2026-09-05

### Added
- **Sankey view.** The matrix's third view draws the same hierarchy the tree
  draws — the same `treeStructure` string from Settings → Structure, parsed by
  the same `parseTreeStructure` and built by the same `buildTree` — as ribbons
  whose width is the message count. It is one structure with two renderings, not
  a second data model, so the two views can never disagree about what the
  structure is.
  - Layout comes from `d3-sankey` (3 kB, layout only); the drawing is ours, on
    the xyflow canvas the tree already uses. That means pan, zoom and the right
    toolbar's Navigator (minimap + zoom controls) work on the sankey the same
    way they work on the tree, with no second set of controls to learn.
  - **Every column folds to its 20 largest groups.** A leaf column of thousands
    of one-message ribbons is not a diagram. What does not make the cut folds
    into a neutral grey `Other (N)` node, and that node forwards its flow to the
    next column's Other — so the folded mass stays visible all the way to the
    right edge instead of vanishing mid-diagram. Every message is still counted
    exactly once in every column.
  - Hovering a node or a ribbon lights the **whole route** it sits on, ancestors
    and descendants, and dims everything else; the tooltip gives the count and
    its status breakdown. Node bars carry the tree's level and buying-platform
    colours, so a group keeps its colour when you switch views. A leaf opens its
    MC.

### Changed
- **The Feed view is retired; the feed table moved into the feed export.** The
  table was never a view of the matrix — a few thousand rows of feed columns
  answers exactly one question, "what is about to go out", and that question
  belongs to the export. It now sits in the feed-export dialog behind a **Feed
  rows** checkbox, and only renders when asked. A persisted `view: "feed"` falls
  back to the grid.
- **One Export box in the right toolbar, with a Matrix / Feed switch.** Both
  exports are reachable from the grid now, each bringing its own setup: the
  matrix branch its filter chips and XLSX download, the feed branch its gate
  (one product, ACTIVE/INACTIVE only), its live-version summary and its export
  dialog. The switch remembers which branch you used.

## [6.59.1] — 2026-09-05

### Fixed
- **`grep` reported nothing for `feed-export.ts`, silently.** The feed-diff row
  key joins advert_id and reporting_label with a NUL character — a good
  separator, because it cannot occur in feed data — but it was written as a raw
  byte rather than the `\u0000` escape. That made the whole file read as binary
  to text tools, and `grep` answers a binary file with zero matches and no
  error. It is now the escape: the string produced is identical, and the file is
  searchable again. Found while auditing that same file, where the search said
  the code was not there.

## [6.59.0] — 2026-09-05

### Added
- **DRAFT: work can now be taken on before it has a place in the matrix.** A
  draft is not a separate table — it is a `messages` row with `status='DRAFT'`
  and no audience, which is what keeps it out of the grid. Being a real message
  row is the point: number allocation, variants, versioning and previews all
  work on it unchanged, so **a draft's MC number is reserved from the moment the
  work arrives** — the number stops moving between "we agreed to do this" and
  "it is in the matrix".
  - Three DB check constraints hold the model up, rather than convention:
    `DRAFT ⟺ no audience` (both directions), a placed row always has a topic,
    and a draft never has a PMMID (so the by-PMMID lookup that copy and move
    resolve their sources through cannot pick one up).
  - New `briefs` table: the Google Slides deck a draft came in on. Several
    drafts can share one brief. It stores the Drive **file ID**, not the URL, so
    the same deck pasted three ways is one brief.
  - A draft may carry a suggested topic NAME that is not a real topic key yet;
    promotion is what forces it to resolve. Promotion will not mint a topic —
    that is how the topics dimension avoids filling up with near-duplicates.
  - **Promotion updates the row rather than replacing it**, so the number, the
    brief link and the edit history survive it. The audience, the topic and the
    status land in one write, because the schema ties them together.
  - A draft's number is allocated above **both** axes and is held against both,
    so nothing can take it while the work is in progress. Trying to claim it
    says so: "MC number 701 is reserved by a draft".
  - The image-AND-feed-row case: the draft becomes one card, and the second axis
    is a copy of it under the same number.
- **The `/drafts` page is now the intake surface**, grouped by the brief each
  piece of work came in on. Each group header carries `N open · M promoted` —
  the useful half of a close check, with nothing to keep in sync, because both
  numbers are counted from the work itself.
  - **Attach a brief by pasting its link.** The Drive file id is what gets
    stored, so the editor link and the Drive link of one deck are one brief
    rather than two. Pasting a folder link says so instead of storing it.
  - A brief is a pointer, not an owner: archiving or deleting one leaves the
    drafts alone.
  - Draft previews are ordinary message previews now, which means they inherit
    the existing staleness rule — an out-of-date preview is marked as stale
    rather than shown as if it were current.
  - New side toolbar on the page for starting a draft and attaching a brief.
- **Agents work the same surface.** The MCP draft tools keep their names, so
  nothing an agent already calls breaks, but they now drive the same drafts the
  page shows. `generate_test_creative` returns the **claimed MC label** along
  with the draft id — the agent knows which number it just took — and accepts
  `brief_link` and `working_topic` so intake is structured in one call.
  - New `brief_attach` (link → brief, optionally linking a draft in the same
    call) and `list_briefs` (with the open/promoted counts).
  - `draft_status` progress is now **derived** rather than stored: a size counts
    as done when its preview was shot at the draft's current version. Editing a
    draft therefore drops the percentage back, which is the same staleness rule
    the matrix uses — and there is no render-status column or job table left to
    get stuck.
  - `draft_delete` archives rather than hard-deletes, so a discarded draft's
    number stays retired instead of quietly returning to circulation.

- **The MC lifecycle is six statuses instead of twelve**, and lives in one place
  (`src/lib/mc-status.ts`) instead of six:
  `DRAFT → PREVIEW → APPROVED → ACTIVE → INACTIVE`, plus `DEAD`.
  - **A new card is born in PREVIEW.** By the time an MC is placed it has its
    template and its content, so the earlier statuses described a moment that
    had already passed — every new card was being flipped to PREVIEW by hand.
  - Archiving is the `archived_at` column, not a status. It already was: the
    ARCHIVED status held no rows while nine rows were archived.
  - `INCOMING`, `NAMING`, `CONTENT`, `MEMORY`, `ARCHIVED`, `ERROR` and the
    never-quite-legal `PLANNED` are gone.

### Removed
- **The `draft_messages` and `draft_previews` tables**, the `entities/drafts.ts`
  shadow of the message machinery, and the `/api/draft-previews/<id>` route. A
  draft is a message now, so all three were duplicates of something that already
  worked. Both tables were empty on every client; nothing was migrated.
- **Six hand-kept copies of the status list.** The matrix filter, the editor
  dropdown, the Design tab, the template editor, the branding CSS vars and the
  DB defaults each spelled the statuses out, and they had drifted: `PLANNED`
  existed in the filter and nowhere else, so the eight cards carrying it matched
  no filter option and quietly dropped out of every status-scoped view. All six
  now derive from one list, as do the CSS variables and the dot/badge classes.

### Changed
- **Every matrix-facing read now says so explicitly.** Making `audience`
  nullable turned "which code assumes a message has a cell?" into a question the
  compiler answers: 49 call sites across 11 files. The feed export, XLSX export,
  dashboards, MC-count badges, the rekey walker, the monitoring importer and
  `/api/messages` now scope to placed rows in SQL. Two of those were latent bugs
  rather than type noise — see below.

### Fixed
- **A rekey could have swept a draft along.** A draft's topic is free text and
  may happen to spell a real topic key; the rekey walker matched on that string
  and would have tried to regenerate an identity the draft does not have. It now
  scopes by audience, which cuts off the topic-side collision. The same trap was
  live in the per-topic MC counter, where a draft would have inflated a real
  topic's count.
- **Report rows could have matched a draft.** Monitoring's family-level fallback
  keys on (number, variant) — exactly what a draft carries — so an imported
  report row could have resolved onto work that never ran anywhere. The importer
  now reads placed rows only.
- **`mc:` in the matrix filter now means the number you typed.** It matched as a
  raw substring, so `mc:21` also pulled in MC321, MC210 and MC121 — and the
  result looked correct, because those cards are real. The number is now
  anchored: digits may not continue on either side. `mc:21` still matches every
  variant of MC21, `mc:21a` matches only that variant, and a non-label value
  (the matrix packs the PMMID into the same field) keeps the old substring
  behaviour. Same fix applies to the Creative Library, which builds the same
  `mc<number><variant>` label.


## [6.58.0] — 2026-09-04

### Added
- **The dashboard remembers the view you left it in** — the date scope, the
  product filter and the creative-strip ordering. Opening `/` with no
  parameters restores it; any explicit parameter, including a link someone
  shared, still wins.
  - It remembers the **chosen pill, not a frozen date**: "Yesterday" comes back
    as yesterday-relative-to-now, and a day reached with the arrows comes back
    as plain today. Restoring the dashboard onto a stale, empty day would read
    as an outage rather than as a preference.
  - Stored in a cookie rather than localStorage because the reader is the server
    component itself — the alternative is a flash of the default dashboard
    followed by a client-side rewrite.

## [6.57.0] — 2026-09-04

### Added
- **The share page has a phone layout.** The header stacks: a larger logo and
  client name, then the share title on its own line at its own size (the
  "/ Shared Creatives /" crumbs are chrome a small screen can do without), then
  the comment count and capture date left-aligned under it. The filter controls
  grew to a comfortable tap size, and the right-hand action row — download,
  Drive, view, image preview, theme — collapses into one "Actions" menu whose
  rows are full width and say what they do, grouped under section labels.
  Nothing changes above the `sm` breakpoint.

## [6.56.2] — 2026-09-04

### Changed
- Drive icon: heavier stroke and the redrawn geometry, in step with
  `public/google-drive-lucide-outline.svg`.

## [6.56.1] — 2026-09-04

### Changed
- The Drive glyph now uses the outline mark drawn for it
  (`public/google-drive-lucide-outline.svg`), inlined so it takes the button's
  colour. One component for both surfaces: the share page's Drive buttons and
  the Creative Library's Drive link check and folder link.

## [6.56.0] — 2026-09-04

### Added
- **The share page carries the app's light/dark switch**, in front of the view
  buttons, sharing the sidebar's state and its view-transition reveal — both now
  run on one `useThemeSwitch` hook instead of two copies of the same logic. The
  header logo swaps to the white mark in dark, as it does in the app.
- The share footer prints the app version next to the client name.

### Fixed
- **The preview background follows the theme again.** The share views drew the
  transparency checker as an inline style, a copy of the app's CSS that could
  never react to dark mode; they use the app's `preview-viewport--*` classes
  now, whose checker has a dark variant. Same fix in the detail dialog's stage.
- The comment composer sat on `bg-slate-50/60`, an opacity variant the dark
  compatibility layer does not map, so it stayed a pale block on a dark panel.
- A skipped view transition (another one running, document not visible) no
  longer surfaces as an uncaught `InvalidStateError`; the theme applied either
  way, only the animation was lost.

### Changed
- The Drive icon is an outline in `currentColor` rather than the colour brand
  mark, so it sits in a row of lucide icons without shouting over them.
- In the detail dialog the delivery folder is a bordered "Google Drive" button
  next to Download, matching the gallery, instead of an underlined text link
  beside the filename.

## [6.55.0] — 2026-09-04

### Changed
- **The share page's Drive link is a button now**, bordered and carrying the
  Google Drive mark, sitting after "Download all" instead of as a text line
  under the title. With several delivery folders behind one share it becomes a
  menu that names each folder and the MC numbers inside it — with more than one
  folder, "which one holds what" is the only useful thing the list can say.
- **The image-preview switch is hidden when it cannot do anything.** It swaps a
  live render for a stored PNG, so on a share whose items are all delivered
  images it only offered a no-op. (The detail dialog already only showed it for
  live-rendered items.)

## [6.54.2] — 2026-09-03

### Fixed
- **Filter dropdowns open above the selected tiles again.** A selected creative's
  ring and checkbox carried a page-wide z-20, so with a selection active they
  painted over the sticky toolbar (z-10) and through any open filter menu. The
  tile now isolates its own stacking context, which keeps those overlays where
  they belong without touching the toolbar's layer.

## [6.54.1] — 2026-09-03

### Changed
- The Drive link check sits at the bottom of the Creative Library toolbar, under
  "Show archived", and no longer carries its own horizontal padding — the
  toolbar body already provides it, so it lines up with its neighbours.

## [6.54.0] — 2026-09-03

### Added
- **The upload queue and the big upload window are two views of one batch.** The
  Creative Library's upload button now opens the same table-with-a-"Set for all"-row
  window the Assets library has (drop as many files as you like, or click to
  choose), and the floating queue panel gained an expand button that opens that
  window on the batch already in it — nothing is lost on the way there or back.
  The window is now one shared component, `BatchUploadDialog`, with the columns,
  the title and the semantic class prefix supplied by each library.
- **The filename parser fills in MC number and variant.** The shipped parsing
  rules only covered brand, product and type, so `ERSTE_SZA_MC324_b_…` left both
  MC fields empty in the upload queue. The variant rule deliberately takes a
  single lowercase letter only: 48 of the 3145 live creatives carry a different
  token there (`va`, `px`, `bg`, `c1`) which is not a variant, and a blank field
  someone fills in beats a wrong prefill.

### Removed
- The single-file "Upload creative" dialog, which had no drag & drop and no
  batch fields. Its job is done by the big window.

## [6.53.0] — 2026-09-03

### Added
- **Every creative can now carry its Google Drive delivery location** — the
  parent folder link you paste, and the direct file link derived from it. Four
  nullable columns on `creatives` (migration `0011`), holding *ids* rather than
  the pasted URL, so the same folder pasted with `?usp=sharing` or a `/u/0/`
  prefix still groups as one folder.
- **The upload queue takes the folder link once per batch.** Paste it in the
  queue header and it lands on every queued creative, including files dropped
  afterwards; the single-file upload dialog has its own field. A creative's
  folder stays editable in its detail dialog, where the resolved file link is
  shown read-only next to it.
- **"Drive link check" in the Creative Library toolbar** resolves (or
  re-verifies) the file link of every creative in the current filtered view, and
  reports *unreachable folder* separately from *file not found in folder* — an
  unreachable folder means the link is not shared "anyone with the link", which
  would show a share viewer a request-access page instead of the creative.
- **Share pages show where the creatives came from:** the distinct delivery
  folders in the gallery header, and the parent folder on each creative in the
  detail view. The links ride the existing share snapshot, so they are frozen at
  share-creation time like the rest of it.
- **`scripts/drive-backfill.ts`** fills in the links of already-imported
  creatives from a list of folder links (`--file links.txt`), dry-run by
  default. It never repoints a creative that already claims another folder
  unless `--overwrite` is passed.
- **MCP:** `list_creatives` rows carry `drive_folder_url` + `drive_file_url`,
  `list_mc` rows carry `drive_folders` (the distinct folders of that MC's
  creatives), and `creative_update` accepts `fields.driveFolderUrl`. No new
  tool — the links are simply visible where creatives and MCs are listed.

### Changed
- `makeItemRoute` gained the `validationError` hook `makeCollectionRoute`
  already had, so a malformed link is a 400 on PATCH instead of a 500.
- Changing or clearing a creative's folder drops the file link derived from the
  old one, rather than leaving a link pointing into a folder the creative no
  longer claims.

## [6.52.0] — 2026-09-02

### Fixed
- **A nonDCO creative that is a video now plays in the message preview.** The
  static preview rendered every creative through an `<img>`, so an `.mp4` showed
  its alt text on the checkerboard. It picks `<video>` by extension now, using
  the same map the importer classifies uploads with (`mediaKindFromFilename`)
  rather than a fourth private copy of the extension list, and the same
  `controls / preload=metadata / muted / playsInline` treatment as the asset
  previews.

### Added
- **Scrolling or swiping over the preview cycles the size**, wrapping at both
  ends — the sizes of one creative are a ring, not a list with a stop. The wheel
  listener is attached non-passively so the page behind does not scroll along;
  the viewport itself never scrolled, so nothing is being stolen.

## [6.51.0] — 2026-09-02

### Changed
- **The library's Messages tile counts MCs, not rows.** A `messages` row is a
  cell, and one MC lives in as many cells as it has audiences — MC316a occupies
  43 — so the old figure answered "how many times is the same message
  duplicated across audiences". Erste reads 635 MCs (number+variant) in 2,753
  cells, where the tile used to say 2,753. The row count stays underneath as
  context.
- **Monitoring: the report-period label is gone** (two date selects say what
  they are), and **All / Matched / Unmatched moved into the right toolbar**,
  above the upload — it is a view mode, like the view switcher and archive
  toggle that live there on the other screens. Collapsed it becomes three
  icons; the upload is pinned to the bottom of the rail in both states.
- **Assets and the Creative Library get the monitoring upload's drop zone.**
  With the rail open the drop target is right there and files can be dropped
  without opening anything; collapsed it stays the primary icon button that
  opens each page's existing batch dialog. Dropped files go where that page
  already sent them — the asset metadata dialog, or the creative upload queue.
  The shared shell is `_components/ToolbarUpload.tsx` and owns no upload logic.

## [6.50.0] — 2026-09-02

### Added
- **A "Last 30 days" scope**, next to Today / Yesterday / Last 7 days. The
  empty-state link now steps one rung wider too — a day leads to the week and
  an empty week to the month, instead of dead-ending at 7 days.
- **The creative strip can be ordered by measured CTR** instead of by recency,
  from a Time/CTR toggle where the panel's "Open →" was (`?cs=ctr`). The rate
  is summed over every report period from matched monitoring rows only, and an
  MC must have delivered 100k impressions to be ranked at all — otherwise a
  creative shown twice and clicked once tops the list at 50%. Ranking by CTR
  also drops the day window: of the 74 MCs past the floor, a 7-day window holds
  9 and no uploaded creative at all, so "best performing" is an all-time
  question and the panel says so.

### Changed
- **The product filter now reaches the top report row and the library counts**,
  which were the last two things on the dashboard ignoring it. Note that
  Matrix coverage means something different once filtered: the rows carrying no
  product are the unmatched publisher lines, so they leave the denominator too
  and coverage reads 58–100% per product against 35% overall (Aug 2026). Both
  are true; they count different populations.
- Text formatting has no product dimension, so its library tile is deliberately
  left unfiltered and labelled "all products" rather than dropping to zero.
- `entityCounts` moved to `dashboard-products.ts` as `libraryCounts` and the
  DCO/nonDCO product rule is now one shared `messageProduct` expression instead
  of a copy in each query that needs it.

## [6.49.0] — 2026-09-01

### Added
- **Monitoring rows now carry the day they cover.** The AdForm report has always
  had a per-day `Date` column; the importer folded it away into one whole-period
  row per message key. It is now part of the aggregation key, stored as ISO
  `YYYY-MM-DD` in a new `monitoring.day` column (migration `0010`, which also
  extends the period unique index and adds a `(client_id, day)` index).
  A report built without a `Date` column still imports exactly as before, with
  `day = ""` meaning "no day breakdown" — the same convention `size` uses.

### Changed
- A month of AdForm data now stores ~68k rows instead of ~3k (May 2026: 3,002 →
  67,749). Measured on the real reports: parsing takes ~2.1s and the chunked
  insert ~5.0s per month, and an aggregate over a whole day-grained period
  answers in 15ms. Every existing reader groups by report period, so the numbers
  they show are unchanged — pinned by a test that imports the same report folded
  and per-day and compares the two.

### Notes
- Day-level range queries (`?from=2026-06-15`, "last 30 days") are NOT part of
  this release: the column exists, nothing reads it yet. See `W3.k` in
  `tasks/todo.md`. Re-importing the existing report files is what turns the
  stored history day-grained; until a period is re-uploaded it stays folded.

## [6.48.0] — 2026-09-01

### Added
- **Monitoring can now analyse several report periods at once.** The single
  period `<select>` became a from–to pair over the period list, and the API sums
  each message key across the selected slice — the four periods live today are
  15,646 stored rows but only 6,227 distinct keys, so the whole history is about
  the size of the single busiest month on its own. CTR is recomputed from the
  summed clicks and impressions; averaging the per-period rates would weight a
  quiet month like a busy one.
- **The detail dialog breaks an MC down per report period**, next to the
  existing audience × size table, whenever the selected range covers more than
  one period.

### Fixed
- The report-period list is ordered on the parsed date instead of the stored
  `DD/MM/YYYY` text, which would have put December 2025 above January 2026 in
  the selector.

### Notes
- The selector is a period list, not a date picker: `monitoring` has no day
  column, so no slice narrower than a report period is answerable today. The
  source reports *do* carry a per-day `Date` column that the parser currently
  discards — see `W3.j` in `tasks/todo.md` for what a day-grain ingest would
  cost (measured: ~68–73k rows per month instead of ~3k).

## [6.47.0] — 2026-09-01

### Added
- **The dashboard's top row now carries reporting charts instead of two tiles
  that repeated the panels underneath them.** *Delivery* shows impressions per
  report period with the month-over-month change (Aug 2026: 20.1M, +29%), and
  *Matrix coverage* shows what share of that delivery is linked to an MC
  (35% in August, down from 78% in June — unmatched publisher lines growing
  faster than the matched ones). Both are **monthly and ignore the day scope**:
  `monitoring` stores whole report periods, so a Today window would render them
  empty on all but one day of the month. They label their own period instead.
  The "not published to AdForm" count moved into the Feed exports panel header,
  which is where the per-row badges already are.

### Changed
- **The Activity panel now honours the product filter**, like the Feed exports
  and Creatives panels already did. `audit_log` has no product of its own, so it
  is resolved per entity type — messages, topics, feed exports, creatives,
  assets and audiences, which is 97% of the volume. Entity types with no product
  dimension (text formatting, keywords, uploaded files, config) drop out while a
  filter is on, as do rows whose entity has since been deleted.
- Message rows are resolved with `coalesce(audience product, topic prefix)`,
  because a nonDCO cell sits on a channel (`ch_disp`, `ch_soc`) rather than an
  audience, and a channel carries no product — only the topic key prefix names
  one. 688 Erste cells are nonDCO, so filtering on SZK finds 1,452 message
  writes in the last seven days rather than 1,273.
- `periodDateKey` moved out of `mcp.ts` into `src/lib/period.ts`. Report periods
  are stored as `DD/MM/YYYY`, so ordering on the stored text puts December 2025
  after May 2026 — the trend chart sorts on the parsed date instead.

## [6.46.0] — 2026-09-01

### Fixed
- **A monthly AdForm report no longer fails to import once it grows past ~3,300
  message rows.** A monitoring row spends 20 bind parameters and Postgres caps a
  single statement at 65,534, so the whole-slice insert died with
  `MAX_PARAMETERS_EXCEEDED` above 3,276 rows — August 2026 aggregates to 5,733.
  The insert is now chunked inside the same transaction, so the period slice is
  still replaced atomically. June 2026 (3,364 rows) was already over the ceiling
  and would have failed on re-upload.
- **The reporting period is read from the Front Page wherever the label sits.**
  AdForm's own export indents every sheet by one blank column (label in B, value
  in C); reports rebuilt by other tooling start at column A, and the fixed
  column index made those fail with "Could not read Reporting Period From/To"
  even though the dates were plainly there.

## [6.45.1] — 2026-09-01

### Fixed
- **A count segment that is zero for every option is no longer shown.** Erste
  has no channel audiences, so the product menu's nonDCO column read 0 down the
  whole list and only invited the question "what is that middle zero?". It
  reappears on its own once such cells exist. Same rule in the matrix and the
  creative library.
- **Stepping the day no longer clears the product filter** — every scope link,
  including the empty state's "try the last 7 days", carries the selection.

### Changed
- Dashboard toolbar order: the product filter sits after the title, and the day
  scope stays on the right next to the date it resolves to.

## [6.45.0] — 2026-09-01

### Added
- **A Product filter on the dashboard**, in the toolbar beside the day scope.
  It narrows the creatives strip and the feed exports — the two panels whose
  rows carry a product; activity, shares and the library totals have none and
  are left alone. The selection lives in the URL (`?p=SZK,VAL`) like the scope,
  so a filtered view is linkable and survives a reload.
- **Every product filter now has "Select all / none"** — matrix, feeds,
  creative library, assets, monitoring — the row the status filter has had all
  along.
- **Per-product counts in those menus**, in small grey. The dashboard shows
  three numbers per product — DCO cells, nonDCO cells, delivered creatives —
  the matrix shows DCO and nonDCO, the creative library DCO and uploaded, and
  the rest a single row count. A tooltip names the segments. Counted over the
  whole library, not the current result: a product picker is read to decide
  where to look, so the numbers must not collapse to zero on a quiet day.

### Changed
- `STATUS_QUICK_SELECT` is now `ALL_NONE_QUICK_SELECT` — it was never about
  status, and it is now on six filters.

## [6.44.0] — 2026-09-01

### Added
- **A Shares panel on the dashboard**: shares opened in the window with their
  item, view and download counts, plus every comment that landed in the window
  — including ones on shares opened long before it, which the share rows alone
  would never surface. Views and downloads are running totals with no per-day
  history, so they say so rather than passing themselves off as window figures.

### Changed
- **The dashboard opens with the same toolbar as every other screen** — sticky
  bar, title, scope pills, count on the right — instead of a page heading of
  its own. The client name went with it: the sidebar names the client on every
  screen, so repeating it cost a heading's worth of height and said nothing new.
- **The client name in the sidebar is now the way back to the dashboard**, which
  is why the dashboard needs no nav item of its own.

### Internal
- `shareItemCount` moved out of the share-galleries route into `lib/share-metadata`,
  now that the dashboard reads the same snapshot shape.

## [6.43.0] — 2026-09-01

### Changed
- **The creative strip is one recency line over both kinds of creative.** DCO
  banners — matrix cells rendered live through their template — sit next to
  delivered files, ordered by last change, so an MC edited an hour ago leads
  the strip instead of a file batch from weeks back. An MC appears once however
  many cells carry it, and only live cells on templates that render a strip
  size show up, which is what the Creative Library shows too.
- **Ordered by `updatedAt`, not `createdAt`.** A re-upload, a re-tagging or a
  copy edit is exactly the change worth surfacing, and the window ("in this
  window") now means "changed in this window".
- **Two sizes only — 300x250 and 1080x1080.** A delivery arrives in a dozen
  sizes; on a dashboard the point is to recognize the creative, not to audit
  the set. Version families collapse to their newest member within a page.

### Added
- **Hover names the tile**: MC number and variant, and the topic under it.
  Creatives carry no topic of their own, so it is resolved from the message
  their MC number and variant point at — every one of them when a pair fans
  out to several cells, since picking one silently would name the wrong cell.
- **Clicking a tile opens the Creative Library's own dialog** — the uploaded
  detail form for a delivered file, the matrix preview dialog for a DCO banner
  — so a creative opened from the dashboard edits through the same form and
  the same PATCH.

## [6.42.0] — 2026-09-01

### Fixed
- **The creative strip showed the oldest batch, not the newest.** It ordered by
  row id, and this library's highest ids are an import whose `created_at` is
  2025-12-22 — so a strip labelled "new creatives" led with the oldest
  delivery, and the "latest arrived" note repeated that wrong date. It now
  orders by `created_at`, which is also what the Creative Library sorts by, so
  "newest" means the same thing on both pages.

### Added
- **The strip loads as you scroll right** instead of stopping at 24 tiles:
  `GET /api/dashboard/creatives` serves pages of 24 within the current day
  scope, the page renders the first one itself, and the next arrives before the
  scroll reaches it. Paging is guarded by refs rather than state, because
  scroll events fire faster than React commits and two of them would otherwise
  fetch the same page twice.

## [6.41.0] — 2026-09-01

### Changed
- **The dashboard is a day digest instead of a counter page.** It opens on
  today and can be moved a day at a time or widened to the last seven, with the
  scope carried in the URL (`/?d=2026-09-01&r=7d`) so a view can be linked or
  reloaded. The window is a UTC day, which is how every timestamp in the
  database is stored; the header says so.
- **Activity is aggregated, not tailed.** The old page listed the last 15 audit
  rows — on a day that wrote 5085 of them, that list said nothing. It now
  groups by entity and action with a count and the people behind it (email,
  resolved from the audit row's user id, rather than the raw id), longest first,
  capped at 15 kinds with a "+N more" line.
- **The entity counters moved to the bottom** as "Library · all time" and now
  link to the pages they count (Audiences and Topics went to /matrix before).

### Added
- **Three signal tiles**: writes in the window, feeds exported in the window
  with how many are still not published to AdForm, and how old the reporting
  data is. The last one is the point: the monitoring import has been silent
  since 2026-07-16 while the matrix kept moving, and the tile says that out
  loud instead of letting a chart imply freshness.
- **Feed exports of the window**, each linking to its detail page, marked
  published or not published — the uploaded-is-not-exported distinction the
  feed invariants rest on, visible on the front page.
- **A creatives strip** normalized to a single 250px height, so a 300x250
  banner and a 1080x1080 square sit side by side without cropping or
  letterboxing, with step buttons for the overflow. Delivery is bursty and most
  windows have no new creative, so an empty window falls back to the latest
  arrivals and labels itself as doing that, rather than showing a permanently
  empty widget.

## [6.40.0] — 2026-09-01

### Changed
- **Append or New feed, as a switch rather than a checkbox.** "Force new feed
  version" was a modifier on one act; these are two different acts and now say
  so at the top of the dialog, each with a line explaining what it does.
  Appending continues a feed: it requires a baseline, inherits that feed's
  signal header and DEFAULT row, and never deletes a row. A new feed starts
  fresh: you choose the signal and the DEFAULT row, only the current selection
  goes out, and there is no diff — a fresh feed has nothing to be different
  from, so the panel says that instead of showing an empty comparison.
- **Append refuses to build without a baseline**, since the baseline is what it
  would be continuing.

- The feed panel's button reads **Export** rather than "Preview & Export".

### Fixed
- **The diff details showed the first 50 rows of each kind.** A routine export
  changes hundreds, so the row you were looking for was usually past the cut —
  an MC's status flip and an image swap were both in the diff and both
  invisible. The limit is now 1000 (a feed is capped at 500 rows anyway) and
  there is a text filter above the list that matches on any cell, so "331" finds
  the MC and "_n2.jpg" finds the image change.

## [6.39.0] — 2026-09-01

### Changed
- **Continuing a feed means continuing its choices.** With a baseline selected
  and no forced new version, the signal column and the DEFAULT row are the
  baseline's: both fields show what they will be and are disabled, and the
  baseline's own DEFAULT row goes into the export unchanged rather than being
  rebuilt from an MC. Rebuilding it produced a row that could not match the
  baseline's, so every export reported one row added and one switched off,
  permanently. Ticking Force new feed version hands both fields back.
- **Force new feed version drops the rows outside the selection.** Until now it
  only bumped the version number while every row was still carried, which left
  no way to retire a row at all. Issuing a new version is exactly the moment
  rows may leave; updating the current one is when they may not. The checkbox
  moved directly under the baseline picker, where it decides how the fields
  below it behave, and says what it does.

## [6.38.1] — 2026-09-01

### Fixed
- **The DEFAULT row stopped being rebuilt from the wrong MC.** A reference's
  default was read from its `messaging_card_id` / `_variant` columns, which are
  descriptive text and can disagree with the row's own PMMID — a live reference
  said card-id 301/b while its PMMID and ReportingLabel said `-m_302-`. Since
  every match (the diff, the carry-forward, AdForm's reporting) runs on PMMID,
  the export rebuilt the DEFAULT row from a different MC and it never lined up:
  every export showed one row added and one switched off, permanently. The MC is
  now read from the PMMID, including its version — a number+variant can exist at
  several versions, and picking the wrong one regenerates a PMMID that still
  fails to match. The descriptive columns remain the fallback.

## [6.38.0] — 2026-09-01

### Fixed
- **Rows the feed can no longer rebuild are carried instead of dropped.** A
  baseline row whose MC is gone — renumbered, deleted, rekeyed — has no message
  to evaluate patterns against, so it fell out of the export entirely. Those are
  exactly the rows that must not: they already served impressions, and a feed
  update may not delete a row that has run. They are now re-emitted verbatim
  from the baseline with `IsActive=FALSE`. Against the live SZK reference this
  was all 46 of the rows the preview called "switched off" — none of them were
  actually in the file. The baseline's own DEFAULT row is excluded: a feed
  carries exactly one, and the current one is generated from the chosen default.

### Changed
- **The baseline picker shows what each feed is and when it went out** —
  filename, `reference` or `export v1`, whether it is live, and the date —
  instead of a flat list of filenames.
- **No more "automatic" baseline row.** The newest live feed is preselected,
  falling back to the newest built one; a manual pick is never overridden.

## [6.37.1] — 2026-09-01

### Fixed
- **The version decision was made on a diff that could not match anything.** It
  compared rows by (advert_id, ReportingLabel) — an identity only two MM6
  exports share. An uploaded reference carries AdForm's advert_ids and a freshly
  built row set has none, so against a reference the key matched almost nothing
  and nearly every row read as removed: the warning claimed 190 rows while the
  PMMID-matched preview beside it said 46. A reference is now compared on PMMID
  in both places.
- **The baseline's default row is offered even when it sits outside the current
  filter.** The server resolves the DEFAULT row against every message of the
  client, but the dropdown was built from the export's selection, so a baseline
  whose default was filtered out had no option to select and the field silently
  read "no default row". The baseline's own default is carried in as an option,
  labelled as coming from outside the filter.

## [6.37.0] — 2026-09-01

### Fixed
- **The carry-forward rule now applies when the baseline is an uploaded
  reference — which is the common case.** `adform-snapshot.ts` fills a
  reference's `messageIds` with `-1`, because an XLSX from AdForm knows nothing
  about our rows, so the "nothing ever leaves the feed" rule silently did not
  apply to it: rows still vanished. The reference's rows identify themselves by
  PMMID, which is how the diff already matches them, so the carry-forward set is
  resolved the same way.
- **The version reason no longer promises a deletion that cannot happen.** It
  read "N live rows would be removed (sticky-superset rule)"; without a forced
  new version those rows are carried out switched off, so it now says so, and
  only speaks of dropping when Force new version is ticked.

### Added
- **Choosing a baseline fills in the signal column and the default row.** The
  baseline answers both — it is the feed this export continues — and asking
  again only let the two disagree. A later manual change still wins.
- **The diff tiles filter the details.** Added / Changed / Switched off are
  buttons; picking one opens the details list showing only that slice.
- **The dialog header names the file you are about to build**
  (`erste-SZK-adform-feed-v1-new.xlsx`), with the id reading "new" until the row
  exists, and the real name once it does.

### Changed
- **Inputs first, diff underneath.** The comparison readout, the version warning
  and the details sat above the controls that decide them; a diff means nothing
  until you have said what it is against.

## [6.36.0] — 2026-08-31

### Added
- **Choose what the export is compared against.** A "Compare against" picker in
  the export dialog lists this product's earlier feeds — references and exports
  alike — with the newest preselected, which is what the export would have built
  on anyway. The choice is the diff baseline *and* the carry-forward set, which
  is why it has to be selectable: exporting one section of a product must build
  on that section's own previous feed, not on a sibling section's.

### Fixed
- **A feed update no longer deletes the rows you filtered out.** The matrix
  filter was applied before the sticky-superset union, so exporting one section
  of a product dropped every other section's row from the file — the one thing a
  feed update must never do, and it happened precisely in the
  filter-to-a-section workflow. A row the baseline carries that is not in
  today's selection now goes out with `IsActive=FALSE`: still in the feed, no
  longer serving. Deleting is what a new version is for, and the diff labels say
  so — "Switched off" normally, "Dropped" when Force new version is ticked.

### Removed
- **The split-by-platform export.** The matrix filter already decides which
  slice is being exported, so the dialog only has to name the default row and
  the signal header for that slice. The zip endpoint went with it. The platform
  column, the signal picker and the per-(product, platform) live feed stay —
  those are what make two live feeds for one product work.

### Fixed
- **Uploading a feed reference no longer destroys the previous one.** The upload
  was an upsert keyed on (client, product): it deleted the existing snapshot for
  that product before inserting. So uploading SZK's DV360 reference deleted its
  AdForm one — a product legitimately runs a live feed per platform, and may yet
  need several per platform. Uploads now accumulate; the newest reference for a
  (product, platform) is what a new export diffs against, the same rule the
  exports already follow, and older ones stay as history.
- **An export diffed against whichever reference the database returned first.**
  The snapshot lookup that supplies the diff baseline filtered on product alone
  and took `limit(1)` with no ordering, so once a product had both an AdForm and
  a DV360 reference, an AdForm export could be compared against the DV360
  picture — every row of the other platform reading as a difference. It is now
  scoped by platform and ordered newest-first.

## [6.35.1] — 2026-08-31

### Fixed
- **Switching to Feed view after editing in the matrix no longer breaks the
  page.** MessageEditor and FeedView both read the text-formatting rules under
  the react-query key `["text-formatting"]`, but they cached different things
  under it: the editor stored the API envelope (`{ text_formatting: [...] }`),
  FeedView the unwrapped array. Whichever mounted first won the cache entry, so
  opening an MC and then switching to Feed handed FeedView an object where it
  expected an array — `rules.filter is not a function` thrown during render,
  which took the whole matrix route to its error boundary. Reloading appeared to
  fix it only because FeedView then repopulated the key first. Both now go
  through one `useTextFormattingRules` hook, so the shape can only be stated
  once.
- **The same defect, three more times, between Monitoring and the matrix.** A
  scan for query keys shared across files found `["messages"]`,
  `["audiences"]` and `["templates","folders"]` in the same state: the
  monitoring table unwrapped the envelope while all four other consumers kept
  it. Arriving at Monitoring from the matrix handed `templates.map` an object;
  going the other way silently emptied the matrix's template list. Monitoring
  now keeps the envelope like everyone else.

## [6.35.0] — 2026-08-31

### Added
- **The image-preview switch is in the detail dialog too, and it is the same
  switch.** Flipping it in the gallery toolbar or inside the lightbox changes
  both, because the dialog is handed the gallery's own state rather than
  keeping a copy in sync. In image mode the lightbox shows the stored PNG in
  place of the live render, in the same scaled box and inside the same
  annotation layer — so existing pins and boxes keep pointing at the same spot
  on the banner. An item with no stored image falls back to the live render: a
  blank stage would read as "this ad is broken" rather than "no preview yet".

### Changed
- **An uploaded feed reference is listed under its own filename.** The File
  column showed a generated name (`erste-SZK-adform-feed-v0-42.xlsx`) for files
  nobody downloaded from us; it now shows the name of the file that was
  uploaded, which is the one you will look for. Exports are unchanged.

## [6.34.0] — 2026-08-31

### Fixed
- **A megosztott galéria (és a Creative Library) néha üres `</>` placeholdert
  mutatott banner helyett.** Az IntersectionObserver callbackje a legutóbbi
  kézbesítés óta sorba állt **összes** entry-t kapja, legrégebbi elöl, és a kód
  az `entries[0]`-t olvasta. Gyors görgetésnél a sor `[kilép, belép]`, tehát egy
  elavult `false` érkezett vissza: a tile „nem látható" állapotban ragadt,
  mozdulatlanul állva pedig több intersection-esemény nem jött, így soha nem tért
  magához. Ráadásul a látható→nem-látható váltás a repülő render-fetchet is
  eldobta, mielőtt a cache-be került volna. Mindkettő javítva
  (`PublicMatrixPreview`, `MatrixIframeTile`).

### Added
- **Image preview a megosztott galérián.** Pipás kapcsoló a View mellett: a
  bannerek az eltárolt preview PNG-t mutatják élő iframe helyett, a Download all
  pedig ezeket a PNG-ket zipeli. A gomb számlálója mondja meg, hány elemnek van
  egyáltalán képe — ha ez kevesebb a Download all számánál, az a hiányzó
  preview. Amire nem futott még a generátor, az „no preview image" marad és
  kimarad a zipből, nem esik vissza némán HTML-re. Új publikus
  `GET /share/[id]/previews` (ugyanaz a snapshot-alapú kapuzás, mint a
  fájl-proxynál).
- **Select all filtered a Creative Library kijelölő módjában.** A teljes szűrt
  halmazt jelöli ki, nem csak a végtelen görgetéssel betöltött első 200 sort.

### Changed
- **A megosztott galéria fejléce két sávra bomlik.** Fent az azonosítás és a
  share tényei (hány komment, mikor készült), alatta a vezérlők: balra ami szűk
  a halmazt (Size, Commented only), jobbra ami a megjelenítést vagy a letöltést
  intézi (View, Image preview, Download all).
- **A megosztott galéria masonryja a legrövidebb oszlopba pakol.** Minden elem
  magassága előre ismert a banner méretéből, illetve a kreatív tárolt
  dimenzióiból, tehát nem kell megvárni a betöltést a döntéshez. A körbeosztás
  vegyes képarányoknál több képernyőnyi különbséget hagyott az első és az utolsó
  oszlop alja között. A Creative Library olvasási sorrendje változatlan — az új
  `Masonry` viselkedés opcionális.
- **MC export a docs-ba (`npm run export:mc`).** Egy sor minden szolgáló DCO
  kártyáról (MC szám + variáns, ACTIVE vagy INACTIVE státusz), a termékkel, a
  PMMID-kkel, az ACTIVE/INACTIVE bontással és a négy méret publikus preview-PNG
  linkjével → `docs/mc-export.xlsx`. A linkek `?v=` cache-bustere a preview sor
  `updated_at`-je, ezért a `npm run gen:previews` utáni újrafuttatás friss
  képekre mutat. Csak olvas, bármikor ismételhető.
- **A feed export knows which platform it is for.** `feed_exports.platform`
  (migration `0009`; every existing row is AdForm, verified from the stored
  payloads). This is the piece that was missing: a product legitimately has two
  live feeds at once — AdForm and DV360 each carry their own lineitems — so
  `findLiveExport` is now keyed by (product, platform). It used to pick the
  latest upload for the product regardless of platform, which meant a DV360
  reference would become the baseline an AdForm export diffs against: the other
  platform's rows read as removed, and "rows would be removed" is one of the
  three version-bump triggers. The Feeds list gains a Platform column, and Live
  marks the current live export per product **and** platform.
- **Split export.** One action can write both platforms' feeds: the dialog
  partitions the rows by the audience's buying platform, gives each half its own
  DEFAULT row selector and its own signal header, creates one export row per
  platform (each with its own version line), and delivers the pair as a single
  zip. Rows whose audience has no buying platform block the split and are named
  — a feed quietly missing rows is worse than an export that refuses.
- **The default-row and signal selectors moved into the export dialog.** They
  are export options, and with a split there are two of each; the side panel
  keeps the gate, the row count and the live-feed line.
- **Pick the signal column when you export a feed.** A "Signal column" dropdown
  sits under "Default for this export" with the two values the platforms
  actually want — `AdformSignal:ADFPLAID` for AdForm, `ExternalSignal:ExternalSignal`
  for DV360 — so exporting for DV360 no longer means editing the header by hand.
  The choice is remembered per product. Only the header is renamed: the value is
  the audience's `lineitem_id` either way, and an audience already carries the id
  belonging to its own buying platform.

### Fixed
- **The `Live` column marks the export that is actually live.** It showed
  `uploadedToAdformAt !== null` — "was published at some point" — so a newer
  reference left two rows saying `true`. It now marks the most recently
  published export per product **and platform** (two live feeds for one product
  is correct: one per platform). The superseded row keeps its `Published at`
  date — it did go live once. The live cell carries the ACTIVE status colour so
  it is findable at a glance in a long history.
- **A published timestamp could sort above a later one.** The reference upload
  wrote `uploadedToAdformAt` as an ISO string while every other writer uses the
  schema's `YYYY-MM-DD HH:MM:SS`. These columns are compared as strings to decide
  which export is live, and `"T"` sorts above `" "` — so on a shared date an
  ISO-stamped morning reference outranked an export published that afternoon.
  The snapshot route now writes the same format as everything else.
- **A DV360 reference no longer bounces off the upload.** Uploading a feed
  reference compared the header to Settings → Structure → Feed structure
  position by position, so a DV360 file failed with
  `Column 3 mismatch: file has "ExternalSignal:ExternalSignal", expected
  "AdformSignal:ADFPLAID"` — verified against the two SZK files in `docs/`. The
  two signal aliases now count as a match, and the uploaded snapshot is stored
  under the configured name so later diffs don't report the signal as changed on
  every single row.

## [6.33.0] — 2026-08-31

### Changed
- **The Feeds list leads with the file you are about to download.** The first
  column is now the export's real filename (`erste-VAL-feed-v1-1234.xlsx`) and
  carries the link to the export; `Exported` moved down to sit directly before
  `Published at`, so the two dates read as a pair. The name comes from a shared
  `lib/feed-filename.ts` used by both the list and the download route, and now
  carries the platform (`erste-SZA-adform-feed-v1-40.xlsx`) so a split's two
  files differ by more than their trailing id — a second
  copy of that format string would have drifted the first time either changed.

### Fixed
- **An MC can no longer end up with no status.** `messages.status` is now
  `NOT NULL DEFAULT 'ACTIVE'` (migration `0008`, which backfills first). A
  status-less MC was worse than it looked: the matrix status filter matches on
  `m.status && …` and the filter menu only offers statuses that exist, so those
  rows vanished the moment any status was ticked and could not be filtered
  *for* — invisible on the status axis rather than merely uncoloured. Three
  producers are closed at the source:
  - `scripts/rebuild-creatives.ts` did a raw insert that omitted the column
    (it bypasses `createMessage` on purpose, to keep the MC number parsed from
    the filename) — it now sets `ACTIVE` explicitly. This one produced all 676
    status-less MCs on 2026-08-17.
  - The MC editor's Status dropdown offered an explicit `— none —` option that
    wrote `null`. Removed.
  - An empty Status cell in an imported XLSX became `null`; it now imports as
    `INCOMING` — a spreadsheet row that never said "live" must not go live by
    omission.
- **Creative promotion lands ACTIVE.** `promoteCreative` (MCP `creative_promote`)
  used to inherit `createMessage`'s `INCOMING`, which reads as "someone still has
  to write this card". What gets promoted is a finished, delivered creative file.
  Hand-created MCs are unchanged and still start at `INCOMING`.

## [6.32.0] — 2026-08-30

### Fixed
- **The feed export's DEFAULT row renames the audience again.** The rewrite
  that turns `-a_<audience>-m_` into `-a_DEFAULT-m_` in the PMMID and the
  ReportingLabel matched the audience segment with `[^-]*`, so it silently did
  nothing for any audience key containing a hyphen (`SZA_rtg-allvisitors_IDF`)
  — the DEFAULT row went out carrying the donor message's real audience. The
  `-l_<n>` → `-l_ANY` half kept working, which is why it looked half-broken.
  Now matched lazily, the same way `adform-snapshot.ts` already parses PMMIDs.

### Changed
- **The DEFAULT row's clickTAG reports as DEFAULT.** The trafficked URL used to
  carry the donor message's audience key, so a click on the fallback ad was
  indistinguishable in analytics from a click on the donor's own row. Both
  places the key appears — the PMMID inside `utm_cd26` and the standalone token
  in `utm_term` — now read DEFAULT. `utm_campaign` and `utm_source` keep the
  donor key on purpose: they are `audiences[<key>].Field` lookups, and there is
  no audience row named DEFAULT, so rewriting them would emit empty parameters.
  Existing reports segmented on the donor audience will see its numbers drop by
  the fallback's share.

## [6.31.0] — 2026-08-30

### Added
- **The Status filter counts what it would show you.** Each option in the
  Status dropdown now carries a small grey number on the right: how many MCs
  in the current result set have that status. The counts are measured with
  every *other* filter applied but the status filter itself still pending —
  count after it and each selected status would only ever count itself while
  the unselected ones all read 0. The count is an optional `optionCounts` prop
  on the shared `MultiPill`, so any other filter can opt in with one line.
- **The tree view colours nodes by buying platform.** A node whose entire
  subtree shares one recognised platform gets that platform's stripe (dv360
  green, adform teal — the same colours the matrix audience header already
  uses); a node that mixes platforms, or carries none, keeps its depth colour,
  so "no colour" never reads as a platform.

### Changed
- **Platform colours have one home.** The two hex values lived twice in
  `globals.css` (bottom-edge and right-edge variants) and the platform→colour
  branch was hardcoded in `GridView`. The values are now `--plat-*` custom
  properties defined once, and which platform strings get a colour is listed
  once in `matrix/types.ts` (`PLATFORM_TOKENS`). Matching is now trimmed and
  case-insensitive, which `buyingPlatform` being a free-text field warrants.
  No visual change to the matrix header.

## [6.30.2] — 2026-08-30

### Fixed
- The generated key rendered slate, not amber: its amber utilities were merged
  over `readOnlyCls`, and `bg-slate-50` / `bg-amber-50` sit in the same utility
  layer, so the stylesheet order won rather than the class-attribute order. The
  field now carries its own explicit class list, and its label shares the amber
  tone.

### Changed
- The regenerate action reads "Regenerate dependencies" — it moves the cards,
  their PMMIDs and their trafficking fields, not just the key.

## [6.30.1] — 2026-08-30

### Changed
- The header dialog's Key field is full width, with the generated key stacked
  directly underneath it in the same monospace face — the two are meant to be
  compared character by character, which two half-width columns made harder.
  The "out of date" badge is gone; a line under the pair says what Regenerate
  will do, with the action as a link-style button beside it.

### Removed
- The read-only "MC count" field in the audience/topic header dialog. The same
  count is already on screen as the `n/n` next to the MC stepper.

## [6.30.0] — 2026-08-30

### Added
- **Regenerate a topic's or audience's key from its pattern, and carry every MC
  along.** Editing a tag on a dimension that already has messaging cards has
  always left the key behind — the auto-key is frozen so a rename cannot orphan
  cards — but it did so silently, and every PMMID built from that key stayed
  stale. The header dialog now marks such a key "out of date", shows what the
  pattern would produce, and offers a Regenerate action. It previews the change
  first (old → new key, how many cards move, one sample PMMID before/after),
  then rewrites the key, each card's topic/audience, and each card's PMMID and
  trafficking fields in a single transaction.
- The rekey refuses rather than rewriting history: if the old key already
  shipped in a feed export that was uploaded to Adform, if monitoring rows
  reference it, or if the generated key is taken by another row. Feed export
  payloads, monitoring rows and audit snapshots are never rewritten — they
  record what actually shipped or was reported.
- `GET`/`POST /api/topics/[id]/rekey` and `/api/audiences/[id]/rekey` (preview /
  apply). The list endpoints now return `generatedKey` and `keyStale` per row.

### Changed
- The PMMID + trafficking regeneration that create / copy / move / update /
  propagate each open-coded is now one shared `message-identity` helper, so the
  "PMMID first, then trafficking reads it via utm_cd26" ordering exists in one
  place instead of five.
- A cascade writes one audit row per affected card (each keeps its own history)
  but a single SSE broadcast — 120 rewritten cards no longer mean 120 refetch
  signals. `writeAudit` takes a `silent` flag for this.

## [6.29.0] — 2026-08-30

### Added
- **Batch asset upload with a real table.** The Assets Upload button now opens a
  full-size overlay: one row per file with a thumbnail, and above the rows a
  "set for all" header row — type brand / product / type / keywords once, hit
  Apply (or Enter), then override any single row. Filenames still pre-fill the
  fields through the parsing rules, product and type offer the values already in
  use, and Save commits every row. Files can be dropped onto the dialog itself
  to add more.

### Changed
- Dropping files on the Assets grid opens that dialog instead of the floating
  queue panel, so drag-drop and the Upload button lead to the same place. The
  single-file "Upload asset" dialog is gone from Assets (Creative Library keeps
  it). The queue state machine moved into a `useUploadQueue` hook shared by both
  presentations.

### Fixed
- **A file dropped anywhere outside a drop target no longer navigates the app
  away.** The browser's default is to open the file, which is what happened when
  files were dropped on the upload dialog (the modal covered the grid's drop
  target). The shell now cancels stray drops document-wide.

## [6.28.2] — 2026-08-29

### Fixed
- **Edit-mode MC selection was invisible in dark mode.** The selection ring is
  `ring-slate-900`, and unlike the rest of the slate-900 family it had no dark
  remap — a near-black ring on a near-black cell. It now flips to
  `--text-primary` in dark, which also fixes the creative-library tile selection
  ring and the library drop-target rings.

## [6.28.1] — 2026-08-29

### Changed
- The header dialog's Delete moved to the far left of the action row, away from
  Close, and is now a small grey icon-link instead of a red button — a
  destructive action should not sit under the cursor's path to Close, and the
  smaller hit area makes a stray click less likely.

## [6.28.0] — 2026-08-29

### Added
- **Delete an audience or topic straight from the matrix header dialog.** A
  Delete button sits next to the Autosave toggle. It refuses while any messaging
  card of any status (archived included) is still attached, and says which ones:
  the warning lists each blocker as `MC<number><variant> — name — status` and
  offers only Cancel. With no cards attached it asks for confirmation first, then
  hard-deletes. Channel-derived rows on the nonDCO axis have no Delete button —
  they are not audiences and cannot be removed through that route.

### Changed
- The `in_use` refusal from `/api/{topics,audiences}/[id]/hard-delete` now
  returns `referencedBy` as MC objects (`id`, `number`, `variant`, `status`,
  `name`) instead of bare ids, so the UI can name what blocks the delete.
- **The unnumbered `Tag` field is gone from the topic dialog.** Tag 1–4 are the
  fields that feed the generated key; the legacy `tag` column stays in the
  database and on the Topics grid, it is simply no longer offered in the matrix
  form where it read as a fifth, key-less tag.

### Fixed
- **`generateAudienceKey()` had the topic bug from 6.27.4.** A pattern that
  collapses to bare separators now falls back to `aud{N}`, and a generated key
  that is already taken is suffixed instead of failing the insert.
- The matrix header dialog resolves audience rows by id **and** channel. Channel
  rows are merged into the audience axis carrying ids from their own table, so
  an id alone could match the wrong row.

## [6.27.4] — 2026-08-29

### Fixed
- **Adding a topic 500'd.** Erste's `topicKey` pattern
  (`{{product}}_{{tag1}}_…`) evaluates to `____` while a brand-new topic still
  has every field empty, and the "pattern produced nothing" fallback only fired
  on a strictly empty result — so every new topic tried to insert the same key
  and hit the `(client_id, key)` unique index. A separator-only result now counts
  as empty and falls back to `top{N}`, and a generated key that is already taken
  is suffixed (`_1`, the existing duplicate convention) instead of failing the
  insert — which also closes the same crash for two topics sharing product/tags.
- **Editing a topic's tag closed the detail dialog.** The matrix tracked the open
  header dialog by `key`, but saving product/tag1–4 regenerates that key
  server-side, so the post-save refetch could no longer find the row and the
  dialog unmounted mid-edit. The dialog is now keyed by `id`. Audience headers
  were affected the same way and are fixed by the same change.

## [6.27.3] — 2026-08-25

### Changed
- **Two more buttons follow the dark-conform primary style:** the Feed "Preview
  & Export" button and the sidebar theme-switcher's active pill now use the
  invert-in-dark `bg-slate-900` treatment (dark in light, white in dark) instead
  of the brand-blue that didn't adapt. The Feed export gated-warning box also
  gets dark-mode amber variants.

## [6.27.2] — 2026-08-25

### Fixed
- **The Creative Library console 404 flood is gone.** Preview iframes were
  requesting `main.css`, `dynamic.content.js` and `empty.png` from the site root
  and 404ing, because a root-relative `<base href>` doesn't resolve inside a
  `srcDoc` iframe (the browser falls back to the parent origin's root). Two
  fixes: the injected base is now **absolute** (origin from the request, nginx
  forwarded headers aware), so template assets resolve to
  `/api/templates/<name>/…` and load; and the redundant `<link rel=stylesheet>`
  tags for CSS we already inline are stripped (they re-fetched the same CSS and
  were the most-repeated 404). These 404s were always there — 6.27.0's
  `quietConsole` just stopped burying them under the template's own logs.

## [6.27.1] — 2026-08-25

### Fixed
- **More dark-mode polish:** the matrix "Download XLSX" button (Matrix Export
  panel) now inverts to white in dark like the other primary buttons; dark-mode
  scrollbars are themed so the white square where the matrix grid's scrollbars
  meet is gone; Creative Library masonry tiles get a dark backing so the rounded
  corners no longer show a white matte.
- **Dialog backdrop is neutral, not bluish** — was a blue-tinted `slate-900/40`;
  now a neutral `black/30` behind the same blur, so it doesn't clash with the
  dialog's grey.
- **The MC editor remembers the preview background** (light / checker / dark)
  across opens via `mm6_preview_bg` — it no longer snaps back to white every
  time.

## [6.27.0] — 2026-08-25

### Fixed
- **CRITICAL: the matrix no longer crashes the whole app when a filter matches
  zero rows/columns.** A `t:`/`a:`/`p:`/`s:`/`mc:` filter that pruned an axis to
  empty hit a React "rendered fewer hooks" crash (two `useRef`s sat below the
  empty-axis early return, added in 6.24.0) that white-screened the entire app.
  The refs now sit above the return. (Bug hunt Finding 1)
- **Dark mode gaps closed:** the DCO/nonDCO toggle, the MC-editor tab row, the
  audience/topic property panels, and the feed-export warning/success boxes now
  adapt to dark mode. The feed "Build & Download XLSX" button inverts to white
  in dark like the Creative Library upload button. The sidebar version is grey
  (was a bluish `slate-400`) and the switcher/version sit above the user block
  with no divider line.
- **"N MCs missing previews" badge counts distinct MC labels**, not message
  rows — a single MC spans many rows (one per audience), so the count was
  massively inflated. (Bug hunt Finding 6)

### Added
- **Route-level error boundary** (`(app)/error.tsx`): a render crash on a page
  now keeps the sidebar/shell alive and offers Try-again / Reload instead of a
  blank screen. (Bug hunt Finding 2)
- **ESLint is wired up** (flat config, `react-hooks/rules-of-hooks` at error) —
  the static rule that catches the Finding 1 crash pattern. `npm run lint` runs
  it; the build enforces it. (Bug hunt Finding 3)
- **Grid previews silence the ad template's own console logging.** Creative
  Library tiles pass `quietConsole`, so the ~40-50 debug lines each banner
  prints no longer flood the parent DevTools console (~2400/page). warn/error
  stay; the editor + share gallery keep full logs. (Bug hunt Finding 4)

## [6.26.0] — 2026-08-25

### Added
- **Concentric-circle reveal when switching theme.** Toggling light/dark now
  freezes the page and paints the new theme under a circle that grows from the
  exact point you clicked out to the whole viewport (~0.5s), via the View
  Transitions API. Skipped under `prefers-reduced-motion`, and on browsers
  without the API the theme just flips instantly.

### Changed
- **Sidebar theme toggle + version moved above the user block** (was below Sign
  out); they now sit just above `admin@local`.
- **Sidebar version is a neutral grey again** — it was `text-slate-400`, which
  (unlike the other muted labels at `slate-500`) isn't remapped in dark mode, so
  it kept a bluish tint. Now `text-slate-500`, matching every other muted label.

## [6.25.0] — 2026-08-25

### Added
- **Light/dark theme toggle in the sidebar footer** (adopted from ConfAI2's
  placement). Expanded: a two-position Sun/Moon pill with the version beside it;
  collapsed: a round icon button with the version rotated vertically above it.
  It flips the `.dark` class and writes `localStorage.mm6_theme` per browser —
  instant, no server round-trip.

### Changed
- **The theme (colour-mode) switcher moved out of Settings › Design into the
  sidebar**, and the "System" option was dropped (light/dark only). Design saves
  no longer touch the colour mode, so changing brand colours can't flip your
  theme. The version number also moved from the nav into the fixed sidebar
  footer.
- **Matrix hover crosshair is now a neutral grey** (was blue) — a mid grey in
  light mode, a light grey in dark, clearly darker/lighter than the faint
  gridlines. Single `--mx-cross` token.
- **Dense-view dot clusters are vertically centred** in the row height instead
  of top-aligned, so a cell with one or two dots lines up with its neighbours.

## [6.24.0] — 2026-08-25

### Added
- **Subtle hover crosshair on the matrix.** Hovering a cell now tints the
  border-lines that bound its column (left + right) and its row (top + bottom),
  all the way up/left to the column and row headers, so you can trace which two
  headers a distant cell belongs to. Hovering a header alone lights just that
  one column or row. It works in edit mode too. Only existing border colours
  change (no layout shift) and they fade with a 140 ms transition, so nothing
  flickers. Colour is a single `--mx-cross` token. (M4.1)

### Changed
- **Matrix cells now share one uniform background** whether empty or filled —
  the old empty-cell tint (`bg-slate-50/50` / dark `white/[0.03]`) is gone, so
  every cell sits on the same `bg-surface` base. This is the clean canvas the M1
  "Color by" band will sit on. The `matrix-grid__cell--has-messages` class stays
  as a semantic hook (it has no CSS of its own); edit-mode drop-target rings are
  unchanged. (M3)

## [6.23.1] — 2026-08-25

### Fixed
- **The audience strategy/platform colour strip now sits on the right edge when
  audiences are rows (transposed view), not the bottom.** It was always a
  bottom border, so in the rows-as-audiences layout the strip ran along the
  bottom of the label instead of against the cells. Added right-edge CSS
  variants; `audienceEdgeClasses` picks bottom (audiences as columns) or right
  (audiences as rows).

## [6.23.0] — 2026-08-25

### Added
- **"Hide inactive" checkbox in the matrix corner cell.** The top-left corner
  (next to the transpose toggle) now carries a `Hide inactive` checkbox that
  drops every `INACTIVE` audience column and topic row from the grid on both
  axes. It never hides an MC — only the dimension headers — and is independent
  of the archive toggle. The choice persists in `mm6_matrix_state_v1`.
- **Drag-and-drop reordering of matrix rows and columns in edit mode.** An
  always-visible grip appears (only in edit mode) on the left edge of each row
  header and along the bottom of each column header, above the strategy/platform
  colour border, in every density. Dragging one header onto another persists the
  new order into the existing `orderIndex`. New `POST /api/audiences/reorder` and
  `POST /api/topics/reorder` (both `withSession` + `denyDemo`, audited). The
  reorder permutes the dragged group only within the `orderIndex` slots it
  already occupies, so reordering the visible DCO subset never interleaves it
  with the hidden nonDCO audiences.

### Known limitation
- nonDCO **topic rows** are synthesized from creative names on the fly (no stored
  `orderIndex` since 6.18.0), so they carry no reorder grip. Persisting their
  order needs a dedicated overlay table — deferred to a follow-up (M11 Phase 2).

## [6.22.2] — 2026-08-18

### Fixed
- **Stepping to another card mid-save no longer copies that card's content onto
  the one you left.** A save resolves asynchronously — with global edit on it
  writes every audience copy and can take seconds — and its response rebased the
  editor's snapshot unconditionally. Navigating prev/next while one was in
  flight left the snapshot on the *previous* card while the draft already held
  the new one, so the next autosave diffed the two and wrote the new card's
  entire content (texts, images, styling, trafficking) onto the previous card's
  row and all of its audience copies. The snapshot now only rebases while the
  editor is still on the row that save targeted, and a version conflict on a row
  already navigated away from no longer blocks the card now open. This destroyed
  MC301c's content on 2026-08-17; it has been restored from the audit log.
- **A global edit no longer crosses the DCO/nonDCO axis.** Numbering has been
  axis-scoped since 6.17.0 — a DCO card may share its number with its static
  nonDCO twin — but the fan-out still matched on `(number, variant)` alone, so
  editing one overwrote the other. `findSiblings` and `propagateToSiblings` are
  now axis-scoped, and the editor's "updates N other audiences" count matches
  what actually gets written. 31 `(number, variant)` pairs across 20 MC numbers
  currently live on both axes.

## [6.22.1] — 2026-08-18

### Fixed
- **The removal dialog no longer reads as if it deleted the card.** It said
  "Remove 4 Messaging Cards" and listed MC290a four times, when the selection is
  really four *audience copies* of one card. It now counts per card — "MC290a ·
  4 of 32 audience copies" — and flags with a `LAST COPY` badge plus a red note
  the groups whose last copy is in the selection, which is the only case where a
  permanent delete takes the card's content (texts, images, trafficking) with
  it. Copy counts come from the full message list, so a copy hidden by the
  current filter still counts as keeping the card alive.

## [6.22.0] — 2026-08-17

### Added
- **Bulk removal in the matrix edit mode — archive *or* delete.** The Delete
  button in the edit-mode panel was a disabled "coming in v2" placeholder; it
  now opens a chooser for the selection: **Archive** (soft, `archived_at`,
  restorable via Show archived) or **Delete permanently** (the rows are gone —
  so throwaway PREVIEW copies no longer silt up the archive). New
  `POST /api/messages/bulk-delete` (`mode: archive | purge`) backed by
  `archiveMessages()` / `deleteMessages()`, both all-or-nothing and version-
  checked like the bulk copy/move ops.
- Two named guards on the hard delete: a **measurement-locked row**
  (ACTIVE/INACTIVE/ARCHIVED — the same set that already blocks a move) can only
  be archived, since its PMMID still anchors reporting joins; and deleting the
  **last card carrying a (number, variant)** is refused while creatives back-link
  it (`creatives.mc_number` is a plain column, not an FK, so it would dangle).
  The dialog greys out Delete and names the blocking rows before the request.
- Hard delete writes a **per-row audit entry with the full before-state** — after
  the row is gone the audit log is the only record of what the card was.

### Fixed
- **nonDCO MC numbers are deterministic again — the axis no longer climbs into
  the 800s.** `scripts/rebuild-creatives.ts` took the MC number from the
  filename and fell back to `max(number) + 1` for every file still named `MC0`.
  That fallback ran *after* the product's own rows were deleted, so each rebuild
  re-drew ~300 cards from above the global max and the nonDCO axis drifted
  upward on every run (last state: 333–837). The number now comes from the
  filename, or — for `MC0` files — from the `suggested_mc_number` column of
  `static_creatives_export.csv`. The plan is computed over all products at once
  and is a pure function of the folder + CSV, so a re-run reproduces it exactly;
  a file with neither source aborts the script instead of inventing a number.
  Where the CSV suggested a number another product's filename already claimed
  (324–332), the filename wins and the losing group is re-allocated above the
  top of the nonDCO space (`HITEL 324–329 → 389–394`, `MARKET 330–332 →
  395–397`).
- Erste rebuild result: **688 nonDCO messages / 232 numbers, range 2–397**
  (was 826 rows over 333–837), and `creatives.createdAt` re-backfilled from the
  export CSV's file dates.

### Changed
- Source filenames now carry the real MC number: the `MC0` token was substituted
  with the resolved number in all 1259 affected creatives, in both the Drive
  Leadas originals and the flat mirror the rebuild reads (mtimes preserved). The
  DB followed in place — `uploaded_files.filename`, `creatives.fileName`,
  `messages.image1` and `messages.name` — no re-upload needed, since
  `storage_path` is content-addressed, not name-derived. A dry-run of the
  rebuild now reports `from filename: 3145 · from CSV suggestion: 0` and
  reproduces the same 688 messages over 2–397, which is the self-check that the
  filenames and the DB agree.
- `loadSuggestedNumbers` tolerates a CRLF export — a stray `\r` on the last
  column used to hide `suggested_mc_number` and abort the run.
- `mc_create`'s `mc_number: 'new'` description and the `numbering.ts` comments
  now say what the code has done since 6.20.0: the fresh number is the max + 1
  **on the target audience's axis**, not the global max.

## [6.21.0] — 2026-08-17

Channels-entity epic, part 2 of 2 (S4–S6). Channels are now a first-class
entity, separate from audiences. **Ships with schema migration 0007 + a one-time
data migration — deploy migrate+code in one pass.**

### Added
- **`channels` table + Settings › Channels tab.** nonDCO channels (the nonDCO
  matrix columns) live in their own table `(key, code, label, orderIndex,
  archivedAt)` with full CRUD (`/api/channels`, `/api/channels/[id]`). The new
  Settings tab manages the list — add, rename label, archive/restore. nonDCO
  MCs are still minted only via creative upload.
- **`scripts/migrate-channels.ts`** — one-time move of legacy
  `audiences.channel != null` rows into `channels`, then deletes them from
  audiences (nonDCO messages keep their `audience = "ch_disp"` key and resolve
  through the channels table). Idempotent; also seeds the 6 canonical channels.

### Changed
- **Channels no longer pollute the audiences list.** After migration the
  audiences page is DCO-only. Channel keys still resolve everywhere — numbering,
  pmmid/trafficking, and matrix columns — because `findAudienceByKey` falls back
  to the channels table (presented in Audience shape via `channelToAudience`),
  and the matrix merges channels into its audience list. Creative promotion
  resolves the channel via `findChannelByCode`.

### Removed
- **`scripts/seed-channel-audiences.ts` is retired** (now a deprecation shim
  pointing to `migrate-channels.ts`) — seeding channel-audiences would re-dirty
  the audiences list.

## [6.20.0] — 2026-08-17

Channels-entity epic, part 1 of 2 (the low-risk, no-migration slices S1–S3).

### Added
- **Per-client default template for new DCO MCs.** The Templates page has a
  "Set default" star that marks one template (config key `defaultTemplate`).
  New DCO MCs (real matrix audience) inherit it automatically at create time;
  nonDCO/channel placements stay image-based (no template). Read via
  `readDefaultTemplate` (`templates.ts`), applied in `createMessage`.

### Changed
- **New MCs default to `INCOMING` status.** `createMessage` now sets
  `status: input.status ?? "INCOMING"`, covering the matrix create dialog, MCP
  `mc_create`/`mc_create_batch`, and creative/draft promotion. copy/move keep
  cloning the source status.
- **The nonDCO matrix axis has no edit mode.** Add-MC, add-audience/add-topic,
  and duplicate affordances are gone on the nonDCO axis, and the Edit-mode panel
  is replaced by an info box ("nonDCO MCs are created automatically when you
  upload correctly-named creatives to the Creative Library"). nonDCO MCs are
  minted only by creative upload. `editApi.editMode` is forced off on that axis
  (`MatrixGrid.tsx`, new `matrix-nondco-info` block).

## [6.19.0] — 2026-08-17

### Changed
- **Global edit: status and flight dates are now variant-level, not
  number-level.** Setting a status (or start/end date) on `MC331c` with global
  edit on now fans out only to the other audience copies of `MC331c` — the other
  variants (`MC331a`, `MC331b`) are left untouched. Previously status/dates were
  campaign-level and crossed every variant of the number, so `a` and `b` flipped
  together with `c`. `NUMBER_LEVEL_FIELDS` is now empty; all shared fields
  propagate at the same (number, variant) grain as creative fields
  (`messages.ts`, editor tooltips updated). Reverses the 2026-08-14 two-tier
  decision.

### Fixed
- **Sibling status dots refresh instantly after a global-edit save.** The
  `PATCH /api/messages/[id]?propagate=siblings` response now returns the updated
  sibling rows, and the editor patches them straight into the grid cache instead
  of triggering a full `/api/messages` refetch. The other audiences' status dots
  no longer lag several seconds behind the edited cell (`messages/[id]/route.ts`,
  `MessageEditor.tsx`). Cross-tab sync still flows over the SSE broadcast.

## [6.18.0] — 2026-08-17

### Changed
- **nonDCO matrix topic rows are synthesized on the fly, not stored.** The DCO
  `topics` table is reserved for curated DCO topics again; the nonDCO axis now
  derives its row headers directly from the creative-backed messages (each
  message's `topic` = the creative-name keyword, product from the `<PRODUCT>_`
  prefix). `rebuild-creatives.ts` no longer creates a topics row per creative
  keyword — it carries the topic string on the message only. The ~322
  image-derived topics were removed from the table (`MatrixGrid.tsx`).

### Changed
- **MC numbering is now axis-scoped (DCO vs nonDCO).** The "a number never spans
  topics" invariant is enforced only within the target audience's own axis
  (DCO = `audiences.channel IS NULL`, nonDCO = channel set). A DCO MC and its
  static nonDCO twin may therefore share the same MC number in different topics,
  while within either axis a number still maps to a single topic
  (`createMessage`). Two new tests cover the cross-axis pairing and the
  within-axis rejection.

### Fixed
- **`rebuild-creatives.ts` preserves filename MC numbers for DCO-paired
  creatives.** nonDCO messages are now direct-inserted (pmmid + trafficking via
  the real generators) so a creative keeps its filename number even when a DCO
  card already holds it, and a number can carry different variants across channel
  cells. The script is also idempotent — it drops a product's existing nonDCO
  messages before regenerating.

### Added
- **nonDCO static-MC preview size switcher.** The template-less creative
  preview now lists the creative's real stored sizes (all `creatives` rows
  sharing the MC number+variant) in the size dropdown; switching a size shows
  that size's file. Backed by a new scoped route `GET /api/creatives/by-mc?
  number=&variant=` and `listCreativesByMc`. The preview box matches the
  Creative Library dialog — checker background by default, background toggle,
  no template/animation controls (`MessageEditor.tsx`, `PreviewPane.tsx`).

## [6.15.2] — 2026-08-17

### Fixed
- **nonDCO static-image MC preview showed template controls.** For a
  template-less creative MC the preview toolbar rendered the DCO size dropdown
  (300x250 / 300x600 / …), Skip-animation and Image-preview toggles — all
  meaningless for a static image. In static mode the toolbar now shows only the
  creative filename + background toggle, and the viewport is a plain
  Creative-Library-style image box (`PreviewPane.tsx`).

### Changed
- **`rebuild-creatives.ts` sets `product` on generated nonDCO topics.** Without
  it the auto-created topics had `product = NULL`, so selecting the product in
  the matrix filter dropped every nonDCO row. (The already-generated LTP topics
  were back-filled directly.)

### Fixed
- **nonDCO matrix vanished when a product was selected.** The 6 nonDCO channel
  audiences (`ch_disp`…`ch_yt`) carry `product = NULL` (they are shared,
  product-agnostic channel columns), so the product filter pruned all of them
  and left the grid empty. The product filter now narrows only the topic (row)
  axis in nonDCO mode; the channel columns always stay, matching DCO where each
  audience does carry a product (`MatrixGrid.tsx`).

## [6.15.0] — 2026-08-17

### Added
- **Quick-select links in filter dropdowns.** New opt-in `quickSelect` prop on
  `MultiPill` renders a small grey link row above the checkbox list. The Status
  pills (matrix toolbar + audiences/topics/texts grids) get `Select all / none`.
  The creative-library Size pill gets `default / social / iab / none`:
  `default` = 300x250 + 1080x1080, `social` = 1080x1080 + 1200x628, `iab` =
  300x250 + 300x600 + 640x360 + 970x250, `none` flips the whole list between
  all-selected and cleared. Named presets toggle only their own sizes, so
  `social` and `iab` stack instead of replacing each other; presets naming
  sizes absent from the library are hidden rather than rendered inert.
- **Edit-mode hint in the matrix side panel.** One grey line above the
  Enter/Exit button naming what the mode unlocks (add/duplicate topics and
  audiences, add/copy/move Messaging Cards) — the add and duplicate
  affordances only exist inside edit mode, which was not discoverable.

## [6.14.0] — 2026-08-16

### Changed
- **Text-formatting rules now require an exact field-value match.** Rendering
  previously replaced any substring occurrence of `text_original` anywhere in
  the banner HTML, so a rule created on a shorter copy could silently inject
  its formatting (e.g. `<br>`s) into longer texts that merely contained it —
  invisible in the editor, which only lists rules matching the whole field
  value. Rules now apply at placeholder resolution and only when
  `text_original` equals the entire resolved value; size-scoped rules win over
  universal ones (same precedence as feed-export spans). Feed export was
  already exact-match and is unchanged.

## [6.13.1] — 2026-08-15

### Changed
- **Audience-header platform colors separated.** The two edge colors were too
  close on screen: AdForm is now bright teal `#03c9ab`, DV360 grass green
  `#43970b`.

## [6.13.0] — 2026-08-15

### Changed
- **Global edit: status + flight dates now propagate NUMBER-wide.** With global
  edit on, `status`, `startDate` and `endDate` sync to every live row of the
  MC number — all variants included — while creative fields (headline, copies,
  images, styles, template) keep propagating only to the audience copies of
  the same variant. Other-variant rows receive no trafficking rewrite. Editor
  tooltips updated to describe the two tiers.

### Added
- **`--text-disabled` design token** (light `#cccccc` / dark `#4d4d4d`,
  Tailwind `text-text-disabled`) — one step paler than tertiary; the INACTIVE
  matrix-header marking now uses it.
- **Strategy/platform edge on audience headers.** Bottom border on matrix
  audience headers: width encodes strategy (prospecting 3px / remarketing
  5px), color the buying platform (DV360 dark green / AdForm teal). Channel
  (nonDCO) audiences stay plain; works in both grid orientations.

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
