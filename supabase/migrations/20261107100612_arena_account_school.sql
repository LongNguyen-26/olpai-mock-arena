-- Optional profile information; existing backend-only namespace RLS is retained.
alter table arena.account_profiles add column school text
  check (school is null or char_length(school) <= 160);
