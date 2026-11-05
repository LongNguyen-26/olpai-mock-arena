-- Application data is private to the trusted Next.js backend, not the Data API.
create schema if not exists arena;
revoke all on schema arena from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='arena_backend') then
    create role arena_backend nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;

create table arena.state (
  ns text primary key,
  revision bigint not null default 0,
  maintenance boolean not null default false,
  imported_at bigint,
  source_checksum text
);
create table arena.users (
  ns text not null, id text not null, username text not null,
  name text not null, password_hash text not null, team_id text,
  created_at bigint not null, deleted_at bigint,
  primary key(ns,id)
);
create unique index users_username on arena.users(ns,lower(username)) where deleted_at is null;
create table arena.admins (
  ns text not null, user_id text not null, is_primary boolean not null default false,
  primary key(ns,user_id), foreign key(ns,user_id) references arena.users(ns,id)
);
create unique index admins_primary on arena.admins(ns) where is_primary;
create table arena.teams (
  ns text not null, id text not null, name text not null, captain_id text not null,
  invite_code text not null, created_at bigint not null, deleted_at bigint,
  primary key(ns,id)
);
create unique index teams_invite_code on arena.teams(ns,lower(invite_code)) where deleted_at is null;
create table arena.team_members (
  ns text not null, team_id text not null, user_id text not null, position integer not null check(position>=0 and position<3),
  primary key(ns,team_id,user_id), unique(ns,user_id), unique(ns,team_id,position),
  foreign key(ns,team_id) references arena.teams(ns,id),
  foreign key(ns,user_id) references arena.users(ns,id)
);
create table arena.team_invites (
  ns text not null, user_id text not null, team_id text not null,
  primary key(ns,user_id,team_id)
);
create table arena.packages (
  ns text not null, id text not null, title text not null, statement text not null,
  imported_at bigint not null, listed boolean not null default false,
  configuration jsonb not null, primary key(ns,id)
);
create table arena.rounds (
  ns text not null, id text not null, run_id text not null, package_id text,
  title text not null, revision bigint not null, chat_epoch bigint not null,
  catalog_score double precision, created_at bigint not null,
  configuration jsonb not null, primary key(ns,id)
);
create index rounds_catalog on arena.rounds(ns,catalog_score desc) where catalog_score is not null;
create index rounds_current_run on arena.rounds(ns,run_id);
create table arena.runs (
  ns text not null, id text not null, round_id text,
  configuration jsonb not null, primary key(ns,id)
);
create table arena.registrations (
  ns text not null, round_id text not null, user_id text not null,
  status text not null check(status in ('approved','pending','rejected')),
  registered_at bigint not null, primary key(ns,round_id,user_id)
);
create index registrations_user on arena.registrations(ns,user_id,round_id);
create table arena.announcements (
  ns text not null, run_id text not null, id text not null,
  text text not null, created_at bigint not null,
  primary key(ns,run_id,id)
);
create index announcements_recent on arena.announcements(ns,run_id,created_at desc);
create table arena.submissions (
  ns text not null, id text not null, run_id text not null,
  actor_id text not null, user_id text not null,
  task text not null check(task in ('1','2','3')),
  split text not null check(split in ('public','private')),
  filename text not null, created_at bigint not null,
  score double precision not null, secondary double precision not null,
  metric double precision, bytes bigint not null, sha256 text not null,
  path text not null, file_storage text, note text not null,
  status text check(status in ('accepted','invalid')),
  error text, admin_test boolean not null default false,
  primary key(ns,id)
);
-- Historical actor/user IDs deliberately have no FK: deleting a roster entry
-- must not destroy or make it impossible to import an old submission ledger.
create index submissions_run_actor on arena.submissions(ns,run_id,actor_id,task,split,created_at desc);
create table arena.submission_quotas (
  ns text not null, run_id text not null, actor_id text not null,
  task text not null, split text not null, used integer not null check(used>=0),
  primary key(ns,run_id,actor_id,task,split)
);
create table arena.requests (
  ns text not null, scope text not null, id text not null,
  fingerprint text not null, result jsonb, expires_at bigint,
  primary key(ns,scope,id)
);
create index requests_expiry on arena.requests(ns,expires_at) where expires_at is not null;
create table arena.gpu_templates (
  ns text not null, store text not null, id text not null,
  name text not null, revision text, configuration jsonb not null,
  primary key(ns,store,id)
);
create table arena.gpu_credentials (
  ns text not null, owner_id text not null, ciphertext text not null,
  primary key(ns,owner_id)
);
create table arena.runtime_history (
  ns text not null, kind text not null, id text not null,
  round_id text, run_id text, owner_id text, status text,
  payload jsonb not null, expires_at bigint, observed_at bigint not null,
  primary key(ns,kind,id)
);
create index runtime_history_round on arena.runtime_history(ns,kind,round_id,observed_at desc);
create index runtime_history_expiry on arena.runtime_history(ns,expires_at) where expires_at is not null;
create table arena.audit_events (
  ns text not null, id text not null, kind text not null,
  payload jsonb not null, created_at bigint not null, primary key(ns,id)
);
-- Unused/legacy metadata retained for an exact import/rollback. Application
-- reads and mutations use the relational tables above, never this archive.
create table arena.legacy_archive (
  ns text not null, source_key text not null, redis_type text not null,
  payload jsonb not null, expires_at bigint, primary key(ns,source_key)
);
create table arena.migration_runs (
  ns text not null, id text not null, status text not null,
  report jsonb not null, created_at bigint not null, primary key(ns,id)
);

grant usage on schema arena to arena_backend;
grant select,insert,update,delete on all tables in schema arena to arena_backend;
-- The backend sets arena.namespace with SET LOCAL on its checked-out client.
-- Namespace isolation also applies to QA, imports, and replayed pool connections.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='arena' loop
    execute format('alter table arena.%I enable row level security',t.tablename);
    execute format('create policy backend_namespace on arena.%I to arena_backend using (ns=current_setting(''arena.namespace'',true)) with check (ns=current_setting(''arena.namespace'',true))',t.tablename);
  end loop;
end $$;
