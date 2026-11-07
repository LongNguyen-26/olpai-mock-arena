/** Read-only check against the original local release files; no training or cloud writes. */
import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { packageWebMetadata } from "./package-web-metadata";
import { packagePresentation } from "../src/lib/package-resources";
import { taskStatements } from "../src/lib/statements";
import StatementMarkdown from "../src/components/statement-markdown";
import manifest from "../src/content/package-presentation.json";
import formulas from "../src/content/statement-math.json";
import type { ContestPackage } from "../src/lib/types";

async function main() {
 const checks=[];
 for(const dir of ["Regional_01/web_ready/release_20261106","Arena_04/web_ready/release_20261030"]) {
  const root=join("../statements",dir),pkg=JSON.parse(await readFile(join(root,"handoff/package-config.json"),"utf8")) as ContestPackage;
  const plan=JSON.parse(await readFile(join(root,"handoff/upload-plan.json"),"utf8"));
  const known=(manifest as Record<string,{assets:Record<string,{sha256:string}>}>)[pkg.version];
  for(const [name,asset] of Object.entries(known.assets)) {
   const current=pkg.assets.find(a=>a.name===name)!;assert.equal(current.sha256,asset.sha256);
   const object=plan.objects.find((o:{key:string})=>o.key===current.key);assert.ok(object);
   const hash=createHash("sha256");for await(const chunk of createReadStream(join(root,object.local)))hash.update(chunk);assert.equal(hash.digest("hex"),asset.sha256,name);
  }
  for(const formula of (formulas as Record<string,{source:string}[]>)[pkg.version])assert.ok(pkg.tasks!.some(t=>t.content.includes(formula.source)),"Missing source formula");
  for(const task of taskStatements(pkg)){const html=renderToStaticMarkup(createElement(StatementMarkdown,{children:task.content}));assert.ok(html.includes('class="katex-display"'));assert.ok(!html.includes('class="katex-error"'));}
  if(dir.startsWith("Regional")) {
   const prepared=await packageWebMetadata(pkg,root,plan.objects),actual=packagePresentation(pkg);
   for(const asset of actual.assets.filter(a=>a.baselineNotebooks))assert.deepEqual(prepared.assets.find(a=>a.key===asset.key)?.baselineNotebooks,asset.baselineNotebooks);
  }
  checks.push({version:pkg.version,checksums:Object.keys(known.assets).length,mathTasks:pkg.tasks!.length});
 }
 console.log(JSON.stringify({result:"PASS",checks,productionWrites:0,trainingRuns:0}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:"Presentation check failed");process.exitCode=1;});
