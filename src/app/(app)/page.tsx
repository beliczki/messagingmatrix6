import { redirect } from "next/navigation";
import Link from "next/link";
import { and, count, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/db";
import {
  audiences,
  auditLog,
  assets,
  creatives,
  feedExports,
  messages,
  monitoring,
  shareComments,
  shareGalleries,
  textFormatting,
  topics,
  users,
} from "@/db/schema";
import { getActiveClient } from "@/lib/active-client";
import { readSessionFromCookies } from "@/lib/auth-server";
import {
  daysBetween,
  resolveDayScope,
  shiftDay,
  todayUtc,
  type DayScope,
} from "@/lib/day-scope";
import { listStripCreatives, STRIP_PAGE } from "@/lib/dashboard-creatives";
import { productInventory } from "@/lib/dashboard-products";
import { shareItemCount } from "@/lib/share-metadata";
import CreativeStrip from "./_dashboard/CreativeStrip";
import ProductFilter from "./_dashboard/ProductFilter";

export const dynamic = "force-dynamic";

// Every timestamp column is a UTC `YYYY-MM-DD HH:MM:SS` string, so a day scope
// is a plain string BETWEEN — the same ordering the format was chosen for.

async function entityCounts(clientId: number) {
  const c = await Promise.all([
    db
      .select({ n: count() })
      .from(audiences)
      .where(eq(audiences.clientId, clientId)),
    db.select({ n: count() }).from(topics).where(eq(topics.clientId, clientId)),
    db
      .select({ n: count() })
      .from(messages)
      .where(eq(messages.clientId, clientId)),
    db.select({ n: count() }).from(assets).where(eq(assets.clientId, clientId)),
    db
      .select({ n: count() })
      .from(creatives)
      .where(eq(creatives.clientId, clientId)),
    db
      .select({ n: count() })
      .from(textFormatting)
      .where(eq(textFormatting.clientId, clientId)),
  ]);
  return {
    audiences: c[0][0]?.n ?? 0,
    topics: c[1][0]?.n ?? 0,
    messages: c[2][0]?.n ?? 0,
    assets: c[3][0]?.n ?? 0,
    creatives: c[4][0]?.n ?? 0,
    text_formatting: c[5][0]?.n ?? 0,
  };
}

// Long tail of one-off entity+action pairs adds height, not information.
const DIGEST_ROWS = 15;

type DigestRow = {
  entityType: string;
  action: string;
  userId: string | null;
  n: number;
};

// Aggregated, not listed: a busy day writes thousands of audit rows (5085 on
// 2026-08-17), and a 15-row raw tail of that says nothing. Group cardinality is
// bounded by entity types x actions x users, so it cannot approach the 1000-row
// truncation limit the way the raw log would.
function activityDigest(clientId: number, scope: DayScope) {
  return db
    .select({
      entityType: auditLog.entityType,
      action: auditLog.action,
      userId: auditLog.userId,
      n: count(),
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.clientId, clientId),
        gte(auditLog.createdAt, scope.from),
        lte(auditLog.createdAt, scope.to),
      ),
    )
    .groupBy(auditLog.entityType, auditLog.action, auditLog.userId);
}

function feedsInScope(clientId: number, scope: DayScope, products: string[]) {
  return db
    .select({
      id: feedExports.id,
      product: feedExports.product,
      platform: feedExports.platform,
      feedVersion: feedExports.feedVersion,
      rowCount: feedExports.rowCount,
      source: feedExports.source,
      exportedAt: feedExports.exportedAt,
      exportedBy: feedExports.exportedBy,
      uploadedToAdformAt: feedExports.uploadedToAdformAt,
    })
    .from(feedExports)
    .where(
      and(
        eq(feedExports.clientId, clientId),
        gte(feedExports.exportedAt, scope.from),
        lte(feedExports.exportedAt, scope.to),
        products.length ? inArray(feedExports.product, products) : undefined,
      ),
    )
    .orderBy(desc(feedExports.exportedAt))
    .limit(50);
}

