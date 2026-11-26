// A stored text-formatting rule under a field of the Message Editor saves
// itself 400 ms after the last keystroke. Robi, 2026-11-26: "a texformatting
// is elugrál nekem gépelés közben a sor végére" — the caret jumps to the end
// of the line while typing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  TextFieldWithFormatting,
  TextFormattingRuleRow,
  type FormattingRule,
} from "@/app/(app)/matrix/MessageEditor";
import { advance, body, click, header, heldFetch, mount, typeInto } from "./dom";

function rule(over: Partial<FormattingRule> = {}): FormattingRule {
  return {
    id: 7,
    textOriginal: "Hello",
    textFormatted: "a",
    formattingScope: null,
    formattingMcScope: null,
    version: 1,
    archivedAt: null,
    ...over,
  };
}

function view(r: FormattingRule, qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <TextFormattingRuleRow rule={r} mcLabel="MC 1 a" templateSizes={["300x250"]} />
    </QueryClientProvider>
  );
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

const input = (c: HTMLElement) =>
  c.querySelector<HTMLInputElement>(".text-format-rule__input")!;

describe("TextFormattingRuleRow", () => {
  it("keeps what was typed while its save was in flight, when the list refetches", async () => {
    const ui = mount(view(rule(), qc));
    typeInto(input(ui.container), "ab");
    await advance(400);
    expect(server.calls).toHaveLength(1);

    // Typed while the save is in flight.
    typeInto(input(ui.container), "abc");

    await server.calls[0].respond(200, { rule: rule({ textFormatted: "ab", version: 2 }) });
    // The save invalidates the rule list; the refetch brings back the stored
    // row: the text that was sent, on the new version.
    ui.rerender(view(rule({ textFormatted: "ab", version: 2 }), qc));

    expect(input(ui.container).value).toBe("abc");
  });

  it("leaves the caret where the user put it when the list refetches", async () => {
    const ui = mount(view(rule({ textFormatted: "a" }), qc));
    typeInto(input(ui.container), "az");
    await advance(400);
    // While that save is in flight the user goes back after the "a" and types
    // "bcd" there: the caret sits before the "z".
    typeInto(input(ui.container), "abcdz");
    input(ui.container).setSelectionRange(4, 4);

    await server.calls[0].respond(200, { rule: rule({ textFormatted: "az", version: 2 }) });
    ui.rerender(view(rule({ textFormatted: "az", version: 2 }), qc));

    expect(input(ui.container).value).toBe("abcdz");
    expect(input(ui.container).selectionStart).toBe(4);
  });

  it("sends what was typed meanwhile on the version its save returned", async () => {
    const ui = mount(view(rule(), qc));
    typeInto(input(ui.container), "ab");
    await advance(400);
    typeInto(input(ui.container), "abc");
    await server.calls[0].respond(200, { rule: rule({ textFormatted: "ab", version: 2 }) });
    ui.rerender(view(rule({ textFormatted: "ab", version: 2 }), qc));
    await advance(400);

    expect(server.calls).toHaveLength(2);
    expect(body(server.calls[1]).textFormatted).toBe("abc");
    expect(header(server.calls[1], "If-Match")).toBe("2");
  });

  it("takes the refetch of its own save that lands before the response as its echo, not a conflict", async () => {
    const ui = mount(view(rule(), qc));
    typeInto(input(ui.container), "ab");
    await advance(400);
    typeInto(input(ui.container), "abc");
    // Another write refetched the list while the save was out: it already has
    // this save, on version 2.
    ui.rerender(view(rule({ textFormatted: "ab", version: 2 }), qc));
    await server.calls[0].respond(200, { rule: rule({ textFormatted: "ab", version: 2 }) });
    await advance(400);

    expect(ui.container.querySelector(".save-indicator--conflict")).toBeNull();
    expect(input(ui.container).value).toBe("abc");
    expect(server.calls).toHaveLength(2);
    expect(header(server.calls[1], "If-Match")).toBe("2");
  });

  it("does not send a second save while the first is in flight", async () => {
    const ui = mount(view(rule(), qc));
    typeInto(input(ui.container), "ab");
    await advance(400);
    typeInto(input(ui.container), "abc");
    await advance(400);

    expect(server.calls).toHaveLength(1);
  });

  it("shows a failed save", async () => {
    const ui = mount(view(rule(), qc));
    typeInto(input(ui.container), "ab");
    await advance(400);
    await server.calls[0].respond(500, { error: "boom" });

    expect(ui.container.querySelector(".save-indicator--error")).not.toBeNull();
  });

  it("shows a conflict with Reload, and Reload takes the stored rule", async () => {
    const ui = mount(view(rule(), qc));
    typeInto(input(ui.container), "ab");
    await advance(400);
    await server.calls[0].respond(409, {
      error: "version_mismatch",
      currentVersion: 5,
      currentRow: rule({ textFormatted: "peer", version: 5 }),
    });

    expect(ui.container.querySelector(".save-indicator--conflict")).not.toBeNull();
    // Paused: typing on does not send.
    typeInto(input(ui.container), "abc");
    await advance(400);
    expect(server.calls).toHaveLength(1);

    const reload = [...ui.container.querySelectorAll("button")].find(
      (b) => b.textContent === "Reload",
    )!;
    click(reload);
    await advance(0);
    expect(input(ui.container).value).toBe("peer");
  });

  it("refreshes the rules list on Reload, so the preview formats with the stored rule", async () => {
    const ui = mount(view(rule(), qc));
    typeInto(input(ui.container), "ab");
    await advance(400);
    await server.calls[0].respond(409, {
      error: "version_mismatch",
      currentVersion: 5,
      currentRow: rule({ textFormatted: "peer", version: 5 }),
    });
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    click([...ui.container.querySelectorAll("button")].find((b) => b.textContent === "Reload")!);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["text-formatting"] });
  });

  // Opening a rule is not an edit: the row only shows it.
  it("sends nothing when it shows a local rule of another MC", async () => {
    mount(view(rule({ formattingMcScope: "MC 3 b" }), qc));
    await advance(400);
    expect(server.calls).toHaveLength(0);
  });

  it("sends nothing when the stored sizes are written with a space after the comma", async () => {
    mount(view(rule({ formattingScope: "300x250, 728x90" }), qc));
    await advance(400);
    expect(server.calls).toHaveLength(0);
  });
});

