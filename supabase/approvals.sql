-- =====================================================================
-- RWB App: one approval list for every new entry (join form + app), with 4 checks,
-- the RWB contact sheet synced both ways, and up to 3 bikes per member.
--
--   • Join form entries no longer become members straight away: they wait in the approval list
--     next to app join requests. Nobody is a member until an admin approves.
--   • Each entry shows 4 checks: new or existing member, has a Ronin, VRN verified (ticked by an admin),
--     agreed to the RWB terms.
--   • Edits typed into the sheet now reach the app too (and app edits keep reaching the sheet).
--   • Members can list up to 3 bikes; admins mark each VRN as verified.
--
-- Run once in Supabase > SQL Editor, after 28. Safe to run again.
-- =====================================================================

-- ---------- 1. Entries: the existing request table now holds form entries too ----------
alter table public.link_requests alter column user_id drop not null;
alter table public.link_requests add column if not exists source text not null default 'app';
alter table public.link_requests drop constraint if exists link_requests_source_check;
alter table public.link_requests add constraint link_requests_source_check check (source in ('app','form'));
alter table public.link_requests add column if not exists tnc boolean;
alter table public.link_requests add column if not exists vrn_verified boolean not null default false;
alter table public.link_requests add column if not exists form_ts timestamptz;
alter table public.link_requests add column if not exists decided_at timestamptz;
alter table public.link_requests add column if not exists decided_by text;
alter table public.link_requests add column if not exists reject_reason text;
alter table public.link_requests drop constraint if exists link_requests_status_check;
alter table public.link_requests add constraint link_requests_status_check check (status in ('pending','rejected','approved'));
create index if not exists link_requests_phone_idx on public.link_requests (phone);

-- ---------- 2. Bikes: the main bike stays on the member record; bikes 2 and 3 live here ----------
alter table public.members add column if not exists vrn_verified boolean not null default false;
create table if not exists public.member_bikes (
  id          bigint generated always as identity primary key,
  member_id   bigint not null references public.members(id) on delete cascade,
  slot        smallint not null check (slot in (2, 3)),
  vrn         text not null,
  model       text,
  verified    boolean not null default false,
  verified_by text,
  created_at  timestamptz not null default now(),
  unique (member_id, slot)
);
alter table public.member_bikes enable row level security;
revoke all on public.member_bikes from anon;
revoke insert, update, delete on public.member_bikes from authenticated;
grant select on public.member_bikes to authenticated;
drop policy if exists member_bikes_select on public.member_bikes;
create policy member_bikes_select on public.member_bikes for select to authenticated
  using (public.is_admin() or member_id in (select id from public.members where user_id = auth.uid()));

create or replace function private.norm_vrn(v text) returns text language sql immutable as
$$ select nullif(upper(regexp_replace(coalesce(v, ''), '[^A-Za-z0-9]', '', 'g')), '') $$;
create or replace function private.admin_name() returns text language sql stable security definer set search_path = public as
$$ select coalesce((select coalesce(nickname, split_part(full_name, ' ', 1)) from members where user_id = auth.uid() limit 1), 'an admin') $$;
create or replace function private.has_ronin(b text) returns boolean language sql immutable as
$$ select coalesce(b ~* 'ronin' or b ~* '^\s*(yes|yeah|yep|y)\y', false) $$;

-- Changing a VRN un-verifies it (unless an admin verifies the new one in the same save)
create or replace function private.members_vrn_check() returns trigger language plpgsql as $$
begin
  if private.norm_vrn(new.vrn) is distinct from private.norm_vrn(old.vrn) and new.vrn_verified is not distinct from old.vrn_verified then
    new.vrn_verified := false;
  end if;
  return new;
end $$;
drop trigger if exists members_vrn_check on public.members;
create trigger members_vrn_check before update of vrn on public.members for each row execute function private.members_vrn_check();

