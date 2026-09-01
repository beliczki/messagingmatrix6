import { db } from "@/db";
import { sql } from "drizzle-orm";
async function main() {
  console.log(await db.execute(sql`select id, title, view_count, download_count, created_at, updated_at, archived_at, created_by from share_galleries order by created_at desc limit 8`));
  console.log(await db.execute(sql`select count(*) n, min(created_at) mn, max(created_at) mx from share_galleries`));
  console.log(await db.execute(sql`select share_gallery_id, author_name, created_at, archived_at from share_comments order by created_at desc limit 5`));
  process.exit(0);
}
main();
