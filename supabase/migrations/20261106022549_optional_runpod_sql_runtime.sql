-- Core/Groq state; Runpod retains its existing Redis runtime.
create table arena.sessions (ns text not null, token_hash text not null, user_id text not null, expires_at bigint not null, primary key(ns,token_hash));
create table arena.rate_counters (ns text not null, id text not null, count integer not null check(count>=0), expires_at bigint not null, primary key(ns,id));
create table arena.runtime_leases (ns text not null, id text not null, token text not null, expires_at bigint not null, primary key(ns,id));
create table arena.runtime_signals (ns text not null, id text not null, value text not null, expires_at bigint not null, primary key(ns,id));
create table arena.chat_lanes (ns text not null, group_id text not null, run_id text not null, audience text not null, served_at bigint not null default 0, primary key(ns,group_id,run_id,audience));
-- Only bounded, compressed submission fallbacks, never datasets/model files.
create table arena.submission_files (ns text not null, id text not null, gzip bytea not null check(octet_length(gzip)<=4000000), primary key(ns,id));
create index runtime_history_active_chat on arena.runtime_history(ns,(payload->>'groupId'),run_id,status,observed_at,id)
  where kind='chat-job' and status in ('queued','claimed','running','uncertain');
create index runtime_history_pending_audience on arena.runtime_history(ns,run_id,(payload->>'audience'))
  where kind='chat-job' and status in ('queued','claimed','running','uncertain');
do $$ declare t text; begin
  foreach t in array array['sessions','rate_counters','runtime_leases','runtime_signals','chat_lanes','submission_files'] loop
    execute format('alter table arena.%I enable row level security',t);
    execute format('grant select,insert,update,delete on arena.%I to arena_backend',t);
    execute format('create policy backend_namespace on arena.%I to arena_backend using (ns=current_setting(''arena.namespace'',true)) with check (ns=current_setting(''arena.namespace'',true))',t);
    if t in ('sessions','rate_counters','runtime_leases','runtime_signals') then
      execute format('create index %I on arena.%I(ns,expires_at)',t||'_expiry',t);
    end if;
  end loop;
end $$;
