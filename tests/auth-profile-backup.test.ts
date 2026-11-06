import test from "node:test";
import assert from "node:assert/strict";
import { planSnapshot, type DatabaseSnapshot } from "../src/lib/database-snapshot";
test("auth backups accept pre-onboarding records and preserve explicit name completion in new records",()=>{
  const oldRow=["subject","user",123];
  const snapshot:DatabaseSnapshot={version:1,sourceNamespace:"arena:qa:backup",exportedAt:1,freezeId:null,records:[],sqlRuntime:{auth_identities:[oldRow]},checksum:"fixture"};
  assert.deepEqual(planSnapshot(snapshot).tables.auth_identities,[["subject","user",123,false,null]]);
  assert.equal(oldRow.length,3);
  snapshot.sqlRuntime!.auth_identities=[["subject","user",123,false,456],["pending","pending-user",200,true,null]];
  assert.deepEqual(planSnapshot(snapshot).tables.auth_identities,snapshot.sqlRuntime!.auth_identities);
});
