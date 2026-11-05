-- Applied through the connected Supabase plugin. Password is generated inside
-- Postgres, retrieved once into an ignored backend env file, then removed by
-- the following migration. No password literal belongs in migration history.
create table arena._backend_bootstrap(id boolean primary key default true check(id), password text not null);
revoke all on arena._backend_bootstrap from public,anon,authenticated,arena_backend;
alter table arena._backend_bootstrap enable row level security;
do $$ declare p text; begin
  p:=replace(gen_random_uuid()::text||gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  execute format('alter role arena_backend login password %L',p);
  insert into arena._backend_bootstrap(id,password) values(true,p);
end $$;
