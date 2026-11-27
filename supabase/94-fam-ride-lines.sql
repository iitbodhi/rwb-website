-- 94-fam-ride-lines.sql  (Nov 27 2026)
-- RWB FAM can play back their own rider's rides (and event rides their rider was on), like members.
-- FAM never gets top speed: top_spd is sent as null to them. Members are unchanged.
-- Safe to run twice.

create or replace function public.track_rides_today() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare m members; fm bigint; evs bigint[];
begin
  select * into m from members where user_id = (select auth.uid()) and status = 'active';
  if m.id is null then
    if not private.fam_ok() then return '[]'::jsonb; end if;
    select f.member_id into fm from fam_members f where f.user_id = (select auth.uid()) and f.approved limit 1;
    select coalesce(array_agg(distinct e.id), '{}') into evs
      from track_rides r cross join lateral private.track_ride_event(r.id) e
      where r.member_id = fm and r.last_at > now() - interval '7 days' and e.id is not null;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'member_id', r.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
      'started_at', r.started_at, 'ended_at', r.last_at, 'km', round(r.km::numeric, 1), 'move_s', round(r.move_s),
      'top_spd', case when m.id is null then null else r.top_spd end,
      'event_id', e.id, 'event', e.title, 'me', m.id is not null and r.member_id = m.id) order by r.last_at desc)
    from track_rides r
    join members x on x.id = r.member_id and x.status = 'active'
    left join lateral private.track_ride_event(r.id) e on true
    where r.last_at > now() - interval '7 days' and r.km >= 1
      and not exists (select 1 from track_live l where l.ride_id = r.id and l.until > now())
      and (m.id is not null or r.member_id = fm or e.id = any(evs))), '[]'::jsonb);
end $$;

create or replace function public.track_ride_lines(p_ride bigint default null, p_event bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare m members; fm bigint; evs bigint[];
begin
  select * into m from members where user_id = (select auth.uid()) and status = 'active';
  if m.id is null then
    if not private.fam_ok() then raise exception 'Members only'; end if;
    select f.member_id into fm from fam_members f where f.user_id = (select auth.uid()) and f.approved limit 1;
    select coalesce(array_agg(distinct e.id), '{}') into evs
      from track_rides r cross join lateral private.track_ride_event(r.id) e
      where r.member_id = fm and r.last_at > now() - interval '7 days' and e.id is not null;
  end if;
  return coalesce((select jsonb_agg(z.o order by z.started_at) from (
    select r.started_at, jsonb_build_object('id', r.id, 'member_id', r.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
      'started_at', r.started_at, 'ended_at', r.last_at, 'km', round(r.km::numeric, 1), 'move_s', round(r.move_s),
      'top_spd', case when m.id is null then null else r.top_spd end,
      'event_id', e.id, 'event', e.title, 'me', m.id is not null and r.member_id = m.id,
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
      and (r.id = p_ride or (p_event is not null and e.id = p_event))
      and (m.id is not null or r.member_id = fm or e.id = any(evs))) z), '[]'::jsonb);
end $$;

notify pgrst, 'reload schema';
