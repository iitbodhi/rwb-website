-- 91: Mileage per bike (Nov 2026).
-- * fuel_logs.bike_slot (1 = main bike, 2/3 = My bikes) and fuel_logs.bike_vrn (the plate when the fill-up was saved).
--   Bike 2/3 fill-ups only count for that bike while its plate is the same, so a replaced bike starts fresh.
-- * members.tanks: full-tank capacity per vehicle, keyed by plate (lowercase letters/digits; 'main' when the main bike
--   has no plate yet). Ronins are always 14 L and never asked. Replaces members.tank_l from file 90 (never used).
-- * Only main-bike fill-ups count as main-bike odometer readings (Home, Road Warriors, odometer board, reminders).
-- * Mileage maths (same as fuelReadings in app.js):
--   - tank level known at a full tank (capacity) or at a fill-up with range left / DTE;
--   - DTE → litres: Ronin 2 L "empty" level + DTE ÷ k, other vehicles DTE ÷ k, where k is learnt from the rider's own
--     full-tank fill-ups that also had a DTE reading (median), else the rider's own mileage;
--   - distance = Trip A when it matches the odometer gap (within 3% or 5 km: Trip A was reset at the start), else the
--     odometer gap.
-- * The Mileage Warriorboard counts each rider's MAIN bike (Bodhi's choice).
-- Safe to run twice.

alter table public.fuel_logs add column if not exists bike_slot smallint not null default 1;
alter table public.fuel_logs add column if not exists bike_vrn text;
do $$ begin
  alter table public.fuel_logs add constraint fuel_logs_slot_chk check (bike_slot between 1 and 3);
exception when duplicate_object then null; end $$;

alter table public.members add column if not exists tanks jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.members add constraint members_tanks_chk check (jsonb_typeof(tanks) = 'object' and pg_column_size(tanks) < 600);
exception when duplicate_object then null; end $$;
grant update (tanks) on public.members to authenticated;
alter table public.members drop column if exists tank_l;

