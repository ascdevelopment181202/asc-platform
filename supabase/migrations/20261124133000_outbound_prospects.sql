-- Clinic outbound pipeline: one row per prospect, moved through status stages.
-- Stages 1 to 3 (source, enrich, AI search check) are written by scripts/clinic-pipeline.mjs,
-- stage 4 and 5 (preview page, drafted email) by /api/cron/prospects.
create table if not exists public.outbound_prospects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vertical text not null,
  status text not null default 'sourced'
    check (status in ('sourced','enriched','checked','built','review_ready','approved','sent','replied','excluded')),
  exclude_reason text,
  -- stage 1: source
  name text not null,
  address text,
  postcode text,
  area text,
  phone text,
  website text,
  place_id text unique,
  rating numeric,
  review_count integer,
  source text,
  -- stage 2: enrich
  owner_name text,
  owner_email text,
  specialties jsonb,
  has_online_booking boolean,
  booking_system text,
  missing_specialty_page text,
  company_name text,
  company_number text,
  is_incorporated boolean,
  claim_sources jsonb,
  enriched_at timestamptz,
  -- stage 3: AI search check
  ai_query text,
  ai_results jsonb,
  ai_named_competitors jsonb,
  ai_mentions_clinic boolean,
  ai_checked_at timestamptz,
  -- stage 4 to 6: asset, email, tracking
  preview_slug text unique,
  preview_url text,
  email_subject text,
  email_body text,
  sent_at timestamptz,
  last_viewed_at timestamptz,
  notes text
);
create index if not exists outbound_prospects_status_idx on public.outbound_prospects (vertical, status);
alter table public.outbound_prospects enable row level security;

alter table public.outbound_prospects
  add column if not exists preview_content jsonb,
  add column if not exists view_count integer not null default 0,
  add column if not exists first_viewed_at timestamptz;
