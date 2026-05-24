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
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Check,
  CircleAlert,
  Users,
  ListTree,
} from "lucide-react";
import clsx from "clsx";
import {
  type Audience,
  type Message,
  type Topic,
  STATUS_COLOR,
} from "./types";
import PreviewPane, { type PreviewBg } from "../_components/PreviewPane";
import ModalBackdrop from "../_components/ModalBackdrop";
import { usePersistent, type Codec } from "../_components/usePersistent";
import { AutocompleteField } from "../_components/AutocompleteField";
import { templateMetaFor } from "../_components/MatrixIframeTile";

type TemplateInfo = {
  name: string;
  sizes: string[];
  defaultSize: string | null;
  kind?: "html" | "adobe" | "figma" | "after_effects";
  previewFile?: string | null;
  externalUrl?: string | null;
};

type EntityKind = "audience" | "topic";

type Props = {
  kind: EntityKind;
  entity: Audience | Topic;
  messages: Message[];
  templates: TemplateInfo[];
  onClose: () => void;
};

const PREVIEW_BG_CODEC: Codec<PreviewBg> = {
  parse: (s) => (s === "light" || s === "dark" || s === "checker" ? s : "checker"),
  stringify: (v) => v,
};
const BOOL_CODEC: Codec<boolean> = {
  parse: (s) => s === "true",
  stringify: (v) => (v ? "true" : "false"),
};
const NUM_CODEC: Codec<number> = {
  parse: (s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : 50;
  },
  stringify: (v) => String(v),
};
const STRING_OR_NULL_CODEC: Codec<string | null> = {
  parse: (s) => (s === "" ? null : s),
  stringify: (v) => v ?? "",
};

type AudienceDraft = Pick<
  Audience,
  | "name"
  | "orderIndex"
  | "status"
  | "product"
  | "strategy"
  | "buyingPlatform"
  | "dataSource"
  | "targetingType"
  | "device"
  | "tag"
  | "comment"
  | "campaignName"
  | "campaignId"
  | "lineitemName"
  | "lineitemId"
>;
type TopicDraft = Pick<
  Topic,
  | "name"
  | "orderIndex"
  | "status"
  | "product"
  | "tag"
  | "tag1"
  | "tag2"
  | "tag3"
  | "tag4"
  | "comment"
  | "created"
>;
type Draft = AudienceDraft | TopicDraft;

function audienceDraft(a: Audience): AudienceDraft {
  return {
    name: a.name,
    orderIndex: a.orderIndex,
    status: a.status,
    product: a.product,
    strategy: a.strategy,
    buyingPlatform: a.buyingPlatform,
    dataSource: a.dataSource,
    targetingType: a.targetingType,
    device: a.device,
    tag: a.tag,
    comment: a.comment,
    campaignName: a.campaignName,
    campaignId: a.campaignId,
    lineitemName: a.lineitemName,
    lineitemId: a.lineitemId,
  };
}
function topicDraft(t: Topic): TopicDraft {
  return {
    name: t.name,
    orderIndex: t.orderIndex,
    status: t.status,
    product: t.product,
    tag: t.tag,
    tag1: t.tag1,
    tag2: t.tag2,
    tag3: t.tag3,
    tag4: t.tag4,
    comment: t.comment,
    created: t.created,
  };
}

function toDraft(kind: EntityKind, entity: Audience | Topic): Draft {
  return kind === "audience"
    ? audienceDraft(entity as Audience)
    : topicDraft(entity as Topic);
}

function diffPayload(before: Draft, after: Draft): Partial<Draft> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(after) as Array<keyof Draft>) {
    if ((before[k] ?? null) !== (after[k] ?? null)) {
      out[k] = after[k] ?? null;
    }
  }
  return out as Partial<Draft>;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

class VersionMismatchError extends Error {
  current: Audience | Topic;
  constructor(current: Audience | Topic) {
    super("version_mismatch");
    this.current = current;
  }
}

