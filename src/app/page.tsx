import Arena from "@/components/arena";
import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Home() {
  if ((await getUser())?.needsName) redirect("/onboarding");
  return <Arena />;
}
