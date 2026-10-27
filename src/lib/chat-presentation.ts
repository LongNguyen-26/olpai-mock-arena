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
