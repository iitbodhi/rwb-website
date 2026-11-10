-- 57 · My Ride: each member's own parts and accessories tracker (tyres, oil, chain, brake pads, mods…).
-- Run once in Supabase → SQL Editor. Safe to run more than once.
-- Private like service records: only the member sees their own ride (admins can't).

create table if not exists public.ride_profile (
  user_id    uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name       text check (char_length(name) <= 40),
  updated_at timestamptz not null default now()
);

create table if not exists public.ride_parts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         text not null default 'wear' check (kind in ('wear', 'acc')),
  part         text not null check (char_length(part) <= 40),         -- catalogue key (engine_oil, rear_tyre, crash_guard…) or 'custom'
  name         text check (char_length(name) <= 60),                 -- shown name (custom accessories)
  brand        text check (char_length(brand) <= 60),
  spec         text check (char_length(spec) <= 60),                 -- grade / size / model, e.g. 10W-30, 130/70-17
  installed_on date,
  installed_km integer check (installed_km between 0 and 2000000),
  cost         numeric(10,2) check (cost >= 0),
  life_km      integer check (life_km between 0 and 500000),
  life_days    integer check (life_days between 0 and 7300),
  notes        text check (char_length(notes) <= 1000),
  retired_on   date,                                                   -- replaced: kept as history
  retired_km   integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists ride_parts_user_idx on public.ride_parts (user_id, part);

alter table public.ride_profile enable row level security;
alter table public.ride_parts enable row level security;
drop policy if exists ride_profile_own on public.ride_profile;
create policy ride_profile_own on public.ride_profile for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists ride_parts_own on public.ride_parts;
create policy ride_parts_own on public.ride_parts for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
grant select, insert, update, delete on public.ride_profile, public.ride_parts to authenticated;
