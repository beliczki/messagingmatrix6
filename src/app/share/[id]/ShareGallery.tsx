"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  Columns3,
  Download,
  ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MessageSquare,
} from "lucide-react";
import clsx from "clsx";
import PublicMatrixPreview from "./PublicMatrixPreview";
import ImagePreviewToggle from "./ImagePreviewToggle";
import { Masonry } from "../../(app)/_components/Masonry";
import ShareDetailDialog, {
  type DialogItem,
  type ShareCommentRow,
} from "./ShareDetailDialog";

export type SnapshotMessage = {
  id: number;
  number: number;
  variant: string;
  template: string | null;
  headline: string | null;
  copy1: string | null;
  copy2: string | null;
  disclaimer: string | null;
  cta: string | null;
  flash: string | null;
  landingUrl: string | null;
  audience: string;
  topic: string;
  pmmid: string | null;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  versionNo?: number | null;
  // Server passes through the full row; only the fields we render are typed.
  [extra: string]: unknown;
};

export type SnapshotMatrixItem = {
  messageId: number;
  size: string;
  /** Resolved server-side from messages[] for convenience. */
  message?: SnapshotMessage;
};

export type SnapshotCreative = {
  id: number;
  brand: string | null;
  product: string | null;
  type: string | null;
  template: string | null;
  visualKeyword: string | null;
  mcNumber: number | null;
  mcVariant: string | null;
  fileId: string | null;
  fileName: string | null;
  fileFormat: string | null;
  fileDimensions: string | null;
  comment: string | null;
  driveFolderId?: string | null;
  driveFolderName?: string | null;
  driveFileId?: string | null;
};

export type SnapshotFile = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  dimensions: string | null;
};

type ViewMode = "grid" | "list" | "masonry";
export type PreviewBg = "light" | "dark" | "checker";

type Item = DialogItem & { size: string | null };

type Props = {
  shareId: string;
  clientName: string;
  shareTitle: string | null;
  shareDescription: string | null;
  generatedAt: string | null;
  matrixItems: Array<{ messageId: number; size: string; message: SnapshotMessage }>;
  creatives: SnapshotCreative[];
  files: SnapshotFile[];
};

const AUTHOR_NAME_KEY = "mm6_share_author_name";

export function bgStyleFor(bg: PreviewBg): React.CSSProperties {
  if (bg === "dark") return { backgroundColor: "#1f2937" };
  if (bg === "checker") {
    return {
      backgroundColor: "#f9fafb",
      backgroundImage:
        "linear-gradient(45deg, #d1d5db 25%, transparent 25%), " +
        "linear-gradient(-45deg, #d1d5db 25%, transparent 25%), " +
        "linear-gradient(45deg, transparent 75%, #d1d5db 75%), " +
        "linear-gradient(-45deg, transparent 75%, #d1d5db 75%)",
      backgroundSize: "20px 20px",
      backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
    };
  }
  return { backgroundColor: "#ffffff" };
}

