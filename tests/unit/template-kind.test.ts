import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { _setTemplatesRootForTests, readTemplate } from "@/lib/templates";

// Builds a one-off templates root with hand-crafted manifest fixtures so
// `readTemplate` can be exercised without colliding with the real
// `templates/` folder in the repo.

let root: string;
let prevEnv: string | undefined;

function writeTemplate(
  name: string,
  files: Record<string, string | Buffer>,
): void {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, filename), content);
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mm6-tmpl-"));
  prevEnv = process.env.TEMPLATES_ROOT;
  _setTemplatesRootForTests(root);
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.TEMPLATES_ROOT;
  else process.env.TEMPLATES_ROOT = prevEnv;
  rmSync(root, { recursive: true, force: true });
});

describe("readTemplate — kind parsing", () => {
  it("defaults to kind=html when manifest.kind is absent", () => {
    writeTemplate("legacy", {
      "manifest.json": JSON.stringify({ title: "Legacy" }),
      "template.json": JSON.stringify({ placeholders: {} }),
      "300x250.css": "/* */",
    });
    const t = readTemplate("legacy");
    expect(t).not.toBeNull();
    expect(t!.kind).toBe("html");
    expect(t!.sizes).toEqual(["300x250"]); // sizes still discovered
    expect(t!.previewFile).toBeNull(); // html kind doesn't auto-discover
  });

  it("parses explicit kind=html the same as absent", () => {
    writeTemplate("explicit-html", {
      "manifest.json": JSON.stringify({ kind: "html" }),
      "template.json": JSON.stringify({ placeholders: {} }),
      "300x250.css": "/* */",
      "preview.png": "fake",
    });
    const t = readTemplate("explicit-html");
    expect(t!.kind).toBe("html");
    // html kind doesn't auto-discover preview — iframe is the preview.
    expect(t!.previewFile).toBeNull();
  });

  it("parses kind=figma with figma_url + auto-discovers preview.png", () => {
    writeTemplate("figma-x", {
      "manifest.json": JSON.stringify({
        kind: "figma",
        figma_url: "https://figma.com/file/abc",
        description: "Figma test",
      }),
      "preview.png": "fake",
    });
    const t = readTemplate("figma-x");
    expect(t!.kind).toBe("figma");
    expect(t!.externalUrl).toBe("https://figma.com/file/abc");
    expect(t!.previewFile).toBe("preview.png");
    expect(t!.description).toBe("Figma test");
    // Non-html kind: no sizes, no placeholders.
    expect(t!.sizes).toEqual([]);
    expect(t!.placeholders).toEqual([]);
  });

  it("parses kind=adobe + manifest.preview override + drops figma_url", () => {
    writeTemplate("adobe-x", {
      "manifest.json": JSON.stringify({
        kind: "adobe",
        preview: "ref.jpg",
        // figma_url should be ignored for non-figma kind
        figma_url: "https://should-be-ignored",
      }),
      "ref.jpg": "fake",
    });
    const t = readTemplate("adobe-x");
    expect(t!.kind).toBe("adobe");
    expect(t!.previewFile).toBe("ref.jpg");
    expect(t!.externalUrl).toBeNull(); // not figma → ignored
  });

  it("parses kind=after_effects, auto-discovers .webp preview", () => {
    writeTemplate("ae-x", {
      "manifest.json": JSON.stringify({ kind: "after_effects" }),
      "preview.webp": "fake",
    });
    const t = readTemplate("ae-x");
    expect(t!.kind).toBe("after_effects");
    expect(t!.previewFile).toBe("preview.webp");
  });

  it("unknown kind string falls back to html (forward-compat)", () => {
    writeTemplate("future", {
      "manifest.json": JSON.stringify({ kind: "lottie" }),
      "300x250.css": "/* */",
    });
    const t = readTemplate("future");
    expect(t!.kind).toBe("html");
  });

  it("missing manifest defaults to html (back-compat with pre-D1 templates)", () => {
    writeTemplate("no-manifest", {
      "template.json": JSON.stringify({ placeholders: {} }),
      "300x250.css": "/* */",
    });
    const t = readTemplate("no-manifest");
    expect(t!.kind).toBe("html");
    expect(t!.description).toBeNull();
    expect(t!.externalUrl).toBeNull();
  });

  it("returns null for non-existent template name", () => {
    expect(readTemplate("does-not-exist")).toBeNull();
  });
});
