import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { downloadableAssets,packagePresentation } from "../src/lib/package-resources";
import { packageSchema } from "../src/lib/package-schema";
import StatementMarkdown from "../src/components/statement-markdown";
import manifest from "../src/content/package-presentation.json";
import type { ContestPackage,Asset } from "../src/lib/types";

const asset=(name:string,extra:Partial<Asset>={}):Asset=>({name,key:`packages/future/${name}`,phase:"public",bytes:12,sha256:"a".repeat(64),description:"",...extra});
const future:ContestPackage={version:"future",title:"Future package",statement:"",tasks:[{id:"1",title:"A",content:"A"},{id:"2",title:"B",content:"B"}],assets:[],judges:{"1":{public:"packages/future/1",private:"packages/future/2"},"2":{public:"packages/future/3",private:"packages/future/4"}},importedAt:0};

test("Regional metadata is checksum-bound, preserves the combined PDF, and never labels private ZIPs",()=>{
 const version="regional-01-82a84e389db4",known=manifest[version];
 const assets=Object.entries(known.assets).map(([name,a])=>asset(name,{sha256:a.sha256,phase:name.includes("private")?"private":"public"}));
 const pkg={...future,version,assets};const result=downloadableAssets(pkg);
 assert.ok(result.some(a=>a.name==="Bo_de_Regional_01.pdf"&&a.kind==="statement"));
 assert.deepEqual(result.find(a=>a.name==="Tac_vu_2.zip")?.baselineNotebooks,["baseline.ipynb"]);
 assert.deepEqual(result.find(a=>a.name==="Tac_vu_1.zip")?.baselineNotebooks,["baseline_subtask1.ipynb","baseline_subtask2.ipynb"]);
 assert.ok(result.filter(a=>a.phase==="private").every(a=>!a.baselineNotebooks));
 assert.equal(downloadableAssets({...pkg,assets:[asset("Tac_vu_2.zip") ]})[0].baselineNotebooks,undefined);
 assert.equal(pkg.assets[0].kind,undefined);
});
test("inline instructions and credits replace only their separate files and leave older releases intact",()=>{
 const version="arena-04-standardized-20261030-67ee96a06f0f",known=manifest[version];
 const assets=Object.entries(known.assets).map(([name,a])=>asset(name,{sha256:a.sha256}));
 const pkg={...future,version,statement:"Original guidance",assets:[...assets,asset("Tac_vu_1.pdf")]};
 assert.deepEqual(downloadableAssets(pkg).map(a=>a.name),["Tac_vu_1.pdf"]);
 assert.equal(packagePresentation(pkg).generalInstructions,pkg.statement);
 assert.match(packagePresentation(pkg).attributions!,/Oxford-IIIT Pet/);
 assert.equal(downloadableAssets({...pkg,version:"older-release"}).length,3);
 const creditsOnly={...future,webPresentation:{version:1 as const,attributions:"Credits"},assets:[asset("credits.txt",{kind:"attribution"})]};
 assert.equal(downloadableAssets(creditsOnly).length,1,"Keep the download when no guidance tab can display the attribution");
});
test("future metadata requires inline source and restricts baseline badges to public ZIPs",()=>{
 const pkg={...future,webPresentation:{version:1 as const,generalInstructions:"Guide"},assets:[asset("Guide.pdf",{kind:"general-instructions"}),asset("data.zip",{baselineNotebooks:["baseline.ipynb"]})]};
 assert.ok(packageSchema.safeParse(pkg).success);
 assert.equal(downloadableAssets(pkg).length,1);
 assert.equal(packageSchema.safeParse({...pkg,webPresentation:undefined}).success,false);
 assert.equal(packageSchema.safeParse({...pkg,assets:[asset("data.zip",{phase:"private",baselineNotebooks:["baseline.ipynb"]})]}).success,false);
 assert.equal(packageSchema.safeParse({...pkg,assets:[asset("data.zip",{baselineNotebooks:["../baseline.ipynb"]})]}).success,false);
});
test("statement math renders fractions, roots and accessible MathML without trusting HTML or links",()=>{
 const html=renderToStaticMarkup(createElement(StatementMarkdown,{children:String.raw`Inline $\frac{1}{2}$.

$$
R=\sqrt{\frac{1}{N}\sum_{i=1}^{N}d_i^2}
$$

<script>alert(1)</script>

$\href{javascript:alert(1)}{click}$`}));
 assert.match(html,/katex-display/);assert.match(html,/<math/);assert.match(html,/mfrac/);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('href="javascript:'));
});