export default function ShareGallery({
  shareId,
  clientName,
  shareTitle,
  shareDescription,
  generatedAt,
  matrixItems,
  creatives,
  files,
}: Props) {
  const filesById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const p of matrixItems) {
      out.push({
        kind: "matrix",
        key: `m-${p.messageId}-${p.size}`,
        itemKey: `matrix:${p.messageId}:${p.size}`,
        size: p.size,
        message: p.message,
      });
    }
    for (const c of creatives) {
      out.push({
        kind: "creative",
        key: `c-${c.id}`,
        itemKey: `creative:${c.id}`,
        size: c.fileDimensions,
        creative: c,
        file: c.fileId ? filesById.get(c.fileId) : undefined,
      });
    }
    return out;
  }, [matrixItems, creatives, filesById]);

  // Where these creatives were delivered from. The snapshot froze the links at
  // share time, so a folder resolved later will not appear on an older share.
  const driveFolders = useMemo(() => {
    const byId = new Map<string, string>();
    for (const c of creatives) {
      if (!c.driveFolderId) continue;
      if (!byId.has(c.driveFolderId)) {
        byId.set(c.driveFolderId, c.driveFolderName ?? "Delivery folder");
      }
    }
    return [...byId].map(([id, name]) => ({ id, name }));
  }, [creatives]);

  const sizeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.size) s.add(it.size);
    return [...s].sort((a, b) => {
      const aw = parseInt(a.split("x")[0] ?? "0", 10);
      const bw = parseInt(b.split("x")[0] ?? "0", 10);
      return aw - bw || a.localeCompare(b);
    });
  }, [items]);

  const [sizeFilter, setSizeFilter] = useState<Set<string>>(new Set());
  const [commentedOnly, setCommentedOnly] = useState(false);
  const [view, setView] = useState<ViewMode>("masonry");
  // Image-preview mode: tiles show the stored preview PNG instead of rendering
  // the banner live in an iframe, and Download all bundles those PNGs. Same
  // toggle as the MC editor's "Image preview".
  const [imagePreview, setImagePreview] = useState(false);
  // Card thumbs use a fixed checker background. The bg toggle lives in the
  // ShareDetailDialog header where the user is actually evaluating preview
  // backgrounds.
  const cardBg: PreviewBg = "checker";

  // Comments — fetched once on mount; refetch when a new comment is posted so
  // counts update across cards.
  const [comments, setComments] = useState<ShareCommentRow[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const fetchComments = useCallback(async () => {
    try {
      const r = await fetch(`/share/${shareId}/comments`);
      if (!r.ok) return;
      const data = (await r.json()) as { comments: ShareCommentRow[] };
      setComments(data.comments);
      setCommentsLoaded(true);
    } catch {
      // silently fail — share viewing should not block on comment fetch
    }
  }, [shareId]);
  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Stored preview PNGs for the snapshot's MCs, keyed "<messageId>|<size>".
  // Fetched on mount (not on toggle) so the Image preview button can carry its
  // count before anyone switches modes.
  const [previewByKey, setPreviewByKey] = useState<
    Map<string, { previewId: number; updatedAt: string }>
  >(new Map());
  useEffect(() => {
    let cancelled = false;
    fetch(`/share/${shareId}/previews`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { previews: Array<{ messageId: number; size: string; previewId: number; updatedAt: string }> }) => {
        if (cancelled) return;
        setPreviewByKey(
          new Map(
            data.previews.map((p) => [
              `${p.messageId}|${p.size}`,
              { previewId: p.previewId, updatedAt: p.updatedAt },
            ]),
          ),
        );
      })
      .catch(() => {
        // No stored previews reachable — Image preview simply reports 0.
      });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  // The image a tile shows (and Download all bundles) in image-preview mode.
  // null = this item has no stored image: an MC the preview generator has not
  // run on yet, or a non-image creative (video, binary).
  const imageSrcFor = useCallback(
    (it: Item): string | null => {
      if (it.kind === "creative") {
        const f = it.file;
        if (!f || !(f.mimeType?.startsWith("image/") ?? false)) return null;
        return `/share/${shareId}/file/${f.id}`;
      }
      if (!it.size) return null;
      const hit = previewByKey.get(`${it.message.id}|${it.size}`);
      if (!hit) return null;
      // ?v= is load-bearing: /api/previews/[id] is cached on a regen-stable id.
      return `/api/previews/${hit.previewId}?v=${encodeURIComponent(hit.updatedAt)}`;
    },
    [previewByKey, shareId],
  );

  const commentCountByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of comments) {
      map.set(c.itemKey, (map.get(c.itemKey) ?? 0) + 1);
    }
    return map;
  }, [comments]);

  const filtered = useMemo(() => {
    let out = items;
    if (sizeFilter.size > 0) {
      out = out.filter((it) => it.size !== null && sizeFilter.has(it.size));
    }
    if (commentedOnly) {
      out = out.filter((it) => (commentCountByKey.get(it.itemKey) ?? 0) > 0);
    }
    return out;
  }, [items, sizeFilter, commentedOnly, commentCountByKey]);

  // Author name persisted across visits.
  const [authorName, setAuthorNameState] = useState("");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(AUTHOR_NAME_KEY);
      if (saved) setAuthorNameState(saved);
    } catch {}
  }, []);
  const setAuthorName = useCallback((name: string) => {
    setAuthorNameState(name);
    try {
      localStorage.setItem(AUTHOR_NAME_KEY, name);
    } catch {}
  }, []);

  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  // In image mode only the items that actually have a stored image are
  // downloadable; the rest are labelled "no preview" in the gallery and stay
  // out of the zip rather than silently arriving as HTML.
  const imageReady = useMemo(
    () => filtered.filter((it) => imageSrcFor(it) !== null),
    [filtered, imageSrcFor],
  );
  const downloadTargets = imagePreview ? imageReady : filtered;

  async function downloadAll() {
    if (downloadTargets.length === 0 || zipping) return;
    setZipping(true);
    setZipProgress(0);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      let done = 0;
      for (const it of downloadTargets) {
        try {
          if (imagePreview) {
            const src = imageSrcFor(it);
            if (src) {
              const r = await fetch(src);
              if (r.ok) {
                zip.file(downloadFilenameFor(it, true), await r.blob());
              }
            }
          } else if (it.kind === "matrix") {
            const r = await fetch("/api/render/public", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                shareId,
                messageId: it.message.id,
                size: it.size,
              }),
            });
            if (r.ok) {
              const text = await r.text();
              zip.file(downloadFilenameFor(it), text);
            }
          } else if (it.file) {
            const r = await fetch(`/share/${shareId}/file/${it.file.id}`);
            if (r.ok) {
              const blob = await r.blob();
              zip.file(downloadFilenameFor(it), blob);
            }
          }
        } catch {
          // skip the failing item; continue with the rest
        }
        done += 1;
        setZipProgress(Math.round((done / downloadTargets.length) * 100));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "share-bundle.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setZipping(false);
      setZipProgress(0);
    }
  }

  // Detail dialog — track by key so size-filter changes don't shift the open
  // item underneath the user.
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const detailIndex = useMemo(
    () => (detailKey ? filtered.findIndex((it) => it.key === detailKey) : -1),
    [detailKey, filtered],
  );
  const detailItem = detailIndex >= 0 ? filtered[detailIndex] : null;
  function openDetail(it: Item) {
    setDetailKey(it.key);
  }
  function jumpDetail(i: number) {
    const next = filtered[i];
    if (next) setDetailKey(next.key);
  }
  useEffect(() => {
    if (detailKey && detailIndex < 0) setDetailKey(null);
  }, [detailKey, detailIndex]);

  return (
    <>
      <header className="share-gallery__header sticky top-0 z-20 border-b border-slate-200 bg-white">
        {/* Row 1 — what this share IS: identity, plus the two read-only facts
            about it (how many comments it has collected, when it was captured). */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
          <div className="share-gallery__brand flex shrink-0 items-center gap-2">
            <img
              src="/mmatrix.svg"
              alt="Messaging Matrix"
              className="share-gallery__logo size-6"
            />
            <span className="share-gallery__client-name text-sm font-semibold text-slate-900">
              {clientName}
            </span>
          </div>
          <div className="share-gallery__breadcrumb flex min-w-0 items-baseline gap-1.5 text-sm">
            <span className="text-slate-400">/</span>
            <span className="text-slate-500">Shared Creatives</span>
            <span className="text-slate-400">/</span>
            <span className="truncate font-semibold text-slate-900" title={shareTitle ?? undefined}>
              {shareTitle ?? "Untitled share"}
            </span>
          </div>
          <div className="share-gallery__meta ml-auto flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
            {commentsLoaded ? (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3" />
                {comments.length} comment{comments.length === 1 ? "" : "s"}
              </span>
            ) : null}
            {commentsLoaded && generatedAt ? (
              <span className="text-slate-300">·</span>
            ) : null}
            {generatedAt ? <span>captured {generatedAt}</span> : null}
          </div>
        </div>
        {shareDescription ? (
          <div className="share-gallery__description mx-auto max-w-6xl truncate px-4 pb-1.5 text-[11px] text-slate-500">
            {shareDescription}
          </div>
        ) : null}
        {driveFolders.length > 0 ? (
          <div className="share-gallery__drive mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-0.5 px-4 pb-1.5 text-[11px] text-slate-500">
            <span className="share-gallery__drive-label">Drive:</span>
            {driveFolders.map((f) => (
              <a
                key={f.id}
                href={`https://drive.google.com/drive/folders/${f.id}`}
                target="_blank"
                rel="noreferrer"
                className="share-gallery__drive-link text-slate-600 underline hover:text-slate-900"
              >
                {f.name} ↗
              </a>
            ))}
          </div>
        ) : null}
        {/* Row 2 — everything that changes what you see. What narrows the set
            sits left under the title; what changes how it is rendered or taken
            away sits right. */}
        <div className="share-gallery__controls mx-auto flex max-w-6xl flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2">
          <SizePill
            options={sizeOptions}
            counts={items}
            values={sizeFilter}
            onChange={setSizeFilter}
          />
          <button
            type="button"
            onClick={() => setCommentedOnly((v) => !v)}
            title={commentedOnly ? "Show all items" : "Show only commented items"}
            className={clsx(
              "commented-only-toggle inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition",
              commentedOnly
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            )}
          >
            <MessageSquare className="size-3.5" />
            Commented only
          </button>
          <div className="share-gallery__control-actions ml-auto flex flex-wrap items-center gap-2">
            <ViewSwitcher view={view} setView={setView} />
            <ImagePreviewToggle
              on={imagePreview}
              onChange={setImagePreview}
              ready={imageReady.length}
              total={filtered.length}
            />
            <button
              type="button"
              onClick={downloadAll}
              disabled={zipping || downloadTargets.length === 0}
              title={
                imagePreview
                  ? "Bundle the stored preview PNGs"
                  : "Bundle the rendered HTML creatives"
              }
              className="toolbar-btn--primary inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {zipping ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Download className="size-3.5" />
              )}
              {zipping
                ? `Bundling… ${zipProgress}%`
                : `Download all (${downloadTargets.length})`}
            </button>
          </div>
        </div>
      </header>

      <main className="share-gallery__main mx-auto max-w-6xl px-4 py-4">
        {items.length === 0 ? (
          <div className="empty-state mx-auto max-w-md rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">This share is empty.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state mx-auto max-w-md rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm text-slate-500">No items match the size filter.</p>
          </div>
        ) : view === "list" ? (
          <ul className="share-gallery__view share-gallery__view--list flex flex-col gap-2">
            {filtered.map((it) => (
              <li key={it.key}>
                <ItemRow
                  item={it}
                  shareId={shareId}
                  bg={cardBg}
                  commentCount={commentCountByKey.get(it.itemKey) ?? 0}
                  onOpen={() => openDetail(it)}
                  commentsLoaded={commentsLoaded}
                  imageMode={imagePreview}
                  imageSrc={imageSrcFor(it)}
                />
              </li>
            ))}
          </ul>
        ) : view === "grid" ? (
          <div className="share-gallery__view share-gallery__view--grid grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((it) => (
              <ItemCard
                key={it.key}
                item={it}
                shareId={shareId}
                bg={cardBg}
                commentCount={commentCountByKey.get(it.itemKey) ?? 0}
                onOpen={() => openDetail(it)}
                commentsLoaded={commentsLoaded}
                imageMode={imagePreview}
                imageSrc={imageSrcFor(it)}
              />
            ))}
          </div>
        ) : (
          /* Equal-width round-robin masonry — same component the Creative
             Library uses, so item N lands in column N % colCount and each
             column's items keep their natural heights. */
          <div className="share-gallery__view share-gallery__view--masonry">
            <Masonry
              items={filtered}
              itemKey={(it) => it.key}
              // Every item's shape is known before a single byte loads — an MC
              // from its banner size, a creative from its stored file
              // dimensions — so the packer can put each tile in the column that
              // is currently shortest instead of the next one in turn. Without
              // it the first columns ran several screens longer than the last.
              estimateHeight={(it, colWidth) => {
                const dims = parseDimensions(it.size);
                // Unknown shape (a creative with no recorded dimensions): a
                // square is the least-wrong guess, and a wrong guess only
                // costs balance, never correctness.
                return dims ? colWidth * (dims.h / dims.w) : colWidth;
              }}
              render={(it) => (
                <MasonryTile
                  item={it}
                  shareId={shareId}
                  bg={cardBg}
                  onOpen={() => openDetail(it)}
                  imageMode={imagePreview}
                  imageSrc={imageSrcFor(it)}
                />
              )}
            />
          </div>
        )}
      </main>

      {detailItem ? (
        <ShareDetailDialog
          shareId={shareId}
          item={detailItem}
          navItems={filtered}
          navIndex={detailIndex}
          onJump={jumpDetail}
          onClose={() => setDetailKey(null)}
          imageMode={imagePreview}
          setImageMode={setImagePreview}
          imageSrc={imageSrcFor(detailItem)}
          comments={comments}
          authorName={authorName}
          setAuthorName={setAuthorName}
          onCommentPosted={fetchComments}
        />
      ) : null}
    </>
  );
}

