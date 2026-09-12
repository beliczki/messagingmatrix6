import type { IconName } from "./Icon";

/**
 * Semantic name → Streamline Core icon, hand-curated from
 * docs/ICON_SET_STUDY.md §3. The generator (scripts/gen-icons.ts) reads this
 * and never guesses: Core's names do not follow from lucide's, and its Remix
 * variants are not even a suffix away from its own Line names.
 *
 * A name absent from this table falls back to lucide at render time. That is
 * the study's §5.1 decision, not an oversight — Core free ships no chevron, no
 * spinner, no grip dots and no 3×3 grid, and those are the most-used icons in
 * the app. A mixed family on twelve glyphs beats twelve hand-drawn guesses.
 *
 * `rotate` exists because Core gives one arrow and expects you to turn it,
 * exactly as the study's table says (arrow-up-1 + rotate-180 = down).
 */
export type CoreEntry = {
  /** Icon name in the `streamline` Iconify set (Core Line). */
  line: string;
  /**
   * Remix name, when it is not `<line>-remix`. 936 of Core's 1000 icons follow
   * the suffix rule; 64 take a prefix instead (`line-`, `triangle-`, …) or a
   * different number, so the generator tries those and this field settles the
   * rest. `null` means Core ships no Remix variant at all — that name keeps
   * rendering lucide in the Remix family.
   *
   * Solid needs no such field: all 75 mapped icons resolve as `<line>-solid`.
   */
  remix?: string | null;
  /** Degrees to rotate the glyph, when Core ships only one orientation. */
  rotate?: 45 | 90 | 180 | -90;
};

export const CORE_MAP: Partial<Record<IconName, CoreEntry>> = {
  // interface
  close: { line: "delete-1" },
  check: { line: "check" },
  "check-double": { line: "check" },
  add: { line: "add-1" },
  subtract: { line: "subtract-1" },
  "add-square": { line: "add-square" },
  delete: { line: "recycle-bin-2" },
  edit: { line: "pencil" },
  design: { line: "pen-tool" },
  copy: { line: "multiple-file-2" },
  "copy-add": { line: "file-add-alternate" },
  save: { line: "floppy-disk" },
  filter: { line: "filter-2" },
  more: { line: "horizontal-menu-circle" },
  settings: { line: "cog", remix: "cog-1-remix" },
  lock: { line: "padlock-square-1" },
  hidden: { line: "invisible-1" },
  info: { line: "information-circle" },
  warning: { line: "warning-triangle" },
  alert: { line: "warning-octagon" },
  "shield-alert": { line: "shield-1" },

  // navigation
  "arrow-up": { line: "arrow-up-1" },
  "arrow-down": { line: "arrow-up-1", rotate: 180 },
  "arrow-left": { line: "arrow-up-1", rotate: -90 },
  "arrow-up-right": { line: "arrow-up-1", rotate: 45 },
  swap: { line: "arrow-reload-horizontal-1" },
  "external-link": {
    line: "expand-window-2",
    remix: "line-arrow-expand-window-1-remix",
  },
  refresh: { line: "arrow-reload-horizontal-2" },
  undo: { line: "arrow-round-left", remix: null },
  history: { line: "circle-clock" },
  logout: { line: "logout-1" },
  expand: { line: "expand" },
  "expand-corners": { line: "arrow-expand" },
  download: { line: "inbox-tray-1" },
  upload: { line: "inbox-tray-2" },
  link: { line: "link-chain" },
  "link-alt": { line: "link-chain" },
  unlink: { line: "broken-link-2" },
  share: { line: "share-link" },

  // views and layout
  dashboard: { line: "dashboard-3" },
  list: { line: "bullet-list" },
  "list-task": { line: "task-list" },
  tree: { line: "hierarchy-10" },
  fork: { line: "hierarchy-2" },
  waypoints: { line: "arrow-roadmap" },
  "grid-tiles": { line: "polaroid-four" },
  columns: { line: "layout-window-11" },
  table: { line: "layout-window-8" },
  square: { line: "button-stop" },

  // content, media, entities
  image: { line: "landscape-2" },
  images: { line: "polaroid-four" },
  camera: { line: "camera-1" },
  video: { line: "camera-video" },
  "file-text": { line: "blank-notepad" },
  "file-code": { line: "file-code-1" },
  "file-add": { line: "file-add-alternate" },
  text: { line: "text-style" },
  palette: { line: "paint-palette" },
  book: { line: "open-book" },
  tag: { line: "tag" },
  star: { line: "star-1" },
  comment: { line: "chat-bubble-text-square" },
  pin: { line: "location-pin-3" },
  globe: { line: "web" },
  chart: { line: "graph-bar-increase" },
  archive: { line: "archive-box" },
  "archive-restore": { line: "inbox-tray-2" },
  package: { line: "shipping-box-1" },
  rss: { line: "rss-symbol" },
  users: { line: "user-multiple-group" },
  flask: { line: "erlenmeyer-flask" },
  rocket: { line: "startup" },
  toolbar: { line: "wrench" },
  sun: { line: "brightness-1" },
  moon: { line: "waning-cresent-moon" },

  // Deliberately absent, all falling back to lucide (study §3.5):
  //   chevron-right/left/down/up · spinner · grip · grip-vertical ·
  //   grip-horizontal · grid · code · image-off · check-circle
  // plus google-drive, whose Core counterpart lives in a separate free set
  // (streamline-logos) that this generator does not pull yet.
};
