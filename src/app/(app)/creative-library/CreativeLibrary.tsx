"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload as UploadIcon,
  Filter as FilterIcon,
  X,
  Image as ImageIcon,
  Loader2,
  Check,
  Share2,
  AlertTriangle,
} from "lucide-react";
import clsx from "clsx";
import { Masonry } from "../_components/Masonry";
import UploadDialog, { type UploadResult } from "../_components/UploadDialog";
import UploadQueue, {
  useDropTarget,
  type QueueItem,
} from "../_components/UploadQueue";
import MultiPill from "../_components/MultiPill";
import ArchiveToggle from "../_components/ArchiveToggle";
import RightToolbar from "../_components/RightToolbar";
import CreativeDetailDialog from "./CreativeDetailDialog";
import MatrixDetailDialog from "./MatrixDetailDialog";
import ShareCreateDialog from "./ShareCreateDialog";
import { useLongPress } from "@/app/_components/useLongPress";
import {
  MatrixIframeTile,
  MatrixIframeCard,
  MatrixIframeListRow,
  templateMetaFor,
} from "../_components/MatrixIframeTile";
import {
  LibraryViewSwitcher,
  LIBRARY_VIEW_CODEC,
  type LibraryViewMode,
} from "../_components/LibraryViewSwitcher";
import {
  usePersistent,
  STRING_CODEC,
  SET_CODEC,
} from "../_components/usePersistent";
import {
  ListSortHeader,
  LIST_GRID_TEMPLATE_VERSIONS,
  LIST_SORT_CODEC,
  DEFAULT_SORT,
  formatListDate,
  sortListRows,
  type SortState,
} from "../_components/ListSortHeader";
import type { ParseRules } from "@/lib/parse-filename";
import { groupCreativeVersions } from "@/lib/group-creative-versions";
import type { Message, Audience, Topic } from "../matrix/types";
import { parseSearchQuery } from "@/lib/search-query";

type TemplateInfo = {
  name: string;
  sizes: string[];
  defaultSize: string | null;
  // D1: production type. "html" or undefined → iframe-render path; other
  // kinds use the static preview image from the template folder.
  kind?: "html" | "adobe" | "figma" | "after_effects";
  previewFile?: string | null;
  externalUrl?: string | null;
};

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

type Creative = {
  id: number;
  brand: string | null;
  product: string | null;
  type: string | null;
  template: string | null;
  bannerVersion: string | null;
  visualKeyword: string | null;
  copyKeyword: string | null;
  mcNumber: number | null;
  mcVariant: string | null;
  fileId: string | null;
  fileName: string | null;
  fileFormat: string | null;
  fileSize: string | null;
  fileDimensions: string | null;
  comment: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

// Library items mix two sources: real uploaded creatives (kind: "uploaded")
// and synthesized per-MC×size virtual creatives rendered live via /api/render
// (kind: "matrix"). Matrix items carry the underlying Message + size +
// templateName so the tile and detail dialog can render the iframe.
type LibraryItem =
  | (Creative & {
      kind: "uploaded";
      // Version family (filenames differing only in _nN): the item spreads the
      // LATEST version's row; siblings ride along for the dialog's stepper.
      groupKey: string;
      versions: Creative[];
      versionCount: number;
    })
  | (Creative & {
      kind: "matrix";
      message: Message;
      liveSize: string;
      liveTemplateName: string;
    });

type UploadedFile = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  dimensions: string | null;
};

