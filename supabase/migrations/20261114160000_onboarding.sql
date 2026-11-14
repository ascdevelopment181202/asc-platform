-- ASC Platform: client onboarding module
-- Run in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

do $$ begin
  create type client_status as enum ('awaiting_form', 'building', 'live', 'past_due', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  stripe_customer_id text unique,
  stripe_subscription_id text,
  email text not null,
  first_name text,
  full_name text,
  phone text,
  business_name text,
  status client_status not null default 'awaiting_form',
  onboarding_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  paid_at timestamptz not null default now(),
  form_submitted_at timestamptz,
  build_due_at timestamptz,
  launched_at timestamptz,
  live_url text,
  cancelled_at timestamptz,
  notes text
);

create table if not exists onboarding_submissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  data jsonb not null,
  logo_path text,
  photo_paths text[] not null default '{}'
);

-- Every automated message or internal event, so nothing is sent twice.
create table if not exists client_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  detail jsonb,
  unique (client_id, kind)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  title text not null,
  due_at timestamptz,
  done_at timestamptz
);

-- Stripe sends events more than once; this makes the webhook idempotent.
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

create index if not exists clients_status_idx on clients(status);
create index if not exists tasks_open_idx on tasks(done_at) where done_at is null;

-- Only the server (service role key) touches these tables.
alter table clients enable row level security;
alter table onboarding_submissions enable row level security;
alter table client_messages enable row level security;
alter table tasks enable row level security;
alter table stripe_events enable row level security;

-- Private bucket for logos and job photos. Uploads use signed URLs issued by the server.
insert into storage.buckets (id, name, public)
values ('client-assets', 'client-assets', false)
on conflict (id) do nothing;
