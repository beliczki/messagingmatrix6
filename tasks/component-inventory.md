# MessagingMatrix v6 — Component Inventory & Naming

> **Scope.** Minden képernyő minden azonosítható UI egysége + a kereszt-screen újrahasznosítható elemek listája. Minden egységhez egy javasolt **emberileg olvasható BEM-szerű név**. Ezek lesznek a kapaszkodók egy következő fázisban a CSS-extraction / design-system munkához.
>
> **Tailwind érintetlen marad.** A class-okat *mellé* tesszük, nem helyette. Pl. egy gomb így nézhet ki később:
> ```tsx
> <button className="toolbar-btn flex items-center gap-1.5 rounded-md ...">
> ```
>
> **Naming convention.**
> - **Block:** kebab-case főnév (`matrix-grid`, `message-editor`, `right-toolbar`)
> - **Element:** `block__element` (`matrix-grid__cell`, `right-toolbar__toggle`)
> - **Modifier / state:** `block--state` vagy `block__element--state` (`right-toolbar--collapsed`, `tab-bar__tab--active`)
> - **Page root** = a screen szemantikus neve, prefix nélkül (`matrix`, `creative-library`, `assets-library`, `template-editor`, `login`, `monitoring`, `users`, `settings`)
> - **Globalisok prefix nélkül** (pl. `multi-pill`, `input-box`, `toolbar`)

> **Resolved döntések (2026-04-26):**
> 1. ❌ `page-` prefix nem kell — page root = screen neve
> 2. ✅ `creative-tile` + `asset-tile` egyesítve → `media-tile`
> 3. ✅ `toolbar` a globalis név (nem `page-toolbar`)
> 4. ✅ Templates editor headerje **külön** speckó név (`template-editor__header`), nem `toolbar`
> 5. ✅ `custom-dropdown` most felkerül minden `<select>`-re
> 6. ✅ Status color modifierek (`status-dot--incoming` stb.) NEM most — Phase 7 settings/design-system fázisra marad. Most csak alap `status-dot` / `status-badge` class.

---

## 0. Globalis / újrahasznosítható elemek

Ezek minden képernyőn ismétlődnek. **Ezeknek lesz a legtöbb haszna ha külön CSS-be kerülnek** — a többi class egyelőre csak hook a kódban.

