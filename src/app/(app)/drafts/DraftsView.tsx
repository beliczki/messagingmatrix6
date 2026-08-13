"use client";

// Thin v1 list for agent-staged draft test-creatives (MCP
// generate_test_creative). Tiles show the rendered PNGs; the dialog offers
// Delete (hard, with previews) and Promote (into a matrix cell). Content
// editing stays agent-side — regenerate instead of edit.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Loader2, Trash2, ArrowUpRight } from "lucide-react";
import clsx from "clsx";
import { Masonry } from "../_components/Masonry";
import AppDialog from "../_components/AppDialog";
import { useAlertDialog } from "../_components/AlertDialog";

type Draft = {
  id: number;
  name: string | null;
  template: string;
  templateVariantClasses: string | null;
  headline: string | null;
  copy1: string | null;
  copy2: string | null;
  disclaimer: string | null;
  cta: string | null;
  flash: string | null;
  image1: string | null;
  image5: string | null;
  image6: string | null;
  sizes: string;
  renderStatus: string;
  renderError: string | null;
  promotedMessageId: number | null;
  version: number;
  createdAt: string;
};

type DraftPreview = {
  id: number;
  draftId: number;
  size: string;
  updatedAt: string;
};

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function previewSrc(p: DraftPreview): string {
  return `/api/draft-previews/${p.id}?v=${encodeURIComponent(p.updatedAt)}`;
}

function parseSizes(d: Draft): string[] {
  return JSON.parse(d.sizes) as string[];
}

export default function DraftsView() {
  const [showPromoted, setShowPromoted] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const qc = useQueryClient();

  const draftsQ = useQuery({
    queryKey: ["drafts", { showPromoted }],
    queryFn: () =>
      fetchJSON<{ drafts: Draft[]; previews: DraftPreview[] }>(
        showPromoted ? "/api/drafts?includePromoted=1" : "/api/drafts",
      ),
    // Renders land async server-side — keep polling while any draft is open.
    refetchInterval: (q) =>
      q.state.data?.drafts.some(
        (d) => d.renderStatus === "pending" || d.renderStatus === "rendering",
      )
        ? 2500
        : false,
  });

  const drafts = draftsQ.data?.drafts ?? [];
  const previews = draftsQ.data?.previews ?? [];
  const previewsByDraft = useMemo(() => {
    const m = new Map<number, DraftPreview[]>();
    for (const p of previews) {
      const list = m.get(p.draftId) ?? [];
      list.push(p);
      m.set(p.draftId, list);
    }
    return m;
  }, [previews]);

  const detail = drafts.find((d) => d.id === detailId) ?? null;

  return (
    <div className="drafts-view flex h-full flex-col overflow-hidden">
      <div className="toolbar drafts-view__toolbar sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="toolbar__title text-sm font-semibold text-slate-900">
          Drafts
        </div>
        <label className="drafts-view__promoted-toggle flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showPromoted}
            onChange={(e) => setShowPromoted(e.target.checked)}
          />
          Show promoted
        </label>
        <div className="toolbar__count ml-auto text-[11px] text-slate-500">
          {drafts.length} draft{drafts.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="drafts-view__scroll flex-1 overflow-auto p-4">
        {draftsQ.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading…
          </div>
        ) : drafts.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="empty-state drafts-view__empty max-w-md rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <FlaskConical className="empty-state__icon mx-auto mb-2 size-8 text-slate-400" />
              <h2 className="empty-state__title text-sm font-semibold text-slate-900">
                No drafts yet
              </h2>
              <p className="empty-state__hint mt-1 text-xs text-slate-500">
                Drafts are test creatives staged by an agent via the MCP
                generate_test_creative tool — they render here without touching
                the matrix.
              </p>
            </div>
          </div>
        ) : (
          <Masonry
            items={drafts}
            itemKey={(d) => d.id}
            render={(d) => (
              <DraftTile
                draft={d}
                previews={previewsByDraft.get(d.id) ?? []}
                onOpen={() => setDetailId(d.id)}
              />
            )}
          />
        )}
      </div>

      {detail ? (
        <DraftDetailDialog
          draft={detail}
          previews={previewsByDraft.get(detail.id) ?? []}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            qc.invalidateQueries({ queryKey: ["drafts"] });
          }}
        />
      ) : null}
    </div>
  );
}

