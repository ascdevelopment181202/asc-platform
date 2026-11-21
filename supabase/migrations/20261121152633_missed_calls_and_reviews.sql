-- ASC Platform: missed call text back and post-job Google review requests (Twilio).
-- Already applied to the live project on 21 Nov 2026.

-- Per-client settings
alter table public.clients
  add column if not exists twilio_number text unique,
  add column if not exists owner_mobile text,
  add column if not exists google_review_url text,
  add column if not exists sms_enabled boolean not null default false,
  add column if not exists missed_call_template text,
  add column if not exists missed_call_after_hours_template text,
  add column if not exists review_template text,
  add column if not exists review_followup_template text,
  add column if not exists timezone text not null default 'Europe/London',
  add column if not exists business_hours jsonb not null default '{"start":"08:00","end":"18:00","days":[1,2,3,4,5,6]}'::jsonb,
  add column if not exists last_forwarded_call_at timestamptz;

-- Customers of each client
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  phone text not null,
  name text,
  opted_out_at timestamptz,
  last_review_request_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, phone)
);

-- Every call forwarded to a client's Twilio number (= a missed call)
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  from_number text,
  twilio_call_sid text unique,
  text_sent boolean not null default false,
  skipped_reason text, -- withheld | landline | international | repeat_caller | opted_out | sms_disabled | send_failed
  created_at timestamptz not null default now()
);
create index if not exists calls_client_created_idx on public.calls (client_id, created_at desc);

-- Every outbound SMS
create table if not exists public.sms_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  to_number text not null,
  body text not null,
  kind text not null check (kind in ('missed_call','review','owner_forward','owner_confirm','test')),
  twilio_message_sid text unique,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now()
);
create index if not exists sms_log_client_created_idx on public.sms_log (client_id, created_at desc);

-- Inbound texts from customers
create table if not exists public.replies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  from_number text not null,
  body text,
  twilio_message_sid text unique,
  forwarded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists replies_client_created_idx on public.replies (client_id, created_at desc);

-- Finished jobs that trigger review requests
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  source text not null check (source in ('dashboard','sms','bulk')),
  review_token text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  completed_at timestamptz not null default now(),
  review_clicked_at timestamptz,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz not null default now()
);
create index if not exists jobs_client_created_idx on public.jobs (client_id, created_at desc);

-- Scheduled review texts (one row per step)
create table if not exists public.review_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  step int not null,
  send_at timestamptz not null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  sms_log_id uuid references public.sms_log(id) on delete set null,
  unique (job_id, step)
);
create index if not exists review_messages_due_idx on public.review_messages (send_at) where sent_at is null and cancelled_at is null;

-- RLS on, no public policies: only the server (service role) reads these.
alter table public.contacts enable row level security;
alter table public.calls enable row level security;
alter table public.sms_log enable row level security;
alter table public.replies enable row level security;
alter table public.jobs enable row level security;
alter table public.review_messages enable row level security;
