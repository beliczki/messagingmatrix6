import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { renderTemplate } from "@/lib/render";
import { _setTemplatesRootForTests } from "@/lib/templates";
import type { TextFormatting } from "@/db/schema";

let root: string;

function tpl(
  name: string,
  files: Record<string, string>,
  bindings: Record<string, unknown>,
) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [filename, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, filename), content);
  }
  fs.writeFileSync(
    path.join(dir, "template.json"),
    JSON.stringify({ default_size: "300x250", placeholders: bindings }),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mm6-render-"));
  _setTemplatesRootForTests(root);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("renderTemplate — placeholder substitution", () => {
  it("substitutes {{placeholders}} via binding-messagingmatrix (case-insensitive lookup)", () => {
    tpl(
      "card",
      {
        "index.html": `<div data-mc="{{advert_mc}}-{{advert_variant}}">{{headline}}</div>`,
        "300x250.css": ".x{}",
      },
      {
        advert_mc: { type: "var", default: "", "binding-messagingmatrix": "Number" },
        advert_variant: { type: "var", default: "", "binding-messagingmatrix": "Variant" },
        headline: {
          type: "text",
          default: "",
          "binding-messagingmatrix": "Headline",
        },
      },
    );
    const { html } = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { number: 282, variant: "a", headline: "Save big" },
    });
    expect(html).toContain('data-mc="282-a"');
    expect(html).toContain("Save big");
  });

  it("works with both v5 PascalCase (Headline) and v6 camelCase (headline) field names", () => {
    tpl(
      "card",
      { "index.html": "<h1>{{h}}</h1>", "300x250.css": "" },
      {
        h: { type: "text", default: "", "binding-messagingmatrix": "Headline" },
      },
    );
    const { html: a } = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { Headline: "v5 style" },
    });
    const { html: b } = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { headline: "v6 style" },
    });
    expect(a).toContain("v5 style");
    expect(b).toContain("v6 style");
  });

  it("empty binding falls back to default; missing field renders as empty string", () => {
    tpl(
      "card",
      {
        "index.html": `<a name="x" content="{{x}}"><b name="y" content="{{y}}"></b></a>`,
        "300x250.css": "",
      },
      {
        x: { type: "var", default: "use-this", "binding-messagingmatrix": "" },
        y: { type: "var", default: "", "binding-messagingmatrix": "PMMID" },
      },
    );
    const { html } = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: {},
    });
    expect(html).toContain('content="use-this"');
    expect(html).toContain('content=""');
  });

  it("unsubstituted placeholders are stripped (never visible to viewers)", () => {
    tpl(
      "card",
      { "index.html": "<p>{{nope}} hello</p>", "300x250.css": "" },
      {},
    );
    const { html } = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: {},
    });
    expect(html).toBe("<p> hello</p>");
  });

  it("image placeholder gets path-messagingmatrix prepended; absolute URLs left alone", () => {
    tpl(
      "card",
      { "index.html": `<img src="{{hero}}">`, "300x250.css": "" },
      {
        hero: {
          type: "image",
          default: "",
          "binding-messagingmatrix": "Image1",
          "path-messagingmatrix": "/api/files/",
        },
      },
    );
    expect(
      renderTemplate({
        templateName: "card",
        size: "300x250",
        message: { image1: "abc.jpg" },
      }).html,
    ).toContain('<img src="/api/files/abc.jpg">');
    expect(
      renderTemplate({
        templateName: "card",
        size: "300x250",
        message: { image1: "https://cdn.example.com/x.jpg" },
      }).html,
    ).toContain('<img src="https://cdn.example.com/x.jpg">');
  });
});