-- ---------- 3. Member details → sheet (now with status, verified VRN and bikes 2 and 3) ----------
create or replace function private.member_json(m public.members) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('full_name', m.full_name, 'dob', m.dob, 'phone', m.phone, 'email', m.email, 'vrn', m.vrn,
    'bike', m.bike, 'blood_group', m.blood_group, 'locality', m.locality, 'hideout', m.hideout,
    'emergency_phone', m.emergency_phone, 'alt_phone', m.alt_phone, 'joined_at', m.joined_at,
    'vrn_verified', m.vrn_verified,
    'bike2_vrn', (select vrn from member_bikes where member_id = m.id and slot = 2),
    'bike2_model', (select model from member_bikes where member_id = m.id and slot = 2),
    'bike3_vrn', (select vrn from member_bikes where member_id = m.id and slot = 3),
    'bike3_model', (select model from member_bikes where member_id = m.id and slot = 3))
$$;
create or replace function private.sheet_post(body jsonb) returns void language plpgsql security definer set search_path = public, private as $$
declare u text; s text;
begin
  select value into u from private.config where key = 'sheet_webhook_url';
  select value into s from private.config where key = 'sheet_secret';
  if u is null or u not like 'https://%' or s is null then return; end if;
  perform net.http_post(url := u, body := body || jsonb_build_object('secret', s),
    headers := jsonb_build_object('Content-Type', 'application/json'), timeout_milliseconds := 8000);
exception when others then null;   -- never block saving in the app because the sheet is unreachable
end $$;

