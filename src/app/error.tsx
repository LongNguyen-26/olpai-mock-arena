"use client";
import ArenaLoading from "@/components/arena-loading";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <ArenaLoading
      error="Chưa kết nối được môi trường luyện tập. Vui lòng thử lại."
      onRetry={reset}
    />
  );
}
