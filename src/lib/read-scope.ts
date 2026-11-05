import { AsyncLocalStorage } from "node:async_hooks";

// Deduplicate reads only inside a single read-only response. Never shared across
// requests, users, or mutations; a new response always rechecks current policy.
const scope=new AsyncLocalStorage<Map<string,Promise<unknown>>>();
export const inReadScope=()=>!!scope.getStore();
export function withReadScope<T>(fn:()=>Promise<T>) {
  return scope.getStore()?fn():scope.run(new Map(),fn);
}
export function memoRead<T>(key:string,fn:()=>Promise<T>):Promise<T> {
  const current=scope.getStore();if(!current)return fn();
  let pending=current.get(key) as Promise<T>|undefined;
  if(!pending){pending=fn();current.set(key,pending);}
  return pending;
}
