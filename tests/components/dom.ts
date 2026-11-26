// Small DOM harness for the `components` vitest project (jsdom): mount a React
// tree, type into a controlled input the way a browser does, and answer fetch
// calls one at a time. No testing library: react-dom/client and React's act.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so no ResizeObserver; the preview panes only scale with it.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

export function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    container,
    rerender(next: ReactNode) {
      act(() => root.render(next));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// React tracks a controlled input's value through the native setter; setting
// `.value` directly would be swallowed as "no change".
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Move fake time forward and let the effects and promises it starts settle. */
export async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Let pending promises (a fetch the test just answered) settle. */
export async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

type Call = {
  url: string;
  init: RequestInit;
  respond: (status: number, body: unknown) => Promise<void>;
};

/**
 * A fetch that answers nothing by itself: every call waits until the test
 * calls `respond` on it, so "a save is in flight" is a state the test holds.
 */
export function heldFetch() {
  const calls: Call[] = [];
  const fn = vi.fn((url: string, init: RequestInit) => {
    return new Promise<Response>((resolve) => {
      calls.push({
        url,
        init,
        respond: async (status, body) => {
          resolve(
            new Response(JSON.stringify(body), {
              status,
              headers: { "Content-Type": "application/json" },
            }),
          );
          await flush();
        },
      });
    });
  });
  return { fn, calls };
}

export function body(call: { init: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

export function header(call: { init: RequestInit }, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}
