import { db,key } from "./db";
import { usingPostgres,namespace,query,sqlTransaction,bumpRevision } from "./sql";
import { readRuntimeHistory } from "./runtime-authority";
import { memoRead,inReadScope } from "./read-scope";
import type { Workspace,WorkspaceTemplate } from "./workspace-domain";
import type { ChatGroup } from "./chat-groups";

export async function readGpuCredential(owner:string):Promise<string|null> {
  if(!usingPostgres()) return db().get<string>(key(`gpu:credential:${owner}`));
  return (await query("select ciphertext from arena.gpu_credentials where ns=$1 and owner_id=$2",[namespace(),owner]))[0]?.ciphertext as string??null;
}
export async function saveGpuCredential(owner:string,ciphertext:string) {
  if(!usingPostgres()) { await db().set(key(`gpu:credential:${owner}`),ciphertext); return; }
  await sqlTransaction(async client=>{
    await client.query("insert into arena.gpu_credentials(ns,owner_id,ciphertext) values($1,$2,$3) on conflict(ns,owner_id) do update set ciphertext=excluded.ciphertext",[namespace(),owner,ciphertext]);
  },true);
}
export async function readWorkspaceRecords():Promise<Workspace[]> {
  if(usingPostgres()) return readRuntimeHistory<Workspace>("workspace");
  const ids=await db().smembers<string[]>(key("gpu:workspaces"));
  return ids.length?(await db().mget<(Workspace|null)[]>(...ids.map(id=>key(`gpu:workspace:${id}`)))).filter((w):w is Workspace=>!!w):[];
}
export async function readWorkspaceRecord(id:string) {
  if(!usingPostgres()) return db().get<Workspace>(key(`gpu:workspace:${id}`));
  if(inReadScope())return (await readWorkspaceRecords()).find(w=>w.id===id)??null;
  return (await readRuntimeHistory<Workspace>("workspace",id))[0]??null;
}
export async function readGroupRecord(id:string) {
  if(!usingPostgres()) return db().get<ChatGroup>(key(`gpu:chat-group:${id}`));
  if(inReadScope())return (await readRuntimeHistory<ChatGroup>("chat-group")).find(g=>g.id===id)??null;
  return (await readRuntimeHistory<ChatGroup>("chat-group",id))[0]??null;
}
export async function readGroupIds() {
  if(!usingPostgres()) return db().smembers<string[]>(key("gpu:chat-groups"));
  return (await readRuntimeHistory<ChatGroup>("chat-group")).map(g=>g.id);
}
export async function readSqlTemplates(owner:string):Promise<Record<string,WorkspaceTemplate>> {
  return memoRead(`templates:${owner}`,async()=>{
  const state=(await query("select configuration from arena.state where ns=$1",[namespace()]))[0]?.configuration;
  let store=state?.templatesShared?"shared":`owner:${owner}`;
  let rows=await query("select id,configuration from arena.gpu_templates where ns=$1 and store=$2",[namespace(),store]);
  if(!state?.templatesShared&&!rows.length) { store="legacy"; rows=await query("select id,configuration from arena.gpu_templates where ns=$1 and store=$2",[namespace(),store]); }
  return Object.fromEntries(rows.map(r=>[r.id,r.configuration as WorkspaceTemplate]));
  });
}
export async function putSqlTemplate(t:WorkspaceTemplate,store="shared") {
  await query(`insert into arena.gpu_templates(ns,store,id,name,revision,configuration) values($1,$2,$3,$4,$5,$6)
    on conflict(ns,store,id) do update set name=excluded.name,revision=excluded.revision,configuration=excluded.configuration`,[namespace(),store,t.id,t.name,t.revision??null,JSON.stringify(t)]);
}
export async function setSqlTemplatesShared() {
  await query("update arena.state set configuration=jsonb_set(configuration,'{templatesShared}','true'::jsonb) where ns=$1",[namespace()]);
}
