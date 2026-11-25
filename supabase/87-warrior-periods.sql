-- 87: Warriorboards by period (Nov 2026): last 7 days, 30 days, 3 months, 6 months and 1 year, next to All time.
-- * public.track_days: km ridden on Track and rides started, per rider per day (India time). Filled by a trigger on
--   track_stats, so Track itself doesn't change. Rows older than 400 days are cleared now and then. Period Track
--   numbers start from the day this file runs (there is no older day-by-day Track history).
-- * public.warrior_period(p_days): every board's numbers for that period in ONE small call (only riders with
--   something in the period), for members and RWB FAM, hiding riders who turned off "Show me on the Warriorboards".
--     Track      km ridden while sharing                   Mileage   average km/l of full tanks closed in the period
--     Service    services logged (by service date)         Road      km added to the odometer in the period
--     Pookie     XP from Teach Pookie answers sent in the period
-- Safe to run twice.

create table if not exists public.track_days (
  member_id bigint not null references public.members(id) on delete cascade,
  day       date   not null,
  km        numeric(9,2) not null default 0,
  rides     int not null default 0,
  primary key (member_id, day)
);
create index if not exists track_days_day on public.track_days (day);
alter table public.track_days enable row level security;   -- no policies: read only through warrior_period
revoke all on public.track_days from anon, authenticated;

create or replace function private.track_days_add() returns trigger
language plpgsql security definer set search_path = public as $$
declare dk numeric := greatest(new.km - coalesce(case when tg_op = 'UPDATE' then old.km end, 0), 0);
        dr int := greatest(coalesce(new.rides, 0) - coalesce(case when tg_op = 'UPDATE' then old.rides end, 0), 0);
begin
  if dk > 0 or dr > 0 then
    insert into track_days (member_id, day, km, rides) values (new.member_id, (now() at time zone 'Asia/Kolkata')::date, dk, dr)
    on conflict (member_id, day) do update set km = track_days.km + excluded.km, rides = track_days.rides + excluded.rides;
    if random() < 0.002 then delete from track_days where day < (now() at time zone 'Asia/Kolkata')::date - 400; end if;
  end if;
  return new;
exception when others then
  return new;   -- the day log must never stop Track
end $$;
drop trigger if exists track_days_add on public.track_stats;
create trigger track_days_add after insert or update of km, rides on public.track_stats for each row execute function private.track_days_add();
revoke execute on function private.track_days_add() from public, anon, authenticated;

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
    ), fills as (
      select f.*, coalesce(sum(case when f.full_tank then 1 else 0 end) over (partition by f.user_id order by f.odometer_km, f.fill_date, f.id
                    rows between unbounded preceding and 1 preceding), 0) g
      from fuel_logs f where f.user_id in (select user_id from ms)
    ), tank as (   -- the same tanks as the app's mileage screen: from one full tank to the next
      select t.user_id, t.g, sum(t.litres) litres,
             (array_agg(t.full_tank order by t.odometer_km desc, t.fill_date desc, t.id desc))[1] closed,
             (array_agg(t.fill_date order by t.odometer_km desc, t.fill_date desc, t.id desc))[1] end_d,
             (array_agg(t.trip_a_km order by t.odometer_km desc, t.fill_date desc, t.id desc))[1] trip,
             (array_agg(t.odometer_km order by t.odometer_km desc, t.fill_date desc, t.id desc))[1] end_o
      from fills t group by t.user_id, t.g
    ), tank2 as (
      select k.user_id, k.litres, k.end_d,
             coalesce(k.trip, k.end_o - (select f.odometer_km from fills f where f.user_id = k.user_id and f.full_tank and f.g = k.g - 1
                                          order by f.odometer_km desc, f.id desc limit 1)) dist
      from tank k where k.closed and (k.g > 0 or k.trip > 0)
    ), mil as (
      select t.user_id, sum(t.dist) / nullif(sum(t.litres), 0) kmpl, count(*)::int n
      from tank2 t where t.end_d >= since and t.dist > 0 and t.litres > 0 group by t.user_id
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
