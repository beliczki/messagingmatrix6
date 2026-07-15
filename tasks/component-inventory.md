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
| `dimension-edit-panel` | Right-toolbar edit panel az audiences/topics/texts gridhez (action selector: bulk-set / duplicate / delete) | `_components/DimensionGrid/DimensionEditPanel.tsx` | a régi floating `bulk-edit-panel`-t váltja le |
| `dimension-edit-panel__title` / `__count` | Felső caps cím + "N selected" | DimensionEditPanel.tsx | – |
| `dimension-edit-panel__actions` | Action tab row (3 gomb) | DimensionEditPanel.tsx | – |
| `dimension-edit-panel__action-btn` | Egy action tab | – | – |
| `dimension-edit-panel__action-btn--bulk-set` / `--duplicate` / `--delete` | Variánsok | – | – |
| `dimension-edit-panel__action-btn--active` | Aktív tab (sötét bg) | – | – |
| `dimension-edit-panel__form` | Aktív action belső formja (field+value / hint+button) | – | – |
| `dimension-edit-panel__label` | Caps mini label (`Field`, `Value`) | – | – |
| `dimension-edit-panel__hint` | Magyarázó text (regex pattern, hard delete refusal) | – | – |
| `dimension-edit-panel__apply` | Apply / Duplicate / Delete CTA | – | duplicate=primary, delete=`--danger` (rose) |
| `dimension-edit-panel__apply--danger` | Delete variáns | – | – |
| `dimension-edit-panel__results` / `__results-list` | Bulk run eredmény (`N ok, M failed` + per-row hibalista) | – | – |
| `dimension-edit-panel__clear` | "Clear selection" lábgomb | – | – |
| `dimension-edit-panel__collapsed-icon` / `__collapsed-badge` | Collapsed right-toolbar állapotban: csak pencil ikon + N badge | – | – |
| `structure-tab__section--key-patterns` | Settings → Structure → Key patterns szekció (audienceKey + topicKey text input + `join(...)` info) | `_structure/StructureTab.tsx` | a `structure-tab__section--feed-patterns` előtt él |
| `dimension-grid__cell--frozen` | Key cella amikor `row.mcCount > 0` (auto-key fagyasztva mert MC referenciázza) | `DimensionGrid.tsx` Cell | lock ikont rendel mellé |
| `dimension-grid__cell-lock` | Lock-ikon a frozen key-cellában | DimensionGrid.tsx | – |
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
| `preview-pane__image-toggle` (`--active`) | "Image preview" checkbox-toggle (stored PNG mód) | PreviewPane.tsx | skip-anim ikertestvére |
| `preview-pane__image` / `__image-stale` / `__image-placeholder` | Stored preview PNG natív méretben + amber stale badge / dashed "no preview" placeholder | PreviewPane.tsx | – |
| `preview-pane__image-footer` (`__image-open`, `__image-generate`, `__image-error`) | Footer sáv image módban: open-in-new-tab link, Generate/Regenerate gomb, inline hiba | PreviewPane.tsx | – |
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
| `creative-row` / `asset-row` | List-view row (`<button>` 2026-05-02-től, 2026-05-17 óta 7-cellás CSS grid: thumb / name / product / type / size / created / updated) | CL `ListRow`, Assets `ListRow`, `MatrixIframeListRow` | `LIST_GRID_TEMPLATE` constans tartja egyben a column width-eket |
| `creative-row__name` / `__product` / `__type` / `__size` / `__created` / `__updated` (és `asset-row__*`) | Egy-egy oszlop cella a list-row gridben | CL/Assets `ListRow`, `MatrixIframeListRow` | – |
| `list-sort-header` | Sticky sortable column header a list-view tetején; 6 kattintható oszlop (Name/Product/Type/Size/Created/Updated) ArrowUp/ArrowDown indikátorral | `_components/ListSortHeader.tsx`, CL + Assets list view | grid template egyezik a row-okkal |
| `list-sort-header__cell` / `--active` | Egy header gomb; `--active` az aktuálisan rendezett oszlop | ListSortHeader | – |
| `media-field` | MC-editor Content-tab image/video mező (thumbnail + autocomplete input + clear gomb) | MessageEditor `MediaField`, 7× (image1-6 + video1) | `__control` / `__thumb` / `__input-wrap` / `__clear` |
| `asset-autocomplete` | Asset-Library typeahead dropdown a `media-field` input alatt (≥2 karakter után nyílik) | MessageEditor `MediaField` | `__item` / `__thumb` / `__name`, `--empty` no-match állapot |
| `thumb-checker` | 16px conic-gradient kockás minta áttetsző PNG/SVG mögé | mind a 6 thumb wrapperben + dialog viewport | global, `app/globals.css` |
| `status-dot` | Színes pötty (státusz / state) | FeedView, MessageEditor, TemplateEditor MC stepper | szín később (Phase 7) |
| `status-badge` | Pötty + szöveg pill | MessageEditor SaveIndicator 546–581, FeedView | szín később (Phase 7) |
| `empty-state` | Centered card "no data" üzenettel | MatrixGrid 279–298, CL 828–859, Assets, `_placeholder.tsx` | inline duplikátum |
| `empty-state__icon` | Felső ikon | – | – |
| `empty-state__title` | Cím | – | – |
| `empty-state__hint` | Másodlagos szöveg | – | – |
| `modal` | Generic fixed overlay modal | MessageEditor (slide-in), UploadDialog | – |
| `modal-backdrop` | Sötétített háttér overlay — most a `ModalBackdrop` komponens rendereli (`_components/ModalBackdrop.tsx`). Csak akkor zár, ha a kattintás a backdrop-on **kezdődik ÉS végződik** (input-ból kihúzott szövegkijelölés nem zárja a dialógust). 9 click-to-close dialógus használja. | `_components/ModalBackdrop.tsx` (shared) | ClientsTab / UsersView nem ezt használja (azoknak nincs click-to-close) |
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
| `conflict-bar` | Borostyán sáv a header alatt, ha egy másik szerkesztő felülírta a sort — egyetlen "Reload" akció (reload-only conflict resolution) | MessageEditor (header alatt) | új blokk, `__icon` / `__msg` / `__btn` elemekkel |
| `entity-history` | Jobb oldali revíziós drawer (`modal` overlay) az audit-log `before`/`after` snapshotokból; soronként diff + "Restore this version" | `_components/EntityHistoryDrawer.tsx` (shared) — topics/audiences grid + MessageEditor | `__header` / `__body` / `__list` / `__entry` / `__entry--current` / `__diff` / `__restore` / `__error` |

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

