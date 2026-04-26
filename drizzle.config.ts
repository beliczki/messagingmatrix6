import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "./db/matrix.db",
  },
} satisfies Config;
