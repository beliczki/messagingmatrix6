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

  // Auto-save on draft changes — 400ms debounce.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draft || !committedSnapshot) return;
    const payload = diffPayload(toEditable(committedSnapshot), draft);
    if (Object.keys(payload).length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState({ kind: "saving" });
    debounceRef.current = setTimeout(() => save.mutate(payload), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, committedSnapshot]);

  if (!open || !message || !draft) return null;

  const mcLabel = `MC${message.number}${message.variant}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="m-auto flex h-[90vh] w-[90vw] max-w-6xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Form column */}
        <div className="flex w-[58%] flex-col border-r border-slate-100">
          <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <button
              onClick={navigatePrev}
              disabled={navIndex <= 0}
              aria-label="Previous"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="font-mono text-base font-semibold text-slate-900">
              {mcLabel}
            </span>
            <button
              onClick={navigateNext}
              disabled={navIndex < 0 || navIndex >= visibleMessages.length - 1}
              aria-label="Next"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
            {visibleMessages.length > 0 ? (
              <span className="text-xs text-slate-500">
                {navIndex + 1}/{visibleMessages.length}
              </span>
            ) : null}
            <span
              className={clsx(
                "ml-2 inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs",
                "border border-slate-200 bg-white",
              )}
            >
              <span
                className={clsx(
                  "size-2 rounded-full",
                  STATUS_COLOR[draft.status ?? ""] ?? "bg-slate-300",
                )}
              />
              {draft.status ?? "—"}
            </span>
            <SaveIndicator state={saveState} />
            <button
              onClick={onClose}
              aria-label="Close"
              className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="size-5" />
            </button>
          </header>

          <nav className="flex border-b border-slate-100 bg-slate-50/60 px-2">
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

          <div className="flex-1 overflow-y-auto px-5 py-4">
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
        </div>

        {/* Preview column */}
        <PreviewPane
          message={committedSnapshot ?? message}
          draft={draft}
          templateInfo={templatesQ.data?.templates.find((t) => t.name === (draft.template ?? "html"))}
        />
      </div>
    </div>
  );
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
      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (state.kind === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  if (state.kind === "conflict") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700">
        <CircleAlert className="size-3" />
        Refreshed (someone else edited this)
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-rose-700"
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
        "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition",
        active
          ? "border-slate-900 text-slate-900"
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
    <label className="mb-3 block">
      <div className="mb-1 text-xs font-medium text-slate-700">{label}</div>
      {children}
      {hint ? <div className="mt-1 text-[10px] text-slate-400">{hint}</div> : null}
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
    <div className="grid grid-cols-2 gap-x-4">
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
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
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
          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
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
          <div className="flex flex-wrap gap-1.5">
            {tagOptions.map((opt) => {
              const active = activeTags.has(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggleTag(opt)}
                  className={clsx(
                    "rounded-full border px-2.5 py-0.5 text-xs transition",
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
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
function PreviewPane({
  message,
  draft,
  templateInfo,
}: {
  message: Message;
  draft: EditableFields;
  templateInfo?: TemplateInfo;
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

  const [html, setHtml] = useState<string>("");
  const [bg, setBg] = useState<"light" | "dark" | "checker">("light");
  const [skipAnim, setSkipAnim] = useState<boolean>(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const merged = { ...message, ...draft };
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
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [message.id, size, skipAnim, JSON.stringify(draft)]);

  const bgClass =
    bg === "dark"
      ? "bg-slate-900"
      : bg === "checker"
        ? "bg-[length:20px_20px] bg-[conic-gradient(at_50%_50%,_#e2e8f0_25%,_#fff_0_50%,_#e2e8f0_0_75%,_#fff_0)]"
        : "bg-slate-100";

  return (
    <div className="flex w-[42%] flex-col bg-slate-50">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="text-xs font-medium text-slate-700">Preview</span>
        <select
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs"
        >
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer select-none items-center gap-1 text-[11px] text-slate-600">
          <input
            type="checkbox"
            checked={skipAnim}
            onChange={(e) => setSkipAnim(e.target.checked)}
            className="size-3.5"
          />
          Skip animation
        </label>
        <div className="ml-auto flex items-center gap-1 rounded border border-slate-200 bg-white p-0.5 text-[10px]">
          {(["light", "dark", "checker"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setBg(b)}
              className={clsx(
                "rounded px-1.5 py-0.5",
                bg === b ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
      <div className={clsx("flex flex-1 items-center justify-center overflow-auto", bgClass)}>
        <iframe
          srcDoc={html}
          sandbox="allow-scripts allow-same-origin"
          scrolling="no"
          style={iframeSize(size)}
          className="border border-slate-300 bg-white shadow-lg"
        />
      </div>
    </div>
  );
}

function iframeSize(size: string): { width: number; height: number } {
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return { width: 300, height: 250 };
  return { width: Number(m[1]), height: Number(m[2]) };
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
