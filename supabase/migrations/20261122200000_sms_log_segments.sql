-- How many segments Twilio billed for each text (cost tracking).
alter table public.sms_log add column if not exists segments smallint;
