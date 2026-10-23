-- =====================================================================
-- RWB App: odometer updates from Home, and a shared list of TVS service centres
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- 1. Current odometer, updated by tapping the odometer on Home
alter table public.members add column if not exists odo_km integer check (odo_km is null or odo_km between 0 and 2000000);
alter table public.members add column if not exists odo_date date;
grant update (odo_km, odo_date) on public.members to authenticated;

-- The leaderboard now also counts this reading (newest reading wins)
create or replace function public.odometer_leaderboard()
returns table (rank bigint, member_id bigint, full_name text, nickname text, avatar_url text, bike text, km integer, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    with readings as (
      select s.user_id, s.odometer_km, s.service_date as d, s.created_at from service_records s
      union all
      select f.user_id, f.odometer_km, f.fill_date, f.created_at from fuel_logs f
      union all
      select m.user_id, m.odo_km, m.odo_date, now() from members m where m.user_id is not null and m.odo_km is not null and m.odo_date is not null
    ), latest as (
      select distinct on (r.user_id) r.user_id, r.odometer_km
      from readings r order by r.user_id, r.d desc, r.created_at desc
    )
    select row_number() over (order by l.odometer_km desc, m.full_name), m.id, m.full_name, m.nickname, m.avatar_url, m.bike,
           l.odometer_km, m.user_id = auth.uid()
    from latest l join members m on m.user_id = l.user_id
    where m.show_on_leaderboard and l.odometer_km > 0
    order by l.odometer_km desc, m.full_name;
end $$;
revoke execute on function public.odometer_leaderboard() from public, anon;
grant execute on function public.odometer_leaderboard() to authenticated;

-- 2. TVS service centres everyone can pick from. Grows when members choose "Other" and type a new one.
create table if not exists public.service_centres (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 2 and 120),
  area text check (area is null or length(area) <= 200),
  pincode text check (pincode is null or pincode ~ '^[1-9][0-9]{5}$'),
  added_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists service_centres_uniq on public.service_centres (lower(trim(name)), coalesce(pincode, ''));
alter table public.service_centres enable row level security;
drop policy if exists centres_read on public.service_centres;
create policy centres_read on public.service_centres for select to authenticated using (public.is_member());
drop policy if exists centres_remove on public.service_centres;
create policy centres_remove on public.service_centres for delete to authenticated using (public.is_admin());
revoke insert, update on public.service_centres from authenticated;
grant select, delete on public.service_centres to authenticated;

-- Members add a centre through this (keeps duplicates out)
create or replace function public.add_service_centre(p_name text, p_area text default null, p_pincode text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare nid bigint; pin text := nullif(regexp_replace(coalesce(p_pincode, ''), '\D', '', 'g'), '');
begin
  if not is_member() then raise exception 'Members only'; end if;
  if pin is not null and pin !~ '^[1-9][0-9]{5}$' then pin := null; end if;
  select id into nid from service_centres where lower(trim(name)) = lower(trim(p_name)) and coalesce(pincode, '') = coalesce(pin, '');
  if nid is null then
    insert into service_centres (name, area, pincode) values (trim(p_name), nullif(trim(coalesce(p_area, '')), ''), pin) returning id into nid;
  end if;
  return nid;
end $$;
revoke execute on function public.add_service_centre(text, text, text) from public, anon;
grant execute on function public.add_service_centre(text, text, text) to authenticated;

-- Starter list: authorised TVS centres around Kolkata (from public directories; members add the rest)
insert into public.service_centres (name, area, pincode, added_by) values
  ('Ashvavahan', 'Plot F5, Block GP, Sector 5, Salt Lake', '700091', null),
  ('Auto Hub', 'Thakurpukur Road, Bakrahat Road, Kolkata', '700063', null),
  ('Basanti Motors', 'Bibeknagar Middle Road, Noapara, Barasat', '700125', null),
  ('Bose Motor Company', 'Vidyasagar Street, Ashoknagar', '743222', null),
  ('Celica Autotech', '1423 Chakgaria, EM Bypass, near Satyajit Ray metro', '700094', null),
  ('Chatterjee Service Centre', 'Sonarpur Station Road, Narendrapur', '700103', null),
  ('Gupta Motors', 'Rabindranagar, Bartala', null, null),
  ('Jaiswal Wheels', 'Shibtala, Rajarhat', '700135', null),
  ('Joy Motors', '289 Diamond Harbour Road, Thakurpukur', '700063', null),
  ('Just Services', '61/1 Taratala Road', '700088', null),
  ('Karuna Traders', 'Fartabad, EM Bypass, Garia', null, null),
  ('Lustre', 'Sahapur Colony, New Alipore', '700053', null),
  ('Maa Santoshi Motors', '22 Barrackpore Trunk Road, Cossipore', '700002', null),
  ('Pioneer Motors', 'Padampukhuria, Contai', '721401', null),
  ('Radharani Auto Centre', 'Roy Bahadur Road, Behala', '700034', null),
  ('S K Motors', 'Biren Roy Road West, Shivrampur', '700061', null),
  ('Sam Motor', '68/78 Jessore Road, Amarpally', null, null),
  ('Seven Point Motors', '88 Park Street, near Arsalan', '700017', null),
  ('Shaw Wheels', 'Narayantala West, Baguiati', '700059', null),
  ('Subir Udyog', '36 Chowringhee Road', '700071', null),
  ('Subir Udyog', '537/1 MG Road, Budge Budge', '700137', null),
  ('Subir Udyog', 'P53 Taratala Road', '700088', null),
  ('Techno Wheels', '153A Acharya Prafulla Chandra Road', '700006', null),
  ('Universal TVS', 'Kolkata', null, null)
on conflict do nothing;

notify pgrst, 'reload schema';