create or replace function private.sheet_push() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare act text := lower(tg_op);
begin
  if coalesce(current_setting('rwb.from_sheet', true), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and new.status <> 'active' and old.status = 'active' then
    perform private.sheet_post(jsonb_build_object('action', 'delete', 'phone', old.phone, 'full_name', old.full_name));
    return new;
  end if;
  if new.status <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status <> 'active' then act := 'insert'; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and (new.full_name, new.dob, new.phone, new.email, new.vrn, new.bike, new.blood_group, new.locality, new.hideout, new.emergency_phone, new.alt_phone, new.vrn_verified)
       is not distinct from (old.full_name, old.dob, old.phone, old.email, old.vrn, old.bike, old.blood_group, old.locality, old.hideout, old.emergency_phone, old.alt_phone, old.vrn_verified) then
    return new;
  end if;
  perform private.sheet_post(jsonb_build_object('action', act, 'old_phone', case when tg_op = 'UPDATE' then old.phone end, 'member', private.member_json(new)));
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists members_to_sheet on public.members;
create trigger members_to_sheet after insert or update on public.members for each row execute function private.sheet_push();

create or replace function private.bikes_push() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare m members;
begin
  if coalesce(current_setting('rwb.from_sheet', true), '') = 'on' then return null; end if;
  select * into m from members where id = coalesce(new.member_id, old.member_id) and status = 'active';
  if found then perform private.sheet_post(jsonb_build_object('action', 'update', 'old_phone', m.phone, 'member', private.member_json(m))); end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists member_bikes_to_sheet on public.member_bikes;
create trigger member_bikes_to_sheet after insert or update or delete on public.member_bikes for each row execute function private.bikes_push();

-- ---------- 4. Join form entries → approval list (no longer straight into the member list) ----------
create or replace function public.sheet_upsert_member(p_secret text, p jsonb) returns text
language plpgsql security definer set search_path = public, private as $$
declare
  ph   text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 10);
  nm   text := nullif(regexp_replace(trim(coalesce(p ->> 'full_name', '')), '\s+', ' ', 'g'), '');
  ts   timestamptz := coalesce(nullif(p ->> 'joined_at', '')::timestamptz, now());
  tc   boolean := case lower(coalesce(p ->> 'tnc', '')) when 'yes' then true when 'no' then false else null end;
  v_dob date;
  gone timestamptz;
  ex   members;
  rid  bigint;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then
    raise exception 'Not allowed';
  end if;
  perform set_config('rwb.from_sheet', 'on', true);
  if length(ph) <> 10 or nm is null then return 'skipped: no name or number'; end if;
  begin v_dob := nullif(p ->> 'dob', '')::date; exception when others then v_dob := null; end;
  -- this form response was already handled
  if exists (select 1 from link_requests where phone = ph and form_ts is not null and abs(extract(epoch from form_ts - ts)) < 2) then return 'exists'; end if;
  select * into ex from members where phone = ph;
  if found and ex.status = 'active' and ts <= ex.joined_at + interval '1 day' then return 'exists'; end if;      -- their original entry
  if found and ex.status <> 'active' and ts <= ex.removed_at then return 'skipped: removed by admin'; end if;    -- an entry from before they left
  if not found then
    select removed_at into gone from private.removed_phones where phone = ph;
    if gone is not null and ts <= gone then return 'skipped: removed by admin'; end if;
  end if;
  -- a new entry (or a member filling the form again): it waits for an admin
  select id into rid from link_requests where phone = ph and status = 'pending' order by created_at desc limit 1;
  if rid is null then
    insert into link_requests (user_id, source, email, full_name, phone, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, alt_phone, tnc, form_ts, status)
    values (null, 'form', nullif(lower(trim(p ->> 'email')), ''), nm, ph, v_dob, nullif(upper(trim(p ->> 'vrn')), ''), nullif(trim(p ->> 'locality'), ''),
            nullif(trim(p ->> 'bike'), ''), nullif(trim(p ->> 'blood_group'), ''), nullif(trim(p ->> 'hideout'), ''),
            nullif(right(regexp_replace(coalesce(p ->> 'emergency_phone', ''), '\D', '', 'g'), 10), ''),
            nullif(right(regexp_replace(coalesce(p ->> 'alt_phone', ''), '\D', '', 'g'), 10), ''), tc, ts, 'pending');
  else
    update link_requests set source = 'form', full_name = nm, email = coalesce(nullif(lower(trim(p ->> 'email')), ''), email), dob = coalesce(v_dob, dob),
      vrn = coalesce(nullif(upper(trim(p ->> 'vrn')), ''), vrn), locality = coalesce(nullif(trim(p ->> 'locality'), ''), locality),
      bike = coalesce(nullif(trim(p ->> 'bike'), ''), bike), blood_group = coalesce(nullif(trim(p ->> 'blood_group'), ''), blood_group),
      hideout = coalesce(nullif(trim(p ->> 'hideout'), ''), hideout),
      emergency_phone = coalesce(nullif(right(regexp_replace(coalesce(p ->> 'emergency_phone', ''), '\D', '', 'g'), 10), ''), emergency_phone),
      alt_phone = coalesce(nullif(right(regexp_replace(coalesce(p ->> 'alt_phone', ''), '\D', '', 'g'), 10), ''), alt_phone),
      tnc = coalesce(tc, tnc), form_ts = ts
    where id = rid;
  end if;
  return 'pending';
end $$;
revoke execute on function public.sheet_upsert_member(text, jsonb) from public;
grant execute on function public.sheet_upsert_member(text, jsonb) to anon, authenticated;

-- Admins are told about every new entry
create or replace function private.request_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', case when new.source = 'form' then 'New registration' else 'New access request' end,
            new.full_name || case when new.source = 'form' then ' filled the join form. Check and approve.' else ' wants to join the app' end,
            '#admin', 'admins', new.user_id);
  end if;
  return new;
end $$;

