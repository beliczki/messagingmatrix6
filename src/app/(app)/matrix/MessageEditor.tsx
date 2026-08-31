"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Tag,
  FileText,
  FileCode,
  Rocket,
  PencilRuler,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  CircleAlert,
  Type,
  Trash2,
  ChevronDown,
  History,
  Globe,
  Users,
} from "lucide-react";
import clsx from "clsx";
import { type Audience, type Message, type Topic, STATUS_COLOR } from "./types";
import PreviewPane, { type PreviewBg } from "../_components/PreviewPane";
import { templateMetaFor } from "../_components/MatrixIframeTile";
import ModalBackdrop from "../_components/ModalBackdrop";
import EntityHistoryDrawer from "../_components/EntityHistoryDrawer";
import { useTextFormattingRules } from "./useTextFormattingRules";

type AssetRow = {
  id: number;
  brand: string | null;
  product: string | null;
  type: string | null;
  visualKeyword: string | null;
  fileId: string | null;
  fileName: string | null;
  fileFormat: string | null;
};

const IMAGE_FORMATS = new Set(["jpg", "jpeg", "png", "svg", "gif", "webp"]);
const VIDEO_FORMATS = new Set(["mp4", "webm", "mov", "m4v"]);
const ASSET_AUTOCOMPLETE_MIN = 2;

type Tab = "naming" | "template" | "content" | "styles" | "trafficking";

const STATUS_OPTIONS = [
  "INCOMING",
  "NAMING",
  "CONTENT",
  "PREVIEW",
  "APPROVED",
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
  "ERROR",
  "DEAD",
  "MEMORY",
];

type TemplateInfo = {
  name: string;
  sizes: string[];
  defaultSize: string | null;
  tagOptions: string[];
  placeholders: Array<{ name: string; type: string }>;
  // D1: production type. Optional so existing call sites keep working; undefined
  // is treated as "html" by the preview branch.
  kind?: "html" | "adobe" | "figma" | "after_effects";
  previewFile?: string | null;
  externalUrl?: string | null;
};

type Props = {
  open: boolean;
  message: Message | null;
  audiences: Audience[];
  topics: Topic[];
  /** Filtered, ordered set the user is currently navigating. */
  visibleMessages: Message[];
  /** Count of other (non-archived) audience copies of the open card. */
  siblingCount: number;
  onClose: () => void;
  onJump: (id: number) => void;
};

type EditableFields = Pick<
  Message,
  | "name"
  | "status"
  | "headline"
  | "copy1"
  | "copy2"
  | "disclaimer"
  | "flash"
  | "cta"
  | "landingUrl"
  | "image1"
  | "image2"
  | "image3"
  | "image4"
  | "image5"
  | "image6"
  | "video1"
  | "headlineStyle"
  | "copy1Style"
  | "copy2Style"
  | "disclaimerStyle"
  | "ctaStyle"
  | "flashStyle"
  | "customCss"
  | "template"
  | "templateVariantClasses"
  | "startDate"
  | "endDate"
>;

const EDITABLE_KEYS: Array<keyof EditableFields> = [
  "name",
  "status",
  "headline",
  "copy1",
  "copy2",
  "disclaimer",
  "flash",
  "cta",
  "landingUrl",
  "image1",
  "image2",
  "image3",
  "image4",
  "image5",
  "image6",
  "video1",
  "headlineStyle",
  "copy1Style",
  "copy2Style",
  "disclaimerStyle",
  "ctaStyle",
  "flashStyle",
  "customCss",
  "template",
  "templateVariantClasses",
  "startDate",
  "endDate",
];

// The tabs receive the real state setter so field updates can use the
// functional form — spreading a captured `draft` resurrects stale values when
// a save response or conflict-adopt lands between the capture and the
// keystroke.
type SetDraft = React.Dispatch<React.SetStateAction<EditableFields | null>>;

function toEditable(m: Message): EditableFields {
  return Object.fromEntries(
    EDITABLE_KEYS.map((k) => [k, m[k] ?? null]),
  ) as EditableFields;
}

