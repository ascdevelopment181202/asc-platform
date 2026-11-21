-- ASC Platform: US clients. Already applied to the live project on 21 Nov 2026.
-- Which country a client trades in: decides phone formats, number type, forwarding codes and wording.
alter table public.clients
  add column if not exists country text not null default 'GB' check (country in ('GB','US')),
  add column if not exists mobile_carrier text,
  -- US only: texts go through a per-client Messaging Service linked to their A2P 10DLC campaign.
  add column if not exists messaging_service_sid text;
