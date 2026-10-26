-- RWB App setup file 43: Track (multi-rider live location, SOS, GPS Warriors leaderboard)
-- * Riders share their live location for 1, 4 or 8 hours (or until they stop); every member can see who is sharing on a map.
-- * SOS: an urgent alert with the rider's location to every admin and coordinator.
-- * GPS Warriors: kilometres ridden while sharing (GPS noise and impossible jumps are ignored).
-- Locations are only kept while someone is sharing: when they stop or the time runs out, their location is deleted.
-- Safe to run more than once.

-- ---------- tables (read and written only through the functions below) ----------
create table if not exists public.track_live (
  member_id bigint primary key references public.members(id) on delete cascade,
  lat double precision not null, lng double precision not null,
  acc real, spd real, hdg real,
  at timestamptz not null default now(),      -- last update from the phone
  moved_at timestamptz not null default now(),-- last time the position was moved (for distance)
  since timestamptz not null default now(),
  until timestamptz not null,
  event_id bigint references public.events(id) on delete set null
);
create table if not exists public.track_sos (
  id bigint generated always as identity primary key,
  member_id bigint not null references public.members(id) on delete cascade,
  lat double precision not null, lng double precision not null, acc real,
  at timestamptz not null default now(),
  resolved_at timestamptz, resolved_by text
);
create index if not exists track_sos_open on public.track_sos (resolved_at, at);
create table if not exists public.track_stats (
  member_id bigint primary key references public.members(id) on delete cascade,
  km numeric(10,2) not null default 0,
  rides integer not null default 0,
  last_ride timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.track_live enable row level security;
alter table public.track_sos enable row level security;
alter table public.track_stats enable row level security;

-- SOS alerts are a notification kind of their own
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array['announcement','birthday','motomart','member','admin','event','personal','sos']));

-- ---------- helpers ----------
create or replace function private.track_me() returns public.members
language plpgsql stable security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where user_id = auth.uid() and status = 'active';
  if m.id is null then raise exception 'Members only'; end if;
  return m;
end $$;
-- metres between two points
create or replace function private.dist_m(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2)
       + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)))
$$;
create or replace function private.track_ok(lat double precision, lng double precision) returns boolean language sql immutable as $$
  select lat between -90 and 90 and lng between -180 and 180 and not (lat = 0 and lng = 0)
$$;

-- ---------- start / update / stop sharing ----------
create or replace function public.track_start(p_lat double precision, p_lng double precision, p_acc real default null,
  p_hours integer default 4, p_event bigint default null) returns timestamptz
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); u timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 4), 1), 12)); was boolean;
begin
  if not private.track_ok(p_lat, p_lng) then raise exception 'No GPS location yet'; end if;
  select true into was from track_live where member_id = m.id and until > now();
  insert into track_live (member_id, lat, lng, acc, at, moved_at, since, until, event_id)
  values (m.id, p_lat, p_lng, p_acc, now(), now(), now(), u, p_event)
  on conflict (member_id) do update set lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, at = now(), moved_at = now(),
    since = case when track_live.until > now() then track_live.since else now() end, until = u, event_id = excluded.event_id;
  if not coalesce(was, false) then
    insert into track_stats (member_id, rides, last_ride) values (m.id, 1, now())
    on conflict (member_id) do update set rides = track_stats.rides + case when track_stats.last_ride > now() - interval '3 hours' then 0 else 1 end,
      last_ride = now(), updated_at = now();
  end if;
  return u;
end $$;

-- the phone sends its position; distance counts only for clean, believable movement
create or replace function public.track_ping(p_lat double precision, p_lng double precision, p_acc real default null,
  p_spd real default null, p_hdg real default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); l track_live; d double precision; dt double precision;
begin
  select * into l from track_live where member_id = m.id;
  if l.member_id is null or l.until <= now() then delete from track_live where member_id = m.id; return 'stopped'; end if;
  if not private.track_ok(p_lat, p_lng) then return 'ok'; end if;
  if now() - l.at < interval '4 seconds' then return 'ok'; end if;            -- too frequent
  d := private.dist_m(l.lat, l.lng, p_lat, p_lng);
  dt := extract(epoch from now() - l.moved_at);
  if d >= 25 and coalesce(p_acc, 999) <= 40 then
    -- believable: under 200 km/h, and not after a long gap (straight-line jumps aren't ridden distance)
    if dt > 0 and dt <= 900 and d / dt <= 55 then
      insert into track_stats (member_id, km) values (m.id, round((d / 1000)::numeric, 2))
      on conflict (member_id) do update set km = track_stats.km + round((d / 1000)::numeric, 2), updated_at = now();
    end if;
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now() where member_id = m.id;
  elsif d >= 25 or coalesce(p_acc, 999) < coalesce(l.acc, 999) then
    -- a fix that's too rough to count (or a better fix of the same spot): show it, don't count it
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now() where member_id = m.id;
  else
    update track_live set spd = p_spd, at = now() where member_id = m.id;   -- still here
  end if;
  return 'ok';
end $$;

create or replace function public.track_stop() returns text
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me();
begin
  delete from track_live where member_id = m.id;
  return 'stopped';
end $$;

-- ---------- the map ----------
create or replace function public.track_view() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); staff boolean := m.role in ('coordinator', 'admin', 'superadmin');
begin
  delete from track_live where until <= now();
  return jsonb_build_object(
    'riders', coalesce((select jsonb_agg(jsonb_build_object('id', l.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
        'lat', l.lat, 'lng', l.lng, 'acc', l.acc, 'spd', l.spd, 'hdg', l.hdg, 'at', l.at, 'since', l.since, 'until', l.until,
        'event_id', l.event_id, 'me', l.member_id = m.id, 'role', x.role, 'phone', case when staff then x.phone end) order by x.full_name)
      from track_live l join members x on x.id = l.member_id where x.status = 'active'), '[]'::jsonb),
    'sos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'member_id', s.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
        'lat', s.lat, 'lng', s.lng, 'acc', s.acc, 'at', s.at, 'me', s.member_id = m.id, 'phone', case when staff then x.phone end) order by s.at desc)
      from track_sos s join members x on x.id = s.member_id where s.resolved_at is null and s.at > now() - interval '24 hours'), '[]'::jsonb),
    'staff', staff, 'now', now());
