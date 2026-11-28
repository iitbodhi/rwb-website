-- 104-track-moving-time.sql (Nov 28 2026)
-- File 103 counted every stretch as at most 45 s of moving time. When a phone sends a point only every few
-- minutes (Arnab's walk/cycle: 586 m in 3.5 min), that made the stretch look like 586 m in 45 s = 47 km/h,
-- and pushed both the average and the top speed far too high. Now a stretch counts its real time, unless it
-- was mostly standing still: then it counts at most 45 s or the time to cover that distance at 7 km/h
-- (whichever is more). Arnab's ride 24 is corrected (avg ~7.8, top ~14.6 km/h). Safe to run twice.

create or replace function private.track_ping_m(p_member bigint, p_lat double precision, p_lng double precision, p_acc real, p_spd real, p_hdg real)
returns text language plpgsql security definer set search_path = public, private as $$
declare l track_live; d double precision; dt double precision; mv double precision; ok boolean := false; seg real;
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
    -- moving time for this stretch: the real time, but a long gap with little distance (a stop) counts at most
    -- 45 s, or the time it takes at 7 km/h (2 m/s) to cover that distance, whichever is more
    mv := least(dt, greatest(45, d / 2));
    -- no GPS speed from the phone: the speed over this stretch (same time as the average) counts towards top speed
    seg := case when ok and sp is null then least(d / greatest(mv, 1), 55)::real end;
    if ok then
      insert into track_stats (member_id, km) values (p_member, round((d / 1000)::numeric, 2))
      on conflict (member_id) do update set km = track_stats.km + round((d / 1000)::numeric, 2), updated_at = now();
    end if;
    update track_live set lat = p_lat, lng = p_lng, acc = p_acc, spd = p_spd, hdg = p_hdg, at = now(), moved_at = now(),
      top_spd = greatest(top_spd, coalesce(sp, 0), coalesce(seg, 0)),
      ride_km = ride_km + case when ok then (d / 1000)::real else 0 end,
      move_s = move_s + case when ok then mv::real else 0 end   -- a tea break isn't moving time
    where member_id = p_member;
    if l.ride_id is not null then
      begin
        insert into track_points (ride_id, lat, lng, spd) values (l.ride_id, p_lat, p_lng, sp);
        update track_rides set last_at = now(),
          km = km + case when ok then (d / 1000)::real else 0 end,
          move_s = move_s + case when ok then mv::real else 0 end,
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

-- ride 24 (the only ride file 103 changed): moving time and top speed again from its points, the same way
with p as (select spd, private.dist_m(lag(lat) over w, lag(lng) over w, lat, lng) d, extract(epoch from t - lag(t) over w) dt
           from track_points where ride_id = 24 window w as (order by t)),
q as (select spd, d, least(dt, greatest(45, d / 2)) c from p where dt > 0 and dt <= 900 and d / dt <= 55)
update track_rides set move_s = (select sum(c) from q) * km * 1000 / nullif((select sum(d) from q), 0),
  top_spd = (select greatest(coalesce(max(spd), 0), coalesce(max(d / greatest(c, 1)) filter (where spd is null), 0)) from q)
where id = 24 and exists (select 1 from q);

notify pgrst, 'reload schema';
