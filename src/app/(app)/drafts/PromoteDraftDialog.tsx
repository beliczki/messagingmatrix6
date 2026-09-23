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
import { MATRIX_STATUSES, PROMOTED_STATUS } from "@/lib/mc-status";
import type { Audience, Topic } from "../matrix/types";
import type { Draft } from "./types";
import type { McCreativeMatch } from "@/lib/entities/creatives";
import {
  agenticTopicFromFilename,
  channelCodeForSize,
  splitAgenticTopic,
} from "@/lib/agentic-topic";

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

/**
 * Which channel an Agentic card opens on: the one its files actually imply.
 * An MC's sizes scatter across Display and Social, and the upload path already
 * decided that per file — so the dialog opens on the channel of the majority
 * rather than on whatever channel happens to be first in the list.
 */
function defaultChannelKey(
  channels: Audience[],
  files: { dimensions: string | null }[],
): string {
  if (channels.length === 0) return "";
  const votes = new Map<string, number>();
  for (const f of files) {
    const code = channelCodeForSize(f.dimensions);
    votes.set(code, (votes.get(code) ?? 0) + 1);
  }
  const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const byCode = winner
    ? channels.find((c) => (c.channel ?? "").toUpperCase() === winner)
    : undefined;
  return (byCode ?? channels[0]!).key;
}

export default function PromoteDraftDialog({
  rows,
  audiences,
  topics,
  matches,
  onClose,
  onDone,
}: {
  /** Every live draft row on this MC number, ordered by letter. */
  rows: Draft[];
  audiences: Audience[];
  topics: Topic[];
  /** What the Creative Library holds for these MCs, keyed `number|variant`. */
  matches: Record<string, McCreativeMatch>;
  onClose: () => void;
  onDone: () => void;
}) {
  const number = rows[0]!.number;
  const product = rows.find((r) => r.draftProduct)?.draftProduct ?? null;

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(rows.map((r) => r.id)),
  );
  // The delivered files behind this card, and therefore which world it is in.
  // Same fallback the wall uses: a draft with matched files is Agentic whether
  // or not anyone ticked the box.
  const files = useMemo(
    () => rows.flatMap((r) => matches[`${r.number}|${r.variant}`]?.items ?? []),
    [rows, matches],
  );
  const target =
    rows.find((r) => r.draftTarget)?.draftTarget ??
    (files.length > 0 ? "agentic" : "dco");
  const isAgentic = target === "agentic";

  const dcoAudiences = useMemo(
    () => audiences.filter((a) => a.channel == null),
    [audiences],
  );
  const channelAudiences = useMemo(
    () => audiences.filter((a) => a.channel != null),
    [audiences],
  );

  const [audienceKey, setAudienceKey] = useState(() =>
    isAgentic
      ? defaultChannelKey(channelAudiences, files)
      : defaultAudienceKey(audiences, product),
  );
  const [status, setStatus] = useState<string>(PROMOTED_STATUS);
  // The planned topic is a working TITLE and usually names nothing real, but
  // when it happens to match a topic key exactly the user already answered this
  // question on the Brief tab.
  // What this card's topic can honestly be. On the Agentic axis the topic is a
  // STRING, not a row — `ensureAgenticMc` writes one derived from the delivered
  // filename and the grid builds its rows from those — so the two answers worth
  // offering are the brief's planned topic and the one the files themselves
  // name. Offered in that order: the brief is a decision, the filename a
  // derivation.
  const suggestions = useMemo(() => {
    if (!isAgentic) return [] as { key: string; label: string }[];
    const out: { key: string; label: string }[] = [];
    // The brief's topic is typed by a person and follows no prefix convention,
    // so it is shown verbatim: splitting it on its first underscore would hand
    // somebody their own words back with the first one cut off.
    const planned = rows.find((r) => r.topic)?.topic?.trim();
    if (planned) out.push({ key: planned, label: `${planned} · from the brief` });
    // The derived one DOES follow it — this dialog knows the product, because
    // the same value built the string — so the label drops that prefix and
    // shows it as a tag, the way the grid's row labels always have. The VALUE
    // keeps the whole key: it is what splits two products that briefed the same
    // topic into two rows, and the only product the PMMID ever carries.
    for (const f of files) {
      const derived = agenticTopicFromFilename(f.fileName, product);
      if (derived && !out.some((o) => o.key === derived)) {
        const { product: p, name } = splitAgenticTopic(derived);
        const shown = p && p === product ? name : derived;
        out.push({
          key: derived,
          label: [shown, p === product ? p : null, "from the filenames"]
            .filter(Boolean)
            .join(" · "),
        });
      }
    }
    return out;
  }, [isAgentic, rows, files, product]);

  const [topicKey, setTopicKey] = useState(() => {
    const planned = rows.find((r) => r.topic)?.topic ?? null;
    if (planned && topics.some((t) => t.key === planned)) return planned;
    // Agentic: the string is the topic, so a suggestion can be the answer.
    const agentic =
      rows.find((r) => r.draftTarget)?.draftTarget === "agentic" ||
      (!rows.some((r) => r.draftTarget) &&
        rows.some((r) => (matches[`${r.number}|${r.variant}`]?.total ?? 0) > 0));
    if (agentic && planned?.trim()) return planned.trim();
    return "";
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              {/* An Agentic card is never offered a DCO audience: its files
                  scatter across the channels BY SIZE, so a DCO cell is not a
                  slower answer, it is the wrong axis. */}
              {isAgentic ? null : (
                <optgroup label="DCO">
                  {dcoAudiences.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.name || a.key}
                    </option>
                  ))}
                </optgroup>
              )}
              {channelAudiences.length > 0 ? (
                <optgroup label={isAgentic ? "Channels" : "Agentic"}>
                  {channelAudiences.map((a) => (
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
              {suggestions.length > 0 ? (
                <optgroup label="From this card">
                  {suggestions.map((sug) => (
                    <option key={sug.key} value={sug.key}>
                      {sug.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label={suggestions.length > 0 ? "Topics" : ""}>
                {topics.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name || t.key}
                  </option>
                ))}
              </optgroup>
            </select>
            {isAgentic ? (
              <p className="form-field__hint mt-1 text-[11px] text-slate-500">
                The Agentic axis has no topics dimension — its rows are the
                strings themselves, so a suggestion here is the answer, not a
                placeholder.
              </p>
            ) : null}
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