end $$;

-- ---------- SOS ----------
create or replace function public.track_sos(p_lat double precision, p_lng double precision, p_acc real default null) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); s track_sos; nm text;
begin
  if not private.track_ok(p_lat, p_lng) then raise exception 'No GPS location yet. Step into the open and try again, or call an admin.'; end if;
  nm := coalesce(nullif(m.nickname, ''), split_part(m.full_name, ' ', 1));
  select * into s from track_sos where member_id = m.id and resolved_at is null and at > now() - interval '24 hours' order by at desc limit 1;
  if s.id is not null then
    update track_sos set lat = p_lat, lng = p_lng, acc = p_acc where id = s.id;
    if s.at > now() - interval '2 minutes' then return s.id; end if;          -- just sent: only the location is updated
    update track_sos set at = now() where id = s.id;
  else
    insert into track_sos (member_id, lat, lng, acc) values (m.id, p_lat, p_lng, p_acc) returning * into s;
  end if;
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('sos', '🆘 SOS: ' || m.full_name, nm || ' needs help. Tap to see where on the map.' || coalesce(' Call ' || m.phone || '.', ''),
          '#track/sos', 'moderators', auth.uid());
  return s.id;
end $$;

create or replace function public.track_sos_resolve(p_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); s track_sos; who text;
begin
  select * into s from track_sos where id = p_id and resolved_at is null;
  if s.id is null then return 'done'; end if;
  if s.member_id <> m.id and m.role not in ('coordinator', 'admin', 'superadmin') then raise exception 'Only the rider or the RWB team can close an SOS'; end if;
  update track_sos set resolved_at = now(), resolved_by = m.full_name where id = s.id;
  select full_name into who from members where id = s.member_id;
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('sos', '✅ SOS closed: ' || who, case when s.member_id = m.id then who || ' is safe.' else 'Closed by ' || m.full_name || '.' end, '#track', 'moderators', auth.uid());
  return 'done';
end $$;

-- ---------- GPS Warriors leaderboard ----------
create or replace function public.gps_board() returns table (member_id bigint, full_name text, nickname text, avatar_url text, bike text, km numeric, rides integer, is_me boolean)
language sql stable security definer set search_path = public as $$
  select x.id, x.full_name, x.nickname, x.avatar_url, x.bike, t.km, t.rides, x.user_id = auth.uid()
  from track_stats t join members x on x.id = t.member_id
  where t.km >= 0.1 and x.status = 'active' and x.show_on_leaderboard and exists (select 1 from members me where me.user_id = auth.uid() and me.status = 'active')
  order by t.km desc limit 200
$$;

-- ---------- SOS pushes: urgent, marked so phones vibrate hard and the alert stays ----------
create or replace function public.push_job(p_id bigint, p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n notifications;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then
    raise exception 'Not allowed';
  end if;
  select * into n from notifications where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'subject',      (select value from private.config where key = 'vapid_subject'),
    'vapid_public', (select value from private.config where key = 'vapid_public'),
    'vapid_private',(select value from private.config where key = 'vapid_private'),
    'payload', jsonb_build_object('title', n.title, 'body', n.body, 'url', coalesce(n.url, '#home'), 'tag', n.kind || '-' || n.id,
                                  'sos', n.kind = 'sos' and n.title like '🆘%'),
    'urgent', n.kind = 'sos',
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
      from push_subscriptions s join members m on m.user_id = s.user_id
      where (n.audience = 'all'
             or (n.audience = 'admins' and m.role in ('admin','superadmin'))
             or (n.audience = 'moderators' and m.role in ('coordinator','admin','superadmin'))
             or (n.audience = 'going' and exists (select 1 from event_rsvps r where r.event_id = n.event_id and r.user_id = s.user_id and r.status in ('going','maybe')))
             or (n.audience = 'user' and s.user_id = n.target_user))
        and (n.created_by is null or s.user_id <> n.created_by)
        and (n.kind in ('announcement','admin','event','personal','sos') or coalesce((m.notify ->> n.kind)::boolean, true))
    ), '[]'::jsonb));
end $$;

-- ---------- who may call what ----------
do $$ declare f text; begin
  foreach f in array array['track_start(double precision, double precision, real, integer, bigint)', 'track_ping(double precision, double precision, real, real, real)',
    'track_stop()', 'track_view()', 'track_sos(double precision, double precision, real)', 'track_sos_resolve(bigint)', 'gps_board()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.push_job(bigint, text) from public, anon, authenticated;
grant execute on function public.push_job(bigint, text) to service_role;

notify pgrst, 'reload schema';
