import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "OlpAI Arena · Đấu trường mô phỏng",
  description:
    "Luyện mô phỏng Olympic AI: hai tác vụ, sáu giờ và một mục tiêu. Bộ luyện độc lập, không phải nền tảng chính thức của BTC.",
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
