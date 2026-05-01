// Rotate (or seed) a client's MCP bearer token. Phase 8a bootstrap helper —
// once Settings → Clients tab has a Rotate button (8d), this script is mainly
// useful for local development.
//
// Usage:
//   ACTIVE_CLIENT_KEY=erste npx tsx scripts/rotate-mcp-token.ts
//   npx tsx scripts/rotate-mcp-token.ts --client telekom

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, getSqlite } from "../src/db";
import { clients } from "../src/db/schema";
import { getActiveClient } from "../src/lib/active-client";

function parseArgs() {
  const argv = process.argv.slice(2);
  let clientKey: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--client") {
      clientKey = argv[++i] ?? null;
    } else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: ACTIVE_CLIENT_KEY=erste npx tsx scripts/rotate-mcp-token.ts [--client <key>]",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return { clientKey };
}

function main() {
  const { clientKey } = parseArgs();

  const target = clientKey
    ? db.select().from(clients).where(eq(clients.key, clientKey)).get()
    : getActiveClient();
  if (!target) {
    console.error(`No client found with key="${clientKey}".`);
    process.exit(1);
  }

  const newToken = "mcp_" + crypto.randomBytes(32).toString("hex");
  db.update(clients)
    .set({ mcpToken: newToken })
    .where(eq(clients.id, target.id))
    .run();

  console.log(
    `Rotated MCP token for client "${target.key}" (id=${target.id}).`,
  );
  console.log("New token (copy this — it won't be shown again):");
  console.log(`  ${newToken}`);
  console.log(
    `\nSmoke test:\n  curl -X POST -H "Authorization: Bearer ${newToken}" \\\n    -H "Content-Type: application/json" \\\n    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \\\n    http://localhost:3000/mcp`,
  );
  getSqlite().close();
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
