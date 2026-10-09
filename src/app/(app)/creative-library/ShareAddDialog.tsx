"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/app/_icons/Icon";
import ModalBackdrop from "../_components/ModalBackdrop";

type Props = {
  open: boolean;
  /** (messageId, size) pairs resolved from selected matrix-kind tiles. */
  matrix: Array<{ messageId: number; size: string }>;
  /** Creative ids resolved from selected uploaded items. */
  creativeIds: number[];
  onClose: () => void;
  /** Called after a successful add so caller can clear selection. */
  onAdded?: () => void;
};

type PickerShare = {
  id: string;
  title: string | null;
  createdAt: string;
  createdByEmail: string | null;
  messageCount: number;
  thumbs: Array<string | null>;
};

type AddResponse = {
  share: { id: string; title: string | null };
  added: number;
  skipped: number;
};

export default function ShareAddDialog({
  open,
  matrix,
  creativeIds,
  onClose,
  onAdded,
}: Props) {
  const qc = useQueryClient();
  const totalCount = matrix.length + creativeIds.length;
  const [search, setSearch] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AddResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Own key: the Shares table reads ["share-galleries", { showArchived }]
  // without thumbs, and one key must never carry two shapes.
  const sharesQ = useQuery({
    queryKey: ["share-galleries", "picker"],
    enabled: open,
    queryFn: async (): Promise<PickerShare[]> => {
      const r = await fetch("/api/share-galleries?thumbs=1", {
        credentials: "include",
      });
      if (!r.ok) throw new Error(`Shares fetch failed (${r.status})`);
      const data = (await r.json()) as { shares: PickerShare[] };
      return data.shares;
    },
  });

  useEffect(() => {
    if (!open) {
      setSearch("");
      setPickedId(null);
      setSubmitting(false);
      setError(null);
      setResult(null);
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const shares = useMemo(() => {
    const all = sharesQ.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) => (s.title ?? s.id).toLowerCase().includes(q));
  }, [sharesQ.data, search]);

  if (!open) return null;

  const picked = (sharesQ.data ?? []).find((s) => s.id === pickedId) ?? null;

  async function onSubmit() {
    if (!picked || totalCount === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/share-galleries/${picked.id}/items`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrix, creativeIds }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Add failed (${r.status})`);
      }
      const data = (await r.json()) as AddResponse;
      setResult(data);
      qc.invalidateQueries({ queryKey: ["share-galleries"] });
      onAdded?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const shareUrl = result
    ? `${window.location.origin}/share/${result.share.id}`
    : "";

  async function copyUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy to clipboard.");
    }
  }

  return (
    <ModalBackdrop
      onClose={onClose}
      className="z-50 items-center justify-center"
    >
      <div className="share-add-dialog modal m-auto flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="modal__header flex shrink-0 items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Icon name="copy-add" className="size-4 text-slate-700" />
          <h2 className="modal__title text-sm font-semibold text-slate-900">
            {result ? "Added to share" : "Add to an existing share"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="modal__close ml-auto rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            <Icon name="close" className="size-4" />
          </button>
        </header>

        {result ? (
          <div className="modal__body share-add-dialog__success flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <p className="text-sm text-slate-700">
              {result.added} {result.added === 1 ? "item" : "items"} added to{" "}
              <span className="font-medium">{result.share.title ?? result.share.id}</span>
              {result.skipped > 0 ? (
                <span className="text-slate-500">
                  {" "}
                  ({result.skipped} already in the share)
                </span>
              ) : null}
              .
            </p>
            <div className="share-add-dialog__url-row flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
              <input
                readOnly
                value={shareUrl}
                className="share-add-dialog__url min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-700 focus:outline-none"
              />
              <button
                type="button"
                onClick={copyUrl}
                className="toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                <Icon name="copy" className="size-3" />
                {copied ? "Copied" : "Copy"}
              </button>
              <a
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
                className="toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
              >
                <Icon name="external-link" className="size-3" />
                Open
              </a>
            </div>
          </div>
        ) : (
          <>
            <div className="share-add-dialog__toolbar shrink-0 space-y-2 border-b border-slate-100 px-5 py-3">
              <div className="share-add-dialog__count text-xs text-slate-500">
                {totalCount} {totalCount === 1 ? "item" : "items"} selected
                {matrix.length > 0 && creativeIds.length > 0 ? (
                  <span className="text-slate-400">
                    {" "}
                    ({matrix.length} matrix · {creativeIds.length} uploaded)
                  </span>
                ) : null}
              </div>
              <div className="input-box input-box--with-icon relative">
                <Icon name="filter" className="input-box__icon pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search shares by title"
                  autoFocus
                  className="input-box__field w-full rounded-md border border-slate-300 py-1.5 pl-7 pr-2 text-xs focus:border-slate-500 focus:outline-none"
                />
              </div>
            </div>

            <ul className="modal__body share-add-dialog__list flex-1 overflow-y-auto">
              {sharesQ.isLoading ? (
                <li className="empty-state flex items-center justify-center gap-2 px-5 py-8 text-xs text-slate-500">
                  <Icon name="spinner" className="size-3.5 animate-spin" />
                  Loading shares…
                </li>
              ) : sharesQ.isError ? (
                <li className="empty-state px-5 py-8 text-center text-xs text-rose-600">
                  {(sharesQ.error as Error).message}
                </li>
              ) : shares.length === 0 ? (
                <li className="empty-state px-5 py-8 text-center text-xs text-slate-500">
                  {search.trim() ? "No share matches this search." : "No shares yet."}
                </li>
              ) : (
                shares.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setPickedId(s.id)}
                      className={clsx(
                        "share-add-dialog__row flex w-full items-center gap-3 border-b border-slate-100 px-5 py-2 text-left hover:bg-slate-50",
                        pickedId === s.id && "share-add-dialog__row--picked bg-slate-100 ring-2 ring-inset ring-slate-900",
                      )}
                    >
                      <span className="share-add-dialog__thumbs flex shrink-0 gap-1">
                        {Array.from({ length: 4 }, (_, i) => {
                          const src = s.thumbs[i];
                          return src ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={i}
                              src={src}
                              alt=""
                              loading="lazy"
                              className="share-add-dialog__thumb size-12 rounded border border-slate-200 bg-slate-50 object-contain"
                            />
                          ) : (
                            <span
                              key={i}
                              className={clsx(
                                "share-add-dialog__thumb share-add-dialog__thumb--empty size-12 rounded border border-dashed border-slate-200",
                                i < s.thumbs.length && "bg-slate-100",
                              )}
                            />
                          );
                        })}
                      </span>
                      <span className="share-add-dialog__meta min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          {s.title ?? <span className="text-slate-400">Untitled</span>}
                        </span>
                        <span className="block truncate text-[10px] text-slate-500">
                          {s.messageCount} {s.messageCount === 1 ? "item" : "items"} ·{" "}
                          {new Date(s.createdAt.replace(" ", "T") + "Z").toLocaleDateString()}
                          {s.createdByEmail ? ` · ${s.createdByEmail}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>

            <footer className="modal__footer shrink-0 space-y-2 border-t border-slate-100 px-5 py-3">
              {error ? (
                <div className="share-add-dialog__error rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
                  {error}
                </div>
              ) : null}
              <button
                type="button"
                onClick={onSubmit}
                disabled={submitting || !picked || totalCount === 0}
                className="toolbar-btn--primary inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Icon name="spinner" className="size-3.5 animate-spin" /> : <Icon name="copy-add" className="size-3.5" />}
                {submitting
                  ? "Adding…"
                  : picked
                    ? `Add ${totalCount} to “${picked.title ?? picked.id}”`
                    : "Pick a share"}
              </button>
            </footer>
          </>
        )}

        {result ? (
          <footer className="modal__footer flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="toolbar-btn--primary rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
            >
              Done
            </button>
          </footer>
        ) : null}
      </div>
    </ModalBackdrop>
  );
}
