import Login from "@/components/login";
import { authOptions } from "@/lib/supabase-auth";
import { authReturnPath } from "@/lib/auth-navigation";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: {searchParams: Promise<Record<string,string|string[]|undefined>>}) {
  const params = await searchParams;
  return <Login options={authOptions()} next={authReturnPath(params.next)} initialMode={typeof params.mode === "string" ? params.mode : "login"} initialError={typeof params.error === "string" ? params.error.slice(0,500) : ""} />;
}
