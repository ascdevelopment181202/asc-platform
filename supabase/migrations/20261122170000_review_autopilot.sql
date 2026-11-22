-- Review autopilot: automatic requests after bookings, personal texts, email requests, job-software intake,
-- unhappy-customer rescue, referral asks, auto-replies to good Google reviews, weekly progress.

alter table public.clients
  add column if not exists auto_review_after_booking boolean not null default true,
  add column if not exists review_auto_reply boolean not null default true,
  add column if not exists referral_ask boolean not null default true,
  add column if not exists sender_name text,            -- "Paul" in "it's Paul from P.I.C"; defaults to first_name
  add column if not exists intake_token text unique default encode(gen_random_bytes(12), 'hex'),
  add column if not exists competitor_name text,
  add column if not exists competitor_place_id text,
  add column if not exists competitor_rating numeric(2,1),
  add column if not exists competitor_review_count integer;
update public.clients set intake_token = encode(gen_random_bytes(12), 'hex') where intake_token is null;

alter table public.jobs drop constraint if exists jobs_source_check;
alter table public.jobs add constraint jobs_source_check check (source in ('dashboard','sms','bulk','booking','integration','reask'));
alter table public.jobs
  add column if not exists job_label text,          -- "driveway clean": used in the personal text
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists referral_sent_at timestamptz,
  add column if not exists rescue_task_id uuid references public.contact_tasks(id) on delete set null;

alter table public.appointments add column if not exists review_queued_at timestamptz;

alter table public.review_messages add column if not exists channel text not null default 'sms';

alter table public.google_reviews
  add column if not exists draft_reply text,
  add column if not exists auto_reply_at timestamptz;

-- One-off texts to customers that wait for the sending window (referral asks).
create table if not exists public.outbox (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  body text not null,
  send_at timestamptz not null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists outbox_due_idx on public.outbox (send_at) where sent_at is null and cancelled_at is null;
alter table public.outbox enable row level security;
