alter table arena.auth_identities add column needs_name boolean not null default false;
alter table arena.auth_identities add column name_confirmed_at bigint;
