-- =====================================================================
-- RWB App: the app's join request asks exactly what the RWB join form asks
--   • adds "Mobile No. (alternative)" to app join requests (copied to the member on approval)
--   • required answers: Full Name, Date of Birth, WhatsApp No., Do you own a Ronin bike?, VRN,
--     Blood group, Current Locality, In case of emergency contact (number)
--   • admins can now correct every answer (Permanent Hideout, emergency and alternative numbers too)
-- Run once in Supabase > SQL Editor, after 26. Safe to run again.
-- =====================================================================
alter table public.link_requests add column if not exists alt_phone text;

drop function if exists public.request_access(text, text, date, text, text, text, text, text, text);
create or replace function public.request_access(p_full_name text, p_phone text, p_dob date default null,
    p_vrn text default null, p_locality text default null, p_bike text default null, p_blood_group text default null,
    p_hideout text default null, p_emergency_phone text default null, p_alt_phone text default null)
returns text language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
        em text := right(regexp_replace(coalesce(p_emergency_phone, ''), '\D', '', 'g'), 10);
        al text := nullif(right(regexp_replace(coalesce(p_alt_phone, ''), '\D', '', 'g'), 10), '');
        nm text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
        vr text := nullif(upper(regexp_replace(trim(coalesce(p_vrn, '')), '\s+', ' ', 'g')), '');
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
  insert into link_requests (user_id, email, full_name, phone, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, alt_phone, status)
  values (auth.uid(), auth.jwt() ->> 'email', nm, ph, p_dob, vr, trim(p_locality), trim(p_bike), trim(p_blood_group),
          nullif(trim(coalesce(p_hideout, '')), ''), em, al, 'pending')
  on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone, dob = excluded.dob,
    vrn = excluded.vrn, locality = excluded.locality, bike = excluded.bike, blood_group = excluded.blood_group,
    hideout = excluded.hideout, emergency_phone = excluded.emergency_phone, alt_phone = excluded.alt_phone,
    status = 'pending', created_at = now();
  return 'pending';
end $$;
revoke execute on function public.request_access(text, text, date, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.request_access(text, text, date, text, text, text, text, text, text, text) to authenticated;

-- Approving copies every answer (including the alternative number) into the member record
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
      alt_phone = coalesce(alt_phone, r.alt_phone),
      status = 'active', removed_at = null, removed_by = null, removed_note = null,
      joined_at = case when m.status <> 'active' then now() else joined_at end
    where id = m.id;
    delete from private.removed_phones where phone = r.phone;
  else
    insert into members (full_name, phone, email, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, alt_phone, user_id, joined_at)
    values (r.full_name, r.phone, r.email, r.dob, r.vrn, r.locality, r.bike, r.blood_group, r.hideout, r.emergency_phone, r.alt_phone, r.user_id, now());
  end if;
  delete from link_requests where id = r.id;
  return 'approved';
end $$;

drop function if exists public.admin_list_requests();
create function public.admin_list_requests()
returns table (id bigint, email text, full_name text, phone text, dob date, vrn text, locality text, created_at timestamptz,
               match_member_id bigint, match_name text, match_linked boolean, bike text, blood_group text, hideout text, emergency_phone text,
               match_status text, match_removed_at timestamptz, alt_phone text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select r.id, r.email, r.full_name, r.phone, r.dob, r.vrn, r.locality, r.created_at,
           m.id, m.full_name, m.user_id is not null, r.bike, r.blood_group, r.hideout, r.emergency_phone, m.status, m.removed_at, r.alt_phone
    from link_requests r left join members m on m.phone = r.phone
    where r.status = 'pending' order by r.created_at;
end $$;
revoke execute on function public.admin_list_requests() from public, anon;
grant execute on function public.admin_list_requests() to authenticated;

-- Admins can correct every answer
create or replace function public.admin_update_member(p_member_id bigint, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 10);
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p ? 'phone' and length(ph) <> 10 then raise exception 'WhatsApp No. needs a 10-digit number'; end if;
  if p ? 'phone' and exists (select 1 from members where phone = ph and id <> p_member_id) then
    raise exception 'Another member already has WhatsApp No. %', ph;
  end if;
  update members set
    full_name       = coalesce(nullif(regexp_replace(trim(p ->> 'full_name'), '\s+', ' ', 'g'), ''), full_name),
    nickname        = case when p ? 'nickname'        then nullif(trim(p ->> 'nickname'), '')        else nickname end,
    dob             = case when p ? 'dob'             then nullif(p ->> 'dob', '')::date              else dob end,
    phone           = case when p ? 'phone'           then ph                                         else phone end,
    vrn             = case when p ? 'vrn'             then nullif(upper(trim(p ->> 'vrn')), '')       else vrn end,
    bike            = case when p ? 'bike'            then nullif(trim(p ->> 'bike'), '')            else bike end,
    blood_group     = case when p ? 'blood_group'     then nullif(trim(p ->> 'blood_group'), '')     else blood_group end,
    locality        = case when p ? 'locality'        then nullif(trim(p ->> 'locality'), '')        else locality end,
    hideout         = case when p ? 'hideout'         then nullif(trim(p ->> 'hideout'), '')         else hideout end,
    emergency_phone = case when p ? 'emergency_phone' then nullif(right(regexp_replace(p ->> 'emergency_phone', '\D', '', 'g'), 10), '') else emergency_phone end,
    alt_phone       = case when p ? 'alt_phone'       then nullif(right(regexp_replace(p ->> 'alt_phone', '\D', '', 'g'), 10), '')       else alt_phone end
  where id = p_member_id;
  return 'saved';
end $$;
