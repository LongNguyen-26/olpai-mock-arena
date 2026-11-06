-- Private backend-only mapping. Existing accounts, teams and admin roles stay intact.
create table arena.auth_identities (
  ns text not null,
  subject uuid not null,
  user_id text not null,
  created_at bigint not null,
  primary key (ns, subject),
  unique (ns, user_id),
  foreign key (ns, user_id) references arena.users(ns,id)
);
alter table arena.auth_identities enable row level security;
grant select,insert,update,delete on arena.auth_identities to arena_backend;
revoke all on arena.auth_identities from anon,authenticated;
create policy backend_namespace on arena.auth_identities to arena_backend
  using (ns=current_setting('arena.namespace',true))
  with check (ns=current_setting('arena.namespace',true));
