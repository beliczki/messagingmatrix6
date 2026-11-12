import { describe, expect, it } from "vitest";
import { VideoBusyError, _oneAtATimeForTests as oneAtATime } from "@/lib/video-convert";

// The public WebM route's ceiling per process: one encode running, at most two
// waiting behind it, the rest turned away (Chief Architect review, 2026-11-12).
describe("video encode queue", () => {
  it("runs one job at a time and turns away a third waiting one", async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const first = oneAtATime(async () => {
      order.push("1 start");
      await gate;
      order.push("1 end");
    });
    await Promise.resolve(); // the first leaves the queue and runs
    const second = oneAtATime(async () => {
      order.push("2");
    });
    const third = oneAtATime(async () => {
      order.push("3");
    });
    expect(() => oneAtATime(async () => {})).toThrow(VideoBusyError);

    release();
    await Promise.all([first, second, third]);
    expect(order).toEqual(["1 start", "1 end", "2", "3"]);

    // Drained: a new job is taken again.
    await oneAtATime(async () => {
      order.push("4");
    });
    expect(order.at(-1)).toBe("4");
  });

  it("keeps going after a job fails", async () => {
    await expect(
      oneAtATime(async () => {
        throw new Error("encode failed");
      }),
    ).rejects.toThrow("encode failed");
    await expect(oneAtATime(async () => "next")).resolves.toBe("next");
  });
});
