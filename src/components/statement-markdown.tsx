import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export default function StatementMarkdown({children}:{children:string}) {
  return <Markdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{trust:false,strict:"ignore"}]]} urlTransform={(url,key)=>key==="src"&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(url)?url:defaultUrlTransform(url)}>{children}</Markdown>;
}
