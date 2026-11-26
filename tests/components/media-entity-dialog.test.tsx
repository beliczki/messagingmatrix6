// The asset/creative dialog (MediaEntityDialog, here through the asset one)
// saves its row by itself, 400 ms after the last change, with If-Match, and
// steps to the previous/next row. The rules (REBUILD_SPEC §6.4, §8.2): one
// save in flight; a 409 is terminal and only Reload leaves it; a response
// belongs to the row that sent it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AssetDetailDialog from "@/app/(app)/assets/AssetDetailDialog";
import { advance, body, click, header, heldFetch, mount, typeInto } from "./dom";

type Asset = Parameters<typeof AssetDetailDialog>[0]["asset"];

function asset(over: Partial<Asset> = {}): Asset {
  return {
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
    ...over,
  };
}

let server: ReturnType<typeof heldFetch>;
let qc: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  server = heldFetch();
  vi.stubGlobal("fetch", server.fn);
  qc = new QueryClient();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

function view(a: Asset, all: Asset[] = [a]) {
  return (
    <QueryClientProvider client={qc}>
      <AssetDetailDialog asset={a} assets={all} file={undefined} onJump={() => {}} onClose={() => {}} />
    </QueryClientProvider>
  );
}

const saves = () => server.calls.filter((c) => c.url.startsWith("/api/assets/"));
// The first input of the form is Brand.
const brandInput = () => document.querySelector<HTMLInputElement>(".media-entity-dialog .form-grid input")!;
const reloadButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".conflict-bar button")].find(
    (b) => b.textContent === "Reload",
  );

describe("MediaEntityDialog autosave", () => {
  it("shows a 409 as a conflict with Reload, resends nothing, and Reload takes the stored row", async () => {
    mount(view(asset()));
    typeInto(brandInput(), "Mine");
    await advance(400);
    expect(saves()).toHaveLength(1);
    // The server's 409 body (src/lib/optimistic.ts).
    await saves()[0].respond(409, {
      error: "version_mismatch",
      currentVersion: 4,
      currentRow: asset({ brand: "Peer", version: 4 }),
    });
    await advance(400);

    expect(document.querySelector(".save-indicator--conflict")).not.toBeNull();
    expect(saves()).toHaveLength(1);
    expect(brandInput().value).toBe("Mine");
    const reload = reloadButton();
    expect(reload).toBeDefined();
    click(reload!);
    await advance(400);
    expect(brandInput().value).toBe("Peer");
    expect(saves()).toHaveLength(1);
  });

  it("with Autosave off, offers neither Save nor Cancel in a conflict: only Reload leaves it", async () => {
    mount(view(asset()));
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
    click(buttons().find((b) => b.textContent?.trim() === "Autosave")!);
    typeInto(brandInput(), "Mine");
    click(buttons().find((b) => b.textContent === "Save")!);
    await advance(0);
    expect(saves()).toHaveLength(1);
    await saves()[0].respond(409, {
      error: "version_mismatch",
      currentVersion: 4,
      currentRow: asset({ brand: "Peer", version: 4 }),
    });

    expect(buttons().find((b) => b.textContent === "Save")!.disabled).toBe(true);
    expect(buttons().find((b) => b.textContent === "Cancel")!.disabled).toBe(true);
  });

  it("shows a 200 it cannot read as a failed save, and the next change sends again", async () => {
    mount(view(asset()));
    typeInto(brandInput(), "Mine");
    await advance(400);
    // No `asset` in the body: the saved row cannot be read out of it.
    await saves()[0].respond(200, {});
    await advance(400);

    expect(document.querySelector(".save-indicator--error")).not.toBeNull();
    typeInto(brandInput(), "Mine2");
    await advance(400);
    expect(saves()).toHaveLength(2);
  });

  it("sends one save at a time", async () => {
    mount(view(asset()));
    typeInto(brandInput(), "ab");
    await advance(400);
    typeInto(brandInput(), "abc");
    await advance(400);
    expect(saves()).toHaveLength(1);
  });

  it("does not write the row left onto the next one when its save lands after a step", async () => {
    const one = asset();
    const two = asset({ id: 2, brand: "Two", fileName: "two.png", version: 6 });
    const ui = mount(view(one, [one, two]));
    typeInto(brandInput(), "One edited");
    await advance(400);
    // Step to the next asset while that save is out.
    ui.rerender(view(two, [one, two]));
    await saves()[0].respond(200, { asset: asset({ brand: "One edited", version: 2 }) });
    await advance(400);

    expect(brandInput().value).toBe("Two");
    expect(saves()).toHaveLength(1);
    typeInto(brandInput(), "Two edited");
    await advance(400);
    expect(saves()).toHaveLength(2);
    expect(saves()[1].url).toBe("/api/assets/2");
    expect(header(saves()[1], "If-Match")).toBe("6");
    expect(body(saves()[1])).toEqual({ brand: "Two edited" });
  });
});
