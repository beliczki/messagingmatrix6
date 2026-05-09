"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Loader2,
  Sun,
  Moon,
  Grid as GridIcon,
  X,
  Archive as ArchiveIcon,
  ArchiveRestore,
} from "lucide-react";
import clsx from "clsx";
import ScaledMediaPreview, { parseDimensions } from "./ScaledMediaPreview";
import { usePersistent, type Codec } from "./usePersistent";

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

type PreviewBg = "light" | "dark" | "checker";

const PREVIEW_BG_CODEC: Codec<PreviewBg> = {
  parse: (s) => (s === "light" || s === "dark" || s === "checker" ? s : "checker"),
  stringify: (v) => v,
};

export type MediaEntity = {
  id: number;
  version: number;
  archivedAt: string | null;
  fileId: string | null;
  fileName: string | null;
  fileFormat: string | null;
  fileSize: string | null;
  fileDimensions: string | null;
  createdAt: string;
};

export type UploadedFile = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  dimensions: string | null;
};

export type MediaEntityDialogProps<E extends MediaEntity, D> = {
  /** The currently-open entity. */
  entity: E;
  /** The list the stepper navigates over (e.g. filtered visible rows). */
  entities: E[];
  /** Called when the stepper jumps to another entity id. */
  onJump: (id: number) => void;
  onClose: () => void;
  /** The uploaded_files row (optional — used for mime/dimensions fallback). */
  file: UploadedFile | undefined;
  /** Title rendered in the header (e.g. file name). */
  title: string;
  /** Optional subtitle / tag rendered next to the title. */
  subtitle?: string | null;
  /** Base API path, e.g. "/api/creatives" or "/api/assets". */
  endpoint: string;
  /** React Query key prefix to invalidate after writes. */
  queryKey: string;
  /** Convert an entity into draft state. */
  toDraft: (entity: E) => D;
  /** Compute the JSON patch payload from snapshot vs draft. Empty object = no-op. */
  diffPayload: (snapshot: E, draft: D) => Record<string, unknown>;
  /** Render the form contents for the data pane. */
  renderForm: (draft: D, setDraft: (d: D) => void) => ReactNode;
  /** Extra static metadata rows shown beneath the form. */
  fileInfoRows?: Array<[string, string | null]>;
};

