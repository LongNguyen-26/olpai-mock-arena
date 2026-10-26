import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import Arena from "@/components/arena";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");
  return <Arena />;
}
