-- 88: Track, faster and with ride lines (Nov 2026)
-- * average speed: track_live.move_s (seconds spent moving this ride), sent by track_view
-- * track_pos(): a tiny "positions only" answer the map asks for every few seconds (the full track_view only once a minute)
-- * ride lines: track_rides (one row per ride) + track_points (a point every time the rider moves 25 m+ with a good GPS fix)
--   - a share that restarts within 20 minutes carries on the same ride (app restart, phone switched off a moment)
--   - track_rides_today(): rides that ENDED in the last 24 hours (members only, never RWB FAM)
--   - track_ride_lines(ride, event): the line(s) for playback; an event gives every rider of that event
--   - privacy: points within 300 m of where the ride started or ended are never sent (homes stay hidden)
--   - track_ride_delete(ride): the rider (or an admin) deletes a line
--   - cron rwb-track-lines (hourly) deletes rides (and their points) 24 hours after they ended
-- Safe to run twice.

create table if not exists public.track_rides (
  id bigserial primary key,
  member_id bigint not null references public.members(id) on delete cascade,
  event_id bigint references public.events(id) on delete set null,
  started_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  km real not null default 0,
  move_s real not null default 0,
  top_spd real not null default 0
);
create index if not exists track_rides_member on public.track_rides (member_id, last_at desc);
create index if not exists track_rides_last on public.track_rides (last_at);
create index if not exists track_rides_event on public.track_rides (event_id);
alter table public.track_rides enable row level security;
revoke all on public.track_rides from anon, authenticated;

create table if not exists public.track_points (
  ride_id bigint not null references public.track_rides(id) on delete cascade,
  t timestamptz not null default now(),
  lat double precision not null,
  lng double precision not null,
  spd real
);
create index if not exists track_points_ride on public.track_points (ride_id, t);
alter table public.track_points enable row level security;
revoke all on public.track_points from anon, authenticated;

alter table public.track_live add column if not exists move_s real not null default 0;
alter table public.track_live add column if not exists ride_id bigint references public.track_rides(id) on delete set null;

-- the ride a share belongs to (new, or the last one if it ended under 20 minutes ago)
create or replace function private.track_ride_for(p_member bigint, p_event bigint, p_lat double precision, p_lng double precision, p_acc real)
returns bigint language plpgsql security definer set search_path = public, private as $$
declare rid bigint; cur bigint;
begin
  select ride_id into cur from track_live where member_id = p_member and until > now();
  if cur is not null and exists (select 1 from track_rides where id = cur) then
    update track_rides set event_id = coalesce(p_event, event_id) where id = cur;
    return cur;
  end if;
  select id into rid from track_rides where member_id = p_member and last_at > now() - interval '20 minutes' order by last_at desc limit 1;
  if rid is null then
    insert into track_rides (member_id, event_id) values (p_member, p_event) returning id into rid;
  else
    update track_rides set event_id = coalesce(p_event, event_id) where id = rid;
  end if;
  if coalesce(p_acc, 999) <= 100 then insert into track_points (ride_id, lat, lng) values (rid, p_lat, p_lng); end if;
  return rid;
exception when others then return null;   -- ride lines never block sharing
end $$;
revoke execute on function private.track_ride_for(bigint, bigint, double precision, double precision, real) from public, anon, authenticated;

create or replace function public.track_start(p_lat double precision, p_lng double precision, p_acc real default null, p_hours integer default 4, p_event bigint default null, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); u timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 4), 1), 12)); was boolean; fresh boolean;
        nt text := left(nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), ''), 60);
        rid bigint; r track_rides;
begin
  if not private.track_ok(p_lat, p_lng) then raise exception 'No GPS location yet'; end if;
  select true into was from track_live where member_id = m.id and until > now();
  fresh := not coalesce(was, false) and not exists (select 1 from track_stats where member_id = m.id and last_ride > now() - interval '3 hours');
  rid := private.track_ride_for(m.id, p_event, p_lat, p_lng, p_acc);
  select * into r from track_rides where id = rid;
  insert into track_live (member_id, lat, lng, acc, at, moved_at, since, until, event_id, note, ride_km, top_spd, move_s, ride_id)
  values (m.id, p_lat, p_lng, p_acc, now(), now(), coalesce(r.started_at, now()), u, p_event, nt, coalesce(r.km, 0), coalesce(r.top_spd, 0), coalesce(r.move_s, 0), rid)
  on conflict (member_id) do update set lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, at = now(), moved_at = now(),
    since = case when track_live.until > now() then track_live.since else excluded.since end, until = u, event_id = excluded.event_id, note = excluded.note,
    ride_km = case when track_live.until > now() then track_live.ride_km else excluded.ride_km end,
    top_spd = case when track_live.until > now() then track_live.top_spd else excluded.top_spd end,
    move_s = case when track_live.until > now() then track_live.move_s else excluded.move_s end,
    ride_id = excluded.ride_id;
  if not coalesce(was, false) then
    insert into track_stats (member_id, rides, last_ride) values (m.id, 1, now())
    on conflict (member_id) do update set rides = track_stats.rides + case when track_stats.last_ride > now() - interval '3 hours' then 0 else 1 end,
      last_ride = now(), updated_at = now();
  end if;
  if fresh then perform private.track_notify(m.id, p_event, nt); end if;
  return u;