| Globalis név | Mit takar | Jelenleg hol | Megjegyzés |
|---|---|---|---|
| `app-shell` | Root flex container (sidebar + main + right-toolbar) | `(app)/layout.tsx` | – |
| `app-sidebar` | Bal oldali fix navigation | `_components/Sidebar.tsx` | – |
| `app-sidebar__nav-link` | Egy nav link a sidebarban | Sidebar.tsx ~66–86 | – |
| `app-sidebar__user-profile` | Profil + logout footer | Sidebar.tsx alja | – |
| `right-toolbar` | Jobb oldali kollabálható panel | `_components/RightToolbar.tsx` | shared |
| `right-toolbar--collapsed` / `--open` | Állapot modifier | RightToolbar.tsx | – |
| `right-toolbar__header` | Felső h-12 sáv (cím + toggle) | RightToolbar.tsx 54–66 | – |
| `right-toolbar__title` | "Toolbar" hardcoded label | RightToolbar.tsx 56 | – |
| `right-toolbar__toggle` | Pin-elt toggle gomb (PocketKnife) | RightToolbar.tsx 58–65 | – |
| `right-toolbar__body` | Scrollable belső region (title + content) | RightToolbar.tsx 67 | – |
| `right-toolbar__section-title` | Opcionális prop-driven szekció címke | RightToolbar.tsx 69–71 | – |
| `right-toolbar__content` | Children-render slot (collapsed-aware layout) | RightToolbar.tsx 73–80 | – |
| `toolbar` | Sticky top bar (search + filterek + akció gombok) | MatrixToolbar, CL toolbar, Assets toolbar | 3 helyen ismétlődő pattern |
| `toolbar__title` | Cím a toolbar bal oldalán | CL, Assets | – |
| `toolbar__filters` | Filter pill-ek konténere | mindenhol | – |
| `toolbar__actions` | Jobb oldali akció gombok (Clear, Upload, …) | mindenhol | – |
| `multi-pill` | Multi-select filter pill (badge + dropdown) | `_components/MultiPill.tsx` | shared, kontrolállt open state |
| `multi-pill__button` | A pill maga (label + count badge) | MultiPill.tsx 38–49 | – |
| `multi-pill__badge` | A számláló badge | MultiPill.tsx 44–48 | – |
| `multi-pill__menu` | Lefelé nyíló popover | MultiPill.tsx 50–74 | – |
| `multi-pill__option` | Egy checkbox + label sor | MultiPill.tsx 55–70 | – |
| `custom-dropdown` | Stílusozott `<select>` (státusz, méret, template, MC stepper) | sok helyen raw `<select>` Tailwind class-okkal | most felkerül mindenre |
| `input-box` | Text / search input wrapper (vagy maga az input ha nincs ikon) | mindenhol (search-ek, form input-ok, login) | – |
| `input-box--with-icon` | Wrapper modifier mikor bal-oldali ikon van | CL toolbar | – |
| `input-box__icon` | A bal-oldali ikon az input-box belsejében | – | – |
| `input-box__field` | A tényleges `<input>` elem a wrapper-ben | – | – |
| `toolbar__count` | Számláló a toolbar-ban (visible/total) | CL toolbar, Assets toolbar | – |
| `form-field` | Label + input wrapper | MessageEditor `Field` 610–626, CL `Field` 811–826, login | inline duplikátum, később hoisting |
| `form-field__label` | A felső label szöveg | – | – |
| `form-field__hint` | Optional helper text alul | MessageEditor Field | – |
| `form-grid` | 2-oszlopos form rács | MessageEditor minden tab, CreativeMetadataForm | – |
| `toolbar-btn` | Gomb ami toolbarban él (nem primary CTA) | minden toolbar | – |
| `toolbar-btn--primary` / `--danger` / `--icon-only` | Variánsok | – | – |
| `toggle-btn` | Pressed / unpressed gomb | MatrixGrid `ToggleBtn` 255–277, CL `ToggleBtn` 430–451 | inline duplikátum |
| `toggle-btn--active` | Aktív állapot | – | – |
| `toggle-group` | Flex row toggle-btn-ekből | MatrixGrid ViewControls, CL ViewControls, MessageEditor TemplateTab variant classes | – |
| `cycle-icon-btn` | Icon button ami opciókon körbeforog | `_components/CycleIconButton.tsx` | shared |
| `library-view-switcher` | Grid/List/Masonry kapcsoló, collapsed-aware (collapsed → cycle-icon-btn, expanded → labeled toggle group) | `_components/LibraryViewSwitcher.tsx` | shared (CL + Assets right toolbar) |
| `library-view-switcher__label` | "VIEW" felső caps címke expanded állapotban | LibraryViewSwitcher.tsx | – |
| `media-entity-dialog` | MC-editor-style detail dialog asset/creative-hez (stepper, autosave, draggable divider, preview bg toggle, archive/restore) | `_components/MediaEntityDialog.tsx` | shared, generic `<E,D>` |
| `media-entity-dialog--landscape` | Landscape layout flip (form fent, preview lent) | – | – |
| `media-entity-dialog__header` | Full-width modal header (stepper + autosave + close) | – | – |
| `media-entity-dialog__title-block` | Title + subtitle stack a header-ben | – | – |
| `media-entity-dialog__nav-prev` / `__nav-next` / `__nav-counter` | Stepper bal/jobb chevron + N/M számláló | – | szemantikailag `nav-stepper` réteg fölött |
| `media-entity-dialog__autosave-toggle` | Autosave checkbox + label (slate-900 active) | – | – |
| `media-entity-dialog__modified-tag` | "modified" amber tag manual-mode + dirty | – | – |
| `media-entity-dialog__body` | Pane container (row/col landscape-tól függően) | – | – |
| `media-entity-dialog__pane--form` / `__pane--preview` | Bal/jobb (vagy fent/lent) pane | – | – |
| `media-entity-dialog__form-content` | Scrollable belső a form pane-ben | – | – |
| `media-entity-dialog__file-info` | Read-only fájl-metadata `<dl>` a form alján | – | – |
| `media-entity-dialog__preview-toolbar` | Preview pane toolbar (light/checker/dark) | – | – |
| `media-entity-dialog__preview-viewport` | Centered scaling container, bg-style toggle-tól függően | – | – |
| `bg-toggle` | Segmented light/checker/dark group | MediaEntityDialog + PreviewPane | hasonló pattern, külön block-ok |
| `bg-toggle__btn` / `bg-toggle__btn--active` | Egy bg gomb | – | – |
| `scaled-preview` | Natural-size-vagy-scale-down media preview ResizeObserver-rel | `_components/ScaledMediaPreview.tsx` | shared (MediaEntityDialog body) |
| `save-indicator` / `--saving` / `--saved` / `--conflict` / `--error` | Save status pill MessageEditor + MediaEntityDialog header-ben | MessageEditor SaveIndicator + MediaEntityDialog SaveIndicator | inline duplikátum, ugyanaz a Phase-7 design |
| `preview-pane` | Live preview konténer (toolbar + iframe) | `_components/PreviewPane.tsx` | shared (MC editor + Templates) |
| `preview-pane__toolbar` | Header toolbar (size + skip-anim + bg + extras) | PreviewPane.tsx 61–121 | – |
| `preview-pane__size-select` | Size `<select>` | PreviewPane.tsx 63–74 | + `custom-dropdown` globalis |
| `preview-pane__skip-anim` | Skip-animation toggle button | PreviewPane.tsx 75–96 | – |
| `preview-pane__skip-anim--active` | Aktív (skipAnim=true) | – | – |
| `preview-pane__bg-group` | Rounded segmented container 3 bg btn-nek | PreviewPane.tsx 99–109 | – |
| `preview-pane__bg-btn` | Egy bg toggle (sun/grid/moon) | PreviewPane.tsx 133–158 | – |
| `preview-pane__bg-btn--active` | Aktív bg modifier | – | – |
| `preview-pane__refresh` | Opcionális refresh gomb | PreviewPane.tsx 110–118 | – |
| `preview-pane__viewport` | Scrollable scaling container ahol az iframe él | PreviewPane.tsx 122–128 | – |
| `preview-pane__iframe` | Skálázott iframe | PreviewPane.tsx 177–215 | – |
| `upload-dialog` | Single-file upload modal (belül `modal` is) | `_components/UploadDialog.tsx` | shared |
| `upload-dialog--picking` / `--uploading` / `--metadata` / `--saving` / `--done` | Phase modifier (a block-on) | UploadDialog.tsx | – |
| `upload-dialog__title` | "Upload {category}" h2 | UploadDialog.tsx 121 | – |
| `upload-dialog__dropzone` | Dashed-border kattintható upload terület | UploadDialog.tsx 136–152 | – |
| `upload-queue` | Fixed bottom-right multi-file queue panel | `_components/UploadQueue.tsx` | shared |
| `upload-queue--open` / `--collapsed` | Open/collapsed modifier | UploadQueue.tsx | – |
| `upload-queue__header` | Felső klikkelhető fejléc (title + count + actions) | UploadQueue.tsx 194–238 | – |
| `upload-queue__title` | "Upload queue" label | UploadQueue.tsx 198–200 | – |
| `upload-queue__count` | "N/M done" számláló | UploadQueue.tsx 201–204 | – |
| `upload-queue__items` | Belső scrollable list | UploadQueue.tsx 240 | – |
| `upload-queue__item` | Egy queue sor | UploadQueue.tsx 275 | – |
| `upload-queue__item--queued` / `--uploading` / `--metadata` / `--saving` / `--done` / `--error` | Status modifier | – | – |
| `upload-queue__item-name` | Filename | UploadQueue.tsx 278 | – |
| `upload-queue__item-discard` | Trash gomb | UploadQueue.tsx 284–290 | – |
| `drop-overlay` | Drag-over feedback overlay | CL 307–313, Assets, UploadQueue useDropTarget consumers | – |
| `masonry` | CSS-column masonry wrapper | `_components/Masonry.tsx` | shared |
| `masonry__item` | Egy masonry tile | Masonry.tsx | – |
| `media-tile` | Egységesített tile (creative + asset masonry) | CL/Assets `ImageTile` | tile most `<button>`, kattintásra detail dialog |
| `media-tile__thumb` | Thumbnail wrapper (csak ahol van keret) | – | – |
| `media-tile__image` | A kép vagy `<video>` maga | – | – |
| `media-tile__placeholder` | Kép helyett placeholder | – | – |
| `media-tile__meta` | Tile alatti metadata (opcionális — CL ImageTile-ban nincs) | – | – |
| `media-tile__filename` | Filename a meta-ban | – | – |
| `media-tile__tags` | Tag-chip-ek konténere | – | – |
| `creative-card` / `asset-card` | Grid-view card (`<button>` 2026-05-02-től, click-to-open dialog) | CL `Card`, Assets `Card` | hover archive overlay megszűnt |
| `creative-row` / `asset-row` | List-view row (`<button>` 2026-05-02-től) | CL `ListRow`, Assets `ListRow` | – |
| `thumb-checker` | 16px conic-gradient kockás minta áttetsző PNG/SVG mögé | mind a 6 thumb wrapperben + dialog viewport | global, `app/globals.css` |
| `status-dot` | Színes pötty (státusz / state) | FeedView, MessageEditor, TemplateEditor MC stepper | szín később (Phase 7) |
| `status-badge` | Pötty + szöveg pill | MessageEditor SaveIndicator 546–581, FeedView | szín később (Phase 7) |
| `empty-state` | Centered card "no data" üzenettel | MatrixGrid 279–298, CL 828–859, Assets, `_placeholder.tsx` | inline duplikátum |
| `empty-state__icon` | Felső ikon | – | – |
| `empty-state__title` | Cím | – | – |
| `empty-state__hint` | Másodlagos szöveg | – | – |
| `modal` | Generic fixed overlay modal | MessageEditor (slide-in), UploadDialog | – |
| `modal-backdrop` | Sötétített háttér overlay | MessageEditor, UploadDialog | – |
| `modal__header` | Sticky header sáv | MessageEditor 347–440, UploadDialog | – |
| `modal__body` | Scrollable belső | – | – |
| `modal__close` | X gomb | – | – |
| `tab-bar` | Vízszintes tab nav | MessageEditor 5 tab | – |
| `tab-bar__tab` | Egy tab gomb | MessageEditor `TabBtn` 583–608 | – |
| `tab-bar__tab--active` | Aktív tab | – | – |
| `nav-stepper` | "Prev / N / Next" navigátor | MessageEditor header, TemplateEditor MC stepper | inline duplikátum |
| `nav-stepper__btn` | Bal/jobb chevron gomb | – | – |
| `nav-stepper__counter` | "3 / 27" szöveg | – | – |
| `divider-handle` | Húzható elválasztó pane-ek között | MessageEditor + TemplateEditor | inline duplikátum, ugyanaz a logika |
| `divider-handle--horizontal` / `--vertical` | Orientáció | – | – |
| `tag-chip` | Kis színes pill (brand/product/template/size jelzők card-on) | CL `Card` meta footer | új globalis |
| `loading-spinner` | Forgó betöltő ikon | SaveIndicator, UploadDialog, render hooks | – |
| `error-alert` | Piros figyelmeztető doboz | login error, MessageEditor conflict, TemplateEditor save error | – |

