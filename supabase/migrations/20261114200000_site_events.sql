-- ASC Platform: visit and call-click counts for client websites (behind the monthly report).
-- One row per site, day, kind, page and traffic source, so the table stays small.

create table if not exists site_events (
  site_id uuid not null references sites(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('view', 'call')),
  path text not null,
  source text not null,
  count integer not null default 0,
  primary key (site_id, day, kind, path, source)
);

alter table site_events enable row level security;

-- Note for the next monthly report ("What we did this month"), cleared once sent.
alter table clients add column if not exists report_note text;

create or replace function track_site_event(p_site uuid, p_kind text, p_path text, p_source text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into site_events (site_id, day, kind, path, source, count)
  select p_site, (now() at time zone 'Europe/London')::date, p_kind, left(p_path, 200), p_source, 1
  where exists (select 1 from sites where id = p_site and published)
  on conflict (site_id, day, kind, path, source) do update set count = site_events.count + 1;
$$;

revoke execute on function track_site_event(uuid, text, text, text) from public, anon, authenticated;
