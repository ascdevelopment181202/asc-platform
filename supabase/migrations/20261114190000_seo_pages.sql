-- AI-written copy for each SEO page (service, area, service-in-area), unique per page.
create table if not exists seo_pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  path text not null,
  content jsonb not null,
  generated_at timestamptz not null default now(),
  unique (site_id, path)
);
alter table seo_pages enable row level security;