function statusBadgeClass(status: string): string {
  return clsx(
    "status-badge drafts-tile__status rounded-full px-1.5 py-0.5 text-[10px] font-medium",
    status === "done" && "bg-emerald-100 text-emerald-700",
    status === "failed" && "bg-red-100 text-red-700",
    (status === "pending" || status === "rendering") &&
      "bg-amber-100 text-amber-700",
  );
}

function DraftTile({
  draft,
  previews,
  onOpen,
}: {
  draft: Draft;
  previews: DraftPreview[];
  onOpen: () => void;
}) {
  const first = previews[0];
  const total = parseSizes(draft).length;
  const rendering =
    draft.renderStatus === "pending" || draft.renderStatus === "rendering";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="drafts-tile group block w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-left shadow-sm transition hover:shadow-md"
    >
      <div className="drafts-tile__media relative flex min-h-24 items-center justify-center bg-slate-50">
        {first ? (
          <img
            src={previewSrc(first)}
            alt={draft.name ?? `Draft ${draft.id}`}
            className="drafts-tile__img block w-full"
            loading="lazy"
          />
        ) : (
          <div className="drafts-tile__placeholder flex items-center gap-2 p-6 text-xs text-slate-400">
            {rendering ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Rendering…
              </>
            ) : (
              "No preview"
            )}
          </div>
        )}
        <span className={clsx(statusBadgeClass(draft.renderStatus), "absolute left-1.5 top-1.5")}>
          {rendering ? `${previews.length}/${total}` : draft.renderStatus}
        </span>
        {draft.promotedMessageId != null ? (
          <span className="status-badge drafts-tile__promoted absolute right-1.5 top-1.5 rounded-full bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
            promoted
          </span>
        ) : null}
      </div>
      <div className="drafts-tile__meta px-2.5 py-2">
        <p className="drafts-tile__name truncate text-xs font-medium text-slate-800">
          {draft.name ?? draft.headline ?? `Draft ${draft.id}`}
        </p>
        <p className="drafts-tile__sub truncate text-[10px] text-slate-500">
          {draft.template} · {parseSizes(draft).join(", ")}
        </p>
      </div>
    </button>
  );
}