export default function MediaEntityDialog<E extends MediaEntity, D>({
  entity,
  entities,
  onJump,
  onClose,
  file,
  title,
  subtitle,
  endpoint,
  queryKey,
  toDraft,
  diffPayload,
  renderForm,
  fileInfoRows,
}: MediaEntityDialogProps<E, D>) {
  const [draft, setDraft] = useState<D>(() => toDraft(entity));
  const [snapshot, setSnapshot] = useState<E>(entity);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [autoSave, setAutoSave] = useState<boolean>(true);
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const [bg, setBg] = usePersistent<PreviewBg>(
    "mm6_media_dialog_preview_bg",
    "checker",
    PREVIEW_BG_CODEC,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dims = parseDimensions(entity.fileDimensions ?? file?.dimensions ?? null);
  const wide = dims.landscape;

  // Re-seed draft + snapshot when the user steps to a different entity.
  useEffect(() => {
    setDraft(toDraft(entity));
    setSnapshot(entity);
    setSaveState({ kind: "idle" });
  }, [entity.id]);

  const navIndex = useMemo(
    () => entities.findIndex((e) => e.id === entity.id),
    [entities, entity.id],
  );
  function navigatePrev() {
    if (navIndex > 0) onJump(entities[navIndex - 1].id);
  }
  function navigateNext() {
    if (navIndex >= 0 && navIndex < entities.length - 1) {
      onJump(entities[navIndex + 1].id);
    }
  }

  // Esc to close, ←/→ to step (when focus isn't in an input).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowLeft") navigatePrev();
      if (e.key === "ArrowRight") navigateNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      if (Object.keys(payload).length === 0) return null;
      const r = await fetch(`${endpoint}/${snapshot.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(snapshot.version),
        },
        body: JSON.stringify(payload),
      });
      if (r.status === 409) {
        const body = await r.json().catch(() => ({}));
        const current = (body as { current?: E; row?: E }).current
          ?? (body as { row?: E }).row;
        throw new VersionMismatchError<E>(current ?? null);
      }
      if (!r.ok) throw new Error(await r.text());
      const body = await r.json();
      // Server payload key is endpoint-specific (e.g. { creative: ... } or
      // { asset: ... }); be permissive.
      return (
        (body as Record<string, E>)[queryKey.slice(0, -1)] ??
        (body as { row?: E }).row ??
        null
      );
    },
    onSuccess: (saved) => {
      if (saved) {
        setSnapshot(saved);
        qc.invalidateQueries({ queryKey: [queryKey] });
      }
      setSaveState({ kind: "saved" });
      setTimeout(() => {
        setSaveState((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      }, 1500);
    },
    onError: (e) => {
      if (e instanceof VersionMismatchError && e.current) {
        setSaveState({ kind: "conflict" });
        setSnapshot(e.current);
        qc.invalidateQueries({ queryKey: [queryKey] });
      } else {
        setSaveState({ kind: "error", message: (e as Error).message });
      }
    },
  });

  // Auto-save with 400ms debounce.
  useEffect(() => {
    if (!autoSave) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    const payload = diffPayload(snapshot, draft);
    if (Object.keys(payload).length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState({ kind: "saving" });
    debounceRef.current = setTimeout(() => save.mutate(payload), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, snapshot, autoSave]);

  const isDirty = useMemo(() => {
    return Object.keys(diffPayload(snapshot, draft)).length > 0;
  }, [draft, snapshot, diffPayload]);

  function manualSave() {
    if (!isDirty) return;
    setSaveState({ kind: "saving" });
    save.mutate(diffPayload(snapshot, draft));
  }
  function manualCancel() {
    setDraft(toDraft(snapshot));
    setSaveState({ kind: "idle" });
  }

  const archive = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${endpoint}/${snapshot.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "If-Match": String(snapshot.version) },
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      onClose();
    },
  });
  const restore = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${endpoint}/${snapshot.id}/restore`, {
        method: "POST",
        credentials: "include",
        headers: {
          "If-Match": String(snapshot.version),
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryKey] });
      onClose();
    },
  });

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
      let pct: number;
      if (wide) {
        pct = ((ev.clientY - rect.top) / rect.height) * 100;
      } else {
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
  }, [wide]);

  const archived = entity.archivedAt !== null;
  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-stretch bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={clsx(
          "media-entity-dialog modal m-auto flex h-[90vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl",
          wide && "media-entity-dialog--landscape",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="media-entity-dialog__header modal__header flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3">
          <button
            onClick={navigatePrev}
            disabled={navIndex <= 0}
            aria-label="Previous"
            className="media-entity-dialog__nav-prev rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="media-entity-dialog__title-block flex min-w-0 items-baseline gap-2">
            <span
              className="media-entity-dialog__title truncate text-sm font-semibold text-slate-900"
              title={title}
            >
              {title}
            </span>
            {subtitle ? (
              <span className="media-entity-dialog__subtitle truncate text-xs text-slate-500">
                {subtitle}
              </span>
            ) : null}
          </div>
          <button
            onClick={navigateNext}
            disabled={navIndex < 0 || navIndex >= entities.length - 1}
            aria-label="Next"
            className="media-entity-dialog__nav-next rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
          {entities.length > 0 ? (
            <span className="media-entity-dialog__nav-counter text-xs text-slate-500">
              {navIndex + 1}/{entities.length}
            </span>
          ) : null}
          <span
            className={clsx(
              "status-badge ml-2 inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs",
              archived
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            {archived ? "Archived" : "Active"}
          </span>
          <SaveIndicator state={saveState} />

          <div className="media-entity-dialog__header-actions ml-auto flex items-center gap-2">
            {archived ? (
              <button
                onClick={() => restore.mutate()}
                disabled={restore.isPending}
                className="toolbar-btn flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                title="Restore from archive"
              >
                <ArchiveRestore className="size-3.5" />
                Restore
              </button>
            ) : (
              <button
                onClick={() => archive.mutate()}
                disabled={archive.isPending}
                className="toolbar-btn flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Archive"
              >
                <ArchiveIcon className="size-3.5" />
                Archive
              </button>
            )}
            <button
              onClick={() => setAutoSave((v) => !v)}
              className={clsx(
                "media-entity-dialog__autosave-toggle flex items-center gap-1 rounded border px-2 py-1 text-xs",
                autoSave
                  ? "media-entity-dialog__autosave-toggle--active border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
              title="Save changes automatically"
            >
              <span
                className={clsx(
                  "flex size-3.5 items-center justify-center rounded-sm border",
                  autoSave
                    ? "border-white bg-white text-slate-900"
                    : "border-slate-400",
                )}
              >
                {autoSave && <Check className="size-2.5" strokeWidth={3} />}
              </span>
              Autosave
            </button>
            {!autoSave && isDirty ? (
              <span className="media-entity-dialog__modified-tag text-xs text-amber-600">
                modified
              </span>
            ) : null}
            {!autoSave ? (
              <>
                <button
                  onClick={manualSave}
                  disabled={!isDirty || saveState.kind === "saving"}
                  className="toolbar-btn--primary rounded bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={manualCancel}
                  disabled={!isDirty || saveState.kind === "saving"}
                  className="toolbar-btn rounded border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Cancel
                </button>
              </>
            ) : null}
            <button
              onClick={onClose}
              aria-label="Close"
              className="modal__close rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="size-5" />
            </button>
          </div>
        </header>

        <div
          ref={containerRef}
          className={clsx(
            "media-entity-dialog__body flex flex-1 overflow-hidden",
            wide ? "flex-col" : "flex-row",
            archived && "row--archived",
          )}
        >
          <section
            className="media-entity-dialog__pane--form flex flex-col overflow-hidden bg-white"
            style={{
              order: wide ? 3 : 1,
              flexBasis: `${100 - splitPercent}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <div className="media-entity-dialog__form-content flex-1 overflow-y-auto px-5 py-4">
              {renderForm(draft, setDraft)}
              {fileInfoRows && fileInfoRows.length > 0 ? (
                <FileInfoBlock rows={fileInfoRows} />
              ) : null}
            </div>
          </section>

          <div
            onMouseDown={startDrag}
            className={clsx(
              "divider-handle shrink-0 bg-slate-200 transition-colors hover:bg-slate-400",
              wide
                ? "divider-handle--horizontal h-1 w-full cursor-row-resize"
                : "divider-handle--vertical h-full w-1 cursor-col-resize",
            )}
            style={{ order: 2 }}
            title="Drag to resize"
          />

          <section
            className="media-entity-dialog__pane--preview flex flex-col overflow-hidden"
            style={{
              order: wide ? 1 : 3,
              flexBasis: `${splitPercent}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <div className="media-entity-dialog__preview-toolbar flex h-10 shrink-0 items-center justify-end gap-1 border-b border-slate-200 bg-white px-3">
              <div className="bg-toggle flex overflow-hidden rounded border border-slate-300">
                <BgBtn active={bg === "light"} onClick={() => setBg("light")} title="Light background">
                  <Sun className="size-3.5" />
                </BgBtn>
                <BgBtn active={bg === "checker"} onClick={() => setBg("checker")} title="Checker background">
                  <GridIcon className="size-3.5" />
                </BgBtn>
                <BgBtn active={bg === "dark"} onClick={() => setBg("dark")} title="Dark background">
                  <Moon className="size-3.5" />
                </BgBtn>
              </div>
            </div>
            <div
              className={clsx(
                "media-entity-dialog__preview-viewport flex flex-1 items-center justify-center overflow-hidden p-4",
                bg === "light" && "preview-viewport--light",
                bg === "dark" && "preview-viewport--dark",
                bg === "checker" && "preview-viewport--checker",
              )}
            >
              <ScaledMediaPreview
                fileId={entity.fileId}
                mimeType={file?.mimeType}
                alt={entity.fileName ?? ""}
                naturalW={dims.w}
                naturalH={dims.h}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

class VersionMismatchError<E> extends Error {
  current: E | null;
  constructor(current: E | null) {
    super("version mismatch");
    this.current = current;
  }
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "saving") {
    return (
      <span className="save-indicator save-indicator--saving inline-flex items-center gap-1 text-xs text-slate-500">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (state.kind === "saved") {
    return (
      <span className="save-indicator save-indicator--saved inline-flex items-center gap-1 text-xs text-emerald-700">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  if (state.kind === "conflict") {
    return (
      <span className="save-indicator save-indicator--conflict inline-flex items-center gap-1 text-xs text-amber-700">
        <CircleAlert className="size-3" />
        Refreshed (someone else edited this)
      </span>
    );
  }
  return (
    <span
      className="save-indicator save-indicator--error inline-flex items-center gap-1 text-xs text-rose-700"
      title={state.message}
    >
      <CircleAlert className="size-3" />
      Save failed
    </span>
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
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={clsx(
        "bg-toggle__btn flex items-center justify-center px-1.5 py-1 transition-colors",
        active
          ? "bg-toggle__btn--active bg-slate-900 text-white"
          : "bg-white text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function FileInfoBlock({ rows }: { rows: Array<[string, string | null]> }) {
  return (
    <dl className="media-entity-dialog__file-info mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-[11px]">
      {rows.map(([k, v]) => (
        <FileInfoRow key={k} label={k} value={v} />
      ))}
    </dl>
  );
}
function FileInfoRow({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-mono text-slate-700" title={value ?? ""}>
        {value ?? "—"}
      </dd>
    </>
  );
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
