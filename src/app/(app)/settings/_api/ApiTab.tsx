"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// The deploy's HTTP surface. The list and the auth column are GENERATED from
// the source tree (/api/routes → lib/api-docs.ts) — a route that exists is
// here, and a deleted one is gone, with nobody having to remember. Only the
// one-line descriptions are hand-written, because 4 of the ~100 handlers
// declare a zod schema and there is no contract to read off the rest.

type ApiAuth =
  | "admin"
  | "session"
  | "bearer"
  | "signed"
  | "share-link"
  | "open";

type ApiRoute = {
  path: string;
  methods: string[];
  auth: ApiAuth;
  authMarker: string;
  group: string;
  description: string;
  file: string;
};

type SecretInfo =
  | { configured: false }
  | { configured: true; masked: string; updatedAt: string };

const AUTH_BADGE: Record<ApiAuth, string> = {
  admin: "bg-violet-100 text-violet-800",
  session: "bg-slate-200 text-slate-600",
  bearer: "bg-sky-100 text-sky-800",
  signed: "bg-emerald-100 text-emerald-800",
  "share-link": "bg-amber-100 text-amber-800",
  open: "bg-rose-100 text-rose-800",
};

const AUTH_LABEL: Record<ApiAuth, string> = {
  admin: "admin",
  session: "session",
  bearer: "bearer",
  signed: "signed",
  "share-link": "share link",
  open: "open",
};

const METHOD_COLOR: Record<string, string> = {
  GET: "text-slate-600",
  POST: "text-emerald-700",
  PUT: "text-amber-700",
  PATCH: "text-amber-700",
  DELETE: "text-rose-700",
};

