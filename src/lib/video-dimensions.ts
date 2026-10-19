// A video's size, measured from the file. Every upload path (the UI route and
// the two MCP upload tools) measures images with sharp and packages from their
// manifest; a video had nothing, so one whose name carries no _WxH reached the
// library with no size — and a draft places delivered files BY size, so it
// never showed (MC417a's TikTok cut, 2026-10-19).
//
// ffprobe needs a seekable file (an mp4's moov atom can sit at the end), so the
// bytes go through a temp file. A phone clip stores its frames sideways with a
// rotation tag; the size reported is the one it plays at.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** "WxH" as the video plays, or null when ffprobe finds no video stream. */
export async function videoDimensions(buffer: Buffer): Promise<string | null> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mm6-probe-"));
  const file = path.join(dir, "probe");
  try {
    await fs.writeFile(file, buffer);
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:stream_side_data=rotation",
      "-of",
      "json",
      file,
    ]);
    const stream = (
      JSON.parse(stdout) as {
        streams?: Array<{
          width?: number;
          height?: number;
          side_data_list?: Array<{ rotation?: number }>;
        }>;
      }
    ).streams?.[0];
    if (!stream?.width || !stream.height) return null;
    const rotation = stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0;
    const sideways = Math.abs(rotation) % 180 === 90;
    return sideways ? `${stream.height}x${stream.width}` : `${stream.width}x${stream.height}`;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
