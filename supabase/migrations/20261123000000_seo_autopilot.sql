-- SEO autopilot (admin only). Additive: new tables only, nothing existing is changed.
-- Every table is service-role only: RLS on, no policies.

-- One row per client: what the autopilot knows and is allowed to do.
create table if not exists public.seo_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  enabled boolean not null default false,       -- the autopilot runs for this client
  paused boolean not null default false,        -- detectors still run, nothing is applied
  config jsonb not null default '{}'::jsonb,    -- site, connections, fact sheet, plan, auto-apply (see SeoConfig)
  state jsonb not null default '{}'::jsonb,     -- health, connection checks, baseline, last errors (see SeoState)
  tracking_token text not null default encode(gen_random_bytes(8), 'hex'),
  run_claimed_at timestamptz,                   -- a run holds this while it works, so runs never overlap
  last_run_on date,
  last_weekly_on date,
  last_monthly_on date,
  setup_done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists seo_settings_tracking_token on public.seo_settings (tracking_token);
alter table public.seo_settings enable row level security;

-- Weekly rollups (kind: site | top | gbp | bing | speed). week = the Monday. The fixed week 2000-01-03 holds "latest" snapshots.
create table if not exists public.seo_metrics (
  client_id uuid not null references public.clients(id) on delete cascade,
  week date not null,
  kind text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (client_id, week, kind)
);
alter table public.seo_metrics enable row level security;

-- The inbox: one row per thing worth doing.
create table if not exists public.seo_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null,                            -- title_rewrite, answer_block, new_page, gbp_post, review_reply, ...
  type text not null,                            -- badge: Profile | Page | Content | Reviews | Technical | AI search | Manual
  status text not null default 'new' check (status in ('new','approved','applied','dismissed','snoozed','failed','done')),
  dedupe_key text not null,
  score numeric not null default 0,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,     -- evidence, numbers, chart series, value chain, links
  draft jsonb,                                   -- the exact change: before/after, steps for manual tasks
  apply jsonb,                                   -- pull request, preview, screenshots, visual check
  undo jsonb,
  result jsonb,                                  -- 28-day measurement
  goal text,
  dismissed_reason text,
  snoozed_until timestamptz,
  applied_at timestamptz,
  measure_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, dedupe_key)
);
create index if not exists seo_actions_open on public.seo_actions (status, score desc);
alter table public.seo_actions enable row level security;

-- Everything that was changed on a site or profile, with before and after.
create table if not exists public.seo_changes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  action_id uuid references public.seo_actions(id) on delete set null,
  target text not null,                          -- site | profile | review
  summary text not null,
  before jsonb,
  after jsonb,
  undo jsonb,
  auto boolean not null default false,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists seo_changes_client on public.seo_changes (client_id, created_at desc);
alter table public.seo_changes enable row level security;

-- Where the client ranked on Maps for each search. Long-term we keep place IDs and our own rank only;
-- snapshot (names, ratings) is kept on the newest check only and cleared from older rows.
create table if not exists public.seo_competitors (
  client_id uuid not null references public.clients(id) on delete cascade,
  checked_on date not null,
  query text not null,
  client_rank smallint,                          -- null = not in the results
  place_ids text[] not null default '{}',
  snapshot jsonb,
  primary key (client_id, checked_on, query)
);
alter table public.seo_competitors enable row level security;

create table if not exists public.seo_ai_checks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  checked_on date not null,
  provider text not null,                        -- gemini | chatgpt | perplexity | claude
  question text not null,
  named boolean not null,
  sources jsonb not null default '[]'::jsonb,
  excerpt text
);
create index if not exists seo_ai_checks_client on public.seo_ai_checks (client_id, checked_on desc);
alter table public.seo_ai_checks enable row level security;

create table if not exists public.seo_citations (
  client_id uuid not null references public.clients(id) on delete cascade,
  directory text not null,
  status text not null default 'todo' check (status in ('todo','listed','skip')),
  url text,
  checked_at timestamptz,
  primary key (client_id, directory)
);
alter table public.seo_citations enable row level security;

create table if not exists public.seo_ai_usage (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients(id) on delete set null,
  provider text not null,
  model text not null,
  purpose text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_gbp numeric(10,5) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists seo_ai_usage_month on public.seo_ai_usage (created_at);
alter table public.seo_ai_usage enable row level security;

-- 90-day plans and weekly reviews written by the strategist.
create table if not exists public.seo_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('plan','weekly')),
  period date not null,
  content jsonb not null,
  created_at timestamptz not null default now(),
  unique (client_id, kind, period)
);
alter table public.seo_plans enable row level security;

-- Platform-wide state: the global pause, Google update list, playbooks.
create table if not exists public.seo_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.seo_kv enable row level security;

-- First-party site tracking for sites not hosted on the platform. Counts only, no personal data.
create table if not exists public.seo_events (
  client_id uuid not null references public.clients(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('view','call','form','directions')),
  path text not null,
  source text not null,
  count integer not null default 0,
  primary key (client_id, day, kind, path, source)
);
alter table public.seo_events enable row level security;

create or replace function public.track_seo_event(p_token text, p_kind text, p_path text, p_source text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into seo_events (client_id, day, kind, path, source, count)
  select s.client_id, (now() at time zone 'Europe/London')::date, p_kind, left(p_path, 200), left(p_source, 40), 1
  from seo_settings s where s.tracking_token = p_token
  on conflict (client_id, day, kind, path, source) do update set count = seo_events.count + 1;
$$;
revoke execute on function public.track_seo_event(text, text, text, text) from public, anon, authenticated;

-- Claims up to p_limit clients for today's run. A claim older than 20 minutes is treated as abandoned.
create or replace function public.claim_seo_runs(p_today date, p_limit integer)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  update seo_settings set run_claimed_at = now()
  where client_id in (
    select client_id from seo_settings
    where enabled and (last_run_on is null or last_run_on < p_today)
      and (run_claimed_at is null or run_claimed_at < now() - interval '20 minutes')
    order by last_run_on nulls first
    limit p_limit
    for update skip locked
  )
  returning client_id;
$$;
revoke execute on function public.claim_seo_runs(date, integer) from public, anon, authenticated;
