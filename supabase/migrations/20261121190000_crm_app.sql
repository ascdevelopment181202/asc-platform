-- ASC Platform: LeadConnector-style CRM in the client app (contacts, templates, notes, calendar,
-- booking link, quotes and invoices, jobs pipeline). Applied to the live project on 21 Nov 2026.

-- Contacts: details, tags and pipeline stage
alter table public.contacts
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists stage text check (stage in ('new','quoted','booked','done','paid','lost')),
  add column if not exists stage_changed_at timestamptz,
  add column if not exists job_value_pence int;
create index if not exists contacts_stage_idx on public.contacts (client_id, stage);

-- Internal notes on a customer (never sent to them)
create table if not exists public.contact_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists contact_notes_contact_idx on public.contact_notes (contact_id, created_at);

-- Saved replies
create table if not exists public.snippets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists snippets_client_idx on public.snippets (client_id);

-- Calendar
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  address text,
  notes text,
  status text not null default 'booked' check (status in ('booked','done','cancelled')),
  source text not null default 'app' check (source in ('app','booking')),
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists appointments_client_time_idx on public.appointments (client_id, starts_at);
create index if not exists appointments_reminder_idx on public.appointments (starts_at) where status = 'booked' and reminder_sent_at is null;

-- Quotes and invoices
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  kind text not null check (kind in ('quote','invoice')),
  number int not null,
  items jsonb not null default '[]',
  vat_percent numeric(5,2) not null default 0,
  subtotal_pence int not null default 0,
  total_pence int not null default 0,
  currency text not null default 'GBP',
  notes text,
  due_date date,
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined','paid','void')),
  public_token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  sent_at timestamptz,
  accepted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, kind, number)
);
create index if not exists documents_client_idx on public.documents (client_id, created_at desc);

-- Per-client app settings: booking link, invoice details, how customers pay
alter table public.clients
  add column if not exists booking_token text unique default encode(extensions.gen_random_bytes(8), 'hex'),
  add column if not exists booking_enabled boolean not null default true,
  add column if not exists booking_slot_minutes int not null default 60,
  add column if not exists booking_notice_hours int not null default 4,
  add column if not exists booking_days_ahead int not null default 14,
  add column if not exists invoice_details jsonb not null default '{}'::jsonb; -- address, vat number, bank details, payment link
update public.clients set booking_token = encode(extensions.gen_random_bytes(8), 'hex') where booking_token is null;

alter table public.contact_notes enable row level security;
alter table public.snippets enable row level security;
alter table public.appointments enable row level security;
alter table public.documents enable row level security;
