"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type ToolField = {
  name: string;
  type: string;
  optional: boolean;
};

type ToolDescriptor = {
  name: string;
  description: string;
  inputs: ToolField[];
};

type McpTokenRow = {
  id: number;
  userId: string;
  userEmail: string;
  scope: "full" | "read";
  label: string | null;
  tokenMasked: string;
  lastUsedAt: string | null;
  createdAt: string;
};

type UserRow = {
  id: string;
  email: string;
  role: string;
};

const GROUP_ORDER: Array<{ key: string; label: string; match: (n: string) => boolean }> = [
  { key: "list", label: "List & read", match: (n) => n.startsWith("list_") || n === "matrix_status" || n.startsWith("get_") },
  { key: "audience", label: "Audiences", match: (n) => /audience/.test(n) && !n.startsWith("list_") && !n.startsWith("get_") },
  { key: "topic", label: "Topics", match: (n) => /topic/.test(n) && !n.startsWith("list_") && !n.startsWith("get_") },
  { key: "message", label: "Messages (MCs)", match: (n) => /(^|_)mc(_|$)|message/.test(n) && !n.startsWith("list_") && !n.startsWith("get_") && !/batch/.test(n) },
  { key: "creative", label: "Creative library", match: (n) => /creative/.test(n) && !n.startsWith("list_") },
  { key: "prodlist", label: "Prodlist", match: (n) => /prodlist/.test(n) && !n.startsWith("list_") },
  { key: "batch", label: "Batch", match: (n) => /batch/.test(n) },
];

function groupOf(name: string): string {
  for (const g of GROUP_ORDER) {
    if (g.match(name)) return g.key;
  }
  return "other";
}