---

## 1. App shell

**Fájl:** `src/app/(app)/layout.tsx` (+ `src/app/layout.tsx` root)

| Egység | Javasolt név | Hol |
|---|---|---|
| Root html/body wrapper | `app-shell` | `app/layout.tsx` |
| Sidebar + main konténer (flex row) | `app-shell__main` | `(app)/layout.tsx` |
| Main content area (sidebar és right-toolbar között) | `app-content` | `(app)/layout.tsx` |

### 1a. Sidebar — `_components/Sidebar.tsx` (111 sor)

| Egység | Javasolt név | Sor |
|---|---|---|
| Sidebar root | `app-sidebar` | 1–112 |
| Sidebar collapsed modifier | `app-sidebar--collapsed` | – |
| Logo + branding | `app-sidebar__brand` | felső |
| Logo SVG (mmatrix.svg, hamburger szerepben) | `app-sidebar__logo` | – |
| Client name (pl. "Erste") | `app-sidebar__client-name` | – |
| Nav lista wrapper | `app-sidebar__nav` | 66–86 körül |
| Nav link | `app-sidebar__nav-link` | – |
| Nav link aktív | `app-sidebar__nav-link--active` | – |
| Nav link ikon | `app-sidebar__nav-icon` | – |
| Nav link címke | `app-sidebar__nav-label` | – |
| Footer (user profile + logout) | `app-sidebar__footer` | alja |
| User név + email | `app-sidebar__user` | – |
| Logout gomb | `app-sidebar__logout` | – |

