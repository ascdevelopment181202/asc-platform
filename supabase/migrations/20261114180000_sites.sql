-- ASC Platform: website generator module

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references clients(id) on delete cascade,
  slug text not null unique,
  domain text unique,
  content jsonb not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every enquiry from a client's website. This is the lead count behind the guarantee.
create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  name text not null,
  phone text,
  email text,
  postcode text,
  service text,
  message text,
  source_path text
);

create index if not exists enquiries_client_idx on enquiries(client_id, created_at desc);
create index if not exists sites_domain_idx on sites(domain);

alter table sites enable row level security;
alter table enquiries enable row level security;

-- Public bucket for images shown on client websites (copied from the private uploads).
insert into storage.buckets (id, name, public)
values ('site-assets', 'site-assets', true)
on conflict (id) do nothing;
