// The HTTP surface, read off the source tree — what Settings → API renders.
//
// The LIST is generated, never typed by hand: a route that exists is in it,
// and a route that is deleted leaves it, with no one having to remember. That
// matters more here than anywhere else in the app, because the question this
// page exists to answer is "what can be called, and by whom", and a hand-kept
// list answers it confidently and wrongly.
//
// Auth is derived the same way — from markers in the file, not from a table
// somebody maintains. Only the one-line DESCRIPTIONS below are hand-written,
// because there is nothing to read them off: 4 of the ~100 handlers declare a
// zod schema, so unlike the MCP tools (which Settings → MCP can introspect in
// full) there is no machine-readable contract to render. A missing description
// leaves the route in the list with an em dash — the inventory stays complete
// either way.
import fs from "node:fs";
import path from "node:path";

export type ApiAuth =
  | "admin"
  | "session"
  | "bearer"
  | "signed"
  | "share-link"
  | "open";

export type ApiRoute = {
  /** URL path, route groups stripped: "/api/messages/[id]". */
  path: string;
  methods: string[];
  auth: ApiAuth;
  /** The marker the classification was read from — so the label can be checked. */
  authMarker: string;
  group: string;
  description: string;
  /** Repo-relative source file, for jumping to it. */
  file: string;
};

const METHOD_RE =
  /export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

// Ordered: the first marker that matches wins, so a route wrapped in withAdmin
// is reported as admin even though the wrapper it delegates to also mentions a
// session.
const AUTH_MARKERS: Array<{
  auth: ApiAuth;
  marker: string;
  re: RegExp;
}> = [
  { auth: "admin", marker: "withAdmin", re: /\bwithAdmin\b/ },
  { auth: "session", marker: "withSession", re: /\bwithSession\b/ },
  {
    auth: "session",
    marker: "entity-route factory",
    re: /\bmake(?:Collection|Item|Restore|Duplicate|Rekey|HardDelete|History)[A-Za-z]*Route\b/,
  },
  { auth: "session", marker: "readSession", re: /\breadSession\b/ },
  { auth: "bearer", marker: "resolveBearerClient", re: /\bresolveBearerClient\b/ },
  { auth: "signed", marker: "verifyToken", re: /\bverifyToken\b/ },
  {
    auth: "share-link",
    marker: "share gallery lookup",
    re: /\bshareGalleries\b/,
  },
];

function appRoot(): string {
  return path.resolve(process.cwd(), "src", "app");
}

/** `src/app/api/messages/[id]/route.ts` -> `/api/messages/[id]` */
function urlPathOf(relDir: string): string {
  const segs = relDir
    .split(path.sep)
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")));
  return "/" + segs.join("/");
}

function groupOf(urlPath: string): string {
  const segs = urlPath.split("/").filter(Boolean);
  if (segs[0] === "api") return segs[1] ?? "api";
  return segs[0] ?? "/";
}

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name === "route.ts" || e.name === "route.tsx") out.push(full);
  }
}

export function scanApiRoutes(): ApiRoute[] {
  const root = appRoot();
  const files: string[] = [];
  walk(root, files);

  const routes: ApiRoute[] = files.map((file) => {
    const src = fs.readFileSync(file, "utf8");
    const methods = [...src.matchAll(METHOD_RE)].map((m) => m[1]!);
    const hit = AUTH_MARKERS.find((m) => m.re.test(src));
    const urlPath = urlPathOf(path.relative(root, path.dirname(file)));
    return {
      path: urlPath,
      methods: [...new Set(methods)],
      auth: hit?.auth ?? "open",
      authMarker: hit?.marker ?? "no marker found",
      group: groupOf(urlPath),
      description: DESCRIPTIONS[urlPath] ?? "",
      file: path.relative(process.cwd(), file),
    };
  });

  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}