/**
 * Shares opened in the window, plus the comments that landed on ANY share in
 * it — a comment on a share sent last month is this window's news, and the
 * share row alone would not carry it.
 *
 * View and download counts are running totals with no per-day history, so they
 * are labelled as such instead of being passed off as window figures.
 */
async function sharesInScope(clientId: number, scope: DayScope) {
  const opened = await db
    .select({
      id: shareGalleries.id,
      title: shareGalleries.title,
      metadata: shareGalleries.metadata,
      viewCount: shareGalleries.viewCount,
      downloadCount: shareGalleries.downloadCount,
      createdAt: shareGalleries.createdAt,
      archivedAt: shareGalleries.archivedAt,
    })
    .from(shareGalleries)
    .where(
      and(
        eq(shareGalleries.clientId, clientId),
        gte(shareGalleries.createdAt, scope.from),
        lte(shareGalleries.createdAt, scope.to),
      ),
    )
    .orderBy(desc(shareGalleries.createdAt))
    .limit(50);

  const comments = await db
    .select({
      id: shareComments.id,
      shareId: shareComments.shareGalleryId,
      author: shareComments.authorName,
      createdAt: shareComments.createdAt,
      shareTitle: shareGalleries.title,
    })
    .from(shareComments)
    .innerJoin(
      shareGalleries,
      eq(shareGalleries.id, shareComments.shareGalleryId),
    )
    .where(
      and(
        eq(shareGalleries.clientId, clientId),
        isNull(shareComments.archivedAt),
        gte(shareComments.createdAt, scope.from),
        lte(shareComments.createdAt, scope.to),
      ),
    )
    .orderBy(desc(shareComments.createdAt))
    .limit(50);

  return {
    opened: opened.map((s) => ({ ...s, items: shareItemCount(s.metadata) })),
    comments,
    views: opened.reduce((n, s) => n + s.viewCount, 0),
    downloads: opened.reduce((n, s) => n + s.downloadCount, 0),
  };
}

