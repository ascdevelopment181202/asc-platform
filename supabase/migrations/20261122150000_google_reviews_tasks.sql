-- ASC Platform: Google reviews in the client app, and follow-up tasks.

-- Which Google Business Profile the client's reviews come from (works without a platform-built site).
alter table public.clients
  add column if not exists gbp_location text,      -- "locations/123" (Business Information API name)
  add column if not exists gbp_reviews_path text,  -- "accounts/9/locations/123" (resolved for the reviews API)
  add column if not exists gbp_title text,
  add column if not exists reviews_synced_at timestamptz;

create table if not exists public.google_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  google_review_id text not null,
  reviewer_name text,
  rating smallint check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null,
  updated_at timestamptz,
  reply text,
  replied_at timestamptz,
  contact_id uuid references public.contacts(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  seen_at timestamptz,
  unique (client_id, google_review_id)
);
create index if not exists google_reviews_client_idx on public.google_reviews (client_id, created_at desc);
alter table public.google_reviews enable row level security;

alter table public.jobs add column if not exists reviewed_at timestamptz;

create table if not exists public.contact_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  title text not null,
  due_at timestamptz not null,
  done_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists contact_tasks_due_idx on public.contact_tasks (client_id, due_at) where done_at is null;
alter table public.contact_tasks enable row level security;

alter table public.clients
  add column if not exists google_rating numeric(2,1),
  add column if not exists google_review_count integer;

-- Rating over time: one row per client per day the sync runs.
create table if not exists public.google_rating_history (
  client_id uuid not null references public.clients(id) on delete cascade,
  day date not null,
  rating numeric(2,1),
  review_count integer,
  primary key (client_id, day)
);
alter table public.google_rating_history enable row level security;
