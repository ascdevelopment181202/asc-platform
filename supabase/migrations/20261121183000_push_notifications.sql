-- ASC Platform: push notifications in the client app. Already applied to the live project on 21 Nov 2026.

-- Phones that have switched on notifications in a client's app
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);
create index if not exists push_subscriptions_client_idx on public.push_subscriptions (client_id);

-- Server-generated keys (VAPID for web push). Created by the app on first use; never leaves the server.
create table if not exists public.app_secrets (
  name text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
alter table public.app_secrets enable row level security;