---

## 2. Login — `src/app/login/page.tsx` (133 sor)

| Egység | Javasolt név | Sor |
|---|---|---|
| Page root (centered, frosted bg) | `login` | 1– |
| Login card | `login__card` | 68–130 |
| Brand wrapper (logo + title + client name) | `login__brand` | 69–85 |
| Logo | `login__logo` | – |
| Cím | `login__title` | – |
| Client név (Erste / Telekom / …) | `login__client-name` | 80–84 |
| Form | `login__form` | – |
| Email field wrapper | `form-field` (globalis) | 88–100 |
| Email label | `form-field__label` | – |
| Email input | `input-box` | – |
| Password field wrapper | `form-field` | 102–114 |
| Password label | `form-field__label` | – |
| Password input | `input-box` | – |
| Hibaüzenet doboz | `error-alert` (globalis) | 116–120 |
| Submit gomb | `login__submit` + `toolbar-btn--primary` | 121–128 |

---

## 3. Matrix workspace

### 3a. MatrixGrid (host) — `matrix/MatrixGrid.tsx` (298 sor)

| Egység | Javasolt név | Sor |
|---|---|---|
| Page root (flex row: content + RightToolbar) | `matrix` | 1– |
| Content area | `matrix__content` | – |
| ViewControls (RightToolbar nyitva) | `matrix-view-controls` | 199–253 |
| ViewControls szekció (View / Density) | `matrix-view-controls__section` | – |
| ViewControls szekció címke ("View", "Density") | `matrix-view-controls__label` | – |
| Toggle button group | `toggle-group` (globalis) | – |
| ToggleBtn (inline) | `toggle-btn` (globalis) | 255–277 |
| EmptyState (no messages) | `empty-state` (globalis) + `matrix-empty-state` | 279–298 |
| Sample import command kód-doboz | `matrix-empty-state__hint` | – |

