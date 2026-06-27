import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { readSessionFromCookies } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import TemplateEditor from "./TemplateEditor";

export default async function Page() {
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);
  if (!u || u.role !== "admin") {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md rounded-xl border border-rose-200 bg-rose-50 p-8 text-center">
          <h1 className="text-xl font-semibold text-rose-900">Admin only</h1>
          <p className="mt-2 text-sm text-rose-700">
            Template editor is restricted to admin users.
          </p>
        </div>
      </div>
    );
  }
  return <TemplateEditor />;
}