describe("a new text-formatting rule (TextFieldWithFormatting)", () => {
  function field(rules: FormattingRule[]) {
    return (
      <QueryClientProvider client={qc}>
        <TextFieldWithFormatting
          fieldKey="headline"
          label="Headline"
          kind="input"
          value="Hello"
          onChange={() => {}}
          allRules={rules}
          mcLabel="MC 1 a"
          templateSizes={["300x250"]}
        />
      </QueryClientProvider>
    );
  }
  const addButton = (c: HTMLElement) =>
    [...c.querySelectorAll("button")].find((b) => b.textContent?.includes("add text formatting"))!;

  it("keeps the focus and what was typed while it was being created", async () => {
    const ui = mount(field([]));
    click(addButton(ui.container));
    const el = input(ui.container);
    act(() => el.focus());
    typeInto(el, "x");
    await advance(600);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].init.method).toBe("POST");

    // Typed while the create is in flight.
    typeInto(el, "xy");
    await server.calls[0].respond(201, { rule: rule({ id: 9, textFormatted: "x", version: 1 }) });
    ui.rerender(field([rule({ id: 9, textFormatted: "x", version: 1 })]));

    const active = document.activeElement as HTMLInputElement | null;
    expect(active?.classList.contains("text-format-rule__input")).toBe(true);
    expect(active?.value).toBe("xy");
    // One row for the rule, not the draft and the stored rule side by side.
    expect(ui.container.querySelectorAll(".text-format-rule__input")).toHaveLength(1);
  });

  it("then saves what was typed meanwhile onto the rule it created", async () => {
    const ui = mount(field([]));
    click(addButton(ui.container));
    typeInto(input(ui.container), "x");
    await advance(600);
    typeInto(input(ui.container), "xy");
    await server.calls[0].respond(201, { rule: rule({ id: 9, textFormatted: "x", version: 1 }) });
    ui.rerender(field([rule({ id: 9, textFormatted: "x", version: 1 })]));
    await advance(600);

    expect(server.calls).toHaveLength(2);
    expect(server.calls[1].url).toBe("/api/text-formatting/9");
    expect(body(server.calls[1]).textFormatted).toBe("xy");
    expect(header(server.calls[1], "If-Match")).toBe("1");
  });
});
