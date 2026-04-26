import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  _setTemplatesRootForTests,
  createTemplate,
  listTemplateFiles,
  readTemplate,
  readTemplateFile,
  templateExists,
  writeTemplateFile,
} from "@/lib/templates";

let templatesRoot: string;

beforeEach(() => {
  templatesRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mm6-tpl-write-"));
  _setTemplatesRootForTests(templatesRoot);
});

afterEach(() => {
  fs.rmSync(templatesRoot, { recursive: true, force: true });
});

describe("template file write + create", () => {
  describe("listTemplateFiles", () => {
    it("returns null for unknown template", () => {
      expect(listTemplateFiles("nope")).toBeNull();
    });

    it("returns sorted file list with size + isText flags", () => {
      createTemplate("card");
      const files = listTemplateFiles("card")!;
      const names = files.map((f) => f.name);
      expect(names[0]).toBe("index.html");
      expect(names[1]).toBe("template.json");
      expect(names[2]).toBe("main.css");
      expect(names).toContain("300x250.css");
      const sizeFile = files.find((f) => f.name === "300x250.css")!;
      expect(sizeFile.size).toBe("300x250");
      expect(sizeFile.isText).toBe(true);
    });

    it("size CSS files sort by area", () => {
      createTemplate("card");
      writeTemplateFile("card", "640x360.css", ".s {}");
      writeTemplateFile("card", "300x600.css", ".s {}");
      const files = listTemplateFiles("card")!;
      const sizeNames = files.filter((f) => f.size).map((f) => f.name);
      expect(sizeNames).toEqual(["300x250.css", "300x600.css", "640x360.css"]);
    });

    it("ignores hidden files", () => {
      createTemplate("card");
      fs.writeFileSync(path.join(templatesRoot, "card", ".DS_Store"), "x");
      const files = listTemplateFiles("card")!;
      expect(files.find((f) => f.name === ".DS_Store")).toBeUndefined();
    });
  });

  describe("writeTemplateFile", () => {
    it("writes content and reports byte count", () => {
      createTemplate("card");
      const result = writeTemplateFile("card", "index.html", "<div>new</div>");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.bytes).toBe(14);
      const buf = readTemplateFile("card", "index.html")!;
      expect(buf.toString("utf8")).toBe("<div>new</div>");
    });

    it("rejects path traversal in file name", () => {
      createTemplate("card");
      const result = writeTemplateFile("card", "../escape.txt", "x");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid_path");
    });

    it("rejects writes to non-existent template", () => {
      const result = writeTemplateFile("ghost", "index.html", "x");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("no_template");
    });

    it("rejects path separators in file name", () => {
      createTemplate("card");
      const result = writeTemplateFile("card", "sub/index.html", "x");
      expect(result.ok).toBe(false);
    });
  });

  describe("createTemplate", () => {
    it("scaffolds index.html, main.css, 300x250.css, template.json", () => {
      const result = createTemplate("brand-new");
      expect(result.ok).toBe(true);
      expect(templateExists("brand-new")).toBe(true);
      const info = readTemplate("brand-new")!;
      expect(info.sizes).toEqual(["300x250"]);
      expect(info.defaultSize).toBe("300x250");
      expect(info.placeholders.length).toBeGreaterThan(0);
    });

    it("rejects duplicate template name", () => {
      createTemplate("dup");
      const second = createTemplate("dup");
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.reason).toBe("exists");
    });

    it("rejects invalid template names", () => {
      expect(createTemplate("../escape").ok).toBe(false);
      expect(createTemplate("with space").ok).toBe(false);
      expect(createTemplate(".hidden").ok).toBe(false);
      expect(createTemplate("").ok).toBe(false);
    });

    it("scaffold renders cleanly via the existing render pipeline", () => {
      createTemplate("renderable");
      const indexPath = path.join(templatesRoot, "renderable", "index.html");
      expect(fs.existsSync(indexPath)).toBe(true);
      const html = fs.readFileSync(indexPath, "utf8");
      expect(html).toContain("{{headline_text_1}}");
      expect(html).toContain("{{cta_text}}");
    });
  });

  describe("path safety", () => {
    it("rejects template name with path separator", () => {
      const result = writeTemplateFile("foo/bar", "index.html", "x");
      expect(result.ok).toBe(false);
    });

    it("rejects template name with .. component", () => {
      const result = writeTemplateFile("..", "index.html", "x");
      expect(result.ok).toBe(false);
    });
  });
});
