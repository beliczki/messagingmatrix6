import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/render";
import { listTemplateFiles, readTemplateFile } from "@/lib/templates";
import {
  ADFORM_LOADER,
  bundleableTemplate,
  cleanBundle,
  packageZipName,
  type BundleFiles,
} from "@/lib/html5-bundle";

// renderBundle without the storage step: the "html" template rendered for a
// message whose images are template files, so no proxied bytes are needed.
function rendered(message: Record<string, unknown>, size = "300x250"): BundleFiles {
  let { html } = renderTemplate({ templateName: "html", size, message, inline: true });
  html = html.replace(/<base\s+href="[^"]*\/api\/templates\/[^"]*">\s*/i, "");
  const files: BundleFiles = new Map();
  for (const f of listTemplateFiles("html")!) {
    if (f.size || ["index.html", "template.json", "main.css"].includes(f.name)) continue;
    files.set(f.name, readTemplateFile("html", f.name)!);
  }
  files.set("index.html", Buffer.from(html, "utf8"));
  return files;
}

const base = { number: 235, variant: "a", headline: "H", pmmid: "p_x-a_HK_wlav-m_235" };

describe("cleanBundle", () => {
  it("loads the Adform library, keeps THM, drops the feed layer and the video slot", () => {
    const out = cleanBundle(rendered({ ...base, finalTraffickedUrl: "https://erstebank.hu/hk?utm=1" }), "300x250", {
      variant: "a",
      title: "HK_topic",
    });
    const html = out.get("index.html")!.toString("utf8");
    expect(html).toContain(ADFORM_LOADER);
    expect(html).not.toContain("UNCOMMENT THESE FOR ADFORM UPLOAD");
    expect(html).not.toMatch(/dynamic\.content\.js|DynAdsHelper-|id="videoWrapper"/);
    // THM layer, loading included.
    expect(html).toContain("fetch('thm.json')");
    expect(html).toContain("PHASE 5: THM LOGIC");
    expect(html).toContain("shouldUpdateThm(pmmid)");
    expect(out.has("thm.json")).toBe(true);
    expect(out.has("dynamic.content.js")).toBe(false);
    expect(out.has("emptyvideo.mp4")).toBe(false);
    // The MC's own landing is the click URL, in the page and the manifest.
    expect(html).toContain('<meta name="click_url" content="https://erstebank.hu/hk?utm=1">');
    const manifest = JSON.parse(out.get("manifest.json")!.toString("utf8"));
    expect(manifest).toMatchObject({
      title: "HK_topic",
      description: "MC235a 300x250",
      width: 300,
      height: 250,
      clicktags: { clickTAG: "https://erstebank.hu/hk?utm=1" },
    });
  });

  it("falls back to the template manifest's clickTAG when the MC has no landing URL", () => {
    const out = cleanBundle(rendered(base), "300x250", { variant: "b", title: "t" });
    const html = out.get("index.html")!.toString("utf8");
    expect(html).toContain('<meta name="click_url" content="https://erstebank.hu/">');
    expect(html).toContain('<meta name="advert_variant" content="b">');
  });

  it("refuses a page that is not the template it knows", () => {
    const files: BundleFiles = new Map([
      ["index.html", Buffer.from("<html><head></head></html>")],
      ["manifest.json", Buffer.from("{}")],
    ]);
    expect(() => cleanBundle(files, "300x250", { variant: "a", title: "t" })).toThrow(/Adform script block/);
  });
});

describe("bundleableTemplate / packageZipName", () => {
  it("knows the html template and names zips the library's way", () => {
    expect(bundleableTemplate("html")).toBe(true);
    expect(bundleableTemplate(null)).toBe(false);
    expect(
      packageZipName({ brand: "ERSTE", product: "HK", number: 235, variant: "a", topic: "HK_NA_edukacio", n: 2, size: "300x250" }),
    ).toBe("ERSTE_HK_MC235_a_edukacio_html5_n2_300x250.zip");
  });
});
