"use client";
import { useRef, useState, type ComponentPropsWithoutRef } from "react";
import { Check, Copy } from "lucide-react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMath } from "@/lib/chat-presentation";

function CodeBlock({
  children,
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const code = useRef<HTMLPreElement>(null);
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(code.current?.textContent ?? "");
      setStatus("Đã sao chép");
    } catch {
      setStatus("Không sao chép được. Hãy chọn và sao chép mã.");
    }
  }
  return (
    <div className="chat-code-block">
      <div className="chat-code-toolbar">
        <span>Mã nguồn</span>
        <button type="button" onClick={copy} aria-label="Sao chép mã">
          {status === "Đã sao chép" ? <Check size={15} /> : <Copy size={15} />}{" "}
          Sao chép
        </button>
      </div>
      {status && (
        <span className="chat-copy-status" role="status">
          {status}
        </span>
      )}
      <pre {...props} ref={code}>
        {children}
      </pre>
    </div>
  );
}
const components = { pre: CodeBlock };
export default function ChatMarkdown({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: false, trust: false }]]}
      components={components}
    >
      {normalizeMath(children)}
    </Markdown>
  );
}
