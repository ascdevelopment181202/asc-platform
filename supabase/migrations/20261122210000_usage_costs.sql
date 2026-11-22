-- Cheaper texting: dead numbers, campaign allowance, text budgets.

-- A number that can't receive texts (invalid, landline, unreachable twice): we stop texting it.
alter table public.contacts
  add column if not exists sms_undeliverable_at timestamptz,
  add column if not exists sms_fail_count smallint not null default 0;

alter table public.clients
  add column if not exists campaign_monthly_limit integer not null default 300, -- campaign texts a month included
  add column if not exists sms_budget_gbp numeric(8,2);                          -- alert when a month's texting passes this

-- Customer replies are emailed to the owner when their phone has no notifications; texting them is now opt-in.
alter table public.clients alter column forward_replies set default false;

-- Campaign texts are logged as their own kind, so usage can show what campaigns cost.
alter table public.sms_log drop constraint if exists sms_log_kind_check;
alter table public.sms_log add constraint sms_log_kind_check check (kind in ('missed_call','review','owner_forward','owner_confirm','test','manual','campaign'));