function ViewSwitcher({
  view,
  setView,
}: {
  view: ViewMode;
  setView: (v: ViewMode) => void;
}) {
  // Matches CreativeLibrary's LibraryViewSwitcher icon set + active style.
  const opts: Array<{ k: ViewMode; label: string; icon: React.ReactNode }> = [
    { k: "grid", label: "Grid", icon: <LayoutGrid className="size-3.5" /> },
    { k: "list", label: "List", icon: <ListIcon className="size-3.5" /> },
    { k: "masonry", label: "Masonry", icon: <Columns3 className="size-3.5" /> },
  ];
  return (
    <div className="toggle-group flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
      {opts.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => setView(o.k)}
          title={o.label}
          aria-label={o.label}
          className={clsx(
            "toggle-btn flex items-center justify-center gap-1 rounded px-2 py-1 transition",
            view === o.k
              ? "toggle-btn--active bg-slate-900 text-white"
              : "text-slate-700 hover:bg-slate-100",
          )}
        >
          {o.icon}
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// Checkbox-style toggle, same shape as the MC editor's "Image preview"
// (PreviewPane). The count is the point of the badge: it says how many of the
// items on screen actually have a stored PNG, so a mismatch with the Download
// all count is visible without switching modes. Amber when they disagree —
// same language the Creative Library uses for missing previews.
function SizePill({
  options,
  counts,
  values,
  onChange,
}: {
  options: string[];
  counts: Item[];
  values: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (options.length === 0) return null;
  return (
    <div ref={ref} className="multi-pill relative text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="multi-pill__button flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
      >
        <span>Size</span>
        {values.size > 0 ? (
          <span className="multi-pill__badge rounded-full bg-slate-900 px-1.5 text-[10px] font-medium text-white">
            {values.size}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="multi-pill__menu absolute left-0 top-full z-50 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg">
          {options.map((opt) => {
            const checked = values.has(opt);
            const count = counts.filter((it) => it.size === opt).length;
            return (
              <label
                key={opt}
                className="multi-pill__option flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-slate-100"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const next = new Set(values);
                    if (e.target.checked) next.add(opt);
                    else next.delete(opt);
                    onChange(next);
                  }}
                />
                <span className="flex-1 truncate font-mono">{opt}</span>
                <span className="text-[10px] text-slate-400">{count}</span>
              </label>
            );
          })}
          {values.size > 0 ? (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="multi-pill__clear mt-1 w-full rounded px-2 py-1 text-left text-[11px] text-slate-500 hover:bg-slate-100"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// "300x250" → {w,h}. Serves both the size filter's ordering and the masonry
// height estimate; null when the string is not a WxH pair (or absent).
function parseDimensions(size: string | null): { w: number; h: number } | null {
  if (!size) return null;
  const m = size.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return null;
  const w = parseInt(m[1]!, 10);
  const h = parseInt(m[2]!, 10);
  if (!w || !h) return null;
  return { w, h };
}

// Image-preview mode for an MC tile: the stored PNG, or an honest gap when the
// preview generator has not run on this MC yet. Never falls back to the live
// iframe — that would hide which MCs are missing an image, which is exactly
// what the toggle's count is there to show.
function StoredPreview({
  src,
  label,
  fill,
  size,
}: {
  src: string | null;
  label: string;
  /** true inside a fixed-size parent (card thumb, list row); false in masonry. */
  fill: boolean;
  size: string | null;
}) {
  if (!src) {
    const dims = parseDimensions(size);
    return (
      <div
        className="stored-preview stored-preview--missing flex size-full min-h-24 items-center justify-center p-2 text-center text-[10px] text-slate-400"
        // Hold the banner's shape so a missing image leaves the same gap the
        // picture would have, and the masonry columns stay as packed.
        style={!fill && dims ? { aspectRatio: `${dims.w} / ${dims.h}` } : undefined}
      >
        no preview image
      </div>
    );
  }
  const dims = parseDimensions(size);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={label}
      className={clsx("stored-preview block w-full", fill && "size-full object-contain")}
      // Reserve the banner's shape before the PNG loads. Without it every tile
      // is zero-height for a moment, the page collapses to nothing and a reader
      // who was scrolled down lands past the end of the gallery.
      style={!fill && dims ? { aspectRatio: `${dims.w} / ${dims.h}` } : undefined}
      loading="lazy"
    />
  );
}

function downloadFilenameFor(it: Item, asImage = false): string {
  if (it.kind === "creative") {
    // A creative's own file is already the image — its name is unchanged in
    // both modes.
    return it.creative.fileName ?? it.file?.filename ?? `creative-${it.creative.id}`;
  }
  const ext = asImage ? "png" : "html";
  return `MC${it.message.number}${it.message.variant}-${it.size ?? "default"}.${ext}`;
}

function labelFor(it: Item): string {
  if (it.kind === "matrix") {
    return `MC${it.message.number}${it.message.variant}`;
  }
  if (it.creative.mcNumber !== null && it.creative.mcNumber !== undefined) {
    return `MC${it.creative.mcNumber}${it.creative.mcVariant ?? ""}`;
  }
  return it.creative.fileName ?? "Creative";
}

function CommentBadge({
  count,
  loaded,
}: {
  count: number;
  loaded: boolean;
}) {
  if (!loaded || count === 0) return null;
  return (
    <span
      className="comment-badge inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
      title={`${count} comment${count === 1 ? "" : "s"}`}
    >
      <MessageSquare className="size-3" />
      {count}
    </span>
  );
}

function DownloadButtonForItem({ it, shareId }: { it: Item; shareId: string }) {
  if (it.kind === "creative") {
    return <CardDownloadCreative it={it} shareId={shareId} />;
  }
  return <CardDownloadMatrix it={it} shareId={shareId} />;
}

function CardDownloadCreative({
  it,
  shareId,
}: {
  it: Extract<Item, { kind: "creative" }>;
  shareId: string;
}) {
  if (!it.file) return null;
  return (
    <a
      href={`/share/${shareId}/file/${it.file.id}`}
      download={it.creative.fileName ?? it.file.filename}
      onClick={(e) => e.stopPropagation()}
      className="toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
    >
      <Download className="size-3" />
      Download
    </a>
  );
}

function CardDownloadMatrix({
  it,
  shareId,
}: {
  it: Extract<Item, { kind: "matrix" }>;
  shareId: string;
}) {
  async function go(e: React.MouseEvent) {
    e.stopPropagation();
    const r = await fetch("/api/render/public", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shareId,
        messageId: it.message.id,
        size: it.size,
        download: true,
      }),
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadFilenameFor(it);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <button
      type="button"
      onClick={go}
      className="toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
    >
      <Download className="size-3" />
      Download
    </button>
  );
}

function ItemCard({
  item,
  shareId,
  bg,
  commentCount,
  onOpen,
  commentsLoaded,
  imageMode,
  imageSrc,
}: {
  item: Item;
  shareId: string;
  bg: PreviewBg;
  commentCount: number;
  onOpen: () => void;
  commentsLoaded: boolean;
  imageMode: boolean;
  imageSrc: string | null;
}) {
  // Matches Creative Library's Card / MatrixIframeCard: uniform aspect-[4/3]
  // thumb so all grid tiles align; preview is letterboxed inside via the
  // fit-rect mode.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="share-gallery__card creative-card cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm transition hover:border-slate-400 hover:shadow-md"
    >
      <div
        className="share-gallery__card-thumb creative-card__thumb relative aspect-[4/3]"
        style={bgStyleFor(bg)}
      >
        {item.kind === "matrix" && imageMode ? (
          <StoredPreview
            src={imageSrc}
            label={labelFor(item)}
            fill
            size={item.size}
          />
        ) : item.kind === "matrix" && item.message.template && item.size ? (
          <PublicMatrixPreview
            shareId={shareId}
            messageId={item.message.id}
            size={item.size}
            templateName={item.message.template}
            mode="fit-rect"
          />
        ) : item.kind === "creative" ? (
          <CreativeMedia item={item} shareId={shareId} compact />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-slate-400">
            no preview
          </div>
        )}
      </div>
      <div className="share-gallery__card-meta creative-card__meta flex items-center gap-2 px-3 py-2 text-xs">
        <span className="share-gallery__mc-id rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
          {labelFor(item)}
        </span>
        {item.size ? (
          <span className="share-gallery__size text-[11px] font-mono text-slate-500">
            {item.size}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1.5">
          <CommentBadge count={commentCount} loaded={commentsLoaded} />
          <DownloadButtonForItem it={item} shareId={shareId} />
        </div>
      </div>
    </div>
  );
}

function MasonryTile({
  item,
  shareId,
  bg,
  onOpen,
  imageMode,
  imageSrc,
}: {
  item: Item;
  shareId: string;
  bg: PreviewBg;
  onOpen: () => void;
  imageMode: boolean;
  imageSrc: string | null;
}) {
  // Matches Creative Library's MatrixIframeTile / ImageTile: bare preview,
  // no meta strip. Container takes full column width; height comes from the
  // item's natural aspect ratio (matrix iframe uses fill-width, images keep
  // their native dimensions).
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="share-gallery__masonry-tile media-tile group block w-full cursor-pointer overflow-hidden rounded-md transition hover:ring-2 hover:ring-slate-300"
      style={bgStyleFor(bg)}
    >
      {item.kind === "matrix" && imageMode ? (
        <StoredPreview
          src={imageSrc}
          label={labelFor(item)}
          fill={false}
          size={item.size}
        />
      ) : item.kind === "matrix" && item.message.template && item.size ? (
        <PublicMatrixPreview
          shareId={shareId}
          messageId={item.message.id}
          size={item.size}
          templateName={item.message.template}
          mode="fill-width"
        />
      ) : item.kind === "creative" ? (
        <CreativeMedia item={item} shareId={shareId} />
      ) : null}
    </div>
  );
}

function ItemRow({
  item,
  shareId,
  bg,
  commentCount,
  onOpen,
  commentsLoaded,
  imageMode,
  imageSrc,
}: {
  item: Item;
  shareId: string;
  bg: PreviewBg;
  commentCount: number;
  onOpen: () => void;
  commentsLoaded: boolean;
  imageMode: boolean;
  imageSrc: string | null;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="share-gallery__row flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm transition hover:border-slate-400 hover:shadow-md"
    >
      <div
        className="share-gallery__row-thumb size-16 shrink-0 overflow-hidden rounded"
        style={bgStyleFor(bg)}
      >
        {item.kind === "matrix" && imageMode ? (
          <StoredPreview
            src={imageSrc}
            label={labelFor(item)}
            fill
            size={item.size}
          />
        ) : item.kind === "matrix" && item.message.template && item.size ? (
          <PublicMatrixPreview
            shareId={shareId}
            messageId={item.message.id}
            size={item.size}
            templateName={item.message.template}
            mode="fit-rect"
          />
        ) : item.kind === "creative" ? (
          <CreativeMedia item={item} shareId={shareId} compact />
        ) : null}
      </div>
      <div className="share-gallery__row-meta min-w-0 flex-1 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="share-gallery__mc-id rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
            {labelFor(item)}
          </span>
          {item.size ? (
            <span className="share-gallery__size text-[11px] font-mono text-slate-500">
              {item.size}
            </span>
          ) : null}
          <span className="truncate text-xs text-slate-700">
            {item.kind === "matrix"
              ? (item.message.headline ?? "")
              : (item.creative.fileName ?? "")}
          </span>
        </div>
      </div>
      <CommentBadge count={commentCount} loaded={commentsLoaded} />
      <DownloadButtonForItem it={item} shareId={shareId} />
    </div>
  );
}

function CreativeMedia({
  item,
  shareId,
  compact = false,
}: {
  item: Extract<Item, { kind: "creative" }>;
  shareId: string;
  compact?: boolean;
}) {
  const file = item.file;
  if (!file) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-slate-400">
        no file
      </div>
    );
  }
  const isImage = file.mimeType?.startsWith("image/") ?? false;
  const isVideo = file.mimeType?.startsWith("video/") ?? false;
  const fullSrc = `/share/${shareId}/file/${file.id}`;
  // 800px is the largest thumbnail tier the public file proxy serves (see
  // ALLOWED_THUMB_WIDTHS); use it for non-compact tiles so retina displays
  // don't render a soft 400px upscale. Compact = list-view 64px thumb.
  const thumbSrc = `/share/${shareId}/file/${file.id}?thumb=${compact ? 200 : 800}`;
  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbSrc}
        alt={item.creative.fileName ?? file.filename}
        className={clsx("block w-full", compact && "size-full object-contain")}
        loading="lazy"
      />
    );
  }
  if (isVideo) {
    return (
      <video
        src={fullSrc}
        className={clsx("block w-full", compact && "size-full object-contain")}
        controls={!compact}
        muted={compact}
        playsInline
        preload="metadata"
      />
    );
  }
  return (
    <div className="flex h-32 items-center justify-center text-xs text-slate-400">
      {file.mimeType ?? "binary"}
    </div>
  );
}
