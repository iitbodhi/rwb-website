-- 98-fuel-high-run.sql (Nov 28 2026, Bodhi): Ronin readings may go up to 55 km/l (owners online claim up to 55 on gentle
-- highway runs), but readings over 50 count only in a run of 3 or more such readings in a row (a one-off 50+ is usually a
-- missed fill-up). Other bikes unchanged (12–80). Same rule as fuelReadings() in app/js/app.js (KMPL_RANGE, HIGH_RUN).
-- Recalculates every rider's Mileage figure once. Safe to run twice.

create or replace function private.fuel_readings(p_user uuid, p_slot int default 1)
returns table(end_d date, dist numeric, used numeric, exact boolean)
language plpgsql stable security definer set search_path = public as $$
declare m record; model text; vk text; ronin boolean; cap numeric; lo numeric; hi numeric; soft numeric;
        rd date[] := '{}'; rk numeric[] := '{}'; ru numeric[] := '{}'; keep boolean[] := '{}'; ra int; rb int; rj int;
        os numeric[]; ls numeric[]; ds date[]; cnt int; base int := 0; i int := 1; n int; d numeric; l numeric; r numeric;
begin
  select * into m from members where user_id = p_user limit 1;
  if p_slot = 1 then model := m.bike; vk := coalesce(private.vrn_key(m.vrn), 'main');
  else select b.model, private.vrn_key(b.vrn) into model, vk from member_bikes b where b.member_id = m.id and b.slot = p_slot; end if;
  ronin := private.is_ronin(model);
  cap := case when ronin then 14 else coalesce(nullif(m.tanks ->> vk, '')::numeric, 20) end;
  lo := case when ronin then 25 else 12 end;
  hi := case when ronin then 55 else 80 end;
  soft := case when ronin then 50 else 80 end;
  -- one row per fill-up (exact duplicates skipped), by odometer
  select array_agg(x.odometer_km::numeric order by x.odometer_km, x.fill_date, x.id), array_agg(x.litres::numeric order by x.odometer_km, x.fill_date, x.id),
         array_agg(x.fill_date order by x.odometer_km, x.fill_date, x.id)
    into os, ls, ds
    from (select distinct on (f.fill_date, f.odometer_km, f.litres::numeric, f.full_tank) f.*
            from fuel_logs f where f.user_id = p_user and f.bike_slot = p_slot
             and (p_slot = 1 or f.bike_vrn is null or private.vrn_key(f.bike_vrn) = vk)
           order by f.fill_date, f.odometer_km, f.litres::numeric, f.full_tank, f.id) x;
  cnt := coalesce(array_length(os, 1), 0);
  while i <= cnt loop
    if ls[i] > cap + 0.5 then base := i; i := i + 1; continue; end if;
    if base = 0 then base := i; i := i + 1; continue; end if;
    n := i - base; d := os[i] - os[base];
    select sum(ls[j]) into l from generate_series(base + 1, i) j;
    r := d / l;
    if d > 0 and r between lo and hi then
      rd := rd || ds[i]; rk := rk || d; ru := ru || l; keep := keep || true;
      base := i; i := i + 1; continue;
    end if;
    -- can't add up: leave out only the first fill-up after the last good one, read again from it
    if (d > 0 and (r < lo or n >= 3 or l > cap * 2)) or (d <= 0 and n >= 3) then base := base + 1; i := base + 1; continue; end if;
    i := i + 1;
  end loop;
  -- over the normal top (Ronin 50): keep only runs of 3+ such readings in a row
  ra := 1;
  while ra <= coalesce(array_length(rk, 1), 0) loop
    if rk[ra] / ru[ra] <= soft then ra := ra + 1; continue; end if;
    rb := ra;
    while rb <= array_length(rk, 1) and rk[rb] / ru[rb] > soft loop rb := rb + 1; end loop;
    if rb - ra < 3 then for rj in ra .. rb - 1 loop keep[rj] := false; end loop; end if;
    ra := rb;
  end loop;
  for rj in 1 .. coalesce(array_length(rk, 1), 0) loop
    if keep[rj] then end_d := rd[rj]; dist := rk[rj]; used := ru[rj]; exact := true; return next; end if;
  end loop;
end $$;
revoke execute on function private.fuel_readings(uuid, int) from public, anon, authenticated;

do $$ declare u uuid; begin
  for u in select distinct user_id from members where user_id is not null and (avg_kmpl is not null or user_id in (select user_id from fuel_logs)) loop
    perform private.kmpl_refresh(u);
  end loop;
end $$;

notify pgrst, 'reload schema';
