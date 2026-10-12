import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  Html5PackageError,
  extractHtml5PackageTo,
  inspectHtml5Package,
  packageEntryHeaders,
  resolvePackageEntry,
} from "@/lib/html5-package";

const INDEX = `<!doctype html><html><head>
<meta name="ad.size" content="width=300,height=250">
</head><body><img src="img/bg.jpg"></body></html>`;

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof Html5PackageError ? e.code : `other:${(e as Error).message}`;
  }
  return "resolved";
}

describe("inspectHtml5Package — where the package root is", () => {
  it("takes index.html at the top of the zip", async () => {
    const info = await inspectHtml5Package(
      await zipOf({ "index.html": INDEX, "img/bg.jpg": "x" }),
      "pkg.zip",
    );
    expect(info.entries).toEqual(["img/bg.jpg", "index.html"]);
  });

  it("strips the one folder a compressed-folder zip wraps everything in", async () => {
    const info = await inspectHtml5Package(
      await zipOf({ "banner_300x250/index.html": INDEX, "banner_300x250/img/bg.jpg": "x" }),
      "pkg.zip",
    );
    expect(info.entries).toEqual(["img/bg.jpg", "index.html"]);
  });

  it("ignores the litter macOS and Windows add", async () => {
    const info = await inspectHtml5Package(
      await zipOf({
        "index.html": INDEX,
        "__MACOSX/._index.html": "x",
        ".DS_Store": "x",
        "img/Thumbs.db": "x",
      }),
      "pkg.zip",
    );
    expect(info.entries).toEqual(["index.html"]);
  });

  it("refuses a zip with no index.html", async () => {
    expect(await codeOf(inspectHtml5Package(await zipOf({ "a.html": INDEX }), "p.zip"))).toBe(
      "no_index",
    );
  });

  it("refuses index.html buried beside other top-level folders", async () => {
    const zip = await zipOf({ "a/index.html": INDEX, "b/other.js": "x" });
    expect(await codeOf(inspectHtml5Package(zip, "p.zip"))).toBe("ambiguous_root");
  });

  it("refuses something that is not a zip", async () => {
    expect(await codeOf(inspectHtml5Package(Buffer.from("not a zip"), "p.zip"))).toBe(
      "not_a_zip",
    );
  });
});

describe("inspectHtml5Package — hostile archives", () => {
  it("refuses an entry that climbs out of the package", async () => {
    const zip = await zipOf({ "index.html": INDEX, "../evil.js": "x" });
    expect(await codeOf(inspectHtml5Package(zip, "p.zip"))).toBe("unsafe_path");
  });

  it("refuses too many entries", async () => {
    const files: Record<string, string> = { "index.html": INDEX };
    for (let i = 0; i < 5; i++) files[`f${i}.js`] = "x";
    const zip = await zipOf(files);
    expect(
      await codeOf(inspectHtml5Package(zip, "p.zip", { maxEntries: 3, maxTotalBytes: 1e9 })),
    ).toBe("too_many_entries");
  });

  it("stops inflating once the unpacked bytes pass the cap (zip bomb)", async () => {
    // 2 MB of zeros deflates to a few KB — the shape of a bomb.
    const zip = await zipOf({ "index.html": INDEX, "pad.bin": Buffer.alloc(2 * 1024 * 1024) });
    expect(zip.length).toBeLessThan(64 * 1024);
    expect(
      await codeOf(inspectHtml5Package(zip, "p.zip", { maxEntries: 100, maxTotalBytes: 1024 * 1024 })),
    ).toBe("too_large");
  });
});

describe("inspectHtml5Package — native size", () => {
  it("prefers the package's own ad.size meta", async () => {
    const info = await inspectHtml5Package(await zipOf({ "index.html": INDEX }), "x_n1_970x250.zip");
    expect(info).toMatchObject({ width: 300, height: 250, sizeSource: "ad.size" });
    expect(info.warnings).toEqual(["filename says 970x250, using ad.size 300x250"]);
  });

  it("falls back to manifest.json, ignoring an unfilled template value", async () => {
    const noMeta = "<html><body></body></html>";
    const filled = await inspectHtml5Package(
      await zipOf({ "index.html": noMeta, "manifest.json": '{"width":970,"height":250}' }),
      "p.zip",
    );
    expect(filled).toMatchObject({ width: 970, height: 250, sizeSource: "manifest" });
    const unfilled = await inspectHtml5Package(
      await zipOf({ "index.html": noMeta, "manifest.json": '{"width":"{{ad.width}}"}' }),
      "ERSTE_SZA_MC411_b_x_html5_n1_640x360.zip",
    );
    expect(unfilled).toMatchObject({ width: 640, height: 360, sizeSource: "filename" });
  });

  it("reports no size when nothing declares one", async () => {
    const info = await inspectHtml5Package(await zipOf({ "index.html": "<html></html>" }), "p.zip");
    expect(info).toMatchObject({ width: null, height: null, sizeSource: null });
  });
});

describe("extraction and entry resolution", () => {
  let tmp: string | null = null;
  afterEach(async () => {
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it("extracts under the package root and resolves only paths inside it", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mm6-pkg-"));
    const dir = path.join(tmp, "pkg");
    await extractHtml5PackageTo(
      await zipOf({ "wrap/index.html": INDEX, "wrap/img/bg.jpg": "jpg" }),
      dir,
    );
    expect(await fs.readFile(path.join(dir, "img/bg.jpg"), "utf8")).toBe("jpg");
    expect(await resolvePackageEntry(dir, "")).toBe(path.join(dir, "index.html"));
    expect(await resolvePackageEntry(dir, "img/bg.jpg")).toBe(path.join(dir, "img/bg.jpg"));
    expect(await resolvePackageEntry(dir, "img/missing.jpg")).toBeNull();
    expect(await resolvePackageEntry(dir, "../pkg/index.html")).toBeNull();
    expect(await resolvePackageEntry(dir, "img")).toBeNull();
    // No temp folder left behind.
    expect((await fs.readdir(tmp)).sort()).toEqual(["pkg"]);
  });

  it("lets a second extraction of the same package lose quietly", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mm6-pkg-"));
    const dir = path.join(tmp, "pkg");
    const zip = await zipOf({ "index.html": INDEX });
    await Promise.all([extractHtml5PackageTo(zip, dir), extractHtml5PackageTo(zip, dir)]);
    expect((await fs.readdir(tmp)).sort()).toEqual(["pkg"]);
  });
});

describe("packageEntryHeaders", () => {
  it("runs entries scripted but without same-origin, typed by extension", () => {
    expect(packageEntryHeaders("")).toEqual({
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
      "Access-Control-Allow-Origin": "*",
    });
    expect(packageEntryHeaders("fonts/a.woff2")["Content-Type"]).toBe("font/woff2");
  });
});