export function ApiTab() {
  const [filter, setFilter] = useState("");

  const q = useQuery({
    queryKey: ["api-routes"],
    queryFn: async (): Promise<ApiRoute[]> => {
      const r = await fetch("/api/routes");
      if (!r.ok) throw new Error("routes fetch failed");
      const data = (await r.json()) as { routes: ApiRoute[] };
      return data.routes;
    },
  });

  const routes = useMemo(() => q.data ?? [], [q.data]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return routes;
    return routes.filter(
      (r) =>
        r.path.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle) ||
        r.methods.some((m) => m.toLowerCase() === needle) ||
        AUTH_LABEL[r.auth].includes(needle),
    );
  }, [routes, filter]);

  const groups = useMemo(() => {
    const byGroup = new Map<string, ApiRoute[]>();
    for (const r of shown) {
      const list = byGroup.get(r.group) ?? [];
      list.push(r);
      byGroup.set(r.group, list);
    }
    return [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown]);

  const openCount = routes.filter((r) => r.auth === "open").length;
  const undocumented = routes.filter((r) => !r.description).length;

  return (
    <div className="api-tab max-w-3xl">
      <Section title="What this is">
        <p className="mb-3 text-sm text-slate-600">
          Every HTTP route this deploy serves, read off the source tree at
          request time. The <strong className="font-semibold">auth</strong>{" "}
          column is derived the same way — from the wrapper each handler
          actually uses — so it cannot drift away from the code the way a
          hand-kept list would.
        </p>
        <p className="text-sm text-slate-600">
          What a route <em>accepts and returns</em> is not machine-readable
          here: only a handful of handlers declare a schema, unlike the MCP
          tools in the next tab. Those lines are written by hand, and a route
          with none still appears in the list.
        </p>
      </Section>

      <PublicShortcutSection />

      <Section title="Auth column">
        <DefRow label="admin">
          <code className="font-mono text-xs">withAdmin</code> — signed in
          <em> and</em> role=admin.
        </DefRow>
        <DefRow label="session">
          <code className="font-mono text-xs">withSession</code>, or the{" "}
          <code className="font-mono text-xs">entity-route</code> factory that
          wraps it. The auth cookie is enough, so an{" "}
          <code className="font-mono text-xs">&lt;img src&gt;</code> in the app
          works without doing anything.
        </DefRow>
        <DefRow label="bearer">
          A token checked inside the handler — the MCP endpoint.
        </DefRow>
        <DefRow label="signed">
          An HMAC in the URL stands in for a session. See{" "}
          <code className="font-mono text-xs">/publicshortcut</code> above.
        </DefRow>
        <DefRow label="share link">
          The unguessable share id is the credential, and the route only serves
          what that share&apos;s snapshot references.
        </DefRow>
        <DefRow label="open">
          No credential of any kind. {openCount} route
          {openCount === 1 ? "" : "s"}: sign-in, sign-out and the pre-auth
          branding endpoint, plus the public render the share viewer draws
          with. Anything new landing here is worth a second look.
        </DefRow>
      </Section>

      <header className="mt-8 mb-4 flex items-end justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Routes
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {q.data
              ? `${routes.length} total · ${shown.length} shown · ${undocumented} without a description`
              : "Loading…"}
          </p>
        </div>
        <label className="form-field block w-56">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter path, method, auth…"
            className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
          />
        </label>
      </header>

      {q.isLoading ? (
        <p className="text-sm text-slate-500">Loading routes…</p>
      ) : q.isError ? (
        <p className="error-alert rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load the route inventory.
        </p>
      ) : groups.length === 0 ? (
        <p className="empty-state text-sm text-slate-500">
          Nothing matches “{filter}”.
        </p>
      ) : (
        groups.map(([group, list]) => (
          <section key={group} className="api-tab__group mb-6">
            <h4 className="api-tab__group-title mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {group}
            </h4>
            <div className="api-tab__routes space-y-2">
              {list.map((r) => (
                <RouteCard key={r.path} route={r} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function RouteCard({ route }: { route: ApiRoute }) {
  return (
    <article className="api-route rounded-lg border border-slate-200 bg-white p-3">
      <header className="api-route__header flex flex-wrap items-baseline gap-2">
        <span className="api-route__methods font-mono text-[11px] font-semibold">
          {route.methods.length === 0 ? (
            <span className="text-slate-400">—</span>
          ) : (
            route.methods.map((m) => (
              <span
                key={m}
                className={`mr-1.5 ${METHOD_COLOR[m] ?? "text-slate-600"}`}
              >
                {m}
              </span>
            ))
          )}
        </span>
        <code className="api-route__path font-mono text-sm text-slate-900">
          {route.path}
        </code>
        <span
          title={route.authMarker}
          className={`status-badge ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${AUTH_BADGE[route.auth]}`}
        >
          {AUTH_LABEL[route.auth]}
        </span>
      </header>
      <p className="api-route__description mt-1 text-sm text-slate-600">
        {route.description || <span className="text-slate-400">—</span>}
      </p>
    </article>
  );
}

// B4: the signing secret lives here because this is the page that explains what
// it signs. Masked by default and revealed only on a click, the way Settings →
// MCP treats bearer tokens.
function PublicShortcutSection() {
  const qc = useQueryClient();
  const [revealed, setRevealed] = useState<{
    title: string;
    token: string;
  } | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const q = useQuery({
    queryKey: ["public-shortcut-secret"],
    queryFn: async (): Promise<SecretInfo> => {
      const r = await fetch("/api/public-shortcut-secret");
      if (!r.ok) throw new Error("secret fetch failed");
      return (await r.json()) as SecretInfo;
    },
  });

  const reveal = useMutation({
    mutationFn: async (): Promise<string> => {
      const r = await fetch("/api/public-shortcut-secret/reveal", {
        method: "POST",
      });
      if (!r.ok) throw new Error("reveal failed");
      return ((await r.json()) as { secret: string }).secret;
    },
    onSuccess: (secret) => {
      setRevealed({ title: "Signing secret", token: secret });
      void qc.invalidateQueries({ queryKey: ["public-shortcut-secret"] });
    },
  });

  const rotate = useMutation({
    mutationFn: async (): Promise<string> => {
      const r = await fetch("/api/public-shortcut-secret/rotate", {
        method: "POST",
      });
      if (!r.ok) throw new Error("rotate failed");
      return ((await r.json()) as { secret: string }).secret;
    },
    onSuccess: (secret) => {
      setConfirmRotate(false);
      setRevealed({ title: "New signing secret", token: secret });
      void qc.invalidateQueries({ queryKey: ["public-shortcut-secret"] });
    },
  });

  const info = q.data;

  return (
    <Section title="Signed public images">
      <p className="mb-3 text-sm text-slate-600">
        <code className="font-mono text-xs">
          /publicshortcut/m&lt;message_id&gt;.&lt;sig&gt;/&lt;size&gt;
        </code>{" "}
        serves a rendered DCO preview and{" "}
        <code className="font-mono text-xs">
          /publicshortcut/c&lt;creative_id&gt;.&lt;sig&gt;
        </code>{" "}
        an agentic creative file — with no session, to anyone holding the link.
        Add <code className="font-mono text-xs">?html=1</code> for a bare page
        with the image in the top-left corner.
      </p>
      <p className="mb-3 text-sm text-slate-600">
        The id is in the clear; the signature beside it is what cannot be
        produced without the secret. That is what makes the link{" "}
        <strong className="font-semibold">computable</strong> — anyone holding
        the secret can build one for any id, in one line:
      </p>
      <pre className="api-tab__recipe mb-3 overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-700">
{`hmac.new(secret.encode(), b"m1877", hashlib.sha256).hexdigest()[:16]
  -> /publicshortcut/m1877.<that>/300x250`}
      </pre>
      <p className="mb-4 text-sm text-slate-600">
        There is no per-link revocation — rotating the secret is the only
        withdrawal there is, and it invalidates{" "}
        <strong className="font-semibold">every</strong> link already handed
        out. That is the price of URLs nobody has to store. Status does not
        gate: a <code className="font-mono text-xs">DRAFT</code> preview is
        served like any other, so a client&apos;s agent can watch a draft take
        shape.
      </p>

      <div className="api-tab__secret flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Secret
          </div>
          <code className="font-mono text-sm text-slate-900">
            {!info
              ? "…"
              : info.configured
                ? info.masked
                : "not created yet"}
          </code>
          {info?.configured ? (
            <div className="mt-0.5 text-[10px] text-slate-500">
              updated {info.updatedAt}
            </div>
          ) : null}
        </div>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => reveal.mutate()}
            disabled={reveal.isPending}
            className="toolbar-btn rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {reveal.isPending ? "Revealing…" : "Reveal"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRotate(true)}
            className="toolbar-btn rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50"
          >
            Rotate
          </button>
        </div>
      </div>

      {reveal.isError || rotate.isError ? (
        <p className="error-alert mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          That did not work. Admin role required.
        </p>
      ) : null}

      {confirmRotate ? (
        <ConfirmRotate
          busy={rotate.isPending}
          onCancel={() => setConfirmRotate(false)}
          onConfirm={() => rotate.mutate()}
        />
      ) : null}
      {revealed ? (
        <SecretModal
          title={revealed.title}
          token={revealed.token}
          onClose={() => setRevealed(null)}
        />
      ) : null}
    </Section>
  );
}

function ConfirmRotate({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="modal w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <header className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">
            Rotate the signing secret?
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Every signed link already handed out stops working immediately —
            MCP tool output an agent is holding, links in an export, images
            embedded in someone else&apos;s document. There is no way to
            invalidate one link without invalidating all of them.
          </p>
        </header>
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? "Rotating…" : "Rotate anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SecretModal({
  title,
  token,
  onClose,
}: {
  title: string;
  token: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* noop */
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="modal w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <header className="mb-4">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            You can reveal it again later from this page (each reveal is
            audit-logged).
          </p>
        </header>
        <div className="token-reveal__box mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <code className="token-reveal__token block break-all font-mono text-xs text-slate-900">
            {token}
          </code>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {copied ? "Copied ✓" : "Copy to clipboard"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="toolbar-btn--primary rounded-md bg-brand-button px-4 py-2 text-sm font-medium text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="api-tab__section mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="api-tab__section-title mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </h3>
      <div className="api-tab__section-body space-y-2">{children}</div>
    </section>
  );
}

function DefRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="api-tab__def grid grid-cols-[6rem_1fr] items-baseline gap-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-sm text-slate-700">{children}</dd>
    </div>
  );
}
