-- ASC Platform: per-client branding for quotes/invoices/review page, and the review funnel rating.

alter table public.clients
  add column if not exists brand_color text,
  add column if not exists logo_url text;

alter table public.jobs
  add column if not exists rating smallint check (rating between 1 and 5),
  add column if not exists rated_at timestamptz,
  add column if not exists feedback text,
  add column if not exists feedback_at timestamptz;