### 3b. MatrixToolbar — `matrix/MatrixToolbar.tsx` (69 sor)

| Egység | Javasolt név | Sor |
|---|---|---|
| Toolbar root (sticky) | `toolbar matrix-toolbar` | 20 |
| Brand wrapper (cím + count) | `matrix-toolbar__brand` | 21–27 |
| "Matrix" cím | `matrix-toolbar__title` | 22 |
| Message count szöveg ("12 of 27 · …") | `matrix-toolbar__count` | 23–26 |
| Search input | `input-box` (globalis, ikon nélkül itt) | 29–37 |
| Product MultiPill | `multi-pill` (globalis, root már megvan) | 39–44 |
| Status MultiPill | `multi-pill` (globalis) | 45–50 |
| Clear filters gomb | `toolbar-btn` (globalis) | 52–66 |

### 3c. GridView (matrix table) — `matrix/GridView.tsx` (197 sor)

| Egység | Javasolt név | Sor |
|---|---|---|
| Table wrapper (scrollable) | `matrix-grid` | 13–121 |
| Sticky thead | `matrix-grid__head` | 55–86 |
| Corner cell + transpose toggle gomb | `matrix-grid__corner` | – |
| Transpose toggle (`╲ ↔ ╱`) | `matrix-grid__transpose-btn` | – |
| Column header cell | `matrix-grid__col-header` | – |
| Column header címke (audience/topic name) | `matrix-grid__col-header-label` | – |
| Column header kulcs (alsó kis szöveg) | `matrix-grid__col-header-key` | – |
| Sticky bal oszlop (row header) | `matrix-grid__row-header` | 91–99 |
| Row header címke | `matrix-grid__row-header-label` | 95 |
| Row header kulcs | `matrix-grid__row-header-key` | 96–98 |
| Body row | `matrix-grid__row` | – |
| Cell (intersection) | `matrix-grid__cell` | 123–162 |
| Cell with messages modifier | `matrix-grid__cell--has-messages` | – |
| McChip (kompakt badge) | `mc-chip` | 164–197 |
| McChip density modifier (informative) | `mc-chip--informative` | – |
| McChip density modifier (minimal) | `mc-chip--minimal` | – |
| McChip színes pötty | `mc-chip__dot` (= `status-dot` globalis) | – |
| McChip "MC#" címke | `mc-chip__label` | – |

### 3d. FeedView (sortable list) — `matrix/FeedView.tsx` (215 sor)

