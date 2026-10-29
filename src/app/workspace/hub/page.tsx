"use client";
import { useEffect, useState } from "react";

export default function OpenTeamNotebook() {
  const [message, setMessage] = useState("Đang yêu cầu workspace của đội…");
  useEffect(() => {
    const query = new URLSearchParams(window.location.search),
      id = query.get("id"),
      teamId = query.get("teamId");
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function open() {
      try {
        const response = await fetch("/api/workspace/hub/server", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            teamId: teamId ?? undefined,
            action: "start",
            requestId: crypto.randomUUID(),
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Chưa mở được workspace.");
        if (alive)
          window.location.replace(
            `/api/workspace/launch?id=${encodeURIComponent(id ?? "")}${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""}`,
          );
      } catch (e) {
        if (alive) setMessage((e as Error).message);
      }
    }
    timer = setTimeout(() => void open(), 0);
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return (
    <main
      className="panel"
      style={{ maxWidth: 680, margin: "10vh auto", padding: 24 }}
    >
      <h1>JupyterLab của đội</h1>
      <p role="status">{message}</p>
      <p>
        Workspace mới cần thời gian chuẩn bị môi trường. Các team khác tiếp tục
        hoạt động.
      </p>
      <a href="/">Về GPU Workspace</a>
    </main>
  );
}
