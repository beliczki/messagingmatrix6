"use client";

// Where does this draft go? A draft is a card that has claimed its MC number
// but has no cell yet, and this tab is the one question it exists to answer.
//
// Three targets, one mechanism. DCO and Agentic differ only in WHICH audience
// is sent: the channel list is presented as Audience rows (channel = code), and
// promoteDraft resolves both through the same lookup, so an Agentic placement
// is an ordinary promote onto a channel rather than a second code path. "Both"
// is promote + copy — a draft is one row and can become only one card, so the
// second axis is a CLONE of the first (copy fans a card out; create would make
// two unrelated cards that merely share a number).
import { useMemo, useState } from "react";
import { Archive, ArrowUpRight, Loader2 } from "lucide-react";
import clsx from "clsx";
import Field from "./EditorField";
import type { Audience, DraftMessage, Topic } from "./types";

const TARGETS = [
  { key: "dco", label: "DCO" },
  { key: "agentic", label: "Agentic" },
  { key: "both", label: "Both" },
] as const;
type Target = (typeof TARGETS)[number]["key"];

export default function PromoteTab({
  draft,
  productValue,
  onProductChange,
  audiences,
  topics,
  onDone,
}: {
  draft: DraftMessage;
  /** `draftProduct` from the live edit state, so typing shows immediately. */
  productValue: string | null;
  onProductChange: (product: string | null) => void;
  audiences: Audience[];
  topics: Topic[];
  onDone: () => void;
}) {
  const [target, setTarget] = useState<Target>("dco");
  const [audienceKey, setAudienceKey] = useState("");
  const [channelKey, setChannelKey] = useState("");
  const [topicKey, setTopicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same partition the matrix uses for its axis switch: a channel-audience
  // (channel != null) is the Agentic side, everything else is DCO.
  const dcoAudiences = useMemo(
    () => audiences.filter((a) => a.channel == null),
    [audiences],
  );
  const channels = useMemo(
    () => audiences.filter((a) => a.channel != null),
    [audiences],
  );
  // The product vocabulary is whatever the dimensions already use — read off
  // audiences and topics rather than kept as a second hardcoded list that
  // would drift from them.
  const productOptions = useMemo(() => {
    const s = new Set<string>();
    for (const a of audiences) if (a.product) s.add(a.product);
    for (const t of topics) if (t.product) s.add(t.product);
    return [...s].sort();
  }, [audiences, topics]);

  const needsDco = target === "dco" || target === "both";
  const needsChannel = target === "agentic" || target === "both";
  // For a pure Agentic promote the channel IS the cell's audience.
  const cellAudience = target === "agentic" ? channelKey : audienceKey;
  const ready =
    !!topicKey && (!needsDco || !!audienceKey) && (!needsChannel || !!channelKey);

  async function run(fn: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error ?? `${r.status} ${r.statusText}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const promote = () =>
    run(() =>
      fetch(`/api/drafts/${draft.id}/promote`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          target,
          audienceKey: cellAudience,
          topicKey,
          ...(target === "both" ? { agenticAudienceKey: channelKey } : {}),
          version: draft.version,
        }),
      }),
    );

  const archive = () =>
    run(() =>
      fetch(`/api/messages/${draft.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "if-match": String(draft.version) },
      }),
    );

  return (
    <div className="message-editor-tab message-editor-tab--promote">
      <p className="mb-3 text-xs text-slate-500">
        MC{draft.number}
        {draft.variant} is already reserved — nothing else can take the number.
        Promoting gives it a cell and keeps the number.
      </p>

      <Field
        label="Product"
        hint="Groups the draft on the drafts page. Once it has a cell the product comes from the cell instead, so this is only needed while it is a draft."
      >
        <select
          value={productValue ?? ""}
          onChange={(e) => onProductChange(e.target.value || null)}
          className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        >
          <option value="">— not set yet —</option>
          {productOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Target">
        <div className="tab-bar tab-bar--segmented inline-flex rounded-md border border-slate-300 p-0.5">
          {TARGETS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTarget(t.key)}
              className={clsx(
                "tab-bar__tab rounded px-3 py-1 text-xs font-medium transition",
                target === t.key
                  ? "tab-bar__tab--active bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Field>

      {needsDco ? (
        <Field label="DCO audience">
          <select
            value={audienceKey}
            onChange={(e) => setAudienceKey(e.target.value)}
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
          >
            <option value="">Audience…</option>
            {dcoAudiences.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name || a.key}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {needsChannel ? (
        <Field
          label="Agentic channel"
          hint={
            target === "both"
              ? "The twin is a COPY of the DCO card — same number, same topic, same content, on the channel axis."
              : undefined
          }
        >
          <select
            value={channelKey}
            onChange={(e) => setChannelKey(e.target.value)}
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
          >
            <option value="">Channel…</option>
            {channels.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name || a.key}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field
        label="Topic"
        hint={
          draft.topic
            ? `Working title on the draft: “${draft.topic}”. Promoting never creates a topic — pick the real one, or create it under Topics first.`
            : "Promoting never creates a topic — pick an existing one, or create it under Topics first."
        }
      >
        <select
          value={topicKey}
          onChange={(e) => setTopicKey(e.target.value)}
          className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
        >
          <option value="">Topic…</option>
          {topics.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name || t.key}
            </option>
          ))}
        </select>
      </Field>

      {error ? (
        <p className="form-field__error mb-3 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="promote-tab__actions flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={archive}
          disabled={busy}
          className="toolbar-btn toolbar-btn--danger flex items-center gap-1.5 rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          <Archive className="size-3.5" />
          Archive
        </button>
        <button
          type="button"
          onClick={promote}
          disabled={busy || !ready}
          className="toolbar-btn toolbar-btn--primary flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowUpRight className="size-3.5" />
          )}
          Promote
        </button>
      </div>
    </div>
  );
}
