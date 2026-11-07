import test from "node:test";
import assert from "node:assert/strict";
import { planSnapshot, type DatabaseSnapshot } from "../src/lib/database-snapshot";
test("auth backups accept pre-onboarding records and preserve explicit name completion in new records",()=>{
  const oldRow=["subject","user",123];
  const snapshot:DatabaseSnapshot={version:1,sourceNamespace:"arena:qa:backup",exportedAt:1,freezeId:null,records:[],sqlRuntime:{auth_identities:[oldRow]},checksum:"fixture"};
  assert.deepEqual(planSnapshot(snapshot).tables.auth_identities,[["subject","user",123,false,null,false]]);
  assert.equal(oldRow.length,3);
  snapshot.sqlRuntime!.auth_identities=[["subject","user",123,false,456],["pending","pending-user",200,true,null]];
  assert.deepEqual(planSnapshot(snapshot).tables.auth_identities,[["subject","user",123,false,456,false],["pending","pending-user",200,true,null,false]]);
  snapshot.sqlRuntime={sessions:[["hash","user",1234]],auth_identities:[["s","u",1,false,2,true]],account_profiles:[["u",1,2,"new@example.test",3,"00000000-0000-0000-0000-000000000001"]]};
  const plan=planSnapshot(snapshot);
  assert.deepEqual(plan.tables.sessions,[["hash","user",1234,null]]);
  assert.deepEqual(plan.tables.auth_identities,snapshot.sqlRuntime.auth_identities);
  assert.deepEqual(plan.tables.account_profiles,snapshot.sqlRuntime.account_profiles.map(row=>[...row,null]));
  snapshot.sqlRuntime.account_profiles=[["u",1,2,null,null,null,"Đại học Bách khoa"]];
  assert.deepEqual(planSnapshot(snapshot).tables.account_profiles,snapshot.sqlRuntime.account_profiles);
});
