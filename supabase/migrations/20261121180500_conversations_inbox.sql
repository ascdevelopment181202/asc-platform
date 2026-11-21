-- ASC Platform: GoHighLevel-style inbox in the client app. Already applied to the live project on 21 Nov 2026.

-- Inbox state per customer (one conversation per contact)
alter table public.contacts
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_preview text,
  add column if not exists last_message_direction text check (last_message_direction in ('inbound','outbound','call')),
  add column if not exists unread_count int not null default 0,
  add column if not exists starred boolean not null default false;
create index if not exists contacts_inbox_idx on public.contacts (client_id, last_message_at desc nulls last);

-- Messages typed by the client in the app
alter table public.sms_log drop constraint if exists sms_log_kind_check;
alter table public.sms_log add constraint sms_log_kind_check check (kind in ('missed_call','review','owner_forward','owner_confirm','test','manual'));

-- Clients who live in the app can switch off the "new reply" texts to their own phone
alter table public.clients add column if not exists forward_replies boolean not null default true;

-- Moves a conversation to the top of the inbox; inbound activity adds to the unread count.
create or replace function public.bump_conversation(p_contact uuid, p_preview text, p_direction text, p_unread boolean)
returns void language sql security invoker set search_path = public as $$
  update contacts
     set last_message_at = now(),
         last_message_preview = left(p_preview, 160),
         last_message_direction = p_direction,
         unread_count = unread_count + case when p_unread then 1 else 0 end
   where id = p_contact;
$$;
revoke execute on function public.bump_conversation(uuid, text, text, boolean) from public, anon, authenticated;
