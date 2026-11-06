"use client";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { loginHref } from "@/lib/auth-navigation";
import { LockedResourceBackdrop } from "./locked-resources";
const descriptions: Record<string, string> = {
  data: "Đăng nhập và đăng ký vòng luyện để tải dữ liệu, notebook và các tài nguyên được phát theo từng giai đoạn.",
  submit: "Đăng nhập để tham gia đội, nộp bài và theo dõi kết quả của đội trong vòng luyện.",
  team: "Đăng nhập để tạo đội, nhận lời mời và cùng đồng đội tham gia các vòng luyện.",
  workspace: "Đăng nhập để sử dụng JupyterLab và Trợ lý AI khi đội của bạn được cấp quyền.",
  settings: "Đăng nhập để quản lý tài khoản và các phương thức đăng nhập của bạn.",
};
export default function AuthRequired({ section, next }: { section: string; next: string }) {
  return <section className={`panel auth-required ${section === "data" ? "with-locked-preview" : ""}`}>
    {section === "data" && <LockedResourceBackdrop/>}
    <div className="auth-required-content">
    <span className="lock-circle"><LockKeyhole size={27} /></span>
    <span className="eyebrow muted">KHÔNG GIAN CỦA BẠN</span>
    <h2>Đăng nhập để tiếp tục</h2>
    <p>{descriptions[section] ?? "Chức năng này dành cho người dùng đã đăng nhập."}</p>
    <div className="auth-required-actions">
      <a className="btn primary" href={loginHref(next)}>Đăng nhập <ArrowRight size={17} /></a>
      <a className="btn" href={loginHref(next, true)}>Tạo tài khoản</a>
    </div>
    </div>
  </section>;
}
