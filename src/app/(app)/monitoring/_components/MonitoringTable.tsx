"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Code2, Loader2, X } from "lucide-react";
import clsx from "clsx";
import {
  MatrixIframePreview,
  templateMetaFor,
} from "../../_components/MatrixIframeTile";
import { type MatrixNavItem } from "../../creative-library/MatrixDetailDialog";
import MonitoringDetailDialog from "./MonitoringDetailDialog";
import MultiPill from "../../_components/MultiPill";
import type { Message, Audience } from "../../matrix/types";

type TemplateInfo = {
  name: string;
  sizes: string[];
  defaultSize: string | null;
  kind?: "html" | "adobe" | "figma" | "after_effects";
  previewFile?: string | null;
  externalUrl?: string | null;
};

type Period = { periodFrom: string; periodTo: string; rows: number };

type Row = {
  id: number;
  platform: string;
  product: string | null;
  size: string;
  pmmid: string | null;
  messageId: number | null;
  matchLevel: "exact" | "family" | "family_known" | null;
  audienceKey: string;
  topicKey: string;
  mcNumber: number;
  mcVariant: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number | null;
  messageName: string | null;
  messageStatus: string | null;
};

type Payload = {
  periods: Period[];
  selected: { periodFrom: string; periodTo: string } | null;
  rows: Row[];
};

type MatchFilter = "all" | "matched" | "unmatched";
type SortKey =
  | "platform"
  | "product"
  | "mc"
  | "audience"
  | "topic"
  | "message"
  | "impressions"
  | "clicks"
  | "ctr"
  | "cost"
  | "conversions";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const fmt = (n: number) => n.toLocaleString();
const pct = (ctr: number | null) =>
  ctr === null ? "—" : `${(ctr * 100).toFixed(2)}%`;
const day = (s: string) => s.slice(0, 10);

const COLS: ReadonlyArray<{
  key: SortKey;
  label: string;
  align?: "right";
  num?: boolean;
}> = [
  { key: "platform", label: "Platform" },
  { key: "product", label: "Product" },
  { key: "mc", label: "MC" },
  { key: "audience", label: "Audience" },
  { key: "topic", label: "Topic" },
  { key: "message", label: "Message" },
  { key: "impressions", label: "Impr.", align: "right", num: true },
  { key: "clicks", label: "Clicks", align: "right", num: true },
  { key: "ctr", label: "CTR", align: "right", num: true },
  { key: "cost", label: "Cost", align: "right", num: true },
  { key: "conversions", label: "Conv.", align: "right", num: true },
];

function compare(a: Row, b: Row, key: SortKey): number {
  switch (key) {
    case "platform":
      return a.platform.localeCompare(b.platform);
    case "product":
      return (a.product ?? "").localeCompare(b.product ?? "");
    case "mc":
      return a.mcNumber !== b.mcNumber
        ? a.mcNumber - b.mcNumber
        : a.mcVariant.localeCompare(b.mcVariant);
    case "audience":
      return a.audienceKey.localeCompare(b.audienceKey);
    case "topic":
      return a.topicKey.localeCompare(b.topicKey);
    case "message":
      return (a.messageName ?? "").localeCompare(b.messageName ?? "");
    case "ctr":
      return (a.ctr ?? 0) - (b.ctr ?? 0);
    default:
      return a[key] - b[key];
  }
}

