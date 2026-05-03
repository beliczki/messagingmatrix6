import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth-server";
import { FeedsView } from "./FeedsView";

export default async function Page() {
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");
  return (
    <div className="feeds flex h-full flex-col">
      <FeedsView />
    </div>
  );
}
