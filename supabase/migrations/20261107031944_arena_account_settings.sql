-- Private account controls. Timestamps use database time; provider secrets are never stored here.
create table arena.account_profiles (
  ns text not null,
  user_id text not null,
  name_changed_at bigint,
  email_changed_at bigint,
  pending_email text,
  pending_requested_at bigint,
  pending_id uuid,
  primary key (ns,user_id),
  foreign key (ns,user_id) references arena.users(ns,id) on delete cascade
);
create index account_profiles_pending on arena.account_profiles(ns,lower(pending_email)) where pending_email is not null;
alter table arena.account_profiles enable row level security;
grant select,insert,update,delete on arena.account_profiles to arena_backend;
revoke all on arena.account_profiles from public,anon,authenticated;
create policy backend_namespace on arena.account_profiles to arena_backend
  using (ns=current_setting('arena.namespace',true))
  with check (ns=current_setting('arena.namespace',true));

alter table arena.sessions add column auth_provider text check(auth_provider in ('google','email','legacy'));
alter table arena.auth_identities add column google_account boolean not null default false;
-- Existing sessions can still recognize Google accounts until their next login.
update arena.auth_identities i set google_account=true from auth.users u
  where u.id=i.subject and (u.raw_app_meta_data->>'provider'='google' or u.raw_app_meta_data->'providers' ? 'google');
