# Changelog

All notable changes to MessagingMatrix v6 are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

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
