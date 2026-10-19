import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { videoDimensions } from "@/lib/video-dimensions";

const run = promisify(execFile);

// A real (tiny) mp4 through the real ffprobe — the point is the parse of what
// ffprobe prints, including a phone clip's rotation tag.
async function mp4(w: number, h: number, rotate?: number): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mm6-vid-"));
  const out = path.join(dir, "v.mp4");
  try {
    await run("ffmpeg", [
      "-v", "error",
      ...(rotate === undefined ? [] : ["-display_rotation", String(rotate)]),
      "-f", "lavfi", "-i", `color=c=blue:s=${w}x${h}:d=0.2`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", out,
    ]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("videoDimensions", () => {
  it("reads a portrait clip's size", async () => {
    expect(await videoDimensions(await mp4(108, 192))).toBe("108x192");
  });

  it("reports a rotated clip at the size it plays", async () => {
    expect(await videoDimensions(await mp4(192, 108, 90))).toBe("108x192");
  });

  it("finds no video stream in something that is not a video", async () => {
    await expect(videoDimensions(Buffer.from("not a video"))).rejects.toThrow();
  });
});
