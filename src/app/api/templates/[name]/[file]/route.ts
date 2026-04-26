import { NextResponse } from "next/server";
import path from "node:path";
import { readTemplateFile, writeTemplateFile } from "@/lib/templates";
import { withSession, withAdmin } from "@/lib/scoped";

type Params = { name: string; file: string };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
};

export const GET = withSession<Params>(async ({ params }) => {
  const buf = readTemplateFile(params.name, params.file);
  if (!buf) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const ext = path.extname(params.file).toLowerCase();
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=60",
    },
  });
});

export const PUT = withAdmin<Params>(async ({ req, params }) => {
  const content = await req.text();
  const result = writeTemplateFile(params.name, params.file, content);
  if (!result.ok) {
    const status = result.reason === "no_template" ? 404 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, bytes: result.bytes });
});
