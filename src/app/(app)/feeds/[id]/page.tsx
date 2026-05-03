import { redirect } from "next/navigation";
import { readSessionFromCookies } from "@/lib/auth-server";
import { FeedDetailView } from "./FeedDetailView";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const claims = await readSessionFromCookies();
  if (!claims) redirect("/login");
  const { id } = await params;
  return (
    <div className="feed-detail flex h-full flex-col">
      <FeedDetailView id={Number(id)} />
    </div>
  );
}
