import { redirect } from "next/navigation";

// Keep existing bookmarks without starting or changing the team's server.
export default async function OpenTeamNotebook({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams();
  if (typeof query.id === "string") params.set("id", query.id);
  if (typeof query.teamId === "string") params.set("teamId", query.teamId);
  redirect(`/api/workspace/launch?${params}`);
}