export function McpTab() {
  const q = useQuery({
    queryKey: ["mcp", "tools"],
    queryFn: async (): Promise<ToolDescriptor[]> => {
      const r = await fetch("/api/mcp/tools");
      if (!r.ok) throw new Error("failed to fetch tools");
      const data = (await r.json()) as { tools: ToolDescriptor[] };
      return data.tools;
    },
  });

  const groups = useMemo(() => {
    const tools = q.data ?? [];
    const map = new Map<string, ToolDescriptor[]>();
    for (const t of tools) {
      const g = groupOf(t.name);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(t);
    }
    const ordered = GROUP_ORDER.map((g) => ({
      key: g.key,
      label: g.label,
      tools: map.get(g.key) ?? [],
    })).filter((g) => g.tools.length > 0);
    const other = map.get("other") ?? [];
    if (other.length > 0) {
      ordered.push({ key: "other", label: "Other", tools: other });
    }
    return ordered;
  }, [q.data]);

  return (
    <div className="mcp-tab max-w-3xl">
      <header className="mb-6">
        <p className="text-sm text-slate-500">
          The MCP server lets agents (Claude Desktop, claude.ai connectors,
          custom clients) read and write the matrix over the Model Context
          Protocol. Tools below are auto-generated from{" "}
          <code className="rounded bg-slate-100 px-1 font-mono text-xs">
            src/lib/mcp.ts
          </code>
          .
        </p>
      </header>

      <McpTokensSection />

      <Section title="Endpoint">
        <DefRow label="URL">
          <code className="font-mono text-xs">
            {typeof window === "undefined" ? "" : window.location.origin}/mcp
          </code>
        </DefRow>
        <DefRow label="Transport">Streamable HTTP (stateless, JSON responses)</DefRow>
        <DefRow label="Methods">GET, POST, DELETE</DefRow>
      </Section>

      <Section title="Authentication">
        <p className="mb-3 text-sm text-slate-600">
          Tokens are per-user bearer tokens, stored in{" "}
          <code className="font-mono text-xs">mcp_tokens</code> and managed in
          the <strong className="font-semibold">Tokens</strong> section above.
          Each token belongs to one user and carries a scope:{" "}
          <code className="font-mono text-xs">full</code> registers every tool,{" "}
          <code className="font-mono text-xs">read</code> registers only the
          list/read tools — write tools are not registered at all, so they
          don&apos;t appear in <code className="font-mono text-xs">tools/list</code>.
          The deploy is pinned to one client via{" "}
          <code className="font-mono text-xs">ACTIVE_CLIENT_KEY</code>: a token
          that resolves to a different client returns 401, even if the token is
          valid for that other client.
        </p>
        <DefRow label="Header">
          <code className="font-mono text-xs">
            Authorization: Bearer mcp_…
          </code>
        </DefRow>
        <DefRow label="claude.ai connector">
          <code className="font-mono text-xs">/mcp?secret=mcp_…</code> (URL
          param fallback for clients that can't set a header)
        </DefRow>
        <DefRow label="Mismatch">
          Bearer resolves to client ≠ active client → <code>401</code>
        </DefRow>
        <DefRow label="Revoked">
          Revoked token, or token whose owner was archived → <code>401</code>{" "}
          on the next request
        </DefRow>
      </Section>

      <Section title="Rate limits">
        <p className="text-sm text-slate-600">
          One write call = one unit (a batch counts as 1). Default{" "}
          <strong className="font-semibold">60 writes/min</strong>, fixed
          60-second window per client. Override per client by setting{" "}
          <code className="font-mono text-xs">
            config(client_id, key=&apos;mcp.rateLimit&apos;)
          </code>{" "}
          to a positive number.
        </p>
      </Section>

      <Section title="Preview images">
        <p className="text-sm text-slate-600">
          <code className="font-mono text-xs">list_mc</code> rows carry{" "}
          <code className="font-mono text-xs">preview_urls</code> — a{" "}
          <code className="font-mono text-xs">{"{size: url}"}</code> map of
          generated PNG screenshots of each rendered HTML creative. The URLs
          point at{" "}
          <code className="font-mono text-xs">/api/previews/&lt;id&gt;</code>{" "}
          and are <strong className="font-semibold">public</strong> — a plain
          unauthenticated HTTP GET works (they are fetched outside the MCP
          protocol; the deploy still only serves the active client&apos;s
          previews, and generation stays authenticated). Previews are
          generated per template size by the{" "}
          <code className="font-mono text-xs">preview_generate</code> tool (max
          20 labels per call, synchronous headless Chromium — a few seconds per
          size) or by <code className="font-mono text-xs">npm run gen:previews</code>;
          both regenerate only sizes where the MC was edited since the last
          shot, unless <code className="font-mono text-xs">force</code> is set.
        </p>
      </Section>

      <Section title="Asset upload">
        <p className="text-sm text-slate-600">
          <code className="font-mono text-xs">asset_upload</code> stores a
          media file and creates the asset row in one call. Small files go
          inline as <code className="font-mono text-xs">data_base64</code>{" "}
          (max 10&nbsp;MB decoded); larger ones via{" "}
          <code className="font-mono text-xs">source_url</code> — a public
          http(s) URL the server downloads (max 50&nbsp;MB; private/internal
          addresses are refused). Duplicate filenames are rejected unless{" "}
          <code className="font-mono text-xs">replace_existing=true</code>,
          because template rendering resolves images by filename
          (newest&nbsp;wins). brand/product/type are auto-derived from the
          filename via the client&apos;s parsing rules; explicit values
          override.
        </p>
      </Section>

      <Section title="Audit & broadcast">
        <p className="text-sm text-slate-600">
          Writes go through the same entity layer as the UI: every mutation is
          audit-logged with{" "}
          <code className="font-mono text-xs">byUser</code> set to the token
          owner&apos;s user id — identical to writes that user makes in the UI
          — and emits an SSE event so connected UIs update live.
        </p>
      </Section>

      <header className="mt-8 mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          Tools
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {q.data ? `${q.data.length} registered` : "Loading…"}
        </p>
      </header>

      {q.isLoading ? (
        <p className="text-sm text-slate-500">Loading tools…</p>
      ) : q.isError ? (
        <p className="text-sm text-rose-600">Failed to load tool inventory.</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="mcp-tab__group mb-6">
            <h4 className="mcp-tab__group-title mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {g.label}
            </h4>
            <div className="mcp-tab__tools space-y-3">
              {g.tools.map((t) => (
                <ToolCard key={t.name} tool={t} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function McpTokensSection() {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [revealed, setRevealed] = useState<{
    title: string;
    token: string;
  } | null>(null);

  const q = useQuery({
    queryKey: ["mcp-tokens"],
    queryFn: async (): Promise<McpTokenRow[]> => {
      const r = await fetch("/api/mcp-tokens");
      if (!r.ok) throw new Error("tokens fetch failed");
      const data = (await r.json()) as { tokens: McpTokenRow[] };
      return data.tokens;
    },
  });

  const revealM = useMutation({
    mutationFn: async (t: McpTokenRow) => {
      const r = await fetch(`/api/mcp-tokens/${t.id}/reveal`, {
        method: "POST",
      });
      if (!r.ok) throw new Error("reveal failed");
      const data = (await r.json()) as { token: string };
      return { row: t, token: data.token };
    },
    onSuccess: ({ row, token }) => {
      setRevealed({ title: `MCP token — ${row.userEmail}`, token });
    },
  });

  const revokeM = useMutation({
    mutationFn: async (t: McpTokenRow) => {
      const r = await fetch(`/api/mcp-tokens/${t.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("revoke failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp-tokens"] });
    },
  });

  function revoke(t: McpTokenRow) {
    if (
      !window.confirm(
        `Revoke the token for "${t.userEmail}"${t.label ? ` (${t.label})` : ""}? It stops working on its next request.`,
      )
    ) {
      return;
    }
    revokeM.mutate(t);
  }

  return (
    <section className="mcp-tokens mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <header className="mcp-tokens__header mb-3 flex items-center justify-between">
        <h3 className="mcp-tab__section-title text-sm font-semibold uppercase tracking-wide text-slate-700">
          Tokens
        </h3>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="toolbar-btn--primary rounded-md bg-brand-button px-3 py-1.5 text-sm font-medium text-white"
        >
          New token
        </button>
      </header>

      {q.isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : q.isError ? (
        <p className="error-alert rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Failed to load tokens.
        </p>
      ) : (q.data ?? []).length === 0 ? (
        <p className="empty-state text-sm text-slate-500">
          No tokens yet. Create one per user (and per agent) — a{" "}
          <code className="font-mono text-xs">read</code> token can only list,
          a <code className="font-mono text-xs">full</code> token can write.
        </p>
      ) : (
        <table className="mcp-tokens__table w-full table-auto border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2 font-medium">Label</th>
              <th className="px-2 py-2 font-medium">User</th>
              <th className="px-2 py-2 font-medium">Scope</th>
              <th className="px-2 py-2 font-medium">Token</th>
              <th className="px-2 py-2 font-medium">Last used</th>
              <th className="px-2 py-2 font-medium">Created</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((t) => (
              <tr key={t.id} className="mcp-tokens__row border-b border-slate-100">
                <td className="px-2 py-2 text-slate-900">
                  {t.label ?? <span className="text-slate-400">—</span>}
                </td>
                <td className="px-2 py-2 text-xs text-slate-700">
                  {t.userEmail}
                </td>
                <td className="px-2 py-2">
                  <span
                    className={
                      t.scope === "full"
                        ? "status-badge rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800"
                        : "status-badge rounded bg-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-600"
                    }
                  >
                    {t.scope}
                  </span>
                </td>
                <td className="px-2 py-2 font-mono text-xs text-slate-600">
                  {t.tokenMasked}
                </td>
                <td className="px-2 py-2 text-xs text-slate-500">
                  {t.lastUsedAt ? t.lastUsedAt.slice(0, 16) : "never"}
                </td>
                <td className="px-2 py-2 text-xs text-slate-500">
                  {t.createdAt.slice(0, 10)}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => revealM.mutate(t)}
                      disabled={revealM.isPending}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Reveal
                    </button>
                    <button
                      type="button"
                      onClick={() => revoke(t)}
                      disabled={revokeM.isPending}
                      className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showNew ? (
        <NewTokenModal
          onClose={() => setShowNew(false)}
          onCreated={(userEmail, token) => {
            qc.invalidateQueries({ queryKey: ["mcp-tokens"] });
            setShowNew(false);
            setRevealed({ title: `New MCP token — ${userEmail}`, token });
          }}
        />
      ) : null}

      {revealed ? (
        <TokenRevealModal
          title={revealed.title}
          token={revealed.token}
          onClose={() => setRevealed(null)}
        />
      ) : null}
    </section>
  );
}

function NewTokenModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (userEmail: string, token: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [scope, setScope] = useState<"full" | "read">("read");
  const [label, setLabel] = useState("");

  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: async (): Promise<UserRow[]> => {
      const r = await fetch("/api/users");
      if (!r.ok) throw new Error("users fetch failed");
      const data = (await r.json()) as { users: UserRow[] };
      return data.users;
    },
  });

  const selectedUser = (usersQ.data ?? []).find((u) => u.id === userId);

  const m = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/mcp-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, scope, label: label || undefined }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "create failed");
      return data as { token: string; userEmail: string };
    },
    onSuccess: (data) => onCreated(data.userEmail, data.token),
  });

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="modal w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <header className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">
            New MCP token
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="modal__close rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              User
            </span>
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="">Select a user…</option>
              {(usersQ.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email} ({u.role})
                </option>
              ))}
            </select>
            <span className="form-field__hint mt-1 block text-xs text-slate-500">
              MCP writes made with this token are audit-logged as this user.
            </span>
          </label>

          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              Scope
            </span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "full" | "read")}
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            >
              <option value="read">read — list/read tools only</option>
              <option value="full" disabled={selectedUser?.role === "demo"}>
                full — every tool, including writes
              </option>
            </select>
            <span className="form-field__hint mt-1 block text-xs text-slate-500">
              Demo users can only hold read tokens.
            </span>
          </label>

          <label className="form-field block">
            <span className="form-field__label mb-1 block text-sm font-medium text-slate-700">
              Label (optional)
            </span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="claude.ai connector, reporting agent, …"
              className="input-box w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            />
          </label>

          {m.isError ? (
            <p className="error-alert rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {(m.error as Error).message}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={m.isPending || !userId}
              className="toolbar-btn--primary rounded-md bg-brand-button px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {m.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TokenRevealModal({
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
            Copy the token now. You can reveal it again later from the Tokens
            table (each reveal is audit-logged).
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

function ToolCard({ tool }: { tool: ToolDescriptor }) {
  return (
    <article className="mcp-tool rounded-lg border border-slate-200 bg-white p-4">
      <header className="mcp-tool__header mb-2 flex items-baseline gap-2">
        <code className="mcp-tool__name font-mono text-sm font-semibold text-slate-900">
          {tool.name}
        </code>
      </header>
      {tool.description ? (
        <p className="mcp-tool__description mb-3 text-sm text-slate-600">
          {tool.description}
        </p>
      ) : null}
      {tool.inputs.length > 0 ? (
        <table className="mcp-tool__inputs w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 pr-3 font-medium">Name</th>
              <th className="py-1 pr-3 font-medium">Type</th>
              <th className="py-1 font-medium">Required</th>
            </tr>
          </thead>
          <tbody>
            {tool.inputs.map((f) => (
              <tr key={f.name} className="border-t border-slate-100">
                <td className="py-1 pr-3 font-mono text-slate-900">{f.name}</td>
                <td className="py-1 pr-3 font-mono text-slate-700">{f.type}</td>
                <td className="py-1 text-slate-600">
                  {f.optional ? "—" : "yes"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mcp-tool__no-inputs text-xs text-slate-500">
          No parameters.
        </p>
      )}
    </article>
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
    <section className="mcp-tab__section mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mcp-tab__section-title mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </h3>
      <div className="mcp-tab__section-body space-y-2">{children}</div>
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
    <div className="mcp-tab__def grid grid-cols-[8rem_1fr] items-baseline gap-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-sm text-slate-700">{children}</dd>
    </div>
  );
}
