alter table arena.state add column configuration jsonb not null default '{}'::jsonb;