function DraftDetailDialog({
  draft,
  previews,
  onClose,
  onChanged,
}: {
  draft: Draft;
  previews: DraftPreview[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { confirm, alert } = useAlertDialog();
  const [busy, setBusy] = useState(false);

  const audiencesQ = useQuery({
    queryKey: ["audiences"],
    queryFn: () =>
      fetchJSON<{ audiences: { key: string; name: string }[] }>("/api/audiences"),
  });
  const topicsQ = useQuery({
    queryKey: ["topics"],
    queryFn: () =>
      fetchJSON<{ topics: { key: string; name: string }[] }>("/api/topics"),
  });
  const [audienceKey, setAudienceKey] = useState("");
  const [topicKey, setTopicKey] = useState("");

  async function remove() {
    const ok = await confirm({
      title: "Delete draft?",
      message:
        "The draft and its rendered previews are removed permanently — drafts have no archive.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/drafts/${draft.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: { "If-Match": String(draft.version) },
      });
      if (!r.ok) throw new Error(await r.text());
      onChanged();
      onClose();
    } catch (e) {
      await alert({
        title: "Delete failed",
        message: (e as Error).message,
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  async function promote() {
    setBusy(true);
    try {
      const r = await fetch(`/api/drafts/${draft.id}/promote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audienceKey, topicKey }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? `${r.status}`);
      onChanged();
      await alert({
        title: "Promoted to matrix",
        message: `MC${body.message.number}${body.message.variant} created at ${audienceKey} × ${topicKey}.`,
        variant: "success",
      });
      onClose();
    } catch (e) {
      await alert({
        title: "Promote failed",
        message: (e as Error).message,
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  const fields: Array<[string, string | null]> = [
    ["Headline", draft.headline],
    ["Copy 1", draft.copy1],
    ["Copy 2", draft.copy2],
    ["Disclaimer", draft.disclaimer],
    ["CTA", draft.cta],
    ["Sticker (flash)", draft.flash],
    ["Variant classes", draft.templateVariantClasses],
    ["Background", draft.image1],
    ["Brand image", draft.image5],
    ["Sticker image", draft.image6],
  ];
  const renderErrors: Record<string, string> = draft.renderError
    ? JSON.parse(draft.renderError)
    : {};

  return (
    <AppDialog open onClose={onClose} ariaLabel="Draft detail">
      <div className="draft-detail flex h-full flex-col overflow-hidden">
        <div className="draft-detail__header flex items-center gap-3 border-b border-slate-200 px-5 py-3 pr-14">
          <h2 className="text-sm font-semibold text-slate-900">
            {draft.name ?? `Draft ${draft.id}`}
          </h2>
          <span className={statusBadgeClass(draft.renderStatus)}>
            {draft.renderStatus}
          </span>
          <span className="text-[11px] text-slate-500">
            {draft.template} · {parseSizes(draft).join(", ")}
          </span>
        </div>

        <div className="draft-detail__body flex flex-1 gap-5 overflow-hidden p-5">
          <div className="draft-detail__previews flex-1 overflow-auto">
            {previews.length === 0 ? (
              <div className="empty-state flex h-full items-center justify-center text-xs text-slate-500">
                No previews rendered yet.
              </div>
            ) : (
              <div className="flex flex-wrap items-start gap-4">
                {previews.map((p) => (
                  <figure key={p.id} className="draft-detail__figure m-0">
                    <figcaption className="mb-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      {p.size}
                    </figcaption>
                    <img
                      src={previewSrc(p)}
                      alt={`${draft.name ?? "draft"} ${p.size}`}
                      className="draft-detail__img block max-w-full rounded-md border border-slate-200"
                    />
                  </figure>
                ))}
              </div>
            )}
            {Object.keys(renderErrors).length > 0 ? (
              <div className="draft-detail__errors mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {Object.entries(renderErrors).map(([size, err]) => (
                  <p key={size}>
                    <span className="font-semibold">{size}:</span> {err}
                  </p>
                ))}
              </div>
            ) : null}
          </div>

          <div className="draft-detail__side w-72 shrink-0 overflow-auto border-l border-slate-100 pl-5">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Content
            </h3>
            <dl className="draft-detail__fields space-y-1.5">
              {fields
                .filter(([, v]) => v)
                .map(([label, value]) => (
                  <div key={label} className="form-field">
                    <dt className="text-[10px] uppercase tracking-wider text-slate-400">
                      {label}
                    </dt>
                    <dd className="text-xs text-slate-800">{value}</dd>
                  </div>
                ))}
            </dl>

            {draft.promotedMessageId == null ? (
              <div className="draft-detail__promote mt-5 border-t border-slate-100 pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Promote to matrix
                </h3>
                <div className="form-field mb-2">
                  <label className="mb-0.5 block text-[10px] uppercase tracking-wider text-slate-400">
                    Audience
                  </label>
                  <select
                    value={audienceKey}
                    onChange={(e) => setAudienceKey(e.target.value)}
                    className="input-box__field w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
                  >
                    <option value="">Select…</option>
                    {(audiencesQ.data?.audiences ?? []).map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.name} ({a.key})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field mb-3">
                  <label className="mb-0.5 block text-[10px] uppercase tracking-wider text-slate-400">
                    Topic
                  </label>
                  <select
                    value={topicKey}
                    onChange={(e) => setTopicKey(e.target.value)}
                    className="input-box__field w-full rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none"
                  >
                    <option value="">Select…</option>
                    {(topicsQ.data?.topics ?? []).map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name} ({t.key})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={busy || !audienceKey || !topicKey}
                  onClick={promote}
                  className="toolbar-btn--primary inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <ArrowUpRight className="size-3.5" />
                  Promote
                </button>
              </div>
            ) : (
              <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">
                Promoted — message #{draft.promotedMessageId}.
              </p>
            )}

            <div className="mt-5 border-t border-slate-100 pt-4">
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="toolbar-btn--danger inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                Delete draft
              </button>
            </div>
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