// The single most useful number on the page today: the reporting ingest has
// been silent since 2026-07-16 while the matrix kept moving. Says it out loud
// instead of letting stale charts imply freshness.
async function reportFreshness(clientId: number) {
  const [last] = await db
    .select({
      importedAt: monitoring.importedAt,
      periodFrom: monitoring.periodFrom,
      periodTo: monitoring.periodTo,
      platform: monitoring.platform,
      sourceFilename: monitoring.sourceFilename,
    })
    .from(monitoring)
    .where(eq(monitoring.clientId, clientId))
    .orderBy(desc(monitoring.importedAt))
    .limit(1);
  if (!last) return null;
  const [total] = await db
    .select({ n: count() })
    .from(monitoring)
    .where(eq(monitoring.clientId, clientId));
  return { ...last, rows: total?.n ?? 0 };
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; r?: string; p?: string }>;
}) {
  // Defense-in-depth: layout already enforces auth, but a direct hit here
  // without the layout (rare) would bypass it.
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");

  const sp = await searchParams;
  const scope = resolveDayScope(sp.d, sp.r);
  const products = (sp.p ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const client = await getActiveClient();

  const [
    counts,
    digest,
    feeds,
    freshness,
    creativeStrip,
    shares,
    inventory,
    userRows,
  ] = await Promise.all([
    entityCounts(client.id),
    activityDigest(client.id, scope),
    feedsInScope(client.id, scope, products),
    reportFreshness(client.id),
    listStripCreatives(client.id, scope, 0, STRIP_PAGE, products),
    sharesInScope(client.id, scope),
    productInventory(client.id),
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.clientId, client.id)),
  ]);

  const emailById = new Map(userRows.map((u) => [u.id, u.email]));
  const grouped = groupDigest(digest, emailById);
  const events = digest.reduce((s, r) => s + r.n, 0);
  const unpublished = feeds.filter((f) => f.uploadedToAdformAt === null).length;

  return (
    <div className="dashboard flex h-full flex-col">
      {/* Same sticky toolbar every other screen opens with — title, then the
          filters, then a count on the right. The client is named in the
          sidebar on every screen, so repeating it here cost a heading's worth
          of height and said nothing new. */}
      <header className="dashboard__toolbar toolbar sticky top-0 z-40 flex min-h-12 flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4">
        <div className="flex items-baseline gap-2">
          <h1 className="toolbar__title text-sm font-semibold text-slate-900">
            Dashboard
          </h1>
          <span className="toolbar__subtitle text-sm text-slate-500">
            {scope.label}
          </span>
        </div>
        <ProductFilter
          options={inventory.options}
          counts={inventory.counts}
          labels={inventory.labels}
          selected={products}
          query={{ d: scope.date, r: scope.range }}
        />
        {/* The scope belongs with the date it resolves to, on the right. */}
        <div className="dashboard__scope ml-auto flex items-center gap-3">
          <DayScopePicker scope={scope} products={products} />
          <div className="toolbar__count text-[11px] tabular-nums text-slate-500">
            {scope.date} UTC
          </div>
        </div>
      </header>

      <div className="dashboard__body flex-1 overflow-auto p-6">
        <section className="dashboard__signals mb-6 grid gap-3 md:grid-cols-3">
          <SignalTile
            label="Activity"
            value={String(events)}
            hint={
              events === 0
                ? "no writes in this window"
                : `${grouped.length} kind${grouped.length === 1 ? "" : "s"} of change`
            }
            tone={events === 0 ? "muted" : "ok"}
          />
          <SignalTile
            label="Feeds exported"
            value={String(feeds.length)}
            hint={
              feeds.length === 0
                ? "no export in this window"
                : unpublished > 0
                  ? `${unpublished} not published to AdForm yet`
                  : "all published"
            }
            tone={
              feeds.length === 0 ? "muted" : unpublished > 0 ? "warn" : "ok"
            }
            href="/feeds"
          />
          <FreshnessTile freshness={freshness} />
        </section>

        <div className="dashboard__columns mb-6 grid items-start gap-4 xl:grid-cols-[3fr_2fr]">
          <Panel
            title="Activity"
            hint={`${events} write${events === 1 ? "" : "s"} · ${scope.label.toLowerCase()}`}
          >
            {grouped.length === 0 ? (
              <EmptyLine scope={scope} products={products}>
                Nothing was written in this window.
              </EmptyLine>
            ) : (
              <ul className="activity-digest divide-y divide-slate-100 text-sm">
                {grouped.slice(0, DIGEST_ROWS).map((g) => (
                  <li
                    key={`${g.entityType}:${g.action}`}
                    className="activity-digest__row flex items-baseline gap-3 py-2"
                  >
                    <ActionBadge action={g.action} />
                    <span className="activity-digest__entity text-slate-700">
                      {g.entityType}
                    </span>
                    <span className="activity-digest__actors truncate text-xs text-slate-400">
                      {g.actors.join(", ")}
                    </span>
                    <span className="activity-digest__count ml-auto font-mono text-sm text-slate-900">
                      {g.n}
                    </span>
                  </li>
                ))}
                {grouped.length > DIGEST_ROWS ? (
                  <li className="activity-digest__more py-2 text-xs text-slate-400">
                    +{grouped.length - DIGEST_ROWS} more kinds of change
                  </li>
                ) : null}
              </ul>
            )}
          </Panel>

          <div className="dashboard__column dashboard__column--right grid gap-4">
            <Panel
              title="Feed exports"
              hint={
                feeds.length > 0 ? `${feeds.length} in this window` : undefined
              }
              href="/feeds"
            >
              {feeds.length === 0 ? (
                <EmptyLine scope={scope} products={products}>
                  No feed was exported in this window.
                </EmptyLine>
              ) : (
                <ul className="feed-digest divide-y divide-slate-100 text-sm">
                  {feeds.map((f) => (
                    <li
                      key={f.id}
                      className="feed-digest__row flex items-baseline gap-2 py-2"
                    >
                      <Link
                        href={`/feeds/${f.id}`}
                        className="feed-digest__product font-medium text-slate-900 hover:underline"
                      >
                        {f.product}
                      </Link>
                      <span className="feed-digest__meta text-xs text-slate-500">
                        {f.platform} · v{f.feedVersion} · {f.rowCount} rows
                        {f.source === "adform_snapshot" ? " · reference" : ""}
                      </span>
                      {f.uploadedToAdformAt === null ? (
                        <span className="status-badge feed-digest__badge--pending rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          not published
                        </span>
                      ) : (
                        <span className="status-badge feed-digest__badge--live rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                          published
                        </span>
                      )}
                      <span className="ml-auto font-mono text-xs text-slate-400">
                        {f.exportedAt.slice(11, 16)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title="Shares"
              hint={
                shares.opened.length > 0
                  ? `${shares.opened.length} opened${shares.comments.length > 0 ? `, ${shares.comments.length} new comment${shares.comments.length === 1 ? "" : "s"}` : ""}`
                  : shares.comments.length > 0
                    ? `${shares.comments.length} new comment${shares.comments.length === 1 ? "" : "s"}`
                    : undefined
              }
              href="/shares"
            >
              {shares.opened.length === 0 && shares.comments.length === 0 ? (
                <EmptyLine scope={scope} products={products}>
                  No share was opened and no one commented in this window.
                </EmptyLine>
              ) : (
                <ul className="share-digest divide-y divide-slate-100 text-sm">
                  {shares.opened.map((s) => (
                    <li
                      key={s.id}
                      className="share-digest__row flex items-baseline gap-2 py-2"
                    >
                      <a
                        href={`/share/${s.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="share-digest__title truncate font-medium text-slate-900 hover:underline"
                      >
                        {s.title ?? s.id}
                      </a>
                      {s.archivedAt ? (
                        <span className="status-badge share-digest__badge--archived rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          archived
                        </span>
                      ) : null}
                      <span
                        className="share-digest__meta ml-auto shrink-0 text-xs text-slate-500"
                        title="Views and downloads are running totals, not window figures"
                      >
                        {s.items} items · {s.viewCount} views ·{" "}
                        {s.downloadCount} dl
                      </span>
                    </li>
                  ))}
                  {shares.comments.map((c) => (
                    <li
                      key={c.id}
                      className="share-digest__row share-digest__row--comment flex items-baseline gap-2 py-2"
                    >
                      <span className="status-badge share-digest__badge--comment rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800">
                        comment
                      </span>
                      <span className="share-digest__author text-slate-700">
                        {c.author}
                      </span>
                      <a
                        href={`/share/${c.shareId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="share-digest__on truncate text-xs text-slate-500 hover:underline"
                      >
                        on {c.shareTitle ?? c.shareId}
                      </a>
                      <span className="ml-auto shrink-0 font-mono text-xs text-slate-400">
                        {c.createdAt.slice(11, 16)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        <section className="dashboard__creatives mb-6">
          <Panel
            title="Creatives"
            hint={
              creativeStrip.fallback
                ? creativeStrip.items[0]
                  ? `none in this window — latest change ${creativeStrip.items[0].changedAt.slice(0, 10)}`
                  : undefined
                : `${creativeStrip.total} in this window`
            }
            href="/creative-library"
          >
            {creativeStrip.items.length === 0 ? (
              <EmptyLine>The creative library is empty.</EmptyLine>
            ) : (
              <CreativeStrip
                page={creativeStrip}
                scope={{ d: scope.date, r: scope.range, p: products.join(",") }}
              />
            )}
          </Panel>
        </section>

        <section className="dashboard__library">
          <p className="mb-2 text-xs uppercase tracking-wider text-slate-500">
            Library · all time
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {(
              [
                ["Audiences", counts.audiences, "/audiences"],
                ["Topics", counts.topics, "/topics"],
                ["Messages", counts.messages, "/matrix"],
                ["Assets", counts.assets, "/assets"],
                ["Creatives", counts.creatives, "/creative-library"],
                ["Text formatting", counts.text_formatting, "/texts"],
              ] as Array<[string, number, string]>
            ).map(([label, n, href]) => (
              <Link
                key={label}
                href={href}
                className="count-tile rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-400"
              >
                <p className="count-tile__label text-[10px] uppercase tracking-wider text-slate-500">
                  {label}
                </p>
                <p className="count-tile__value mt-1 text-2xl font-semibold text-slate-900">
                  {n}
                </p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

// One row per entity+action, with the actors that produced it folded in — "who
// did what, how many times", which is what a day of 900 audit rows actually
// amounts to.
function groupDigest(
  rows: DigestRow[],
  emailById: Map<string, string>,
): Array<{ entityType: string; action: string; n: number; actors: string[] }> {
  const out = new Map<
    string,
    {
      entityType: string;
      action: string;
      n: number;
      actors: Map<string, number>;
    }
  >();
  for (const r of rows) {
    const key = `${r.entityType}:${r.action}`;
    const cur = out.get(key) ?? {
      entityType: r.entityType,
      action: r.action,
      n: 0,
      actors: new Map(),
    };
    cur.n += r.n;
    const who = r.userId ? (emailById.get(r.userId) ?? r.userId) : "system";
    cur.actors.set(who, (cur.actors.get(who) ?? 0) + r.n);
    out.set(key, cur);
  }
  return [...out.values()]
    .map((g) => ({
      entityType: g.entityType,
      action: g.action,
      n: g.n,
      actors: [...g.actors.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([who, n]) => (g.actors.size > 1 ? `${who} (${n})` : who)),
    }))
    .sort((a, b) => b.n - a.n || a.entityType.localeCompare(b.entityType));
}

function DayScopePicker({
  scope,
  products,
}: {
  scope: DayScope;
  products: string[];
}) {
  const today = todayUtc();
  const withProducts = (params: string) =>
    products.length > 0
      ? `/?${params}&p=${encodeURIComponent(products.join(","))}`
      : `/?${params}`;
  const prev = shiftDay(scope.date, -1);
  const next = shiftDay(scope.date, 1);
  const atToday = scope.date === today;
  return (
    <nav className="day-scope flex items-center gap-1" aria-label="Day scope">
      <Link
        href={withProducts(`d=${prev}&r=${scope.range}`)}
        aria-label="Previous day"
        className="day-scope__step toolbar-btn flex size-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50"
      >
        <ChevronLeft className="size-4" />
      </Link>
      {atToday ? (
        <span className="day-scope__step day-scope__step--disabled flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-300">
          <ChevronRight className="size-4" />
        </span>
      ) : (
        <Link
          href={withProducts(`d=${next}&r=${scope.range}`)}
          aria-label="Next day"
          className="day-scope__step toolbar-btn flex size-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-50"
        >
          <ChevronRight className="size-4" />
        </Link>
      )}
      <ScopePill
        href={withProducts(`d=${today}&r=day`)}
        label="Today"
        active={atToday && scope.range === "day"}
      />
      <ScopePill
        href={withProducts(`d=${shiftDay(today, -1)}&r=day`)}
        label="Yesterday"
        active={scope.date === shiftDay(today, -1) && scope.range === "day"}
      />
      <ScopePill
        href={withProducts(`d=${today}&r=7d`)}
        label="Last 7 days"
        active={scope.range === "7d"}
      />
    </nav>
  );
}

function ScopePill({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "day-scope__pill day-scope__pill--active rounded-md border border-slate-900 bg-slate-900 px-2 py-1 text-xs font-medium text-white"
          : "day-scope__pill toolbar-btn rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50"
      }
    >
      {label}
    </Link>
  );
}

function SignalTile({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "ok" | "warn" | "muted";
  href?: string;
}) {
  const color =
    tone === "warn"
      ? "text-amber-700"
      : tone === "muted"
        ? "text-slate-400"
        : "text-slate-900";
  const body = (
    <>
      <p className="signal-tile__label text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`signal-tile__value mt-1 text-2xl font-semibold ${color}`}>
        {value}
      </p>
      <p className="signal-tile__hint mt-0.5 text-xs text-slate-500">{hint}</p>
    </>
  );
  const cls =
    "signal-tile block rounded-xl border border-slate-200 bg-white p-4 transition";
  return href ? (
    <Link href={href} className={`${cls} hover:border-slate-400`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function FreshnessTile({
  freshness,
}: {
  freshness: Awaited<ReturnType<typeof reportFreshness>>;
}) {
  if (!freshness) {
    return (
      <SignalTile
        label="Reporting data"
        value="—"
        hint="no monitoring import yet"
        tone="muted"
        href="/monitoring"
      />
    );
  }
  const age = daysBetween(freshness.importedAt, todayUtc());
  return (
    <SignalTile
      label="Reporting data"
      value={age === 0 ? "today" : `${age}d old`}
      hint={`${freshness.rows} rows · covers ${periodDay(freshness.periodFrom)}–${periodDay(freshness.periodTo)} · imported ${freshness.importedAt.slice(0, 10)}`}
      tone={age > 14 ? "warn" : "ok"}
      href="/monitoring"
    />
  );
}

function Panel({
  title,
  hint,
  href,
  children,
}: {
  title: string;
  hint?: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel rounded-xl border border-slate-200 bg-white p-4">
      <div className="panel__header mb-3 flex items-baseline gap-2">
        <h2 className="panel__title text-sm font-semibold uppercase tracking-wide text-slate-700">
          {title}
        </h2>
        {hint ? (
          <span className="panel__hint text-xs text-slate-400">{hint}</span>
        ) : null}
        {href ? (
          <Link
            href={href}
            className="panel__link ml-auto text-xs text-slate-500 hover:text-slate-900 hover:underline"
          >
            Open →
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// A quiet day is the common case, and the useful next move is almost always
// the wider window — so the empty state offers it instead of dead-ending.
function EmptyLine({
  children,
  scope,
  products = [],
}: {
  children: React.ReactNode;
  scope?: DayScope;
  /** Kept on the "wider window" link, so it does not clear the filter. */
  products?: string[];
}) {
  return (
    <p className="empty-state__hint text-sm text-slate-500">
      {children}
      {scope && scope.range === "day" ? (
        <>
          {" "}
          <Link
            href={
              products.length > 0
                ? `/?d=${todayUtc()}&r=7d&p=${encodeURIComponent(products.join(","))}`
                : `/?d=${todayUtc()}&r=7d`
            }
            className="empty-state__link text-slate-600 underline hover:text-slate-900"
          >
            Try the last 7 days
          </Link>
          .
        </>
      ) : null}
    </p>
  );
}

// Monitoring stores its report period as `DD/MM/YYYY HH:MM:SS` (straight from
// the XLSX front page); only the day half is worth showing.
function periodDay(v: string): string {
  return v.split(" ")[0];
}

const ACTION_TONE: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-800",
  bulk_create: "bg-emerald-100 text-emerald-800",
  update: "bg-blue-100 text-blue-800",
  bulk_update: "bg-blue-100 text-blue-800",
  delete: "bg-rose-100 text-rose-800",
  bulk_delete: "bg-rose-100 text-rose-800",
  archive: "bg-amber-100 text-amber-800",
  bulk_archive: "bg-amber-100 text-amber-800",
};

function ActionBadge({ action }: { action: string }) {
  return (
    <span
      className={`status-badge activity-digest__action rounded px-1.5 py-0.5 text-xs font-medium ${
        ACTION_TONE[action] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {action}
    </span>
  );
}
