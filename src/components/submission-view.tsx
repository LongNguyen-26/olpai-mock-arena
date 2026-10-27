"use client";
import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Send,
  UploadCloud,
} from "lucide-react";
import { endpoint, fmt, when, type ViewProps } from "./arena-client";
import type { Phase, Split, TaskId } from "@/lib/types";
type Result = {
  id?: string;
  status?: string;
  score?: number | null;
  secondary?: number;
  error?: string;
};
type Props = ViewProps & {
  phase: Phase;
  go: (section: string) => void;
  refresh: () => Promise<void>;
};
export default function SubmitView({ data, phase, busy, go, refresh }: Props) {
  const [task, setTask] = useState<TaskId>("1");
  const [adminSplit, setAdminSplit] = useState<Split>("public");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const nonce = useRef(crypto.randomUUID());
  const c = data.contest;
  if (!c) return null;
  const admin = data.user.admin;
  const split = admin ? adminSplit : phase === "private" ? "private" : "public";
  const open = admin || ["public", "private"].includes(phase);
  const count = data.submissions.filter(
    (s) =>
      s.teamId === data.user.teamId &&
      s.task === task &&
      s.split === split &&
      s.status !== "invalid" &&
      !s.adminTest,
  ).length;
  const quota = split === "private" ? c.privateLimit : c.publicLimit;
  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("task", task);
    form.set("split", split);
    form.set("nonce", nonce.current);
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(endpoint("submit", c!.roundId), {
        method: "POST",
        body: form,
      });
      const value: Result = await res.json();
      if (!res.ok && !value.id)
        throw new Error(value.error || "Không thể nộp bài.");
      setResult(value);
      nonce.current = crypto.randomUUID();
      await refresh();
    } catch (error) {
      setResult({
        error:
          error instanceof Error
            ? error.message
            : "Chưa xác nhận được kết quả. Kiểm tra lịch sử trước khi thử lại.",
      });
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <div className="submission-grid">
        <section className="panel submit-panel" aria-busy={sending}>
          <div className="section-title">
            <h2>
              <UploadCloud size={22} />
              {admin ? "Nộp thử · Admin" : "Nộp bài"}
            </h2>
            <span className="pill neutral submission-phase">
              {split.toUpperCase()}
            </span>
          </div>
          {sending ? (
            <div className="submission-result" role="status">
              <LoaderCircle className="spinning" size={46} />
              <h3>Đang chấm bài</h3>
              <p>Đang kiểm tra định dạng và tính điểm. Vui lòng chờ kết quả.</p>
            </div>
          ) : result ? (
            <div
              className={`submission-result ${result.error ? "result-error" : "result-success"}`}
              role="status"
            >
              {result.error ? (
                <AlertCircle size={46} />
              ) : (
                <CheckCircle2 size={46} />
              )}
              <h3>
                {result.error
                  ? result.id
                    ? "Bài nộp không hợp lệ"
                    : "Chưa thể hoàn tất bài nộp"
                  : "Chấm bài thành công"}
              </h3>
              {result.error ? (
                <p>{result.error}</p>
              ) : (
                <strong className="result-score">
                  {fmt(result.score)}
                  <small> / 100 điểm</small>
                </strong>
              )}
              {result.id && (
                <p>
                  {result.error
                    ? "Đã lưu vào lịch sử. Bài này không trừ lượt nộp."
                    : admin
                      ? "Kết quả nộp thử chỉ lưu trong lịch sử quản trị, không vào bảng xếp hạng."
                      : "Đã lưu kết quả và cập nhật bảng xếp hạng."}
                </p>
              )}
              <button className="btn primary" onClick={() => setResult(null)}>
                Nộp bài tiếp tục
                <UploadCloud size={17} />
              </button>
            </div>
          ) : !open ? (
            <div className="locked">
              <h3>Chưa mở hoặc đã khóa nhận bài</h3>
              <p>Xem thời gian trên trang tổng quan.</p>
            </div>
          ) : !admin && !data.team ? (
            <div className="locked">
              <h3>Bạn chưa có đội</h3>
              <button className="btn primary" onClick={() => go("team")}>
                Tạo hoặc tham gia đội
              </button>
            </div>
          ) : (
            <form onSubmit={send}>
              {admin && (
                <label>
                  Bộ kiểm thử
                  <select
                    value={adminSplit}
                    onChange={(e) => {
                      setAdminSplit(e.target.value as Split);
                      nonce.current = crypto.randomUUID();
                    }}
                  >
                    <option value="public">PUBLIC</option>
                    <option value="private">PRIVATE</option>
                  </select>
                </label>
              )}
              <label>
                Tác vụ
                <select
                  value={task}
                  onChange={(e) => {
                    setTask(e.target.value as TaskId);
                    nonce.current = crypto.randomUUID();
                  }}
                >
                  {(["1", "2"] as const).map((id) => (
                    <option key={id} value={id}>
                      0{id} ·{" "}
                      {data.tasks
                        .find((t) => t.id === id)
                        ?.title.replace(/^Tác vụ \d+\s*/, "") ?? `Tác vụ ${id}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="schema-line">
                <code>
                  {task === "1" ? "ImageId,EncodedPixels" : "id,prediction"}
                </code>
                <span className="submission-quota">
                  {admin ? "Không giới hạn lượt thử" : `${count}/${quota} lượt`}
                </span>
              </div>
              <label className="dropzone">
                <UploadCloud size={32} />
                <b>Chọn tệp CSV</b>
                <span>UTF-8 · Tối đa 3 MB</span>
                <input
                  type="file"
                  name="file"
                  required
                  accept=".csv,text/csv"
                  onChange={() => {
                    nonce.current = crypto.randomUUID();
                  }}
                />
              </label>
              <button
                className="btn primary wide"
                disabled={busy || (!admin && count >= quota)}
              >
                {!admin && count >= quota ? "Đã hết lượt nộp" : "Nộp bài"}
                <Send size={17} />
              </button>
            </form>
          )}
        </section>
        <aside className="panel submit-help">
          <h3>Lưu ý nộp bài</h3>
          <p>CSV phải đúng cột, đầy đủ ID và đúng bộ kiểm thử đang chọn.</p>
          <p>Bài lỗi định dạng được lưu vào lịch sử và không trừ quota.</p>
          <p>Điểm mỗi tác vụ lấy bài hợp lệ cao nhất. Tổng điểm tối đa 200.</p>
          {admin && (
            <p>
              Nộp thử được mở cho admin ở mọi thời điểm, không cần đội và không
              lên bảng xếp hạng.
            </p>
          )}
        </aside>
      </div>
      <section className="panel submission-history">
        <div className="section-title">
          <h2>Lịch sử nộp bài</h2>
          <button className="text-button" onClick={refresh}>
            Làm mới
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Bản nộp / thời gian</th>
                <th>Tác vụ</th>
                <th>Bộ kiểm thử</th>
                <th>Điểm</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {data.submissions.length ? (
                data.submissions.slice(0, 100).map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.downloadable ? (
                        <a
                          className="filename"
                          href={
                            endpoint("submission/download", c.roundId) +
                            `&id=${s.id}`
                          }
                        >
                          {s.filename}
                        </a>
                      ) : (
                        <b className="filename">{s.filename}</b>
                      )}
                      <small>
                        {when(s.createdAt)}
                        {s.adminTest ? " · Nộp thử admin" : ""}
                      </small>
                    </td>
                    <td>0{s.task}</td>
                    <td>
                      <span
                        className={`pill ${s.split === "private" ? "lavender" : "neutral"}`}
                      >
                        {s.split.toUpperCase()}
                      </span>
                    </td>
                    <td className="submission-score">{fmt(s.score)}</td>
                    <td>
                      {s.status === "invalid" ? (
                        <>
                          <span className="invalid">
                            <AlertCircle size={16} />
                            Không hợp lệ
                          </span>
                          <small className="submission-error">{s.error}</small>
                        </>
                      ) : (
                        <span className="valid">
                          <CheckCircle2 size={16} />
                          Hợp lệ
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">
                      <UploadCloud size={30} />
                      <b>Chưa có bài nộp</b>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
