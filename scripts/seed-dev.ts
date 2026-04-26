// Local-dev seed: ensures the active client exists and creates an admin user
// you can sign in with. Re-runnable; idempotent on the user.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../src/db";
import { clients, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { getActiveClient } from "../src/lib/active-client";

async function main() {
  const adminEmail = process.argv[2] ?? "admin@local";
  const adminPassword = process.argv[3] ?? "admin123";

  const client = getActiveClient(); // auto-creates row + default config
  console.log(`Active client: ${client.key} (id=${client.id})`);

  const existing = db
    .select()
    .from(users)
    .where(eq(users.email, adminEmail))
    .all()
    .find((u) => u.clientId === client.id);

  if (existing) {
    console.log(`Admin user already exists: ${adminEmail}`);
    return;
  }

  await db.insert(users).values({
    id: nanoid(),
    clientId: client.id,
    email: adminEmail,
    password: await hashPassword(adminPassword),
    role: "admin",
  });
  console.log(`Created admin: ${adminEmail} / ${adminPassword}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
