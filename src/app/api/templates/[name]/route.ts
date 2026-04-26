import { NextResponse } from "next/server";
import { listTemplateFiles, createTemplate, readTemplate } from "@/lib/templates";
import { withSession, withAdmin } from "@/lib/scoped";

type Params = { name: string };

export const GET = withSession<Params>(({ params }) => {
  const info = readTemplate(params.name);
  if (!info) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const files = listTemplateFiles(params.name) ?? [];
  return NextResponse.json({ template: info, files });
});

export const POST = withAdmin<Params>(({ params }) => {
  const result = createTemplate(params.name);
  if (!result.ok) {
    const status = result.reason === "exists" ? 409 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  const info = readTemplate(params.name);
  const files = listTemplateFiles(params.name) ?? [];
  return NextResponse.json({ template: info, files }, { status: 201 });
});
