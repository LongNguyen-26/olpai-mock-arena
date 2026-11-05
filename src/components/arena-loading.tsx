export function WorkspaceSkeleton({
  label = "Đang tải GPU Workspace…",
}: {
  label?: string;
}) {
  return (
    <section
      className="workspace-loading"
      aria-busy="true"
      aria-label="Đang tải Workspace"
    >
      <p className="workspace-loading-status" role="status">
        <span className="loader" aria-hidden="true" />
        {label}
      </p>
      <div className="workspace-skeleton-tabs" aria-hidden="true">
        <i className="skeleton" />
        <i className="skeleton" />
      </div>
      <div className="panel workspace-skeleton-card" aria-hidden="true">
        <i className="skeleton skeleton-heading" />
        <i className="skeleton skeleton-line" />
        <div className="workspace-skeleton-grid">
          <i className="skeleton" />
          <i className="skeleton" />
          <i className="skeleton" />
        </div>
      </div>
      <div className="panel workspace-skeleton-card" aria-hidden="true">
        <i className="skeleton skeleton-heading" />
        <i className="skeleton skeleton-line" />
        <i className="skeleton skeleton-field" />
      </div>
    </section>
  );
}

export default function ArenaLoading({
  workspace = false,
  error = "",
  slow = false,
  onRetry,
}: {
  workspace?: boolean;
  error?: string;
  slow?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="app-shell arena-loading">
      <aside className="sidebar" aria-label="OlpAI Arena">
        <a className="brand" href="/">
          <span className="brand-symbol">
            A<span>·</span>
          </span>
          <span>
            OlpAI<span className="brand-light"> Arena</span>
          </span>
        </a>
        <div className="arena-loading-nav" aria-hidden="true">
          {[0, 1, 2, 3].map((n) => (
            <i key={n} className="skeleton" />
          ))}
        </div>
      </aside>
      <div className="app-body">
        <header className="topbar">
          <span>{workspace ? "GPU Workspace" : "Môi trường luyện tập"}</span>
        </header>
        <main className="content">
          <h1>{workspace ? "GPU Workspace" : "OlpAI Arena"}</h1>
          {error ? (
            <div className="alert error" role="alert">
              <p>{error}</p>
              <div className="gpu-head-actions">
                {onRetry && (
                  <button className="btn" onClick={onRetry}>
                    Thử lại
                  </button>
                )}
                <a className="btn" href="/login">
                  Đăng nhập
                </a>
              </div>
            </div>
          ) : (
            <>
              <WorkspaceSkeleton
                label={
                  workspace
                    ? "Đang tải GPU Workspace…"
                    : "Đang tải môi trường luyện tập…"
                }
              />
              {slow && (
                <p role="status">
                  Việc tải đang lâu hơn bình thường. Bạn có thể thử lại.
                </p>
              )}
              {slow && onRetry && (
                <button className="btn" onClick={onRetry}>
                  Thử lại
                </button>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
