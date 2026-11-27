// The header of the creative/asset dialog follows the draft editor's
// (Robi, 2026-11-27): `‹ ● MC130a › 2/2 [n5 n6]`. A status dot before the
// title instead of an Active/Archived badge; the MC number and variant as the
// title, the file name only in the File row; the file versions as segments
// labelled by the file name's `_nN` token, like the draft variants' A B C. The
// version field reads "Released version" (REBUILD_SPEC §21).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreativeDetailDialog from "@/app/(app)/creative-library/CreativeDetailDialog";
import AssetDetailDialog from "@/app/(app)/assets/AssetDetailDialog";
import { click, heldFetch, mount } from "./dom";

type Creative = Parameters<typeof CreativeDetailDialog>[0]["creative"];
type Asset = Parameters<typeof AssetDetailDialog>[0]["asset"];

const N5 = "ERSTE_SZK_MC130_a_fuggoagy_videoAndColor_n5_1080x1080.mp4";
const N6 = "ERSTE_SZK_MC130_a_fuggoagy_videoAndColor_n6_1080x1080.mp4";

function creative(over: Partial<Creative> = {}): Creative {
  return {
    id: 1,
    brand: "ERSTE",
    product: "SZK",
    type: "video",
    template: null,
    bannerVersion: null,
    visualKeyword: null,
    copyKeyword: null,
    mcNumber: 130,
    mcVariant: "a",
    fileId: null,
    fileName: N6,
    fileFormat: "video/mp4",
    fileSize: null,
    fileDimensions: "1080x1080",
    comment: null,
    driveFolderId: null,
    driveFolderName: null,
    driveFileId: null,
    version: 1,
    createdAt: "2026-11-26 23:33:11",
    archivedAt: null,
    ...over,
  };
}

let qc: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", heldFetch().fn);
  qc = new QueryClient();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// As the Creative Library opens it: the family's latest file, the list of
// family representatives, and the family oldest → newest.
function openCreative(c: Creative, versions: Creative[] = [c]) {
  return mount(
    <QueryClientProvider client={qc}>
      <CreativeDetailDialog
        creative={c}
        creatives={[c]}
        versions={versions}
        filesById={new Map()}
        onJump={() => {}}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

const headerEl = () => document.querySelector<HTMLElement>(".media-entity-dialog__header")!;
const title = () => document.querySelector<HTMLElement>(".media-entity-dialog__title")!;
const dot = () => headerEl().querySelector<HTMLElement>(".status-dot");
const segments = () => [
  ...headerEl().querySelectorAll<HTMLButtonElement>(".media-entity-dialog__versions .tab-bar__tab"),
];
const fileRow = () => {
  const dts = [...document.querySelectorAll(".media-entity-dialog__file-info dt")];
  return dts.find((dt) => dt.textContent === "File")!.nextElementSibling!.textContent;
};
const fieldLabels = () =>
  [...document.querySelectorAll(".form-field__label")].map((l) => l.textContent);

describe("creative dialog header", () => {
  it("titles the header with the MC number and variant; the file name stays in the File row", () => {
    openCreative(creative());
    expect(title().textContent).toBe("MC130a");
    expect(headerEl().textContent).not.toContain(N6);
    expect(fileRow()).toBe(N6);
  });

  it("falls back to the file name when the creative has no MC number", () => {
    openCreative(creative({ mcNumber: null, mcVariant: null }));
    expect(title().textContent).toBe(N6);
  });

  it("shows the state as a status dot before the title, not as a badge", () => {
    openCreative(creative());
    const d = dot();
    expect(d).not.toBeNull();
    expect(d!.classList.contains("status-dot--active")).toBe(true);
    expect(d!.getAttribute("title")).toBe("Active");
    // Before the MC label, as in the draft editor.
    expect(d!.compareDocumentPosition(title()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headerEl().querySelector(".status-badge")).toBeNull();
  });

  it("an archived creative's dot is the inactive grey", () => {
    openCreative(creative({ archivedAt: "2026-11-27 08:00:00" }));
    expect(dot()!.classList.contains("status-dot--inactive")).toBe(true);
    expect(dot()!.getAttribute("title")).toBe("Archived");
  });

  it("offers the versions as n-labelled segments from the file name, and opens the one clicked", () => {
    // bannerVersion holds "5"/"6" by hand; the label comes from the file
    // name's _nN, the token the family is ordered by.
    const n5 = creative({ id: 1, fileName: N5, bannerVersion: "5" });
    const n6 = creative({ id: 2, fileName: N6, bannerVersion: "6" });
    openCreative(n6, [n5, n6]);

    expect(headerEl().querySelector(".nav-stepper")).toBeNull();
    expect(segments().map((s) => s.textContent)).toEqual(["n5", "n6"]);
    expect(segments()[1]!.classList.contains("tab-bar__tab--active")).toBe(true);
    expect(segments()[0]!.classList.contains("tab-bar__tab--active")).toBe(false);

    click(segments()[0]!);
    expect(fileRow()).toBe(N5);
    expect(segments()[0]!.classList.contains("tab-bar__tab--active")).toBe(true);
    expect(segments()[1]!.classList.contains("tab-bar__tab--active")).toBe(false);
  });

  it("shows the single version too, so the header still says which one it is", () => {
    openCreative(creative({ fileName: "ERSTE_SZK_MC130_a_fuggoagy_1080x1080.mp4" }));
    expect(segments().map((s) => s.textContent)).toEqual(["n1"]);
  });

  it("labels the version field Released version", () => {
    openCreative(creative());
    expect(fieldLabels()).toContain("Released version");
    expect(fieldLabels()).not.toContain("Banner version");
  });
});

describe("asset dialog header", () => {
  it("shows the state as a status dot before the file name, not as a badge", () => {
    const a: Asset = {
      id: 1,
      brand: "One",
      product: null,
      type: null,
      visualKeyword: null,
      fileId: null,
      fileName: "one.png",
      fileFormat: null,
      fileSize: null,
      fileDimensions: null,
      comment: null,
      version: 1,
      createdAt: "2026-11-26 09:00:00",
      archivedAt: null,
    };
    mount(
      <QueryClientProvider client={qc}>
        <AssetDetailDialog asset={a} assets={[a]} file={undefined} onJump={() => {}} onClose={() => {}} />
      </QueryClientProvider>,
    );
    expect(title().textContent).toBe("one.png");
    expect(dot()!.classList.contains("status-dot--active")).toBe(true);
    expect(dot()!.compareDocumentPosition(title()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headerEl().querySelector(".status-badge")).toBeNull();
  });
});
