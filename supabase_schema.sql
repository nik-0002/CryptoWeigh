-- Run this once in Supabase: SQL Editor > New query > paste > Run

create table if not exists public.ledger (
  id            bigint generated always as identity primary key,
  created_at    timestamptz  not null default now(),
  device_id     varchar(32)  not null,
  weight_kg     numeric(5,2) not null check (weight_kg >= 0),
  data_hash     varchar(64)  not null check (data_hash ~ '^[0-9A-F]{64}$'),
  tamper_status boolean      not null default false,
  photo_path    text,
  photo_sha256  varchar(64),
  photo_at      timestamptz
);

-- Private storage bucket for the ESP32-CAM photos
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create index if not exists ledger_created_at_idx on public.ledger (created_at desc);

-- Lock the table: the public/anon key can NOT read or write anything.
-- Only our server (using the secret key) can touch it.
alter table public.ledger enable row level security;

-- ------------------------------------------------------------------
-- OPTIONAL, run LATER once testing is finished:
-- makes the ledger append-only (nobody can edit or delete rows).
-- ------------------------------------------------------------------
-- create or replace function public.ledger_block_changes() returns trigger
-- language plpgsql as $$ begin
--   -- the only allowed change: attaching a photo, once, to a reading that has none
--   if tg_op = 'UPDATE' and old.photo_path is null and new.photo_path is not null
--      and (new.id, new.created_at, new.device_id, new.weight_kg, new.data_hash, new.tamper_status)
--          is not distinct from
--          (old.id, old.created_at, old.device_id, old.weight_kg, old.data_hash, old.tamper_status)
--   then
--     return new;
--   end if;
--   raise exception 'ledger is append-only';
-- end $$;
-- create trigger ledger_no_update_delete before update or delete on public.ledger
--   for each row execute function public.ledger_block_changes();
-- create trigger ledger_no_truncate before truncate on public.ledger
--   for each statement execute function public.ledger_block_changes();
