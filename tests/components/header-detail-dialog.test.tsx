// The audience/topic dialog saves its row by itself, 400 ms after the last
// change, with If-Match. The rules (REBUILD_SPEC §6.3, §8.2): one save in
// flight; a 409 is terminal and only Reload leaves it; a response belongs to
// the row that sent it; a peer's newer row is adopted while the form is clean.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import HeaderDetailDialog from "@/app/(app)/matrix/HeaderDetailDialog";
import { AlertDialogProvider } from "@/app/(app)/_components/AlertDialog";
import { channelToAudience, type Audience } from "@/app/(app)/matrix/types";
import { advance, body, click, header, heldFetch, mount, typeInto } from "./dom";

function aud(over: Partial<Audience> = {}): Audience {
  return {
    id: 1,
    key: "aud-1",
    name: "One",
    product: null,
    orderIndex: 0,
    status: null,
    strategy: null,
    buyingPlatform: null,
    dataSource: null,
    targetingType: null,
    device: null,
    tag: null,
    comment: null,
    campaignName: null,
    campaignId: null,
    lineitemName: null,
    lineitemId: null,
    channel: null,
    version: 1,
    updatedAt: "",
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

function view(entity: Audience) {
  return (
    <QueryClientProvider client={qc}>
      <AlertDialogProvider>
        <HeaderDetailDialog
          kind="audience"
          entity={entity}
          messages={[]}
          allMessages={[]}
          templates={[]}
          onClose={() => {}}
          onDeleted={() => {}}
        />
      </AlertDialogProvider>
    </QueryClientProvider>
  );
}

// The saves only: the Status field asks for its keyword options too.
const saves = () => server.calls.filter((c) => c.url.startsWith("/api/audiences/"));
// The first editable input of the form is Name (the Key above it is read-only).
const nameInput = () =>
  document.querySelector<HTMLInputElement>(".matrix-header-form input:not([readonly])")!;
const reloadButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".conflict-bar button")].find(
    (b) => b.textContent === "Reload",
  );

describe("HeaderDetailDialog autosave", () => {
  it("does not resend over a peer's save after a 409, and Reload takes the stored row", async () => {
    mount(view(aud()));
    typeInto(nameInput(), "Mine");
    await advance(400);
    expect(saves()).toHaveLength(1);
    await saves()[0].respond(409, {
      error: "version_mismatch",
      currentVersion: 5,
      currentRow: aud({ name: "Peer", version: 5 }),
    });
    await advance(400);

    // Terminal: nothing goes out on the peer's version.
    expect(saves()).toHaveLength(1);
    expect(nameInput().value).toBe("Mine");
    const reload = reloadButton();
    expect(reload).toBeDefined();
    click(reload!);
    await advance(400);
    expect(nameInput().value).toBe("Peer");
    expect(saves()).toHaveLength(1);
  });

  it("with Autosave off, offers neither Save nor Cancel in a conflict: only Reload leaves it", async () => {
    mount(view(aud()));
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
    click(buttons().find((b) => b.textContent?.trim() === "Autosave")!);
    typeInto(nameInput(), "Mine");
    click(buttons().find((b) => b.textContent === "Save")!);
    await advance(0);
    expect(saves()).toHaveLength(1);
    await saves()[0].respond(409, {
      error: "version_mismatch",
      currentVersion: 5,
      currentRow: aud({ name: "Peer", version: 5 }),
    });

    expect(buttons().find((b) => b.textContent === "Save")!.disabled).toBe(true);
    expect(buttons().find((b) => b.textContent === "Cancel")!.disabled).toBe(true);
  });

  it("sends one save at a time, and what was typed meanwhile on the version it returned", async () => {
    const ui = mount(view(aud()));
    typeInto(nameInput(), "ab");
    await advance(400);
    typeInto(nameInput(), "abc");
    await advance(400);
    expect(saves()).toHaveLength(1);

    await saves()[0].respond(200, { audience: aud({ name: "ab", version: 2 }) });
    ui.rerender(view(aud({ name: "ab", version: 2 })));
    await advance(400);
    expect(saves()).toHaveLength(2);
    expect(body(saves()[1])).toEqual({ name: "abc" });
    expect(header(saves()[1], "If-Match")).toBe("2");
    expect(nameInput().value).toBe("abc");
  });

  it("adopts a peer's newer row while the form is clean, and sends nothing", async () => {
    const ui = mount(view(aud()));
    ui.rerender(view(aud({ name: "Peer", version: 3 })));
    await advance(400);
    expect(nameInput().value).toBe("Peer");
    expect(saves()).toHaveLength(0);
  });

  it("does not write the row left onto the next one when its save lands late", async () => {
    const ui = mount(view(aud()));
    typeInto(nameInput(), "One edited");
    await advance(400);
    ui.rerender(view(aud({ id: 2, key: "aud-2", name: "Two", version: 7 })));
    await saves()[0].respond(200, { audience: aud({ name: "One edited", version: 2 }) });
    await advance(400);

    expect(nameInput().value).toBe("Two");
    // Nothing was sent for the second row: it was not edited.
    expect(saves()).toHaveLength(1);
    typeInto(nameInput(), "Two edited");
    await advance(400);
    expect(saves()).toHaveLength(2);
    expect(saves()[1].url).toBe("/api/audiences/2");
    expect(header(saves()[1], "If-Match")).toBe("7");
    expect(body(saves()[1])).toEqual({ name: "Two edited" });
  });
});

