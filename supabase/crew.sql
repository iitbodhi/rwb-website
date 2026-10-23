-- =====================================================================
-- RWB App: member list for everyone + odometer leaderboard
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- Members can hide themselves from the leaderboard (Me → "Show me on the leaderboard")
alter table public.members add column if not exists show_on_leaderboard boolean not null default true;
grant update (show_on_leaderboard) on public.members to authenticated;

-- The member list every member can see: name, nickname, photo, bike model, place. Nothing else.
create or replace function public.member_directory()
returns table (id bigint, full_name text, nickname text, avatar_url text, bike text, locality text, role text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select m.id, m.full_name, m.nickname, m.avatar_url, m.bike, m.locality, m.role, m.user_id is not null
    from members m order by m.full_name;
end $$;

-- Each rider's latest odometer reading (newest service record or fill-up), highest first.
-- Only names, photos and km are shared; riders who switched it off are left out.
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

revoke execute on function public.member_directory() from public, anon;
revoke execute on function public.odometer_leaderboard() from public, anon;
grant execute on function public.member_directory() to authenticated;
grant execute on function public.odometer_leaderboard() to authenticated;
notify pgrst, 'reload schema';
