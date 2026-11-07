import { cookies } from "next/headers";
import EmailChangeConfirmation from "@/components/email-change-confirmation";
export const metadata = {
  title: "Xác nhận đổi email | OlpAI Arena",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  return (
    <EmailChangeConfirmation
      status={(await searchParams).status}
      canConfirm={!!(await cookies()).get("arena-email-confirm")?.value}
    />
  );
}
