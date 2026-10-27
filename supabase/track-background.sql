-- RWB App setup file 46: Track keeps working with the screen off in the RWB Android app. Run after file 45.
-- The Android app now sends your position from its own background service (not from the screen), so Android can't pause it.
-- That service can't use your sign-in (it expires every hour), so while you share it gets a private sharing key instead:
-- * the key only works while you're sharing, only for sending YOUR position, and is deleted when sharing stops.
-- Safe to run more than once.

alter table public.track_live add column if not exists ping_token text;
create unique index if not exists track_live_ping_token on public.track_live (ping_token) where ping_token is not null;

-- the position rules, for one member (used by both ways of sending)
create or replace function private.track_ping_m(p_member bigint, p_lat double precision, p_lng double precision, p_acc real,
  p_spd real, p_hdg real) returns text
language plpgsql security definer set search_path = public, private as $$
declare l track_live; d double precision; dt double precision;
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
    end if;
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now() where member_id = p_member;
  elsif d >= 25 or coalesce(p_acc, 999) < coalesce(l.acc, 999) then
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now() where member_id = p_member;
  else
    update track_live set spd = p_spd, at = now() where member_id = p_member;   -- still here
  end if;
  return 'ok';
end $$;
revoke execute on function private.track_ping_m(bigint, double precision, double precision, real, real, real) from public, anon, authenticated;

-- from the app screen (signed in): unchanged behaviour
create or replace function public.track_ping(p_lat double precision, p_lng double precision, p_acc real default null,
  p_spd real default null, p_hdg real default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me();
begin
  return private.track_ping_m(m.id, p_lat, p_lng, p_acc, p_spd, p_hdg);
end $$;

-- the sharing key for the background service (only while sharing)
create or replace function public.track_token() returns text
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); k text;
begin
  update track_live set ping_token = coalesce(ping_token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  where member_id = m.id and until > now() returning ping_token into k;
  if k is null then raise exception 'You are not sharing right now'; end if;
  return k;
end $$;
revoke execute on function public.track_token() from public, anon;
grant execute on function public.track_token() to authenticated;

-- from the background service: the key instead of a sign-in
create or replace function public.track_ping_key(p_key text, p_lat double precision, p_lng double precision, p_acc real default null,
  p_spd real default null, p_hdg real default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare mid bigint;
begin
  if length(coalesce(p_key, '')) < 40 then return 'stopped'; end if;
  select l.member_id into mid from track_live l join members x on x.id = l.member_id
  where l.ping_token = p_key and l.until > now() and x.status = 'active';
  if mid is null then return 'stopped'; end if;
  return private.track_ping_m(mid, p_lat, p_lng, p_acc, p_spd, p_hdg);
end $$;
revoke execute on function public.track_ping_key(text, double precision, double precision, real, real, real) from public;
grant execute on function public.track_ping_key(text, double precision, double precision, real, real, real) to anon, authenticated;

notify pgrst, 'reload schema';
