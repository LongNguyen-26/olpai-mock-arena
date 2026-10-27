"use client";
import { Eye, EyeOff } from "lucide-react";

export default function RoundVisibilityButton({
  hidden,
  title,
  busy,
  onChange,
}: {
  hidden: boolean;
  title: string;
  busy: boolean;
  onChange: (hidden: boolean) => void;
}) {
  const Icon = hidden ? Eye : EyeOff;
  return (
    <button
      type="button"
      className="btn small-btn round-visibility-toggle"
      disabled={busy}
      aria-label={`${hidden ? "Hiện" : "Ẩn"} vòng ${title}`}
      onClick={() => {
        if (
          !hidden &&
          !confirm(
            "Ẩn vòng luyện này? Thí sinh tạm thời không thấy và không truy cập được vòng. Dữ liệu và kết quả được giữ lại.",
          )
        )
          return;
        onChange(!hidden);
      }}
    >
      <Icon size={16} />
      {hidden ? "Hiện vòng" : "Ẩn vòng"}
    </button>
  );
}
