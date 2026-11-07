import type { Metadata } from "next";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/be-vietnam-pro/800.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource-variable/source-serif-4/index.css";
import "./globals.css";
import "./arena-refinements.css";
import "./round-management.css";
import "./chat-groups.css";
import "./admin-roster.css";
import "./editorial-theme.css";
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
