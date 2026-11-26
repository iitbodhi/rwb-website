-- 89: Track ride lines are kept for 7 days (was 24 hours, file 88). Bodhi's choice, Nov 26 2026.
-- Storage: ~200 KB per 3-hour ride, so a busy week (~50 rides a day) is ~70 MB of the free 500 MB.
-- Safe to run twice.

create or replace function public.track_rides_today() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare m members;
begin
  select * into m from members where user_id = (select auth.uid()) and status = 'active';
  if m.id is null then return '[]'::jsonb; end if;   -- RWB FAM: no ride lines
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'member_id', r.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
      'started_at', r.started_at, 'ended_at', r.last_at, 'km', round(r.km::numeric, 1), 'move_s', round(r.move_s), 'top_spd', r.top_spd,
      'event_id', e.id, 'event', e.title, 'me', r.member_id = m.id) order by r.last_at desc)
    from track_rides r
    join members x on x.id = r.member_id and x.status = 'active'
    left join lateral private.track_ride_event(r.id) e on true
    where r.last_at > now() - interval '7 days' and r.km >= 1
      and not exists (select 1 from track_live l where l.ride_id = r.id and l.until > now())), '[]'::jsonb);
end $$;
revoke execute on function public.track_rides_today() from public, anon;
grant execute on function public.track_rides_today() to authenticated;

create or replace function public.track_ride_lines(p_ride bigint default null, p_event bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare m members;
begin
  select * into m from members where user_id = (select auth.uid()) and status = 'active';
  if m.id is null then raise exception 'Members only'; end if;
  return coalesce((select jsonb_agg(z.o order by z.started_at) from (
    select r.started_at, jsonb_build_object('id', r.id, 'member_id', r.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
      'started_at', r.started_at, 'ended_at', r.last_at, 'km', round(r.km::numeric, 1), 'move_s', round(r.move_s), 'top_spd', r.top_spd,
      'event_id', e.id, 'event', e.title, 'me', r.member_id = m.id,
      't0', floor(extract(epoch from r.started_at)),
      'pts', coalesce((
        select jsonb_agg(jsonb_build_array(round(q.lat::numeric, 5), round(q.lng::numeric, 5), floor(extract(epoch from q.t - r.started_at)), round(coalesce(q.spd, 0) * 3.6)) order by q.t)
        from (
          select k.*, row_number() over (order by k.t) n, count(*) over () c from (
            select p.* from track_points p,
              lateral (select a.lat, a.lng from track_points a where a.ride_id = r.id order by a.t limit 1) s,
              lateral (select b.lat, b.lng from track_points b where b.ride_id = r.id order by b.t desc limit 1) f
            where p.ride_id = r.id and private.dist_m(s.lat, s.lng, p.lat, p.lng) > 300 and private.dist_m(f.lat, f.lng, p.lat, p.lng) > 300) k) q
        where q.c <= 900 or q.n % ceil(q.c / 900.0)::int = 0 or q.n = q.c), '[]'::jsonb)) o
    from track_rides r
    join members x on x.id = r.member_id and x.status = 'active'
    left join lateral private.track_ride_event(r.id) e on true
    where r.last_at > now() - interval '7 days' and r.km >= 1
      and not exists (select 1 from track_live l where l.ride_id = r.id and l.until > now())
      and (r.id = p_ride or (p_event is not null and e.id = p_event))) z), '[]'::jsonb);
end $$;
revoke execute on function public.track_ride_lines(bigint, bigint) from public, anon;
grant execute on function public.track_ride_lines(bigint, bigint) to authenticated;

create or replace function private.track_rides_sweep() returns void
language sql security definer set search_path = public, private as $$
  delete from track_rides where last_at < now() - interval '7 days';
$$;

-- the hourly cron rwb-track-lines (file 88) runs private.track_rides_sweep(), which now keeps 7 days
notify pgrst, 'reload schema';