### 3g. HeaderDetailDialog (audience/topic edit + steppable preview) — `matrix/HeaderDetailDialog.tsx`

A row/col header kattintásra nyíló osztott modal: bal pane szerkeszthető audience/topic form, jobb pane stepperrel végigmegy az adott audience/topic-ra eső MC-ken, élő iframe preview-val.

| Egység | Javasolt név | Sor |
|---|---|---|
| Modal root | `matrix-header-dialog modal` | – |
| Pane order modifier wide aspect-ben | `matrix-header-dialog--landscape` | – |
| Header strip | `matrix-header-dialog__header modal__header` | – |
| Heading kind (Audience / Topic kis label) | `matrix-header-dialog__kind` | – |
| Címke (entity name) | `matrix-header-dialog__title` | – |
| Kulcs (font-mono kis szürke) | `matrix-header-dialog__key` | – |
| SaveIndicator | `save-indicator` (globalis, lásd 3e) | – |
| Autosave toggle | `matrix-header-dialog__autosave-toggle` | – |
| Manual Save / Cancel gombok | `toolbar-btn--primary` / `toolbar-btn` | – |
| Close (X) | `modal__close` | – |
| Body flex container | `matrix-header-dialog__body` | – |
| Edit form pane | `matrix-header-dialog__pane--form` | – |
| Form scroll content | `matrix-header-dialog__form-content` | – |
| Audience/Topic form grid | `matrix-header-form form-grid` | – |
| Draggable divider | `divider-handle--vertical` / `--horizontal` (globalis) | – |
| Preview pane | `matrix-header-dialog__pane--preview` | – |
| Stepper strip (prev/next + label + counter) | `matrix-header-dialog__stepper` | – |
| Prev nav | `matrix-header-dialog__nav-prev` | – |
| Next nav | `matrix-header-dialog__nav-next` | – |
| Counter (3/12) | `matrix-header-dialog__nav-counter` | – |
| Current MC label | `matrix-header-dialog__mc-label` | – |
| Current MC name (cím melletti truncate) | `matrix-header-dialog__mc-name` | – |
| Empty preview placeholder | `matrix-header-dialog__empty-preview` | – |
| Belső preview (`PreviewPane`) | `preview-pane` (globalis) | – |

