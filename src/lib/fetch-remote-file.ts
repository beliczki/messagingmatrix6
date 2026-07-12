// SSRF-guarded, size-capped download — used by the MCP asset_upload tool's
// source_url transport. The server must never be steered into fetching its
// own internal services (MinIO on 127.0.0.1:9000, the DB tunnel, cloud
// metadata endpoints), so every hop's host is validated: protocol allowlist,
// private/loopback/link-local IP literals rejected, hostnames resolved via
// DNS and rejected if ANY address is private. Residual DNS TOCTOU (a record
// flipping between validation and connect) is accepted — the MCP bearer
// holder is the operator's own agent, not the public internet.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  // fc00::/7 (unique local) and fe80::/10 (link-local)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // v4-mapped (::ffff:10.0.0.1)
  const v4 = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return isPrivateV4(v4[1]!);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateV4(ip);
  if (family === 6) return isPrivateV6(ip);
  return true; // not an IP — caller resolves hostnames before calling this
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported protocol '${url.protocol}' — http(s) only`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip v6 brackets
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new Error(`refusing to fetch from private address ${host}`);
    }
    return;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error(`refusing to fetch from ${host}`);
  }
  const addrs = await lookup(host, { all: true });
  for (const { address } of addrs) {
    if (isPrivateAddress(address)) {
      throw new Error(
        `refusing to fetch from ${host} — resolves to private address ${address}`,
      );
    }
  }
}

export async function fetchRemoteFile(
  rawUrl: string,
  opts: { maxBytes: number },
): Promise<{ buffer: Buffer; contentType: string | null }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`invalid URL: ${rawUrl}`);
  }

  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);
    res = await fetch(url, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`redirect (${res.status}) without Location`);
      if (hop === MAX_REDIRECTS) throw new Error("too many redirects");
      url = new URL(location, url); // relative redirects resolve against current
      continue;
    }
    break;
  }
  if (!res!.ok) {
    throw new Error(`fetch failed: ${res!.status} ${res!.statusText}`);
  }

  const declared = res!.headers.get("content-length");
  if (declared && Number(declared) > opts.maxBytes) {
    throw new Error(
      `file too large: ${declared} bytes (max ${opts.maxBytes})`,
    );
  }

  // Stream with a hard cap — Content-Length can lie or be absent.
  const reader = res!.body?.getReader();
  if (!reader) throw new Error("empty response body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > opts.maxBytes) {
      await reader.cancel();
      throw new Error(`file too large: exceeds ${opts.maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return {
    buffer: Buffer.concat(chunks),
    contentType: res!.headers.get("content-type"),
  };
}