function diffPayload(
  before: EditableFields,
  after: EditableFields,
): Partial<EditableFields> {
  const out: Record<string, string | null> = {};
  for (const k of EDITABLE_KEYS) {
    if ((before[k] ?? null) !== (after[k] ?? null)) {
      out[k] = after[k] ?? null;
    }
  }
  return out as Partial<EditableFields>;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  // Conflict is terminal + blocking: autosave is paused and the only way out
  // is an explicit reload to `serverRow`. We never rebase silently — doing so
  // would let the stale draft re-save with the fresh version and clobber the
  // other editor's work.
  | { kind: "conflict"; serverRow: Message };

export default function MessageEditor({
  open,
  message,
  audiences,
  topics,
  visibleMessages,
  siblingCount,
  onClose,
  onJump,
}: Props) {
  const [tab, setTab] = useState<Tab>("naming");
  const [draft, setDraft] = useState<EditableFields | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [committedSnapshot, setCommittedSnapshot] = useState<Message | null>(
    null,
  );
  const [autoSave, setAutoSave] = useState<boolean>(true);
  // Global edit: when on, saving fans the shared (creative + status) fields out
  // to every other audience copy of this card. Persisted — it's a deliberate
  // workflow mode, not a per-session accident.
  const [globalEdit, setGlobalEdit] = useState<boolean>(false);
  useEffect(() => {
    try {
      setGlobalEdit(localStorage.getItem("mm6_matrix_edit_global") === "1");
    } catch {}
  }, []);
  function toggleGlobalEdit() {
    setGlobalEdit((v) => {
      const next = !v;
      try {
        localStorage.setItem("mm6_matrix_edit_global", next ? "1" : "0");
      } catch {}
      return next;
    });
  }
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const [previewSize, setPreviewSize] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<boolean>(false);
  const wide = isLandscape(previewSize);

  // Reset the tab to "naming" only when the editor *opens* fresh — keep the
  // current tab while navigating prev/next between MCs.
  useEffect(() => {
    if (open) setTab("naming");
  }, [open]);

  // The row the editor is CURRENTLY on. A save resolves asynchronously — with
  // global edit it fans out to every audience copy and can take seconds — so
  // its response may land after the user has already stepped to another card.
  // Such a response belongs to the card we LEFT and must not touch this
  // editor's state; the ref is the only reading of "current" available to the
  // mutation callbacks, whose captured `committedSnapshot` is the one from the
  // render that fired the save.
  const openRowIdRef = useRef<number | null>(null);

  // Re-seed draft + snapshot every time the open message changes (initial
  // open AND prev/next navigation). Leaves the active tab alone.
  useEffect(() => {
    if (open && message) {
      openRowIdRef.current = message.id;
      setDraft(toEditable(message));
      setCommittedSnapshot(message);
      setSaveState({ kind: "idle" });
    }
  }, [open, message?.id]);

  // ESC closes; arrow keys navigate prev/next.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      // Only navigate if focus isn't in an input/textarea/select.
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const editable =
        tag === "input" || tag === "textarea" || tag === "select";
      if (editable) return;
      if (e.key === "ArrowLeft") navigatePrev();
      if (e.key === "ArrowRight") navigateNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const aud = useMemo(
    () => audiences.find((a) => a.key === message?.audience),
    [audiences, message?.audience],
  );
  const top = useMemo(
    () => topics.find((t) => t.key === message?.topic),
    [topics, message?.topic],
  );

  // The stepper walks UNIQUE messaging cards, not every per-audience copy of
  // the same card. We dedupe the visible list by (number, variant) — which
  // never spans more than one topic — keeping the first occurrence as the
  // representative the arrows jump to.
  const uniqueMcs = useMemo(() => {
    const seen = new Set<string>();
    const out: Message[] = [];
    for (const m of visibleMessages) {
      const key = `${m.number} ${m.variant}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
    return out;
  }, [visibleMessages]);

  const navIndex = useMemo(() => {
    if (!message) return -1;
    return uniqueMcs.findIndex(
      (m) => m.number === message.number && m.variant === message.variant,
    );
  }, [uniqueMcs, message?.number, message?.variant]);

  function navigatePrev() {
    if (navIndex > 0) onJump(uniqueMcs[navIndex - 1].id);
  }
  function navigateNext() {
    if (navIndex >= 0 && navIndex < uniqueMcs.length - 1) {
      onJump(uniqueMcs[navIndex + 1].id);
    }
  }

  // Templates list (for Template tab).
  const templatesQ = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const r = await fetch("/api/templates", { credentials: "include" });
      if (!r.ok) throw new Error("templates");
      return (await r.json()) as { templates: TemplateInfo[] };
    },
    enabled: open,
  });

  const qc = useQueryClient();
  // Saves are strictly serialized: a second PATCH while one is in flight
  // would carry the same If-Match (committedSnapshot only advances in
  // onSuccess) and 409 against our own just-landed save — the editor then
  // "conflicts with itself" on slow typing. The ref is the in-flight truth
  // for timer callbacks, whose captured save.isPending is stale.
  const saveInFlightRef = useRef(false);
  const save = useMutation({
    onMutate: () => {
      saveInFlightRef.current = true;
    },
    onSettled: () => {
      saveInFlightRef.current = false;
    },
    mutationFn: async (payload: Partial<EditableFields>) => {
      if (!committedSnapshot) throw new Error("no snapshot");
      if (Object.keys(payload).length === 0) return null;
      const r = await fetch(
        `/api/messages/${committedSnapshot.id}${
          globalEdit ? "?propagate=siblings" : ""
        }`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(committedSnapshot.version),
          },
          body: JSON.stringify(payload),
        },
      );
      if (r.status === 409) {
        const body = (await r.json()) as { currentRow: Message };
        throw new VersionMismatchError(body.currentRow);
      }
      if (!r.ok) {
        throw new Error(await r.text());
      }
      const body = (await r.json()) as {
        message: Message;
        siblings?: Message[];
      };
      return { message: body.message, siblings: body.siblings ?? [] };
    },
    onSuccess: (saved) => {
      if (saved) {
        // Bump our snapshot so the next save uses the new version — but ONLY
        // while the editor is still on the row this save targeted. If the user
        // stepped to another card while it was in flight, rebasing here would
        // pull the snapshot back to the PREVIOUS card while `draft` already
        // holds the new one; the next autosave would diff those two and write
        // the new card's entire content onto the previous card's row (and,
        // under global edit, onto all of its audience copies).
        if (openRowIdRef.current === saved.message.id) {
          setCommittedSnapshot(saved.message);
        }
        // Patch the saved row — and, under global edit, the fanned-out sibling
        // rows the server returns — straight into the grid cache so reopening
        // this card (and every other audience copy's status dot) reflects the
        // persisted values immediately. We patch the known-changed rows instead
        // of invalidating: a full /api/messages refetch is heavy (every row)
        // and its latency left the sibling dots stale for seconds. The response
        // carries recomputed UTM/Final-URL fields too, so those propagate as
        // well. setQueriesData (prefix match) because the matrix key is
        // parameterized by its showArchived toggle — an exact ["messages"] key
        // would silently no-op there.
        const byId = new Map<number, Message>();
        byId.set(saved.message.id, saved.message);
        for (const s of saved.siblings) byId.set(s.id, s);
        qc.setQueriesData<{ messages: Message[] }>(
          { queryKey: ["messages"] },
          (prev) =>
            prev
              ? {
                  messages: prev.messages.map((m) => byId.get(m.id) ?? m),
                }
              : prev,
        );
      }
      setSaveState({ kind: "saved" });
      // Clear "saved" indicator after 1.5s.
      setTimeout(() => {
        setSaveState((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      }, 1500);
    },
    onError: (e) => {
      if (e instanceof VersionMismatchError) {
        // A conflict on a row we already navigated away from is not this
        // editor's conflict — blocking the card now open on it would be wrong.
        if (openRowIdRef.current !== e.current.id) return;
        // Hold the server row but do NOT rebase `committedSnapshot` — the user
        // must explicitly reload (reload-only conflict resolution).
        setSaveState({ kind: "conflict", serverRow: e.current });
      } else {
        setSaveState({ kind: "error", message: (e as Error).message });
      }
    },
  });

  // Auto-save on draft changes — 400ms debounce. Disabled when autoSave=false.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Conflict is blocking — no save fires until the user reloads.
    if (saveState.kind === "conflict") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    if (!autoSave) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    if (!draft || !committedSnapshot) return;
    const payload = diffPayload(toEditable(committedSnapshot), draft);
    if (Object.keys(payload).length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState({ kind: "saving" });
    debounceRef.current = setTimeout(() => {
      // In-flight → skip; when that save settles, isPending flips and this
      // effect re-runs against the fresh snapshot, re-arming with the drift.
      if (saveInFlightRef.current) return;
      save.mutate(payload);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, committedSnapshot, autoSave, saveState.kind, save.isPending]);

  const isDirty = useMemo(() => {
    if (!draft || !committedSnapshot) return false;
    const payload = diffPayload(toEditable(committedSnapshot), draft);
    return Object.keys(payload).length > 0;
  }, [draft, committedSnapshot]);

  // Phase B — stale-tab detection. A live SSE refresh (peer write) advances
  // the `message` prop's version. If it moved PAST our open snapshot, this tab
  // was stale: surface a conflict when there are unsaved edits, or silently
  // adopt the fresh row when there are none. Only acts while idle so it can't
  // race our own just-completed save. The prop can also move BACKWARD: our own
  // write broadcasts an SSE invalidate, and that refetch can resolve AFTER a
  // newer save already patched the cache — such stale echoes must be ignored,
  // not read as a peer edit (self-conflict otherwise).
  useEffect(() => {
    if (!open || !message || !committedSnapshot) return;
    if (message.id !== committedSnapshot.id) return;
    if (saveState.kind !== "idle") return;
    if (message.version <= committedSnapshot.version) return;
    if (isDirty) {
      setSaveState({ kind: "conflict", serverRow: message });
    } else {
      setDraft(toEditable(message));
      setCommittedSnapshot(message);
    }
  }, [open, message, committedSnapshot, isDirty, saveState.kind]);

  function manualSave() {
    if (!draft || !committedSnapshot || !isDirty) return;
    if (saveState.kind === "conflict") return;
    // Same serialization as autosave: a double-click must not race the first
    // PATCH with the same If-Match.
    if (saveInFlightRef.current) return;
    const payload = diffPayload(toEditable(committedSnapshot), draft);
    setSaveState({ kind: "saving" });
    save.mutate(payload);
  }

  function manualCancel() {
    if (!committedSnapshot) return;
    setDraft(toEditable(committedSnapshot));
    setSaveState({ kind: "idle" });
  }

  // Reload-only conflict resolution: discard the stale draft and adopt the
  // server's current row. The only exit from a conflict state.
  function reloadFromConflict() {
    if (saveState.kind !== "conflict") return;
    const server = saveState.serverRow;
    setDraft(toEditable(server));
    setCommittedSnapshot(server);
    setSaveState({ kind: "idle" });
    qc.invalidateQueries({ queryKey: ["messages"] });
  }

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

  if (!open || !message || !draft) return null;

  const mcLabel = `MC${message.number}${message.variant}`;

  return (
    <>
    <ModalBackdrop onClose={onClose} className="z-50 items-stretch">
      <div
        className={clsx(
          "message-editor modal m-auto flex h-[90vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl",
          wide && "message-editor--landscape",
        )}
      >
        <header className="message-editor__header modal__header flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3">
          <button
            onClick={navigatePrev}
            disabled={navIndex <= 0}
            aria-label="Previous"
            className="message-editor__nav-prev rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span
            className={clsx(
              "message-editor__status-dot size-2.5 shrink-0 rounded-full",
              STATUS_COLOR[draft.status ?? ""] ?? "bg-slate-300",
            )}
            title={draft.status ?? "—"}
            aria-label={`Status: ${draft.status ?? "none"}`}
          />
          <span className="message-editor__mc-label font-mono text-base font-semibold text-slate-900">
            {mcLabel}
          </span>
          <button
            onClick={navigateNext}
            disabled={navIndex < 0 || navIndex >= uniqueMcs.length - 1}
            aria-label="Next"
            className="message-editor__nav-next rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
          {uniqueMcs.length > 0 ? (
            <span className="message-editor__nav-counter text-xs text-slate-500">
              {navIndex + 1}/{uniqueMcs.length}
            </span>
          ) : null}
          {globalEdit && siblingCount > 0 ? (
            <span
              className="message-editor__global-warning inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
              title={`Global edit is on — all changes (creative, status, flight dates) also update ${siblingCount} other audience copy(ies) of this card (MC${message?.number}${message?.variant ?? ""}). Other variants of the number are left untouched.`}
            >
              <Users className="size-3" />
              updates {siblingCount} other audience
              {siblingCount === 1 ? "" : "s"}
            </span>
          ) : null}
          <SaveIndicator state={saveState} />

          <div className="message-editor__header-actions ml-auto flex items-center gap-2">
            <button
              onClick={() => setHistoryOpen(true)}
              title="View revision history"
              className="message-editor__history-btn toolbar-btn flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              <History className="size-3.5" />
              History
            </button>
            <button
              onClick={toggleGlobalEdit}
              className={clsx(
                "message-editor__scope-toggle flex items-center gap-1 rounded border px-2 py-1 text-xs",
                globalEdit
                  ? "message-editor__scope-toggle--global border-amber-500 bg-amber-500 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
              title={
                globalEdit
                  ? "Global: all edits (creative, status, flight dates) propagate to every audience copy of this card — same variant only; other variants are untouched"
                  : "Local: edits apply only to this audience copy"
              }
            >
              <Globe className="size-3.5" />
              {globalEdit ? "Global" : "Local"}
            </button>
            <button
              onClick={() => setAutoSave((v) => !v)}
              className={clsx(
                "message-editor__autosave-toggle flex items-center gap-1 rounded border px-2 py-1 text-xs",
                autoSave
                  ? "message-editor__autosave-toggle--active border-slate-900 bg-slate-900 text-white"
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
              <span className="message-editor__modified-tag text-xs text-amber-600">modified</span>
            ) : null}
            {!autoSave ? (
              <>
                <button
                  onClick={manualSave}
                  disabled={
                    !isDirty ||
                    saveState.kind === "saving" ||
                    saveState.kind === "conflict"
                  }
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

        {saveState.kind === "conflict" ? (
          <div className="conflict-bar flex shrink-0 items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            <CircleAlert className="conflict-bar__icon size-4 shrink-0" />
            <span className="conflict-bar__msg flex-1">
              Someone else saved changes to this MC while you had it open. Your
              unsaved edits can&apos;t be applied on top — reload to get the
              latest version. Your changes here will be discarded.
            </span>
            <button
              onClick={reloadFromConflict}
              className="conflict-bar__btn toolbar-btn--primary rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-700"
            >
              Reload
            </button>
          </div>
        ) : null}

        <div
          ref={containerRef}
          className={clsx(
            "message-editor__body flex flex-1 overflow-hidden",
            wide ? "flex-col" : "flex-row",
          )}
        >
          {/* Editor section */}
          <section
            className="message-editor__pane--form flex flex-col overflow-hidden bg-white"
            style={{
              order: wide ? 3 : 1,
              flexBasis: `${100 - splitPercent}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <nav className="tab-bar flex h-10 shrink-0 items-stretch border-b border-slate-100 bg-slate-50 px-2">
              <TabBtn active={tab === "naming"} onClick={() => setTab("naming")} icon={<Tag className="size-3.5" />}>
                Naming
              </TabBtn>
              <TabBtn active={tab === "template"} onClick={() => setTab("template")} icon={<FileCode className="size-3.5" />}>
                Template
              </TabBtn>
              <TabBtn active={tab === "content"} onClick={() => setTab("content")} icon={<FileText className="size-3.5" />}>
                Content
              </TabBtn>
              <TabBtn active={tab === "styles"} onClick={() => setTab("styles")} icon={<PencilRuler className="size-3.5" />}>
                Styles
              </TabBtn>
              <TabBtn active={tab === "trafficking"} onClick={() => setTab("trafficking")} icon={<Rocket className="size-3.5" />}>
                Trafficking
              </TabBtn>
            </nav>

            <div className="message-editor__tab-content flex-1 overflow-y-auto px-5 pb-80 pt-4">
              {tab === "naming" ? (
                <NamingTab message={message} aud={aud} top={top} draft={draft} setDraft={setDraft} />
              ) : null}
              {tab === "content" ? (
                <ContentTab
                  draft={draft}
                  setDraft={setDraft}
                  mcLabel={mcLabel}
                  templateSizes={
                    templatesQ.data?.templates.find(
                      (t) => t.name === (draft.template ?? "html"),
                    )?.sizes ?? []
                  }
                />
              ) : null}
              {tab === "styles" ? <StylesTab draft={draft} setDraft={setDraft} /> : null}
              {tab === "trafficking" ? (
                <TraffickingTab
                  message={committedSnapshot ?? message}
                  draft={draft}
                  setDraft={setDraft}
                />
              ) : null}
              {tab === "template" ? (
                <TemplateTab
                  draft={draft}
                  setDraft={setDraft}
                  templates={templatesQ.data?.templates ?? []}
                />
              ) : null}
            </div>
          </section>

          {/* Draggable divider */}
          <div
            onMouseDown={startDrag}
            className={clsx(
              "divider-handle shrink-0 bg-slate-200 transition-colors hover:bg-slate-400",
              wide ? "divider-handle--horizontal h-1 w-full cursor-row-resize" : "divider-handle--vertical h-full w-1 cursor-col-resize",
            )}
            style={{ order: 2 }}
            title="Drag to resize"
          />

          {/* Preview section */}
          <section
            className="message-editor__pane--preview flex flex-col overflow-hidden bg-slate-50"
            style={{
              order: wide ? 1 : 3,
              flexBasis: `${splitPercent}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <MessagePreview
              message={committedSnapshot ?? message}
              draft={draft}
              templateInfo={templatesQ.data?.templates.find((t) => t.name === (draft.template ?? "html"))}
              onSizeChange={setPreviewSize}
            />
          </section>
        </div>
      </div>
    </ModalBackdrop>
    {historyOpen && committedSnapshot ? (
      <EntityHistoryDrawer
        entity="messages"
        entityId={committedSnapshot.id}
        label={mcLabel}
        onClose={() => setHistoryOpen(false)}
      />
    ) : null}
    </>
  );
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

class VersionMismatchError extends Error {
  current: Message;
  constructor(current: Message) {
    super("version_mismatch");
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
        Conflict — reload needed
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

function TabBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "tab-bar__tab inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition",
        active
          ? "tab-bar__tab--active border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:text-slate-700",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="form-field mb-3 block">
      <div className="form-field__label mb-1 text-xs font-medium text-slate-700">{label}</div>
      {children}
      {hint ? <div className="form-field__hint mt-1 text-[10px] text-slate-400">{hint}</div> : null}
    </label>
  );
}

function NamingTab({
  message,
  aud,
  top,
  draft,
  setDraft,
}: {
  message: Message;
  aud: Audience | undefined;
  top: Topic | undefined;
  draft: EditableFields;
  setDraft: SetDraft;
}) {
  return (
    <div className="message-editor-tab message-editor-tab--naming form-grid grid grid-cols-2 gap-x-4">
      <Field label="MC Number">
        <input
          readOnly
          value={message.number}
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-sm text-slate-700"
        />
      </Field>
      <Field label="Variant">
        <input
          readOnly
          value={message.variant}
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-sm text-slate-700"
        />
      </Field>

      <div className="col-span-2">
        <Field label="Status">
          <select
            value={draft.status ?? ""}
            onChange={(e) =>
              setDraft((prev) =>
                prev ? { ...prev, status: e.target.value } : prev,
              )
            }
            className="custom-dropdown w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="col-span-2">
        <Field label="Message name" hint="Short label visible in the matrix and feed views.">
          <input
            type="text"
            value={draft.name ?? ""}
            onChange={(e) =>
              setDraft((prev) =>
                prev ? { ...prev, name: e.target.value || null } : prev,
              )
            }
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </Field>
      </div>

      <div className="col-span-2">
        <Field label="Audience key">
          <input
            disabled
            value={aud?.key ?? message.audience}
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-500 disabled:cursor-not-allowed"
          />
        </Field>
      </div>
      <div className="col-span-2">
        <Field label="Topic key">
          <input
            disabled
            value={top?.key ?? message.topic}
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-500 disabled:cursor-not-allowed"
          />
        </Field>
      </div>

      <EntityBlock title="Audience properties" rows={audienceRows(aud)} />
      <EntityBlock title="Topic properties" rows={topicRows(top)} />
    </div>
  );
}

type EntityRow = { label: string; value: string };

function audienceRows(aud: Audience | undefined): EntityRow[] {
  return [
    { label: "Name", value: aud?.name ?? "—" },
    { label: "Product", value: aud?.product ?? "—" },
    { label: "Tag", value: aud?.tag ?? "—" },
    { label: "Strategy", value: aud?.strategy ?? "—" },
    { label: "Data source", value: aud?.dataSource ?? "—" },
    { label: "Targeting type", value: aud?.targetingType ?? "—" },
    { label: "Campaign ID", value: aud?.campaignId ?? "—" },
    { label: "Lineitem ID", value: aud?.lineitemId ?? "—" },
    { label: "Comment", value: aud?.comment ?? "—" },
  ];
}

function topicRows(top: Topic | undefined): EntityRow[] {
  return [
    { label: "Name", value: top?.name ?? "—" },
    { label: "Product", value: top?.product ?? "—" },
    { label: "Tag", value: top?.tag ?? "—" },
    { label: "Tag 1", value: top?.tag1 ?? "—" },
    { label: "Tag 2", value: top?.tag2 ?? "—" },
    { label: "Tag 3", value: top?.tag3 ?? "—" },
    { label: "Tag 4", value: top?.tag4 ?? "—" },
    { label: "Created", value: top?.created ?? "—" },
    { label: "Comment", value: top?.comment ?? "—" },
  ];
}

function EntityBlock({ title, rows }: { title: string; rows: EntityRow[] }) {
  return (
    <div className="naming-tab__entity-block rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="naming-tab__entity-title mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {title}
      </div>
      <dl className="naming-tab__entity-rows grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {rows.map((r) => (
          <Fragment key={r.label}>
            <dt className="naming-tab__entity-row-label text-[10px] font-medium uppercase tracking-wide text-slate-500 self-center">
              {r.label}
            </dt>
            <dd
              className="naming-tab__entity-row-value break-words text-xs text-slate-800"
              title={r.value}
            >
              {r.value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

type FormattingRule = {
  id: number;
  textOriginal: string;
  textFormatted: string;
  formattingScope: string | null;
  formattingMcScope: string | null;
  version: number;
  archivedAt: string | null;
};

const FORMATTABLE_FIELDS = [
  { key: "headline", label: "Headline", kind: "input" as const },
  { key: "copy1", label: "Copy 1", kind: "textarea" as const, rows: 3 },
  { key: "copy2", label: "Copy 2", kind: "textarea" as const, rows: 2 },
  { key: "disclaimer", label: "Disclaimer", kind: "textarea" as const, rows: 2 },
  { key: "flash", label: "Flash badge", kind: "input" as const },
  { key: "cta", label: "CTA text", kind: "input" as const },
] as const;

function ContentTab({
  draft,
  setDraft,
  mcLabel,
  templateSizes,
}: {
  draft: EditableFields;
  setDraft: SetDraft;
  mcLabel: string;
  templateSizes: string[];
}) {
  function set(k: keyof EditableFields, v: string) {
    setDraft((prev) => (prev ? { ...prev, [k]: v || null } : prev));
  }
  const rulesQ = useTextFormattingRules();
  const allRules = useMemo(
    () => (rulesQ.data ?? []).filter((r) => r.archivedAt === null),
    [rulesQ.data],
  );

  return (
    <>
      {FORMATTABLE_FIELDS.map((f) => (
        <TextFieldWithFormatting
          key={f.key}
          fieldKey={f.key}
          label={f.label}
          kind={f.kind}
          rows={"rows" in f ? f.rows : undefined}
          value={(draft[f.key] as string | null) ?? ""}
          onChange={(v) => set(f.key, v)}
          allRules={allRules}
          mcLabel={mcLabel}
          templateSizes={templateSizes}
        />
      ))}
      <Field label="Landing URL">
        <input
          type="url"
          value={draft.landingUrl ?? ""}
          onChange={(e) => set("landingUrl", e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
        />
      </Field>

      <div className="content-tab__media mt-4 border-t border-slate-200 pt-4">
        <div className="content-tab__media-label mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
          Images & video
        </div>
        <div className="form-grid grid grid-cols-2 gap-x-3 gap-y-2">
          {(["image1", "image2", "image3", "image4", "image5", "image6"] as const).map((k, i) => (
            <MediaField
              key={k}
              label={`Image ${i + 1}`}
              value={draft[k] ?? ""}
              onChange={(v) => set(k, v)}
              kind="image"
            />
          ))}
          <MediaField
            label="Video 1"
            value={draft.video1 ?? ""}
            onChange={(v) => set("video1", v)}
            kind="video"
          />
        </div>
      </div>
    </>
  );
}

function TextFieldWithFormatting({
  fieldKey,
  label,
  kind,
  rows,
  value,
  onChange,
  allRules,
  mcLabel,
  templateSizes,
}: {
  fieldKey: keyof EditableFields;
  label: string;
  kind: "input" | "textarea";
  rows?: number;
  value: string;
  onChange: (v: string) => void;
  allRules: FormattingRule[];
  mcLabel: string;
  templateSizes: string[];
}) {
  const qc = useQueryClient();
  // Drafts (unsaved rules) live locally per field. Each draft has a stable
  // local id so React keys are stable across renders.
  const [drafts, setDrafts] = useState<
    Array<{ key: string; textFormatted: string; scope: string[]; isGlobal: boolean }>
  >([]);
  const draftCounter = useRef(0);

  function addDraft() {
    draftCounter.current += 1;
    const k = `draft-${fieldKey}-${draftCounter.current}`;
    setDrafts((prev) => [...prev, { key: k, textFormatted: "", scope: [], isGlobal: true }]);
  }

  function updateDraft(key: string, patch: Partial<{ textFormatted: string; scope: string[]; isGlobal: boolean }>) {
    setDrafts((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d)),
    );
  }

  function removeDraft(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  async function saveDraft(key: string) {
    const d = drafts.find((x) => x.key === key);
    if (!d) return;
    if (!value || !d.textFormatted) return;
    const payload = {
      textOriginal: value,
      textFormatted: d.textFormatted,
      formattingScope: d.scope.length === 0 ? null : d.scope.join(","),
      formattingMcScope: d.isGlobal ? null : mcLabel,
    };
    const r = await fetch("/api/text-formatting", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return;
    removeDraft(key);
    qc.invalidateQueries({ queryKey: ["text-formatting"] });
  }

  // Rules visible under this field: existing rules whose textOriginal matches
  // the field's current value (case-sensitive — render.ts also uses literal
  // regex match). Once the user changes the field, formerly-matching rules
  // disappear from this list, exactly as in v5.
  const matching = useMemo(
    () => allRules.filter((r) => r.textOriginal === value && value.length > 0),
    [allRules, value],
  );

  const InputEl = kind === "textarea" ? "textarea" : "input";
  const inputClass =
    "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";

  return (
    <div className="form-field formatted-field mb-3">
      <div className="formatted-field__label-row mb-1 flex items-center justify-between">
        <div className="form-field__label text-xs font-medium text-slate-700">
          {label}
        </div>
        <button
          type="button"
          onClick={addDraft}
          disabled={!value}
          title={value ? "Add a formatting rule for this text" : "Type something first"}
          className="link-button inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Type className="size-3" />
          add text formatting
        </button>
      </div>
      <InputEl
        type={kind === "input" ? "text" : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={kind === "textarea" ? rows : undefined}
        className={inputClass}
      />
      {matching.map((rule) => (
        <TextFormattingRuleRow
          key={`r-${rule.id}`}
          rule={rule}
          mcLabel={mcLabel}
          templateSizes={templateSizes}
        />
      ))}
      {drafts.map((d) => (
        <TextFormattingDraftRow
          key={d.key}
          draft={d}
          templateSizes={templateSizes}
          onChange={(patch) => updateDraft(d.key, patch)}
          onRemove={() => removeDraft(d.key)}
          onCommit={() => saveDraft(d.key)}
          canSave={value.length > 0 && d.textFormatted.length > 0}
        />
      ))}
    </div>
  );
}

function TextFormattingRuleRow({
  rule,
  mcLabel,
  templateSizes,
}: {
  rule: FormattingRule;
  mcLabel: string;
  templateSizes: string[];
}) {
  const qc = useQueryClient();
  // Local edit buffer mirrors persisted state but lets the user type freely;
  // a 400ms debounce flushes PATCH calls.
  const [textFormatted, setTextFormatted] = useState(rule.textFormatted);
  const [scope, setScope] = useState<string[]>(parseCsv(rule.formattingScope));
  const [isGlobal, setIsGlobal] = useState<boolean>(rule.formattingMcScope === null);
  // Track the last-known persisted version to send in If-Match payloads.
  const versionRef = useRef(rule.version);
  // Keep buffers fresh if the rule rerenders with new server data.
  useEffect(() => {
    setTextFormatted(rule.textFormatted);
    setScope(parseCsv(rule.formattingScope));
    setIsGlobal(rule.formattingMcScope === null);
    versionRef.current = rule.version;
  }, [rule.id, rule.version]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty =
    textFormatted !== rule.textFormatted ||
    csvOf(scope) !== (rule.formattingScope ?? "") ||
    (isGlobal ? null : mcLabel) !== rule.formattingMcScope;

  useEffect(() => {
    if (!dirty) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const payload = {
        version: versionRef.current,
        textFormatted,
        formattingScope: scope.length === 0 ? null : scope.join(","),
        formattingMcScope: isGlobal ? null : mcLabel,
      };
      const r = await fetch(`/api/text-formatting/${rule.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        const body = (await r.json()) as { rule: FormattingRule };
        versionRef.current = body.rule.version;
        qc.invalidateQueries({ queryKey: ["text-formatting"] });
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [textFormatted, scope, isGlobal, dirty, rule.id, mcLabel, qc]);

  async function onDelete() {
    const r = await fetch(`/api/text-formatting/${rule.id}`, {
      method: "DELETE",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "If-Match": String(versionRef.current),
      },
    });
    if (r.ok) qc.invalidateQueries({ queryKey: ["text-formatting"] });
  }

  return (
    <FormattingRow
      textFormatted={textFormatted}
      onTextFormattedChange={setTextFormatted}
      scope={scope}
      onScopeChange={setScope}
      isGlobal={isGlobal}
      onIsGlobalChange={setIsGlobal}
      templateSizes={templateSizes}
      onDelete={onDelete}
    />
  );
}

function TextFormattingDraftRow({
  draft,
  templateSizes,
  onChange,
  onRemove,
  onCommit,
  canSave,
}: {
  draft: { textFormatted: string; scope: string[]; isGlobal: boolean };
  templateSizes: string[];
  onChange: (patch: Partial<{ textFormatted: string; scope: string[]; isGlobal: boolean }>) => void;
  onRemove: () => void;
  onCommit: () => void;
  canSave: boolean;
}) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!canSave) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onCommit(), 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [canSave, draft.textFormatted, draft.scope, draft.isGlobal, onCommit]);

  return (
    <FormattingRow
      textFormatted={draft.textFormatted}
      onTextFormattedChange={(v) => onChange({ textFormatted: v })}
      scope={draft.scope}
      onScopeChange={(v) => onChange({ scope: v })}
      isGlobal={draft.isGlobal}
      onIsGlobalChange={(v) => onChange({ isGlobal: v })}
      templateSizes={templateSizes}
      onDelete={onRemove}
      placeholder="Enter formatted text…"
    />
  );
}

function FormattingRow({
  textFormatted,
  onTextFormattedChange,
  scope,
  onScopeChange,
  isGlobal,
  onIsGlobalChange,
  templateSizes,
  onDelete,
  placeholder,
}: {
  textFormatted: string;
  onTextFormattedChange: (v: string) => void;
  scope: string[];
  onScopeChange: (s: string[]) => void;
  isGlobal: boolean;
  onIsGlobalChange: (v: boolean) => void;
  templateSizes: string[];
  onDelete: () => void;
  placeholder?: string;
}) {
  return (
    <div className="text-format-rule mt-2 flex items-center gap-2">
      <input
        type="text"
        value={textFormatted}
        onChange={(e) => onTextFormattedChange(e.target.value)}
        placeholder={placeholder}
        className="text-format-rule__input min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
      />
      <ScopeMultiSelect
        scope={scope}
        onChange={onScopeChange}
        sizes={templateSizes}
      />
      <button
        type="button"
        onClick={() => onIsGlobalChange(!isGlobal)}
        className={clsx(
          "text-format-rule__toggle toggle-tag rounded-md border px-2 py-1 text-[11px] font-medium",
          isGlobal
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        )}
        title={isGlobal ? "Applies in every MC" : "Applies in this MC only"}
      >
        {isGlobal ? "Global" : "Local"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Remove formatting rule"
        className="text-format-rule__delete row-delete-btn rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-rose-600"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function ScopeMultiSelect({
  scope,
  onChange,
  sizes,
}: {
  scope: string[];
  onChange: (s: string[]) => void;
  sizes: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDoc);
    return () => window.removeEventListener("mousedown", onDoc);
  }, [open]);
  const allSelected = scope.length === 0;
  const label = allSelected
    ? "All sizes"
    : scope.length === 1
      ? scope[0]
      : `${scope.length} sizes`;
  function toggleAll() {
    onChange([]);
    setOpen(false);
  }
  function toggleSize(size: string) {
    if (scope.includes(size)) {
      const next = scope.filter((s) => s !== size);
      onChange(next);
    } else {
      onChange([...scope, size]);
    }
  }
  return (
    <div ref={ref} className="text-format-rule__scope dropdown relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="dropdown-trigger inline-flex min-w-[96px] items-center justify-between gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
      >
        <span>{label}</span>
        <ChevronDown className="size-3" />
      </button>
      {open ? (
        <div className="dropdown-menu absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-md border border-slate-200 bg-white py-1 shadow-md">
          <button
            type="button"
            onClick={toggleAll}
            className={clsx(
              "dropdown-item flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-slate-100",
              allSelected && "bg-slate-50 font-medium",
            )}
          >
            <span
              className={clsx(
                "flex size-3.5 items-center justify-center rounded-sm border",
                allSelected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-400",
              )}
            >
              {allSelected ? <Check className="size-2.5" strokeWidth={3} /> : null}
            </span>
            All sizes
          </button>
          {sizes.map((s) => {
            const selected = scope.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleSize(s)}
                className="dropdown-item flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-slate-100"
              >
                <span
                  className={clsx(
                    "flex size-3.5 items-center justify-center rounded-sm border",
                    selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-400",
                  )}
                >
                  {selected ? <Check className="size-2.5" strokeWidth={3} /> : null}
                </span>
                {s}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function parseCsv(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function csvOf(arr: string[]): string {
  return arr.join(",");
}

function MediaField({
  label,
  value,
  onChange,
  kind,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  kind: "image" | "video";
}) {
  // v5 AssetAutocomplete pattern: the field input IS the search box. Typing
  // ≥2 chars opens a dropdown of asset matches anchored below; click an option
  // to fill the field. No separate search input.
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const assetsQ = useQuery({
    queryKey: ["assets"],
    queryFn: async () => {
      const r = await fetch("/api/assets", { credentials: "include" });
      if (!r.ok) throw new Error("assets");
      return (await r.json()) as { assets: AssetRow[] };
    },
  });

  const formats = kind === "image" ? IMAGE_FORMATS : VIDEO_FORMATS;
  const matches = useMemo(() => {
    const term = text.trim().toLowerCase();
    if (term.length < ASSET_AUTOCOMPLETE_MIN) return [];
    const all = assetsQ.data?.assets ?? [];
    return all
      .filter((a) => {
        if (!a.fileId || !a.fileName) return false;
        const declared = (a.fileFormat ?? "").toLowerCase();
        const fromName = a.fileName.split(".").pop()?.toLowerCase() ?? "";
        const ext = declared || fromName;
        if (!formats.has(ext)) return false;
        return [a.fileName, a.visualKeyword, a.product, a.brand].some((v) =>
          (v ?? "").toLowerCase().includes(term),
        );
      })
      .slice(0, 20);
  }, [text, assetsQ.data, formats]);

  function handleChange(v: string) {
    setText(v);
    onChange(v);
    setOpen(v.trim().length >= ASSET_AUTOCOMPLETE_MIN);
  }

  function pick(a: AssetRow) {
    const fn = a.fileName ?? "";
    setText(fn);
    onChange(fn);
    setOpen(false);
  }

  const thumbSrc = value ? `/api/drive/proxy/${encodeURIComponent(value)}` : null;
  const showEmpty =
    open && text.trim().length >= ASSET_AUTOCOMPLETE_MIN && matches.length === 0;

  return (
    <div className="form-field media-field block" ref={containerRef}>
      <div className="form-field__label mb-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="media-field__control flex items-center gap-2">
        <div className="media-field__thumb thumb-checker size-9 shrink-0 overflow-hidden rounded border border-slate-200">
          {thumbSrc && kind === "image" ? (
            <img src={thumbSrc} alt={value} className="size-full object-contain" loading="lazy" />
          ) : thumbSrc && kind === "video" ? (
            <video
              src={`${thumbSrc}#t=0.1`}
              className="size-full object-contain"
              preload="metadata"
              muted
              playsInline
            />
          ) : null}
        </div>
        <div className="media-field__input-wrap relative min-w-0 flex-1">
          <input
            type="text"
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => {
              if (text.trim().length >= ASSET_AUTOCOMPLETE_MIN) setOpen(true);
            }}
            placeholder={kind === "image" ? "filename.jpg" : "filename.mp4"}
            autoComplete="off"
            className="w-full rounded-md border border-slate-300 px-2 py-1 pr-6 font-mono text-xs focus:border-slate-500 focus:outline-none"
          />
          {text ? (
            <button
              type="button"
              onClick={() => {
                setText("");
                onChange("");
                setOpen(false);
              }}
              title={`Clear ${label}`}
              aria-label={`Clear ${label}`}
              className="media-field__clear absolute inset-y-0 right-1 my-auto flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="size-3" />
            </button>
          ) : null}
          {open && matches.length > 0 ? (
            <div className="asset-autocomplete absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
              {matches.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => pick(a)}
                  title={a.fileName ?? ""}
                  className="asset-autocomplete__item flex w-full items-center gap-2 border-b border-slate-100 px-2 py-1 text-left last:border-b-0 hover:bg-slate-50"
                >
                  <div className="asset-autocomplete__thumb thumb-checker size-7 shrink-0 overflow-hidden rounded">
                    {kind === "image" ? (
                      <img
                        src={`/api/files/${a.fileId}/thumbnail?w=120`}
                        alt={a.fileName ?? ""}
                        className="size-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <video
                        src={`/api/files/${a.fileId}#t=0.1`}
                        className="size-full object-contain"
                        preload="metadata"
                        muted
                        playsInline
                      />
                    )}
                  </div>
                  <span className="asset-autocomplete__name truncate font-mono text-xs text-slate-700">
                    {a.fileName}
                  </span>
                </button>
              ))}
            </div>
          ) : showEmpty ? (
            <div className="asset-autocomplete asset-autocomplete--empty absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-slate-200 bg-white px-2 py-2 text-center text-xs text-slate-400 shadow-lg">
              No matching assets
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StylesTab({
  draft,
  setDraft,
}: {
  draft: EditableFields;
  setDraft: SetDraft;
}) {
  function set(k: keyof EditableFields, v: string) {
    setDraft((prev) => (prev ? { ...prev, [k]: v || null } : prev));
  }
  const stylePairs: Array<[keyof EditableFields, string]> = [
    ["headlineStyle", "Headline style"],
    ["copy1Style", "Copy 1 style"],
    ["copy2Style", "Copy 2 style"],
    ["disclaimerStyle", "Disclaimer style"],
    ["ctaStyle", "CTA style"],
    ["flashStyle", "Flash style"],
  ];
  return (
    <>
      <p className="mb-3 text-xs text-slate-500">
        Per-element inline CSS (e.g. <code className="font-mono">font-size:1.1rem;</code>)
        applied to the corresponding text in the rendered template.
      </p>
      {stylePairs.map(([k, label]) => (
        <Field key={k} label={label}>
          <input
            type="text"
            value={(draft[k] as string) ?? ""}
            onChange={(e) => set(k, e.target.value)}
            placeholder="font-size: 1.1rem;"
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
          />
        </Field>
      ))}
      <Field
        label="Custom CSS"
        hint="Free-form per-message overrides. Wrap with .size-300x250 selectors when scoping to a banner size."
      >
        <textarea
          value={draft.customCss ?? ""}
          onChange={(e) => set("customCss", e.target.value)}
          rows={10}
          spellCheck={false}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
        />
      </Field>
    </>
  );
}

function TraffickingTab({
  message,
  draft,
  setDraft,
}: {
  message: Message;
  draft: EditableFields;
  setDraft: SetDraft;
}) {
  const ro = "w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700";
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="Start date">
          <input
            type="date"
            value={draft.startDate ?? ""}
            onChange={(e) =>
              setDraft((prev) =>
                prev ? { ...prev, startDate: e.target.value || null } : prev,
              )
            }
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </Field>
        <Field label="End date">
          <input
            type="date"
            value={draft.endDate ?? ""}
            onChange={(e) =>
              setDraft((prev) =>
                prev ? { ...prev, endDate: e.target.value || null } : prev,
              )
            }
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </Field>
      </div>

      <p className="mb-3 mt-2 text-xs text-slate-500">
        PMMID and UTM fields below are generated from{" "}
        <code className="font-mono">config.patterns.trafficking</code> on every save.
      </p>
      <Field label="PMMID">
        <input readOnly value={message.pmmid ?? ""} className={ro} />
      </Field>
      <div className="grid grid-cols-2 gap-x-4">
        <Field label="UTM campaign">
          <input readOnly value={message.utmCampaign ?? ""} className={ro} />
        </Field>
        <Field label="UTM source">
          <input readOnly value={message.utmSource ?? ""} className={ro} />
        </Field>
        <Field label="UTM medium">
          <input readOnly value={message.utmMedium ?? ""} className={ro} />
        </Field>
        <Field label="UTM content">
          <input readOnly value={message.utmContent ?? ""} className={ro} />
        </Field>
        <Field label="UTM term">
          <input readOnly value={message.utmTerm ?? ""} className={ro} />
        </Field>
        <Field label="UTM cd26">
          <input readOnly value={message.utmCd26 ?? ""} className={ro} />
        </Field>
      </div>
      <Field label="Final trafficked URL">
        <textarea readOnly rows={3} value={message.finalTraffickedUrl ?? ""} className={ro} />
      </Field>
    </>
  );
}

function TemplateTab({
  draft,
  setDraft,
  templates,
}: {
  draft: EditableFields;
  setDraft: SetDraft;
  templates: TemplateInfo[];
}) {
  const current = templates.find((t) => t.name === (draft.template ?? "html"));
  const tagOptions = current?.tagOptions ?? [];
  const activeTags = new Set(
    (draft.templateVariantClasses ?? "")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );

  function toggleTag(opt: string) {
    const next = new Set(activeTags);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    setDraft({
      ...draft,
      templateVariantClasses: [...next].join(" ") || null,
    });
  }

  return (
    <>
      <Field
        label="Template"
        hint={
          current
            ? `Sizes: ${current.sizes.join(", ")} · default ${current.defaultSize ?? "—"}`
            : "Pick a template to see available sizes."
        }
      >
        <select
          value={draft.template ?? ""}
          onChange={(e) =>
            setDraft((prev) =>
              prev ? { ...prev, template: e.target.value || null } : prev,
            )
          }
          className="custom-dropdown w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        >
          <option value="">— none —</option>
          {templates.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Variant classes"
        hint="Space-separated CSS class names applied to the template root."
      >
        {tagOptions.length > 0 ? (
          <div className="toggle-group flex flex-wrap gap-1.5">
            {tagOptions.map((opt) => {
              const active = activeTags.has(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggleTag(opt)}
                  className={clsx(
                    "toggle-btn rounded-full border px-2.5 py-0.5 text-xs transition",
                    active
                      ? "toggle-btn--active border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        ) : null}
        <input
          type="text"
          value={draft.templateVariantClasses ?? ""}
          onChange={(e) =>
            setDraft({
              ...draft,
              templateVariantClasses: e.target.value || null,
            })
          }
          placeholder="animated topRoundedFrame"
          className="mt-2 w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
        />
      </Field>
    </>
  );
}

// ── Preview pane: live iframe, debounced ──
function MessagePreview({
  message,
  draft,
  templateInfo,
  onSizeChange,
}: {
  message: Message;
  draft: EditableFields;
  templateInfo?: TemplateInfo;
  onSizeChange?: (s: string) => void;
}) {
  // nonDCO static-image MC: no template, image1 = a creative file. The size
  // dropdown then lists the REAL sizes of this creative — same MC number+variant,
  // one creatives row per stored size — and switching size shows that file.
  const draftImage1 = draft.image1 ?? message.image1 ?? null;
  const draftTemplate = draft.template ?? message.template ?? null;
  const isStatic = !draftTemplate && !!draftImage1;

  const siblingsQ = useQuery({
    queryKey: ["creatives", "by-mc", message.number, message.variant],
    queryFn: async () => {
      const r = await fetch(
        `/api/creatives/by-mc?number=${message.number}&variant=${encodeURIComponent(message.variant)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<{
        sizes: { dimensions: string; fileName: string; type: string | null }[];
      }>;
    },
    enabled: isStatic,
  });

  // dim → fileName (first wins), largest area first for a sensible dropdown order.
  const staticSizeMap = useMemo(() => {
    const m = new Map<string, string>();
    const rows = [...(siblingsQ.data?.sizes ?? [])].sort((a, b) => {
      const ar = a.dimensions.match(/^(\d+)x(\d+)$/);
      const br = b.dimensions.match(/^(\d+)x(\d+)$/);
      return (br ? +br[1]! * +br[2]! : 0) - (ar ? +ar[1]! * +ar[2]! : 0);
    });
    for (const s of rows) if (!m.has(s.dimensions)) m.set(s.dimensions, s.fileName);
    return m;
  }, [siblingsQ.data]);
  const staticSizes = useMemo(() => [...staticSizeMap.keys()], [staticSizeMap]);

  const templateSizes = templateInfo?.sizes ?? [
    "300x250",
    "300x600",
    "640x360",
    "970x250",
    "1080x510",
  ];
  const sizes = isStatic ? staticSizes : templateSizes;
  const [size, setSize] = useState<string>(templateSizes[0] ?? "300x250");
  // Reset the selected size when the available set changes. In static mode
  // default to the size whose file IS the current image1 (else the first).
  useEffect(() => {
    if (sizes.length === 0 || sizes.includes(size)) return;
    if (isStatic) {
      const cur = [...staticSizeMap.entries()].find(([, f]) => f === draftImage1);
      setSize(cur?.[0] ?? sizes[0]!);
    } else {
      setSize(sizes[0]!);
    }
  }, [sizes.join(","), isStatic]);
  // Notify parent so layout can react to landscape/portrait.
  useEffect(() => {
    onSizeChange?.(size);
  }, [size]);

  const [html, setHtml] = useState<string>("");
  // Preview background: remembered per-browser (mm6_preview_bg) so it doesn't
  // reset every time the editor opens. Falls back to the static-vs-html default
  // (static creatives → checker, matching the Creative Library preview dialog).
  const [bg, setBg] = useState<PreviewBg>(() => {
    try {
      const v = localStorage.getItem("mm6_preview_bg");
      if (v === "light" || v === "dark" || v === "checker") return v;
    } catch {
      // ignore storage failures
    }
    return isStatic ? "checker" : "light";
  });
  useEffect(() => {
    try {
      localStorage.setItem("mm6_preview_bg", bg);
    } catch {
      // ignore storage failures
    }
  }, [bg]);
  const [skipAnim, setSkipAnim] = useState<boolean>(true);
  const [imagePreview, setImagePreview] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stored-preview-PNG mode (Image preview toggle): per-size status + generate.
  const qc = useQueryClient();
  const previewInfoQ = useQuery({
    queryKey: ["previews", "message", message.id],
    queryFn: async () => {
      const r = await fetch(`/api/previews/status?message_id=${message.id}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<{
        messageId: number;
        version: number;
        sizes: {
          size: string;
          previewId: number | null;
          stale: boolean;
          updatedAt: string | null;
        }[];
      }>;
    },
    enabled: imagePreview,
  });
  const generateM = useMutation({
    mutationFn: async (force: boolean) => {
      const r = await fetch("/api/previews/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_ids: [message.id], force }),
      });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json() as Promise<{
        results: ({ messageId: number; size: string } & (
          | { ok: true; previewId: number }
          | { ok: false; error: string }
        ))[];
        freshSkipped: number;
      }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["previews", "message", message.id] });
      qc.invalidateQueries({ queryKey: ["previews", "status"] });
    },
  });

  const sizeEntry = previewInfoQ.data?.sizes.find((s) => s.size === size);
  // ?v= is load-bearing: /api/previews/[id] is cached (max-age=300) on a
  // regen-stable id, so the img would show the old PNG after Regenerate.
  const imageUrl = sizeEntry?.previewId
    ? `/api/previews/${sizeEntry.previewId}?v=${encodeURIComponent(sizeEntry.updatedAt ?? "")}`
    : null;
  const failedForSize = generateM.data?.results.find(
    (r) => r.size === size && !r.ok,
  ) as { error: string } | undefined;
  const otherFailures =
    generateM.data?.results.filter((r) => !r.ok && r.size !== size).length ?? 0;
  const imageError = generateM.isError
    ? (generateM.error as Error).message
    : failedForSize
      ? failedForSize.error
      : otherFailures > 0
        ? `${otherFailures} other size(s) failed`
        : null;

  function refresh() {
    const merged: Record<string, unknown> = { ...message, ...draft };
    if (skipAnim) {
      const tvc = (merged.templateVariantClasses ?? "") as string;
      merged.templateVariantClasses = tvc
        .split(/\s+/)
        .filter((c) => c && c !== "animated")
        .join(" ");
    }
    // nonDCO static-image MC: no template but a creative image. Skip the render
    // fetch (it would 404 on a missing template dir) — PreviewPane shows the
    // image directly via the staticImage prop below.
    const resolvedTemplate = draft.template ?? message.template ?? null;
    const staticImg = (draft.image1 ?? message.image1) ?? null;
    if (!resolvedTemplate && staticImg) {
      setHtml("");
      return;
    }
    const templateName = resolvedTemplate ?? "html";
    fetch("/api/render", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateName,
        size,
        message: merged,
        inline: true,
        skipAnimations: skipAnim,
      }),
    })
      .then((r) => (r.ok ? r.text() : Promise.reject(r)))
      .then(setHtml)
      .catch(async (err) => {
        if (err instanceof Response) {
          const txt = await err.text();
          setHtml(`<pre style="padding:8px;color:#b91c1c;font:12px monospace">${escapeHtml(txt)}</pre>`);
        }
      });
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [message.id, size, skipAnim, JSON.stringify(draft)]);

  return (
    <PreviewPane
      html={html}
      sizes={sizes}
      size={size}
      onSizeChange={setSize}
      bg={bg}
      onBgChange={setBg}
      skipAnim={skipAnim}
      onSkipAnimChange={setSkipAnim}
      onRefresh={refresh}
      imagePreview={imagePreview}
      onImagePreviewChange={setImagePreview}
      imageState={{
        url: imageUrl,
        stale: sizeEntry?.stale ?? true,
        generating: generateM.isPending,
        error: imageError,
        onGenerate: () => generateM.mutate(Boolean(sizeEntry?.previewId)),
      }}
      templateName={templateInfo?.name}
      templateMeta={templateMetaFor(templateInfo)}
      staticImage={isStatic ? (staticSizeMap.get(size) ?? draftImage1) : null}
    />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>'"]/g, (c) =>
    c === "&"
      ? "&amp;"
      : c === "<"
        ? "&lt;"
        : c === ">"
          ? "&gt;"
          : c === "'"
            ? "&#39;"
            : "&quot;",
  );
}