| Egység | Javasolt név | Sor |
|---|---|---|
| Table wrapper | `matrix-feed` | 20–157 |
| Sticky thead | `matrix-feed__head` | 66–92 |
| Sortable column header (`Th`) | `matrix-feed__col-header` | 181–215 |
| Aktív col header | `matrix-feed__col-header--sorted` | – |
| Sort chevron ikon | `matrix-feed__sort-icon` | – |
| Body row | `matrix-feed__row` | – |
| Row hover/click modifier | `matrix-feed__row--clickable` | – |
| Status cell (színes pötty + szöveg) | `matrix-feed__status` (a pötty `status-dot`) | – |
| Cell wrapper | `matrix-feed__cell` | – |

### 3e. MessageEditor (slide-in modal) — `matrix/MessageEditor.tsx` (1062 sor) ⭐ legnagyobb

| Egység | Javasolt név | Sor |
|---|---|---|
| Fixed overlay backdrop | `modal-backdrop` (globalis) | 125– |
| Modal root | `message-editor modal` | 125–526 |
| Header full-width | `message-editor__header modal__header` | 347–440 |
| Prev / Next nav (stepper) | `nav-stepper` (globalis) | – |
| MC label ("MC1A v2") | `message-editor__mc-label` | – |
| Status badge | `status-badge` (globalis) | – |
| SaveIndicator (idle/saving/saved/conflict/error) | `save-indicator` | 546–581 |
| Autosave toggle | `message-editor__autosave-toggle` | – |
| Manual Save / Cancel gombok | `toolbar-btn--primary` / `toolbar-btn` | – |
| Close (X) gomb | `modal__close` | – |
| Tab bar | `tab-bar` (globalis) | – |
| Tab gomb (`TabBtn`) | `tab-bar__tab` | 583–608 |
| Aktív tab | `tab-bar__tab--active` | – |
| Tab content area | `message-editor__body` | – |
| Draggable divider | `divider-handle--vertical` / `--horizontal` (globalis) | – |
| Editor pane (form bal/lent) | `message-editor__pane--form` | – |
| Preview pane (`MessagePreview`) | `message-editor__pane--preview` (belül `preview-pane`) | 962–1048 |
| Pane order modifier wide aspect-ben | `message-editor--landscape` | – |
| **NamingTab** | `message-editor-tab message-editor-tab--naming` | 628–702 |
| Form (`form-grid` 2-col) | `form-grid` (globalis) | – |
| Field wrapper | `form-field` (globalis) | – |
| Read-only field | `form-field--readonly` | – |
| Status `<select>` | `custom-dropdown` (globalis) | – |
| **ContentTab** | `message-editor-tab--content` | 704–774 |
| Headline / copy textarea-k | `input-box` + `form-field` | – |
| **StylesTab** | `message-editor-tab--styles` | 776–825 |
| Style input rows (per-element CSS) | `form-field` | – |
| Custom CSS textarea | `input-box input-box--code` | – |
| **TraffickingTab** (read-only) | `message-editor-tab--trafficking` | 827–863 |
| **TemplateTab** | `message-editor-tab--template` | 865–959 |
| Template select | `custom-dropdown` | – |
| Variant classes button group | `toggle-group` | – |
| Variant classes input | `input-box` | – |

### 3f. RightToolbar contents on Matrix

A `RightToolbar` (globalis) `children`-ként kapja:
- **Open mód:** `matrix-view-controls` (3a fent)
- **Collapsed mód:** 2× `cycle-icon-btn` (View + Density)

---

## 4. Creative Library — `creative-library/CreativeLibrary.tsx` (860 sor)

