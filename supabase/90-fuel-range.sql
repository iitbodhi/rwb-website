-- 90: Mileage without full tanks (Nov 2026).
-- * fuel_logs.range_km: the "range left" (DTE) on the dash, read before filling. Optional.
-- * members.tank_l: tank size for riders whose bike isn't a TVS Ronin (Ronin = 14 L from the owner's manual).
-- * private.fuel_readings(user): the same maths as the app's Mileage screen (fuelReadings in app.js):
--     the tank level is known at a full tank (tank size) or at a fill-up with range left
--     (Ronin: about 2 L "empty" level + range ÷ mileage; other bikes: range ÷ mileage);
--     petrol used between two known levels = level then + litres filled in between − level now;
--     distance = odometer difference; full → full is exact. Exact duplicate rows are skipped.
-- * warrior_period's Mileage board uses it.
-- Safe to run twice.

alter table public.fuel_logs add column if not exists range_km smallint;
do $$ begin
  alter table public.fuel_logs add constraint fuel_logs_range_chk check (range_km between 0 and 999);
exception when duplicate_object then null; end $$;

alter table public.members add column if not exists tank_l numeric(4,1);
do $$ begin
  alter table public.members add constraint members_tank_chk check (tank_l between 3 and 40);
exception when duplicate_object then null; end $$;
grant update (tank_l) on public.members to authenticated;

create or replace function private.fuel_pass(p_user uuid, p_size numeric, p_empty numeric, p_k numeric)
returns table(end_d date, dist numeric, used numeric, exact boolean)
language plpgsql stable security definer set search_path = public as $$
declare f record; seen text[] := '{}'; k text;
        a_odo numeric; a_level numeric; a_full boolean; have boolean := false; added numeric := 0;
        before numeric; d numeric; u numeric;
begin
  for f in select * from fuel_logs where user_id = p_user order by odometer_km, fill_date, id loop
    k := f.fill_date || '|' || f.odometer_km || '|' || f.litres::numeric || '|' || f.full_tank;
    if k = any(seen) then continue; end if;
    seen := seen || k;
    before := case when f.full_tank then case when p_size is not null then greatest(p_size - f.litres, 0) end
                   when f.range_km is not null then p_empty + f.range_km / p_k end;
    if have then
      d := f.odometer_km - a_odo;
      if d <= 0 and a_full and f.full_tank and f.trip_a_km > 0 then d := f.trip_a_km; end if;
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

create or replace function private.fuel_readings(p_user uuid)
returns table(end_d date, dist numeric, used numeric, exact boolean)
language plpgsql stable security definer set search_path = public as $$
declare m record; ronin boolean; sz numeric; em numeric; kk numeric;
begin
  select bike, tank_l into m from members where user_id = p_user limit 1;
  ronin := m.bike is null or m.bike ilike '%ronin%';
  sz := coalesce(m.tank_l, case when ronin then 14 end);
  em := case when ronin then 2 else 0 end;
  select coalesce(sum(p.dist) filter (where p.exact) / nullif(sum(p.used) filter (where p.exact), 0),
                  sum(p.dist) / nullif(sum(p.used), 0), 40)
    into kk from private.fuel_pass(p_user, sz, em, 40) p;
  kk := least(greatest(kk, 15), 80);
  return query select * from private.fuel_pass(p_user, sz, em, kk);
end $$;
revoke execute on function private.fuel_pass(uuid, numeric, numeric, numeric) from public, anon, authenticated;
revoke execute on function private.fuel_readings(uuid) from public, anon, authenticated;

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
      union all select f.user_id, f.odometer_km, f.fill_date from fuel_logs f where f.odometer_km > 0
      union all select m.user_id, m.odo_km, m.odo_date from ms m where m.odo_km > 0 and m.odo_date is not null
    ), road as (
      select r.user_id, (max(r.o) filter (where r.d >= since)
                         - coalesce(max(r.o) filter (where r.d < since), min(r.o) filter (where r.d >= since)))::int km
      from readings r where r.user_id in (select user_id from ms) group by r.user_id
    ), mil as (   -- the same readings as the app's mileage screen
      select u.user_id, sum(r.dist) / nullif(sum(r.used), 0) kmpl, count(*)::int n
      from (select distinct f.user_id from fuel_logs f where f.user_id in (select user_id from ms) and f.fill_date >= since - 120) u
      cross join lateral private.fuel_readings(u.user_id) r
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
