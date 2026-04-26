"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { html as htmlLang } from "@codemirror/lang-html";
import { css as cssLang } from "@codemirror/lang-css";
import { json as jsonLang } from "@codemirror/lang-json";
import { javascript as jsLang } from "@codemirror/lang-javascript";
import {
  Plus,
  Save,
  Check,
  AlertCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Sun,
  Moon,
  Grid as GridIcon,
  ChevronLeft,
  ChevronRight,
  Type,
  Image as ImageIcon,
  Video,
  Link as LinkIcon,
  Tag as TagIcon,
  Palette,
  Filter,
} from "lucide-react";
import clsx from "clsx";

type FileInfo = {
  name: string;
  ext: string;
  bytes: number;
  size?: string;
  isText: boolean;
};

type TemplatePlaceholder = {
  name: string;
  type: string;
  default: string;
  binding?: string;
  options?: string[];
};

type TemplateInfo = {
  name: string;
  sizes: string[];
  defaultSize: string | null;
  placeholders: TemplatePlaceholder[];
  tagOptions: string[];
};

type TemplateDetail = { template: TemplateInfo; files: FileInfo[] };

type SaveState = "idle" | "saving" | "saved" | "error";

type Message = {
  id: number;
  number: number;
  variant: string;
  versionNo: number | null;
  status: string | null;
  audience: string;
  topic: string;
  name: string | null;
  headline: string | null;
  copy1: string | null;
  copy2: string | null;
  cta: string | null;
  landingUrl: string | null;
  template: string | null;
  templateVariantClasses: string | null;
  pmmid: string | null;
  finalTraffickedUrl: string | null;
  [k: string]: unknown;
};

const DEFAULT_STATUS_COLORS: Record<string, string> = {
  INCOMING: "#8B5CF6",
  NAMING: "#F59E0B",
  CONTENT: "#EC4899",
  PREVIEW: "#3B82F6",
  APPROVED: "#10B981",
  ACTIVE: "#06B6D4",
  INACTIVE: "#9CA3AF",
  ERROR: "#EF4444",
  DEAD: "#64748B",
  MEMORY: "#06B6D4",
};

function statusColorFor(
  status: string | null | undefined,
  custom: Record<string, string> = {},
): string {
  const s = (status || "INCOMING").toUpperCase();
  return custom[s] || DEFAULT_STATUS_COLORS[s] || DEFAULT_STATUS_COLORS.INCOMING;
}

const STORAGE_KEY = "mm6_templates_editor_state_v1";

type Persisted = {
  activeTemplate?: string;
  previewBg?: "light" | "dark" | "checker";
  skipAnim?: boolean;
  typeFilters?: Record<string, boolean>;
  splitPercent?: number;
  perTemplate?: Record<string, { file?: string; size?: string }>;
};

function loadPersisted(): Persisted {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Persisted;
  } catch {
    return {};
  }
}

function savePersisted(p: Persisted) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // quota exceeded or storage disabled — ignore
  }
}

const PLACEHOLDER_TYPES = ["text", "var", "image", "video", "url", "tag", "style"] as const;
type PHType = (typeof PLACEHOLDER_TYPES)[number];

const TYPE_COLORS: Record<string, string> = {
  text: "#3b82f6",
  var: "#3b82f6",
  image: "#10b981",
  video: "#8b5cf6",
  url: "#f59e0b",
  tag: "#ec4899",
  style: "#6366f1",
};

function TypeIcon({ type, size = 14, color }: { type: string; size?: number; color?: string }) {
  const props = { size, color };
  switch (type) {
    case "image":
      return <ImageIcon {...props} />;
    case "video":
      return <Video {...props} />;
    case "url":
      return <LinkIcon {...props} />;
    case "tag":
      return <TagIcon {...props} />;
    case "style":
      return <Palette {...props} />;
    default:
      return <Type {...props} />;
  }
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { credentials: "include", ...init });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}

function languageFor(ext: string) {
  if (ext === ".html" || ext === ".svg") return [htmlLang()];
  if (ext === ".css") return [cssLang()];
  if (ext === ".json") return [jsonLang()];
  if (ext === ".js") return [jsLang()];
  return [];
}