| Egység | Javasolt név | Sor |
|---|---|---|
| Page root | `creative-library` | 1– |
| Toolbar | `toolbar creative-library__toolbar` | 453–533 |
| Cím | `toolbar__title` | – |
| Search box | `input-box input-box--with-icon` | 494–503 |
| Product / Type / Size MultiPill | `multi-pill` | – |
| Clear gomb | `toolbar-btn` | – |
| Upload gomb | `toolbar-btn--primary` | – |
| Scroll area (wrapping a grid/masonry/list) | `creative-library__scroll` | – |
| Drop overlay | `drop-overlay` (globalis) | 307–313 |
| **Masonry view** | `creative-library__view--masonry` (belül `masonry`) | 323–356 |
| Tile (masonry — `ImageTile`) | `media-tile` (globalis) | 593–627 |
| **Grid view** | `creative-library__view--grid` | – |
| Card | `creative-card` | 535–591 |
| Card thumbnail wrapper | `creative-card__thumb` | – |
| Card delete | `creative-card__delete-btn` | – |
| Card metadata footer | `creative-card__meta` | – |
| Meta — MC label | `creative-card__mc` | – |
| Meta — filename | `creative-card__filename` | – |
| Meta — tags (brand/product/template/size) | `creative-card__tags` + `tag-chip` (globalis) | – |
| **List view** | `creative-library__view--list` | – |
| ListRow | `creative-row` | 629–685 |
| ListRow thumbnail | `creative-row__thumb` | – |
| ListRow metadata (middle) | `creative-row__meta` | – |
| ListRow delete | `creative-row__delete-btn` | – |
| **EmptyState** | `empty-state` + `creative-library__empty` | 828–859 |
| Empty Upload gomb | `toolbar-btn--primary` | – |
| **UploadDialog** | `upload-dialog` (globalis) | 366–376 |
| **CreativeMetadataForm** | `creative-metadata-form` + belül `form-grid` | 687–772 |
| **QueueItemForm** | `upload-queue__item-form` + `form-grid` | 777–809 |
| **ViewControls** (right toolbar nyitva) | `creative-library-view-controls` | 400–428 |
| ToggleBtn (grid/list/masonry) | `toggle-btn` (globalis) | 430–451 |
| **Local `Field`** (form label wrapper, duplicate) | `form-field` (globalis) | 811–826 |

---

## 5. Assets Library — `assets/AssetsLibrary.tsx` (453 sor)

A Creative Library kistestvére, egyszerűbb metadata-val. Csak masonry view (nincs grid/list).

| Egység | Javasolt név |
|---|---|
| Page root | `assets-library` |
| Toolbar | `toolbar assets-library__toolbar` |
| Search box | `input-box input-box--with-icon` |
| Filterek (Product / Type) | `multi-pill` |
| Upload gomb | `toolbar-btn--primary` |
| Masonry view | `masonry` (globalis) |
| Tile | `media-tile` (globalis — egységesítve creative + asset) |
| UploadDialog | `upload-dialog` |
| EmptyState | `empty-state` + `assets-library__empty` |
| Drop overlay | `drop-overlay` |

---

## 6. Templates editor — `templates/TemplateEditor.tsx` (1181 sor) ⭐ legnagyobb

| Egység | Javasolt név |
|---|---|
| Page root | `template-editor` |
| Wide aspect modifier (preview top, editor bottom) | `template-editor--landscape` |
| **Header sáv (speckó, NEM `toolbar`)** | `template-editor__header` |
| Template selector `<select>` | `custom-dropdown template-editor__template-select` |
| New Template gomb | `toolbar-btn--primary` |
| **Files panel (slide-in left)** | `template-files-panel` |
| Files panel toggle (chevron, code header-ben) | `template-files-panel__toggle` |
| File tree item | `template-files-panel__file` |
| Aktív file | `template-files-panel__file--active` |
| Modified marker | `template-files-panel__file--dirty` |
| **Code editor pane** | `template-editor__code` |
| Code header (filename + Save + Cancel + Files toggle) | `template-editor__code-header` |
| Filename | `template-editor__code-filename` |
| Save / Cancel gombok | `toolbar-btn--primary` / `toolbar-btn` |
| Save indicator (modified/saving/saved/error) | `save-indicator` (globalis, már MC editorban is) |
| CodeMirror konténer | `template-editor__code-mirror` |
| **Preview pane** | `preview-pane` (globalis) |
| MC stepper a preview header jobb oldalán | `nav-stepper` (globalis) + színes pötty `<select>` `custom-dropdown` |
| Bindings panel toggle (preview header-ben) | `template-bindings-panel__toggle` |
| **Bindings panel (slide-in right)** | `template-bindings-panel` |
| Type filter chip-ek (Text/Image/Video/Link/Tag/Palette) | `template-bindings-panel__type-filter` + `toggle-btn` per chip |
| Placeholder card | `binding-card` |
| Binding name | `binding-card__name` |
| Resolved value (slate, italic amber default, halvány no-default) | `binding-card__value` |
| Value modifier — from message | `binding-card__value--resolved` |
| Value modifier — default | `binding-card__value--default` |
| Value modifier — missing | `binding-card__value--missing` |
| Unbound warning (`AlertTriangle`) | `binding-card__warning` |
| Type-color border (per placeholder type) | `binding-card--type-text` / `--type-image` / `--type-video` / `--type-link` / `--type-tag` / `--type-style` |
| **Draggable divider** (editor / preview között) | `divider-handle` (globalis) |