// The audience axis also carries the Agentic channels, as Audience-shaped rows
// (channelToAudience: the channel's own id, version 1). A channel lives in the
// channels table, and its id can be the id of an unrelated audience of the
// same client (MatrixGrid's headerDialog comment). Nothing the dialog does on
// a channel row may reach that audience.
describe("HeaderDetailDialog on a channel row", () => {
  const channelRow = () =>
    channelToAudience({ id: 7, key: "ch_disp", code: "DISP", label: "Display", orderIndex: 0, archivedAt: null });
  // The real audience that happens to have the channel's id.
  const audienceSeven = (over: Partial<Audience> = {}) =>
    aud({ id: 7, key: "aud-7", name: "Seven", version: 1, ...over });
  // Found by its label, read-only or not: a fix may make the form read-only.
  const nameField = () =>
    [...document.querySelectorAll<HTMLLabelElement>(".matrix-header-form label.form-field")]
      .find((l) => l.querySelector(".form-field__label")!.textContent === "Name")!
      .querySelector("input")!;
  const audienceWrites = () =>
    server.calls
      .filter((c) => c.url.startsWith("/api/audiences/"))
      .map((c) => `${c.init.method} ${c.url} If-Match:${header(c, "If-Match")}`);
  const deleteButton = () => document.querySelector(".matrix-header-dialog__delete");

  it("sends no edit of a channel row to /api/audiences/<channel id>", async () => {
    mount(view(channelRow()));
    typeInto(nameField(), "Display edited");
    await advance(400);
    expect(audienceWrites()).toEqual([]);
  });

  it("offers no Delete on a channel row, whatever an /api/audiences response says", async () => {
    mount(view(channelRow()));
    typeInto(nameField(), "Display edited");
    await advance(400);
    // If a save went out, answer it the way the route does when audience 7
    // exists at version 1: with that audience, which has no channel.
    for (const c of server.calls.filter((x) => x.url.startsWith("/api/audiences/"))) {
      await c.respond(200, { audience: audienceSeven({ name: "Display edited", version: 2 }) });
    }
    await advance(400);
    expect(deleteButton()).toBeNull();
  });

  it("treats channel 7 and audience 7 as two rows: the audience is shown, not the channel", async () => {
    const ui = mount(view(channelRow()));
    ui.rerender(view(audienceSeven()));
    await advance(400);
    expect(nameField().value).toBe("Seven");
  });
});