describe("renderTemplate — text-formatting application (Spec §3.6)", () => {
  function rule(
    overrides: Partial<TextFormatting>,
  ): TextFormatting {
    return {
      id: 1,
      clientId: 1,
      textOriginal: "",
      textFormatted: "",
      formattingScope: null,
      formattingMcScope: null,
      version: 1,
      createdAt: "now",
      updatedAt: "now",
      ...overrides,
    } as TextFormatting;
  }

  it("universal rule (empty scope) applies regardless of size or MC", () => {
    tpl(
      "card",
      {
        "index.html": `<p>{{headline}}</p>`,
        "300x250.css": "",
      },
      {
        headline: { type: "text", default: "", "binding-messagingmatrix": "Headline" },
      },
    );
    const { html } = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { number: 1, variant: "a", headline: "Save big" },
      textFormatting: [
        rule({ textOriginal: "Save big", textFormatted: "<em>Save</em> big" }),
      ],
    });
    expect(html).toContain("<em>Save</em> big");
  });

  it("size-scoped rule only applies on matching sizes", () => {
    tpl(
      "card",
      { "index.html": `<p>{{h}}</p>`, "300x250.css": "" },
      { h: { type: "text", default: "", "binding-messagingmatrix": "Headline" } },
    );
    const sizeRule = rule({
      textOriginal: "Save 25% today",
      textFormatted: "Save <strong>25%</strong> today",
      formattingScope: "300x250",
    });
    const a = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { number: 1, variant: "a", headline: "Save 25% today" },
      textFormatting: [sizeRule],
    });
    const b = renderTemplate({
      templateName: "card",
      size: "640x360",
      message: { number: 1, variant: "a", headline: "Save 25% today" },
      textFormatting: [sizeRule],
    });
    expect(a.html).toContain("Save <strong>25%</strong> today");
    expect(b.html).not.toContain("<strong>25%</strong>");
    expect(b.html).toContain("Save 25% today");
  });

  it("MC-scoped rule only applies to matching MC label", () => {
    tpl(
      "card",
      { "index.html": `<p>{{h}}</p>`, "300x250.css": "" },
      { h: { type: "text", default: "", "binding-messagingmatrix": "Headline" } },
    );
    const r = rule({
      textOriginal: "Get a loan today",
      textFormatted: "Get a <b>loan</b> today",
      formattingMcScope: "MC1b",
    });
    const matches = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { number: 1, variant: "b", headline: "Get a loan today" },
      textFormatting: [r],
    });
    const nope = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { number: 1, variant: "a", headline: "Get a loan today" },
      textFormatting: [r],
    });
    expect(matches.html).toContain("Get a <b>loan</b> today");
    expect(nope.html).not.toContain("<b>loan</b>");
  });

  it("rule matching a substring of the field value does NOT apply (exact match only)", () => {
    // Regression: rule created on a shorter copy ("Most Személyi Kölcsön")
    // must not leak <br>s into a longer copy that merely contains it.
    tpl(
      "card",
      { "index.html": `<p>{{h}}</p>`, "300x250.css": "" },
      { h: { type: "text", default: "", "binding-messagingmatrix": "Copy1" } },
    );
    const { html } = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: {
        number: 301,
        variant: "b",
        copy1: "Most Személyi Kölcsön adósság-rendezéshez",
      },
      textFormatting: [
        rule({
          textOriginal: "Most Személyi Kölcsön",
          textFormatted: "Most <br/>Személyi <br/>Kölcsön",
          formattingScope: "300x250,300x600",
        }),
      ],
    });
    expect(html).not.toContain("<br/>");
    expect(html).toContain("Most Személyi Kölcsön adósság-rendezéshez");
  });

  it("size-scoped rule wins over a universal rule for the same text", () => {
    tpl(
      "card",
      { "index.html": `<p>{{h}}</p>`, "300x250.css": "" },
      { h: { type: "text", default: "", "binding-messagingmatrix": "Headline" } },
    );
    const universal = rule({
      id: 1,
      textOriginal: "Big offer",
      textFormatted: "Big<br>offer",
    });
    const sized = rule({
      id: 2,
      textOriginal: "Big offer",
      textFormatted: "<b>Big</b> offer",
      formattingScope: "300x250",
    });
    const onScoped = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { number: 1, variant: "a", headline: "Big offer" },
      textFormatting: [universal, sized],
    });
    const offScoped = renderTemplate({
      templateName: "card",
      size: "640x360",
      message: { number: 1, variant: "a", headline: "Big offer" },
      textFormatting: [universal, sized],
    });
    expect(onScoped.html).toContain("<b>Big</b> offer");
    expect(offScoped.html).toContain("Big<br>offer");
  });
});

describe("renderTemplate — inline option", () => {
  it("inline=true embeds main.css + {size}.css into a <style> block before </head>", () => {
    tpl(
      "card",
      {
        "index.html": "<html><head></head><body>{{h}}</body></html>",
        "main.css": ".main{color:red}",
        "300x250.css": ".size{font-size:1rem}",
      },
      { h: { type: "text", default: "", "binding-messagingmatrix": "Headline" } },
    );
    const { html } = renderTemplate({
      templateName: "card",
      size: "300x250",
      message: { headline: "x" },
      inline: true,
    });
    expect(html).toContain("data-mm6-inline");
    expect(html).toContain(".main{color:red}");
    expect(html).toContain(".size{font-size:1rem}");
    expect(html.indexOf(".main{color:red}")).toBeLessThan(html.indexOf("</head>"));
  });
});
