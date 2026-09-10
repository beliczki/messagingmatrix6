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
//
// WHERE only. What the card IS — its brief slide, its product, its TARGET, the
// note — is the Brief tab's half of the draft, and it is read first: Brief
// opens the draft, Promote closes it. The target moved there because it says
// what the work IS for, and the preview needs the answer long before anyone
// reaches this tab; here it is only read, and shown so the move leaves a trace
// for whoever reaches for the control they used yesterday.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2 } from "lucide-react";
import Field from "./EditorField";
import type { Audience, DraftMessage, Topic } from "./types";

const TARGET_LABELS: Record<Target, string> = {
  dco: "DCO",
  agentic: "Agentic",
  both: "Both",
};
type Target = "dco" | "agentic" | "both";

export default function PromoteTab({
  draft,
  audiences,
  topics,
  onDone,
}: {
  draft: DraftMessage;
  audiences: Audience[];
  topics: Topic[];
  onDone: () => void;
}) {
  // Read, never owned. NULL means nobody has decided yet, and the honest
  // stand-in is what the library already knows: a draft that has matched files
  // is being made as Agentic whether or not anyone ticked the box.
  const target: Target =
    draft.draftTarget === "agentic" ||
    draft.draftTarget === "both" ||
    draft.draftTarget === "dco"
      ? draft.draftTarget
      : "dco";
  const targetIsSet = draft.draftTarget !== null;
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

  return (
    <div className="message-editor-tab message-editor-tab--promote">
      <MatchedCreatives number={draft.number} variant={draft.variant} />

      <Field label="Target">
        <p className="promote-tab__target text-xs text-slate-600">
          <span className="font-medium text-slate-900">
            {TARGET_LABELS[target]}
          </span>
          {targetIsSet
            ? " — set on the Brief tab"
            : " — not set on the Brief tab yet, so the DCO cell is assumed"}
        </p>
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

      {/* Promote only. Archiving and deleting a draft moved out to the card's
          own actions menu on the drafts wall (user, 2026-09-10): they are
          decisions about the card as a whole, and having them here meant
          opening the draft and reading past the promote controls to reach
          them. This tab answers one question. */}
      <div className="promote-tab__actions flex items-center justify-end gap-2">
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

/**
 * What the Creative Library already holds for this MC.
 *
 * The draft stays OPEN when its files arrive — nothing here promotes or
 * archives anything. A correctly named upload mints the Agentic cell on its own
 * (createCreativeWithMirror); making the draft react to that too would have one
 * upload change two things. This is the index, and the Promote button is still
 * the only thing that places the card.
 *
 * Same query key as the preview pane's size switcher, so an open editor asking
 * both questions makes one request. That means the WHOLE envelope has to be
 * cached here too: unwrapping to `.match` would hand the other consumer an
 * object with no `sizes`.
 */
function MatchedCreatives({
  number,
  variant,
}: {
  number: number;
  variant: string;
}) {
  const q = useQuery({
    queryKey: ["creatives", "by-mc", number, variant],
    queryFn: async () => {
      const r = await fetch(
        `/api/creatives/by-mc?number=${number}&variant=${encodeURIComponent(variant)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<{
        sizes: { dimensions: string; fileName: string; type: string | null }[];
        match: {
          total: number;
          videoCount: number;
          items: {
            id: number;
            fileId: string | null;
            fileName: string | null;
            dimensions: string | null;
            isVideo: boolean;
          }[];
        };
      }>;
    },
  });

  const match = q.data?.match;
  const label = match
    ? `${match.total} matched${match.videoCount > 0 ? ` · ${match.videoCount} video${match.videoCount > 1 ? "s" : ""}` : ""}`
    : "—";

  return (
    <Field
      label="Creative library matched"
      hint={`Files whose name carries MC${number}${variant}. They arrive by upload, not from here — the draft stays open either way.`}
    >
      <div className="promote-tab__matched">
        <p className="promote-tab__matched-count mb-2 text-xs tabular-nums text-slate-600">
          {label}
        </p>
        {match && match.total > 0 ? (
          <div className="promote-tab__matched-strip flex gap-1.5 overflow-x-auto pb-1">
            {match.items.map((it) => (
              <div
                key={it.id}
                title={`${it.fileName ?? ""}${it.dimensions ? ` · ${it.dimensions}` : ""}`}
                className="promote-tab__matched-thumb size-16 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-50"
              >
                {it.fileId === null ? null : it.isVideo ? (
                  <video
                    src={`/api/files/${it.fileId}#t=0.1`}
                    preload="metadata"
                    muted
                    playsInline
                    className="size-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/files/${it.fileId}/thumbnail?w=96`}
                    alt={it.fileName ?? ""}
                    className="size-full object-cover"
                  />
                )}
              </div>
            ))}
          </div>
        ) : q.isLoading ? null : (
          <p className="empty-state text-xs text-slate-500">
            Nothing in the library carries MC{number}
            {variant} yet — upload the finished files with the MC number in the
            filename and they appear here.
          </p>
        )}
      </div>
    </Field>
  );
}