end $$;

-- every position: as before, plus moving time and the ride line
create or replace function private.track_ping_m(p_member bigint, p_lat double precision, p_lng double precision, p_acc real, p_spd real, p_hdg real)
returns text language plpgsql security definer set search_path = public, private as $$
declare l track_live; d double precision; dt double precision; ok boolean := false;
        sp real := case when p_spd >= 0 and p_spd <= 55 and coalesce(p_acc, 999) <= 40 then p_spd end;
begin
  select * into l from track_live where member_id = p_member;
  if l.member_id is null or l.until <= now() then delete from track_live where member_id = p_member; return 'stopped'; end if;
  if not private.track_ok(p_lat, p_lng) then return 'ok'; end if;
  if now() - l.at < interval '3 seconds' then return 'ok'; end if;            -- too frequent
  d := private.dist_m(l.lat, l.lng, p_lat, p_lng);
  dt := extract(epoch from now() - l.moved_at);
  if d >= 25 and coalesce(p_acc, 999) <= 40 then
    ok := dt > 0 and dt <= 900 and d / dt <= 55;   -- believable: under 200 km/h, and not after a long gap
    if ok then
      insert into track_stats (member_id, km) values (p_member, round((d / 1000)::numeric, 2))
      on conflict (member_id) do update set km = track_stats.km + round((d / 1000)::numeric, 2), updated_at = now();
    end if;
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now(),
      top_spd = greatest(top_spd, coalesce(sp, 0)),
      ride_km = ride_km + case when ok then (d / 1000)::real else 0 end,
      move_s = move_s + case when ok then least(dt, 45)::real else 0 end   -- a tea break isn't moving time
    where member_id = p_member;
    if l.ride_id is not null then
      begin
        insert into track_points (ride_id, lat, lng, spd) values (l.ride_id, p_lat, p_lng, sp);
        update track_rides set last_at = now(),
          km = km + case when ok then (d / 1000)::real else 0 end,
          move_s = move_s + case when ok then least(dt, 45)::real else 0 end,
          top_spd = greatest(top_spd, coalesce(sp, 0))
        where id = l.ride_id;
      exception when others then null;   -- ride lines never block sharing
      end;
    end if;
  elsif d >= 25 or coalesce(p_acc, 999) < coalesce(l.acc, 999) then
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now(),
      top_spd = greatest(top_spd, coalesce(sp, 0)) where member_id = p_member;
  else
    update track_live set spd = p_spd, hdg = coalesce(p_hdg, hdg), at = now(), top_spd = greatest(top_spd, coalesce(sp, 0)) where member_id = p_member;   -- still here
  end if;
  return 'ok';
end $$;

-- everyone sharing right now (as file 82, plus moving time)
create or replace function private.track_rows()
returns table (member_id bigint, ev bigint, info jsonb) language sql stable security definer set search_path = public, private as $$
  select l.member_id, e.id,
    jsonb_build_object('id', l.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url, 'role', x.role,
      'lat', l.lat, 'lng', l.lng, 'acc', l.acc, 'spd', l.spd, 'hdg', l.hdg, 'at', l.at, 'moved_at', l.moved_at, 'since', l.since, 'until', l.until,
      'ride_km', round(l.ride_km::numeric, 1), 'top_spd', l.top_spd, 'move_s', round(l.move_s), 'note', l.note,
      'event_id', e.id, 'event', e.title, 'event_auto', l.event_id is null and e.id is not null, '_phone', x.phone)
  from track_live l
  join members x on x.id = l.member_id and x.status = 'active'
  left join lateral (
    select ev.id, ev.title from events ev
    where ev.id = l.event_id
       or (l.event_id is null and ev.status = 'live'
           and now() between ev.starts_at - interval '3 hours' and coalesce(ev.ends_at, ev.starts_at + interval '12 hours') + interval '3 hours'
           and exists (select 1 from event_rsvps r where r.event_id = ev.id and r.user_id = x.user_id and r.status = 'going'))
    order by (ev.id = l.event_id) desc, ev.starts_at desc limit 1) e on true
  where l.until > now()
