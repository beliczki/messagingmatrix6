// HTML5 creative packages: a .zip holding index.html plus its assets, uploaded
// to the Creative Library from any source (an mm6 bundle export, an Adform or
// DV360 bundle, an agency's HTML5). The package is fixed — the app plays it, it
// never renders into it — so whatever makes one package differ from another
// (its clickTag wiring, its fonts, its manifest) stays inside and runs as is.
//
// The zip in storage is the source of truth. Entries are extracted on first use
// into a local cache beside the thumbnails (`<clientKey>/.pkgs/v<N>/<fileId>/`),
// the way video stills are cut on first view: regenerable, so nothing about the
// extracted copy needs a schema or a storage prefix.
//
// Serving: a package's code is foreign, and every route here runs on the app's
// origin. `packageEntryHeaders` makes each entry a sandboxed document with
// scripts on but no same-origin access — it cannot read the parent page or call
// /api with the viewer's cookie, even when an entry URL is opened directly.
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { mimeByExt } from "./mime-by-ext";
import { parseCreativeFilename } from "./parse-creative-filename";
import { readFileBytes, resolveStoragePath } from "./storage";

/** Bump when the extraction rules change, so stale caches are a miss. */
const PKG_CACHE_VERSION = 1;

export type Html5PackageLimits = {
  maxEntries: number;
  maxTotalBytes: number;
};

// The upload itself is capped at 50 MB; a real banner unpacks to a few MB.
// These caps exist for the archive that claims to be small and inflates to
// gigabytes (a zip bomb), not for legitimate packages.
export const DEFAULT_LIMITS: Html5PackageLimits = {
  maxEntries: 2000,
  maxTotalBytes: 200 * 1024 * 1024,
};

export type Html5PackageErrorCode =
  | "not_a_zip"
  | "no_index"
  | "ambiguous_root"
  | "unsafe_path"
  | "too_many_entries"
  | "too_large";

