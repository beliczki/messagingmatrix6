// Build docs/mc-export.xlsx — one row per DCO messaging card (MC number +
// variant) that is currently in a serving status (ACTIVE or INACTIVE), with its
// product, the PMMIDs it was trafficked under, the ACTIVE/INACTIVE split and a
// public link to every generated preview PNG.
//
// One card lives on many audiences (the same creative copied across placements),
// so the 2000-odd message rows collapse into a couple of hundred cards. Product,
// topic and template are constant within a card — the export asserts that rather
// than assuming it.
//
// Read-only and rerunnable: after `npm run gen:previews` reshoots the previews
// the row ids stay put but `?v=` (message_previews.updated_at) changes, so just
// run this again and every link points at the fresh image.
//
//   npm run export:mc
//
// MC_EXPORT_ORIGIN overrides the host the links are built against (default: the
// live Erste deploy — /api/previews/[id] is deliberately public, see the route).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import fs from "node:fs";
import path from "node:path";
import xlsx from "node-xlsx";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "../src/db";
import {
  audiences,
  channels,
  messagePreviews,
  messages,
  topics,
} from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";

// The two statuses that mean "this card is in a feed" — same set the export
// panel serves from (FeedExportPanel.tsx SERVING_STATUSES).
const SERVING_STATUSES = ["ACTIVE", "INACTIVE"];
const ORIGIN = (
  process.env.MC_EXPORT_ORIGIN ?? "https://erste.messagingmatrix.ai"
).replace(/\/+$/, "");
const PAGE_SIZE = 500; // message rows per page (row-cap rule)
const OUT = path.resolve(process.cwd(), "docs/mc-export.xlsx");

type Row = {
  id: number;
  number: number;
  variant: string;
  topic: string;
  template: string | null;
  name: string | null;
  pmmid: string | null;
  status: string;
  audienceProduct: string | null;
  topicProduct: string | null;
};

type Card = {
  number: number;
  variant: string;
  product: string;
  topic: string;
  template: string | null;
  name: string | null;
  rows: Row[];
};

// Every non-archived DCO message in a serving status. DCO is the axis test from
// entities/messages.ts `sameAxisAs`: a card is nonDCO exactly when its audience
// key resolves to a CHANNEL row (ch_*). Audiences and topics are left-joined for
// the product only — a key that resolves to neither still counts as DCO, so an
// inner join would silently drop it.
async function fetchDcoRows(clientId: number): Promise<Row[]> {
  const out: Row[] = [];
  let lastId = 0;
  for (;;) {
    const page = await db
      .select({
        id: messages.id,
        number: messages.number,
        variant: messages.variant,
        topic: messages.topic,
        template: messages.template,
        name: messages.name,
        pmmid: messages.pmmid,
        status: messages.status,
        audienceProduct: audiences.product,
        topicProduct: topics.product,
      })
      .from(messages)
      .leftJoin(
        channels,
        and(
          eq(channels.clientId, messages.clientId),
          eq(channels.key, messages.audience),
        ),
      )
      .leftJoin(
        audiences,
        and(
          eq(audiences.clientId, messages.clientId),
          eq(audiences.key, messages.audience),
        ),
      )
      .leftJoin(
        topics,
        and(
          eq(topics.clientId, messages.clientId),
          eq(topics.key, messages.topic),
        ),
      )
      .where(
        and(
          eq(messages.clientId, clientId),
          isNull(messages.archivedAt),
          inArray(messages.status, SERVING_STATUSES),
          isNull(channels.id),
          gt(messages.id, lastId),
        ),
      )
      .orderBy(messages.id)
      .limit(PAGE_SIZE);
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    lastId = page[page.length - 1].id;
  }
  return out;
}

// {messageId: {size: url}} for the given messages, in id pages so the IN list
// stays bounded.
async function fetchPreviews(
  clientId: number,
  messageIds: number[],
): Promise<Map<number, Map<string, { url: string; updatedAt: string }>>> {
  const byMessage = new Map<
    number,
    Map<string, { url: string; updatedAt: string }>
  >();
  for (let i = 0; i < messageIds.length; i += PAGE_SIZE) {
    const chunk = messageIds.slice(i, i + PAGE_SIZE);
    const rows = await db
      .select({
        id: messagePreviews.id,
        messageId: messagePreviews.messageId,
        size: messagePreviews.size,
        updatedAt: messagePreviews.updatedAt,
      })
      .from(messagePreviews)
      .where(
        and(
          eq(messagePreviews.clientId, clientId),
          inArray(messagePreviews.messageId, chunk),
        ),
      );
    for (const p of rows) {
      const sizes = byMessage.get(p.messageId) ?? new Map();
      // Same URL shape as list_mc / MessageEditor: stable row id, updated_at as
      // the cache-buster so a reshoot is not served from a stale cache.
      sizes.set(p.size, {
        url: `${ORIGIN}/api/previews/${p.id}?v=${encodeURIComponent(p.updatedAt)}`,
        updatedAt: p.updatedAt,
      });
      byMessage.set(p.messageId, sizes);
    }
  }
  return byMessage;
}