create or replace function private.vrn_key(v text) returns text language sql immutable as $$
  select nullif(lower(regexp_replace(coalesce(v, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;

create or replace function private.is_ronin(model text) returns boolean language sql immutable as $$
  select model is null or model ~* 'ronin' or model ~* 'no bike' $$;

drop function if exists private.fuel_pass(uuid, numeric, numeric, numeric);
drop function if exists private.fuel_readings(uuid);

create or replace function private.fuel_pass(p_user uuid, p_slot int, p_vrn text, p_size numeric, p_empty numeric, p_k numeric)
returns table(end_d date, dist numeric, used numeric, exact boolean)
language plpgsql stable security definer set search_path = public as $$
declare f record; seen text[] := '{}'; k text;
        a_odo numeric; a_level numeric; a_full boolean; have boolean := false; added numeric := 0;
        before numeric; d numeric; u numeric; t numeric;
begin
  for f in select * from fuel_logs where user_id = p_user and bike_slot = p_slot
             and (p_slot = 1 or bike_vrn is null or private.vrn_key(bike_vrn) = p_vrn)
           order by odometer_km, fill_date, id loop
    k := f.fill_date || '|' || f.odometer_km || '|' || f.litres::numeric || '|' || f.full_tank;
    if k = any(seen) then continue; end if;
    seen := seen || k;
    before := case when f.full_tank then case when p_size is not null then greatest(p_size - f.litres, 0) end
                   when f.range_km is not null then p_empty + f.range_km / p_k end;
    if have then
      d := f.odometer_km - a_odo; t := f.trip_a_km;
      if t > 0 and (d <= 0 or abs(t - d) <= greatest(5, d * 0.03)) then d := t; end if;
      u := case when a_full and f.full_tank then added + f.litres
                when a_level is not null and before is not null then a_level + added - before end;
      if u is not null and d > 0 and u > 0.2 and ((a_full and f.full_tank) or d / u between 10 and 100) then
        end_d := f.fill_date; dist := d; used := u; exact := a_full and f.full_tank; return next;
      end if;
    elsif f.full_tank and f.trip_a_km > 0 then
      end_d := f.fill_date; dist := f.trip_a_km; used := f.litres; exact := true; return next;
    end if;
    if f.full_tank then have := true; a_odo := f.odometer_km; a_level := p_size; a_full := true; added := 0;
    elsif before is not null then
      have := true; a_odo := f.odometer_km; a_full := false; added := 0;
      a_level := case when p_size is not null then least(p_size, before + f.litres) else before + f.litres end;
    elsif have then added := added + f.litres;
    end if;
  end loop;
end $$;

-- readings for one bike of a rider (slot 1 = main bike)
create or replace function private.fuel_readings(p_user uuid, p_slot int default 1)
returns table(end_d date, dist numeric, used numeric, exact boolean)
language plpgsql stable security definer set search_path = public as $$
declare m record; model text; vk text; ronin boolean; sz numeric; em numeric; kk numeric; kd numeric;
begin
  select * into m from members where user_id = p_user limit 1;
  if p_slot = 1 then model := m.bike; vk := coalesce(private.vrn_key(m.vrn), 'main');
  else select b.model, private.vrn_key(b.vrn) into model, vk from member_bikes b where b.member_id = m.id and b.slot = p_slot; end if;
  ronin := private.is_ronin(model);
  sz := case when ronin then 14 else nullif(m.tanks ->> vk, '')::numeric end;
  em := case when ronin then 2 else 0 end;
  -- DTE factor learnt from full tanks that also had a DTE reading: litres left before filling = capacity − litres filled
  if sz is not null then
    select percentile_cont(0.5) within group (order by f.range_km / ((sz - f.litres) - em))
      into kd from fuel_logs f
      where f.user_id = p_user and f.bike_slot = p_slot and f.full_tank and f.range_km > 0 and (sz - f.litres) - em > 0.5
        and (p_slot = 1 or f.bike_vrn is null or private.vrn_key(f.bike_vrn) = vk);
  end if;
  if kd is null then
    select coalesce(sum(p.dist) filter (where p.exact) / nullif(sum(p.used) filter (where p.exact), 0),
                    sum(p.dist) / nullif(sum(p.used), 0), 40)
      into kk from private.fuel_pass(p_user, p_slot, vk, sz, em, 40) p;
    kd := kk;
  end if;
  kd := least(greatest(kd, 10), 90);
  return query select * from private.fuel_pass(p_user, p_slot, vk, sz, em, kd);
end $$;
revoke execute on function private.fuel_pass(uuid, int, text, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function private.fuel_readings(uuid, int) from public, anon, authenticated;

-- ---------- main-bike odometer only ----------
create or replace function private.latest_odo(p_user uuid) returns integer
language sql stable security definer set search_path = public as $$
  select r.km from (
    select s.odometer_km as km, s.service_date as d, s.created_at as c from service_records s where s.user_id = p_user
    union all select f.odometer_km, f.fill_date, f.created_at from fuel_logs f where f.user_id = p_user and f.bike_slot = 1
    union all select m.odo_km, m.odo_date, now() from members m where m.user_id = p_user and m.odo_km is not null and m.odo_date is not null
  ) r where r.km > 0 order by r.d desc, r.c desc limit 1
$$;

create or replace function public.odometer_leaderboard()
returns table(rank bigint, member_id bigint, full_name text, nickname text, avatar_url text, bike text, km integer, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_member() or private.fam_ok()) then raise exception 'Members only'; end if;
  return query
    with readings as (
      select s.user_id, s.odometer_km, s.service_date as d, s.created_at from service_records s
      union all
      select f.user_id, f.odometer_km, f.fill_date, f.created_at from fuel_logs f where f.bike_slot = 1
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

create or replace function public.warrior_boards()
returns table (member_id bigint, full_name text, nickname text, avatar_url text, bike text, km integer, kmpl numeric, tanks integer, services integer, last_service date, is_me boolean)
language plpgsql stable security definer set search_path = public, private as $$
declare staff boolean := public.is_moderator();
begin
  if not (is_member() or private.fam_ok()) then raise exception 'Members only'; end if;
  return query
    with readings as (
      select s.user_id, s.odometer_km, s.service_date as d, s.created_at from service_records s
      union all
      select f.user_id, f.odometer_km, f.fill_date, f.created_at from fuel_logs f where f.bike_slot = 1
      union all
      select m.user_id, m.odo_km, m.odo_date, now() from members m where m.user_id is not null and m.odo_km is not null and m.odo_date is not null
    ), latest as (
      select distinct on (r.user_id) r.user_id, r.odometer_km
      from readings r where r.odometer_km > 0 order by r.user_id, r.d desc, r.created_at desc
    ), svc as (
      select s.user_id, count(*)::int as n, max(s.service_date) as last_d from service_records s group by s.user_id
    )
    select m.id, m.full_name, m.nickname, m.avatar_url,
           case when staff or m.user_id = auth.uid() or private.shares(m, 'bike') then m.bike end,
           l.odometer_km, m.avg_kmpl, m.kmpl_tanks,
           coalesce(v.n, 0), v.last_d, m.user_id = auth.uid()
    from members m
    left join latest l on l.user_id = m.user_id
    left join svc v on v.user_id = m.user_id
    where m.user_id is not null and m.show_on_leaderboard and m.status = 'active'
      and (l.odometer_km is not null or m.avg_kmpl is not null or v.n is not null);
end $$;

create or replace function public.warrior_period(p_days int)
returns table(member_id bigint, full_name text, nickname text, avatar_url text, bike text,
              gps_km numeric, rides int, km int, kmpl numeric, tanks int, services int, last_service date, xp int, approved int, is_me boolean)
language plpgsql stable security definer set search_path = public, private as $$
declare staff boolean := public.is_moderator();
        today date := (now() at time zone 'Asia/Kolkata')::date;
        since date;
begin
  if not (is_member() or private.fam_ok()) then raise exception 'Members only'; end if;
  if p_days not in (7, 30, 90, 180, 365) then raise exception 'Pick a period'; end if;
  since := today - (p_days - 1);
  return query
    with ms as (
      select m.* from members m where m.status = 'active' and m.show_on_leaderboard and m.user_id is not null
    ), trk as (
      select d.member_id, sum(d.km) km, sum(d.rides)::int rides from track_days d where d.day >= since group by d.member_id
    ), readings as (
      select s.user_id, s.odometer_km o, s.service_date d from service_records s where s.odometer_km > 0
      union all select f.user_id, f.odometer_km, f.fill_date from fuel_logs f where f.odometer_km > 0 and f.bike_slot = 1
      union all select m.user_id, m.odo_km, m.odo_date from ms m where m.odo_km > 0 and m.odo_date is not null
    ), road as (
      select r.user_id, (max(r.o) filter (where r.d >= since)
                         - coalesce(max(r.o) filter (where r.d < since), min(r.o) filter (where r.d >= since)))::int km
      from readings r where r.user_id in (select user_id from ms) group by r.user_id
    ), mil as (   -- main bike, the same readings as the app's mileage screen
      select u.user_id, sum(r.dist) / nullif(sum(r.used), 0) kmpl, count(*)::int n
      from (select distinct f.user_id from fuel_logs f where f.user_id in (select user_id from ms) and f.bike_slot = 1 and f.fill_date >= since - 120) u
      cross join lateral private.fuel_readings(u.user_id, 1) r
      where r.end_d >= since group by u.user_id
    ), svc as (
      select s.user_id, count(*)::int n, max(s.service_date) last_d from service_records s
      where s.service_date >= since and s.service_date <= today group by s.user_id
    ), pk as (
      select a.user_id, (count(*) filter (where a.status = 'approved') * 10 + count(*) filter (where a.status = 'pending') * 2)::int xp,
             (count(*) filter (where a.status = 'approved'))::int ok
      from pookie_answers a where a.created_at >= since::timestamp at time zone 'Asia/Kolkata' group by a.user_id
    )
    select m.id, m.full_name, m.nickname, m.avatar_url,
           case when staff or m.user_id = auth.uid() or private.shares(m, 'bike') then m.bike end,
           round(coalesce(t.km, 0), 1), coalesce(t.rides, 0),
           case when r.km > 0 then r.km end,
           case when l.kmpl between 5 and 120 then round(l.kmpl, 2) end, coalesce(l.n, 0),
           coalesce(v.n, 0), v.last_d, coalesce(p.xp, 0), coalesce(p.ok, 0), m.user_id = auth.uid()
    from ms m
    left join trk t on t.member_id = m.id
    left join road r on r.user_id = m.user_id
    left join mil l on l.user_id = m.user_id
    left join svc v on v.user_id = m.user_id
    left join pk p on p.user_id = m.user_id
    where coalesce(t.km, 0) >= 0.1 or r.km > 0 or l.kmpl between 5 and 120 or v.n > 0 or p.xp > 0;
end $$;
revoke execute on function public.warrior_period(int) from public, anon;
grant execute on function public.warrior_period(int) to authenticated;

notify pgrst, 'reload schema';
