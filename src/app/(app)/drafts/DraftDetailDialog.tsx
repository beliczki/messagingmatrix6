"use client";

// One draft: its content, the brief it came in on, and the promote form that
// turns it into a matrix card. Editing goes through /api/messages/[id] like any
// other message — a draft is one — while promotion has its own endpoint because
// it has to land the audience, the topic and the status in a single write.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, Archive } from "lucide-react";
import AppDialog from "../_components/AppDialog";
import { mcLabel } from "./DraftsView";
import type { Draft, DraftPreview, BriefRow } from "./types";

type Dimension = { key: string; name: string | null; product: string | null };

const TEXT_FIELDS = [
  ["name", "Name"],
  ["headline", "Headline"],
  ["copy1", "Copy 1"],
  ["copy2", "Copy 2"],
  ["cta", "CTA"],
  ["disclaimer", "Disclaimer"],
] as const;

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

async function send<T>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
  version?: number,
): Promise<T> {
  const r = await fetch(url, {
    method,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(version !== undefined ? { "if-match": String(version) } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error ?? `${r.status} ${r.statusText}`);
  return json as T;
}

export default function DraftDetailDialog({
  draft,
  previews,
  briefs,
  onClose,
  onChanged,
}: {
  draft: Draft;
  previews: DraftPreview[];
  briefs: BriefRow[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>(() =>
    Object.fromEntries([
      ...TEXT_FIELDS.map(([k]) => [k, (draft[k] as string | null) ?? ""]),
      ["topic", draft.topic ?? ""],
    ]),
  );
  const [briefId, setBriefId] = useState<string>(
    draft.briefId != null ? String(draft.briefId) : "",
  );
  const [audienceKey, setAudienceKey] = useState("");
  const [topicKey, setTopicKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const audiencesQ = useQuery({
    queryKey: ["audiences", "for-promote"],
    queryFn: () =>
      fetchJSON<{ audiences: Dimension[] }>("/api/audiences").then(
        (d) => d.audiences,
      ),
  });
  const topicsQ = useQuery({
    queryKey: ["topics", "for-promote"],
    queryFn: () =>
      fetchJSON<{ topics: Dimension[] }>("/api/topics").then((d) => d.topics),
  });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      await send(
        `/api/messages/${draft.id}`,
        "PATCH",
        {
          ...Object.fromEntries(
            TEXT_FIELDS.map(([k]) => [k, fields[k] || null]),
          ),
          topic: fields.topic || null,
          briefId: briefId ? Number(briefId) : null,
        },
        draft.version,
      );
    });

  const promote = () =>
    run(async () => {
      await send(`/api/drafts/${draft.id}/promote`, "POST", {
        audienceKey,
        topicKey,
        version: draft.version,
      });
      onClose();
    });

  const archive = () =>
    run(async () => {
      const r = await fetch(`/api/messages/${draft.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "if-match": String(draft.version) },
      });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      onClose();
    });

  return (
    <AppDialog open onClose={onClose} ariaLabel={mcLabel(draft)}>
      <div className="modal__header flex flex-wrap items-baseline gap-2 border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900">
          {mcLabel(draft)}
        </h2>
        <span className="status-badge rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
          DRAFT
        </span>
        <p className="text-[11px] text-slate-500">
          The number is already reserved — nothing else can take it.
        </p>
      </div>

      <div className="modal__body flex flex-1 gap-5 overflow-hidden px-5 py-4">
        <div className="draft-detail__previews w-1/2 overflow-y-auto">
          {previews.length === 0 ? (
            <div className="empty-state rounded-lg border border-dashed border-slate-300 p-8 text-center text-xs text-slate-400">
              No previews yet. Give the draft some content, then generate them
              from the matrix editor.
            </div>
          ) : (
            <div className="draft-detail__preview-grid flex flex-col gap-3">
              {previews.map((p) => (
                <figure key={p.id} className="draft-detail__preview">
                  <img
                    src={`/api/previews/${p.id}?v=${encodeURIComponent(p.updatedAt)}`}
                    alt={p.size}
                    className="block w-full rounded border border-slate-200"
                  />
                  <figcaption className="mt-0.5 text-[10px] text-slate-400">
                    {p.size}
                    {p.messageVersion !== draft.version ? " · stale" : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="draft-detail__form w-1/2 overflow-y-auto">
          {TEXT_FIELDS.map(([key, label]) => (
            <div className="form-field mb-2.5" key={key}>
              <label className="form-field__label mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {label}
              </label>
              <input
                value={fields[key] ?? ""}
                onChange={(e) =>
                  setFields((f) => ({ ...f, [key]: e.target.value }))
                }
                className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              />
            </div>
          ))}

          <div className="form-field mb-2.5">
            <label className="form-field__label mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Working topic name
            </label>
            <input
              value={fields.topic ?? ""}
              onChange={(e) =>
                setFields((f) => ({ ...f, topic: e.target.value }))
              }
              placeholder="Free text — promotion resolves it to a real topic"
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
            />
          </div>

          <div className="form-field mb-4">
            <label className="form-field__label mb-1 block text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Brief
            </label>
            <select
              value={briefId}
              onChange={(e) => setBriefId(e.target.value)}
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
            >
              <option value="">— none —</option>
              {briefs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label || `Brief ${b.id}`}
                </option>
              ))}
            </select>
          </div>

          <div className="draft-detail__promote rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-slate-500">
              Promote into the matrix
            </h3>
            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
              Keeps {mcLabel(draft)} and gives it a cell. The topic must already
              exist — promoting never creates one.
            </p>
            <select
              value={audienceKey}
              onChange={(e) => setAudienceKey(e.target.value)}
              className="input-box mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
            >
              <option value="">Audience…</option>
              {(audiencesQ.data ?? []).map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name || a.key}
                </option>
              ))}
            </select>
            <select
              value={topicKey}
              onChange={(e) => setTopicKey(e.target.value)}
              className="input-box mb-2 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
            >
              <option value="">Topic…</option>
              {(topicsQ.data ?? []).map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name || t.key}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={promote}
              disabled={busy || !audienceKey || !topicKey}
              className="toolbar-btn toolbar-btn--primary flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="size-3.5" />
              )}
              Promote
            </button>
          </div>

          {error ? (
            <p className="form-field__error mt-3 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="modal__footer flex justify-between gap-2 border-t border-slate-200 px-5 py-3">
        <button
          type="button"
          onClick={archive}
          disabled={busy}
          className="toolbar-btn toolbar-btn--danger flex items-center gap-1.5 rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          <Archive className="size-3.5" />
          Archive
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="toolbar-btn rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="toolbar-btn toolbar-btn--primary rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    </AppDialog>
  );
}
