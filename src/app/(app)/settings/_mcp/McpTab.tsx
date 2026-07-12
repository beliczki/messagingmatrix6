"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

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

const GROUP_ORDER: Array<{ key: string; label: string; match: (n: string) => boolean }> = [
  { key: "list", label: "List & read", match: (n) => n.startsWith("list_") || n === "matrix_status" || n.startsWith("get_") },
  { key: "audience", label: "Audiences", match: (n) => /audience/.test(n) && !n.startsWith("list_") && !n.startsWith("get_") },
  { key: "topic", label: "Topics", match: (n) => /topic/.test(n) && !n.startsWith("list_") && !n.startsWith("get_") },
  { key: "message", label: "Messages (MCs)", match: (n) => /(^|_)mc(_|$)|message/.test(n) && !n.startsWith("list_") && !n.startsWith("get_") && !/batch/.test(n) },
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
          Each client has its own bearer token, stored in{" "}
          <code className="font-mono text-xs">clients.mcp_token</code> and
          rotatable from{" "}
          <strong className="font-semibold">Settings → Clients</strong>. The
          deploy is pinned to one client via{" "}
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
          and accept the same MCP bearer (or an app session) on a plain HTTP
          GET — they are fetched outside the MCP protocol. Previews are
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
          <code className="font-mono text-xs">byUser = &quot;mcp:&lt;client_key&gt;&quot;</code>{" "}
          and emits an SSE event so connected UIs update live.
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
