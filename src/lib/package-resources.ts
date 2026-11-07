import manifest from "@/content/package-presentation.json";
import type { Asset, ContestPackage } from "./types";

type LegacyPresentation={generalInstructions?:string;useStatementAsGeneral?:boolean;attributions?:string;assets:Record<string,{sha256:string;kind:string;baselineNotebooks?:string[]}>};
export function packagePresentation(pkg:ContestPackage) {
  const legacy=(manifest as Record<string,LegacyPresentation>)[pkg.version];
  return {
    generalInstructions:pkg.webPresentation?.generalInstructions??legacy?.generalInstructions??(legacy?.useStatementAsGeneral?pkg.statement:undefined),
    attributions:pkg.webPresentation?.attributions??legacy?.attributions,
    assets:pkg.assets.map(asset=>{
      const known=legacy?.assets[asset.name];
      return known?.sha256===asset.sha256?{...asset,kind:known.kind as Asset["kind"],...(known.baselineNotebooks?{baselineNotebooks:known.baselineNotebooks}:{})}:asset;
    }),
  };
}
export function downloadableAssets(pkg:ContestPackage) {
  const presentation=packagePresentation(pkg);
  return presentation.assets.filter(a=>!(a.kind==="general-instructions"&&presentation.generalInstructions)&&!(a.kind==="attribution"&&presentation.generalInstructions&&presentation.attributions));
}
