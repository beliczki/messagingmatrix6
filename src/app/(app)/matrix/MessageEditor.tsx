"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import clsx from "clsx";
import { type Audience, type Message, type Topic, STATUS_COLOR } from "./types";
import PreviewPane, { type PreviewBg } from "../_components/PreviewPane";

type Tab = "naming" | "template" | "content" | "styles" | "trafficking";

const STATUS_OPTIONS = [
  "INCOMING",
  "NAMING",
  "CONTENT",
  "PREVIEW",
  "APPROVED",
  "ACTIVE",
  "INACTIVE",
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
};

type Props = {
  open: boolean;
  message: Message | null;
  audiences: Audience[];
  topics: Topic[];
  /** Filtered, ordered set the user is currently navigating. */
  visibleMessages: Message[];
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
  | "headlineStyle"
  | "copy1Style"
  | "copy2Style"
  | "disclaimerStyle"
  | "ctaStyle"
  | "flashStyle"
  | "customCss"
  | "template"
  | "templateVariantClasses"
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
  "headlineStyle",
  "copy1Style",
  "copy2Style",
  "disclaimerStyle",
  "ctaStyle",
  "flashStyle",
  "customCss",
  "template",
  "templateVariantClasses",
];

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
  | { kind: "conflict" };

export default function MessageEditor({
  open,
  message,
  audiences,
  topics,
  visibleMessages,
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

  // Re-seed draft + snapshot every time the open message changes (initial
  // open AND prev/next navigation). Leaves the active tab alone.
  useEffect(() => {
    if (open && message) {
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

  const navIndex = useMemo(
    () =>
      message
        ? visibleMessages.findIndex((m) => m.id === message.id)
        : -1,
    [visibleMessages, message?.id],
  );

  function navigatePrev() {
    if (navIndex > 0) onJump(visibleMessages[navIndex - 1].id);
  }
  function navigateNext() {
    if (navIndex >= 0 && navIndex < visibleMessages.length - 1) {
      onJump(visibleMessages[navIndex + 1].id);
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
  const save = useMutation({
    mutationFn: async (payload: Partial<EditableFields>) => {
      if (!committedSnapshot) throw new Error("no snapshot");
      if (Object.keys(payload).length === 0) return null;
      const r = await fetch(`/api/messages/${committedSnapshot.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(committedSnapshot.version),
        },
        body: JSON.stringify(payload),
      });
      if (r.status === 409) {
        const body = (await r.json()) as { currentRow: Message };
        throw new VersionMismatchError(body.currentRow);
      }
      if (!r.ok) {
        throw new Error(await r.text());
      }
      const body = (await r.json()) as { message: Message };
      return body.message;
    },
    onSuccess: (saved) => {
      if (saved) {
        // Bump our snapshot so the next save uses the new version.
        setCommittedSnapshot(saved);
        qc.invalidateQueries({ queryKey: ["messages"] });
      }
      setSaveState({ kind: "saved" });
      // Clear "saved" indicator after 1.5s.
      setTimeout(() => {
        setSaveState((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      }, 1500);
    },
    onError: (e) => {
      if (e instanceof VersionMismatchError) {
        setSaveState({ kind: "conflict" });
        setCommittedSnapshot(e.current);
        qc.invalidateQueries({ queryKey: ["messages"] });
      } else {
        setSaveState({ kind: "error", message: (e as Error).message });
      }
    },
  });

  // Auto-save on draft changes — 400ms debounce. Disabled when autoSave=false.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!autoSave) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    if (!draft || !committedSnapshot) return;
    const payload = diffPayload(toEditable(committedSnapshot), draft);
    if (Object.keys(payload).length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState({ kind: "saving" });
    debounceRef.current = setTimeout(() => save.mutate(payload), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, committedSnapshot, autoSave]);

  const isDirty = useMemo(() => {
    if (!draft || !committedSnapshot) return false;
    const payload = diffPayload(toEditable(committedSnapshot), draft);
    return Object.keys(payload).length > 0;
  }, [draft, committedSnapshot]);

  function manualSave() {
    if (!draft || !committedSnapshot || !isDirty) return;
    const payload = diffPayload(toEditable(committedSnapshot), draft);
    setSaveState({ kind: "saving" });
    save.mutate(payload);
  }

  function manualCancel() {
    if (!committedSnapshot) return;
    setDraft(toEditable(committedSnapshot));
    setSaveState({ kind: "idle" });
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
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-stretch bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={clsx(
          "message-editor modal m-auto flex h-[90vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl",
          wide && "message-editor--landscape",
        )}
        onClick={(e) => e.stopPropagation()}
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
          <span className="message-editor__mc-label font-mono text-base font-semibold text-slate-900">
            {mcLabel}
          </span>
          <button
            onClick={navigateNext}
            disabled={navIndex < 0 || navIndex >= visibleMessages.length - 1}
            aria-label="Next"
            className="message-editor__nav-next rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
          {visibleMessages.length > 0 ? (
            <span className="message-editor__nav-counter text-xs text-slate-500">
              {navIndex + 1}/{visibleMessages.length}
            </span>
          ) : null}
          <span
            className={clsx(
              "status-badge ml-2 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs",
              "border border-slate-200 bg-white",
            )}
          >
            <span
              className={clsx(
                "status-dot size-2 rounded-full",
                STATUS_COLOR[draft.status ?? ""] ?? "bg-slate-300",
              )}
            />
            {draft.status ?? "—"}
          </span>
          <SaveIndicator state={saveState} />

          <div className="message-editor__header-actions ml-auto flex items-center gap-2">
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
            <nav className="tab-bar flex h-10 shrink-0 items-stretch border-b border-slate-100 bg-slate-50/60 px-2">
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

            <div className="message-editor__tab-content flex-1 overflow-y-auto px-5 py-4">
              {tab === "naming" ? (
                <NamingTab message={message} aud={aud} top={top} draft={draft} setDraft={setDraft} />
              ) : null}
              {tab === "content" ? <ContentTab draft={draft} setDraft={setDraft} /> : null}
              {tab === "styles" ? <StylesTab draft={draft} setDraft={setDraft} /> : null}
              {tab === "trafficking" ? <TraffickingTab message={committedSnapshot ?? message} /> : null}
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
    </div>
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
  setDraft: (d: EditableFields) => void;
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
            onChange={(e) => setDraft({ ...draft, status: e.target.value || null })}
            className="custom-dropdown w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          >
            <option value="">— none —</option>
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
            onChange={(e) => setDraft({ ...draft, name: e.target.value || null })}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </Field>
      </div>

      <Field label="Audience">
        <input
          readOnly
          value={aud ? `${aud.name} — ${aud.key}` : message.audience}
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
        />
      </Field>
      <Field label="Topic">
        <input
          readOnly
          value={top ? `${top.name} — ${top.key}` : message.topic}
          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
        />
      </Field>
    </div>
  );
}

function ContentTab({
  draft,
  setDraft,
}: {
  draft: EditableFields;
  setDraft: (d: EditableFields) => void;
}) {
  function set(k: keyof EditableFields, v: string) {
    setDraft({ ...draft, [k]: v || null });
  }
  return (
    <>
      <Field label="Headline">
        <input
          type="text"
          value={draft.headline ?? ""}
          onChange={(e) => set("headline", e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </Field>
      <Field label="Copy 1">
        <textarea
          value={draft.copy1 ?? ""}
          onChange={(e) => set("copy1", e.target.value)}
          rows={3}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </Field>
      <Field label="Copy 2">
        <textarea
          value={draft.copy2 ?? ""}
          onChange={(e) => set("copy2", e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </Field>
      <Field label="Disclaimer">
        <textarea
          value={draft.disclaimer ?? ""}
          onChange={(e) => set("disclaimer", e.target.value)}
          rows={2}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </Field>
      <Field label="Flash badge">
        <input
          type="text"
          value={draft.flash ?? ""}
          onChange={(e) => set("flash", e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </Field>
      <Field label="CTA text">
        <input
          type="text"
          value={draft.cta ?? ""}
          onChange={(e) => set("cta", e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
        />
      </Field>
      <Field label="Landing URL">
        <input
          type="url"
          value={draft.landingUrl ?? ""}
          onChange={(e) => set("landingUrl", e.target.value)}
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-slate-500 focus:outline-none"
        />
      </Field>
    </>
  );
}

function StylesTab({
  draft,
  setDraft,
}: {
  draft: EditableFields;
  setDraft: (d: EditableFields) => void;
}) {
  function set(k: keyof EditableFields, v: string) {
    setDraft({ ...draft, [k]: v || null });
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

function TraffickingTab({ message }: { message: Message }) {
  const ro = "w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700";
  return (
    <>
      <p className="mb-3 text-xs text-slate-500">
        Generated from <code className="font-mono">config.patterns.trafficking</code>{" "}
        on every save. Read-only here.
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
  setDraft: (d: EditableFields) => void;
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
            setDraft({ ...draft, template: e.target.value || null })
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
  const sizes = templateInfo?.sizes ?? [
    "300x250",
    "300x600",
    "640x360",
    "970x250",
    "1080x510",
  ];
  const [size, setSize] = useState<string>(sizes[0] ?? "300x250");
  // If the template's sizes change (e.g. user switches template), reset size.
  useEffect(() => {
    if (!sizes.includes(size)) setSize(sizes[0] ?? "300x250");
  }, [sizes.join(",")]);
  // Notify parent so layout can react to landscape/portrait.
  useEffect(() => {
    onSizeChange?.(size);
  }, [size]);

  const [html, setHtml] = useState<string>("");
  const [bg, setBg] = useState<PreviewBg>("light");
  const [skipAnim, setSkipAnim] = useState<boolean>(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refresh() {
    const merged: Record<string, unknown> = { ...message, ...draft };
    if (skipAnim) {
      const tvc = (merged.templateVariantClasses ?? "") as string;
      merged.templateVariantClasses = tvc
        .split(/\s+/)
        .filter((c) => c && c !== "animated")
        .join(" ");
    }
    const templateName = draft.template ?? message.template ?? "html";
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
