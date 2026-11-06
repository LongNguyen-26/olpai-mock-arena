import { Database, LockKeyhole } from "lucide-react";
export function LockedResourceBackdrop() {
  return <div className="locked-resource-backdrop" aria-hidden="true" inert>
    {[0,1,2].map(n=><div className="locked-resource-placeholder" key={n}>
      <Database size={30}/><i/><i/><span/><span/>
    </div>)}
  </div>;
}
export default function LockedResources({title,text}:{title:string;text:string}) {
  return <section className="panel locked-resources">
    <LockedResourceBackdrop/>
    <div className="locked-resource-message"><span className="lock-circle"><LockKeyhole size={27}/></span><h2>{title}</h2><p>{text}</p></div>
  </section>;
}
