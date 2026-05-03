import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth-server";
import { SharesView } from "./SharesView";

export default async function Page() {
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");
  return <SharesView />;
}
