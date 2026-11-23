-- 82: Track polish (Nov 2026)
-- * this ride's distance and top speed for every rider who shares (track_live.ride_km, top_spd)
-- * the event a rider is on: the one they shared for, or else a live RWB event they said "Going" to that is happening now
-- * track_view sends the event's name, ride km, top speed and when the rider last moved
-- Safe to run twice.

alter table public.track_live add column if not exists ride_km real not null default 0;
alter table public.track_live add column if not exists top_spd real not null default 0;

-- a new share starts a new ride (same rule as the ride count: a share that is still running keeps its numbers)
create or replace function public.track_start(p_lat double precision, p_lng double precision, p_acc real default null, p_hours integer default 4, p_event bigint default null, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); u timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 4), 1), 12)); was boolean;
        nt text := left(nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), ''), 60);
begin
  if not private.track_ok(p_lat, p_lng) then raise exception 'No GPS location yet'; end if;
  select true into was from track_live where member_id = m.id and until > now();
  insert into track_live (member_id, lat, lng, acc, at, moved_at, since, until, event_id, note, ride_km, top_spd)
  values (m.id, p_lat, p_lng, p_acc, now(), now(), now(), u, p_event, nt, 0, 0)
  on conflict (member_id) do update set lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, at = now(), moved_at = now(),
    since = case when track_live.until > now() then track_live.since else now() end, until = u, event_id = excluded.event_id, note = excluded.note,
    ride_km = case when track_live.until > now() then track_live.ride_km else 0 end,
    top_spd = case when track_live.until > now() then track_live.top_spd else 0 end;
  if not coalesce(was, false) then
    insert into track_stats (member_id, rides, last_ride) values (m.id, 1, now())
    on conflict (member_id) do update set rides = track_stats.rides + case when track_stats.last_ride > now() - interval '3 hours' then 0 else 1 end,
      last_ride = now(), updated_at = now();
  end if;
  return u;
end $$;

-- every position: same checks as before, plus this ride's km and top speed (top speed only from believable GPS speeds, under 200 km/h)
create or replace function private.track_ping_m(p_member bigint, p_lat double precision, p_lng double precision, p_acc real, p_spd real, p_hdg real)
returns text language plpgsql security definer set search_path = public, private as $$
declare l track_live; d double precision; dt double precision;
        sp real := case when p_spd >= 0 and p_spd <= 55 and coalesce(p_acc, 999) <= 40 then p_spd end;
begin
  select * into l from track_live where member_id = p_member;
  if l.member_id is null or l.until <= now() then delete from track_live where member_id = p_member; return 'stopped'; end if;
  if not private.track_ok(p_lat, p_lng) then return 'ok'; end if;
  if now() - l.at < interval '4 seconds' then return 'ok'; end if;            -- too frequent
  d := private.dist_m(l.lat, l.lng, p_lat, p_lng);
  dt := extract(epoch from now() - l.moved_at);
  if d >= 25 and coalesce(p_acc, 999) <= 40 then
    -- believable: under 200 km/h, and not after a long gap (straight-line jumps aren't ridden distance)
    if dt > 0 and dt <= 900 and d / dt <= 55 then
      insert into track_stats (member_id, km) values (p_member, round((d / 1000)::numeric, 2))
      on conflict (member_id) do update set km = track_stats.km + round((d / 1000)::numeric, 2), updated_at = now();
      update track_live set ride_km = ride_km + (d / 1000)::real where member_id = p_member;
    end if;
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now(),
      top_spd = greatest(top_spd, coalesce(sp, 0)) where member_id = p_member;
  elsif d >= 25 or coalesce(p_acc, 999) < coalesce(l.acc, 999) then
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now(),
      top_spd = greatest(top_spd, coalesce(sp, 0)) where member_id = p_member;
  else
    update track_live set spd = p_spd, at = now(), top_spd = greatest(top_spd, coalesce(sp, 0)) where member_id = p_member;   -- still here
  end if;
  return 'ok';
end $$;

-- everyone sharing right now, with the event they're on
create or replace function private.track_rows()
returns table (member_id bigint, ev bigint, info jsonb) language sql stable security definer set search_path = public, private as $$
  select l.member_id, e.id,
    jsonb_build_object('id', l.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url, 'role', x.role,
      'lat', l.lat, 'lng', l.lng, 'acc', l.acc, 'spd', l.spd, 'hdg', l.hdg, 'at', l.at, 'moved_at', l.moved_at, 'since', l.since, 'until', l.until,
      'ride_km', round(l.ride_km::numeric, 1), 'top_spd', l.top_spd, 'note', l.note,
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

create or replace function public.track_view() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members; f fam_members; staff boolean := false; rev bigint;
begin
  delete from track_live where until <= now();
  select * into m from members where user_id = (select auth.uid()) and status = 'active';
  if m.id is null then
    -- a FAM user: their own rider, and riders on the same event ride as their rider
    select * into f from fam_members where user_id = (select auth.uid());
    if f.id is null or not private.fam_ok() then raise exception 'Members only'; end if;
    select t.ev into rev from private.track_rows() t where t.member_id = f.member_id;
    return jsonb_build_object(
      'riders', coalesce((select jsonb_agg((t.info - '_phone') || jsonb_build_object('me', false, 'mine', t.member_id = f.member_id, 'phone', null)
          order by (t.member_id = f.member_id) desc, t.info->>'name')
        from private.track_rows() t where t.member_id = f.member_id or (rev is not null and t.ev = rev)), '[]'::jsonb),
      'sos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'member_id', s.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
          'lat', s.lat, 'lng', s.lng, 'acc', s.acc, 'at', s.at, 'me', false, 'phone', null))
        from track_sos s join members x on x.id = s.member_id where s.member_id = f.member_id and s.resolved_at is null and s.at > now() - interval '24 hours'), '[]'::jsonb),
      'staff', false, 'fam', true, 'rider', f.member_id, 'now', now());
  end if;
  staff := m.role in ('coordinator', 'admin', 'superadmin');
  return jsonb_build_object(
    'riders', coalesce((select jsonb_agg((t.info - '_phone') || jsonb_build_object('me', t.member_id = m.id, 'phone', case when staff then t.info->>'_phone' end)
        order by t.info->>'name')
      from private.track_rows() t), '[]'::jsonb),
    'sos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'member_id', s.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
        'lat', s.lat, 'lng', s.lng, 'acc', s.acc, 'at', s.at, 'me', s.member_id = m.id, 'phone', case when staff then x.phone end) order by s.at desc)
      from track_sos s join members x on x.id = s.member_id where s.resolved_at is null and s.at > now() - interval '24 hours'), '[]'::jsonb),
    'staff', staff, 'now', now());
end $$;
revoke execute on function public.track_view() from public, anon;
grant execute on function public.track_view() to authenticated;

notify pgrst, 'reload schema';
