import type { Metadata } from "next";
import "./globals.css";
import "./arena-refinements.css";
import "./round-management.css";
import "./chat-groups.css";
import "./admin-roster.css";
export const metadata: Metadata = {
  title: "OlpAI Arena",
  description: "Môi trường ôn luyện mô phỏng Olympic AI 2026.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
