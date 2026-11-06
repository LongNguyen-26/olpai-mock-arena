import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { authReturnPath, loginHref } from "@/lib/auth-navigation";
import ProfileSetup from "@/components/profile-setup";
export const dynamic = "force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params = await searchParams, next = authReturnPath(params.next);
  const user = await getUser();
  if (!user) redirect(loginHref(next));
  if (!user.needsName) redirect(next);
  return <ProfileSetup next={next}/>;
}
