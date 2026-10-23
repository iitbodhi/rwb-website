-- =====================================================================
-- RWB App: three leaderboards (Road, Mileage, Service Warriors) and mileage in the member list
-- Run once in Supabase > SQL Editor, AFTER 21-odometer-and-service-centres.sql. Safe to run again.
-- =====================================================================

-- Each rider's average mileage, worked out by the app from their own fill-ups
alter table public.members add column if not exists avg_kmpl numeric(5,2) check (avg_kmpl is null or avg_kmpl between 5 and 120);
alter table public.members add column if not exists kmpl_tanks integer check (kmpl_tanks is null or kmpl_tanks >= 0);
grant update (avg_kmpl, kmpl_tanks) on public.members to authenticated;

-- One row per rider for all three boards: km (newest reading), km/l, services logged.
-- Riders who switched off "Show me on the leaderboards" are left out.
create or replace function public.warrior_boards()
returns table (member_id bigint, full_name text, nickname text, avatar_url text, bike text, km integer, kmpl numeric, tanks integer, services integer, last_service date, is_me boolean)
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
      from readings r where r.odometer_km > 0 order by r.user_id, r.d desc, r.created_at desc
    ), svc as (
      select s.user_id, count(*)::int as n, max(s.service_date) as last_d from service_records s group by s.user_id
    )
    select m.id, m.full_name, m.nickname, m.avatar_url, m.bike, l.odometer_km, m.avg_kmpl, m.kmpl_tanks,
           coalesce(v.n, 0), v.last_d, m.user_id = auth.uid()
    from members m
    left join latest l on l.user_id = m.user_id
    left join svc v on v.user_id = m.user_id
    where m.user_id is not null and m.show_on_leaderboard
      and (l.odometer_km is not null or m.avg_kmpl is not null or v.n is not null);
end $$;
revoke execute on function public.warrior_boards() from public, anon;
grant execute on function public.warrior_boards() to authenticated;

-- Member list: now with each rider's average mileage (hidden for riders who opted out of the boards)
drop function if exists public.member_directory();
create function public.member_directory()
returns table (id bigint, full_name text, nickname text, avatar_url text, bike text, vrn text, locality text, role text, phone text, on_app boolean, avg_kmpl numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select m.id, m.full_name, m.nickname, m.avatar_url, m.bike, m.vrn, m.locality, m.role,
           case when m.role in ('superadmin','admin','coordinator') then m.phone end,
           m.user_id is not null,
           case when m.show_on_leaderboard then m.avg_kmpl end
    from members m
    order by case m.role when 'superadmin' then 0 when 'admin' then 1 when 'coordinator' then 2 else 3 end, m.full_name;
end $$;
revoke execute on function public.member_directory() from public, anon;
grant execute on function public.member_directory() to authenticated;
notify pgrst, 'reload schema';