function isLandscape(size: string | null): boolean {
  if (!size) return false;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return false;
  const w = parseInt(m[1], 10);
  const h = parseInt(m[2], 10);
  if (h === 0) return false;
  return w / h >= 1.5;
}

export default function TemplateEditor() {
  const qc = useQueryClient();
  const persistedRef = useRef<Persisted>(loadPersisted());
  const persisted = persistedRef.current;

  const [activeTemplate, setActiveTemplate] = useState<string | null>(
    persisted.activeTemplate ?? null,
  );
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [buffer, setBuffer] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewSize, setPreviewSize] = useState<string | null>(null);
  const [previewBg, setPreviewBg] = useState<"light" | "dark" | "checker">(
    persisted.previewBg ?? "light",
  );
  const [skipAnim, setSkipAnim] = useState(persisted.skipAnim ?? false);
  const [splitPercent, setSplitPercent] = useState(persisted.splitPercent ?? 50);
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [selectedMcId, setSelectedMcId] = useState<number | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [bindingsOpen, setBindingsOpen] = useState(false);
  const [typeFilters, setTypeFilters] = useState<Record<PHType, boolean>>(() => {
    const stored = persisted.typeFilters;
    const dflt: Record<PHType, boolean> = {
      text: true, var: true, image: true, video: true,
      url: true, tag: true, style: true,
    };
    if (!stored) return dflt;
    return { ...dflt, ...stored } as Record<PHType, boolean>;
  });
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");

  const wide = isLandscape(previewSize);

  const foldersQ = useQuery({
    queryKey: ["templates", "all"],
    queryFn: () => fetchJSON<{ templates: TemplateInfo[] }>("/api/templates/folders"),
  });

  const messagesQ = useQuery({
    queryKey: ["messages"],
    queryFn: () => fetchJSON<{ messages: Message[] }>("/api/messages"),
  });

  const lookAndFeelQ = useQuery({
    queryKey: ["config-public"],
    queryFn: () =>
      fetchJSON<{ lookAndFeel: { statusColors?: Record<string, string> } }>(
        "/api/config-public",
      ),
  });
  const customStatusColors = lookAndFeelQ.data?.lookAndFeel?.statusColors ?? {};

  const uniqueCards: Message[] = (() => {
    const all = messagesQ.data?.messages ?? [];
    const seen = new Map<string, Message>();
    for (const m of all) {
      if (m.status === "deleted") continue;
      const key = `${m.number}${m.variant}`;
      const existing = seen.get(key);
      if (!existing || (m.versionNo ?? 0) > (existing.versionNo ?? 0)) {
        seen.set(key, m);
      }
    }
    return [...seen.values()].sort(
      (a, b) => a.number - b.number || a.variant.localeCompare(b.variant),
    );
  })();
  const selectedCard = uniqueCards.find((c) => c.id === selectedMcId) ?? null;

  function stepMc(delta: 1 | -1) {
    if (uniqueCards.length === 0) return;
    const idx = uniqueCards.findIndex((c) => c.id === selectedMcId);
    if (idx === -1) {
      setSelectedMcId(uniqueCards[0].id);
      return;
    }
    const next = (idx + delta + uniqueCards.length) % uniqueCards.length;
    setSelectedMcId(uniqueCards[next].id);
  }

  useEffect(() => {
    const list = foldersQ.data?.templates ?? [];
    if (list.length === 0) return;
    // If persisted activeTemplate no longer exists on disk, fall back.
    if (activeTemplate && !list.find((t) => t.name === activeTemplate)) {
      setActiveTemplate(list[0].name);
      return;
    }
    if (!activeTemplate) setActiveTemplate(list[0].name);
  }, [foldersQ.data, activeTemplate]);

  const detailQ = useQuery({
    queryKey: ["templates", "detail", activeTemplate],
    queryFn: () =>
      fetchJSON<TemplateDetail>(`/api/templates/${encodeURIComponent(activeTemplate!)}`),
    enabled: !!activeTemplate,
  });

  useEffect(() => {
    if (!detailQ.data || !activeTemplate) return;
    const files = detailQ.data.files;
    const sizes = detailQ.data.template.sizes;
    const perT = persistedRef.current.perTemplate?.[activeTemplate];
    if (!activeFile || !files.find((f) => f.name === activeFile)) {
      const remembered = perT?.file;
      setActiveFile(
        remembered && files.find((f) => f.name === remembered)
          ? remembered
          : (files[0]?.name ?? null),
      );
    }
    if (!previewSize || !sizes.includes(previewSize)) {
      const remembered = perT?.size;
      setPreviewSize(
        remembered && sizes.includes(remembered)
          ? remembered
          : (detailQ.data.template.defaultSize ?? sizes[0] ?? null),
      );
    }
  }, [detailQ.data, activeTemplate, activeFile, previewSize]);

  // Persist user preferences to localStorage whenever they change.
  useEffect(() => {
    const cur = loadPersisted();
    const perTemplate = { ...(cur.perTemplate ?? {}) };
    if (activeTemplate) {
      const existing = perTemplate[activeTemplate] ?? {};
      perTemplate[activeTemplate] = {
        file: activeFile ?? existing.file,
        size: previewSize ?? existing.size,
      };
    }
    savePersisted({
      activeTemplate: activeTemplate ?? cur.activeTemplate,
      previewBg,
      skipAnim,
      typeFilters,
      splitPercent,
      perTemplate,
    });
  }, [
    activeTemplate,
    activeFile,
    previewSize,
    previewBg,
    skipAnim,
    typeFilters,
    splitPercent,
  ]);

  const fileQ = useQuery({
    queryKey: ["templates", "file", activeTemplate, activeFile],
    queryFn: () =>
      fetchText(
        `/api/templates/${encodeURIComponent(activeTemplate!)}/${encodeURIComponent(activeFile!)}`,
      ),
    enabled: !!activeTemplate && !!activeFile && isCurrentFileText(),
  });

  function isCurrentFileText(): boolean {
    const f = detailQ.data?.files.find((x) => x.name === activeFile);
    return !!f?.isText;
  }

  useEffect(() => {
    if (fileQ.data !== undefined) {
      setBuffer(fileQ.data);
      setDirty(false);
      setSaveState("idle");
      setSaveError(null);
    }
  }, [fileQ.data, activeTemplate, activeFile]);

  const saveMut = useMutation({
    mutationFn: async (content: string) => {
      const r = await fetch(
        `/api/templates/${encodeURIComponent(activeTemplate!)}/${encodeURIComponent(activeFile!)}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: content,
        },
      );
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(err.error || r.statusText);
      }
      return r.json() as Promise<{ ok: true; bytes: number }>;
    },
    onSuccess: () => {
      setSaveState("saved");
      setDirty(false);
      setSaveError(null);
      qc.invalidateQueries({ queryKey: ["templates", "detail", activeTemplate] });
      schedulePreview();
      setTimeout(() => setSaveState((s) => (s === "saved" ? "idle" : s)), 2000);
    },
    onError: (e: Error) => {
      setSaveState("error");
      setSaveError(e.message);
    },
  });

  function performSave() {
    if (!activeTemplate || !activeFile || !dirty) return;
    setSaveState("saving");
    saveMut.mutate(buffer);
  }

  function revertChanges() {
    if (!dirty) return;
    setBuffer(fileQ.data ?? "");
    setDirty(false);
    setSaveState("idle");
    setSaveError(null);
  }

  function onChange(value: string) {
    setBuffer(value);
    setDirty(true);
    setSaveState("idle");
    setSaveError(null);
  }

  function confirmDiscardOrStay(): boolean {
    if (!dirty) return true;
    return window.confirm(
      `Discard unsaved changes in ${activeFile ?? "this file"}?`,
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        performSave();
      }
      if (e.key === "Escape") {
        if (filesOpen) setFilesOpen(false);
        else if (bindingsOpen) setBindingsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplate, activeFile, buffer, dirty, filesOpen, bindingsOpen]);

  function schedulePreview() {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(refreshPreview, 200);
  }

  async function refreshPreview() {
    if (!activeTemplate || !previewSize) return;
    try {
      const r = await fetch("/api/render", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateName: activeTemplate,
          size: previewSize,
          inline: true,
          skipAnimations: skipAnim,
          message: selectedCard
            ? messageForRender(selectedCard, skipAnim)
            : synthMessage(detailQ.data?.template, skipAnim),
        }),
      });
      if (!r.ok) {
        setPreviewHtml(`<pre style="padding:1rem;color:#b91c1c">render failed: ${r.status}</pre>`);
        return;
      }
      setPreviewHtml(await r.text());
    } catch (e) {
      setPreviewHtml(`<pre style="padding:1rem;color:#b91c1c">${(e as Error).message}</pre>`);
    }
  }

  useEffect(() => {
    schedulePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTemplate, previewSize, skipAnim, selectedMcId]);

  // Track preview box size for ad-scale-to-fit.
  useEffect(() => {
    if (!previewBoxRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBoxSize({ w: cr.width, h: cr.height });
    });
    ro.observe(previewBoxRef.current);
    return () => ro.disconnect();
  }, []);

  // Draggable divider between editor and preview.
  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = wide ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
  }
  useEffect(() => {
    function onMove(ev: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      // splitPercent = preview's share of the container.
      let pct: number;
      if (wide) {
        // preview on top, editor on bottom — preview pct = mouseY / height
        pct = ((ev.clientY - rect.top) / rect.height) * 100;
      } else {
        // editor on left, preview on right — preview pct = (right - mouseX) / width
        pct = ((rect.right - ev.clientX) / rect.width) * 100;
      }
      setSplitPercent(Math.max(20, Math.min(80, pct)));
    }
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);

  const templates = foldersQ.data?.templates ?? [];
  const files = detailQ.data?.files ?? [];
  const placeholders = detailQ.data?.template.placeholders ?? [];
  const visiblePlaceholders = placeholders.filter((p) => {
    const t = (PLACEHOLDER_TYPES.includes(p.type as PHType) ? p.type : "text") as PHType;
    return typeFilters[t];
  });

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <select
            value={activeTemplate ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              if (!confirmDiscardOrStay()) return;
              setActiveTemplate(next);
              setActiveFile(null);
              setPreviewSize(null);
              setDirty(false);
              setSaveState("idle");
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-900"
          >
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <NewTemplateButton
            onCreated={(name) => {
              qc.invalidateQueries({ queryKey: ["templates", "all"] });
              setActiveTemplate(name);
              setActiveFile(null);
            }}
          />
          <span className="ml-2 text-xs text-slate-500">
            {templates.length} templates
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Preview with:</span>
          <button
            onClick={() => stepMc(-1)}
            disabled={uniqueCards.length === 0}
            className="rounded border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Previous MC"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <div className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                backgroundColor: selectedCard
                  ? statusColorFor(selectedCard.status, customStatusColors)
                  : "#cbd5e1",
              }}
            />
            <select
              value={selectedMcId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setSelectedMcId(v === "" ? null : Number(v));
              }}
              className="bg-transparent font-mono text-xs outline-none"
              disabled={uniqueCards.length === 0}
            >
              <option value="">— sample data —</option>
              {uniqueCards.map((c) => (
                <option key={c.id} value={c.id}>
                  MC{c.number}
                  {c.variant}
                  {c.status ? ` · ${c.status}` : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => stepMc(1)}
            disabled={uniqueCards.length === 0}
            className="rounded border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Next MC"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        <FilesPanel
          open={filesOpen}
          onClose={() => setFilesOpen(false)}
          files={files}
          activeFile={activeFile}
          onPick={(name) => {
            if (!confirmDiscardOrStay()) return;
            setActiveFile(name);
            setFilesOpen(false);
          }}
        />
        <BindingsPanel
          open={bindingsOpen}
          onClose={() => setBindingsOpen(false)}
          placeholders={visiblePlaceholders}
          messageForBindings={
            selectedCard
              ? messageForRender(selectedCard, skipAnim)
              : synthMessage(detailQ.data?.template, skipAnim)
          }
          fromMessageLabel={selectedCard ? `MC${selectedCard.number}${selectedCard.variant}` : "sample"}
          allTypeFilters={typeFilters}
          onToggleType={(t) =>
            setTypeFilters((prev) => ({ ...prev, [t]: !prev[t] }))
          }
          onToggleAll={() => {
            const someOff = Object.values(typeFilters).some((v) => !v);
            const newState = someOff;
            setTypeFilters(
              Object.fromEntries(
                PLACEHOLDER_TYPES.map((t) => [t, newState]),
              ) as Record<PHType, boolean>,
            );
          }}
        />

        <div
          ref={containerRef}
          className={clsx(
            "flex flex-1 overflow-hidden",
            wide ? "flex-col" : "flex-row",
          )}
        >
          {/* Editor pane */}
          <section
            className="flex flex-col overflow-hidden"
            style={
              wide
                ? { order: 3, flexBasis: `${100 - splitPercent}%`, flexGrow: 0, flexShrink: 0 }
                : { order: 1, flexBasis: `${100 - splitPercent}%`, flexGrow: 0, flexShrink: 0 }
            }
          >
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3">
              <div className="flex items-center gap-2 text-xs">
                <button
                  onClick={() => setFilesOpen((v) => !v)}
                  className="flex items-center justify-center rounded border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50"
                  title={filesOpen ? "Close files panel" : "Open files panel"}
                  aria-label="Toggle files panel"
                >
                  {filesOpen ? <ChevronLeft className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
                <span className="font-mono text-slate-700">
                  {activeFile ?? "—"}
                </span>
                <SaveIndicator state={saveState} dirty={dirty} error={saveError} />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={revertChanges}
                  disabled={!dirty || saveState === "saving"}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Discard unsaved changes (revert to last saved)"
                >
                  Cancel
                </button>
                <button
                  onClick={performSave}
                  disabled={!dirty || saveState === "saving"}
                  className="flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Save (⌘/Ctrl+S)"
                >
                  {saveState === "saving" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Save className="size-3" />
                  )}
                  Save
                </button>
              </div>
            </div>
            {!activeFile ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                Select a file to edit.
              </div>
            ) : !isCurrentFileText() ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                Binary file — open via the file URL to view.
              </div>
            ) : fileQ.isLoading ? (
              <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading…
              </div>
            ) : (
              <CodeMirror
                value={buffer}
                onChange={onChange}
                height="100%"
                extensions={languageFor(
                  detailQ.data?.files.find((f) => f.name === activeFile)?.ext ?? "",
                )}
                className="flex-1 overflow-auto text-[13px]"
                basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
              />
            )}
          </section>

          {/* Divider */}
          <div
            onMouseDown={startDrag}
            className={clsx(
              "shrink-0 bg-slate-200 hover:bg-slate-400 transition-colors",
              wide
                ? "h-1 w-full cursor-row-resize"
                : "w-1 h-full cursor-col-resize",
            )}
            style={{ order: 2 }}
            title="Drag to resize"
          />

          {/* Preview pane */}
          <section
            className="flex flex-col overflow-hidden bg-white"
            style={
              wide
                ? { order: 1, flexBasis: `${splitPercent}%`, flexGrow: 0, flexShrink: 0 }
                : { order: 3, flexBasis: `${splitPercent}%`, flexGrow: 0, flexShrink: 0 }
            }
          >
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 px-3">
              <div className="flex items-center gap-2">
                <select
                  value={previewSize ?? ""}
                  onChange={(e) => setPreviewSize(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
                  disabled={!detailQ.data?.template.sizes.length}
                >
                  {(detailQ.data?.template.sizes ?? []).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setSkipAnim((v) => !v)}
                  className={clsx(
                    "flex items-center gap-1 rounded border px-2 py-1 text-xs",
                    skipAnim
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  )}
                  title="Skip animations in preview"
                >
                  <span
                    className={clsx(
                      "flex size-3.5 items-center justify-center rounded-sm border",
                      skipAnim
                        ? "border-white bg-white text-slate-900"
                        : "border-slate-400",
                    )}
                  >
                    {skipAnim && <Check className="size-2.5" strokeWidth={3} />}
                  </span>
                  Skip animation
                </button>
              </div>
              <div className="flex items-center gap-1">
                <div className="flex overflow-hidden rounded border border-slate-300">
                  <BgBtn active={previewBg === "light"} onClick={() => setPreviewBg("light")} title="Light background">
                    <Sun className="size-3.5" />
                  </BgBtn>
                  <BgBtn active={previewBg === "checker"} onClick={() => setPreviewBg("checker")} title="Checker background">
                    <GridIcon className="size-3.5" />
                  </BgBtn>
                  <BgBtn active={previewBg === "dark"} onClick={() => setPreviewBg("dark")} title="Dark background">
                    <Moon className="size-3.5" />
                  </BgBtn>
                </div>
                <button
                  onClick={refreshPreview}
                  className="rounded border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50"
                  title="Refresh preview"
                >
                  <RefreshCw className="size-3.5" />
                </button>
                <button
                  onClick={() => setBindingsOpen((v) => !v)}
                  className="rounded border border-slate-300 bg-white p-1 text-slate-700 hover:bg-slate-50"
                  title={bindingsOpen ? "Close bindings panel" : "Open bindings panel"}
                  aria-label="Toggle bindings panel"
                >
                  {bindingsOpen ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
                </button>
              </div>
            </div>
            <div
              ref={previewBoxRef}
              className="flex flex-1 items-center justify-center overflow-hidden"
              style={bgStyleFor(previewBg)}
            >
              <PreviewIframe
                html={previewHtml}
                size={previewSize}
                box={boxSize}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function FilesPanel({
  open,
  onClose,
  files,
  activeFile,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  files: FileInfo[];
  activeFile: string | null;
  onPick: (name: string) => void;
}) {
  return (
    <>
      <aside
        className={clsx(
          "absolute inset-y-0 left-0 z-20 flex w-80 transform flex-col border-r border-slate-200 bg-white transition-transform duration-300 ease-in-out",
          open ? "translate-x-0 shadow-xl" : "-translate-x-full",
        )}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-3 py-2">
          <h4 className="text-sm font-semibold text-slate-900">Files</h4>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            title="Close"
          >
            <ChevronLeft className="size-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {files.map((f) => (
            <button
              key={f.name}
              onClick={() => onPick(f.name)}
              className={clsx(
                "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs",
                activeFile === f.name
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100",
                !f.isText && "opacity-60",
              )}
              title={f.isText ? "" : "binary — read-only"}
            >
              <span className="truncate font-mono">{f.name}</span>
              <span className="ml-2 shrink-0 tabular-nums">{prettyBytes(f.bytes)}</span>
            </button>
          ))}
          {files.length === 0 && (
            <div className="px-2 py-4 text-center text-xs text-slate-500">
              No files
            </div>
          )}
        </div>
      </aside>
      {open && (
        <div
          className="absolute inset-0 z-10"
          onClick={onClose}
          aria-label="Close files panel"
        />
      )}
    </>
  );
}

function BindingsPanel({
  open,
  onClose,
  placeholders,
  messageForBindings,
  fromMessageLabel,
  allTypeFilters,
  onToggleType,
  onToggleAll,
}: {
  open: boolean;
  onClose: () => void;
  placeholders: TemplatePlaceholder[];
  messageForBindings: Record<string, unknown>;
  fromMessageLabel: string;
  allTypeFilters: Record<PHType, boolean>;
  onToggleType: (t: PHType) => void;
  onToggleAll: () => void;
}) {
  const someOff = Object.values(allTypeFilters).some((v) => !v);
  return (
    <>
      <aside
        className={clsx(
          "absolute inset-y-0 right-0 z-20 flex w-96 transform flex-col border-l border-slate-200 bg-white transition-transform duration-300 ease-in-out",
          open ? "translate-x-0 shadow-xl" : "translate-x-full",
        )}
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 px-3 py-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-slate-900">Placeholder bindings</h4>
            <button
              onClick={onClose}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              title="Close"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <Filter className="mr-0.5 size-3.5 text-slate-400" />
            {(["text", "image", "video", "url", "tag", "style"] as PHType[]).map((t) => (
              <button
                key={t}
                onClick={() => onToggleType(t)}
                className={clsx(
                  "flex size-7 items-center justify-center rounded border",
                  allTypeFilters[t]
                    ? "border-transparent"
                    : "border-slate-300 bg-white",
                )}
                style={
                  allTypeFilters[t]
                    ? { backgroundColor: TYPE_COLORS[t] }
                    : undefined
                }
                title={`${allTypeFilters[t] ? "Hide" : "Show"} ${t}`}
              >
                <TypeIcon
                  type={t}
                  size={13}
                  color={allTypeFilters[t] ? "#fff" : TYPE_COLORS[t]}
                />
              </button>
            ))}
            <span className="mx-1 text-slate-300">|</span>
            <button
              onClick={onToggleAll}
              className="rounded px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
            >
              {someOff ? "All" : "None"}
            </button>
          </div>
        </div>
        <div className="flex-1 space-y-1.5 overflow-auto p-3">
          {placeholders.map((p) => {
            const type = (PLACEHOLDER_TYPES.includes(p.type as PHType) ? p.type : "text") as PHType;
            const color = TYPE_COLORS[type];
            const unknown = !p.binding;
            const resolved = resolveBindingValue(p.binding, p.default ?? "", messageForBindings);
            return (
              <div
                key={p.name}
                className="rounded border border-slate-200 bg-white p-2"
                style={{ borderLeftWidth: 3, borderLeftColor: color }}
              >
                <div className="flex items-center gap-2">
                  <TypeIcon type={type} size={13} color={color} />
                  <span className="font-mono text-xs text-slate-700">{`{{${p.name}}}`}</span>
                  <span className="text-slate-300">←</span>
                  {unknown ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-rose-700">
                      <AlertTriangle className="size-3" />
                      Unbound
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-blue-700">{p.binding}</span>
                  )}
                </div>
                {!unknown && (
                  <div className="mt-1 pl-1 text-[11px]">
                    {resolved.fromMessage ? (
                      <span className="block truncate text-slate-700" title={resolved.value}>
                        {resolved.value}
                      </span>
                    ) : resolved.value ? (
                      <span className="block truncate italic text-amber-700" title={resolved.value}>
                        default: {resolved.value}
                      </span>
                    ) : (
                      <span className="block italic text-slate-400">
                        {fromMessageLabel === "sample"
                          ? "no default"
                          : `not in MC${fromMessageLabel.replace(/^MC/, "")}`}
                      </span>
                    )}
                  </div>
                )}
                {type === "tag" && p.options && p.options.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1 pl-1">
                    {p.options.slice(0, 4).map((o) => (
                      <span
                        key={o}
                        className="rounded bg-pink-50 px-1.5 py-0.5 font-mono text-[10px] text-pink-800"
                      >
                        {o}
                      </span>
                    ))}
                    {p.options.length > 4 && (
                      <span className="text-[10px] text-slate-400">
                        +{p.options.length - 4}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {placeholders.length === 0 && (
            <div className="py-8 text-center text-xs text-slate-500">
              No placeholders match the filters.
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
          Edit bindings via <span className="font-mono">template.json</span> in the files panel.
        </div>
      </aside>
      {open && (
        <div
          className="absolute inset-0 z-10"
          onClick={onClose}
          aria-label="Close bindings panel"
        />
      )}
    </>
  );
}

function BgBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "flex items-center justify-center px-1.5 py-1 transition-colors",
        active
          ? "bg-slate-900 text-white"
          : "bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function bgStyleFor(bg: "light" | "dark" | "checker"): React.CSSProperties {
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

function PreviewIframe({
  html,
  size,
  box,
}: {
  html: string;
  size: string | null;
  box: { w: number; h: number };
}) {
  if (!size) return null;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return null;
  const adW = parseInt(m[1], 10);
  const adH = parseInt(m[2], 10);
  const margin = 16; // breathing room around the ad
  const availW = Math.max(0, box.w - margin * 2);
  const availH = Math.max(0, box.h - margin * 2);
  const scale =
    box.w === 0 || box.h === 0
      ? 1
      : Math.min(1, availW / adW, availH / adH);
  return (
    <iframe
      title="preview"
      srcDoc={html}
      sandbox="allow-same-origin allow-scripts"
      style={{
        width: adW,
        height: adH,
        transform: scale < 1 ? `scale(${scale})` : undefined,
        transformOrigin: "center center",
        border: 0,
        background: "white",
        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        flexShrink: 0,
      }}
    />
  );
}

function messageForRender(m: Message, skipAnim: boolean): Record<string, unknown> {
  // Pass DB row through. Render uses normalized lookup so camelCase keys
  // match v5 PascalCase bindings (Headline → headline, Final_Trafficked_URL →
  // finalTraffickedUrl, etc.). Spec §4.6.
  // When skipAnim is on, also strip the "animated" class from
  // template_variant_classes — v5 templates use the .animated class to
  // fade-in opacity-0 elements; without animation those stay invisible.
  // Matches v5 Templates.jsx behavior.
  const out = { ...m } as Record<string, unknown>;
  if (skipAnim) {
    const tvc = (m.templateVariantClasses ?? "") as string;
    out.templateVariantClasses = tvc
      .split(/\s+/)
      .filter((c) => c && c !== "animated")
      .join(" ");
  }
  return out;
}

function resolveBindingValue(
  binding: string | undefined,
  fallbackDefault: string,
  message: Record<string, unknown>,
): { value: string; fromMessage: boolean } {
  if (!binding) return { value: fallbackDefault, fromMessage: false };
  const target = binding.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [k, v] of Object.entries(message)) {
    if (k.toLowerCase().replace(/[^a-z0-9]/g, "") === target) {
      if (v !== null && v !== undefined && String(v) !== "") {
        return { value: String(v), fromMessage: true };
      }
    }
  }
  return { value: fallbackDefault, fromMessage: false };
}

function synthMessage(t?: TemplateInfo, skipAnim = false): Record<string, unknown> {
  const m: Record<string, unknown> = {
    Headline: "Sample headline",
    Copy_1: "Sample body copy",
    Copy_2: "More copy",
    CTA: "Click here",
    Final_Trafficked_URL: "https://example.com",
    Number: 1,
    Variant: "a",
    Name: "Preview message",
    POMS_ID: "POMS-PREVIEW",
    PMMID: "PREVIEW-PMMID",
    Template_variant_classes: skipAnim ? "" : "animated",
  };
  if (t?.placeholders) {
    for (const p of t.placeholders) {
      if (p.binding && !(p.binding in m) && p.default) {
        m[p.binding] = p.default;
      }
    }
  }
  return m;
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

function SaveIndicator({
  state,
  dirty,
  error,
}: {
  state: SaveState;
  dirty: boolean;
  error: string | null;
}) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <Loader2 className="size-3 animate-spin" /> saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-700">
        <Check className="size-3" /> saved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1 text-xs text-rose-700" title={error ?? ""}>
        <AlertCircle className="size-3" /> {error ?? "error"}
      </span>
    );
  }
  if (dirty) {
    return <span className="text-xs text-slate-500">modified</span>;
  }
  return null;
}

function NewTemplateButton({ onCreated }: { onCreated: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/templates/${encodeURIComponent(name.trim())}`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(j.error || r.statusText);
      }
      onCreated(name.trim());
      setOpen(false);
      setName("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
      >
        <Plus className="size-3.5" /> New
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="template-name"
        className="rounded border border-slate-300 px-2 py-1 text-xs"
        pattern="[a-zA-Z0-9][a-zA-Z0-9._-]*"
        title="alphanumerics, dot, dash, underscore"
      />
      <button
        type="submit"
        disabled={busy}
        className="flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
        Create
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setErr(null);
          setName("");
        }}
        className="text-xs text-slate-500 hover:text-slate-900"
      >
        Cancel
      </button>
      {err && <span className="text-xs text-rose-700">{err}</span>}
    </form>
  );
}
