-- RWB App setup file 36: privacy first
-- * Members see only each other's name, nickname and photo. Each member chooses what else to show (VRN and bike
--   numbers, bike model, locality, mileage), one by one or all at once. Hidden by default for everyone, including
--   current members. Admins and coordinators still see everything.
-- * Birthdays: only admins and coordinators see them (and the daily birthday notification).
-- * VRN check for members: just "an RWB member or not" (vrn_check).
-- * Terms & Conditions: withdrawing takes effect at once (the app then asks the member to agree, message an admin,
--   or leave RWB); leave_rwb lets them leave; rwb_admins lists the admins they can message.
-- * Terms & Conditions version 2.0: every member agrees once to the new Terms (tnc_version records which version).
-- Safe to run more than once.

-- ---------- 1. What each member shares with other members (nothing, until they choose) ----------
alter table public.members add column if not exists share jsonb not null default '{}'::jsonb;

create or replace function private.shares(m public.members, k text) returns boolean language sql immutable as $$
  select coalesce((m.share ->> k)::boolean, false)
$$;

create or replace function public.set_my_sharing(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  if not exists (select 1 from members where user_id = auth.uid() and status = 'active') then raise exception 'Members only'; end if;
  foreach k in array array['vrn', 'bike', 'locality', 'mileage'] loop
    out := out || jsonb_build_object(k, coalesce((p ->> k)::boolean, false));
  end loop;
  update members set share = out where user_id = auth.uid();
  return out;
end $$;
revoke execute on function public.set_my_sharing(jsonb) from public, anon;
grant execute on function public.set_my_sharing(jsonb) to authenticated;

-- the member list: names for everyone; other details only when shared (admins and coordinators see all)
create or replace function public.member_directory()
returns table (id bigint, full_name text, nickname text, avatar_url text, bike text, vrn text, locality text, role text, phone text,
               on_app boolean, avg_kmpl numeric, vrn_verified boolean, bikes jsonb)
language plpgsql stable security definer set search_path = public, private as $$
declare staff boolean := public.is_moderator();
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select m.id, m.full_name, m.nickname, m.avatar_url,
           case when staff or m.user_id = auth.uid() or private.shares(m, 'bike') then m.bike end,
           case when staff or m.user_id = auth.uid() or private.shares(m, 'vrn') then m.vrn end,
           case when staff or m.user_id = auth.uid() or private.shares(m, 'locality') then m.locality end,
           m.role,
           case when staff or m.role in ('superadmin','admin','coordinator') then m.phone end,   -- the RWB team stays reachable
           m.user_id is not null,
           case when m.show_on_leaderboard and (staff or m.user_id = auth.uid() or private.shares(m, 'mileage')) then m.avg_kmpl end,
           case when staff or m.user_id = auth.uid() or private.shares(m, 'vrn') then m.vrn_verified end,
           case when staff or m.user_id = auth.uid() or private.shares(m, 'vrn') then
             (select jsonb_agg(jsonb_build_object('slot', b.slot, 'vrn', b.vrn, 'model', case when staff or m.user_id = auth.uid() or private.shares(m, 'bike') then b.model end, 'verified', b.verified) order by b.slot)
                from member_bikes b where b.member_id = m.id) end
    from members m where m.status = 'active'
    order by case m.role when 'superadmin' then 0 when 'admin' then 1 when 'coordinator' then 2 else 3 end, m.full_name;
end $$;
revoke execute on function public.member_directory() from public, anon;
grant execute on function public.member_directory() to authenticated;

-- leaderboards: the bike model only when shared
create or replace function public.warrior_boards()
returns table (member_id bigint, full_name text, nickname text, avatar_url text, bike text, km integer, kmpl numeric, tanks integer, services integer, last_service date, is_me boolean)
language plpgsql stable security definer set search_path = public, private as $$
declare staff boolean := public.is_moderator();
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    with readings as (
      select s.user_id, s.odometer_km, s.service_date as d, s.created_at from service_records s
      union all
      select f.user_id, f.odometer_km, f.fill_date, f.created_at from fuel_logs f
      union all
      select m.user_id, m.odo_km, m.odo_date, now() from members m where m.user_id is not null and m.odo_km is not null and m.odo_date is not null
    ), latest as (
      select distinct on (r.user_id) r.user_id, r.odometer_km
      from readings r where r.odometer_km > 0 order by r.user_id, r.d desc, r.created_at desc
    ), svc as (
      select s.user_id, count(*)::int as n, max(s.service_date) as last_d from service_records s group by s.user_id
    )
    select m.id, m.full_name, m.nickname, m.avatar_url,
           case when staff or m.user_id = auth.uid() or private.shares(m, 'bike') then m.bike end,
           l.odometer_km, m.avg_kmpl, m.kmpl_tanks,
           coalesce(v.n, 0), v.last_d, m.user_id = auth.uid()
    from members m
    left join latest l on l.user_id = m.user_id
    left join svc v on v.user_id = m.user_id
    where m.user_id is not null and m.show_on_leaderboard and m.status = 'active'
      and (l.odometer_km is not null or m.avg_kmpl is not null or v.n is not null);
end $$;
revoke execute on function public.warrior_boards() from public, anon;
grant execute on function public.warrior_boards() to authenticated;

-- ---------- 2. VRN check for members: member or not, nothing more ----------
create or replace function public.vrn_check(p_vrn text) returns boolean
language plpgsql stable security definer set search_path = public, private as $$
declare v text := private.norm_vrn(p_vrn);
begin
  if not is_member() then raise exception 'Members only'; end if;
  if v is null or length(v) < 6 then return null; end if;
  return exists (select 1 from members m where m.status = 'active' and private.norm_vrn(m.vrn) = v)
      or exists (select 1 from member_bikes b join members m on m.id = b.member_id where m.status = 'active' and private.norm_vrn(b.vrn) = v);
end $$;
revoke execute on function public.vrn_check(text) from public, anon;
grant execute on function public.vrn_check(text) to authenticated;

-- ---------- 3. Birthdays: admins and coordinators only ----------
create or replace function public.birthdays(p_days integer default 0)
returns table (member_id bigint, full_name text, nickname text, day date, phone text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
declare d0 date := today_ist();
begin
  if not is_moderator() then return; end if;
  return query
    select m.id, m.full_name, m.nickname, g.d::date,
           case when is_admin() then m.phone end, m.user_id is not null
    from generate_series(d0, d0 + greatest(0, least(p_days, 31)), interval '1 day') g(d)
    join members m on m.status = 'active' and m.dob is not null and (
         (extract(month from m.dob) = extract(month from g.d) and extract(day from m.dob) = extract(day from g.d))
      or (extract(month from m.dob) = 2 and extract(day from m.dob) = 29
          and extract(month from g.d) = 2 and extract(day from g.d) = 28
          and extract(day from (date_trunc('year', g.d) + interval '2 months' - interval '1 day')) = 28))
    order by g.d, m.full_name;
end $$;

create or replace function public.post_birthdays() returns integer
language plpgsql security definer set search_path = public as $$
declare names text[]; d date := today_ist();
begin
  if exists (select 1 from notifications where kind = 'birthday' and (created_at at time zone 'Asia/Kolkata')::date = d) then
    return 0;
  end if;
  select array_agg(full_name order by full_name) into names from members m where m.status = 'active' and m.dob is not null and (
       (extract(month from m.dob) = extract(month from d) and extract(day from m.dob) = extract(day from d))
    or (extract(month from m.dob) = 2 and extract(day from m.dob) = 29 and extract(month from d) = 2 and extract(day from d) = 28
        and extract(day from (date_trunc('year', d) + interval '2 months' - interval '1 day')) = 28));
  if names is null then return 0; end if;
  insert into notifications (kind, title, body, url, audience)
  values ('birthday', '🎂 Birthday today',
          case when cardinality(names) = 1 then names[1] || ' has a birthday today. Send the club wish from Home.'
               else array_to_string(names[1:cardinality(names) - 1], ', ') || ' and ' || names[cardinality(names)] || ' have a birthday today. Send the club wish from Home.' end,
          '#home', 'moderators');
  return cardinality(names);
end $$;
-- birthday posts already sent: only the team sees them now
update public.notifications set audience = 'moderators' where kind = 'birthday' and audience = 'all';

-- ---------- 4. Terms & Conditions: withdraw at once, message an admin, or leave ----------
create or replace function public.withdraw_tnc() returns text
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Members only'; end if;
  update members set tnc_agreed = false where id = m.id;
  delete from change_requests where member_id = m.id and kind = 'tnc' and status = 'pending';
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('admin', 'T&C withdrawn', m.full_name || ' no longer agrees to the RWB Terms & Conditions. Their app access is paused until they agree.', '#admin', 'admins', auth.uid());
  return 'withdrawn';
end $$;
revoke execute on function public.withdraw_tnc() from public, anon;
grant execute on function public.withdraw_tnc() to authenticated;

create or replace function public.leave_rwb(p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  select * into m from members where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Members only'; end if;
  if m.role = 'superadmin' then raise exception 'The super admin can''t leave this way'; end if;
  update members set status = 'left', removed_at = now(), removed_by = 'Themself',
    removed_note = left(coalesce(nullif(trim(p_note), ''), 'Did not agree to the RWB Terms & Conditions'), 200)
  where id = m.id;
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('admin', 'Member left', m.full_name || ' left RWB from the app (did not agree to the Terms & Conditions).', '#admin', 'admins', auth.uid());
  return 'left';
end $$;
revoke execute on function public.leave_rwb(text) from public, anon;
grant execute on function public.leave_rwb(text) to authenticated;

-- the admins a member can message (works even while their access is paused)
create or replace function public.rwb_admins() returns table (full_name text, nickname text, phone text, role text)
language sql stable security definer set search_path = public as $$
  select m.full_name, m.nickname, m.phone, m.role from members m
  where m.status = 'active' and m.role in ('superadmin', 'admin') and auth.uid() is not null
    and exists (select 1 from members me where me.user_id = auth.uid())
  order by case m.role when 'superadmin' then 0 else 1 end, m.full_name
$$;
revoke execute on function public.rwb_admins() from public, anon;
grant execute on function public.rwb_admins() to authenticated;

-- ---------- 5. Terms version: everyone agrees to the current Terms once ----------
alter table public.members add column if not exists tnc_version text;
alter table public.members add column if not exists tnc_agreed_at timestamptz;
-- the current version (change it here when the Terms change, and everyone is asked to agree again)
create or replace function private.tnc_current() returns text language sql immutable as $$ select '2.0' $$;

-- agreeing in the app, or being approved after agreeing on the join form, records the current version
-- (answers copied from old sheet rows don't: those were agreements to the old rules)
create or replace function private.tnc_stamp() returns trigger language plpgsql as $$
begin
  if new.tnc_agreed is true and coalesce(current_setting('rwb.from_sheet', true), '') <> 'on'
     and (tg_op = 'INSERT' or old.tnc_agreed is distinct from true) then
    new.tnc_version := private.tnc_current(); new.tnc_agreed_at := now();
  end if;
  if new.tnc_agreed is not true then new.tnc_version := null; end if;
  return new;
end $$;
drop trigger if exists members_tnc_stamp on public.members;
create trigger members_tnc_stamp before insert or update of tnc_agreed on public.members for each row execute function private.tnc_stamp();

create or replace function public.agree_tnc() returns text
language plpgsql security definer set search_path = public, private as $$
begin
  update members set tnc_agreed = true, tnc_version = private.tnc_current(), tnc_agreed_at = now()
  where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Members only'; end if;
  return private.tnc_current();
end $$;
revoke execute on function public.agree_tnc() from public, anon;
grant execute on function public.agree_tnc() to authenticated;

-- follow-ups and reminders: "agree to the T&C" until they agree to the current version
create or replace function private.missing_items(m public.members) returns text[] language sql stable as $$
  select array_remove(array[
    case when m.tnc_agreed is not true or m.tnc_version is distinct from private.tnc_current() then 'rules' end,
    case when nullif(trim(coalesce(m.emergency_phone, '')), '') is null then 'emergency contact' end,
    case when nullif(trim(coalesce(m.blood_group, '')), '') is null then 'blood group' end,
    case when m.dob is null then 'date of birth' end,
    case when nullif(trim(coalesce(m.vrn, '')), '') is null then 'VRN' end,
    case when nullif(trim(coalesce(m.locality, '')), '') is null then 'locality' end,
    case when nullif(trim(coalesce(m.hideout, '')), '') is null then 'permanent hideout' end], null)
$$;

notify pgrst, 'reload schema';
