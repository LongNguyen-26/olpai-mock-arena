import { openPromise } from "yauzl";
import { resolve,relative } from "node:path";
import type { ContestPackage,Asset } from "../src/lib/types";

export async function baselineNotebooksInZip(path:string) {
  const zip=await openPromise(path,{lazyEntries:true,strictFileNames:true});
  const names=new Set<string>();
  try {
    for await(const entry of zip.eachEntry()) {
      const name=entry.fileName.split("/").at(-1)!;
      if(/^baseline[\w.-]*\.ipynb$/.test(name)&&!entry.isEncrypted()&&entry.uncompressedSize>0)names.add(name);
    }
  } finally {zip.close();}
  return [...names].sort();
}

/** Called only after the upload plan's local sizes and SHA-256 hashes pass. */
export async function packageWebMetadata(pkg:ContestPackage,root:string,objects:{key:string;local:string;sha256:string}[]) {
  const generalInstructions=pkg.webPresentation?.generalInstructions??(/^## HƯỚNG DẪN CHUNG\s*$/im.test(pkg.statement)&&!/^# Tác vụ\s+\d/im.test(pkg.statement)?pkg.statement:undefined);
  const attributions=pkg.webPresentation?.attributions;
  const assets:Asset[]=[];
  for(const asset of pkg.assets) {
    const next={...asset};
    delete next.baselineNotebooks;
    if(asset.name.toLowerCase().endsWith(".pdf"))next.kind=asset.name==="Huong_dan_chung.pdf"&&generalInstructions?"general-instructions":"statement";
    if(asset.name.toLowerCase().endsWith(".zip")) {
      next.kind="archive";
      if(asset.phase==="public") {
        const object=objects.find(o=>o.key===asset.key&&o.sha256===asset.sha256);
        if(!object)throw new Error("ZIP missing from verified upload plan: "+asset.name);
        const path=resolve(root,object.local),rel=relative(resolve(root),path);
        if(rel.startsWith("..")||rel.includes(":"))throw new Error("ZIP outside release directory");
        const notebooks=await baselineNotebooksInZip(path);
        if(notebooks.length)next.baselineNotebooks=notebooks;
      }
    }
    assets.push(next);
  }
  return {...pkg,webPresentation:{version:1 as const,generalInstructions,attributions},assets};
}