> **Class injection itt több commit-ra bomlik** (header / files panel / code editor / preview-area / bindings panel), hogy egyik se legyen óriási diff.

---

## 7. Placeholder pages

### 7a. Monitoring — `monitoring/page.tsx`

| Egység | Javasolt név |
|---|---|
| Page root | `monitoring` |
| Placeholder card | `empty-state monitoring__placeholder` |
| RightToolbar (üres) | `right-toolbar` (globalis, üres `children`) |

### 7b. Users — `users/page.tsx`

| Egység | Javasolt név |
|---|---|
| Page root | `users` |
| Placeholder | `empty-state` |

### 7c. Settings — `settings/page.tsx`

| Egység | Javasolt név |
|---|---|
| Page root | `settings` |
| Placeholder | `empty-state` |

### 7d. `_placeholder.tsx` (shared)

| Egység | Javasolt név |
|---|---|
| Card | `empty-state placeholder-card` |
| Title | `empty-state__title` |
| Phase label | `placeholder-card__phase` |
| Description | `empty-state__hint` |

---

## 8. Inline duplikátumok flag-elve (későbbi hoisting)

Ezeket NEM most refaktoráljuk, de jelölöm hogy ne felejtsük el:

| Inline komponens | Hányszor | Hol | Javasolt globalis név |
|---|---|---|---|
| `Field` (label + input wrapper) | 3× | MessageEditor 610–626, CreativeLibrary 811–826, login fields | `form-field` |
| `ToggleBtn` | 2× | MatrixGrid 255–277, CreativeLibrary 430–451 | `toggle-btn` |
| `EmptyState` | 3× | MatrixGrid 279–298, CreativeLibrary 828–859, Assets, `_placeholder.tsx` | `empty-state` |
| Draggable divider logic | 2× | MessageEditor + TemplateEditor | `divider-handle` (komponens + class) |
| Status dot+badge logic | 3× | FeedView, MessageEditor, TemplateEditor MC stepper | `status-dot` / `status-badge` |
| MC stepper (prev/next + colored-dot select) | 2× | MessageEditor header, TemplateEditor preview header | `nav-stepper` |
| `inputCls` constant | 1× | CreativeLibrary 774–775 | hardcoded Tailwind string → `input-box` |

---

## Mi következik

1. **Te jóváhagyod ezt a doc-ot** (vagy jelzed ha még valamit változtassak).
2. **Csak ezután** kezdek hozzá a `tasks/todo.md` C1–C15 lépéseknek, fájlonként, a véglegesített nevekkel.

---

## Változások 2026-05-02

**Új shared komponensek:**
- `_components/LibraryViewSwitcher.tsx` — Grid/List/Masonry toggle (collapsed-aware), CL + Assets right toolbar.
- `_components/MediaEntityDialog.tsx` — generic MC-editor-style detail dialog asset/creative-hez (stepper, autosave, draggable divider, preview bg toggle persisted, archive/restore).
- `_components/ScaledMediaPreview.tsx` — natural-size-vagy-scale-down media preview ResizeObserver-rel.
- `_components/usePersistent.ts` — lifted localStorage hook + `STRING_CODEC` / `SET_CODEC` (CreativeLibrary-ből).

**Új globalis class:**
- `.thumb-checker` (`app/globals.css`) — 16px conic-gradient kockás minta áttetsző PNG/SVG mögé.

**Új BEM block-ok:** `media-entity-dialog`, `scaled-preview`, `library-view-switcher`, `bg-toggle`, `creative-card`, `asset-card`, `creative-row`, `asset-row`.

**Megszűnt:**
- `_components/ArchiveOrRestoreBtn.tsx` — archive/restore most a detail dialog header-ben él, nem hover overlay-ként.
- `_components/EntityDetailDialog.tsx` (rövid életű előd) — `MediaEntityDialog` váltotta le.
- `media-tile__delete-btn` class — már nincs hover delete gomb tile-okon.

**Tile szemantika változott:** `Card` / `ImageTile` / `ListRow` mind `<button>`-ok mindkét library-ben (CL + Assets) — kattintásra nyitja a detail dialog-ot. Az archive/restore overlay-ek megszűntek (a dialog header-jében van Archive/Restore gomb).
3. Sorrend: kicsi shared komponensek → page-szintű komponensek → nagyok (MessageEditor, TemplateEditor több commitra). Minden lépés után typecheck + te ránézel hogy nem tört semmi.
