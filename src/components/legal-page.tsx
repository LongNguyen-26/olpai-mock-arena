import type { ReactNode } from "react";
import LegalLinks from "./legal-links";
export const supportEmail = "nhatlong30042006@gmail.com";
export function SupportLink() {
  return <a href={`mailto:${supportEmail}`}>{supportEmail}</a>;
}
export default function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <a className="brand" href="/">
          <span className="brand-symbol">
            A<span>·</span>
          </span>
          <span>
            OlpAI<span className="brand-light"> Arena</span>
          </span>
        </a>
        <a className="text-button" href="/">
          Về Arena →
        </a>
      </header>
      <main className="legal-main">
        <p className="eyebrow muted">OLPAI ARENA</p>
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>
        <p className="legal-updated">
          Có hiệu lực từ ngày 07 tháng 11 năm 2026
        </p>
        <article>{children}</article>
      </main>
      <footer className="legal-footer">
        <LegalLinks />
        <span>
          Liên hệ: <SupportLink />
        </span>
      </footer>
    </div>
  );
}
