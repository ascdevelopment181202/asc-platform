-- Clear review schedule per client, and reactivation campaigns.

-- {"firstDelayMin":5,"bookingDelayMin":15,"reminderDays":[10,20],"laterDays":90,"onPaid":true,"onStage":true}
alter table public.clients add column if not exists review_settings jsonb not null default '{}'::jsonb;

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  body text not null,                 -- with {name} etc. as the owner wrote it
  audience jsonb not null default '{}'::jsonb,
  recipients integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists campaigns_client_idx on public.campaigns (client_id, created_at desc);
alter table public.campaigns enable row level security;

-- Messages the owner saved to reuse.
create table if not exists public.campaign_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.campaign_templates enable row level security;

alter table public.outbox add column if not exists campaign_id uuid references public.campaigns(id) on delete cascade;
create index if not exists outbox_campaign_idx on public.outbox (campaign_id) where campaign_id is not null;