// One line per route: what it is for, not how it is implemented. Keyed by the
// generated path, so a typo here shows up as a missing description rather than
// as a phantom route.
export const DESCRIPTIONS: Record<string, string> = {
  "/api/adform-snapshots": "Uploaded AdForm banner snapshots — stored in feed_exports with source='adform_snapshot'.",
  "/api/assets": "Shared image/video assets: list and create.",
  "/api/assets/[id]": "One asset: read, update, archive.",
  "/api/assets/[id]/restore": "Un-archive an asset.",
  "/api/audiences": "Matrix audience columns (DCO axis): list and create.",
  "/api/audiences/[id]": "One audience: read, update, archive.",
  "/api/audiences/[id]/duplicate": "Copy an audience column with a new key.",
  "/api/audiences/[id]/hard-delete": "Delete an audience for good — only when nothing is placed in it.",
  "/api/audiences/[id]/history": "Revision history of one audience, from the audit log's before/after snapshots.",
  "/api/audiences/[id]/rekey": "Change an audience key and repoint every message that used it.",
  "/api/audiences/[id]/restore": "Un-archive an audience.",
  "/api/audiences/reorder": "Drag-drop reorder of the audience axis from matrix edit mode.",
  "/api/audit-log": "The write log: who changed what, with the before/after snapshot.",
  "/api/auth/login": "Sign in; sets the session cookie. The only write that needs no session.",
  "/api/auth/logout": "Clear the session cookie.",
  "/api/auth/me": "The current user and the client this deploy is pinned to.",
  "/api/channels": "Agentic channel columns (Display, Social, PRG, GSN, GNW, YT): list and create.",
  "/api/channels/[id]": "One channel: read, update, archive.",
  "/api/clients": "Tenants: list and create. Admin only.",
  "/api/clients/[id]": "One client: read, update, archive. Admin only.",
  "/api/config": "Per-client settings (branding, parsing rules, feature flags).",
  "/api/config-public": "Branding and client name WITHOUT a session — what /login paints itself with before anyone has signed in.",
  "/api/config/parsing-rules": "The creative-filename parsing rules for this client, falling back to defaults.",
  "/api/creatives": "Creative Library rows: list and create.",
  "/api/creatives/[id]": "One creative: read, update, archive.",
  "/api/creatives/[id]/restore": "Un-archive a creative.",
  "/api/creatives/by-mc": "The sibling creatives of one matrix cell — every size filed under the same MC number and variant.",
  "/api/creatives/drive-resolve": "Drive link health check: resolves the delivery folder of the ids the caller sends, in caller-sized batches.",
  "/api/dashboard/creatives": "Paging for the dashboard creative strip; the first page is rendered server-side.",
  "/api/drafts": "Briefed-but-unplaced cards — messages rows with no audience yet.",
  "/api/drafts/[id]": "Hard-delete one draft. A card that ever lived is archived instead, via /api/messages/[id].",
  "/api/drafts/[id]/promote": "Place one draft into a cell. The row is updated, not replaced, so its number and history survive.",
  "/api/drafts/promote": "Place several variants of one draft MC in a single call, optionally archiving the rest.",
  "/api/drive/proxy/[filename]": "Serves the bytes behind a v5-style filename reference (messages.image1..6 / video1).",
  "/api/events": "SSE stream of every write for this client — what makes one browser's change land in another's.",
  "/api/export/matrix-xlsx": "Filtered matrix export: per-product tabs plus Audiences / Topics / MCs sheets.",
  "/api/export/xlsx": "Full workbook export of the client's matrix data.",
  "/api/feed-exports": "Generated DCO feed files: list and create.",
  "/api/feed-exports/[id]": "One feed export: read and download.",
  "/api/feed-exports/[id]/mark-uploaded": "Record that this feed file was uploaded to AdForm — uploaded is not the same as exported.",
  "/api/files": "Uploaded files: list, with category and search filters.",
  "/api/files/[id]": "The file bytes, streamed with Range support so a video paints its first frame immediately.",
  "/api/files/[id]/restore": "Un-archive a file.",
  "/api/files/[id]/still": "Video still strip: the manifest, and one still per index — what the library's hover scrub plays.",
  "/api/files/[id]/thumbnail": "On-the-fly resize (80/200/400/800). A video's thumbnail is its first still.",
  "/api/files/upload": "Multipart upload into the object store; deduplicated by content hash.",
  "/api/import/xlsx": "Import a matrix workbook into this client.",
  "/api/keywords": "Curated keyword vocabulary (visual, copy, product): list and create.",
  "/api/keywords/[id]": "One keyword: read, update, archive.",
  "/api/keywords/[id]/restore": "Un-archive a keyword.",
  "/api/keywords/reorder": "Reorder the keyword list within a field.",
  "/api/mcp-tokens": "Per-user MCP bearer tokens. The raw token comes back only on create — the list is masked.",
  "/api/mcp-tokens/[id]": "Revoke a token by soft-archiving it; it 401s on its next request.",
  "/api/mcp-tokens/[id]/reveal": "Show a token again. POST, because every reveal is written to the audit log.",
  "/api/mcp/tools": "Inventory of the registered MCP tools with their zod input fields — what Settings → MCP renders.",
  "/api/messages": "MC rows: list and create. POST takes mc_number to claim a number, or \"new\" to force a fresh one.",
  "/api/messages/[id]": "One MC: read, update, archive.",
  "/api/messages/[id]/history": "Revision history of one MC, from the audit log's before/after snapshots.",
  "/api/messages/[id]/restore": "Un-archive an MC.",
  "/api/messages/bulk-copy": "Copy the selected cards into another cell — a fan-out is a copy, never a second home for one row.",
  "/api/messages/bulk-delete": "Archive (restorable) or purge (gone, audit entry only) the selected cards.",
  "/api/messages/bulk-move": "Move the selected cards to another audience or topic.",
  "/api/monitoring": "Imported AdForm reporting: the period list, and the rows of the period asked for.",
  "/api/monitoring/import": "Upload an AdForm Creative custom report XLSX; aggregates to message level and resolves each row to an MC.",
  "/api/monitoring/message-metrics": "Per-message impressions / cost / conversions for one report period.",
  "/api/monitoring/reapply-products": "Recompute the product column on already-imported rows from the current keyword rules — a rule, not row-by-row repair.",
  "/api/previews/[id]": "The rendered DCO preview PNG, for the app itself. Outside the app the signed /publicshortcut URL is the way in.",
  "/api/previews/generate": "Shoot missing or stale previews in headless Chromium; progress rides the SSE feed under its own entity name.",
  "/api/previews/status": "Which html MCs have an absent or stale size, and which sizes — the Creative Library warning reads this.",
  "/api/render": "Render one message's template at a size, for the editor's live preview.",
  "/api/render/public": "The same render for the share viewer, gated on the message being in that share's snapshot.",
  "/api/public-shortcut-secret": "The HMAC secret behind /publicshortcut, masked. Deploy-wide, not per client.",
  "/api/public-shortcut-secret/reveal": "Show the signing secret once. POST, because every reveal is written to the audit log.",
  "/api/public-shortcut-secret/rotate": "Replace the signing secret — this kills every signed link already handed out.",
  "/api/routes": "This inventory: every HTTP route in the deploy with its methods and how it is authenticated.",
  "/api/schema": "What the database actually holds, read from its own catalogs — and where that differs from db/schema.ts.",
  "/api/share-galleries": "Share links: list and create. Each freezes a snapshot of what it shows.",
  "/api/share-galleries/[id]": "One share: read, update, archive (archiving is what revokes the link).",
  "/api/share-galleries/[id]/restore": "Un-archive a share link.",
  "/api/snapshots": "Point-in-time snapshots of the client's matrix: list and create.",
  "/api/snapshots/[id]": "One snapshot: read, compare, archive.",
  "/api/snapshots/[id]/restore": "Un-archive a snapshot.",
  "/api/templates": "HTML creative templates visible to this client.",
  "/api/templates/[name]": "One template: its manifest, declared sizes and file list.",
  "/api/templates/[name]/[file]": "A single file out of a template (index.html, main.css, a size stylesheet).",
  "/api/templates/folders": "Every template on disk regardless of per-client visibility — what Settings → Design toggles.",
  "/api/text-formatting": "Text replacement rules applied at render time: list and create.",
  "/api/text-formatting/[id]": "One formatting rule: read, update, archive.",
  "/api/text-formatting/[id]/restore": "Un-archive a formatting rule.",
  "/api/topics": "Matrix topic rows: list and create.",
  "/api/topics/[id]": "One topic: read, update, archive.",
  "/api/topics/[id]/duplicate": "Copy a topic row with a new key.",
  "/api/topics/[id]/hard-delete": "Delete a topic for good — only when nothing is placed in it.",
  "/api/topics/[id]/history": "Revision history of one topic, from the audit log's before/after snapshots.",
  "/api/topics/[id]/rekey": "Change a topic key and repoint every message that used it.",
  "/api/topics/[id]/restore": "Un-archive a topic.",
  "/api/topics/reorder": "Drag-drop reorder of the topic axis; only DCO topics carry a real order.",
  "/api/users": "Per-client users: list and create. Admin only.",
  "/api/users/[id]": "One user: read, update, archive. Admin only.",
  "/api/users/[id]/restore": "Un-archive a user.",
  "/mcp": "The MCP endpoint itself. Authenticated by the bearer token inside the handler, not by a wrapper.",
  "/publicshortcut/[...parts]": "Signed public images: m<message_id>.<sig>/<size> for a DCO preview, c<creative_id>.<sig> for an agentic file. ?html=1 wraps it in a bare page.",
  "/share/[id]/comments": "Comments on a shared item. The share link is the credential; body length and rate are capped.",
  "/share/[id]/file/[fileId]": "File bytes for the share viewer, gated on the file being in that share's snapshot.",
  "/share/[id]/history": "Change history of one shared item, through the same door as the comments.",
  "/share/[id]/previews": "The share viewer's preview index — rows carry a ready signed URL, because the viewer holds no secret.",
};