A header `<th>` kattintható lett: `matrix-grid__col-header-btn` és `matrix-grid__row-header-btn` belső gomb. A korábbi `matrix-grid__col-header-label` / `matrix-grid__row-header-label` továbbra is a gombon belül él.

Persisted localStorage kulcsok:
- `mm6_media_dialog_preview_bg` — **shared** a `MatrixDetailDialog`-gal (light/dark/checker).
- `mm6_matrix_header_dialog_size` — utoljára választott méret (string vagy null).
- `mm6_matrix_header_dialog_skip_anim` — bool.
- `mm6_matrix_header_dialog_split` — divider %-os pozíciója (number).

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
| Missing-preview warning pill + offender dropdown | `creative-library__preview-warning` (`-btn`, `-menu`, `-row`) | – |
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

---

## Változások 2026-05-02 — MC iframe creative-ek a Creative Library-ben

**Új komponensek:**
- `_components/MatrixIframeTile.tsx` — három variánsban (`MatrixIframeTile` / `MatrixIframeCard` / `MatrixIframeListRow`) a CL masonry / grid / list view-jaiba. Belül `MatrixIframePreview` IntersectionObserver-rel lazy-mount-olja az iframe-et és cache-eli a `/api/render` HTML-t modul-szintű `Map`-ben (key: `msgId|version|template|size`).
- `creative-library/MatrixDetailDialog.tsx` — read-only fullscreen iframe preview MC virtuális creative kattintásra; „Open in matrix →" link a `MessageEditor`-re.

**Új BEM block-ok:** `matrix-iframe-tile`, `matrix-iframe-card`, `matrix-iframe-row`, `matrix-iframe-preview` (`__frame`, `__placeholder`, `__error`), `matrix-detail-dialog` (`__header`, `__stage`).

**Reuse:** a card / list variánsok a meglévő `creative-card` / `creative-row` chrome-ot hordják (közös meta-blokk + tag-chip-ek), így a vizuális rítmus megegyezik az uploaded creative tile-okkal.

---

## Változások 2026-05-17 — Matrix edit-mode v1

**Új BEM class-ok:**
- `selection-actions--inline` — horizontal modifier on the shared `selection-actions` block (top-toolbar use vs the existing vertical sidebar use in CL / Feeds / Shares).
- `selection-actions__btn--apply` — green commit button shown while a copy/move target picker is open.
- `mc-chip--selectable` — edit-mode cursor + outline hint on every chip.
- `mc-chip--selected` — visible ring when the chip is in the current selection.
- `mc-chip--ghost` — preview chip rendered in target cells during the toolbar Copy/Move picker (dashed border, no DB write).
- `mc-chip--ghost-source` — dimmed source-cell chip during a pending move.
- `cell-add-btn` — `+ new` quick-create button rendered in every cell while edit mode is on.
- `toolbar-btn--toggle`, `toolbar-btn--toggle--active` — generic on/off toolbar button (used by the matrix `Edit` toggle; pattern can be reused elsewhere).
- `matrix-grid__col-header--target`, `matrix-grid__col-header--target-disabled` — column-header states while a Copy/Move target picker is open.
- `matrix-grid__cell--drop-target`, `matrix-grid__cell--drop-rejected` — drop-zone affordances during DnD.

**Reuse:**
- `useLongPress` (`_components/useLongPress.ts`) — same hook CreativeLibrary uses for selector-mode entry.
- `selection-actions` block reused horizontally rather than introducing a new `selection-toolbar`.
- `@dnd-kit/core` added as a new dependency (no `sortable`/`utilities` — this UX has no list reordering).

---

## Változások 2026-05-17 (later) — Edit-mode UI moved to side toolbar

The Edit toggle and the entire selection-actions block moved out of the top `matrix-toolbar` into the right side toolbar, mirroring the visual chrome of `FeedExportPanel`. Top toolbar is back to just search + multi-pills + counts.