// "300x250" → sortable [width, height]; keeps the preview columns in a stable,
// human order instead of alphabetical ("1080x1080" before "300x250").
function sizeOrder(size: string): [number, number] {
  const [w, h] = size.split("x").map((n) => Number(n));
  return [Number.isFinite(w) ? w : 0, Number.isFinite(h) ? h : 0];
}

function groupIntoCards(rows: Row[]): Card[] {
  const byCard = new Map<string, Card>();
  for (const r of rows) {
    const key = `${r.number}|${r.variant}`;
    let card = byCard.get(key);
    if (!card) {
      card = {
        number: r.number,
        variant: r.variant,
        product: r.audienceProduct ?? r.topicProduct ?? "",
        topic: r.topic,
        template: r.template,
        name: r.name,
        rows: [],
      };
      byCard.set(key, card);
    }
    card.rows.push(r);
    // Product / topic / template are card-level facts in the data model, not
    // row-level ones. If that ever stops holding the collapsed row would be a
    // quiet lie, so say so instead of picking the first row's value in silence.
    const drift = [
      ["product", card.product, r.audienceProduct ?? r.topicProduct ?? ""],
      ["topic", card.topic, r.topic],
      ["template", card.template ?? "", r.template ?? ""],
    ].filter(([, was, now]) => was !== now);
    for (const [field, was, now] of drift) {
      console.warn(
        `MC${r.number}${r.variant}: ${field} differs across placements (${was} vs ${now}) — reporting the first`,
      );
    }
  }
  for (const card of byCard.values()) {
    // Cheapest-possible ordering guarantee: the representative preview and the
    // PMMID list both read off this order.
    card.rows.sort((a, b) => a.id - b.id);
  }
  return [...byCard.values()].sort(
    (a, b) => a.number - b.number || a.variant.localeCompare(b.variant),
  );
}

async function main() {
  const client = await getActiveClient();
  const rows = await fetchDcoRows(client.id);
  if (rows.length === 0) throw new Error("no serving DCO messages found");

  const previews = await fetchPreviews(
    client.id,
    rows.map((r) => r.id),
  );
  const sizes = [
    ...new Set([...previews.values()].flatMap((m) => [...m.keys()])),
  ].sort((a, b) => {
    const [aw, ah] = sizeOrder(a);
    const [bw, bh] = sizeOrder(b);
    return aw - bw || ah - bh;
  });

  const cards = groupIntoCards(rows);
  const header = [
    "product",
    "mc",
    "mc_number",
    "variant",
    "topic",
    "name",
    "template",
    "active",
    "inactive",
    "pmmid_count",
    "pmmids",
    ...sizes.map((s) => `preview_${s}`),
    "preview_updated",
  ];

  let cardsWithoutPreview = 0;
  const data = cards.map((card) => {
    const active = card.rows.filter((r) => r.status === "ACTIVE").length;
    const pmmids = card.rows.map((r) => r.pmmid ?? "").filter(Boolean);
    // One creative, many placements: any row's preview shows the same banner, so
    // the lowest-id row that has the size is the representative.
    const links = sizes.map((size) => {
      for (const r of card.rows) {
        const hit = previews.get(r.id)?.get(size);
        if (hit) return hit;
      }
      return null;
    });
    if (links.every((l) => l === null)) cardsWithoutPreview += 1;
    const newest = links
      .map((l) => l?.updatedAt)
      .filter((u): u is string => Boolean(u))
      .sort()
      .pop();
    return [
      card.product,
      `MC${card.number}${card.variant}`,
      card.number,
      card.variant,
      card.topic,
      card.name ?? "",
      card.template ?? "",
      active,
      card.rows.length - active,
      pmmids.length,
      pmmids.join("\n"),
      ...links.map((l) => l?.url ?? ""),
      newest ?? "",
    ];
  });

  const buf = xlsx.build([{ name: "MC export", data: [header, ...data], options: {} }]);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(
    `wrote ${OUT} — ${cards.length} MC (${rows.length} message rows), ` +
      `sizes: ${sizes.join(", ")}, ${cardsWithoutPreview} MC without any preview`,
  );
  console.log(`preview links point at ${ORIGIN}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
