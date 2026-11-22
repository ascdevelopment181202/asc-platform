-- ASC Platform: each client's shareable review page (/r/<slug>), separate from the per-job links in review texts.
alter table public.clients add column if not exists review_slug text unique default encode(extensions.gen_random_bytes(5), 'hex');
update public.clients set review_slug = encode(extensions.gen_random_bytes(5), 'hex') where review_slug is null;
alter table public.clients alter column review_slug set not null;

-- Ratings left on the shareable page (per-job ratings live on jobs).
create table if not exists public.review_ratings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  feedback text,
  went_to_google boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists review_ratings_client_idx on public.review_ratings (client_id, created_at desc);
alter table public.review_ratings enable row level security;
