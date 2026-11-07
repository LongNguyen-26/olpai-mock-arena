/** Shared wordmark for the shell, loading, authentication and legal pages. */
export default function BrandIdentity() {
  return <>
    <svg className="brand-mark" viewBox="0 0 40 44" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 39 17 8l4 9L11 39H3Z" fill="currentColor" />
      <path d="m20 2 18 37h-8L16 11l4-9Z" fill="currentColor" />
      <path d="m19 26 6 13h-6l-3-6 3-7Z" fill="var(--brand-accent)" />
    </svg>
    <span className="brand-wordmark">OlpAI<span className="brand-light"> Arena</span></span>
  </>;
}