**Új BEM block-ok:**
- `edit-mode-panel` — the box itself (`rounded-md border border-slate-200 bg-white p-3`), positioned in the right toolbar's expanded body below `ViewControls` when `view === "grid"`. Visual twin of `feed-export-panel`.
- `edit-mode-panel__title` — uppercase label ("Edit mode"), same `text-[10px] font-medium uppercase tracking-wider text-slate-500` as `feed-export-panel__title`.
- `edit-mode-panel__toggle`, `edit-mode-panel__toggle--active` — full-width Enter/Exit edit mode button inside the panel.
- `edit-mode-panel__selection` — selection sub-section (only when `editMode && selection.mcIds.size > 0`); separated from the toggle by a top border + `pt-3`.
- `edit-mode-panel__count` — "N selected · topic Foo" header.
- `edit-mode-panel__actions` — 2×2 grid of Copy / Move / Delete / Cancel.
- `edit-mode-panel__pending` — stacked Apply (N) / Cancel shown while a target picker is open.
- `edit-mode-panel__error` — rose box (`border-rose-200 bg-rose-50 text-[10px] text-rose-700`) at the panel bottom showing the last failed bulk copy/move (Apply or DnD), e.g. "MC330a is ACTIVE — measured cards keep their PMMID and can't be moved". Clears on pending-action change or edit-mode toggle.
- `edit-mode-toggle`, `edit-mode-toggle--active` — collapsed-mode icon-only Edit button, rendered in the right toolbar's narrow column below the density CycleIconButton.

**Reuse:**
- `selection-actions__btn--copy`, `--move`, `--delete`, `--cancel`, `--apply`, `selection-actions__pending` — kept verbatim inside the new panel (same buttons, new container).

**Removed from the inventory in practice (still defined but no longer rendered):**
- `selection-actions--inline` — was the horizontal modifier on the top-toolbar version. Now unused; can be deleted in a future cleanup.
- `toolbar-btn--toggle`, `toolbar-btn--toggle--active` — were the top-toolbar Edit button styles. Now unused (the new toggle lives inside `edit-mode-panel__toggle` instead).

---

## Változások 2026-05-23 — Settings → Keywords tab + autocomplete cell

`/audiences` and `/topics` 5 freeform-text + 1 `select` columns become `autocomplete` cells driven by a new `keywords` table (per-client). A new Settings → Keywords tab curates the lists; the matrix `HeaderDetailDialog` shares the same widget.