export class Html5PackageError extends Error {
  constructor(
    readonly code: Html5PackageErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type SizeSource = "ad.size" | "manifest" | "filename";

export type Html5PackageInfo = {
  /** Entry paths relative to the package root (the folder holding index.html). */
  entries: string[];
  width: number | null;
  height: number | null;
  sizeSource: SizeSource | null;
  /** Sources that disagree with the one used — worth showing, not fatal. */
  warnings: string[];
};

// OS litter a zip tool adds on its own: never part of the creative.
function isJunk(entryPath: string): boolean {
  const base = path.posix.basename(entryPath);
  return (
    entryPath.startsWith("__MACOSX/") ||
    base === ".DS_Store" ||
    base === "Thumbs.db" ||
    base.startsWith("._")
  );
}

// An entry path is only usable if it stays inside the package once resolved.
// Zip paths are attacker-controlled: `../` or an absolute path would write (on
// extraction) or read (on serving) outside the package folder.
function safeEntryPath(raw: string): string | null {
  const p = raw.replace(/\\/g, "/");
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return null;
  const norm = path.posix.normalize(p);
  if (norm === ".." || norm.startsWith("../") || norm.includes("/../")) return null;
  return norm;
}

async function readEntry(
  file: JSZip.JSZipObject,
  budget: { left: number },
): Promise<Buffer> {
  // Counted while inflating: the size an entry CLAIMS is part of what a bomb
  // lies about, so only the bytes actually produced are trusted.
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = file.nodeStream("nodebuffer");
    stream.on("data", (chunk: Buffer) => {
      budget.left -= chunk.length;
      if (budget.left < 0) {
        (stream as unknown as { pause(): void }).pause();
        reject(
          new Html5PackageError("too_large", "The package unpacks to more than the size limit."),
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Open a package and return its files keyed by path relative to the package
 * root. The root is the zip's top level when index.html sits there, or the one
 * folder everything lives in when the zip was made by compressing a folder.
 */
export async function readHtml5Package(
  zipBytes: Buffer,
  limits: Html5PackageLimits = DEFAULT_LIMITS,
): Promise<Map<string, Buffer>> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipBytes);
  } catch {
    throw new Html5PackageError("not_a_zip", "The file is not a readable zip archive.");
  }

  const entries: { path: string; file: JSZip.JSZipObject }[] = [];
  for (const file of Object.values(zip.files)) {
    if (file.dir || isJunk(file.name)) continue;
    // JSZip quietly rewrites "../x" to "x" on load and keeps the name as written
    // in `unsafeOriginalName`. An archive that tries to climb out is refused,
    // not relocated — it was built to do something other than be a banner.
    const original = file.unsafeOriginalName ?? file.name;
    const safe = safeEntryPath(original);
    if (!safe || safe !== safeEntryPath(file.name)) {
      throw new Html5PackageError(
        "unsafe_path",
        `The package contains an entry outside its own folder: ${original}`,
      );
    }
    entries.push({ path: safe, file });
  }
  if (entries.length > limits.maxEntries) {
    throw new Html5PackageError(
      "too_many_entries",
      `The package has ${entries.length} files; the limit is ${limits.maxEntries}.`,
    );
  }

  let prefix = "";
  if (!entries.some((e) => e.path === "index.html")) {
    const tops = new Set(entries.map((e) => e.path.split("/")[0]));
    const [only] = [...tops];
    if (tops.size === 1 && only && entries.some((e) => e.path === `${only}/index.html`)) {
      prefix = `${only}/`;
    } else if (entries.some((e) => e.path.endsWith("/index.html"))) {
      throw new Html5PackageError(
        "ambiguous_root",
        "index.html is not at the top of the package or in its single top folder.",
      );
    } else {
      throw new Html5PackageError("no_index", "The package has no index.html.");
    }
  }

  const budget = { left: limits.maxTotalBytes };
  const out = new Map<string, Buffer>();
  for (const e of entries) {
    out.set(e.path.slice(prefix.length), await readEntry(e.file, budget));
  }
  return out;
}

function parseAdSize(html: string): { w: number; h: number } | null {
  const tag = html.match(/<meta\b[^>]*\bname\s*=\s*["']ad\.size["'][^>]*>/i)?.[0];
  if (!tag) return null;
  const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
  const w = Number(content.match(/width\s*=\s*(\d+)/i)?.[1]);
  const h = Number(content.match(/height\s*=\s*(\d+)/i)?.[1]);
  return w > 0 && h > 0 ? { w, h } : null;
}

function parseManifestSize(json: string): { w: number; h: number } | null {
  let m: { width?: unknown; height?: unknown };
  try {
    m = JSON.parse(json);
  } catch {
    return null;
  }
  // A template's manifest still carrying "{{ad.width}}" is not a size.
  const w = Number(m.width);
  const h = Number(m.height);
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 ? { w, h } : null;
}

/**
 * The package's native size. The package's own declaration wins — `ad.size` is
 * what the ad servers read, the manifest is what Adform reads — and the
 * filename's `_WxH` is the fallback every other creative already uses.
 */
export function detectPackageSize(
  files: Map<string, Buffer>,
  fileName: string,
): Pick<Html5PackageInfo, "width" | "height" | "sizeSource" | "warnings"> {
  const declared = parseCreativeFilename(fileName).declaredDimensions;
  const fromName = declared
    ? { w: Number(declared.split("x")[0]), h: Number(declared.split("x")[1]) }
    : null;
  const index = files.get("index.html");
  const manifest = files.get("manifest.json");
  const candidates: [SizeSource, { w: number; h: number } | null][] = [
    ["ad.size", index ? parseAdSize(index.toString("utf8")) : null],
    ["manifest", manifest ? parseManifestSize(manifest.toString("utf8")) : null],
    ["filename", fromName],
  ];
  const found = candidates.filter(
    (c): c is [SizeSource, { w: number; h: number }] => c[1] !== null,
  );
  const [first] = found;
  if (!first) return { width: null, height: null, sizeSource: null, warnings: [] };
  const [source, size] = first;
  const warnings = found
    .slice(1)
    .filter(([, s]) => s.w !== size.w || s.h !== size.h)
    .map(([src, s]) => `${src} says ${s.w}x${s.h}, using ${source} ${size.w}x${size.h}`);
  return { width: size.w, height: size.h, sizeSource: source, warnings };
}

// The mime every stored package carries, whatever the uploader's browser said —
// defined beside creativeMediaKind so client components can read it too.
export { HTML5_PACKAGE_MIME } from "./creative-media-kind";
import { HTML5_PACKAGE_MIME } from "./creative-media-kind";

// Browsers disagree on a zip's type (Windows sends x-zip-compressed, a file host
// octet-stream), so the extension decides and the claimed type only backs it up.
const ZIP_MIMES = new Set(["application/zip", "application/x-zip-compressed", "application/x-zip"]);

/** A creative upload that is an HTML5 package — the one rule both upload paths ask. */
export function isHtml5PackageUpload(fileName: string, claimedMime: string | null): boolean {
  return path.extname(fileName).toLowerCase() === ".zip" || ZIP_MIMES.has(claimedMime ?? "");
}

/** Validate a package at upload time and say what it is. Throws Html5PackageError. */
export async function inspectHtml5Package(
  zipBytes: Buffer,
  fileName: string,
  limits: Html5PackageLimits = DEFAULT_LIMITS,
): Promise<Html5PackageInfo> {
  const files = await readHtml5Package(zipBytes, limits);
  return { entries: [...files.keys()].sort(), ...detectPackageSize(files, fileName) };
}

/**
 * Write a package's files under `dir`, atomically: into a sibling temp folder
 * first, then renamed into place, so a reader never sees half a package and two
 * concurrent extractions cannot interleave.
 */
export async function extractHtml5PackageTo(
  zipBytes: Buffer,
  dir: string,
  limits: Html5PackageLimits = DEFAULT_LIMITS,
): Promise<void> {
  const files = await readHtml5Package(zipBytes, limits);
  const tmp = `${dir}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  try {
    for (const [rel, bytes] of files) {
      const abs = path.join(tmp, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, bytes);
    }
    await fs.mkdir(path.dirname(dir), { recursive: true });
    try {
      await fs.rename(tmp, dir);
    } catch (e) {
      // Another request finished the same package first — theirs is as good.
      if ((e as NodeJS.ErrnoException).code !== "ENOTEMPTY" && (e as NodeJS.ErrnoException).code !== "EEXIST") {
        throw e;
      }
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export function packageCacheDir(clientKey: string, fileId: string): string {
  return resolveStoragePath(path.join(clientKey, ".pkgs", `v${PKG_CACHE_VERSION}`, fileId));
}

const inFlight = new Map<string, Promise<string>>();

/**
 * The extracted folder for an uploaded package, extracting it on first use.
 * Concurrent requests for one package share one extraction — a page load asks
 * for index.html and a dozen assets at once.
 */
export async function ensurePackageExtracted(
  clientKey: string,
  fileId: string,
  storagePath: string,
): Promise<string> {
  const dir = packageCacheDir(clientKey, fileId);
  try {
    await fs.access(path.join(dir, "index.html"));
    return dir;
  } catch {
    // not extracted yet
  }
  const key = `${clientKey}/${fileId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const job = (async () => {
    try {
      await extractHtml5PackageTo(await readFileBytes(storagePath), dir);
      return dir;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}

/**
 * The file a request path names inside an extracted package, or null when it
 * does not exist or would leave the package. An empty path is the package
 * itself — its index.html.
 */
export async function resolvePackageEntry(
  dir: string,
  relPath: string,
): Promise<string | null> {
  const safe = safeEntryPath(relPath === "" ? "index.html" : relPath);
  if (!safe) return null;
  const abs = path.join(dir, safe);
  if (!abs.startsWith(dir + path.sep)) return null;
  try {
    const st = await fs.stat(abs);
    return st.isFile() ? abs : null;
  } catch {
    return null;
  }
}

/**
 * Headers for one package entry. The sandbox keeps scripts and popups (a
 * clickTag opens the landing page) and withholds same-origin, so the package
 * runs in an opaque origin wherever it is opened. That origin makes the
 * package's own fetches and @font-face loads cross-origin, so entries answer
 * CORS for anyone — they are public within the share, or session-gated by the
 * route that serves them.
 */
export function packageEntryHeaders(relPath: string): Record<string, string> {
  return {
    "Content-Type": mimeByExt(relPath === "" ? "index.html" : relPath),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
    "Access-Control-Allow-Origin": "*",
  };
}