// GET /api/previews/status — html MCs with absent/stale generated previews.
type PreviewStatus = {
  staleCount: number;
  freshCount: number;
  mcCount: number;
  offenders: { mcLabel: string; sizes: string[] }[];
};

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export default function CreativeLibrary() {
  const [search, setSearch] = usePersistent(
    "mm6_creative_library_filter_search",
    "",
    STRING_CODEC,
  );
  const [products, setProducts] = usePersistent<Set<string>>(
    "mm6_creative_library_filter_products",
    new Set(),
    SET_CODEC,
  );
  const [types, setTypes] = usePersistent<Set<string>>(
    "mm6_creative_library_filter_types",
    new Set(),
    SET_CODEC,
  );
  const [sizes, setSizes] = usePersistent<Set<string>>(
    "mm6_creative_library_filter_sizes",
    new Set(),
    SET_CODEC,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [view, setView] = usePersistent<LibraryViewMode>(
    "mm6_creative_library_view",
    "masonry",
    LIBRARY_VIEW_CODEC,
  );
  const [sort, setSort] = usePersistent<SortState>(
    "mm6_creative_library_sort",
    DEFAULT_SORT,
    LIST_SORT_CODEC,
  );
  const [selectorMode, setSelectorMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [shareOpen, setShareOpen] = useState(false);

  const clearSelection = useCallback(() => {
    setSelectorMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const beginSelection = useCallback((id: number) => {
    setSelectorMode(true);
    setSelectedIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Esc clears selection (only when not editing in an input).
  useEffect(() => {
    if (!selectorMode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      clearSelection();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectorMode, clearSelection]);

  // Toggling off the last selected item should exit selectorMode so the
  // toolbar reverts and clicks resume opening the detail dialog.
  useEffect(() => {
    if (selectorMode && selectedIds.size === 0) setSelectorMode(false);
  }, [selectorMode, selectedIds]);

  const debouncedSearch = useDebouncedValue(search, 200);
  const [visibleCount, setVisibleCount] = useState(200);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const creativesQ = useQuery({
    queryKey: ["creatives", { showArchived }],
    queryFn: () =>
      fetchJSON<{ creatives: Creative[] }>(
        showArchived ? "/api/creatives?includeArchived=1" : "/api/creatives",
      ),
  });
  const filesQ = useQuery({
    queryKey: ["files", "creative"],
    queryFn: () =>
      fetchJSON<{ files: UploadedFile[] }>("/api/files?category=creative"),
  });
  const messagesQ = useQuery({
    queryKey: ["messages"],
    queryFn: () => fetchJSON<{ messages: Message[] }>("/api/messages"),
  });
  const audiencesQ = useQuery({
    queryKey: ["audiences"],
    queryFn: () => fetchJSON<{ audiences: Audience[] }>("/api/audiences"),
  });
  const topicsQ = useQuery({
    queryKey: ["topics"],
    queryFn: () => fetchJSON<{ topics: Topic[] }>("/api/topics"),
  });
  const templatesQ = useQuery({
    queryKey: ["templates", "folders"],
    queryFn: () =>
      fetchJSON<{ templates: TemplateInfo[] }>("/api/templates/folders"),
  });
  const rulesQ = useQuery({
    queryKey: ["parsingRules"],
    queryFn: () => fetchJSON<{ rules: ParseRules }>("/api/config/parsing-rules"),
  });
  const parsingRules = rulesQ.data?.rules ?? {};

  const previewStatusQ = useQuery({
    queryKey: ["previews", "status"],
    queryFn: () => fetchJSON<PreviewStatus>("/api/previews/status"),
  });

  const qcCommit = useQueryClient();
  const queue = UploadQueue({
    category: "creative",
    parsingRules,
    renderForm: ({ item, update }) => (
      <QueueItemForm item={item} update={update} />
    ),
    commitItem: async (item: QueueItem) => {
      if (!item.uploadedFileId) throw new Error("file not uploaded");
      const r = await fetch("/api/creatives", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand: item.metadata.brand || null,
          product: item.metadata.product || null,
          type: item.metadata.type || null,
          template: item.metadata.template || null,
          visualKeyword: item.metadata.visualKeyword || null,
          mcNumber: item.metadata.mcNumber
            ? Number(item.metadata.mcNumber)
            : null,
          mcVariant: item.metadata.mcVariant || null,
          comment: item.metadata.comment || null,
          fileId: item.uploadedFileId,
          fileName: item.uploadedFilename,
          fileSize: item.uploadedSize ? String(item.uploadedSize) : null,
          fileDimensions: item.uploadedDimensions,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onAllDone: () => {
      qcCommit.invalidateQueries({ queryKey: ["creatives"] });
      qcCommit.invalidateQueries({ queryKey: ["files", "creative"] });
    },
  });
  const drop = useDropTarget(queue.addFiles);

  const creatives = creativesQ.data?.creatives ?? [];
  const files = filesQ.data?.files ?? [];
  const messages = messagesQ.data?.messages ?? [];
  const audiences = audiencesQ.data?.audiences ?? [];
  const topics = topicsQ.data?.topics ?? [];
  const templates = templatesQ.data?.templates ?? [];
  const filesById = useMemo(
    () => new Map(files.map((f) => [f.id, f])),
    [files],
  );
  const audienceProductMap = useMemo(
    () => new Map(audiences.map((a) => [a.key, a.product])),
    [audiences],
  );
  const audienceMap = useMemo(
    () => new Map(audiences.map((a) => [a.key, a])),
    [audiences],
  );
  const topicMap = useMemo(
    () => new Map(topics.map((t) => [t.key, t])),
    [topics],
  );
  const templateMap = useMemo(
    () => new Map(templates.map((t) => [t.name, t])),
    [templates],
  );

  // Synthesize one virtual creative per (MC number, variant, size). The same
  // MC may appear across multiple audiences in the messages table — they
  // share content, so we dedupe by `${number}|${variant}|${size}`. Status
  // filter: live nézet csak ACTIVE-ot mutat; archived nézet minden egyebet
  // (INCOMING/NAMING/CONTENT/PREVIEW/APPROVED/INACTIVE/ERROR/DEAD/MEMORY).
  const matrixItems: LibraryItem[] = useMemo(() => {
    if (messages.length === 0 || templates.length === 0) return [];
    const seen = new Set<string>();
    const out: LibraryItem[] = [];
    for (const m of messages) {
      if (!m.template) continue;
      const tinfo = templateMap.get(m.template);
      if (!tinfo || tinfo.sizes.length === 0) continue;
      const isActive = (m.status ?? "").toUpperCase() === "ACTIVE";
      if (showArchived ? isActive : !isActive) continue;
      const product = audienceProductMap.get(m.audience) ?? null;
      const variant = m.variant ?? "";
      for (let i = 0; i < tinfo.sizes.length; i++) {
        const size = tinfo.sizes[i]!;
        const dedupKey = `${m.number}|${variant}|${size}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        out.push({
          kind: "matrix",
          id: -(m.id * 1000 + i + 1),
          brand: null,
          product,
          type: "html",
          template: m.template,
          bannerVersion: null,
          visualKeyword: null,
          copyKeyword: null,
          mcNumber: m.number,
          mcVariant: variant,
          fileId: null,
          fileName: `MC${m.number}${variant} · ${size}`,
          fileFormat: "html",
          fileSize: null,
          fileDimensions: size,
          comment: null,
          version: m.version,
          createdAt: m.updatedAt,
          updatedAt: m.updatedAt,
          archivedAt: null,
          message: m,
          liveSize: size,
          liveTemplateName: m.template,
        });
      }
    }
    return out;
  }, [messages, templates, audienceProductMap, templateMap, showArchived]);

  const items: LibraryItem[] = useMemo(() => {
    const uploaded: LibraryItem[] = groupCreativeVersions(creatives).map((g) => ({
      ...g.latest,
      kind: "uploaded",
      groupKey: g.groupKey,
      versions: g.versions,
      versionCount: g.versions.length,
    }));
    return [...uploaded, ...matrixItems];
  }, [creatives, matrixItems]);

  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of items) if (c.product) s.add(c.product);
    return [...s].sort();
  }, [items]);
  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of items) if (c.type) s.add(c.type);
    return [...s].sort();
  }, [items]);
  const sizeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of items) if (c.fileDimensions) s.add(c.fileDimensions);
    return [...s].sort((a, b) => {
      const [aw = 0] = a.split("x").map(Number);
      const [bw = 0] = b.split("x").map(Number);
      return aw - bw || a.localeCompare(b);
    });
  }, [items]);

  const predicate = useMemo(() => parseSearchQuery(debouncedSearch), [debouncedSearch]);
  const filtered = useMemo(() => {
    return items.filter((c) => {
      if (products.size > 0 && (!c.product || !products.has(c.product))) {
        return false;
      }
      if (types.size > 0 && (!c.type || !types.has(c.type))) {
        return false;
      }
      if (sizes.size > 0 && (!c.fileDimensions || !sizes.has(c.fileDimensions))) {
        return false;
      }
      const mc =
        c.mcNumber !== null
          ? `mc${c.mcNumber}${c.mcVariant ?? ""}`.toLowerCase()
          : "";
      let audience = "";
      let topic = "";
      let strategy = "";
      let platform = "";
      let free = `${c.fileName ?? ""} ${c.brand ?? ""} ${c.product ?? ""} ${c.template ?? ""} ${c.visualKeyword ?? ""} ${c.copyKeyword ?? ""} ${c.comment ?? ""}`;
      if (c.kind === "matrix") {
        const m = c.message;
        const a = audienceMap.get(m.audience);
        const t = topicMap.get(m.topic);
        audience = `${m.audience} ${a?.name ?? ""}`;
        topic = `${m.topic} ${t?.name ?? ""}`;
        strategy = a?.strategy ?? "";
        platform = a?.buyingPlatform ?? "";
        free += ` ${m.headline ?? ""} ${m.copy1 ?? ""} ${m.copy2 ?? ""} ${m.disclaimer ?? ""} ${m.name ?? ""} ${m.cta ?? ""} ${m.pmmid ?? ""} ${audience} ${topic} ${strategy} ${platform} ${a?.lineitemId ?? ""} ${a?.comment ?? ""} ${t?.comment ?? ""}`;
      }
      return predicate({
        audience: audience.toLowerCase(),
        topic: topic.toLowerCase(),
        strategy: strategy.toLowerCase(),
        platform: platform.toLowerCase(),
        mc,
        free: free.toLowerCase(),
      });
    });
  }, [items, products, types, sizes, predicate, audienceMap, topicMap]);

  const sorted = useMemo(() => sortListRows(filtered, sort), [filtered, sort]);

  useEffect(() => {
    setVisibleCount(200);
  }, [products, types, sizes, debouncedSearch, view, sort]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => c + 200);
        }
      },
      { root: scrollRef.current, rootMargin: "400px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [sorted.length, visibleCount]);

  const visible = useMemo(
    () => sorted.slice(0, visibleCount),
    [sorted, visibleCount],
  );

  const qc = useQueryClient();

  // Resolve selected items into the two id streams the share-galleries
  // endpoint accepts. Matrix-kind tiles preserve their (messageId, size) pair
  // so the share viewer can render each banner at the size the user picked.
  // Uploaded creatives contribute their creatives.id.
  const { selectedMatrixPairs, selectedCreativeIds } = useMemo(() => {
    const seen = new Set<string>();
    const matrix: Array<{ messageId: number; size: string }> = [];
    const creatives = new Set<number>();
    for (const c of items) {
      if (!selectedIds.has(c.id)) continue;
      if (c.kind === "matrix") {
        const key = `${c.message.id}|${c.liveSize}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matrix.push({ messageId: c.message.id, size: c.liveSize });
      } else {
        creatives.add(c.id);
      }
    }
    return {
      selectedMatrixPairs: matrix,
      selectedCreativeIds: Array.from(creatives),
    };
  }, [items, selectedIds]);

  return (
    <div className="creative-library flex h-full">
      <div className="creative-library__content flex flex-1 flex-col overflow-hidden">
        <Toolbar
          search={search}
          setSearch={setSearch}
          productOptions={productOptions}
          products={products}
          setProducts={setProducts}
          typeOptions={typeOptions}
          types={types}
          setTypes={setTypes}
          sizeOptions={sizeOptions}
          sizes={sizes}
          setSizes={setSizes}
          total={items.length}
          visible={filtered.length}
          previewStatus={previewStatusQ.data}
        />

        <div
          ref={scrollRef}
          className={clsx(
            "creative-library__scroll relative flex-1 overflow-auto transition",
            view === "list" ? "p-0" : "p-4",
            drop.over && "bg-slate-100 ring-2 ring-inset ring-slate-900",
          )}
          {...drop.handlers}
        >
          {drop.over ? (
            <div className="drop-overlay pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="drop-overlay__message rounded-xl bg-slate-900/90 px-5 py-3 text-sm font-medium text-white">
                Drop files to queue them
              </div>
            </div>
          ) : null}
          {creativesQ.isLoading || messagesQ.isLoading || templatesQ.isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              <Loader2 className="mr-2 size-4 animate-spin" />
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState empty={items.length === 0} onUpload={() => setUploadOpen(true)} />
          ) : (
            <>
              {view === "masonry" ? (
                <div className="creative-library__view creative-library__view--masonry">
                  <Masonry
                    items={visible}
                    itemKey={(c) => (c.kind === "uploaded" ? c.groupKey : c.id)}
                    render={(c) => (
                      <SelectableItem
                        id={c.id}
                        selectorMode={selectorMode}
                        selected={selectedIds.has(c.id)}
                        onLongPress={beginSelection}
                        onSelect={toggleSelected}
                      >
                        {c.kind === "matrix" ? (
                          <MatrixIframeTile
                            message={c.message}
                            templateName={c.liveTemplateName}
                            size={c.liveSize}
                            templateMeta={templateMetaFor(templateMap.get(c.liveTemplateName))}
                            onOpen={() => setDetailId(c.id)}
                          />
                        ) : (
                          <ImageTile
                            creative={c}
                            file={c.fileId ? filesById.get(c.fileId) : undefined}
                            onOpen={() => setDetailId(c.id)}
                          />
                        )}
                      </SelectableItem>
                    )}
                  />
                </div>
              ) : view === "grid" ? (
                <div className="creative-library__view creative-library__view--grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {visible.map((c) => (
                    <SelectableItem
                      key={c.id}
                      id={c.id}
                      selectorMode={selectorMode}
                      selected={selectedIds.has(c.id)}
                      onLongPress={beginSelection}
                      onSelect={toggleSelected}
                    >
                      {c.kind === "matrix" ? (
                        <MatrixIframeCard
                          message={c.message}
                          templateName={c.liveTemplateName}
                          size={c.liveSize}
                          product={c.product}
                          templateMeta={templateMetaFor(templateMap.get(c.liveTemplateName))}
                          onOpen={() => setDetailId(c.id)}
                        />
                      ) : (
                        <Card
                          creative={c}
                          file={c.fileId ? filesById.get(c.fileId) : undefined}
                          onOpen={() => setDetailId(c.id)}
                        />
                      )}
                    </SelectableItem>
                  ))}
                </div>
              ) : (
                <div className="creative-library__view creative-library__view--list flex flex-col">
                  <ListSortHeader sort={sort} onChange={setSort} withVersions />
                  {visible.map((c) => (
                    <SelectableItem
                      key={c.id}
                      id={c.id}
                      selectorMode={selectorMode}
                      selected={selectedIds.has(c.id)}
                      onLongPress={beginSelection}
                      onSelect={toggleSelected}
                    >
                      {c.kind === "matrix" ? (
                        <MatrixIframeListRow
                          message={c.message}
                          templateName={c.liveTemplateName}
                          size={c.liveSize}
                          product={c.product}
                          createdAt={c.createdAt}
                          updatedAt={c.updatedAt}
                          templateMeta={templateMetaFor(templateMap.get(c.liveTemplateName))}
                          onOpen={() => setDetailId(c.id)}
                        />
                      ) : (
                        <ListRow
                          creative={c}
                          file={c.fileId ? filesById.get(c.fileId) : undefined}
                          onOpen={() => setDetailId(c.id)}
                        />
                      )}
                    </SelectableItem>
                  ))}
                </div>
              )}
              {visibleCount < sorted.length ? (
                <div ref={sentinelRef} className="h-1 w-full" aria-hidden />
              ) : null}
            </>
          )}
        </div>

        {queue.panel}

        <UploadDialog
          open={uploadOpen}
          category="creative"
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            qc.invalidateQueries({ queryKey: ["files", "creative"] });
          }}
          metadataForm={({ file, submit, submitting }) => (
            <CreativeMetadataForm file={file} submit={submit} submitting={submitting} />
          )}
        />

        <ShareCreateDialog
          open={shareOpen}
          matrix={selectedMatrixPairs}
          creativeIds={selectedCreativeIds}
          onClose={() => setShareOpen(false)}
          onCreated={clearSelection}
        />

        {detailId !== null
          ? (() => {
              const c =
                sorted.find((x) => x.id === detailId) ??
                items.find((x) => x.id === detailId);
              if (!c) return null;
              if (c.kind === "matrix") {
                return (
                  <MatrixDetailDialog
                    item={{
                      id: c.id,
                      message: c.message,
                      liveSize: c.liveSize,
                      liveTemplateName: c.liveTemplateName,
                      product: c.product,
                    }}
                    navItems={sorted}
                    onJump={(id) => setDetailId(id)}
                    onClose={() => setDetailId(null)}
                  />
                );
              }
              return (
                <CreativeDetailDialog
                  creative={c}
                  creatives={sorted}
                  versions={c.versions}
                  filesById={filesById}
                  onJump={(id) => setDetailId(id)}
                  onClose={() => setDetailId(null)}
                />
              );
            })()
          : null}
      </div>

      <RightToolbar storageKey="mm6_creative_library_right_toolbar_open">
        {(collapsed) => {
          const selectionBlock = selectedIds.size > 0 ? (
            <SelectionActions
              collapsed={collapsed}
              count={selectedIds.size}
              onShare={() => setShareOpen(true)}
              onCancel={clearSelection}
            />
          ) : null;
          const content = (
            <>
              {selectionBlock}
              <LibraryViewSwitcher view={view} setView={setView} collapsed={collapsed} />
              <ArchiveToggle
                showArchived={showArchived}
                onChange={setShowArchived}
                collapsed={collapsed}
                className="mt-auto"
              />
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                title="Upload"
                aria-label="Upload"
                className={clsx(
                  "toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 font-medium text-white hover:bg-slate-800",
                  collapsed ? "size-9" : "px-3 py-1.5 text-xs",
                )}
              >
                <UploadIcon className="size-3.5" />
                {!collapsed ? "Upload" : null}
              </button>
            </>
          );
          return collapsed ? content : <div className="flex h-full flex-col gap-3">{content}</div>;
        }}
      </RightToolbar>
    </div>
  );
}

function Toolbar({
  search,
  setSearch,
  productOptions,
  products,
  setProducts,
  typeOptions,
  types,
  setTypes,
  sizeOptions,
  sizes,
  setSizes,
  total,
  visible,
  previewStatus,
}: {
  search: string;
  setSearch: (s: string) => void;
  productOptions: string[];
  products: Set<string>;
  setProducts: (s: Set<string>) => void;
  typeOptions: string[];
  types: Set<string>;
  setTypes: (s: Set<string>) => void;
  sizeOptions: string[];
  sizes: Set<string>;
  setSizes: (s: Set<string>) => void;
  total: number;
  visible: number;
  previewStatus: PreviewStatus | undefined;
}) {
  const activeFilters = products.size + types.size + sizes.size + (search ? 1 : 0);
  return (
    <div className="toolbar creative-library__toolbar sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
      <div className="flex items-baseline gap-2">
        <div className="toolbar__title text-sm font-semibold text-slate-900">Creative Library</div>
      </div>

      <div className="input-box input-box--with-icon relative ml-2">
        <FilterIcon className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          placeholder="Filter… a: t: s: p: mc: OR …"
          title='Free text searches all fields. Prefixes: a: (audience), t: (topic), s: (strategy), p: (platform), mc: (MC#). AND implicit, OR explicit. Quote "two words" for phrases.'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-box__field w-72 rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
        />
      </div>

      <MultiPill label="Product" values={products} options={productOptions} onChange={setProducts} />
      <MultiPill label="Type" values={types} options={typeOptions} onChange={setTypes} />
      <MultiPill label="Size" values={sizes} options={sizeOptions} onChange={setSizes} />

      {activeFilters > 0 ? (
        <button
          onClick={() => {
            setProducts(new Set());
            setTypes(new Set());
            setSizes(new Set());
            setSearch("");
          }}
          className="toolbar-btn flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          <X className="size-3" />
          Clear
        </button>
      ) : null}

      {previewStatus && previewStatus.mcCount > 0 ? (
        <PreviewWarning status={previewStatus} />
      ) : null}

      <div className="toolbar__count ml-auto text-[11px] text-slate-500">
        {visible}/{total} creatives
      </div>
    </div>
  );
}

// Amber pill + offender dropdown: html MCs whose generated preview PNGs are
// absent or stale (edited since the last `npm run gen:previews`).
function PreviewWarning({ status }: { status: PreviewStatus }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
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

  return (
    <div ref={ref} className="creative-library__preview-warning relative text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${status.staleCount} size preview(s) across ${status.mcCount} MC(s) are missing or outdated — run \`npm run gen:previews\` to refresh. Click for the list.`}
        className="creative-library__preview-warning-btn inline-flex cursor-pointer items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
      >
        <AlertTriangle className="size-3" />
        {status.mcCount} MC{status.mcCount === 1 ? "" : "s"} missing previews
      </button>
      {open ? (
        <div className="creative-library__preview-warning-menu absolute left-0 top-full z-50 mt-1 max-h-72 w-72 overflow-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg">
          {status.offenders.map((o) => (
            <div
              key={o.mcLabel}
              className="creative-library__preview-warning-row flex items-baseline justify-between gap-2 rounded px-2 py-1 hover:bg-slate-100"
            >
              <span className="truncate font-mono">{o.mcLabel}</span>
              <span className="shrink-0 text-[10px] text-slate-500">
                {o.sizes.join(", ")}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Card({
  creative,
  file,
  onOpen,
}: {
  creative: Creative;
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const mcLabel =
    creative.mcNumber !== null
      ? `MC${creative.mcNumber}${creative.mcVariant ?? ""}`
      : null;
  const archived = creative.archivedAt !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "creative-card group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left transition hover:border-slate-400 hover:shadow-md [content-visibility:auto] [contain-intrinsic-size:auto_220px]",
        archived && "row--archived",
      )}
    >
      <div className="creative-card__thumb thumb-checker relative aspect-[4/3]">
        {isImage && creative.fileId ? (
          <img
            src={`/api/files/${creative.fileId}/thumbnail?w=240`}
            alt={creative.fileName ?? "creative"}
            className="size-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : isVideo && creative.fileId ? (
          <video
            src={`/api/files/${creative.fileId}#t=0.1`}
            className="size-full object-contain"
            preload="metadata"
            muted
            playsInline
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-slate-50 text-slate-300">
            <ImageIcon className="size-8" />
          </div>
        )}
      </div>
      <div className="creative-card__meta p-2 text-xs">
        <div className="flex items-baseline gap-2">
          {mcLabel ? (
            <span className="creative-card__mc font-mono font-semibold text-slate-900">{mcLabel}</span>
          ) : null}
          <span className="creative-card__filename row--archived__filename truncate text-slate-700" title={creative.fileName ?? ""}>
            {creative.fileName ?? "(no file)"}
          </span>
        </div>
        <div className="creative-card__tags mt-0.5 flex flex-wrap gap-1 text-[10px] text-slate-500">
          {creative.brand ? <span className="tag-chip">{creative.brand}</span> : null}
          {creative.product ? <span className="tag-chip">· {creative.product}</span> : null}
          {creative.template ? <span className="tag-chip">· {creative.template}</span> : null}
          {creative.fileDimensions ? <span className="tag-chip">· {creative.fileDimensions}</span> : null}
        </div>
      </div>
    </button>
  );
}

function ImageTile({
  creative,
  file,
  onOpen,
}: {
  creative: Creative;
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const archived = creative.archivedAt !== null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "media-tile thumb-checker group block w-full overflow-hidden rounded-md [content-visibility:auto] [contain-intrinsic-size:auto_300px]",
        archived && "row--archived",
      )}
    >
      {isImage && creative.fileId ? (
        <img
          src={`/api/files/${creative.fileId}/thumbnail?w=320`}
          alt={creative.fileName ?? "creative"}
          className="media-tile__image block w-full"
          loading="lazy"
          decoding="async"
        />
      ) : isVideo && creative.fileId ? (
        <video
          src={`/api/files/${creative.fileId}#t=0.1`}
          className="media-tile__image block w-full"
          preload="metadata"
          muted
          playsInline
        />
      ) : (
        <div className="media-tile__placeholder flex aspect-[4/3] items-center justify-center bg-slate-50 text-slate-300">
          <ImageIcon className="size-8" />
        </div>
      )}
    </button>
  );
}

function ListRow({
  creative,
  file,
  onOpen,
}: {
  creative: Creative & { versionCount?: number };
  file: UploadedFile | undefined;
  onOpen: () => void;
}) {
  const isImage = file?.mimeType?.startsWith("image/");
  const isVideo = file?.mimeType?.startsWith("video/");
  const mcLabel =
    creative.mcNumber !== null
      ? `MC${creative.mcNumber}${creative.mcVariant ?? ""}`
      : null;
  const archived = creative.archivedAt !== null;
  const createdTitle = creative.createdAt ? new Date(creative.createdAt).toLocaleString() : "";
  const updatedTitle = creative.updatedAt ? new Date(creative.updatedAt).toLocaleString() : "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={clsx(
        "creative-row group grid w-full items-center border-b border-slate-100 bg-white text-left text-xs transition hover:bg-slate-50 [content-visibility:auto] [contain-intrinsic-size:auto_52px]",
        archived && "row--archived",
      )}
      style={{ gridTemplateColumns: LIST_GRID_TEMPLATE_VERSIONS }}
    >
      <div className="creative-row__thumb thumb-checker my-1 ml-2 mr-0 size-10 shrink-0 overflow-hidden rounded border border-slate-200">
        {isImage && creative.fileId ? (
          <img
            src={`/api/files/${creative.fileId}/thumbnail?w=96`}
            alt={creative.fileName ?? "creative"}
            className="size-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : isVideo && creative.fileId ? (
          <video
            src={`/api/files/${creative.fileId}#t=0.1`}
            className="size-full object-contain"
            preload="metadata"
            muted
            playsInline
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-slate-50 text-slate-300">
            <ImageIcon className="size-5" />
          </div>
        )}
      </div>
      <div className="creative-row__mc truncate border-r border-slate-100 px-3 py-2 font-mono text-[11px] font-semibold text-slate-900">
        {mcLabel ?? "—"}
      </div>
      <div className="creative-row__name min-w-0 border-r border-slate-100 px-3 py-2">
        <span
          className="creative-row__filename row--archived__filename block truncate text-slate-700"
          title={creative.fileName ?? ""}
        >
          {creative.fileName ?? "(no file)"}
        </span>
      </div>
      <div
        className="creative-row__product truncate border-r border-slate-100 px-3 py-2 text-slate-600"
        title={creative.product ?? ""}
      >
        {creative.product ?? "—"}
      </div>
      <div className="creative-row__type truncate border-r border-slate-100 px-3 py-2 text-slate-600">
        {creative.type ?? "—"}
      </div>
      <div className="creative-row__size truncate border-r border-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600">
        {creative.fileDimensions ?? "—"}
      </div>
      <div className="creative-row__versions truncate border-r border-slate-100 px-3 py-2 text-slate-600">
        {creative.versionCount != null && creative.versionCount > 1
          ? `${creative.versionCount} versions`
          : "—"}
      </div>
      <div
        className="creative-row__created truncate border-r border-slate-100 px-3 py-2 text-slate-500"
        title={createdTitle}
      >
        {formatListDate(creative.createdAt)}
      </div>
      <div
        className="creative-row__updated truncate px-3 py-2 text-slate-500"
        title={updatedTitle}
      >
        {formatListDate(creative.updatedAt)}
      </div>
    </button>
  );
}

function CreativeMetadataForm({
  file,
  submit,
  submitting,
}: {
  file: UploadResult | null;
  submit: (extra: Record<string, unknown>) => Promise<void>;
  submitting: boolean;
}) {
  const [brand, setBrand] = useState("");
  const [product, setProduct] = useState("");
  const [type, setType] = useState("");
  const [template, setTemplate] = useState("");
  const [mcNumber, setMcNumber] = useState("");
  const [mcVariant, setMcVariant] = useState("");
  const [comment, setComment] = useState("");
  const qc = useQueryClient();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const r = await fetch("/api/creatives", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        brand: brand || null,
        product: product || null,
        type: type || null,
        template: template || null,
        mcNumber: mcNumber ? Number(mcNumber) : null,
        mcVariant: mcVariant || null,
        comment: comment || null,
        fileId: file.fileId,
        fileName: file.filename,
        fileSize: file.sizeBytes ? String(file.sizeBytes) : null,
        fileDimensions: file.dimensions,
      }),
    });
    if (!r.ok) {
      alert(await r.text());
      return;
    }
    qc.invalidateQueries({ queryKey: ["creatives"] });
    await submit({});
  }

  return (
    <form onSubmit={onSubmit} className="creative-metadata-form space-y-2 text-xs">
      <div className="form-grid grid grid-cols-2 gap-2">
        <Field label="Brand">
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Product">
          <input value={product} onChange={(e) => setProduct(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Type">
          <input value={type} onChange={(e) => setType(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Template">
          <input value={template} onChange={(e) => setTemplate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="MC number">
          <input value={mcNumber} onChange={(e) => setMcNumber(e.target.value)} className={inputCls} />
        </Field>
        <Field label="MC variant">
          <input value={mcVariant} onChange={(e) => setMcVariant(e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label="Comment">
        <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputCls} />
      </Field>
      <button
        type="submit"
        disabled={submitting}
        className={clsx(
          "toolbar-btn--primary mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white",
          submitting && "opacity-50",
        )}
      >
        {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Save creative
      </button>
    </form>
  );
}

const inputCls =
  "input-box w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none";

function QueueItemForm({
  item,
  update,
}: {
  item: QueueItem;
  update: (patch: Partial<QueueItem["metadata"]>) => void;
}) {
  const cellCls =
    "input-box rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs focus:border-slate-500 focus:outline-none";
  const fields: Array<{ k: string; label: string }> = [
    { k: "brand", label: "Brand" },
    { k: "product", label: "Product" },
    { k: "type", label: "Type" },
    { k: "mcNumber", label: "MC#" },
    { k: "mcVariant", label: "Variant" },
  ];
  return (
    <div className="upload-queue__item-form form-grid grid grid-cols-5 gap-1.5">
      {fields.map((f) => (
        <label key={f.k} className="form-field block">
          <div className="form-field__label mb-0.5 text-[9px] uppercase tracking-wide text-slate-500">
            {f.label}
          </div>
          <input
            value={item.metadata[f.k] ?? ""}
            onChange={(e) => update({ [f.k]: e.target.value })}
            className={cellCls}
          />
        </label>
      ))}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field block">
      <div className="form-field__label mb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      {children}
    </label>
  );
}

function SelectionActions({
  collapsed,
  count,
  onShare,
  onCancel,
}: {
  collapsed: boolean;
  count: number;
  onShare: () => void;
  onCancel: () => void;
}) {
  if (collapsed) {
    return (
      <div className="selection-actions selection-actions--collapsed flex flex-col items-center gap-2 border-b border-slate-200 pb-2">
        <span
          className="selection-actions__count flex size-9 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white"
          title={`${count} selected`}
        >
          {count}
        </span>
        <button
          type="button"
          onClick={onShare}
          title="Share selected"
          aria-label="Share selected"
          className="toolbar-btn--primary flex size-9 items-center justify-center rounded-md bg-slate-900 text-white hover:bg-slate-800"
        >
          <Share2 className="size-4" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel selection"
          aria-label="Cancel selection"
          className="toolbar-btn flex size-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="selection-actions flex flex-col gap-2 border-b border-slate-200 pb-3">
      <div className="selection-actions__count text-xs font-semibold text-slate-700">
        {count} selected
      </div>
      <button
        type="button"
        onClick={onShare}
        className="toolbar-btn--primary inline-flex items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        <Share2 className="size-3.5" />
        Share
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="toolbar-btn inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        <X className="size-3" />
        Cancel
      </button>
    </div>
  );
}

function SelectableItem({
  id,
  selectorMode,
  selected,
  onLongPress,
  onSelect,
  children,
}: {
  id: number;
  selectorMode: boolean;
  selected: boolean;
  onLongPress: (id: number) => void;
  onSelect: (id: number) => void;
  children: ReactNode;
}) {
  const longPress = useLongPress(() => onLongPress(id));
  return (
    <div
      className={clsx(
        "selectable-item relative",
        selected && "selectable-item--selected",
      )}
      onPointerDown={longPress.onPointerDown}
      onPointerUp={longPress.onPointerUp}
      onPointerLeave={longPress.onPointerLeave}
      onPointerMove={longPress.onPointerMove}
      onClickCapture={(e) => {
        if (longPress.consumeNextClick()) {
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        if (selectorMode) {
          e.stopPropagation();
          e.preventDefault();
          onSelect(id);
        }
      }}
    >
      {children}
      {selectorMode ? (
        <span
          aria-hidden
          className={clsx(
            "selector-checkbox pointer-events-none absolute right-2 top-2 z-20 flex size-5 items-center justify-center rounded-full border shadow-sm",
            selected
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-400 bg-white/80 text-transparent",
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : null}
      {selected ? (
        <span
          aria-hidden
          className="selectable-item__ring pointer-events-none absolute inset-0 z-10 rounded-md ring-2 ring-slate-900"
        />
      ) : null}
    </div>
  );
}

function EmptyState({
  empty,
  onUpload,
}: {
  empty: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="empty-state creative-library__empty max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <ImageIcon className="empty-state__icon mx-auto mb-2 size-8 text-slate-400" />
        <h2 className="empty-state__title text-sm font-semibold text-slate-900">
          {empty ? "No creatives yet" : "No creatives match the filters"}
        </h2>
        <p className="empty-state__hint mt-1 text-xs text-slate-500">
          {empty
            ? "Upload an HTML banner, a static image, or a video clip."
            : "Clear filters or adjust the search to see all creatives."}
        </p>
        {empty ? (
          <button
            onClick={onUpload}
            className="toolbar-btn--primary mt-4 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            <UploadIcon className="size-3.5" />
            Upload first creative
          </button>
        ) : null}
      </div>
    </div>
  );
}

