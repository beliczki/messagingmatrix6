// The Message Editor steps from card to card while a save of the card left is
// still out. Its response belongs to the card that sent it: it must not show
// on the card now open (REBUILD_SPEC §8.2; the conflict case already held).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MessageEditor from "@/app/(app)/matrix/MessageEditor";
import type { Message } from "@/app/(app)/matrix/types";
import { advance, click, heldFetch, mount, typeInto } from "./dom";

function msg(over: Partial<Message>): Message {
  return {
    id: 1,
    number: 1,
    variant: "a",
    audience: "k",
    topic: "t",
    status: null,
    name: null,
    headline: null,
    copy1: null,
    copy2: null,
    disclaimer: null,
    headlineStyle: null,
    copy1Style: null,
    copy2Style: null,
    disclaimerStyle: null,
    ctaStyle: null,
    customCss: null,
    template: null,
    templateVariantClasses: null,
    versionNo: 1,
    version: 1,
    pmmid: null,
    startDate: null,
    endDate: null,
    updatedAt: "",
    flash: null,
    flashStyle: null,
    cta: null,
    landingUrl: null,
    image1: null,
    image2: null,
    image3: null,
    image4: null,
    image5: null,
    image6: null,
    video1: null,
    utmCampaign: null,
    utmSource: null,
    utmMedium: null,
    utmContent: null,
    utmTerm: null,
    utmCd26: null,
    finalTraffickedUrl: null,
    archivedAt: null,
    brief: null,
    briefSlidesFileId: null,
    briefSlideId: null,
    draftProduct: null,
    draftTarget: null,
    ...over,
  };
}

const one = msg({ id: 1, headline: "One" });
const two = msg({ id: 2, variant: "b", headline: "Two" });

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

function view(open: Message) {
  return (
    <QueryClientProvider client={qc}>
      <MessageEditor
        open
        message={open}
        audiences={[]}
        topics={[]}
        visibleMessages={[one, two]}
        siblingCount={0}
        onClose={() => {}}
        onJump={() => {}}
      />
    </QueryClientProvider>
  );
}

const saves = () => server.calls.filter((c) => c.init.method === "PATCH");
const headline = () => document.querySelector<HTMLInputElement>(".formatted-field input")!;

// Edit card one, let its save go out, then step to card two.
async function stepWhileSaving() {
  const ui = mount(view(one));
  click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Content")!);
  typeInto(headline(), "One edited");
  await advance(400);
  expect(saves()).toHaveLength(1);
  expect(saves()[0].url).toBe("/api/messages/1");
  ui.rerender(view(two));
  expect(headline().value).toBe("Two");
}

describe("MessageEditor: a save of the card left", () => {
  it("does not show its failure on the card now open", async () => {
    await stepWhileSaving();
    await saves()[0].respond(500, { error: "boom" });
    expect(document.querySelector(".save-indicator--error")).toBeNull();
  });

  it("does not show 'Saved' on the card now open", async () => {
    await stepWhileSaving();
    await saves()[0].respond(200, { message: msg({ id: 1, headline: "One edited", version: 2 }) });
    expect(document.querySelector(".save-indicator--saved")).toBeNull();
  });
});
