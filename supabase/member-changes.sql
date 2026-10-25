-- =====================================================================
-- RWB App: approval fixes, the app join form = the Google Form, and approval for important changes
--   • Existing members pass the checks: their VRN was verified when they joined, and they agreed to the rules then
--   • The app's join form shows the live Google Form (same pages, questions, choices, "read carefully" agreement)
--   • Signing in with an email RWB already knows fills the join form in
--   • Changing Name, WhatsApp No., VRN / main bike, adding a bike, or withdrawing from the rules needs an admin's OK
-- Run once in Supabase > SQL Editor, after 29. Safe to run again.
-- =====================================================================

-- ---------- 1. What existing members already did ----------
alter table public.members add column if not exists tnc_agreed boolean not null default true;
alter table public.members add column if not exists form_answers jsonb;
alter table public.link_requests add column if not exists answers jsonb;
-- members who joined before the approval list: their VRN was checked by the team when they joined
do $$ begin
  if not exists (select 1 from private.config where key = 'vrn_backfill_done') then
    update public.members set vrn_verified = true where status = 'active' and nullif(trim(coalesce(vrn, '')), '') is not null and joined_at < now();
    insert into private.config (key, value) values ('vrn_backfill_done', now()::text);
  end if;
end $$;

-- ---------- 2. The join form, published by the sheet's script ----------
create or replace function public.sheet_set_join_form(p_secret text, p_form jsonb) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then raise exception 'Not allowed'; end if;
  if p_form is null or jsonb_typeof(p_form -> 'items') <> 'array' then raise exception 'No form'; end if;
  insert into private.config (key, value) values ('join_form', p_form::text) on conflict (key) do update set value = excluded.value;
  return 'saved';
end $$;
revoke execute on function public.sheet_set_join_form(text, jsonb) from public;
grant execute on function public.sheet_set_join_form(text, jsonb) to anon, authenticated;

create or replace function public.join_form() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select (select value from private.config where key = 'join_form')::jsonb
$$;
revoke execute on function public.join_form() from public;
grant execute on function public.join_form() to anon, authenticated;

