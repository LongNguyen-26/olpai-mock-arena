export function normalizeMath(content: string) {
  // Protect code and existing dollar math from delimiter conversion. A fenced
  // block may be unfinished while a reply is being displayed.
  return content
    .split(
      /(`{3,}[^\n]*\n[\s\S]*?(?:`{3,}|$)|~{3,}[^\n]*\n[\s\S]*?(?:~{3,}|$)|`+[^`\n]*`+|\$\$[\s\S]*?\$\$|(?<!\\)\$[^\n$]+\$)/g,
    )
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(
              /\\\[([\s\S]*?)\\\]/g,
              (_, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`,
            )
            .replace(
              /\\\(([\s\S]*?)\\\)/g,
              (_, math: string) => `$${math.trim()}$`,
            )
            // Some saved replies already contain plain brackets around LaTeX.
            .replace(
              /(^|\n)[ \t]*\[[ \t]*([^\n]*\\(?:frac|sum|int|sqrt|begin|text|times)\b[^\n]*)[ \t]*\][ \t]*(?=\n|$)/g,
              (_, before: string, math: string) =>
                `${before}\n$$\n${math.trim()}\n$$\n`,
            ),
    )
    .join("");
}
// Clean model control tokens for display only. Stored history and token accounting
// retain the original response. Preserve code examples containing these strings.
export function assistantText(content: string) {
  const parts = content.split(
    /(`{3,}[^\n]*\n[\s\S]*?`{3,}|~{3,}[^\n]*\n[\s\S]*?~{3,}|`+[^`\n]*`+)/g,
  );
  let thinking = false;
  return parts
    .map((part, i) => {
      if (i % 2) return thinking ? "" : part;
      const chunks = part.split(/(<\/?think\s*>|&lt;\/?think\s*&gt;)/gi);
      return chunks
        .map((chunk) => {
          if (/^(?:<|&lt;)think\s*(?:>|&gt;)$/i.test(chunk)) {
            thinking = true;
            return "";
          }
          if (/^(?:<|&lt;)\/think\s*(?:>|&gt;)$/i.test(chunk)) {
            thinking = false;
            return "";
          }
          return thinking
            ? ""
            : chunk.replace(
                /<\|(?:im_start|im_end|endoftext|eot_id|begin_of_text|end_of_text)\|>|<｜(?:begin▁of▁sentence|end▁of▁sentence)｜>/g,
                "",
              );
        })
        .join("");
    })
    .join("")
    .trim();
}
