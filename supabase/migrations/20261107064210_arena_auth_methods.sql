-- The web role needs capability flags, never auth password hashes or tokens.
-- SECURITY DEFINER is necessary to read auth.users; arena is not exposed to the
-- Data API. Scope the lookup to a mapped, live user in the backend namespace.
create function arena.account_auth_state(p_user_id text)
returns table(email_verified boolean,password_enabled boolean,google_linked boolean)
language sql stable security definer set search_path = '' as $$
  select a.email_confirmed_at is not null,
    coalesce(a.encrypted_password,'') <> '',
    coalesce(a.raw_app_meta_data->'providers' ? 'google',false)
      or exists(select 1 from auth.identities gi where gi.user_id=a.id and gi.provider='google')
  from arena.auth_identities i
  join arena.users u on u.ns=i.ns and u.id=i.user_id and u.deleted_at is null
  join auth.users a on a.id=i.subject
  where i.ns=current_setting('arena.namespace',true) and i.user_id=p_user_id
    and a.deleted_at is null and not coalesce(a.is_anonymous,false)
$$;
revoke all on function arena.account_auth_state(text) from public,anon,authenticated;
grant execute on function arena.account_auth_state(text) to arena_backend;
