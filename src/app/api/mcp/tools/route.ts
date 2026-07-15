import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdmin } from "@/lib/scoped";
import { activeClientId } from "@/lib/active-client";
import { buildMcpServer } from "@/lib/mcp";

// Admin-only inventory of MCP tools. Used by Settings → MCP to render
// auto-generated documentation. The tool surface is identical across
// clients (only the resolved client_id changes at runtime), so we build
// the server with the active client and walk its registered tools.

type ToolField = {
  name: string;
  type: string;
  optional: boolean;
};

type ToolDescriptor = {
  name: string;
  description: string;
  inputs: ToolField[];
};

type JsonSchemaProp = {
  type?: string;
  enum?: unknown[];
  items?: JsonSchemaProp;
  anyOf?: JsonSchemaProp[];
  const?: unknown;
};

function describeJsonSchemaProp(prop: JsonSchemaProp): string {
  if (prop.enum) {
    return `enum: ${prop.enum.map((v) => String(v)).join(" | ")}`;
  }
  if (prop.const !== undefined) {
    return `literal: ${JSON.stringify(prop.const)}`;
  }
  if (prop.anyOf) {
    return prop.anyOf.map(describeJsonSchemaProp).join(" | ");
  }
  if (prop.type === "array" && prop.items) {
    return `${describeJsonSchemaProp(prop.items)}[]`;
  }
  if (prop.type === "integer") return "integer";
  return prop.type ?? "unknown";
}

function describeTool(name: string, raw: unknown): ToolDescriptor {
  const r = raw as {
    description?: string;
    inputSchema?: z.ZodObject<z.ZodRawShape> | undefined;
  };
  const inputs: ToolField[] = [];

  if (r.inputSchema) {
    const schema = z.toJSONSchema(r.inputSchema) as {
      properties?: Record<string, JsonSchemaProp>;
      required?: string[];
    };
    const required = new Set(schema.required ?? []);
    for (const [k, prop] of Object.entries(schema.properties ?? {})) {
      inputs.push({
        name: k,
        type: describeJsonSchemaProp(prop),
        optional: !required.has(k),
      });
    }
  }

  return {
    name,
    description: r.description ?? "",
    inputs,
  };
}

export const GET = withAdmin(async () => {
  // Introspection only — handlers never run, so a synthetic full-scope
  // context keeps the docs listing complete.
  const server = buildMcpServer({
    clientId: await activeClientId(),
    userId: "system",
    scope: "full",
  });
  const registered = (server as unknown as {
    _registeredTools: Record<string, unknown>;
  })._registeredTools;

  const tools: ToolDescriptor[] = Object.entries(registered)
    .map(([name, raw]) => describeTool(name, raw))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ tools });
});
