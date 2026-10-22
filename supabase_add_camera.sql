-- Run this ONCE in Supabase: SQL Editor > New query > paste > Run
-- (adds photo support to the ledger you already created)

alter table public.ledger add column if not exists photo_path   text;
alter table public.ledger add column if not exists photo_sha256 varchar(64);
alter table public.ledger add column if not exists photo_at     timestamptz;

-- Private storage bucket for the photos. Nobody can open it without our server.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;