-- ---------- 3. Fill the join form in for an email RWB already knows (only the signed-in person's own email) ----------
create or replace function public.my_prefill() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare em text := lower(coalesce(auth.jwt() ->> 'email', '')); j jsonb;
begin
  if auth.uid() is null or em = '' then return null; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then return null; end if;
  select jsonb_build_object('full_name', full_name, 'phone', phone, 'dob', dob, 'vrn', vrn, 'bike', bike, 'blood_group', blood_group,
           'locality', locality, 'hideout', hideout, 'emergency_phone', emergency_phone, 'alt_phone', alt_phone, 'answers', form_answers)
    into j from members where lower(email) = em order by (status = 'active') desc, id desc limit 1;
  if j is null then
    select jsonb_build_object('full_name', full_name, 'phone', phone, 'dob', dob, 'vrn', vrn, 'bike', bike, 'blood_group', blood_group,
             'locality', locality, 'hideout', hideout, 'emergency_phone', emergency_phone, 'alt_phone', alt_phone, 'answers', answers)
      into j from link_requests where lower(email) = em or user_id = auth.uid() order by created_at desc limit 1;
  end if;
  return j;
end $$;
revoke execute on function public.my_prefill() from public, anon;
grant execute on function public.my_prefill() to authenticated;

-- ---------- 4. App join request: the Google Form's answers come along ----------
drop function if exists public.request_access(text, text, date, text, text, text, text, text, text, text, boolean);
create or replace function public.request_access(p_full_name text, p_phone text, p_dob date default null,
    p_vrn text default null, p_locality text default null, p_bike text default null, p_blood_group text default null,
    p_hideout text default null, p_emergency_phone text default null, p_alt_phone text default null, p_tnc boolean default false,
    p_answers jsonb default null)
returns text language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
        em text := nullif(right(regexp_replace(coalesce(p_emergency_phone, ''), '\D', '', 'g'), 10), '');
        al text := nullif(right(regexp_replace(coalesce(p_alt_phone, ''), '\D', '', 'g'), 10), '');
        nm text := regexp_replace(trim(coalesce(p_full_name, '')), '\s+', ' ', 'g');
        vr text := nullif(upper(regexp_replace(trim(coalesce(p_vrn, '')), '\s+', ' ', 'g')), '');
        rid bigint;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  if char_length(nm) < 3 then raise exception 'Please fill in your Full Name'; end if;
  if length(ph) <> 10 then raise exception 'WhatsApp No. needs a 10-digit number'; end if;
  if p_dob is not null and (p_dob > current_date or p_dob < date '1930-01-01') then raise exception 'Please check your Date of Birth'; end if;
  if em is not null and em = ph then raise exception 'The emergency contact should be someone else''s number'; end if;
  if not coalesce(p_tnc, false) then raise exception 'Please read and agree to the RWB rules to join'; end if;
  select id into rid from link_requests where phone = ph and status = 'pending' and user_id is null order by created_at desc limit 1;
  if rid is not null and not exists (select 1 from link_requests where user_id = auth.uid()) then
    update link_requests set user_id = auth.uid(), email = coalesce(email, auth.jwt() ->> 'email'), tnc = true,
      alt_phone = coalesce(alt_phone, al), answers = coalesce(answers, '{}'::jsonb) || coalesce(p_answers, '{}'::jsonb)
    where id = rid;
    return 'pending';
  end if;
  insert into link_requests (user_id, source, email, full_name, phone, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, alt_phone, tnc, answers, status)
  values (auth.uid(), 'app', auth.jwt() ->> 'email', nm, ph, p_dob, vr, nullif(trim(coalesce(p_locality, '')), ''), nullif(trim(coalesce(p_bike, '')), ''),
          nullif(trim(coalesce(p_blood_group, '')), ''), nullif(trim(coalesce(p_hideout, '')), ''), em, al, true, p_answers, 'pending')
  on conflict (user_id) do update set source = 'app', full_name = excluded.full_name, phone = excluded.phone, dob = excluded.dob,
    vrn = excluded.vrn, locality = excluded.locality, bike = excluded.bike, blood_group = excluded.blood_group,
    hideout = excluded.hideout, emergency_phone = excluded.emergency_phone, alt_phone = excluded.alt_phone, tnc = true,
    answers = excluded.answers, vrn_verified = false, decided_at = null, decided_by = null, reject_reason = null, form_ts = null,
    status = 'pending', created_at = now();
  return 'pending';
end $$;
revoke execute on function public.request_access(text, text, date, text, text, text, text, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.request_access(text, text, date, text, text, text, text, text, text, text, boolean, jsonb) to authenticated;

-- Form entries keep every answer too (shown to admins, exactly as in the form)
create or replace function public.sheet_upsert_member_answers(p_secret text, p_phone text, p_answers jsonb) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then raise exception 'Not allowed'; end if;
  update link_requests set answers = p_answers
  where id = (select id from link_requests where phone = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10) and status = 'pending' order by created_at desc limit 1);
  return 'saved';
end $$;
revoke execute on function public.sheet_upsert_member_answers(text, text, jsonb) from public;
grant execute on function public.sheet_upsert_member_answers(text, text, jsonb) to anon, authenticated;

-- ---------- 5. The approval list: existing members pass; known VRNs and rules carry over ----------
drop function if exists public.admin_list_requests();
create function public.admin_list_requests()
returns table (id bigint, email text, full_name text, phone text, dob date, vrn text, locality text, created_at timestamptz,
               match_member_id bigint, match_name text, match_linked boolean, bike text, blood_group text, hideout text, emergency_phone text,
               match_status text, match_removed_at timestamptz, alt_phone text,
               source text, tnc boolean, vrn_verified boolean, form_ts timestamptz, on_app boolean,
               member_since timestamptz, check_entry text, has_ronin boolean, vrn_other text,
               vrn_known boolean, member_tnc boolean, answers jsonb, member_vrn text)
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
           private.has_ronin(coalesce(r.bike, m.bike)),
           (select string_agg(o.full_name, ', ') from members o
              where o.status = 'active' and o.phone <> r.phone and private.norm_vrn(r.vrn) is not null
                and (private.norm_vrn(o.vrn) = private.norm_vrn(r.vrn)
                     or exists (select 1 from member_bikes b where b.member_id = o.id and private.norm_vrn(b.vrn) = private.norm_vrn(r.vrn)))),
           -- the same VRN is already on this member's record and was verified
           coalesce(m.id is not null and (
             (m.vrn_verified and private.norm_vrn(coalesce(r.vrn, m.vrn)) = private.norm_vrn(m.vrn))
             or exists (select 1 from member_bikes b where b.member_id = m.id and b.verified and private.norm_vrn(b.vrn) = private.norm_vrn(r.vrn))), false),
           case when m.id is not null and m.status = 'active' then m.tnc_agreed end,
           r.answers, m.vrn
    from link_requests r left join members m on m.phone = r.phone
    where r.status = 'pending' order by r.created_at;
end $$;
revoke execute on function public.admin_list_requests() from public, anon;
grant execute on function public.admin_list_requests() to authenticated;

-- Approving: also records the rules agreement and keeps the form answers on the member
create or replace function private.after_approve() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'approved' and old.status = 'pending' then
    update members set tnc_agreed = coalesce(new.tnc, tnc_agreed),
      form_answers = case when new.answers is not null then coalesce(form_answers, '{}'::jsonb) || new.answers else form_answers end
    where phone = new.phone;
  end if;
  return new;
end $$;
drop trigger if exists link_requests_after_approve on public.link_requests;
create trigger link_requests_after_approve after update of status on public.link_requests for each row execute function private.after_approve();

-- ---------- 6. Important changes from Me wait for an admin ----------
create table if not exists public.change_requests (
  id            bigint generated always as identity primary key,
  member_id     bigint not null references public.members(id) on delete cascade,
  kind          text not null check (kind in ('name','phone','vrn','bike','tnc')),
  slot          smallint,
  old_value     text,
  new_value     text,
  new_model     text,
  vrn_verified  boolean not null default false,
  status        text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    text,
  reject_reason text
);
create unique index if not exists change_requests_one_pending on public.change_requests (member_id, kind, coalesce(slot, 0)) where status = 'pending';
alter table public.change_requests enable row level security;
revoke all on public.change_requests from anon;
revoke insert, update, delete on public.change_requests from authenticated;
grant select on public.change_requests to authenticated;
drop policy if exists change_requests_select on public.change_requests;
create policy change_requests_select on public.change_requests for select to authenticated
  using (public.is_admin() or member_id in (select id from public.members where user_id = auth.uid()));

-- Members can no longer change their VRN or main bike directly (it goes through request_change)
revoke update (vrn, bike) on public.members from authenticated;

create or replace function public.request_change(p_kind text, p_value text, p_slot integer default null, p_model text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare m members; v text := nullif(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'), ''); old text;
begin
  select * into m from members where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Members only'; end if;
  if p_kind = 'name' then
    if v is null or char_length(v) < 3 then raise exception 'Please enter your full name'; end if;
    if v = m.full_name then return 'unchanged'; end if; old := m.full_name;
  elsif p_kind = 'phone' then
    v := right(regexp_replace(coalesce(v, ''), '\D', '', 'g'), 10);
    if length(v) <> 10 then raise exception 'WhatsApp No. needs a 10-digit number'; end if;
    if v = m.phone then return 'unchanged'; end if;
    if exists (select 1 from members where phone = v and id <> m.id) then raise exception 'Another member already has this number. Please message an admin.'; end if;
    old := m.phone;
  elsif p_kind = 'vrn' then
    v := upper(v);
    if v is null or length(regexp_replace(v, '[^A-Z0-9]', '', 'g')) < 6 then raise exception 'Please check the VRN (for example WB 02 AB 1234)'; end if;
    if private.norm_vrn(v) = private.norm_vrn(m.vrn) and coalesce(nullif(trim(p_model), ''), m.bike) is not distinct from m.bike then return 'unchanged'; end if;
    old := concat_ws(' · ', m.vrn, m.bike);
  elsif p_kind = 'bike' then
    if p_slot not in (2, 3) then raise exception 'You can add up to 3 bikes'; end if;
    if v is null then   -- removing a bike needs no approval
      delete from member_bikes where member_id = m.id and slot = p_slot;
      delete from change_requests where member_id = m.id and kind = 'bike' and slot = p_slot and status = 'pending';
      return 'removed';
    end if;
    v := upper(v);
    if length(regexp_replace(v, '[^A-Z0-9]', '', 'g')) < 6 then raise exception 'Please check the VRN (for example WB 02 AB 1234)'; end if;
    select concat_ws(' · ', vrn, model) into old from member_bikes where member_id = m.id and slot = p_slot;
  elsif p_kind = 'tnc' then
    v := case when lower(coalesce(v, '')) in ('agree', 'yes', 'true') then 'agree' else 'disagree' end;
    if (v = 'agree') = m.tnc_agreed then return 'unchanged'; end if;
    if v = 'agree' then update members set tnc_agreed = true where id = m.id; return 'saved'; end if;
    old := 'agree';
  else raise exception 'Unknown change';
  end if;
  delete from change_requests where member_id = m.id and kind = p_kind and coalesce(slot, 0) = coalesce(p_slot, 0) and status = 'pending';
  insert into change_requests (member_id, kind, slot, old_value, new_value, new_model)
  values (m.id, p_kind, case when p_kind = 'bike' then p_slot end, old, v, nullif(trim(coalesce(p_model, '')), ''));
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('admin', 'Change to approve',
          m.full_name || case p_kind when 'name' then ' wants to change their name' when 'phone' then ' wants to change their WhatsApp No.'
            when 'vrn' then ' changed their VRN / main bike' when 'bike' then ' added a bike' else ' no longer agrees to the RWB rules' end,
          '#admin', 'admins', auth.uid());
  return 'pending';
end $$;
revoke execute on function public.request_change(text, text, integer, text) from public, anon;
grant execute on function public.request_change(text, text, integer, text) to authenticated;

-- Members adding a bike: it waits for an admin (admins can still add bikes directly)
create or replace function public.save_bike(p_slot integer, p_vrn text, p_model text default null, p_member_id bigint default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare mid bigint; v text := nullif(upper(regexp_replace(trim(coalesce(p_vrn, '')), '\s+', ' ', 'g')), '');
begin
  if p_slot not in (2, 3) then raise exception 'You can add up to 3 bikes'; end if;
  if p_member_id is null then return public.request_change('bike', v, p_slot, p_model); end if;
  if not is_admin() then raise exception 'Admins only'; end if;
  mid := p_member_id;
  if v is null then delete from member_bikes where member_id = mid and slot = p_slot; return 'removed'; end if;
  if length(regexp_replace(v, '[^A-Z0-9]', '', 'g')) < 6 then raise exception 'Please check the VRN (for example WB 02 AB 1234)'; end if;
  insert into member_bikes (member_id, slot, vrn, model) values (mid, p_slot, v, nullif(trim(coalesce(p_model, '')), ''))
  on conflict (member_id, slot) do update set vrn = excluded.vrn, model = excluded.model,
    verified = case when private.norm_vrn(member_bikes.vrn) = private.norm_vrn(excluded.vrn) then member_bikes.verified else false end;
  return 'saved';
end $$;

create or replace function public.admin_list_changes()
returns table (id bigint, member_id bigint, full_name text, phone text, kind text, slot smallint, old_value text, new_value text, new_model text,
               vrn_verified boolean, created_at timestamptz, vrn_other text, on_app boolean)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select c.id, c.member_id, m.full_name, m.phone, c.kind, c.slot, c.old_value, c.new_value, c.new_model, c.vrn_verified, c.created_at,
           case when c.kind in ('vrn', 'bike') then (select string_agg(o.full_name, ', ') from members o where o.status = 'active' and o.id <> m.id
             and (private.norm_vrn(o.vrn) = private.norm_vrn(c.new_value) or exists (select 1 from member_bikes b where b.member_id = o.id and private.norm_vrn(b.vrn) = private.norm_vrn(c.new_value)))) end,
           m.user_id is not null
    from change_requests c join members m on m.id = c.member_id
    where c.status = 'pending' and m.status = 'active' order by c.created_at;
end $$;
revoke execute on function public.admin_list_changes() from public, anon;
grant execute on function public.admin_list_changes() to authenticated;

create or replace function public.admin_set_change_vrn(p_id bigint, p_verified boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update change_requests set vrn_verified = coalesce(p_verified, false) where id = p_id and status = 'pending';
  return coalesce(p_verified, false);
end $$;
revoke execute on function public.admin_set_change_vrn(bigint, boolean) from public, anon;
grant execute on function public.admin_set_change_vrn(bigint, boolean) to authenticated;

create or replace function public.admin_decide_change(p_id bigint, p_approve boolean, p_reason text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare c change_requests;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into c from change_requests where id = p_id and status = 'pending';
  if not found then raise exception 'This change was already handled'; end if;
  if p_approve then
    if c.kind = 'name' then update members set full_name = c.new_value where id = c.member_id;
    elsif c.kind = 'phone' then
      if exists (select 1 from members where phone = c.new_value and id <> c.member_id) then raise exception 'Another member already has this number'; end if;
      update members set phone = c.new_value where id = c.member_id;
    elsif c.kind = 'vrn' then update members set vrn = c.new_value, bike = coalesce(c.new_model, bike), vrn_verified = c.vrn_verified where id = c.member_id;
    elsif c.kind = 'bike' then
      insert into member_bikes (member_id, slot, vrn, model, verified, verified_by) values (c.member_id, c.slot, c.new_value, c.new_model, c.vrn_verified, case when c.vrn_verified then private.admin_name() end)
      on conflict (member_id, slot) do update set vrn = excluded.vrn, model = excluded.model, verified = excluded.verified, verified_by = excluded.verified_by;
    elsif c.kind = 'tnc' then update members set tnc_agreed = false where id = c.member_id;
    end if;
  end if;
  update change_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = private.admin_name(),
    reject_reason = case when p_approve then null else nullif(trim(coalesce(p_reason, '')), '') end
  where id = c.id;
  return case when p_approve then 'approved' else 'rejected' end;
end $$;
revoke execute on function public.admin_decide_change(bigint, boolean, text) from public, anon;
grant execute on function public.admin_decide_change(bigint, boolean, text) to authenticated;

-- The admin badge counts both new entries and changes
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'members',  (select count(*) from members where status = 'active'),
    'on_app',   (select count(*) from members where user_id is not null and status = 'active'),
    'pending',  (select count(*) from link_requests where status = 'pending') + (select count(*) from change_requests c join members m on m.id = c.member_id where c.status = 'pending' and m.status = 'active'),
    'entries',  (select count(*) from link_requests where status = 'pending'),
    'changes',  (select count(*) from change_requests c join members m on m.id = c.member_id where c.status = 'pending' and m.status = 'active'),
    'admins',   (select count(*) from members where role in ('admin','superadmin') and status = 'active'),
    'gone',     (select count(*) from members where status <> 'active'));
end $$;

-- ---------- 7. The sheet: approved members' extra form answers go to the matching columns ----------
create or replace function private.member_json(m public.members) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('full_name', m.full_name, 'dob', m.dob, 'phone', m.phone, 'email', m.email, 'vrn', m.vrn,
    'bike', m.bike, 'blood_group', m.blood_group, 'locality', m.locality, 'hideout', m.hideout,
    'emergency_phone', m.emergency_phone, 'alt_phone', m.alt_phone, 'joined_at', m.joined_at,
    'vrn_verified', m.vrn_verified, 'answers', m.form_answers,
    'bike2_vrn', (select vrn from member_bikes where member_id = m.id and slot = 2),
    'bike2_model', (select model from member_bikes where member_id = m.id and slot = 2),
    'bike3_vrn', (select vrn from member_bikes where member_id = m.id and slot = 3),
    'bike3_model', (select model from member_bikes where member_id = m.id and slot = 3))
$$;
-- push again when the answers arrive after approval
create or replace function private.answers_push() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if coalesce(current_setting('rwb.from_sheet', true), '') = 'on' then return new; end if;
  if new.status = 'active' and new.form_answers is distinct from old.form_answers then
    perform private.sheet_post(jsonb_build_object('action', 'update', 'old_phone', new.phone, 'member', private.member_json(new)));
  end if;
  return new;
end $$;
drop trigger if exists members_answers_to_sheet on public.members;
create trigger members_answers_to_sheet after update of form_answers on public.members for each row execute function private.answers_push();

notify pgrst, 'reload schema';
