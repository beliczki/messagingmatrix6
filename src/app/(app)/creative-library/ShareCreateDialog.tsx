"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Copy, ExternalLink, Loader2, Share2, X } from "lucide-react";

type Props = {
  open: boolean;
  /** (messageId, size) pairs resolved from selected matrix-kind tiles. */
  matrix: Array<{ messageId: number; size: string }>;
  /** Creative ids resolved from selected uploaded items. */
  creativeIds: number[];
  onClose: () => void;
  /** Called after a successful create so caller can clear selection. */
  onCreated?: () => void;
};

type CreateResponse = {
  share: { id: string; title: string | null; createdAt: string };
};

export default function ShareCreateDialog({
  open,
  matrix,
  creativeIds,
  onClose,
  onCreated,
}: Props) {
  const totalCount = matrix.length + creativeIds.length;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResponse["share"] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setSubmitting(false);
      setError(null);
      setCreated(null);
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

  if (!open) return null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (totalCount === 0) {
      setError("No items selected.");
      return;
    }
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/share-galleries", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matrix,
          creativeIds,
          title: title.trim(),
          description: description.trim() || null,
        }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Create failed (${r.status})`);
      }
      const data = (await r.json()) as CreateResponse;
      setCreated(data.share);
      onCreated?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const shareUrl = created
    ? `${window.location.origin}/share/${created.id}`
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
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="share-create-dialog modal m-auto flex w-full max-w-md flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__header flex shrink-0 items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Share2 className="size-4 text-slate-700" />
          <h2 className="modal__title text-sm font-semibold text-slate-900">
            {created ? "Share created" : "Share selected creatives"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="modal__close ml-auto rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="modal__body flex-1 overflow-y-auto px-5 py-4">
          {created ? (
            <div className="share-create-dialog__success space-y-3">
              <p className="text-sm text-slate-700">
                Your gallery is ready. Anyone with this link can view it.
              </p>
              <div className="share-create-dialog__url-row flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                <input
                  readOnly
                  value={shareUrl}
                  className="share-create-dialog__url min-w-0 flex-1 bg-transparent font-mono text-xs text-slate-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={copyUrl}
                  className="toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <Copy className="size-3" />
                  {copied ? "Copied" : "Copy"}
                </button>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="toolbar-btn inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  <ExternalLink className="size-3" />
                  Open
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="share-create-dialog__form space-y-3">
              <div className="share-create-dialog__count text-xs text-slate-500">
                {totalCount} {totalCount === 1 ? "item" : "items"} selected
                {matrix.length > 0 && creativeIds.length > 0 ? (
                  <span className="text-slate-400">
                    {" "}
                    ({matrix.length} matrix · {creativeIds.length} uploaded)
                  </span>
                ) : null}
              </div>
              <label className="form-field block">
                <div className="form-field__label mb-1 text-xs font-medium text-slate-700">
                  Title
                </div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                  className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                />
              </label>
              <label className="form-field block">
                <div className="form-field__label mb-1 text-xs font-medium text-slate-700">
                  Description <span className="text-slate-400">(optional)</span>
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
                />
              </label>
              {error ? (
                <div className="share-create-dialog__error rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={submitting || totalCount === 0}
                className="toolbar-btn--primary inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
                {submitting ? "Creating…" : "Create share"}
              </button>
            </form>
          )}
        </div>

        {created ? (
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
    </div>
  );
}
