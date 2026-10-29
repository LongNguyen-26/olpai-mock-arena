"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Clock3, Flag, Play, RotateCcw } from "lucide-react";
import {
  contestEnd,
  phaseOf,
  privatePolicy,
  privateStart,
  submissionAccess,
  submissionPolicy,
  chatbotAllowed,
  notebookAllowed,
} from "@/lib/domain";
import { when, type ViewProps } from "./arena-client";
import type { Contest } from "@/lib/types";

function localTime(t: number | null | undefined) {
  return t == null ? "" : new Date(t + 7 * 3600000).toISOString().slice(0, 19);
}
function timestamp(value: FormDataEntryValue | null) {
  return value ? Date.parse(String(value) + "+07:00") : null;
}
function formTime(f: FormData, name: string, original: number | null) {
  const value = f.get(name);
  return value === localTime(original) ? original : timestamp(value);
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="round-policy-dialog"
      aria-labelledby="round-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="section-title">
        <h2 id="round-dialog-title">{title}</h2>
        <button
          className="btn small-btn"
          type="button"
          onClick={close}
          aria-label="Đóng hộp thoại"
        >
          Đóng
        </button>
      </div>
      {children}
    </dialog>
  );
}
type Editor = "timing" | "private" | "practice" | "chatbot" | "reset" | null;
export default function RoundAccessControls({ data, busy, action }: ViewProps) {
  const [editor, setEditor] = useState<Editor>(null);
  const [saveError, setSaveError] = useState("");
  const editorContext = useRef<{ contest: Contest; now: number } | null>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const c = data.contest!;
  const phase = phaseOf(c, data.serverNow),
    active = ["public", "private", "practice"].includes(phase);
  const policy = privatePolicy(c),
    p = privateStart(c),
    end = contestEnd(c);
  function openEditor(value: Editor) {
    editorContext.current = { contest: c, now: data.serverNow };
    setSaveError("");
    setEditor(value);
  }
  async function send(
    value: Record<string, unknown>,
    message: string,
    context = c,
  ) {
    const payload = {
      ...value,
      runId: context.id,
      revision: context.revision ?? 0,
    };
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    return action(
      "admin/control",
      { ...payload, requestId: request.current.id },
      message,
    );
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const context = editorContext.current!;
    const savedP = privateStart(context.contest),
      savedEnd = contestEnd(context.contest);
    const savedPhase = phaseOf(context.contest, context.now);
    let value: Record<string, unknown>;
    if (editor === "timing")
      value = {
        action: "timing",
        privateAt:
          savedPhase === "public" ? formTime(f, "privateAt", savedP) : savedP,
        endAt: formTime(f, "endAt", savedEnd),
      };
    else if (editor === "private")
      value = {
        action: "open-private",
        lockPublic: f.has("lockPublic"),
        revokeChatbot: f.has("revokeChatbot"),
        endAt: formTime(f, "endAt", savedEnd),
      };
    else if (editor === "practice")
      value = {
        action: "practice-open",
        endAt: timestamp(f.get("endAt")),
        publicVisible: f.has("publicVisible"),
        privateVisible: f.has("privateVisible"),
        chatbotEnabled: f.has("chatbotEnabled"),
        chatbotUntil: timestamp(f.get("chatbotUntil")),
        notebookEnabled: f.has("notebookEnabled"),
      };
    else if (editor === "reset")
      value = {
        action: "reset-round",
        keepLeaderboard: f.has("keepLeaderboard"),
      };
    else
      value = {
        action: "chatbot-access",
        enabled: true,
        until: timestamp(f.get("chatbotUntil")),
      };
    setSaveError("");
    if (
      (await send(
        value,
        editor === "reset"
          ? "Đã đặt lại. Bạn có thể bắt đầu thi hoặc mở luyện tập tiếp."
          : "Đã cập nhật lịch và quyền truy cập.",
        context.contest,
      )) !== false
    )
      setEditor(null);
    else
      setSaveError(
        "Chưa lưu được. Đóng hộp thoại để xem thông báo lỗi và mở lại với cấu hình mới nhất.",
      );
  }
  return (
    <div className="round-access-controls">
      <div className="action-row">
        {active && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => openEditor("timing")}
          >
            <Clock3 size={16} />
            Điều chỉnh thời gian
          </button>
        )}
        {phase === "public" && (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() => openEditor("private")}
          >
            <Flag size={16} />
            Chuyển sang private ngay
          </button>
        )}
        {["waiting", "scheduled", "ended"].includes(phase) && (
          <button
            className="btn primary"
            disabled={busy || !data.ready}
            onClick={() => openEditor("practice")}
          >
            <Play size={16} />
            Mở luyện tập tiếp
          </button>
        )}
        {phase === "practice" && (
          <button
            className="btn danger-ghost"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  "Kết thúc luyện tập, khóa nhận bài và quyền chatbot/mở Lab từ web? Pod và kernel tiếp tục chạy.",
                )
              )
                void send(
                  { action: "practice-close" },
                  "Đã kết thúc luyện tập.",
                );
            }}
          >
            Kết thúc luyện tập
          </button>
        )}
        <button
          className="btn"
          disabled={busy}
          onClick={() => openEditor("reset")}
        >
          <RotateCcw size={16} />
          Đặt lại / mở lượt mới
        </button>
      </div>
      {["waiting", "scheduled", "public"].includes(phase) && (
        <form
          className="private-policy-form"
          key={`${c.id}-${policy.lockPublic}-${policy.revokeChatbot}`}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void send(
              {
                action: "private-policy",
                lockPublic: f.has("lockPublic"),
                revokeChatbot: f.has("revokeChatbot"),
              },
              "Đã lưu lựa chọn khi private bắt đầu.",
            );
          }}
        >
          <fieldset disabled={busy}>
            <legend>Khi private bắt đầu</legend>
            <label className="check-label">
              <input
                type="checkbox"
                name="lockPublic"
                defaultChecked={policy.lockPublic}
              />
              Khóa nộp public
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                name="revokeChatbot"
                defaultChecked={policy.revokeChatbot}
              />
              Thu hồi quyền chatbot
            </label>
            <button className="btn small-btn">
              Lưu lựa chọn chuyển private
            </button>
          </fieldset>
        </form>
      )}
      <h3>Quyền hiện tại của thí sinh</h3>
      <div className="table-scroll">
        <table className="round-access-table">
          <thead>
            <tr>
              <th>Hạng mục</th>
              <th>Hiển thị</th>
              <th>Quyền sử dụng</th>
              <th>Trạng thái thực tế</th>
            </tr>
          </thead>
          <tbody>
            {(["public", "private"] as const).map((split) => {
              const config = submissionPolicy(c, split),
                access = submissionAccess(c, data.serverNow, split);
              return (
                <tr key={split}>
                  <th scope="row">
                    {split === "public" ? "Public" : "Private"} submission
                  </th>
                  <td>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        aria-label={`Hiện ${split} submission`}
                        checked={config.visible}
                        disabled={busy}
                        onChange={(e) =>
                          void send(
                            {
                              action: "submission-access",
                              split,
                              ...config,
                              visible: e.target.checked,
                            },
                            "Đã đổi hiển thị khu vực nộp.",
                          )
                        }
                      />
                      Hiện
                    </label>
                  </td>
                  <td>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        aria-label={`Mở nhận bài nộp ${split}`}
                        checked={access.enabled}
                        disabled={busy}
                        onChange={(e) =>
                          void send(
                            {
                              action: "submission-access",
                              split,
                              ...config,
                              enabled: e.target.checked,
                            },
                            "Đã đổi quyền nhận bài.",
                          )
                        }
                      />
                      Nhận bài nộp
                    </label>
                  </td>
                  <td>
                    {!access.visible
                      ? "Đã ẩn"
                      : !access.available
                        ? "Chưa mở / hết giờ"
                        : access.accepting
                          ? "Đang nhận bài"
                          : "Đang khóa"}
                  </td>
                </tr>
              );
            })}
            <tr>
              <th scope="row">Chatbot</th>
              <td>—</td>
              <td>
                <div className="action-row">
                  <button
                    className="btn small-btn"
                    disabled={busy || !active}
                    onClick={() => openEditor("chatbot")}
                  >
                    Cấp / hẹn giờ
                  </button>
                  <button
                    className="btn small-btn"
                    disabled={busy || !active}
                    onClick={() =>
                      void send(
                        {
                          action: "chatbot-access",
                          enabled: false,
                          until: null,
                        },
                        "Đã thu hồi quyền chatbot.",
                      )
                    }
                  >
                    Thu hồi
                  </button>
                </div>
              </td>
              <td>
                {chatbotAllowed(c, data.serverNow) ? "Được phép" : "Đang khóa"}
                {c.chatbotAllowed !== false && c.chatbotUntil != null && (
                  <small>Thu hồi: {when(c.chatbotUntil)}</small>
                )}
              </td>
            </tr>
            <tr>
              <th scope="row">JupyterLab</th>
              <td>—</td>
              <td>
                <label className="check-label">
                  <input
                    type="checkbox"
                    aria-label="Cho phép mở JupyterLab từ web"
                    checked={c.notebookAllowed !== false}
                    disabled={busy}
                    onChange={(e) =>
                      void send(
                        {
                          action: "notebook-access",
                          enabled: e.target.checked,
                        },
                        "Đã đổi quyền mở JupyterLab từ web.",
                      )
                    }
                  />
                  Cho phép mở từ web
                </label>
              </td>
              <td>
                {notebookAllowed(c, data.serverNow) ? "Được phép" : "Đang khóa"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="muted">
        Ẩn khu vực nộp vẫn giữ dữ liệu đã mở, lịch sử và BXH. Quyền JupyterLab
        chỉ điều khiển mở từ web, không ngắt tab đã mở hoặc kernel. Cấp quyền
        không tự tạo Pod.
      </p>
      {editor && (
        <Dialog
          title={
            editor === "timing"
              ? "Điều chỉnh thời gian"
              : editor === "private"
                ? "Chuyển sang private ngay"
                : editor === "practice"
                  ? "Mở luyện tập tiếp"
                  : editor === "reset"
                    ? "Đặt lại / mở lượt mới"
                    : "Cấp quyền chatbot"
          }
          close={() => {
            if (!busy) setEditor(null);
          }}
        >
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              {saveError && <p role="alert">{saveError}</p>}
              {editor === "reset" && <ResetFields />}
              {editor === "timing" && (
                <TimingFields phase={phase} privateAt={p} endAt={end} />
              )}
              {editor === "private" && (
                <>
                  <p>
                    Private sẽ bắt đầu ngay. Giờ kết thúc mặc định được giữ
                    nguyên.
                  </p>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      name="lockPublic"
                      defaultChecked={policy.lockPublic}
                    />
                    Khóa nộp public
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      name="revokeChatbot"
                      defaultChecked={policy.revokeChatbot}
                    />
                    Thu hồi quyền chatbot
                  </label>
                  <EndField endAt={end} />
                </>
              )}
              {editor === "practice" && (
                <>
                  <p>
                    Tiếp tục lượt cũ, giữ kết quả, BXH và số lượt đã dùng.
                    Public và private cùng nhận bài; tăng quota riêng nếu cần.
                  </p>
                  {["waiting", "scheduled"].includes(phase) && (
                    <p>
                      Mở luyện tập ngay mà không cần bắt đầu thi theo giai đoạn.
                      {phase === "scheduled" &&
                        " Lịch bắt đầu thi đã hẹn sẽ được hủy."}
                    </p>
                  )}
                  <EndField endAt={null} />
                  <label className="check-label">
                    <input
                      type="checkbox"
                      name="publicVisible"
                      defaultChecked
                    />
                    Hiện khu vực nộp public
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      name="privateVisible"
                      defaultChecked
                    />
                    Hiện khu vực nộp private
                  </label>
                  <label className="check-label">
                    <input type="checkbox" name="chatbotEnabled" />
                    Cấp quyền chatbot
                  </label>
                  <ChatbotTime until={null} />
                  <label className="check-label">
                    <input
                      type="checkbox"
                      name="notebookEnabled"
                      defaultChecked
                    />
                    Cho phép mở JupyterLab từ web
                  </label>
                  <p>
                    Chatbot không bị thu hồi theo mốc private trong chế độ luyện
                    tập.
                  </p>
                </>
              )}
              {editor === "chatbot" && (
                <>
                  <p>
                    Cấp quyền trong thời gian vòng đang mở. Model có thể cần
                    thời gian nạp lại trên GPU.
                  </p>
                  <ChatbotTime
                    until={
                      c.chatbotUntil != null && c.chatbotUntil > data.serverNow
                        ? c.chatbotUntil
                        : null
                    }
                  />
                </>
              )}
              <button className="btn primary">
                {busy ? "Đang lưu…" : "Xác nhận"}
              </button>
            </fieldset>
          </form>
        </Dialog>
      )}
    </div>
  );
}
function ResetFields() {
  const [keep, setKeep] = useState(true);
  return (
    <>
      <p>
        Đưa vòng về trạng thái chưa mở. Sau đó có thể bắt đầu thi hoặc mở luyện
        tập ngay.
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          name="keepLeaderboard"
          checked={keep}
          onChange={(e) => setKeep(e.target.checked)}
        />
        Giữ BXH và bài nộp hiện tại
      </label>
      <p role="status">
        {keep
          ? "Giữ kết quả, lịch sử bài nộp và số lượt quota đã dùng. Lịch và quyền truy cập được đặt lại."
        : "Tạo lượt mới với BXH trống và số lượt nộp đã dùng về 0. Dữ liệu lượt trước vẫn lưu riêng."}
      </p>
      <p>Đăng ký tham gia, Pod và tệp làm việc được giữ nguyên.</p>
    </>
  );
}
function EndField({ endAt }: { endAt: number | null }) {
  const [value, setValue] = useState(localTime(endAt));
  return (
    <label>
      Kết thúc (UTC+7)
      <input
        type="datetime-local"
        name="endAt"
        step="1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <small>
        {value
          ? `Dự kiến: ${when(timestamp(value)!)}`
          : "Không giới hạn thời gian"}
        . Để trống để mở vô thời hạn.
      </small>
    </label>
  );
}
function ChatbotTime({ until }: { until: number | null }) {
  return (
    <label>
      Tự thu hồi chatbot (UTC+7)
      <input
        type="datetime-local"
        name="chatbotUntil"
        step="1"
        defaultValue={localTime(until)}
      />
      <small>
        Để trống: dùng đến khi vòng/luyện tập kết thúc hoặc admin thu hồi.
      </small>
    </label>
  );
}
function TimingFields({
  phase,
  privateAt,
  endAt,
}: {
  phase: string;
  privateAt: number | null;
  endAt: number | null;
}) {
  const [p, setP] = useState(localTime(privateAt));
  return (
    <>
      <p>
        Lịch hiện tại: private{" "}
        {privateAt == null ? "do admin mở" : when(privateAt)}; kết thúc{" "}
        {endAt == null ? "không giới hạn" : when(endAt)}.
      </p>
      {phase === "public" && (
        <label>
          Mở private (UTC+7)
          <input
            type="datetime-local"
            name="privateAt"
            step="1"
            value={p}
            onChange={(e) => setP(e.target.value)}
          />
          <small>
            {p
              ? `Dự kiến: ${when(timestamp(p)!)}`
              : "Do quản trị viên chuyển thủ công"}
            . Để trống để bỏ lịch chuyển tự động.
          </small>
        </label>
      )}
      {phase === "private" && (
        <p>Private đã bắt đầu; chỉ điều chỉnh thời điểm kết thúc.</p>
      )}
      <EndField endAt={endAt} />
    </>
  );
}
