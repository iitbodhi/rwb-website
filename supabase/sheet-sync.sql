-- =====================================================================
-- RWB App: keep the RWB contact sheet (Google Form responses) up to date from the app
--   • a member approved in the app gets a new row in the sheet
--   • changes a member makes in Me (or an admin makes) update their row
--   • a member removed by an admin is removed from the sheet (a copy goes to a "Removed members" tab)
--   • in the app, removed members are kept as a record ("Left" / "Removed"), and can be restored
--   • the app's join request asks the same questions as the join form
--
-- BEFORE RUNNING: paste your Apps Script web-app link on the line marked ★ below.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

-- ★ The Apps Script web-app link (Deploy → New deployment → Web app → copy the URL ending in /exec)
insert into private.config (key, value) values ('sheet_webhook_url', 'PASTE-WEB-APP-URL-HERE')
on conflict (key) do update set value = excluded.value where excluded.value like 'https://%';

-- 1. The app's join request now asks the same questions as the join form
alter table public.link_requests add column if not exists bike text;
alter table public.link_requests add column if not exists blood_group text;
alter table public.link_requests add column if not exists hideout text;
alter table public.link_requests add column if not exists emergency_phone text;

drop function if exists public.request_access(text, text, date, text, text);
create or replace function public.request_access(p_full_name text, p_phone text, p_dob date default null,
    p_vrn text default null, p_locality text default null, p_bike text default null, p_blood_group text default null,
    p_hideout text default null, p_emergency_phone text default null)
returns text language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
        em text := nullif(right(regexp_replace(coalesce(p_emergency_phone, ''), '\D', '', 'g'), 10), '');
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  if length(ph) <> 10 then raise exception 'Please enter a 10-digit WhatsApp number'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Please enter your full name'; end if;
  insert into link_requests (user_id, email, full_name, phone, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, status)
  values (auth.uid(), auth.jwt() ->> 'email', trim(p_full_name), ph, p_dob, nullif(upper(trim(p_vrn)), ''), nullif(trim(p_locality), ''),
          nullif(trim(p_bike), ''), nullif(trim(p_blood_group), ''), nullif(trim(p_hideout), ''), em, 'pending')
  on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone, dob = excluded.dob,
    vrn = excluded.vrn, locality = excluded.locality, bike = excluded.bike, blood_group = excluded.blood_group,
    hideout = excluded.hideout, emergency_phone = excluded.emergency_phone, status = 'pending', created_at = now();
  return 'pending';
end $$;
revoke execute on function public.request_access(text, text, date, text, text, text, text, text, text) from public, anon;
grant execute on function public.request_access(text, text, date, text, text, text, text, text, text) to authenticated;

