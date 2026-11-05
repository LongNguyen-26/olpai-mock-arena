-- Separate API providers from the existing Runpod credential ledger.
create table arena.api_credentials (
 ns text not null, owner_id text not null, provider text not null check(provider='groq'),
 configuration jsonb not null, primary key(ns,owner_id,provider)
);
alter table arena.api_credentials enable row level security;
create policy backend_namespace on arena.api_credentials to arena_backend
 using (ns=current_setting('arena.namespace',true))
 with check (ns=current_setting('arena.namespace',true));
grant select,insert,update,delete on arena.api_credentials to arena_backend;
revoke all on arena.api_credentials from public,anon,authenticated;
