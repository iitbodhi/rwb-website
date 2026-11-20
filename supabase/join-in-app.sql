-- RWB App setup file 75: joining RWB happens in the RWB App and on roninwb.in/join (the Google Form is retired).
-- * A rider signs in with Google and fills the RWB join form inside the app (website: roninwb.in/join opens the same
--   form). Their Google email becomes their RWB email, so after approval they're in at once.
-- * Every rider is welcome: Ronin owners, riders with a Ronin booked, and riders without a Ronin ("Non-Ronin").
-- * Admins get a third choice, On hold (with a note the rider sees). Rejected riders see the reason and can apply
--   again, unless an admin marks the entry as spam.
-- * Fixes: a rider who was rejected and applies again is no longer stuck on "not approved".
-- * Entries from the old Google Form (if it is still open) keep working as before.
-- Safe to run more than once.

-- 1. statuses and the spam block list
alter table public.link_requests drop constraint if exists link_requests_status_check;
alter table public.link_requests add constraint link_requests_status_check check (status in ('pending', 'hold', 'rejected', 'approved'));
alter table public.link_requests add column if not exists hold_note text;
alter table public.link_requests add column if not exists spam boolean not null default false;

create table if not exists private.join_blocked (
  id bigint generated always as identity primary key,
  user_id uuid, email text, phone text,
  request_id bigint, blocked_by text, created_at timestamptz not null default now()
);
create index if not exists join_blocked_user on private.join_blocked (user_id);
create index if not exists join_blocked_phone on private.join_blocked (phone);
revoke all on private.join_blocked from public, anon, authenticated;

create or replace function private.join_is_blocked(p_user uuid, p_email text, p_phone text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.join_blocked b
    where (p_user is not null and b.user_id = p_user)
       or (coalesce(p_email, '') <> '' and lower(b.email) = lower(p_email))
       or (coalesce(p_phone, '') <> '' and b.phone = p_phone))
$$;

-- 2. sending the join form from the app (or roninwb.in/join): a new entry, or an update of the rider's open one
create or replace function public.request_access(p_full_name text, p_phone text, p_dob date default null,
  p_vrn text default null, p_locality text default null, p_bike text default null, p_blood_group text default null,
  p_hideout text default null, p_emergency_phone text default null, p_alt_phone text default null,
  p_tnc boolean default false, p_answers jsonb default null)