function isLandscape(size: string | null): boolean {
  if (!size) return false;
  const m = size.match(/^(\d+)x(\d+)$/);
  if (!m) return false;
  const w = parseInt(m[1]!, 10);
  const h = parseInt(m[2]!, 10);
  if (h === 0) return false;
  return w / h >= 1.5;
}

export default function HeaderDetailDialog({
  kind,
  entity,
  messages,
  templates,
  onClose,
}: Props) {
  // ── Persisted preview settings (shared bg key with MatrixDetailDialog) ──
  const [bg, setBg] = usePersistent<PreviewBg>(
    "mm6_media_dialog_preview_bg",
    "checker",
    PREVIEW_BG_CODEC,
  );
  const [savedSize, setSavedSize] = usePersistent<string | null>(
    "mm6_matrix_header_dialog_size",
    null,
    STRING_OR_NULL_CODEC,
  );
  const [skipAnim, setSkipAnim] = usePersistent<boolean>(
    "mm6_matrix_header_dialog_skip_anim",
    true,
    BOOL_CODEC,
  );
  const [splitPercent, setSplitPercent] = usePersistent<number>(
    "mm6_matrix_header_dialog_split",
    50,
    NUM_CODEC,
  );

  // ── Edit state (autosave w/ optimistic lock) ──
  const [committed, setCommitted] = useState<Audience | Topic>(entity);
  const [draft, setDraft] = useState<Draft>(() => toDraft(kind, entity));
  const [autoSave, setAutoSave] = useState<boolean>(true);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });

  // Reseed only when the dialog is showing a different entity (id/kind
  // change). Do NOT reseed on entity.version — parent re-fetches after a save
  // would otherwise wipe in-progress edits typed between save start and
  // invalidation. Conflict resolution (409 → setCommitted(e.current)) handles
  // external edits gracefully.
  useEffect(() => {
    setCommitted(entity);
    setDraft(toDraft(kind, entity));
    setSaveState({ kind: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id, kind]);

  // ── Stepper across the (already filtered) messages ──
  // For topic kind, dedupe by (number, variant): the same MC can appear
  // across multiple audiences but shares content, so stepping duplicates
  // would just repeat the same preview.
  const steppable = useMemo(() => {
    const list = messages.slice();
    list.sort((a, b) =>
      a.number !== b.number
        ? a.number - b.number
        : (a.variant ?? "").localeCompare(b.variant ?? ""),
    );
    if (kind !== "topic") return list;
    const seen = new Set<string>();
    const out: Message[] = [];
    for (const m of list) {
      const k = `${m.number}|${m.variant ?? ""}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
    return out;
  }, [messages, kind]);
  const totalMcCount = messages.length;
  const [stepIndex, setStepIndex] = useState<number>(0);
  useEffect(() => {
    setStepIndex(0);
  }, [entity.id, kind]);
  useEffect(() => {
    if (stepIndex >= steppable.length) setStepIndex(0);
  }, [steppable.length, stepIndex]);

  const currentMc: Message | null = steppable[stepIndex] ?? null;

  // Resolve effective preview size: persisted size if supported by the
  // current MC's template; otherwise template default; otherwise first size.
  const currentTemplate = useMemo(
    () =>
      currentMc?.template
        ? templates.find((t) => t.name === currentMc.template)
        : undefined,
    [currentMc?.template, templates],
  );
  const sizes = currentTemplate?.sizes ?? [];
  const effectiveSize = useMemo<string | null>(() => {
    if (sizes.length === 0) return null;
    if (savedSize && sizes.includes(savedSize)) return savedSize;
    return currentTemplate?.defaultSize ?? sizes[0] ?? null;
  }, [savedSize, sizes, currentTemplate?.defaultSize]);

  const wide = isLandscape(effectiveSize);

  // ── Render iframe HTML for current MC ──
  const [html, setHtml] = useState<string>("");
  function refreshPreview() {
    if (!currentMc || !currentTemplate || !effectiveSize) {
      setHtml("");
      return;
    }
    const merged: Record<string, unknown> = { ...currentMc };
    if (skipAnim) {
      const tvc = (merged.templateVariantClasses ?? "") as string;
      merged.templateVariantClasses = tvc
        .split(/\s+/)
        .filter((c) => c && c !== "animated")
        .join(" ");
    }
    fetch("/api/render", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateName: currentTemplate.name,
        size: effectiveSize,
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
          setHtml(
            `<pre style="padding:8px;color:#b91c1c;font:12px monospace">${escapeHtml(
              txt,
            )}</pre>`,
          );
        } else {
          setHtml("");
        }
      });
  }
  useEffect(() => {
    refreshPreview();
  }, [
    currentMc?.id,
    currentMc?.version,
    currentTemplate?.name,
    effectiveSize,
    skipAnim,
  ]);

  // ── PATCH mutation w/ optimistic locking ──
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (payload: Partial<Draft>) => {
      if (Object.keys(payload).length === 0) return null;
      const url = kind === "audience"
        ? `/api/audiences/${committed.id}`
        : `/api/topics/${committed.id}`;
      const r = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "If-Match": String(committed.version),
        },
        body: JSON.stringify(payload),
      });
      if (r.status === 409) {
        const body = (await r.json()) as
          | { currentRow: Audience }
          | { currentRow: Topic };
        throw new VersionMismatchError(body.currentRow);
      }
      if (!r.ok) {
        throw new Error(await r.text());
      }
      const body = (await r.json()) as
        | { audience: Audience }
        | { topic: Topic };
      return "audience" in body ? body.audience : body.topic;
    },
    onSuccess: (saved) => {
      if (saved) {
        setCommitted(saved);
        qc.invalidateQueries({
          queryKey: [kind === "audience" ? "audiences" : "topics"],
        });
      }
      setSaveState({ kind: "saved" });
      setTimeout(() => {
        setSaveState((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      }, 1500);
    },
    onError: (e) => {
      if (e instanceof VersionMismatchError) {
        setSaveState({ kind: "conflict" });
        setCommitted(e.current);
        qc.invalidateQueries({
          queryKey: [kind === "audience" ? "audiences" : "topics"],
        });
      } else {
        setSaveState({ kind: "error", message: (e as Error).message });
      }
    },
  });

  // Autosave debounce (400 ms), like MessageEditor.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!autoSave) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    const payload = diffPayload(toDraft(kind, committed), draft);
    if (Object.keys(payload).length === 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState({ kind: "saving" });
    debounceRef.current = setTimeout(() => save.mutate(payload), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [draft, committed, autoSave, kind]);

  const isDirty = useMemo(() => {
    const payload = diffPayload(toDraft(kind, committed), draft);
    return Object.keys(payload).length > 0;
  }, [draft, committed, kind]);

  function manualSave() {
    if (!isDirty) return;
    const payload = diffPayload(toDraft(kind, committed), draft);
    setSaveState({ kind: "saving" });
    save.mutate(payload);
  }
  function manualCancel() {
    setDraft(toDraft(kind, committed));
    setSaveState({ kind: "idle" });
  }

  // ── ESC closes; arrow keys step ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "ArrowLeft" && stepIndex > 0) {
        setStepIndex((i) => i - 1);
      }
      if (e.key === "ArrowRight" && stepIndex < steppable.length - 1) {
        setStepIndex((i) => i + 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ── Divider drag ──
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<boolean>(false);
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
  }, [wide, setSplitPercent]);

  const heading = kind === "audience" ? "Audience" : "Topic";
  const HeadingIcon = kind === "audience" ? Users : ListTree;

  return (
    <ModalBackdrop onClose={onClose} className="z-50 items-stretch">
      <div
        className={clsx(
          "matrix-header-dialog modal m-auto flex h-[90vh] w-[90vw] max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl",
          wide && "matrix-header-dialog--landscape",
        )}
      >
        <header className="matrix-header-dialog__header modal__header flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3">
          <HeadingIcon className="size-4 text-slate-500" />
          <span className="matrix-header-dialog__kind text-[10px] font-medium uppercase tracking-wider text-slate-500">
            {heading}
          </span>
          <span
            className="matrix-header-dialog__title truncate text-sm font-semibold text-slate-900"
            title={draft.name ?? ""}
          >
            {draft.name ?? "—"}
          </span>
          <span
            className="matrix-header-dialog__key truncate font-mono text-xs text-slate-400"
            title={committed.key}
          >
            {committed.key}
          </span>
          <SaveIndicator state={saveState} />

          <div className="matrix-header-dialog__header-actions ml-auto flex items-center gap-2">
            <button
              onClick={() => setAutoSave((v) => !v)}
              className={clsx(
                "matrix-header-dialog__autosave-toggle flex items-center gap-1 rounded border px-2 py-1 text-xs",
                autoSave
                  ? "matrix-header-dialog__autosave-toggle--active border-slate-900 bg-slate-900 text-white"
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
              <span className="matrix-header-dialog__modified-tag text-xs text-amber-600">
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
            "matrix-header-dialog__body flex flex-1 overflow-hidden",
            wide ? "flex-col" : "flex-row",
          )}
        >
          {/* Edit form */}
          <section
            className="matrix-header-dialog__pane--form flex flex-col overflow-hidden bg-white"
            style={{
              order: wide ? 3 : 1,
              flexBasis: `${100 - splitPercent}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <div className="matrix-header-dialog__form-content flex-1 overflow-y-auto px-5 py-4 text-xs">
              {kind === "audience" ? (
                <AudienceForm
                  draft={draft as AudienceDraft}
                  setDraft={(d) => setDraft(d)}
                  committed={committed as Audience}
                  mcCount={steppable.length}
                />
              ) : (
                <TopicForm
                  draft={draft as TopicDraft}
                  setDraft={(d) => setDraft(d)}
                  committed={committed as Topic}
                  mcCount={totalMcCount}
                  uniqueMcCount={steppable.length}
                />
              )}
            </div>
          </section>

          {/* Divider */}
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

          {/* Steppable preview */}
          <section
            className="matrix-header-dialog__pane--preview flex flex-col overflow-hidden bg-slate-50"
            style={{
              order: wide ? 1 : 3,
              flexBasis: `${splitPercent}%`,
              flexGrow: 0,
              flexShrink: 0,
            }}
          >
            <StepperStrip
              steppable={steppable}
              stepIndex={stepIndex}
              setStepIndex={setStepIndex}
              currentMc={currentMc}
            />
            {steppable.length === 0 ? (
              <div className="matrix-header-dialog__empty-preview flex flex-1 items-center justify-center text-xs text-slate-400">
                No MCs match the current filters in this {kind}.
              </div>
            ) : (
              <PreviewPane
                html={html}
                sizes={sizes}
                size={effectiveSize}
                onSizeChange={(s) => setSavedSize(s)}
                bg={bg}
                onBgChange={setBg}
                skipAnim={skipAnim}
                onSkipAnimChange={setSkipAnim}
                onRefresh={refreshPreview}
                templateName={currentTemplate?.name}
                templateMeta={templateMetaFor(currentTemplate)}
              />
            )}
          </section>
        </div>
      </div>
    </ModalBackdrop>
  );
}

function StepperStrip({
  steppable,
  stepIndex,
  setStepIndex,
  currentMc,
}: {
  steppable: Message[];
  stepIndex: number;
  setStepIndex: (i: number) => void;
  currentMc: Message | null;
}) {
  const mcLabel = currentMc
    ? `MC${currentMc.number}${currentMc.variant ?? ""}`
    : "—";
  return (
    <div className="matrix-header-dialog__stepper flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
      <button
        onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
        disabled={stepIndex <= 0}
        aria-label="Previous"
        className="matrix-header-dialog__nav-prev rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="matrix-header-dialog__mc-label font-mono text-sm font-semibold text-slate-900">
        {mcLabel}
      </span>
      <button
        onClick={() =>
          setStepIndex(Math.min(steppable.length - 1, stepIndex + 1))
        }
        disabled={stepIndex >= steppable.length - 1}
        aria-label="Next"
        className="matrix-header-dialog__nav-next rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
      >
        <ChevronRight className="size-4" />
      </button>
      {steppable.length > 0 ? (
        <span className="matrix-header-dialog__nav-counter text-xs text-slate-500">
          {stepIndex + 1}/{steppable.length}
        </span>
      ) : null}
      {currentMc?.status ? (
        <span className="status-badge ml-2 inline-flex items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
          <span
            className={clsx(
              "status-dot size-1.5 rounded-full",
              STATUS_COLOR[currentMc.status] ?? "bg-slate-300",
            )}
          />
          {currentMc.status}
        </span>
      ) : null}
      {currentMc?.name ? (
        <span className="matrix-header-dialog__mc-name ml-1 truncate text-xs text-slate-500">
          {currentMc.name}
        </span>
      ) : null}
    </div>
  );
}

function AudienceForm({
  draft,
  setDraft,
  committed,
  mcCount,
}: {
  draft: AudienceDraft;
  setDraft: (d: AudienceDraft) => void;
  committed: Audience;
  mcCount: number;
}) {
  function set<K extends keyof AudienceDraft>(k: K, v: AudienceDraft[K]) {
    setDraft({ ...draft, [k]: v });
  }
  return (
    <div className="matrix-header-form form-grid grid grid-cols-2 gap-x-4">
      <Field label="Key" hint="Read-only — renaming would orphan messages.">
        <input readOnly value={committed.key} className={readOnlyCls} />
      </Field>
      <Field label="MC count">
        <input readOnly value={String(mcCount)} className={readOnlyCls} />
      </Field>

      <SectionHeader>Identity</SectionHeader>
      <div className="col-span-2">
        <Field label="Name">
          <input
            value={draft.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="Status">
        <AutocompleteField
          form="audiences"
          field="status"
          value={draft.status ?? ""}
          onChange={(v) => set("status", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Product">
        <input
          value={draft.product ?? ""}
          onChange={(e) => set("product", e.target.value || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Order" hint="Display order in the matrix (lower first).">
        <input
          type="number"
          value={draft.orderIndex}
          onChange={(e) =>
            set("orderIndex", Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : draft.orderIndex)
          }
          className={inputCls}
        />
      </Field>

      <SectionHeader>Targeting</SectionHeader>
      <Field label="Strategy">
        <AutocompleteField
          form="audiences"
          field="strategy"
          value={draft.strategy ?? ""}
          onChange={(v) => set("strategy", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Device">
        <AutocompleteField
          form="audiences"
          field="device"
          value={draft.device ?? ""}
          onChange={(v) => set("device", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Buying platform">
        <AutocompleteField
          form="audiences"
          field="buyingPlatform"
          value={draft.buyingPlatform ?? ""}
          onChange={(v) => set("buyingPlatform", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Data source">
        <AutocompleteField
          form="audiences"
          field="dataSource"
          value={draft.dataSource ?? ""}
          onChange={(v) => set("dataSource", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Targeting type">
        <AutocompleteField
          form="audiences"
          field="targetingType"
          value={draft.targetingType ?? ""}
          onChange={(v) => set("targetingType", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Tag">
        <input
          value={draft.tag ?? ""}
          onChange={(e) => set("tag", e.target.value || null)}
          className={inputCls}
        />
      </Field>

      <SectionHeader>Trafficking</SectionHeader>
      <Field label="Campaign name">
        <input
          value={draft.campaignName ?? ""}
          onChange={(e) => set("campaignName", e.target.value || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Campaign ID">
        <input
          value={draft.campaignId ?? ""}
          onChange={(e) => set("campaignId", e.target.value || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Lineitem name">
        <input
          value={draft.lineitemName ?? ""}
          onChange={(e) => set("lineitemName", e.target.value || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Lineitem ID">
        <input
          value={draft.lineitemId ?? ""}
          onChange={(e) => set("lineitemId", e.target.value || null)}
          className={inputCls}
        />
      </Field>

      <div className="col-span-2">
        <Field label="Comment">
          <textarea
            value={draft.comment ?? ""}
            onChange={(e) => set("comment", e.target.value || null)}
            rows={3}
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  );
}

function TopicForm({
  draft,
  setDraft,
  committed,
  mcCount,
  uniqueMcCount,
}: {
  draft: TopicDraft;
  setDraft: (d: TopicDraft) => void;
  committed: Topic;
  mcCount: number;
  uniqueMcCount: number;
}) {
  function set<K extends keyof TopicDraft>(k: K, v: TopicDraft[K]) {
    setDraft({ ...draft, [k]: v });
  }
  return (
    <div className="matrix-header-form form-grid grid grid-cols-2 gap-x-4">
      <Field label="Key" hint="Read-only — renaming would orphan messages.">
        <input readOnly value={committed.key} className={readOnlyCls} />
      </Field>
      <Field label="MC count">
        <input
          readOnly
          value={`${mcCount} (Unique: ${uniqueMcCount})`}
          className={readOnlyCls}
        />
      </Field>

      <SectionHeader>Identity</SectionHeader>
      <div className="col-span-2">
        <Field label="Name">
          <input
            value={draft.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="Status">
        <AutocompleteField
          form="topics"
          field="status"
          value={draft.status ?? ""}
          onChange={(v) => set("status", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Product">
        <input
          value={draft.product ?? ""}
          onChange={(e) => set("product", e.target.value || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Order" hint="Display order in the matrix (lower first).">
        <input
          type="number"
          value={draft.orderIndex}
          onChange={(e) =>
            set("orderIndex", Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : draft.orderIndex)
          }
          className={inputCls}
        />
      </Field>
      <Field label="Created" hint="ISO date — feeds key generation patterns.">
        <input
          type="date"
          value={draft.created ?? ""}
          onChange={(e) => set("created", e.target.value || null)}
          className={inputCls}
        />
      </Field>

      <SectionHeader>Tags</SectionHeader>
      <Field label="Tag">
        <input
          value={draft.tag ?? ""}
          onChange={(e) => set("tag", e.target.value || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Tag 1">
        <AutocompleteField
          form="topics"
          field="tag1"
          value={draft.tag1 ?? ""}
          onChange={(v) => set("tag1", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Tag 2">
        <AutocompleteField
          form="topics"
          field="tag2"
          value={draft.tag2 ?? ""}
          onChange={(v) => set("tag2", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Tag 3">
        <AutocompleteField
          form="topics"
          field="tag3"
          value={draft.tag3 ?? ""}
          onChange={(v) => set("tag3", v || null)}
          className={inputCls}
        />
      </Field>
      <Field label="Tag 4">
        <input
          value={draft.tag4 ?? ""}
          onChange={(e) => set("tag4", e.target.value || null)}
          className={inputCls}
        />
      </Field>

      <div className="col-span-2">
        <Field label="Comment">
          <textarea
            value={draft.comment ?? ""}
            onChange={(e) => set("comment", e.target.value || null)}
            rows={3}
            className={inputCls}
          />
        </Field>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="matrix-header-form__section-header col-span-2 mt-3 mb-1 border-b border-slate-200 pb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
      {children}
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none";
const readOnlyCls =
  "w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700";

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="form-field mb-3 block">
      <div className="form-field__label mb-1 text-xs font-medium text-slate-700">
        {label}
      </div>
      {children}
      {hint ? (
        <div className="form-field__hint mt-1 text-[10px] text-slate-400">
          {hint}
        </div>
      ) : null}
    </label>
  );
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
