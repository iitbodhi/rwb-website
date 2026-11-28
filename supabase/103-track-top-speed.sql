-- 103-track-top-speed.sql (Nov 28 2026)
-- Bug: Recent rides showed "avg 12 · top 11 km/h". Top speed came only from the phone's GPS speed readings,
-- and some phones send few or none (that ride: 5 of 25 points had one), while the average comes from the
-- distance ridden. Now, when a point arrives without a usable GPS speed, the speed over that stretch
-- (distance ÷ time since the last point, the same time the average uses) counts towards top speed too,
-- so the average can never be above the top. Old rides and live shares are corrected the same way.
-- Safe to run twice.

create or replace function private.track_ping_m(p_member bigint, p_lat double precision, p_lng double precision, p_acc real, p_spd real, p_hdg real)
returns text language plpgsql security definer set search_path = public, private as $$
declare l track_live; d double precision; dt double precision; ok boolean := false; seg real;
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
    -- no GPS speed from the phone: use the speed over this stretch (counted the same way as the average)
    seg := case when ok and sp is null then least(d / greatest(least(dt, 45), 1), 55)::real end;
    if ok then
      insert into track_stats (member_id, km) values (p_member, round((d / 1000)::numeric, 2))
      on conflict (member_id) do update set km = track_stats.km + round((d / 1000)::numeric, 2), updated_at = now();
    end if;
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now(),
      top_spd = greatest(top_spd, coalesce(sp, 0), coalesce(seg, 0)),
      ride_km = ride_km + case when ok then (d / 1000)::real else 0 end,
      move_s = move_s + case when ok then least(dt, 45)::real else 0 end   -- a tea break isn't moving time
    where member_id = p_member;
    if l.ride_id is not null then
      begin
        insert into track_points (ride_id, lat, lng, spd) values (l.ride_id, p_lat, p_lng, sp);
        update track_rides set last_at = now(),
          km = km + case when ok then (d / 1000)::real else 0 end,
          move_s = move_s + case when ok then least(dt, 45)::real else 0 end,
          top_spd = greatest(top_spd, coalesce(sp, 0), coalesce(seg, 0))
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

-- rides already saved: the top speed is at least the stretch speeds between their points (≤ 200 km/h, gaps ≥ 3 s)
with seg as (
  select ride_id, max(least(private.dist_m(plat, plng, lat, lng) / greatest(least(extract(epoch from t - pt), 45), 1), 55)) s
  from (select ride_id, t, lat, lng, lag(lat) over w plat, lag(lng) over w plng, lag(t) over w pt
        from track_points window w as (partition by ride_id order by t)) x
  where pt is not null and extract(epoch from t - pt) >= 3 and extract(epoch from t - pt) <= 900
  group by ride_id)
update track_rides r set top_spd = greatest(r.top_spd, seg.s)
from seg where seg.ride_id = r.id and r.move_s >= 60 and r.top_spd < r.km * 1000 / r.move_s;

-- anything still impossible (few points kept): top = the average, never below it
update track_rides set top_spd = km * 1000 / move_s where move_s >= 60 and top_spd < km * 1000 / move_s and km * 1000 / move_s <= 55;
update track_live set top_spd = ride_km * 1000 / move_s where move_s >= 60 and top_spd < ride_km * 1000 / move_s and ride_km * 1000 / move_s <= 55;

notify pgrst, 'reload schema';
