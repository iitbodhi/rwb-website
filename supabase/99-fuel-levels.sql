-- 99-fuel-levels.sql (Nov 28 2026, Bodhi): mileage follows the petrol in the tank, so a part fill with a DTE reading
-- counts at once (in the average and the Warriorboards), not only after the next fill-up.
-- Petrol used since the last good reading: both ends measured (Full tank → tank size; DTE before filling → ~2 L Ronin empty
-- level + DTE ÷ k) → level after then + litres in between − level now; otherwise fill to fill (litres filled since).
-- k = km per litre the dash uses: median of fill-ups with Full tank + DTE, else the rider's km-and-litres average.
-- A "Full tank" that can't be (expected level + litres < size − 2.5 L) counts as a part fill until the rider confirms it
-- in the app (fuel_logs.full_sure). Ranges, joining, "leave out one" and the 3-in-a-row rule are as in files 97/98.
-- Same maths as fuelReadings()/tanks() in app/js/app.js: keep both the same. Recalculates everyone once. Safe to run twice.

alter table public.fuel_logs add column if not exists full_sure boolean not null default false;

-- one pass; p_levels false = km and litres only (pass 1)
create or replace function private.fuel_pass(p_user uuid, p_slot int, p_levels boolean, p_k numeric, p_avg numeric)
returns table(end_d date, dist numeric, used numeric, exact boolean)
language plpgsql stable security definer set search_path = public as $$
declare m record; model text; vk text; ronin boolean; cap numeric; size numeric; empty numeric; lo numeric; hi numeric; soft numeric;
        os numeric[]; ls numeric[]; ds date[]; fu boolean[]; su boolean[]; rg numeric[]; sus boolean[];
        rd date[] := '{}'; rk numeric[] := '{}'; ru numeric[] := '{}'; rx boolean[] := '{}'; keep boolean[] := '{}';
        cnt int; base int := 0; i int := 1; n int; d numeric; btw numeric; u numeric; r numeric;
        aa numeric; afull boolean := false; bb numeric; ok boolean; ex numeric; lvl boolean; ra int; rb int; rj int;
