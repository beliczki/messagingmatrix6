// Bootstrap all 4 declared deploys (erste / telekom / proficio / demo) so the
// Phase 10e multi-deploy smoke can hit each one without per-client first-boot
// detours. For every key listed below it:
//   1. Ensures the clients row exists (auto-creates with default config)
//   2. Ensures an admin user exists with the same email/password for easy login
//   3. Prints the resulting (id, key) per deploy for the smoke checklist
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../src/db";
import { clients, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { _resetActiveClientCacheForTests } from "../src/lib/active-client";
import { getActiveClient } from "../src/lib/active-client";

const KEYS = ["erste", "telekom", "proficio", "demo"] as const;

async function ensureClientAndAdmin(
  key: (typeof KEYS)[number],
  email: string,
  password: string,
) {
  process.env.ACTIVE_CLIENT_KEY = key;
  _resetActiveClientCacheForTests();
  const c = getActiveClient(); // auto-creates row + default config

  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .all()
    .find((u) => u.clientId === c.id);

  if (!existing) {
    await db.insert(users).values({
      id: nanoid(),
      clientId: c.id,
      email,
      password: await hashPassword(password),
      role: "admin",
    });
  }
  return c;
}

async function main() {
  const adminEmail = process.argv[2] ?? "admin@local";
  const adminPassword = process.argv[3] ?? "admin123";

  console.log("Bootstrapping multi-deploy clients + admin users…\n");
  console.log(
    `id  | key       | port | admin\n` +
      `----+-----------+------+--------------`,
  );
  for (const key of KEYS) {
    const c = await ensureClientAndAdmin(key, adminEmail, adminPassword);
    const port =
      key === "erste"
        ? 6001
        : key === "telekom"
          ? 6002
          : key === "proficio"
            ? 6003
            : 6000;
    console.log(
      `${String(c.id).padStart(3)} | ${key.padEnd(9)} | ${port} | ${adminEmail}`,
    );
  }
  console.log(
    `\nStart each deploy in its own terminal:\n` +
      `  npm run dev:erste     # http://localhost:6001\n` +
      `  npm run dev:telekom   # http://localhost:6002\n` +
      `  npm run dev:proficio  # http://localhost:6003\n` +
      `  npm run dev:demo      # http://localhost:6000\n` +
      `\nAdmin login on each: ${adminEmail} / ${adminPassword}` +
      `\nMCP tokens are per-user (mcp_tokens) — Settings → MCP tab to create/reveal.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
