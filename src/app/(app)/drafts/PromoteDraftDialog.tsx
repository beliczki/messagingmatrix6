"use client";

// Where does this MC go? — asked once, for the whole card.
//
// The drafts wall is one card per MC number, so promoting is a decision about
// the card: which of its variants go now, into which cell, in what state, and
// what happens to the ones that stay. Doing that variant by variant meant
// opening each row and answering the same four questions again.
//
// Promotion CONVERTS: the rows that go stop being drafts and become the cards
// (user, 2026-09-10 — no copies, no duplicates). "Promote and archive" is
// therefore about the variants left behind, not about the ones just promoted.
//
// No <form>: the two buttons ARE the decision, and they differ in what they do
// to the leftovers. A form would need a hidden field or a submitter check to
// tell them apart, and Enter would pick one of them silently.
import { useMemo, useState } from "react";
import { Icon } from "@/app/_icons/Icon";
import clsx from "clsx";
import ModalBackdrop from "../_components/ModalBackdrop";
import { MATRIX_STATUSES, BIRTH_STATUS } from "@/lib/mc-status";
import type { Audience, Topic } from "../matrix/types";
import type { Draft } from "./types";

/**
 * The cell work arrives in. A draft that has not been placed yet belongs on the
 * product's incoming audience — that is what the axis is for — so the dialog
 * opens on it instead of on an empty select the user has to answer every time.
 */
function defaultAudienceKey(
  audiences: Audience[],
  product: string | null,
): string {
  const byProduct = product
    ? audiences.find(
        (a) => a.key.toUpperCase() === `${product.toUpperCase()}_INCOMING`,
      )
    : undefined;
  return (
    byProduct?.key ??
    audiences.find((a) => a.key.toUpperCase().endsWith("_INCOMING"))?.key ??
    ""
  );
}

export default function PromoteDraftDialog({
  rows,
  audiences,
  topics,
  onClose,
  onDone,
}: {
  /** Every live draft row on this MC number, ordered by letter. */
  rows: Draft[];
  audiences: Audience[];
  topics: Topic[];
  onClose: () => void;
  onDone: () => void;
}) {
  const number = rows[0]!.number;
  const product = rows.find((r) => r.draftProduct)?.draftProduct ?? null;

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(rows.map((r) => r.id)),
  );
  const [audienceKey, setAudienceKey] = useState(() =>
    defaultAudienceKey(audiences, product),
  );
  const [status, setStatus] = useState<string>(BIRTH_STATUS);
  // The planned topic is a working TITLE and usually names nothing real, but
  // when it happens to match a topic key exactly the user already answered this
  // question on the Brief tab.
  const [topicKey, setTopicKey] = useState(() => {
    const planned = rows.find((r) => r.topic)?.topic ?? null;
    return planned && topics.some((t) => t.key === planned) ? planned : "";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DCO audiences and channels in one list, split by a label: the axis is
  // simply whichever key is chosen — promoteDraft resolves both through the
  // same lookup, so an Agentic placement is an ordinary promote onto a channel.
  const dco = useMemo(() => audiences.filter((a) => a.channel == null), [audiences]);
  const channels = useMemo(
    () => audiences.filter((a) => a.channel != null),
    [audiences],
  );

  const staying = rows.filter((r) => !selected.has(r.id));
  const ready = selected.size > 0 && !!audienceKey && !!topicKey;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function promote(archiveRest: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/drafts/promote", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: rows.filter((x) => selected.has(x.id)).map((x) => x.id),
          audienceKey,
          topicKey,
          status,
          archiveRest,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error ?? `${r.status} ${r.statusText}`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalBackdrop onClose={onClose} className="z-50 items-stretch">
      <div className="promote-dialog modal m-auto flex max-h-[85vh] w-[90vw] max-w-md flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="promote-dialog__header modal__header flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Icon name="arrow-up-right" className="size-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-900">
            Promote MC{number}
          </span>
        </header>

        <div className="promote-dialog__body flex-1 overflow-auto px-4 py-3">
          <div className="promote-dialog__field mb-3">
            <div className="form-field__label mb-1 text-xs font-medium text-slate-700">
              Variants
            </div>
            <div className="promote-dialog__variants flex flex-col gap-1">
              {rows.map((r) => (
                <label
                  key={r.id}
                  className="promote-dialog__variant flex items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    className="size-3.5"
                  />
                  <span className="font-medium">
                    MC{r.number}
                    {r.variant}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-500">
                    {r.name || "Untitled"}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <label className="form-field promote-dialog__field mb-3 block">
            <div className="form-field__label mb-1 text-xs font-medium text-slate-700">
              Audience
            </div>
            <select
              value={audienceKey}
              onChange={(e) => setAudienceKey(e.target.value)}
              className="input-box custom-dropdown w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
            >
              <option value="">— pick a cell —</option>
              <optgroup label="DCO">
                {dco.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name || a.key}
                  </option>
                ))}
              </optgroup>
              {channels.length > 0 ? (
                <optgroup label="Agentic">
                  {channels.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.name || a.key}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>

          <label className="form-field promote-dialog__field mb-3 block">
            <div className="form-field__label mb-1 text-xs font-medium text-slate-700">
              Topic
            </div>
            <select
              value={topicKey}
              onChange={(e) => setTopicKey(e.target.value)}
              className="input-box custom-dropdown w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
            >
              <option value="">— pick a topic —</option>
              {topics.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name || t.key}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field promote-dialog__field mb-3 block">
            <div className="form-field__label mb-1 text-xs font-medium text-slate-700">
              Status
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="input-box custom-dropdown w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-slate-500 focus:outline-none"
            >
              {MATRIX_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>

          {error ? (
            <p className="form-field__error rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="promote-dialog__actions flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="toolbar-btn rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          {/* Only offered when something would actually be left behind — with
              every variant going, the two buttons would do the same thing and
              the second one would just look like a stronger version of it. */}
          {staying.length > 0 ? (
            <button
              type="button"
              onClick={() => promote(true)}
              disabled={busy || !ready}
              title={`Promote the selected variants and shelve the ${staying.length} that stay — MC${number} keeps its number either way`}
              className="toolbar-btn flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Icon name="archive" className="size-3.5" />
              Promote and archive {staying.length}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => promote(false)}
            disabled={busy || !ready}
            className={clsx(
              "toolbar-btn toolbar-btn--primary flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40",
            )}
          >
            {busy ? (
              <Icon name="spinner" className="size-3.5 animate-spin" />
            ) : (
              <Icon name="arrow-up-right" className="size-3.5" />
            )}
            Promote {selected.size}
          </button>
        </footer>
      </div>
    </ModalBackdrop>
  );
}
