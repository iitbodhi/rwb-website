-- 97-fuel-check.sql (Nov 28 2026): simpler mileage, mistakes left out automatically.
-- Riders now log only litres, ₹, odometer and date (Full tank, DTE, Trip A and notes are no longer asked;
-- old values stay in fuel_logs but are ignored).
-- A reading = km since the previous fill-up ÷ litres of this fill-up. Realistic range: TVS Ronin 225 25–50 km/l,
-- other bikes 12–80. Too high → joined with the next fill-up(s) (part fills, a missed log, an odometer typo), up to 3;
-- still unrealistic, too low, or litres over the tank → left out. Boards need 200+ km of good readings.
-- Same maths as fuelReadings() in app/js/app.js: keep both the same.
-- Also: members.avg_kmpl / kmpl_tanks are now kept up to date by a trigger on fuel_logs (not only by the app),
-- and every rider's figure is recalculated once below. Safe to run twice.

create or replace function private.fuel_readings(p_user uuid, p_slot int default 1)
returns table(end_d date, dist numeric, used numeric, exact boolean)
language plpgsql stable security definer set search_path = public as $$
declare m record; model text; vk text; ronin boolean; cap numeric; lo numeric; hi numeric;
        f record; seen text[] := '{}'; k text; have boolean := false; p_odo numeric;
        d numeric := 0; l numeric := 0; n int := 0; r numeric;
begin
  select * into m from members where user_id = p_user limit 1;
  if p_slot = 1 then model := m.bike; vk := coalesce(private.vrn_key(m.vrn), 'main');
  else select b.model, private.vrn_key(b.vrn) into model, vk from member_bikes b where b.member_id = m.id and b.slot = p_slot; end if;
  ronin := private.is_ronin(model);
  cap := case when ronin then 14 else coalesce(nullif(m.tanks ->> vk, '')::numeric, 20) end;
  lo := case when ronin then 25 else 12 end;
  hi := case when ronin then 50 else 80 end;
  for f in select * from fuel_logs where user_id = p_user and bike_slot = p_slot
             and (p_slot = 1 or bike_vrn is null or private.vrn_key(bike_vrn) = vk)
           order by odometer_km, fill_date, id loop
    k := f.fill_date || '|' || f.odometer_km || '|' || f.litres::numeric || '|' || f.full_tank;
    if k = any(seen) then continue; end if;
    seen := seen || k;
    if f.litres > cap + 0.5 then d := 0; l := 0; n := 0; have := true; p_odo := f.odometer_km; continue; end if;
    if not have then have := true; p_odo := f.odometer_km; continue; end if;
    d := d + (f.odometer_km - p_odo); l := l + f.litres; n := n + 1; p_odo := f.odometer_km;
    if d <= 0 then continue; end if;
    r := d / l;
    if r between lo and hi then
      end_d := f.fill_date; dist := d; used := l; exact := true; return next;
      d := 0; l := 0; n := 0;
    elsif r < lo or n >= 3 or l > cap * 2 then d := 0; l := 0; n := 0;
    end if;
  end loop;
end $$;
revoke execute on function private.fuel_readings(uuid, int) from public, anon, authenticated;
drop function if exists private.fuel_pass(uuid, int, text, numeric, numeric, numeric);

-- keep the all-time Mileage board figure fresh on the server
create or replace function private.kmpl_refresh(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare dd numeric; uu numeric; nn int; v numeric;
begin
  if p_user is null then return; end if;
  select sum(r.dist), sum(r.used), count(*)::int into dd, uu, nn from private.fuel_readings(p_user, 1) r;
  v := case when dd >= 200 and uu > 0 then round(dd / uu, 2) end;
  update members set avg_kmpl = v, kmpl_tanks = coalesce(nn, 0)
   where user_id = p_user and (avg_kmpl is distinct from v or kmpl_tanks is distinct from coalesce(nn, 0));
end $$;
revoke execute on function private.kmpl_refresh(uuid) from public, anon, authenticated;

create or replace function private.fuel_logs_kmpl() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'INSERT' and coalesce(old.bike_slot, 1) = 1 then perform private.kmpl_refresh(old.user_id); end if;
  if tg_op <> 'DELETE' and coalesce(new.bike_slot, 1) = 1 and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
    then perform private.kmpl_refresh(new.user_id); end if;
  return null;
exception when others then return null;   -- never block saving a fill-up
end $$;
drop trigger if exists fuel_logs_kmpl on public.fuel_logs;
create trigger fuel_logs_kmpl after insert or update or delete on public.fuel_logs
  for each row execute function private.fuel_logs_kmpl();

-- period boards: same readings, 200+ km of good readings in the period
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
    ), mil as (
      select u.user_id, sum(r.dist) / nullif(sum(r.used), 0) kmpl, count(*)::int n
      from (select distinct f.user_id from fuel_logs f where f.user_id in (select user_id from ms) and f.bike_slot = 1 and f.fill_date >= since - 120) u
      cross join lateral private.fuel_readings(u.user_id, 1) r
      where r.end_d >= since group by u.user_id having sum(r.dist) >= 200
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

-- recalculate everyone once with the new maths
do $$ declare u uuid; begin
  for u in select distinct user_id from members where user_id is not null and (avg_kmpl is not null or user_id in (select user_id from fuel_logs)) loop
    perform private.kmpl_refresh(u);
  end loop;
end $$;

notify pgrst, 'reload schema';