-- Approving copies every answer into the member record (and fills gaps of an existing sheet member)
create or replace function public.admin_approve_request(p_request_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare r link_requests; m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from link_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  select * into m from members where phone = r.phone;
  if found then
    if m.user_id is not null and m.user_id <> r.user_id then
      raise exception 'That WhatsApp number is already linked to another app account. Remove it first if this is the same person.';
    end if;
    update members set user_id = r.user_id, email = coalesce(email, r.email), dob = coalesce(dob, r.dob), vrn = coalesce(vrn, r.vrn),
      locality = coalesce(locality, r.locality), bike = coalesce(bike, r.bike), blood_group = coalesce(blood_group, r.blood_group),
      hideout = coalesce(hideout, r.hideout), emergency_phone = coalesce(emergency_phone, r.emergency_phone)
    where id = m.id;
  else
    insert into members (full_name, phone, email, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, user_id, joined_at)
    values (r.full_name, r.phone, r.email, r.dob, r.vrn, r.locality, r.bike, r.blood_group, r.hideout, r.emergency_phone, r.user_id, now());
  end if;
  delete from link_requests where id = r.id;
  return 'approved';
end $$;

-- Admins see the extra answers on pending requests
drop function if exists public.admin_list_requests();
create function public.admin_list_requests()
returns table (id bigint, email text, full_name text, phone text, dob date, vrn text, locality text, created_at timestamptz,
               match_member_id bigint, match_name text, match_linked boolean, bike text, blood_group text, hideout text, emergency_phone text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select r.id, r.email, r.full_name, r.phone, r.dob, r.vrn, r.locality, r.created_at,
           m.id, m.full_name, m.user_id is not null, r.bike, r.blood_group, r.hideout, r.emergency_phone
    from link_requests r left join members m on m.phone = r.phone
    where r.status = 'pending' order by r.created_at;
end $$;
revoke execute on function public.admin_list_requests() from public, anon;
grant execute on function public.admin_list_requests() to authenticated;

-- 2. Rows that come FROM the sheet are not sent back to it
create or replace function private.mark_from_sheet() returns void
language sql as $$ select set_config('rwb.from_sheet', 'on', true); $$;

do $$
declare src text;
begin
  select pg_get_functiondef('public.sheet_upsert_member(text, jsonb)'::regprocedure) into src;
  if position('rwb.from_sheet' in src) = 0 then
    src := replace(src, '  if length(ph) <> 10 or nm is null then return', '  perform set_config(''rwb.from_sheet'', ''on'', true);' || chr(10) || '  if length(ph) <> 10 or nm is null then return');
    execute src;
  end if;
end $$;

-- 3. Keep removed members as a record instead of deleting them
alter table public.members add column if not exists status text not null default 'active';
alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check check (status in ('active','left','removed'));
alter table public.members add column if not exists removed_at timestamptz;
alter table public.members add column if not exists removed_by text;
alter table public.members add column if not exists removed_note text;
create index if not exists members_status_idx on public.members (status);

-- Send new members and changes to the sheet (through the Apps Script web app)
create or replace function private.sheet_push() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare u text; s text; act text := lower(tg_op);
begin
  if coalesce(current_setting('rwb.from_sheet', true), '') = 'on' then return new; end if;
  select value into u from private.config where key = 'sheet_webhook_url';
  select value into s from private.config where key = 'sheet_secret';
  if u is null or u not like 'https://%' or s is null then return new; end if;
  -- removed or left: take their row off the sheet (a copy is kept in the "Removed members" tab)
  if tg_op = 'UPDATE' and new.status <> 'active' and old.status = 'active' then
    perform net.http_post(url := u, body := jsonb_build_object('secret', s, 'action', 'delete', 'phone', old.phone, 'full_name', old.full_name),
      headers := jsonb_build_object('Content-Type', 'application/json'), timeout_milliseconds := 8000);
    return new;
  end if;
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'active' then act := 'insert'; end if;   -- restored: add them back
  if tg_op = 'UPDATE' and old.status = 'active' and (new.full_name, new.dob, new.phone, new.email, new.vrn, new.bike, new.blood_group, new.locality, new.hideout, new.emergency_phone, new.alt_phone)
       is not distinct from (old.full_name, old.dob, old.phone, old.email, old.vrn, old.bike, old.blood_group, old.locality, old.hideout, old.emergency_phone, old.alt_phone) then
    return new;
  end if;
  perform net.http_post(
    url := u,
    body := jsonb_build_object('secret', s, 'action', act, 'old_phone', case when tg_op = 'UPDATE' then old.phone end,
      'member', jsonb_build_object('full_name', new.full_name, 'dob', new.dob, 'phone', new.phone, 'email', new.email, 'vrn', new.vrn,
        'bike', new.bike, 'blood_group', new.blood_group, 'locality', new.locality, 'hideout', new.hideout,
        'emergency_phone', new.emergency_phone, 'alt_phone', new.alt_phone, 'joined_at', new.joined_at)),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 8000);
  return new;
exception when others then
  return new;   -- never block saving in the app because the sheet is unreachable
end $$;
drop trigger if exists members_to_sheet on public.members;
create trigger members_to_sheet after insert or update on public.members for each row execute function private.sheet_push();

-- 4. A member removed by an admin (on the app or not) is removed from the sheet too
create or replace function private.sheet_remove() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare u text; s text;
begin
  select value into u from private.config where key = 'sheet_webhook_url';
  select value into s from private.config where key = 'sheet_secret';
  if u is null or u not like 'https://%' or s is null or old.phone is null then return old; end if;
  perform net.http_post(url := u,
    body := jsonb_build_object('secret', s, 'action', 'delete', 'phone', old.phone, 'full_name', old.full_name),
    headers := jsonb_build_object('Content-Type', 'application/json'), timeout_milliseconds := 8000);
  return old;
exception when others then
  return old;
end $$;
drop trigger if exists members_off_sheet on public.members;
create trigger members_off_sheet after delete on public.members for each row execute function private.sheet_remove();


-- 5. Removing a member: their app account and data are deleted, the member record is kept as "Left" or "Removed"
drop function if exists public.admin_remove_member(bigint);
create or replace function public.admin_remove_member(p_member_id bigint, p_reason text default 'removed', p_note text default null) returns text
language plpgsql security definer set search_path = public, auth, private as $$
declare m members; who text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_reason not in ('left','removed') then raise exception 'Reason must be left or removed'; end if;
  select * into m from members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;
  if m.user_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  if m.role = 'superadmin' then raise exception 'The super admin cannot be removed'; end if;
  if m.role = 'admin' and not is_superadmin() then raise exception 'Only the super admin can remove an admin'; end if;
  select coalesce(nickname, full_name) into who from members where user_id = auth.uid();
  update members set status = p_reason, removed_at = now(), removed_by = who, removed_note = nullif(trim(coalesce(p_note, '')), ''),
                     role = 'member', removing = false, avatar_url = null, odo_km = null, odo_date = null, avg_kmpl = null, kmpl_tanks = null
  where id = m.id;
  if m.user_id is not null then delete from auth.users where id = m.user_id; end if;   -- app account, records, bills, documents
  return p_reason;
end $$;
revoke execute on function public.admin_remove_member(bigint, text, text) from public, anon;
grant execute on function public.admin_remove_member(bigint, text, text) to authenticated;

-- Bring someone back (also happens by itself when they register again)
create or replace function public.admin_restore_member(p_member_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare ph text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update members set status = 'active', removed_at = null, removed_by = null, removed_note = null, joined_at = now()
  where id = p_member_id and status <> 'active' returning phone into ph;
  if ph is null then raise exception 'Member not found or already active'; end if;
  delete from private.removed_phones where phone = ph;
  return 'restored';
end $$;
revoke execute on function public.admin_restore_member(bigint) from public, anon;
grant execute on function public.admin_restore_member(bigint) to authenticated;

-- Join form → app: a removed member who registers again is restored; an old row from before the removal is ignored
create or replace function public.sheet_upsert_member(p_secret text, p jsonb) returns text
language plpgsql security definer set search_path = public, private as $$
declare
  ph   text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 10);
  nm   text := nullif(trim(p ->> 'full_name'), '');
  ts   timestamptz := coalesce(nullif(p ->> 'joined_at', '')::timestamptz, now());
  v_dob date;
  gone timestamptz;
  ex   members;
  added boolean;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then
    raise exception 'Not allowed';
  end if;
  perform set_config('rwb.from_sheet', 'on', true);
  if length(ph) <> 10 or nm is null then return 'skipped: no name or number'; end if;
  begin v_dob := nullif(p ->> 'dob', '')::date; exception when others then v_dob := null; end;
  select * into ex from members where phone = ph;
  if found and ex.status <> 'active' then
    if ts <= ex.removed_at then return 'skipped: removed by admin'; end if;
    update members set status = 'active', removed_at = null, removed_by = null, removed_note = null, joined_at = ts,
      full_name = nm, dob = coalesce(v_dob, members.dob), email = coalesce(nullif(lower(trim(p ->> 'email')), ''), members.email)
    where id = ex.id;
    delete from private.removed_phones where phone = ph;
    insert into notifications (kind, title, body, url, audience)
    values ('admin', 'A member rejoined', nm || ' registered again through the website form', '#admin/members', 'admins');
    return 'rejoined';
  end if;
  select removed_at into gone from private.removed_phones where phone = ph;
  if gone is not null and not found then
    if ts <= gone then return 'skipped: removed by admin'; end if;
    delete from private.removed_phones where phone = ph;
  end if;

  insert into members (full_name, dob, phone, email, vrn, bike, blood_group, locality, hideout, emergency_phone, alt_phone, joined_at)
  values (nm, v_dob, ph, nullif(lower(trim(p ->> 'email')), ''), nullif(upper(trim(p ->> 'vrn')), ''), nullif(trim(p ->> 'bike'), ''),
          nullif(trim(p ->> 'blood_group'), ''), nullif(trim(p ->> 'locality'), ''), nullif(trim(p ->> 'hideout'), ''),
          nullif(trim(p ->> 'emergency_phone'), ''), nullif(trim(p ->> 'alt_phone'), ''), ts)
  on conflict (phone) do update set
    dob             = coalesce(members.dob, excluded.dob),
    email           = coalesce(members.email, excluded.email),
    vrn             = coalesce(members.vrn, excluded.vrn),
    bike            = coalesce(members.bike, excluded.bike),
    blood_group     = coalesce(members.blood_group, excluded.blood_group),
    locality        = coalesce(members.locality, excluded.locality),
    hideout         = coalesce(members.hideout, excluded.hideout),
    emergency_phone = coalesce(members.emergency_phone, excluded.emergency_phone),
    alt_phone       = coalesce(members.alt_phone, excluded.alt_phone)
  returning (xmax = 0) into added;

  if added then
    insert into notifications (kind, title, body, url, audience)
    values ('admin', 'New RWB registration', nm || ' just joined through the website form', '#admin/members', 'admins');
    return 'added';
  end if;
  return 'exists';
end $$;
revoke execute on function public.sheet_upsert_member(text, jsonb) from public;
grant execute on function public.sheet_upsert_member(text, jsonb) to anon, authenticated;

-- App join request approved for someone who had left: they're restored as a new member
create or replace function public.admin_approve_request(p_request_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare r link_requests; m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from link_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  select * into m from members where phone = r.phone;
  if found then
    if m.user_id is not null and m.user_id <> r.user_id then
      raise exception 'That WhatsApp number is already linked to another app account. Remove it first if this is the same person.';
    end if;
    update members set user_id = r.user_id, email = coalesce(email, r.email), dob = coalesce(dob, r.dob), vrn = coalesce(vrn, r.vrn),
      locality = coalesce(locality, r.locality), bike = coalesce(bike, r.bike), blood_group = coalesce(blood_group, r.blood_group),
      hideout = coalesce(hideout, r.hideout), emergency_phone = coalesce(emergency_phone, r.emergency_phone),
      status = 'active', removed_at = null, removed_by = null, removed_note = null,
      joined_at = case when m.status <> 'active' then now() else joined_at end
    where id = m.id;
    delete from private.removed_phones where phone = r.phone;
  else
    insert into members (full_name, phone, email, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, user_id, joined_at)
    values (r.full_name, r.phone, r.email, r.dob, r.vrn, r.locality, r.bike, r.blood_group, r.hideout, r.emergency_phone, r.user_id, now());
  end if;
  delete from link_requests where id = r.id;
  return 'approved';
end $$;

-- Pending requests also say if that number belongs to someone who left or was removed
drop function if exists public.admin_list_requests();
create function public.admin_list_requests()
returns table (id bigint, email text, full_name text, phone text, dob date, vrn text, locality text, created_at timestamptz,
               match_member_id bigint, match_name text, match_linked boolean, bike text, blood_group text, hideout text, emergency_phone text,
               match_status text, match_removed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select r.id, r.email, r.full_name, r.phone, r.dob, r.vrn, r.locality, r.created_at,
           m.id, m.full_name, m.user_id is not null, r.bike, r.blood_group, r.hideout, r.emergency_phone, m.status, m.removed_at
    from link_requests r left join members m on m.phone = r.phone
    where r.status = 'pending' order by r.created_at;
end $$;
revoke execute on function public.admin_list_requests() from public, anon;
grant execute on function public.admin_list_requests() to authenticated;

-- Signing in with Google only links to an active member
create or replace function public.link_account() returns text
language plpgsql security definer set search_path = public as $$
declare
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  mid bigint;
begin
  if auth.uid() is null then return 'signed_out'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then em := ''; end if;
  if em <> '' then
    select id into mid from members where lower(email) = em and user_id is null and status = 'active' order by id desc limit 1;
    if mid is not null then
      update members set user_id = auth.uid() where id = mid;
      delete from link_requests where user_id = auth.uid();
      return 'member';
    end if;
  end if;
  if exists (select 1 from link_requests where user_id = auth.uid() and status = 'pending') then return 'pending'; end if;
  if exists (select 1 from link_requests where user_id = auth.uid() and status = 'rejected') then return 'rejected'; end if;
  return 'not_found';
end $$;

-- Member list, birthdays and counts show active members only
create or replace function public.member_directory()
returns table (id bigint, full_name text, nickname text, avatar_url text, bike text, vrn text, locality text, role text, phone text, on_app boolean, avg_kmpl numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select m.id, m.full_name, m.nickname, m.avatar_url, m.bike, m.vrn, m.locality, m.role,
           case when m.role in ('superadmin','admin','coordinator') then m.phone end,
           m.user_id is not null,
           case when m.show_on_leaderboard then m.avg_kmpl end
    from members m where m.status = 'active'
    order by case m.role when 'superadmin' then 0 when 'admin' then 1 when 'coordinator' then 2 else 3 end, m.full_name;
end $$;

create or replace function public.birthdays(p_days integer default 0)
returns table (member_id bigint, full_name text, nickname text, day date, phone text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
declare d0 date := today_ist();
begin
  if not is_member() then raise exception 'Members only'; end if;
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
  insert into notifications (kind, title, body, url)
  values ('birthday', '🎂 Happy Birthday!',
          case when cardinality(names) = 1 then 'Wish ' || names[1] || ' a great ride ahead!'
               else 'Wish ' || array_to_string(names[1:cardinality(names) - 1], ', ') || ' and ' || names[cardinality(names)] || ' a great ride ahead!' end,
          '#home');
  return cardinality(names);
end $$;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'members',  (select count(*) from members where status = 'active'),
    'on_app',   (select count(*) from members where user_id is not null and status = 'active'),
    'pending',  (select count(*) from link_requests where status = 'pending'),
    'admins',   (select count(*) from members where role in ('admin','superadmin') and status = 'active'),
    'gone',     (select count(*) from members where status <> 'active'));
end $$;

notify pgrst, 'reload schema';
