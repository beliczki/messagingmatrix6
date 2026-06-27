import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "@/db";
import { clients, config } from "@/db/schema";
import {
  _setTemplatesRootForTests,
  listAllTemplates,
  listTemplateFolders,
  listVisibleTemplates,
  readTemplate,
} from "@/lib/templates";
import { createTestDb, type TestDb } from "../../helpers/test-db";

let h: TestDb;
let templatesRoot: string;
let erste: { id: number };
let telekom: { id: number };

function makeTemplate(
  root: string,
  name: string,
  opts: { sizes: string[]; defaultSize?: string; placeholders?: Record<string, unknown> } = {
    sizes: ["300x250"],
  },
) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), `<div>${name}</div>`);
  for (const s of opts.sizes) {
    fs.writeFileSync(path.join(dir, `${s}.css`), `.size-${s} {}`);
  }
  fs.writeFileSync(
    path.join(dir, "template.json"),
    JSON.stringify({
      default_size: opts.defaultSize ?? opts.sizes[0],
      placeholders: opts.placeholders ?? {
        headline: { type: "text", default: "", "binding-messagingmatrix": "Headline" },
      },
    }),
  );
}

beforeEach(async () => {
  h = await createTestDb();
  templatesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm6-tpl-"));
  _setTemplatesRootForTests(templatesRoot);
  [erste] = await db
    .insert(clients)
    .values({ key: "erste", name: "Erste" })
    .returning();
  [telekom] = await db
    .insert(clients)
    .values({ key: "telekom", name: "Telekom" })
    .returning();
});

afterEach(async () => {
  await h.cleanup();
  fs.rmSync(templatesRoot, { recursive: true, force: true });
});

describe("template scanner", () => {
  it("listTemplateFolders returns sorted directory names; ignores hidden + files", () => {
    makeTemplate(templatesRoot, "html", { sizes: ["300x250"] });
    makeTemplate(templatesRoot, "alpha", { sizes: ["640x360"] });
    fs.mkdirSync(path.join(templatesRoot, ".thumbs"));
    fs.writeFileSync(path.join(templatesRoot, "stray-file.txt"), "x");
    expect(listTemplateFolders()).toEqual(["alpha", "html"]);
  });

  it("readTemplate parses sizes from {w}x{h}.css, default_size + placeholder bindings", () => {
    makeTemplate(templatesRoot, "card", {
      sizes: ["300x250", "300x600", "640x360"],
      defaultSize: "300x250",
      placeholders: {
        headline: {
          type: "text",
          default: "",
          "binding-messagingmatrix": "Headline",
        },
        cta: {
          type: "text",
          default: "Learn more",
          "binding-messagingmatrix": "CTA",
        },
      },
    });
    const t = readTemplate("card")!;
    expect(t.name).toBe("card");
    expect(t.sizes).toEqual(["300x250", "300x600", "640x360"]);
    expect(t.defaultSize).toBe("300x250");
    expect(t.placeholders).toHaveLength(2);
    expect(t.placeholders.find((p) => p.name === "headline")?.binding).toBe(
      "Headline",
    );
    expect(t.placeholders.find((p) => p.name === "cta")?.default).toBe(
      "Learn more",
    );
  });

  it("listAllTemplates returns every template on disk", () => {
    makeTemplate(templatesRoot, "a", { sizes: ["300x250"] });
    makeTemplate(templatesRoot, "b", { sizes: ["640x360"] });
    expect(listAllTemplates().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("listVisibleTemplates with no per-client config → all visible (sensible default for fresh clients)", async () => {
    makeTemplate(templatesRoot, "a", { sizes: ["300x250"] });
    makeTemplate(templatesRoot, "b", { sizes: ["300x250"] });
    expect((await listVisibleTemplates(erste.id)).map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("listVisibleTemplates respects config.visibleTemplates per client", async () => {
    makeTemplate(templatesRoot, "a", { sizes: ["300x250"] });
    makeTemplate(templatesRoot, "b", { sizes: ["300x250"] });
    await db.insert(config).values({
      clientId: erste.id,
      key: "visibleTemplates",
      value: JSON.stringify({ a: true, b: false }),
      category: "templates",
    });
    expect((await listVisibleTemplates(erste.id)).map((t) => t.name)).toEqual(["a"]);
    // Telekom has no config → still sees both.
    expect((await listVisibleTemplates(telekom.id)).map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("returns null for unknown template", () => {
    expect(readTemplate("does-not-exist")).toBeNull();
  });
});
