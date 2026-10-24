-- =====================================================================
-- RWB App: keep the RWB contact sheet (Google Form responses) up to date from the app
--   • a member approved in the app gets a new row in the sheet
--   • changes a member makes in Me (or an admin makes) update their row
--   • a member removed by an admin is removed from the sheet (a copy goes to a "Removed members" tab)
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

-- 3. Send new members and changes to the sheet (through the Apps Script web app)
create or replace function private.sheet_push() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare u text; s text;
begin
  if coalesce(current_setting('rwb.from_sheet', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and (new.full_name, new.dob, new.phone, new.email, new.vrn, new.bike, new.blood_group, new.locality, new.hideout, new.emergency_phone, new.alt_phone)
       is not distinct from (old.full_name, old.dob, old.phone, old.email, old.vrn, old.bike, old.blood_group, old.locality, old.hideout, old.emergency_phone, old.alt_phone) then
    return new;
  end if;
  select value into u from private.config where key = 'sheet_webhook_url';
  select value into s from private.config where key = 'sheet_secret';
  if u is null or u not like 'https://%' or s is null then return new; end if;
  perform net.http_post(
    url := u,
    body := jsonb_build_object('secret', s, 'action', lower(tg_op), 'old_phone', case when tg_op = 'UPDATE' then old.phone end,
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

notify pgrst, 'reload schema';