begin
  select * into m from members where user_id = p_user limit 1;
  if p_slot = 1 then model := m.bike; vk := coalesce(private.vrn_key(m.vrn), 'main');
  else select b.model, private.vrn_key(b.vrn) into model, vk from member_bikes b where b.member_id = m.id and b.slot = p_slot; end if;
  ronin := private.is_ronin(model);
  size := case when ronin then 14 else nullif(m.tanks ->> vk, '')::numeric end;
  cap := coalesce(size, 20);
  if not p_levels then size := null; end if;
  empty := case when ronin then 2 else 0 end;
  lo := case when ronin then 25 else 12 end;
  hi := case when ronin then 55 else 80 end;
  soft := case when ronin then 50 else 80 end;
  select array_agg(x.odometer_km::numeric order by x.odometer_km, x.fill_date, x.id), array_agg(x.litres::numeric order by x.odometer_km, x.fill_date, x.id),
         array_agg(x.fill_date order by x.odometer_km, x.fill_date, x.id), array_agg(coalesce(x.full_tank, false) order by x.odometer_km, x.fill_date, x.id),
         array_agg(coalesce(x.full_sure, false) order by x.odometer_km, x.fill_date, x.id), array_agg(x.range_km::numeric order by x.odometer_km, x.fill_date, x.id)
    into os, ls, ds, fu, su, rg
    from (select distinct on (f.fill_date, f.odometer_km, f.litres::numeric, f.full_tank) f.*
            from fuel_logs f where f.user_id = p_user and f.bike_slot = p_slot
             and (p_slot = 1 or f.bike_vrn is null or private.vrn_key(f.bike_vrn) = vk)
           order by f.fill_date, f.odometer_km, f.litres::numeric, f.full_tank, f.id) x;
  cnt := coalesce(array_length(os, 1), 0);
  sus := array_fill(false, array[greatest(cnt, 1)]);
  while i <= cnt loop
    if ls[i] > cap + 0.5 or base = 0 then
      -- start a stretch here (level from this fill-up's own data)
      base := i;
      afull := p_levels and size is not null and fu[i] and not sus[i];
      aa := case when not p_levels then null when afull then size
                 when rg[i] is not null then least(coalesce(size, 99), empty + rg[i] / p_k + ls[i]) end;
      i := i + 1; continue;
    end if;
    n := i - base; d := os[i] - os[base];
    select coalesce(sum(ls[j]), 0) into btw from generate_series(base + 1, i - 1) j;
    ok := false; bb := null;
    if p_levels then
      ex := case when aa is not null then aa + btw - d / p_avg end;
      if size is not null and fu[i] then
        ok := su[i] or ex is null or ex + ls[i] >= size - 2.5;
        if not ok then sus[i] := true; end if;
      end if;
      bb := case when ok then greatest(0, size - ls[i]) when rg[i] is not null then empty + rg[i] / p_k end;
    end if;
    lvl := bb is not null and aa is not null;
    u := case when lvl then aa + btw - bb else btw + ls[i] end;
    r := case when u <> 0 then d / u end;
    if d > 0 and u > 0.3 and r between lo and hi then
      rd := rd || ds[i]; rk := rk || d; ru := ru || u; rx := rx || (not lvl or (afull and ok)); keep := keep || true;
      base := i;
      aa := case when not p_levels then null when ok then size when bb is not null then least(coalesce(size, 99), bb + ls[i]) else aa end;
      afull := ok; i := i + 1; continue;
    end if;
    if (d > 0 and (r < lo or u <= 0.3 or n >= 3 or btw + ls[i] > cap * 2)) or (d <= 0 and n >= 3) then
      base := base + 1;
      afull := p_levels and size is not null and fu[base] and not sus[base];
      aa := case when not p_levels then null when afull then size
                 when rg[base] is not null then least(coalesce(size, 99), empty + rg[base] / p_k + ls[base]) end;
      i := base + 1; continue;
    end if;
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
    if keep[rj] then end_d := rd[rj]; dist := rk[rj]; used := ru[rj]; exact := rx[rj]; return next; end if;
  end loop;
end $$;
revoke execute on function private.fuel_pass(uuid, int, boolean, numeric, numeric) from public, anon, authenticated;

-- readings for one bike of a rider (slot 1 = main bike): pass 1 (km + litres) gives the average, pass 2 follows the tank
create or replace function private.fuel_readings(p_user uuid, p_slot int default 1)
returns table(end_d date, dist numeric, used numeric, exact boolean)
language plpgsql stable security definer set search_path = public as $$
declare m record; model text; vk text; ronin boolean; size numeric; empty numeric; av numeric; kk numeric;
begin
  select * into m from members where user_id = p_user limit 1;
  if p_slot = 1 then model := m.bike; vk := coalesce(private.vrn_key(m.vrn), 'main');
  else select b.model, private.vrn_key(b.vrn) into model, vk from member_bikes b where b.member_id = m.id and b.slot = p_slot; end if;
  ronin := private.is_ronin(model);
  size := case when ronin then 14 else nullif(m.tanks ->> vk, '')::numeric end;
  empty := case when ronin then 2 else 0 end;
  select sum(p.dist) / nullif(sum(p.used), 0) into av from private.fuel_pass(p_user, p_slot, false, 40, 40) p;
  av := coalesce(av, 40);
  if size is not null then
    select percentile_cont(0.5) within group (order by x.k) into kk
      from (select f.range_km / (size - f.litres - empty) k from fuel_logs f
             where f.user_id = p_user and f.bike_slot = p_slot and f.full_tank and f.range_km > 0 and size - f.litres - empty > 0.5
               and (p_slot = 1 or f.bike_vrn is null or private.vrn_key(f.bike_vrn) = vk)) x
     where x.k between 10 and 90;
  end if;
  kk := least(90, greatest(10, coalesce(kk, av)));
  return query select * from private.fuel_pass(p_user, p_slot, true, kk, av);
end $$;
revoke execute on function private.fuel_readings(uuid, int) from public, anon, authenticated;

do $$ declare u uuid; begin
  for u in select distinct user_id from members where user_id is not null and (avg_kmpl is not null or user_id in (select user_id from fuel_logs)) loop
    perform private.kmpl_refresh(u);
  end loop;
end $$;

notify pgrst, 'reload schema';