returns text language plpgsql security definer set search_path = public, private as $$
declare
  uid uuid := auth.uid(); em text; r link_requests;
  ph  text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  nm  text := nullif(regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g'), '');
  eph text := nullif(right(regexp_replace(coalesce(p_emergency_phone, ''), '\D', '', 'g'), 10), '');
  aph text := nullif(right(regexp_replace(coalesce(p_alt_phone, ''), '\D', '', 'g'), 10), '');
  v   text := nullif(upper(regexp_replace(coalesce(p_vrn, ''), '[^A-Za-z0-9]', '', 'g')), '');
begin
  if uid is null then raise exception 'Please sign in with Google first'; end if;
  if exists (select 1 from members where user_id = uid) then return 'member'; end if;
  select lower(email) into em from auth.users where id = uid and email_confirmed_at is not null;
  if em is null then raise exception 'Please sign in with a Google account first'; end if;
  if nm is null or length(nm) < 3 then raise exception 'Please enter your full name'; end if;
  if length(ph) <> 10 then raise exception 'Please enter your 10-digit WhatsApp number'; end if;
  if length(nm) > 100 or length(coalesce(v, '')) > 15 or length(coalesce(p_locality, '')) > 300 or length(coalesce(p_hideout, '')) > 300
     or length(coalesce(p_bike, '')) > 100 or length(coalesce(p_blood_group, '')) > 20 or coalesce(pg_column_size(p_answers), 0) > 16000 then
    raise exception 'Some answers are too long. Please shorten them and try again.';
  end if;
  if eph is not null and eph = ph then raise exception 'The emergency contact should be someone else''s number'; end if;
  if not coalesce(p_tnc, false) then raise exception 'You need to agree to the RWB Terms & Conditions to join.'; end if;
  if p_dob is not null and p_dob > (current_date - interval '18 years')::date then
    raise exception 'RWB is for riders aged 18 and over. Please check your date of birth.';
  end if;
  if private.join_is_blocked(uid, em, ph) then
    raise exception 'You can''t send a new request. If you think this is a mistake, please message an RWB admin.';
  end if;
  if exists (select 1 from members where phone = ph and status = 'active' and user_id is not null and user_id <> uid) then
    raise exception 'This WhatsApp number belongs to an RWB member who is already on the app. If it''s yours, sign in with the Google account you use for RWB, or message an admin.';
  end if;
  if exists (select 1 from link_requests where phone = ph and status in ('pending', 'hold') and user_id is not null and user_id <> uid) then
    raise exception 'Someone has already sent a join request with this WhatsApp number. If it''s yours, please message an RWB admin.';
  end if;
  -- one row per Google account: a rider who was rejected (or left RWB) and applies again reuses their row as a fresh entry
  select * into r from link_requests where user_id = uid order by created_at desc limit 1;
  if r.id is not null and r.status not in ('pending', 'hold') then
    update link_requests set status = 'pending', source = 'app', created_at = now(), form_ts = null, checks = '{}'::jsonb,
      vrn_verified = false, decided_at = null, decided_by = null, reject_reason = null, hold_note = null, spam = false
    where id = r.id;
    r.status := 'pending';
  end if;
  if r.id is null then
    insert into link_requests (user_id, source, email, full_name, phone, dob, vrn, locality, bike, blood_group, hideout,
                               emergency_phone, alt_phone, tnc, answers, status)
    values (uid, 'app', em, nm, ph, p_dob, v, nullif(trim(coalesce(p_locality, '')), ''), nullif(trim(coalesce(p_bike, '')), ''),
            nullif(trim(coalesce(p_blood_group, '')), ''), nullif(trim(coalesce(p_hideout, '')), ''), eph, aph, true, p_answers, 'pending');
  else
    update link_requests set full_name = nm, phone = ph, email = em, dob = p_dob, vrn = v,
      locality = nullif(trim(coalesce(p_locality, '')), ''), bike = nullif(trim(coalesce(p_bike, '')), ''),
      blood_group = nullif(trim(coalesce(p_blood_group, '')), ''), hideout = nullif(trim(coalesce(p_hideout, '')), ''),
      emergency_phone = eph, alt_phone = aph, tnc = true, answers = coalesce(p_answers, answers),
      vrn_verified = case when private.norm_vrn(v) is not distinct from private.norm_vrn(vrn) then vrn_verified else false end,
      status = 'pending'    -- an entry on hold goes back to the admins' New list
    where id = r.id;
  end if;
  return 'pending';
end $$;
revoke execute on function public.request_access(text, text, date, text, text, text, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.request_access(text, text, date, text, text, text, text, text, text, text, boolean, jsonb) to authenticated;

-- 3. the rider's own latest request (status screens and "Update my answers")
create or replace function public.my_join() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r link_requests; em text;
begin
  if auth.uid() is null then return null; end if;
  select lower(email) into em from auth.users where id = auth.uid();
  select * into r from link_requests where user_id = auth.uid() order by created_at desc, id desc limit 1;
  if r.id is null then
    return case when private.join_is_blocked(auth.uid(), em, null) then jsonb_build_object('status', 'rejected', 'can_apply', false) end;
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'source', r.source, 'created_at', r.created_at, 'updated_at', r.updated_at,
    'decided_at', r.decided_at, 'hold_note', r.hold_note, 'reason', r.reject_reason,
    'can_apply', not (r.spam or private.join_is_blocked(auth.uid(), em, r.phone)),
    'full_name', r.full_name, 'phone', r.phone, 'dob', r.dob, 'vrn', r.vrn, 'bike', r.bike, 'blood_group', r.blood_group,
    'locality', r.locality, 'hideout', r.hideout, 'emergency_phone', r.emergency_phone, 'alt_phone', r.alt_phone,
    'tnc', r.tnc, 'answers', coalesce(r.answers, '{}'::jsonb));
end $$;
revoke execute on function public.my_join() from public, anon;
grant execute on function public.my_join() to authenticated;

-- 4. signing in: the rider's LATEST request decides what they see (fixes "stuck on not approved" after applying again)
create or replace function public.link_account() returns text
language plpgsql security definer set search_path = public, private as $$
declare
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  m   members; rid bigint; st text;
begin
  if auth.uid() is null then return 'signed_out'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then em := ''; end if;
  if em <> '' then
    select * into m from members where lower(email) = em and status = 'active' and user_id is null
      order by (move_from is not null) desc, id desc limit 1;
    if m.id is not null then
      if m.move_from is not null then perform set_config('rwb.quiet_join', 'on', true); end if;   -- no "new Ronin joined" note
      update members set user_id = auth.uid(), move_from = null where id = m.id;
      if m.move_from is not null then perform private.move_account(m.move_from, auth.uid()); end if;
      return 'member';
    end if;
    -- filled the old Google join form with this email and is waiting for approval
    if not exists (select 1 from link_requests where user_id = auth.uid() and status in ('pending', 'hold')) then
      select id into rid from link_requests where lower(email) = em and user_id is null and status = 'pending' order by created_at desc limit 1;
      if rid is not null then update link_requests set user_id = auth.uid() where id = rid; return 'pending'; end if;
    end if;
  end if;
  select status into st from link_requests where user_id = auth.uid() order by created_at desc, id desc limit 1;
  if st in ('pending', 'hold', 'rejected') then return st; end if;
  if private.join_is_blocked(auth.uid(), em, null) then return 'rejected'; end if;
  if exists (select 1 from members where move_from = auth.uid()) then return 'moved'; end if;   -- an admin changed their email
  return 'not_found';
end $$;
revoke execute on function public.link_account() from public, anon;
grant execute on function public.link_account() to authenticated;

-- 5. admins: approve (also from On hold)
create or replace function public.admin_approve_request(p_request_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare r link_requests; m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from link_requests where id = p_request_id and status in ('pending', 'hold');
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

-- 6. admins: put on hold, with a note the rider sees
create or replace function public.admin_hold_request(p_request_id bigint, p_note text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare r link_requests;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  perform set_config('rwb.admin_check', 'on', true);
  update link_requests set status = 'hold', hold_note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
    decided_at = now(), decided_by = private.admin_name()
  where id = p_request_id and status in ('pending', 'hold') returning * into r;
  if not found then raise exception 'This entry was already handled'; end if;
  return 'hold';
end $$;
revoke execute on function public.admin_hold_request(bigint, text) from public, anon;
grant execute on function public.admin_hold_request(bigint, text) to authenticated;

-- 7. admins: reject (also from On hold); spam = can't apply again
drop function if exists public.admin_reject_request(bigint, text);
create or replace function public.admin_reject_request(p_request_id bigint, p_reason text default null, p_spam boolean default false) returns text
language plpgsql security definer set search_path = public, private as $$
declare r link_requests;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  perform set_config('rwb.admin_check', 'on', true);
  update link_requests set status = 'rejected', decided_at = now(), decided_by = private.admin_name(),
    reject_reason = nullif(left(trim(coalesce(p_reason, '')), 300), ''), spam = coalesce(p_spam, false)
  where id = p_request_id and status in ('pending', 'hold') returning * into r;
  if not found then raise exception 'This entry was already handled'; end if;
  if r.spam then
    insert into private.join_blocked (user_id, email, phone, request_id, blocked_by) values (r.user_id, lower(r.email), r.phone, r.id, private.admin_name());
  end if;
  if r.source = 'form' then perform private.sheet_post(jsonb_build_object('action', 'status', 'status', 'rejected', 'phone', r.phone, 'form_ts', r.form_ts, 'reason', r.reject_reason)); end if;
  return 'rejected';
end $$;
revoke execute on function public.admin_reject_request(bigint, text, boolean) from public, anon;
grant execute on function public.admin_reject_request(bigint, text, boolean) to authenticated;

-- 8. admins: move an entry on hold or rejected back to New (undo); lifts a spam block
create or replace function public.admin_reopen_request(p_request_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare r link_requests;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if exists (select 1 from link_requests x join link_requests o on o.phone = x.phone and o.id <> x.id and o.status in ('pending', 'hold')
             where x.id = p_request_id) then
    raise exception 'There is already a newer request with this WhatsApp number in New or On hold.';
  end if;
  perform set_config('rwb.admin_check', 'on', true);
  update link_requests set status = 'pending', hold_note = null, reject_reason = null, spam = false, decided_at = null, decided_by = null
  where id = p_request_id and status in ('hold', 'rejected') returning * into r;
  if not found then raise exception 'This entry was already handled'; end if;
  delete from private.join_blocked where request_id = r.id;
  return 'pending';
end $$;
revoke execute on function public.admin_reopen_request(bigint) from public, anon;
grant execute on function public.admin_reopen_request(bigint) to authenticated;

-- 9. admins: the checks can be set on entries On hold too
create or replace function public.admin_set_request_check(p_id bigint, p_check text, p_value text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r link_requests; c jsonb; who text := private.admin_name();
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from link_requests where id = p_id and status in ('pending', 'hold');
  if not found then raise exception 'This entry was already handled'; end if;
  if p_check not in ('entry','ronin','vrn','tnc') then raise exception 'Unknown check'; end if;
  perform set_config('rwb.admin_check', 'on', true);
  c := coalesce(r.checks, '{}'::jsonb);
  if p_check = 'tnc' and not (c ? 'tnc_orig') then c := c || jsonb_build_object('tnc_orig', r.tnc); end if;
  if p_value = 'auto' then c := c - p_check - ('by_' || p_check);
  else c := c || jsonb_build_object(p_check, p_value, 'by_' || p_check, who); end if;
  update link_requests set checks = c,
    vrn_verified = case when p_check = 'vrn' then p_value = 'ok' else vrn_verified end,
    tnc = case when p_check = 'tnc' then case p_value when 'ok' then true when 'no' then false else (c ->> 'tnc_orig')::boolean end else tnc end
  where id = p_id;
  return c;
end $$;

-- 10. admins: the Approvals list by tab (New / On hold / Rejected in the last 60 days), with the counts
create or replace function public.admin_join_list(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare out jsonb;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('pending', 'hold', 'rejected') then raise exception 'Unknown list'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_at), '[]'::jsonb) into out from (
    select r.id, r.email, r.full_name, r.phone, r.dob, r.vrn, r.locality, r.created_at,
           m.id as match_member_id, m.full_name as match_name, m.user_id is not null as match_linked, r.bike, r.blood_group, r.hideout,
           r.emergency_phone, m.status as match_status, m.removed_at as match_removed_at, r.alt_phone,
           r.source, r.tnc, r.vrn_verified, r.form_ts, r.user_id is not null as on_app, m.joined_at as member_since,
           case when m.id is null then 'new' when m.status <> 'active' then 'returning'
                when m.joined_at < now() - interval '7 days' then 'existing' else 'recent' end as check_entry,
           private.has_ronin(coalesce(r.bike, m.bike)) as has_ronin,
           (select string_agg(o.full_name, ', ') from members o
              where o.status = 'active' and o.phone <> r.phone and private.norm_vrn(r.vrn) is not null
                and (private.norm_vrn(o.vrn) = private.norm_vrn(r.vrn)
                     or exists (select 1 from member_bikes b where b.member_id = o.id and private.norm_vrn(b.vrn) = private.norm_vrn(r.vrn)))) as vrn_other,
           coalesce(m.id is not null and (
             (m.vrn_verified and private.norm_vrn(coalesce(r.vrn, m.vrn)) = private.norm_vrn(m.vrn))
             or exists (select 1 from member_bikes b where b.member_id = m.id and b.verified and private.norm_vrn(b.vrn) = private.norm_vrn(r.vrn))), false) as vrn_known,
           case when m.id is not null and m.status = 'active' then m.tnc_agreed end as member_tnc,
           r.answers, m.vrn as member_vrn,
           r.status, r.hold_note, r.reject_reason, r.decided_by, r.decided_at, r.updated_at, r.checks, r.spam,
           case when p_status = 'rejected' then -extract(epoch from coalesce(r.decided_at, r.created_at)) else extract(epoch from r.created_at) end as sort_at
    from link_requests r left join members m on m.phone = r.phone
    where r.status = p_status and (p_status <> 'rejected' or coalesce(r.decided_at, r.created_at) > now() - interval '60 days')
  ) x;
  return jsonb_build_object('list', out, 'counts', (select jsonb_build_object(
    'pending',  count(*) filter (where status = 'pending'),
    'hold',     count(*) filter (where status = 'hold'),
    'rejected', count(*) filter (where status = 'rejected' and coalesce(decided_at, created_at) > now() - interval '60 days'))
    from link_requests));
end $$;
revoke execute on function public.admin_join_list(text) from public, anon;
grant execute on function public.admin_join_list(text) to authenticated;

-- 11. notes to the rider (in the app and on their phone) and to the admins
create or replace function private.after_approve() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'approved' and old.status in ('pending', 'hold') then
    update members set tnc_agreed = coalesce(new.tnc, tnc_agreed),
      form_answers = case when new.answers is not null then coalesce(form_answers, '{}'::jsonb) || new.answers else form_answers end
    where phone = new.phone;
    perform private.tell_member(new.user_id, 'Welcome to RWB! 🎉', 'You''re approved. Explore the app, and check your details in Me (you can add your bike model and up to 3 bikes).', '#me');
  elsif new.status = 'hold' and old.status is distinct from 'hold' then
    perform private.tell_member(new.user_id, 'Your RWB request is on hold', coalesce('Note from the admins: ' || new.hold_note, 'The admins will get back to you soon.') || ' Open the RWB App to see it or update your answers.', '#home');
  elsif new.status = 'rejected' and old.status in ('pending', 'hold') then
    perform private.tell_member(new.user_id, 'About your RWB request', 'Your request wasn''t approved' || coalesce(': ' || new.reject_reason, '') || '. Open the RWB App to see the details.', '#home');
  end if;
  return new;
end $$;

create or replace function private.request_events() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin',
            case when tg_op = 'UPDATE' and old.status = 'hold' then 'Join request updated' else 'New join request' end,
            new.full_name || case when tg_op = 'UPDATE' and old.status = 'hold' then ' updated their answers (was on hold). Check and approve.'
                                  else ' wants to join RWB. Check and approve.' end,
            '#admin', 'admins', new.user_id);
  end if;
  return new;
end $$;

-- 12. admins' first names and numbers ("WhatsApp the admins") only for members and RWB FAM users; riders who
--     aren't members yet see "Contact RWB" (Instagram) instead, so admins' numbers are never shown to strangers
create or replace function public.join_help_admins() returns table (first_name text, phone text)
language sql stable security definer set search_path = public as $$
  select split_part(coalesce(nullif(m.nickname, ''), m.full_name), ' ', 1), m.phone from members m
  where auth.uid() is not null
    and (exists (select 1 from members x where x.user_id = auth.uid() and x.status = 'active')
         or exists (select 1 from fam_members f where f.user_id = auth.uid()))
    and m.status = 'active' and m.role in ('superadmin', 'admin') and length(coalesce(m.phone, '')) = 10
  order by case m.role when 'superadmin' then 0 else 1 end, m.full_name
$$;
revoke execute on function public.join_help_admins() from public, anon;
grant execute on function public.join_help_admins() to authenticated;

notify pgrst, 'reload schema';