$$;
revoke execute on function private.track_rows() from public, anon, authenticated;

-- positions only, for the map's quick refresh: [id, lat, lng, m/s, heading, at, moved_at, ride km, moving s]
create or replace function public.track_pos() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members; f fam_members; rev bigint;
begin
  select * into m from members where user_id = (select auth.uid()) and status = 'active';
  if m.id is null then
    select * into f from fam_members where user_id = (select auth.uid());
    if f.id is null or not private.fam_ok() then raise exception 'Members only'; end if;
    select t.ev into rev from private.track_rows() t where t.member_id = f.member_id;
    return jsonb_build_object('now', floor(extract(epoch from now())), 'p', coalesce((select jsonb_agg(jsonb_build_array(l.member_id,
        round(l.lat::numeric, 5), round(l.lng::numeric, 5), round(l.spd::numeric, 1), round(l.hdg), floor(extract(epoch from l.at)), floor(extract(epoch from l.moved_at)),
        round(l.ride_km::numeric, 1), round(l.move_s)))
      from track_live l where l.until > now() and l.member_id in (select t.member_id from private.track_rows() t where t.member_id = f.member_id or (rev is not null and t.ev = rev))), '[]'::jsonb));
  end if;
  return jsonb_build_object('now', floor(extract(epoch from now())), 'p', coalesce((select jsonb_agg(jsonb_build_array(l.member_id,
      round(l.lat::numeric, 5), round(l.lng::numeric, 5), round(l.spd::numeric, 1), round(l.hdg), floor(extract(epoch from l.at)), floor(extract(epoch from l.moved_at)),
      round(l.ride_km::numeric, 1), round(l.move_s)))
    from track_live l join members x on x.id = l.member_id and x.status = 'active' where l.until > now()), '[]'::jsonb));
end $$;
revoke execute on function public.track_pos() from public, anon;
grant execute on function public.track_pos() to authenticated;

-- the event a finished ride belongs to: the one picked when sharing, else a live event the rider was Going to at that time
create or replace function private.track_ride_event(p_ride bigint)
returns table (id bigint, title text) language sql stable security definer set search_path = public, private as $$
  select ev.id, ev.title from track_rides r join members x on x.id = r.member_id
  join events ev on ev.id = r.event_id
     or (r.event_id is null and ev.status = 'live'
         and r.started_at between ev.starts_at - interval '3 hours' and coalesce(ev.ends_at, ev.starts_at + interval '12 hours') + interval '3 hours'
         and exists (select 1 from event_rsvps v where v.event_id = ev.id and v.user_id = x.user_id and v.status = 'going'))
  where r.id = p_ride
  order by (ev.id = r.event_id) desc, ev.starts_at desc limit 1
$$;
revoke execute on function private.track_ride_event(bigint) from public, anon, authenticated;

-- rides that ended in the last 24 hours (members only)
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
    where r.last_at > now() - interval '24 hours' and r.km >= 1
      and not exists (select 1 from track_live l where l.ride_id = r.id and l.until > now())), '[]'::jsonb);
end $$;
revoke execute on function public.track_rides_today() from public, anon;
grant execute on function public.track_rides_today() to authenticated;

-- one ride's line, or every line of an event: points [lat, lng, seconds from the start, km/h]; never within 300 m of the start or the end
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
    where r.last_at > now() - interval '24 hours' and r.km >= 1
      and not exists (select 1 from track_live l where l.ride_id = r.id and l.until > now())
      and (r.id = p_ride or (p_event is not null and e.id = p_event))) z), '[]'::jsonb);
end $$;
revoke execute on function public.track_ride_lines(bigint, bigint) from public, anon;
grant execute on function public.track_ride_lines(bigint, bigint) to authenticated;

-- the rider (or an admin) deletes a line
create or replace function public.track_ride_delete(p_ride bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me();
begin
  delete from track_rides r where r.id = p_ride and (r.member_id = m.id or m.role in ('admin', 'superadmin'));
  return 'ok';
end $$;
revoke execute on function public.track_ride_delete(bigint) from public, anon;
grant execute on function public.track_ride_delete(bigint) to authenticated;

-- 24 hours after a ride ends, it goes (with its points)
create or replace function private.track_rides_sweep() returns void
language sql security definer set search_path = public, private as $$
  delete from track_rides where last_at < now() - interval '24 hours';
$$;
select cron.schedule('rwb-track-lines', '17 * * * *', 'select private.track_rides_sweep()');

notify pgrst, 'reload schema';
