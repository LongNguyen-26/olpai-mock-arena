"use client";
import { useEffect, useRef, useState } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { api, type ViewProps } from "./arena-client";
import type { GroqModel } from "@/lib/groq";

export default function GroqAdmin({ data, refresh }: { data: ViewProps["data"]; refresh: () => Promise<void> }) {
  const [credential, setCredential] = useState<{ configured: boolean; masked: string } | null>(null);
  const [apiKey, setApiKey] = useState(""), [models, setModels] = useState<GroqModel[]>([]), [model, setModel] = useState("");
  const [roundId, setRoundId] = useState(data.contest?.roundId ?? data.rounds[0]?.id ?? "");
  const [scope, setScope] = useState<"team" | "all">("all"), [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("Chatbot Groq"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [total, setTotal] = useState(2000), [input, setInput] = useState(1800), [output, setOutput] = useState(1024);
  const [mode, setMode] = useState<"turn" | "session">("turn"), [parallel, setParallel] = useState(2), [rpm, setRpm] = useState(20);
  const allocation = useRef({ signature: "", id: "" });
  const run = async (fn: () => Promise<unknown>, success: string) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await fn(); setNotice(success); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active = true;
    void api("workspace/groq/credential").then(v => { if (active) setCredential(v); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setTeams([]); setTeamId("");
    if (roundId) void api("workspace/teams", undefined, roundId).then(v => { if (active) setTeams(v.teams); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [roundId]);
  const loadModels = async () => {
    const result: { models: GroqModel[] } = await api("workspace/groq/models");
    setModels(result.models); setModel(current => result.models.some(m => m.id === current) ? current : result.models[0]?.id ?? "");
  };
  return <section className="panel gpu-panel groq-admin" aria-label="Cấp phát Chatbot Groq">
    <h2><KeyRound size={21} /> Kết nối Groq</h2>
    <p>Dùng API key Groq của bạn để cấp chatbot cho đội thi. Prompt và lịch sử cần thiết được gửi tới Groq để tạo phản hồi.</p>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert" role="status">{notice}</div>}
    <form className="gpu-key-form" onSubmit={e => { e.preventDefault(); void run(async () => {
      const next = await api("workspace/groq/credential", { apiKey });
      setCredential(next); setApiKey(""); setModels([]); setModel(""); await loadModels();
    }, "Đã kiểm tra và lưu Groq API key."); }}>
      <label>Groq API key <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} autoComplete="new-password" minLength={10} maxLength={300} required disabled={busy} placeholder={credential?.configured ? `Đã lưu ${credential.masked} · nhập khóa mới để thay` : "Nhập API key của admin"} /></label>
      <button className="btn primary" disabled={busy || !credential}>Kiểm tra và lưu khóa</button>
      {credential?.configured && <button className="btn" type="button" disabled={busy} onClick={() => {
        if (window.confirm("Xóa Groq API key của bạn? Các chatbot dùng khóa này sẽ ngừng nhận prompt.")) void run(async () => {
          setCredential(await api("workspace/groq/credential", { apiKey: null })); setModels([]); setModel("");
        }, "Đã xóa Groq API key.");
      }}>Xóa khóa</button>}
    </form>
    <p className="gpu-hint">Khóa được mã hóa và chỉ tài khoản admin của bạn quản lý. Trước khi thay/xóa khóa, tạm ngừng các chatbot Groq và hoàn tất hoặc đối soát các lượt còn lại.</p>
    <form className="groq-allocation-form" onSubmit={e => { e.preventDefault(); void run(async () => {
      const value = { name, model, scope, teamId: scope === "team" ? teamId : null, roundId,
        policy: { tokenLimitMode: mode, sessionTokenLimit: total, inputTokenLimit: input, outputTokenLimit: output }, parallel, requestsPerMinute: rpm };
      const signature = JSON.stringify(value);
      if (allocation.current.signature !== signature) allocation.current = { signature, id: crypto.randomUUID() };
      await api("workspace/groq/deploy", { ...value, id: allocation.current.id });
    }, "Đã cấp phát Chatbot Groq."); }}>
      <h3>Cấp phát Chatbot</h3>
      <div className="groq-form-grid">
        <label>Tên chatbot<input value={name} onChange={e => setName(e.target.value)} minLength={2} maxLength={80} required /></label>
        <label>Model Groq<select aria-label="Model Groq" value={model} onChange={e => setModel(e.target.value)} required disabled={busy || !models.length}>
          {!models.length && <option value="">Làm mới danh sách model để chọn</option>}{models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
        </select></label>
        <label>Vòng luyện<select aria-label="Vòng luyện" value={roundId} onChange={e => setRoundId(e.target.value)} required><option value="">Chọn vòng</option>{data.rounds.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
        <label>Phạm vi<select aria-label="Phạm vi" value={scope} onChange={e => setScope(e.target.value as "team" | "all")}><option value="all">Chung tất cả đội</option><option value="team">Riêng một đội</option></select></label>
        {scope === "team" && <label>Đội được cấp<select value={teamId} onChange={e => setTeamId(e.target.value)} required><option value="">Chọn đội</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
        <label>Giới hạn input/output<select value={mode} onChange={e => setMode(e.target.value as "turn" | "session")}><option value="turn">Theo từng lượt</option><option value="session">Cộng dồn trong phiên</option></select></label>
        <label>Tổng token mỗi phiên<input type="number" min={256} max={16384} value={total} onChange={e => setTotal(Number(e.target.value))} required /></label>
        <label>Trần input<input type="number" min={64} max={8192} value={input} onChange={e => setInput(Number(e.target.value))} required /></label>
        <label>Trần output<input type="number" min={64} max={4096} value={output} onChange={e => setOutput(Number(e.target.value))} required /></label>
        <label>Lượt đồng thời<input type="number" min={1} max={8} value={parallel} onChange={e => setParallel(Number(e.target.value))} required /></label>
        <label>Trần lượt/phút cho API key và model<input type="number" min={1} max={1000} value={rpm} onChange={e => setRpm(Number(e.target.value))} required /></label>
      </div>
      <p className="gpu-hint">Lịch sử gửi lại tính vào input, reasoning tính vào output. Hệ thống giữ ngân sách input theo ngưỡng bảo thủ trước khi gọi và chốt bằng token Groq trả về. Hạn mức thực tế của Groq có thể thấp hơn cấu hình này.</p>
      <div className="gpu-head-actions"><button type="button" className="btn" disabled={busy || !credential?.configured} onClick={() => void run(loadModels, "Đã cập nhật model khả dụng.")}><RefreshCw size={16} /> Làm mới model</button>
        <button className="btn primary" disabled={busy || !credential?.configured || !model || !roundId}>Cấp Chatbot Groq</button></div>
    </form>
  </section>;
}
