import EmailLogin from "@/components/email-login";
import { cookies } from "next/headers";
export const dynamic = "force-dynamic";
export const metadata = {title:"Xác nhận đăng nhập | OlpAI Arena",robots:{index:false,follow:false}};
export default async function Page() {
  return <EmailLogin canConfirm={!!(await cookies()).get("arena-email-login")?.value}/>;
}