export default function MonitoringTable({
  reloadToken,
}: {
  reloadToken: number;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromFilter, setFromFilter] = useState<string | null>(null);
  const [platforms, setPlatforms] = useState<Set<string>>(new Set());
  const [products, setProducts] = useState<Set<string>>(new Set());
  const [match, setMatch] = useState<MatchFilter>("matched");
  const [sort, setSort] = useState<Sort>({ key: "impressions", dir: "desc" });
  const [detailRowId, setDetailRowId] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const qs = fromFilter ? `?from=${encodeURIComponent(fromFilter)}` : "";
    fetch(`/api/monitoring${qs}`)
      .then((r) => r.json())
      .then((body: Payload) => {
        if (!live) return;
        setData(body);
        setError(null);
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [reloadToken, fromFilter]);

  // Preview pipeline (same sources as Creative Library): resolve each matched
  // message to its template's first size so we can live-render the MC.
  // These three keys are shared with the matrix and the Creative Library, and a
  // query key is a contract about the cached SHAPE, not just the URL. This file
  // used to unwrap the envelope while every other consumer kept it, so whichever
  // page loaded first decided what the other one found: arriving here from the
  // matrix handed `templates.map` an object. Keeping the envelope matches the
  // other four consumers.
  const messagesQ = useQuery({
    queryKey: ["messages"],
    queryFn: () =>
      fetch("/api/messages")
        .then((r) => r.json())
        .then((d: { messages: Message[] }) => d),
  });
  const templatesQ = useQuery({
    queryKey: ["templates", "folders"],
    queryFn: () =>
      fetch("/api/templates/folders")
        .then((r) => r.json())
        .then((d: { templates: TemplateInfo[] }) => d),
  });
  const audiencesQ = useQuery({
    queryKey: ["audiences"],
    queryFn: () =>
      fetch("/api/audiences")
        .then((r) => r.json())
        .then((d: { audiences: Audience[] }) => d),
  });

  const previewById = useMemo(() => {
    const messages = messagesQ.data?.messages ?? [];
    const templates = templatesQ.data?.templates ?? [];
    const audiences = audiencesQ.data?.audiences ?? [];
    if (messages.length === 0 || templates.length === 0) {
      return new Map<number, MatrixNavItem & { templateMeta?: ReturnType<typeof templateMetaFor> }>();
    }
    const tmap = new Map(templates.map((t) => [t.name, t]));
    const prod = new Map(audiences.map((a) => [a.key, a.product]));
    const out = new Map<
      number,
      MatrixNavItem & { templateMeta?: ReturnType<typeof templateMetaFor> }
    >();
    for (const m of messages) {
      if (!m.template) continue;
      const tinfo = tmap.get(m.template);
      if (!tinfo || tinfo.sizes.length === 0) continue;
      out.set(m.id, {
        id: m.id,
        message: m,
        liveSize: tinfo.sizes[0]!,
        liveTemplateName: m.template,
        product: prod.get(m.audience) ?? null,
        templateMeta: templateMetaFor(tinfo),
      });
    }
    return out;
  }, [messagesQ.data, templatesQ.data, audiencesQ.data]);

  const platformOptions = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.rows.map((r) => r.platform))].sort();
  }, [data]);

  const productOptions = useMemo(() => {
    if (!data) return [];
    return [
      ...new Set(
        data.rows.map((r) => r.product).filter((p): p is string => !!p),
      ),
    ].sort();
  }, [data]);

  // Collapse the size-grained rows back to one display row per
  // (platform, product, MC, audience, topic, message), summing metrics. The
  // per-size detail lives only in the dialog. The first fine row's id is kept
  // as the display id so a click can still resolve the row in data.rows.
  const displayRows = useMemo(() => {
    if (!data) return [];
    const byKey = new Map<string, Row>();
    for (const r of data.rows) {
      const k = `${r.platform}|${r.product}|${r.mcNumber}|${r.mcVariant}|${r.audienceKey}|${r.topicKey}|${r.messageId}`;
      const e = byKey.get(k);
      if (e) {
        e.impressions += r.impressions;
        e.clicks += r.clicks;
        e.cost += r.cost;
        e.conversions += r.conversions;
      } else {
        byKey.set(k, { ...r });
      }
    }
    return [...byKey.values()].map((r) => ({
      ...r,
      ctr: r.impressions > 0 ? r.clicks / r.impressions : null,
    }));
  }, [data]);

  const filtered = useMemo(() => {
    const rows = displayRows.filter((r) => {
      if (platforms.size > 0 && !platforms.has(r.platform)) return false;
      if (products.size > 0 && (!r.product || !products.has(r.product)))
        return false;
      if (match === "matched" && r.messageId === null) return false;
      if (match === "unmatched" && r.messageId !== null) return false;
      return true;
    });
    const sorted = rows.slice().sort((a, b) => {
      const cmp = compare(a, b, sort.key);
      if (cmp !== 0) return sort.dir === "asc" ? cmp : -cmp;
      return b.id - a.id;
    });
    return sorted;
  }, [displayRows, platforms, products, match, sort]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (a, r) => {
          a.impressions += r.impressions;
          a.clicks += r.clicks;
          return a;
        },
        { impressions: 0, clicks: 0 },
      ),
    [filtered],
  );

  const detailRow = useMemo(
    () => (data ? data.rows.find((r) => r.id === detailRowId) ?? null : null),
    [data, detailRowId],
  );

  const hasFilter =
    platforms.size > 0 || products.size > 0 || match !== "all";
  const totalRows = displayRows.length;

  function header(key: SortKey, label: string, align?: "right") {
    const active = sort.key === key;
    return (
      <button
        type="button"
        onClick={() =>
          setSort((s) =>
            s.key === key
              ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
              : {
                  key,
                  dir:
                    key === "impressions" ||
                    key === "clicks" ||
                    key === "ctr" ||
                    key === "cost" ||
                    key === "conversions"
                      ? "desc"
                      : "asc",
                },
          )
        }
        title={`Sort by ${label}`}
        className={clsx(
          "flex h-full w-full items-center gap-1 hover:text-slate-900",
          align === "right" ? "justify-end" : "justify-start",
          active && "text-slate-900",
        )}
      >
        <span className="truncate">{label}</span>
        {active ? (
          sort.dir === "asc" ? (
            <ArrowUp className="size-3 shrink-0" />
          ) : (
            <ArrowDown className="size-3 shrink-0" />
          )
        ) : null}
      </button>
    );
  }

  return (
    <div className="monitoring-table flex h-full flex-col overflow-hidden">
      {/* header toolbar: title + filters + count (mirrors creative-library) */}
      <div className="toolbar monitoring-table__toolbar sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="toolbar__title text-sm font-semibold text-slate-900">
          Monitoring
        </div>

        {data && data.periods.length > 0 ? (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Report period
            <select
              className="input-box rounded border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:border-slate-500 focus:outline-none"
              value={data.selected?.periodFrom ?? ""}
              onChange={(e) => setFromFilter(e.target.value)}
            >
              {data.periods.map((p) => (
                <option key={p.periodFrom} value={p.periodFrom}>
                  {day(p.periodFrom)} – {day(p.periodTo)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <MultiPill
          label="Product"
          values={products}
          options={productOptions}
          onChange={setProducts}
        />
        <MultiPill
          label="Platform"
          values={platforms}
          options={platformOptions}
          onChange={setPlatforms}
        />

        <div className="monitoring-table__match-filter inline-flex overflow-hidden rounded border border-slate-300 text-xs">
          {(
            [
              ["all", "All"],
              ["matched", "Matched"],
              ["unmatched", "Unmatched"],
            ] as [MatchFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMatch(key)}
              className={clsx(
                "px-2.5 py-1 font-medium transition",
                match === key
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {hasFilter ? (
          <button
            onClick={() => {
              setPlatforms(new Set());
              setProducts(new Set());
              setMatch("all");
            }}
            className="toolbar-btn flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
          >
            <X className="size-3" />
            Clear
          </button>
        ) : null}

        <div className="toolbar__count ml-auto text-[11px] text-slate-500">
          {fmt(filtered.length)}/{fmt(totalRows)} rows ·{" "}
          {totals.impressions > 0
            ? `${((totals.clicks / totals.impressions) * 100).toFixed(2)}% CTR`
            : "— CTR"}
        </div>
      </div>

      {/* scrollable body */}
      <div className="monitoring-table__body flex-1 overflow-auto">
        {loading && !data ? (
          <p className="px-4 py-4 text-sm text-slate-500">
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            Loading…
          </p>
        ) : error ? (
          <p className="error-alert m-4 rounded-md bg-rose-50 p-2 text-xs text-rose-700">
            {error}
          </p>
        ) : !data || data.periods.length === 0 ? (
          <div className="empty-state mx-auto mt-6 max-w-md rounded-lg border border-dashed border-slate-300 p-8 text-center">
            <p className="text-sm text-slate-500">
              No monitoring data imported yet. Upload an AdForm report from the
              toolbar on the right.
            </p>
          </div>
        ) : (
          <table className="monitoring-table__table w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-16" />
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-20" />
              <col />
              <col />
              <col />
              <col className="w-20" />
              <col className="w-20" />
              <col className="w-16" />
              <col className="w-20" />
              <col className="w-16" />
            </colgroup>
            <thead>
              <tr className="sticky top-0 z-[5] border-b border-slate-200 bg-slate-50 text-left text-[11px] font-medium uppercase tracking-wider text-slate-600">
                <th className="px-3 py-2" aria-label="Preview" />
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    className={clsx(
                      "h-8 px-3",
                      c.align === "right" && "text-right",
                    )}
                  >
                    {header(c.key, c.label, c.align)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const preview =
                  r.messageId !== null ? previewById.get(r.messageId) : undefined;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setDetailRowId(r.id)}
                    className="monitoring-row cursor-pointer border-b border-slate-100 bg-white hover:bg-slate-50 [content-visibility:auto] [contain-intrinsic-size:auto_44px]"
                  >
                    <td className="px-2 py-1">
                      {preview ? (
                        <div className="monitoring-row__preview block h-10 w-14 overflow-hidden rounded border border-slate-200">
                          <MatrixIframePreview
                            message={preview.message}
                            templateName={preview.liveTemplateName}
                            size={preview.liveSize}
                            mode="fit-rect"
                            templateMeta={preview.templateMeta}
                          />
                        </div>
                      ) : (
                        <div className="flex h-10 w-14 items-center justify-center rounded border border-dashed border-slate-200 text-slate-300">
                          <Code2 className="size-4" />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="tag-chip rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                        {r.platform}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-slate-600">
                      {r.product ?? (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs text-slate-700">
                      MC{r.mcNumber}
                      {r.mcVariant}
                    </td>
                    <td className="truncate px-3 py-1.5 text-xs text-slate-600">
                      {r.audienceKey}
                    </td>
                    <td className="truncate px-3 py-1.5 text-xs text-slate-600">
                      {r.topicKey}
                    </td>
                    <td className="truncate px-3 py-1.5 text-xs">
                      {r.messageId === null ? (
                        r.matchLevel === "family_known" ? (
                          <span
                            className="status-badge--family-known rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-800"
                            title="MC family exists in the matrix but spans several cells — no single message to link"
                          >
                            family known
                          </span>
                        ) : (
                          <span className="status-badge--unmatched rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                            unmatched
                          </span>
                        )
                      ) : (
                        <span className="text-slate-700">
                          {r.messageName ?? `#${r.messageId}`}
                          {r.matchLevel === "family" ? (
                            <span
                              className="status-badge--family ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sky-800"
                              title="Linked via unique MC number + variant — the trafficked audience/topic named a different cell"
                            >
                              family
                            </span>
                          ) : null}
                          {r.messageStatus ? (
                            <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                              {r.messageStatus}
                            </span>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {fmt(r.impressions)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {fmt(r.clicks)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {pct(r.ctr)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {fmt(Math.round(r.cost))}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                      {fmt(r.conversions)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailRow ? (
        <MonitoringDetailDialog
          mc={{ number: detailRow.mcNumber, variant: detailRow.mcVariant }}
          messageName={detailRow.messageName}
          messageStatus={detailRow.messageStatus}
          preview={
            detailRow.messageId !== null
              ? previewById.get(detailRow.messageId)
              : undefined
          }
          rows={data?.rows ?? []}
          onClose={() => setDetailRowId(null)}
        />
      ) : null}
    </div>
  );
}
