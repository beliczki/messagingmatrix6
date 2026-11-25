import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/render";
import { listTemplateFiles, readTemplate, readTemplateFile } from "@/lib/templates";
import { cleanBundle, type BundleFiles } from "@/lib/html5-bundle";

// The AI label of the Erste "html" template (Robi, 2026-11-25). Expected values
// come from the Photoshop master and Robi's naming decision, not from the CSS:
//   - ERSTE_AI_Label in ERSTE_SZK_MC332_a_remarketing_n4.psd, 640x360 artboard:
//     29 x 29 px at X 597 / Y 15 → 15 px from the top, 14 px from the right,
//     layer opacity 50%.
//   - The class names the DISC colour: aiLabelWhite = white disc, black icon;
//     aiLabelBlack = black disc, white icon. Neither class = no label.

const TOKENS = ["aiLabelWhite", "aiLabelBlack"];

function render(classes: string | null, size = "640x360"): string {
  const message = { number: 332, variant: "a", headline: "H", templateVariantClasses: classes };
  return renderTemplate({ templateName: "html", size, message, inline: true }).html;
}

// One flat rule's declarations from the template's own main.css.
function rule(selector: string): Record<string, string> {
  const css = readTemplateFile("html", "main.css")!.toString("utf8");
  const esc = selector.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&").replace(/ /g, "\\s+");
  const m = css.match(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`no rule for ${selector}`);
  const out: Record<string, string> = {};
  for (const decl of m[1]!.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
  }
  return out;
}

describe("html template: AI label", () => {
  it("offers both tokens as selectable variant classes", () => {
    const t = readTemplate("html")!;
    for (const tok of TOKENS) expect(t.tagOptions).toContain(tok);
    // The existing vocabulary stays.
    expect(t.tagOptions).toEqual(expect.arrayContaining(["fullSurfaceImage", "topRoundedFrame", "animated"]));
  });

  it("puts the label inside #adContainer, next to the classes that switch it", () => {
    const html = render("fullSurfaceImage aiLabelWhite");
    expect(html).toContain('id="adContainer" class="template_variant_class fullSurfaceImage aiLabelWhite"');
    const container = html.slice(html.indexOf('id="adContainer"'), html.indexOf("<!-- extra css to finetune -->"));
    expect(container).toMatch(/<div id="aiLabel"[^>]*>\s*<svg [^>]*viewBox="0 0 500 500"/);
  });

  it("inlines the icon clean: no Illustrator stylesheet, class, id or URL", () => {
    const html = readTemplateFile("html", "index.html")!.toString("utf8");
    const start = html.indexOf('<div id="aiLabel"');
    expect(start).toBeGreaterThan(-1);
    const label = html.slice(start, html.indexOf("</svg>", start));
    expect(label).not.toMatch(/<style|st0|Layer_1|xmlns|https?:/);
    expect(label.match(/<path /g)).toHaveLength(4);
    expect(label.match(/<rect /g)).toHaveLength(1);
  });

  it("is hidden by default and sized and placed as in the PSD", () => {
    expect(rule("#aiLabel")).toMatchObject({
      display: "none",
      position: "absolute",
      top: "15px",
      right: "14px",
      width: "29px",
      height: "29px",
      "border-radius": "50%",
      opacity: "0.5",
    });
    expect(rule("#aiLabel svg")).toMatchObject({ fill: "currentColor" });
  });

  it("names the disc colour: white disc + black icon, black disc + white icon", () => {
    expect(rule(".aiLabelWhite #aiLabel")).toMatchObject({ display: "flex", background: "#fff", color: "#000" });
    expect(rule(".aiLabelBlack #aiLabel")).toMatchObject({ display: "flex", background: "#000", color: "#fff" });
  });

  it("survives the hand-off cleanup and adds no file to the bundle", () => {
    let html = render("aiLabelBlack", "300x250");
    html = html.replace(/<base\s+href="[^"]*\/api\/templates\/[^"]*">\s*/i, "");
    const files: BundleFiles = new Map();
    for (const f of listTemplateFiles("html")!) {
      if (f.size || ["index.html", "template.json", "main.css"].includes(f.name)) continue;
      files.set(f.name, readTemplateFile("html", f.name)!);
    }
    files.set("index.html", Buffer.from(html, "utf8"));
    const out = cleanBundle(files, "300x250", { variant: "a", title: "SZK_topic" });
    expect([...out.keys()].sort()).toEqual(
      ["EBH_Logo_screen_white.svg", "empty.png", "index.html", "manifest.json", "thm.json"],
    );
    expect(out.get("index.html")!.toString("utf8")).toContain('<div id="aiLabel"');
  });
});
