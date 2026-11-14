-- ASC Platform: Google connection (Search Console + Business Profile) and client dashboards.

-- The one Google account ASC connects (yours). Service role only.
create table if not exists google_auth (
  id integer primary key default 1 check (id = 1),
  email text,
  refresh_token text not null,
  scopes text,
  connected_at timestamptz not null default now()
);
alter table google_auth enable row level security;

-- Short-lived cache of Google API answers, so dashboards load fast and stay within quotas.
create table if not exists google_cache (
  site_id uuid not null references sites(id) on delete cascade,
  key text not null,
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (site_id, key)
);
alter table google_cache enable row level security;

alter table sites add column if not exists gsc_property text;
alter table sites add column if not exists gbp_location text;
alter table sites add column if not exists gbp_title text;

-- Private link to each client's live dashboard.
alter table clients add column if not exists dashboard_token text unique default encode(gen_random_bytes(16), 'hex');
update clients set dashboard_token = encode(gen_random_bytes(16), 'hex') where dashboard_token is null;