-- ---------- 5. Join requests from the app: same questions + the RWB terms ----------
drop function if exists public.request_access(text, text, date, text, text, text, text, text, text, text);
create or replace function public.request_access(p_full_name text, p_phone text, p_dob date default null,
    p_vrn text default null, p_locality text default null, p_bike text default null, p_blood_group text default null,
    p_hideout text default null, p_emergency_phone text default null, p_alt_phone text default null, p_tnc boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
        em text := right(regexp_replace(coalesce(p_emergency_phone, ''), '\D', '', 'g'), 10);
        al text := nullif(right(regexp_replace(coalesce(p_alt_phone, ''), '\D', '', 'g'), 10), '');
        nm text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
        vr text := nullif(upper(regexp_replace(trim(coalesce(p_vrn, '')), '\s+', ' ', 'g')), '');
        rid bigint;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  if char_length(nm) < 3 then raise exception 'Please fill in your Full Name'; end if;
  if length(ph) <> 10 then raise exception 'WhatsApp No. needs a 10-digit number'; end if;
  if p_dob is null or p_dob > current_date or p_dob < date '1930-01-01' then raise exception 'Please fill in your Date of Birth'; end if;
  if nullif(trim(coalesce(p_bike, '')), '') is null then raise exception 'Please answer: Do you own a Ronin bike?'; end if;
  if vr is null or length(regexp_replace(vr, '[^A-Z0-9]', '', 'g')) < 6 then raise exception 'Please fill in your VRN (for example WB 02 AB 1234)'; end if;
  if nullif(trim(coalesce(p_blood_group, '')), '') is null then raise exception 'Please choose your Blood group'; end if;
  if nullif(trim(coalesce(p_locality, '')), '') is null then raise exception 'Please fill in your Current Locality'; end if;
  if length(em) <> 10 then raise exception 'The emergency contact needs a 10-digit number'; end if;
  if em = ph then raise exception 'The emergency contact should be someone else''s number'; end if;
  if al is not null and length(al) <> 10 then raise exception 'Mobile No. (alternative) needs a 10-digit number'; end if;
  if not coalesce(p_tnc, false) then raise exception 'Please read and agree to the RWB rules'; end if;
  -- already registered through the form and waiting? attach this app account to that entry
  select id into rid from link_requests where phone = ph and status = 'pending' and user_id is null order by created_at desc limit 1;
  if rid is not null and not exists (select 1 from link_requests where user_id = auth.uid()) then
    update link_requests set user_id = auth.uid(), email = coalesce(email, auth.jwt() ->> 'email'), tnc = true, alt_phone = coalesce(alt_phone, al)
    where id = rid;
    return 'pending';
  end if;
  insert into link_requests (user_id, source, email, full_name, phone, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, alt_phone, tnc, status)
  values (auth.uid(), 'app', auth.jwt() ->> 'email', nm, ph, p_dob, vr, trim(p_locality), trim(p_bike), trim(p_blood_group),
          nullif(trim(coalesce(p_hideout, '')), ''), em, al, true, 'pending')
  on conflict (user_id) do update set source = 'app', full_name = excluded.full_name, phone = excluded.phone, dob = excluded.dob,
    vrn = excluded.vrn, locality = excluded.locality, bike = excluded.bike, blood_group = excluded.blood_group,
    hideout = excluded.hideout, emergency_phone = excluded.emergency_phone, alt_phone = excluded.alt_phone, tnc = true,
    vrn_verified = false, decided_at = null, decided_by = null, reject_reason = null, form_ts = null,
    status = 'pending', created_at = now();
  return 'pending';
end $$;
revoke execute on function public.request_access(text, text, date, text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.request_access(text, text, date, text, text, text, text, text, text, text, boolean) to authenticated;

-- Signing in: a member, a waiting entry (from the app or the form, matched by email), or not found
create or replace function public.link_account() returns text
language plpgsql security definer set search_path = public as $$
declare
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  mid bigint; rid bigint;
begin
  if auth.uid() is null then return 'signed_out'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then em := ''; end if;
  if em <> '' then
    select id into mid from members where lower(email) = em and user_id is null and status = 'active' order by id desc limit 1;
    if mid is not null then
      update members set user_id = auth.uid() where id = mid;
      return 'member';
    end if;
    -- filled the join form with this email and is waiting for approval
    if not exists (select 1 from link_requests where user_id = auth.uid()) then
      select id into rid from link_requests where lower(email) = em and user_id is null and status = 'pending' order by created_at desc limit 1;
      if rid is not null then update link_requests set user_id = auth.uid() where id = rid; return 'pending'; end if;
    end if;
  end if;
  if exists (select 1 from link_requests where user_id = auth.uid() and status = 'pending') then return 'pending'; end if;
  if exists (select 1 from link_requests where user_id = auth.uid() and status = 'rejected') then return 'rejected'; end if;
  return 'not_found';
end $$;

-- ---------- 6. The approval list with its 4 checks ----------
drop function if exists public.admin_list_requests();
create function public.admin_list_requests()
returns table (id bigint, email text, full_name text, phone text, dob date, vrn text, locality text, created_at timestamptz,
               match_member_id bigint, match_name text, match_linked boolean, bike text, blood_group text, hideout text, emergency_phone text,
               match_status text, match_removed_at timestamptz, alt_phone text,
               source text, tnc boolean, vrn_verified boolean, form_ts timestamptz, on_app boolean,
               member_since timestamptz, check_entry text, has_ronin boolean, vrn_other text)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select r.id, r.email, r.full_name, r.phone, r.dob, r.vrn, r.locality, r.created_at,
           m.id, m.full_name, m.user_id is not null, r.bike, r.blood_group, r.hideout, r.emergency_phone, m.status, m.removed_at, r.alt_phone,
           r.source, r.tnc, r.vrn_verified, r.form_ts, r.user_id is not null,
           m.joined_at,
           case when m.id is null then 'new'
                when m.status <> 'active' then 'returning'
                when m.joined_at < now() - interval '7 days' then 'existing'
                else 'recent' end,
           private.has_ronin(r.bike),
           (select string_agg(o.full_name, ', ') from members o
              where o.status = 'active' and o.phone <> r.phone and private.norm_vrn(r.vrn) is not null
                and (private.norm_vrn(o.vrn) = private.norm_vrn(r.vrn)
                     or exists (select 1 from member_bikes b where b.member_id = o.id and private.norm_vrn(b.vrn) = private.norm_vrn(r.vrn))))
    from link_requests r left join members m on m.phone = r.phone
    where r.status = 'pending' order by r.created_at;
end $$;
revoke execute on function public.admin_list_requests() from public, anon;
grant execute on function public.admin_list_requests() to authenticated;

-- An admin ticks "VRN verified" after checking the number (saved straight away, so other admins see it)
create or replace function public.admin_set_request_vrn(p_request_id bigint, p_verified boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update link_requests set vrn_verified = coalesce(p_verified, false) where id = p_request_id and status = 'pending';
  return coalesce(p_verified, false);
end $$;
revoke execute on function public.admin_set_request_vrn(bigint, boolean) from public, anon;
grant execute on function public.admin_set_request_vrn(bigint, boolean) to authenticated;

-- Approve: becomes a member (or an existing member's details are refreshed); the entry is kept as history
create or replace function public.admin_approve_request(p_request_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare r link_requests; m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from link_requests where id = p_request_id and status = 'pending';
  if not found then raise exception 'This entry was already handled'; end if;
  select * into m from members where phone = r.phone;
  if found then
    if r.user_id is not null and m.user_id is not null and m.user_id <> r.user_id then
      raise exception 'That WhatsApp number is already linked to another app account. Remove it first if this is the same person.';
    end if;
    if r.user_id is not null then
      update members set user_id = null where user_id = r.user_id and id <> m.id;
    end if;
    update members set user_id = coalesce(r.user_id, user_id), email = coalesce(r.email, email),
      full_name = coalesce(nullif(r.full_name, ''), full_name), dob = coalesce(r.dob, dob), vrn = coalesce(r.vrn, vrn),
      locality = coalesce(r.locality, locality), bike = coalesce(r.bike, bike), blood_group = coalesce(r.blood_group, blood_group),
      hideout = coalesce(r.hideout, hideout), emergency_phone = coalesce(r.emergency_phone, emergency_phone),
      alt_phone = coalesce(r.alt_phone, alt_phone),
      vrn_verified = case when r.vrn_verified then true when private.norm_vrn(coalesce(r.vrn, vrn)) = private.norm_vrn(vrn) then vrn_verified else false end,
      status = 'active', removed_at = null, removed_by = null, removed_note = null,
      joined_at = case when m.status <> 'active' then now() else joined_at end
    where id = m.id;
    delete from private.removed_phones where phone = r.phone;
  else
    insert into members (full_name, phone, email, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, alt_phone, user_id, vrn_verified, joined_at)
    values (r.full_name, r.phone, r.email, r.dob, r.vrn, r.locality, r.bike, r.blood_group, r.hideout, r.emergency_phone, r.alt_phone, r.user_id, r.vrn_verified, now());
  end if;
  update link_requests set status = 'approved', decided_at = now(), decided_by = private.admin_name() where id = r.id;
  if r.source = 'form' then perform private.sheet_post(jsonb_build_object('action', 'status', 'status', 'approved', 'phone', r.phone, 'form_ts', r.form_ts)); end if;
  return 'approved';
end $$;
revoke execute on function public.admin_approve_request(bigint) from public, anon;
grant execute on function public.admin_approve_request(bigint) to authenticated;

drop function if exists public.admin_reject_request(bigint);
create or replace function public.admin_reject_request(p_request_id bigint, p_reason text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare r link_requests;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update link_requests set status = 'rejected', decided_at = now(), decided_by = private.admin_name(), reject_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_request_id and status = 'pending' returning * into r;
  if not found then raise exception 'This entry was already handled'; end if;
  if r.source = 'form' then perform private.sheet_post(jsonb_build_object('action', 'status', 'status', 'rejected', 'phone', r.phone, 'form_ts', r.form_ts, 'reason', r.reject_reason)); end if;
  return 'rejected';
end $$;
revoke execute on function public.admin_reject_request(bigint, text) from public, anon;
grant execute on function public.admin_reject_request(bigint, text) to authenticated;

-- ---------- 7. Sheet edits → database + app ----------
create or replace function public.sheet_edit_member(p_secret text, p jsonb, p_old_phone text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare
  ph  text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 10);
  op  text := right(regexp_replace(coalesce(p_old_phone, ''), '\D', '', 'g'), 10);
  m   members; rid bigint; d date; v text;
  t   text := '';
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then
    raise exception 'Not allowed';
  end if;
  perform set_config('rwb.from_sheet', 'on', true);
  if p ? 'dob' then begin d := nullif(p ->> 'dob', '')::date; exception when others then d := null; end; end if;
  select * into m from members where phone = coalesce(nullif(op, ''), ph) and status = 'active';
  if not found and op <> '' then select * into m from members where phone = ph and status = 'active'; end if;
  if found then
    if p ? 'phone' and length(ph) = 10 and ph <> m.phone and exists (select 1 from members where phone = ph and id <> m.id) then
      return 'skipped: another member has ' || ph;
    end if;
    update members set
      full_name       = coalesce(nullif(regexp_replace(trim(coalesce(p ->> 'full_name', '')), '\s+', ' ', 'g'), ''), full_name),
      dob             = coalesce(d, dob),
      phone           = case when length(ph) = 10 then ph else phone end,
      email           = coalesce(nullif(lower(trim(coalesce(p ->> 'email', ''))), ''), email),
      vrn             = coalesce(nullif(upper(trim(coalesce(p ->> 'vrn', ''))), ''), vrn),
      bike            = coalesce(nullif(trim(coalesce(p ->> 'bike', '')), ''), bike),
      blood_group     = coalesce(nullif(trim(coalesce(p ->> 'blood_group', '')), ''), blood_group),
      locality        = coalesce(nullif(trim(coalesce(p ->> 'locality', '')), ''), locality),
      hideout         = coalesce(nullif(trim(coalesce(p ->> 'hideout', '')), ''), hideout),
      emergency_phone = coalesce(nullif(right(regexp_replace(coalesce(p ->> 'emergency_phone', ''), '\D', '', 'g'), 10), ''), emergency_phone),
      alt_phone       = coalesce(nullif(right(regexp_replace(coalesce(p ->> 'alt_phone', ''), '\D', '', 'g'), 10), ''), alt_phone),
      vrn_verified    = case lower(coalesce(p ->> 'vrn_verified', '')) when 'yes' then true when 'no' then false else vrn_verified end
    where id = m.id;
    foreach v in array array['2', '3'] loop
      if nullif(trim(coalesce(p ->> ('bike' || v || '_vrn'), '')), '') is not null then
        insert into member_bikes (member_id, slot, vrn, model) values (m.id, v::smallint, upper(trim(p ->> ('bike' || v || '_vrn'))), nullif(trim(coalesce(p ->> ('bike' || v || '_model'), '')), ''))
        on conflict (member_id, slot) do update set vrn = excluded.vrn, model = coalesce(excluded.model, member_bikes.model),
          verified = case when private.norm_vrn(member_bikes.vrn) = private.norm_vrn(excluded.vrn) then member_bikes.verified else false end;
      elsif nullif(trim(coalesce(p ->> ('bike' || v || '_model'), '')), '') is not null then
        update member_bikes set model = trim(p ->> ('bike' || v || '_model')) where member_id = m.id and slot = v::smallint;
      end if;
    end loop;
    return 'updated';
  end if;
  -- a waiting entry: keep its details in step with the sheet
  select id into rid from link_requests where phone = coalesce(nullif(op, ''), ph) and status = 'pending' order by created_at desc limit 1;
  if rid is not null then
    update link_requests set
      full_name = coalesce(nullif(trim(coalesce(p ->> 'full_name', '')), ''), full_name), dob = coalesce(d, dob),
      phone = case when length(ph) = 10 then ph else phone end, vrn = coalesce(nullif(upper(trim(coalesce(p ->> 'vrn', ''))), ''), vrn),
      bike = coalesce(nullif(trim(coalesce(p ->> 'bike', '')), ''), bike), blood_group = coalesce(nullif(trim(coalesce(p ->> 'blood_group', '')), ''), blood_group),
      locality = coalesce(nullif(trim(coalesce(p ->> 'locality', '')), ''), locality), hideout = coalesce(nullif(trim(coalesce(p ->> 'hideout', '')), ''), hideout),
      emergency_phone = coalesce(nullif(right(regexp_replace(coalesce(p ->> 'emergency_phone', ''), '\D', '', 'g'), 10), ''), emergency_phone),
      alt_phone = coalesce(nullif(right(regexp_replace(coalesce(p ->> 'alt_phone', ''), '\D', '', 'g'), 10), ''), alt_phone),
      email = coalesce(nullif(lower(trim(coalesce(p ->> 'email', ''))), ''), email)
    where id = rid;
    return 'updated entry';
  end if;
  return 'not found';
end $$;
revoke execute on function public.sheet_edit_member(text, jsonb, text) from public;
grant execute on function public.sheet_edit_member(text, jsonb, text) to anon, authenticated;

-- The sheet's catch-up also needs to know who's still waiting (to label their rows)
create or replace function public.sheet_export_members(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then
    raise exception 'Not allowed';
  end if;
  return coalesce((select jsonb_agg(private.member_json(m) || jsonb_build_object('on_app', m.user_id is not null)
      order by m.joined_at nulls first, m.id) from members m where m.status = 'active'), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('pending', true, 'phone', r.phone, 'full_name', r.full_name))
      from link_requests r where r.status = 'pending'), '[]'::jsonb);
end $$;
revoke all on function public.sheet_export_members(text) from public;
grant execute on function public.sheet_export_members(text) to anon, authenticated;

-- ---------- 8. Bikes 2 and 3 ----------
create or replace function public.save_bike(p_slot integer, p_vrn text, p_model text default null, p_member_id bigint default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare mid bigint; v text := nullif(upper(regexp_replace(trim(coalesce(p_vrn, '')), '\s+', ' ', 'g')), '');
begin
  if p_slot not in (2, 3) then raise exception 'You can add up to 3 bikes'; end if;
  if p_member_id is null then select id into mid from members where user_id = auth.uid() and status = 'active';
  elsif is_admin() then mid := p_member_id;
  else raise exception 'Admins only'; end if;
  if mid is null then raise exception 'Members only'; end if;
  if v is null then delete from member_bikes where member_id = mid and slot = p_slot; return 'removed'; end if;
  if length(regexp_replace(v, '[^A-Z0-9]', '', 'g')) < 6 then raise exception 'Please check the VRN (for example WB 02 AB 1234)'; end if;
  insert into member_bikes (member_id, slot, vrn, model) values (mid, p_slot, v, nullif(trim(coalesce(p_model, '')), ''))
  on conflict (member_id, slot) do update set vrn = excluded.vrn, model = excluded.model,
    verified = case when private.norm_vrn(member_bikes.vrn) = private.norm_vrn(excluded.vrn) then member_bikes.verified else false end,
    verified_by = case when private.norm_vrn(member_bikes.vrn) = private.norm_vrn(excluded.vrn) then member_bikes.verified_by else null end;
  return 'saved';
end $$;
revoke execute on function public.save_bike(integer, text, text, bigint) from public, anon;
grant execute on function public.save_bike(integer, text, text, bigint) to authenticated;

-- Admins mark a VRN as checked (slot 1 = the main bike)
create or replace function public.admin_set_vrn_verified(p_member_id bigint, p_slot integer, p_verified boolean) returns boolean
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_slot = 1 then update members set vrn_verified = coalesce(p_verified, false) where id = p_member_id;
  else update member_bikes set verified = coalesce(p_verified, false), verified_by = case when p_verified then private.admin_name() end
       where member_id = p_member_id and slot = p_slot; end if;
  return coalesce(p_verified, false);
end $$;
revoke execute on function public.admin_set_vrn_verified(bigint, integer, boolean) from public, anon;
grant execute on function public.admin_set_vrn_verified(bigint, integer, boolean) to authenticated;

-- Member list: search by any of a member's bikes, and show who's verified
drop function if exists public.member_directory();
create function public.member_directory()
returns table (id bigint, full_name text, nickname text, avatar_url text, bike text, vrn text, locality text, role text, phone text,
               on_app boolean, avg_kmpl numeric, vrn_verified boolean, bikes jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select m.id, m.full_name, m.nickname, m.avatar_url, m.bike, m.vrn, m.locality, m.role,
           case when m.role in ('superadmin','admin','coordinator') then m.phone end,
           m.user_id is not null,
           case when m.show_on_leaderboard then m.avg_kmpl end,
           m.vrn_verified,
           (select jsonb_agg(jsonb_build_object('slot', b.slot, 'vrn', b.vrn, 'model', b.model, 'verified', b.verified) order by b.slot)
              from member_bikes b where b.member_id = m.id)
    from members m where m.status = 'active'
    order by case m.role when 'superadmin' then 0 when 'admin' then 1 when 'coordinator' then 2 else 3 end, m.full_name;
end $$;
revoke execute on function public.member_directory() from public, anon;
grant execute on function public.member_directory() to authenticated;

notify pgrst, 'reload schema';