**Új BEM block-ok:**
- `autocomplete-field` — shared input + native `<datalist>` widget used by both DimensionGrid inline editors and HeaderDetailDialog forms. Single class on the `<input>`; the datalist itself has no class (it's invisible).
- `keywords-tab` — Settings tab container (2-column flex: 240px sidebar + flex-1 pane).
- `keywords-tab__sidebar` — left column listing the 12 `(form, field)` pairs.
- `keywords-tab__section` — sidebar group per form (Audiences / Topics).
- `keywords-tab__section-label` — `text-[10px] uppercase tracking-wider` form heading, matching the matrix-header-form `SectionHeader` pattern.
- `keywords-tab__field-list`, `keywords-tab__field-btn`, `keywords-tab__field-btn--active`, `keywords-tab__field-count` — the per-field selector buttons with a small count chip on the right.
- `keywords-tab__pane` — right column with header + add-row + value list.
- `keywords-tab__pane-header`, `keywords-tab__pane-title`, `keywords-tab__archived-toggle` — pane top bar.
- `keywords-tab__add-row`, `keywords-tab__add-input` — the "Add value…" inline form.
- `keywords-tab__error` — rose-bg error banner under the add form.
- `keywords-tab__empty` — slate-bg dashed-border empty-state for fields with no values yet.
- `keywords-tab__list`, `keywords-tab__row`, `keywords-tab__row--archived` — the value rows themselves; archived rows get the `opacity-60` + `bg-slate-50` modifier.
- `keywords-tab__row-reorder`, `keywords-tab__row-up`, `keywords-tab__row-down` — per-row up/down arrows.
- `keywords-tab__row-value` — the read-mode value button (click → edit mode).
- `keywords-tab__row-edit`, `keywords-tab__row-edit-input`, `keywords-tab__row-edit-cancel` — edit-mode input + X cancel button.
- `keywords-tab__row-archive`, `keywords-tab__row-restore` — eye-off / archive-restore action icons (mutually exclusive per row).

**Új DimensionGrid CellType:**
- `kind: "autocomplete"` (alongside the existing `text | number | select | select-dynamic`). Source = `{ form, field }` lookup into the Settings → Keywords list. Inline cell renders the same `<input list=…>` + `<datalist>` pair as `autocomplete-field`, just without the shared class hook (the input already has `autocomplete-field` baseline styling implicitly).

**Reuse:**
- `toolbar-btn--primary` for the Add button.
- `Field` / `SectionHeader` / `inputCls` in `HeaderDetailDialog` unchanged — only the inner `<input>`/`<select>` is swapped for `<AutocompleteField>`.
- The Audiences/Topics editor pages stay structurally identical — only `keywordOptions={...}` was threaded into `<DimensionGrid>`.

**Hooks:**
- `useKeywordOptions` (`_components/useKeywordOptions.ts`) — single react-query call returning the grouped `{form: {field: values[]}}` shape. Shared by audiences/topics editors, the matrix HeaderDetailDialog, and any future consumer. Query key `["keywords"]` aligns with the SSE `entity: "keywords"` broadcast wired in `usePresenceConnection` (Phase B), so any Settings edit live-refreshes every open editor.

---

## Változások 2026-05-23 (cont.) — Template kind + matrix preview auto-switch

`TemplateInfo` gains a production-type `kind` field (`html | adobe | figma | after_effects`). The matrix-side preview surfaces — `MatrixIframePreview` (used by Creative Library tile/card/list) and `PreviewPane` (used by MessageEditor + matrix HeaderDetailDialog) — branch on kind: HTML stays iframe-rendered; non-HTML shows the template folder's `preview.{png,jpg,…}` image with a small kind badge.

**Új BEM block-ok:**
- `template-preview-image` — wrapper for non-HTML template preview (matches the matrix-iframe-preview chrome — `thumb-checker` background, identical layout modes).
- `template-preview-image__img` — the `<img>` itself; `object-contain` so banners letterbox cleanly.
- `template-preview-image__empty` — empty-state when the template has no preview file (`ImageOff` icon, slate-300).
- `template-preview-image__link` — wraps the image in an `<a target=_blank>` when `kind=figma` and `figma_url` is set (so click → opens in Figma).
- `template-kind-badge`, `template-kind-badge--adobe`, `template-kind-badge--figma`, `template-kind-badge--after-effects` — bottom-right corner badge with the kind label + optional ExternalLink icon for figma. Reuses `status-badge`-style geometry (rounded, slate border, white/90 bg, `text-[10px] uppercase tracking-wider`).
- `preview-pane__image-wrap` — new sibling to `preview-pane__iframe` inside the `preview-pane__viewport`; absolute-sized container for the `TemplatePreviewImage` so it sits where the iframe would.

**Types:**
- `TEMPLATE_KINDS` constant + `TemplateKind` type in `src/lib/templates.ts`.
- `TemplatePreviewMeta` exported from `_components/MatrixIframeTile.tsx` — small subset of `TemplateInfo` (`kind`, `previewFile`, `externalUrl`) passed through tile/card/list/PreviewPane.
- `templateMetaFor(t)` helper in the same file — converts any TemplateInfo-shape into the subset; returns `undefined` for missing input so call sites fall back to iframe rendering safely.

**Reuse:**
- `thumb-checker` (already in inventory) — same checker background under both iframe and image previews so cells line up visually.
- `status-badge` token geometry — `template-kind-badge` mirrors it without claiming the same class to keep status- and kind-pill semantics separate.
- `ImageOff` (lucide) — same icon family the rest of the app uses for "no media" states.
- `ExternalLink` (lucide) — flags the figma click-through inline on the badge.

**Manifest schema (filesystem, no DB):**
- `templates/<name>/manifest.json` accepts new optional fields: `kind` (defaults to `"html"`), `figma_url` (only honored for `kind=figma`), `preview` (filename inside the folder; auto-discovers `preview.{png,jpg,jpeg,webp,gif}` for non-html when unset). HTML-template-only fields (`width`, `height`, `events`, `clicktags`, `source`) untouched.

**Behaviour matrix:**
- `kind=html` (or unset, or unknown) → existing iframe render path unchanged. **Zero regression on existing templates.**
- `kind=adobe|after_effects` → preview image + kind badge, no link.
- `kind=figma` → preview image + kind badge wrapped in an external link if `figma_url` is set.

**Not in this round (explicit):**
- `creative_id`-based override (D5 "linked creative beats template preview"). Until 3.x punch list lands, non-html cells always show the template's preview image.
- Share Gallery non-HTML support — uses its own `PublicMatrixPreview` against `/api/render/public`; needs a public-safe templates endpoint. Public shares of non-HTML MCs would currently render-fail; treat that as the lower-priority follow-up.
- Creative Library "matrix items" synthesizer filters out templates with `sizes.length === 0`, which now excludes non-html templates. Showing non-html MCs as creative-library cards needs the synthesizer to handle the "no size" case — separate slice.
- Template Editor (`/templates`) UI for picking kind / uploading preview / entering figma_url. Admin edits `manifest.json` text in the existing CodeMirror editor for v1.

---

## Változások 2026-05-23 (cont.) — `ARCHIVED` workflow status

Added an 11th workflow status `ARCHIVED`, sitting next to `INACTIVE` semantically (both lock the row against placement changes — see "PMMID regen on audience move" todo block). Distinct from the existing `archived_at` soft-delete column: that column is a system-level safety net; the status is user intent ("hide from default views, but remember it existed").

**New CSS hook:**
- `.status-dot--archived` in `globals.css` — sibling of the existing `.status-dot--{incoming,naming,…,memory}` classes. Reads `var(--status-archived)` (default `#4b5563`, slate-600-ish, one shade darker than `--status-inactive` so the two read as related-but-distinct in dropdowns).

**Touched files (status enum is fanned out across UI + DB defaults; no central source yet — kept consistent by-hand for now):**
- `src/app/(app)/matrix/types.ts` — `STATUS_OPTIONS` + `STATUS_COLOR` (Tailwind class map, `bg-slate-500`).
- `src/app/(app)/matrix/MessageEditor.tsx` — local `STATUS_OPTIONS`.
- `src/app/(app)/settings/_design/DesignTab.tsx` — `STATUS_KEYS` + `STATUS_VAR` (CSS variable map).
- `src/db/defaults.ts` — `DEFAULT_LOOK_AND_FEEL.statusColors` (hex default).
- `src/app/globals.css` — `--status-archived` declaration + `.status-dot--archived` class.

**Not in this round (explicit):**
- Filter UX for default-hiding ARCHIVED in matrix/library views. Current `EMPTY_FILTERS.statuses = new Set()` means "show all" — no notion of default-hidden statuses yet. Separate slice (see Open Question in the todo block).
- Centralizing the status enum into a single source-of-truth module. Today it's hand-mirrored across 4 files; tolerable while we still have a small fixed set, but a `src/lib/mc-status.ts` central export would be the right move once we touch this area again.

---

## Változások 2026-05-27 — Decision Tree view (xyflow)

**Új komponens:** `_views/TreeView.tsx` (`(app)/matrix/_views/`) — xyflow-alapú decision-tree nézet a Matrix editor view-selectorjában a Grid / Feed mellé. Read-only, leaf-en (Messages) kattintásra megnyitja a meglévő `MessageEditor` side-panelt (`onOpenMessage` prop).

**Új tiszta segéd modulok:** `_tree/parseTreeStructure.ts` (arrow-string → `TreeLevel[]`), `_tree/buildTree.ts` (`{auds, tops, msgs}` × `TreeLevel[]` → xyflow `{nodes, edges}`). Mindkettő pure-fn, unit-tesztelt (`tests/unit/parse-tree-structure.test.ts`, `tests/unit/build-tree.test.ts` — 12 új teszt).

**Új semantic class-ok:** `tree-view`, `tree-view--loading`, `tree-view--error`, `tree-view--empty`, `tree-view__node`, `tree-view__node--leaf`, `tree-view__node-label`, `tree-view__node-count` (`app/globals.css` `@layer components`).

**Settings bővítés:** Settings → Structure tab új section "Decision tree structure" (`_structure/StructureTab.tsx`). Új semantic class `structure-tab__section--tree`. Persistence a meglévő `config` táblába key=`treeStructure`, category=`structure` (semmi új API route, a generikus `/api/config` GET/PUT-on megy). Default seed (`db/defaults.ts`): `"Product → Strategy → Audience → Topic → Messages"`.

**View enum bővítés:** `View = "grid" | "feed" | "tree"` (`matrix/types.ts`). MatrixGrid CycleIconButton + ViewControls toggle group új `tree` opciót kapott (`GitFork` lucide icon). `mm6_matrix_state_v1` localStorage rehydration is felismeri.

**Új dependency:** `@xyflow/react@^12.10.2`.

**Reuse:** semmi MM5-ös tree kód nem lett áthozva (külön döntés). Az UI a meglévő tokenekre épül (`empty-state`, `form-field`, `input-box`, `toggle-btn`, `structure-tab__section`).

---

## Változások 2026-05-28 — Tree view NAVIGATOR a RightToolbar-ban

**Új komponens:** `_views/TreeViewNavigator.tsx` (`(app)/matrix/_views/`) — a tree view MiniMap + zoom Controls párosa, kiemelve a canvas top-right sarkából a globális `RightToolbar` "NAVIGATOR" section-jébe. Csak akkor renderelődik, ha `view === "tree"`.

**Új tiszta hook:** `_views/useIsDarkMode.ts` — eddig TreeView-on belüli, most megosztva a Navigator-rel is.

**Új semantic class-ok:** `tree-view-navigator`, `tree-view-navigator__label`, `tree-view-navigator__minimap-wrap`, `tree-view-navigator__controls-wrap`, `tree-view__minimap--docked`, `tree-view__controls--docked` (`app/globals.css` `@layer components`). A `--docked` variánsok kinullázzák a Panel absolute-positioning rétegét, hogy a MiniMap/Controls a toolbar dobozán belül álljon.

**Architektúra delta:** a `ReactFlowProvider` átkerült `TreeView.tsx`-ből `MatrixGrid.tsx`-be, hogy a toolbar és a canvas ugyanazt az xyflow store-t lássa. Provider mindig fent van; üres store ha nincs `<ReactFlow>` mountolva, ami olcsó.

---

## 2026-05-31 — Wave 3 Monitoring ingest

**Új page-komponens:** `monitoring/_components/MonitoringUpload.tsx` — az AdForm Creative-report XLSX feltöltő widget a Monitoring oldal placeholderje helyén (drag-drop + klikk, eredmény-összegző kártya).

**Új semantic class-ok:**
- `monitoring-upload` (page-szintű blokk), `monitoring-upload__header`
- `monitoring-upload__dropzone` — dashed-border kattintható/drag-drop terület; az `upload-dialog__dropzone` mintáját követi, de inline (nem modal)
- `monitoring-upload__result` — import-eredmény kártya (`rounded-lg border bg-white`)
- `monitoring-upload__stats` / `monitoring-upload__stat` — `<dl>` grid a számokkal (Messages / Matched / Unmatched / Raw rows), a `text-[10px] uppercase tracking-wider` section-label konvencióval
- újrahasznált: `tag-chip` (platform chipek), `error-alert`

**W3.f lista-nézet** (`monitoring/_components/`): `MonitoringView.tsx` (wrapper: upload + tábla, `reloadToken`-nel frissít import után), `MonitoringTable.tsx`.
- `monitoring-view` (wrapper blokk)
- `monitoring-table` + `__toolbar` (period/platform `select` + match-filter) + `__match-filter` (All/Matched/Unmatched pill-group, a `tab-bar`-szerű inline rounded group) + `__totals` / `__total` (dl grid) + `__wrap` / `__table` (a `users__table` mintát követő `table-auto border-collapse text-sm`)
- `status-badge--unmatched` — amber badge a nem-mátrixolt sorokra (a W2.7-ben tervezett tokennel egyezik); újrahasznált `tag-chip` a platform-oszlopban

**W3.f layout-revízió** (Creative Library list-view mintára): a Monitoring oldal mostantól `monitoring flex h-full` + `monitoring__content` (table) + `RightToolbar`. `MonitoringView` birtokolja a layoutot és a RightToolbart (a feltöltés `reloadToken`-nel frissíti a táblát).
- A szűrők a `monitoring-table__toolbar`-ba kerültek (`toolbar ... sticky top-0 min-h-12 border-b` — a `creative-library__toolbar` mintája): title + Report period select + Platform select (`w-36`, keskeny) + match-pillek + Clear + jobbra compact totál (`toolbar__count`).
- A feltöltés a `RightToolbar` aljára került (`mt-auto`), collapsed-aware: ikon-gomb összecsukva, dropzone + help-szöveg + compact eredmény kibontva. Period szűrő = **riport-periódus** dropdown (a sorok periódusonként aggregáltak, nincs napi bontás → dátum-tartomány szűrő nem értelmezhető sor-szinten).

**W3.f finomítás (Creative Library list-parity):** szürke sticky sort-header (`bg-slate-50`, oszloponként kattintható sort-nyilakkal — a `list-sort-header` stílusát követi, de a monitoring oszlopaira); `monitoring-row__preview` mini MC-preview cella (exportált `MatrixIframePreview` fit-rect, lazy iframe), kattintásra `MatrixDetailDialog` (újrahasznált a creative-library-ből, `MatrixNavItem` itemmel). Preview-pipeline: `/api/messages` + `/api/templates/folders` + `/api/audiences` (react-query) → `previewById` map a matched üzenetekhez. Period dropdown és match-pillek count nélkül; `toolbar__count` = `látszó/összes rows · CTR` (impr/cost kivéve).

**W3 product mező:** `monitoring.product` oszlop (migráció `0018`). Importkor feloldva: audience→product (mátrix-autoritatív), különben kulcsszó→termék szabály (topic + PMMID substring). Szabályok: Settings → Structure → **MONITORING szekció** (`structure-tab__section--monitoring`, `monitoring-rule-row` szerkeszthető lista, config `monitoringProductRules`, category `structure`). A Monitoring lista `Product` oszlopa + `MultiPill` szűrője a tárolt `product`-ot használja.

**W3 size grain + detail dialog:** `monitoring.size` oszlop (migráció `0019`), parser `extractSize` (első `NxN` token a Banner/Adgroupsból), aggregálás size-szinten. Tábla: új sortable **Size** oszlop; minden sor (matched ÉS unmatched) kattintható → **`MonitoringDetailDialog`** (`monitoring-detail`, `modal` shell): matched → `MatrixIframePreview`, unmatched → `status-badge--unmatched` placeholder; mindkettőnél **audience × size bontó tábla** (impr/clicks/CTR + total) az adott MC összes sorából. A `MatrixDetailDialog` használat megszűnt a monitoringban.

**Multi-number cells + show-archived (2026-07-12):**
- `create-mc-dialog` — a Matrix `+ new` occupied-cell választója (`modal` shell, `max-w-xs`, ShareCreateDialog-minta): `__cell` (topic/audience uppercase label), `__options` (gomblista), `__option` (per-szám "New variant of MCn" `toolbar-btn` stílus) + `__option--new` ("New MC number", `toolbar-btn--primary`), `__divider`, `__error` (rose hibadoboz, az `edit-mode-panel__error`-ral azonos stílus).
- `archive-toggle` kapott `className` propot (mt-auto pinneléshez); mostantól a Matrix / Creative Library / Assets right-toolbar ALJÁN ül (az Upload gomb felett, ahol van Upload), nem a view-switcher alatt. Collapsed módban is alulra tűzve.
- Archivált MC-k a Matrixban: `mc-chip--archived row--archived` (+ `row--archived__title` a labelen) a grid chipeken, `matrix-feed__row--archived row--archived` a feed sorokon, `tree-view__node-wrap--archived row--archived` a tree leaf-eken. Edit módban az archivált chip PlainChip (nem kijelölhető/húzható).

**Per-user MCP tokenek (2026-07-15):**
- `mcp-tokens` — Settings → MCP tab "Tokens" szekció (a `mcp-tab__section` kártya-shellben): `__header` (cím + `toolbar-btn--primary` "New token"), `__table` / `__row` (a `clients-tab__table` mintát követő `w-full table-auto border-collapse text-sm`; oszlopok: Label / User / Scope / Token / Last used / Created / akciók). Scope badge = újrahasznált `status-badge` (emerald=full, slate=read).
- `TokenRevealModal` a ClientsTab-ból ide költözött (általánosított `title` + `token` prop, copy szövege "re-revealable"-re enyhítve); a ClientsTab MCP-token oszlopa/rotate gombja megszűnt (tokenek mostantól per-user, `mcp_tokens` tábla).
- Új token modal: `modal` + `form-field` konvenció (NewClientModal-minta) — user select + scope select + label input.
