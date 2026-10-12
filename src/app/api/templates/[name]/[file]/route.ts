import { NextResponse } from "next/server";
import { readTemplateFile, writeTemplateFile } from "@/lib/templates";
import { withSession, withAdmin } from "@/lib/scoped";
import { mimeByExt } from "@/lib/mime-by-ext";

type Params = { name: string; file: string };

export const GET = withSession<Params>(async ({ params }) => {
  const buf = readTemplateFile(params.name, params.file);
  if (!buf) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": mimeByExt(params.file),
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
