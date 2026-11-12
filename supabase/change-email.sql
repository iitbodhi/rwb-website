-- 63 · Admins can change a member's email (Admin → Members → name → Edit details).
-- Run once in Supabase → SQL Editor, after 62. Safe to run more than once.
-- * Not on the app yet: the new email is saved and they sign in to the app with it.
-- * Already on the app with another Google account: that account is signed out of RWB straight away
--   (next time it opens, it's sent to the sign-in screen with a note). When they sign in with the new email,
--   everything they saved comes along (service records, bills, fuel log, documents, My Ride, reminders,
--   Motomart posts, RSVPs…). Their role (admin, coordinator) stays too.
-- * The same carry-over now also happens when a member moves their app themselves
--   ("No Account Found" → "Can't use that email?"). Before, their old records stayed behind.
-- * The RWB contact sheet gets the new email too (through the usual sync).

alter table public.members add column if not exists move_from uuid;   -- the old app account, until they sign in with the new email

-- Which old Google accounts became which new ones (so moved bills and documents still open)
create table if not exists private.account_moves (
  old_uid  uuid primary key,
  new_uid  uuid not null,
  moved_at timestamptz not null default now()
);
create index if not exists account_moves_new_idx on private.account_moves (new_uid);

-- Move everything one app account owns to another app account
create or replace function private.move_account(p_old uuid, p_new uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare r record;
begin
  if p_old is null or p_new is null or p_old = p_new then return; end if;
  for r in
    select c.conrelid::regclass as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and array_length(c.conkey, 1) = 1
      and c.connamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.conrelid <> 'public.members'::regclass
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_new, p_old;
    exception when unique_violation then
      -- the new account already has its own row here (made just by signing in): the old one wins
      begin
        execute format('delete from %s where %I = $1', r.tbl, r.col) using p_new;
        execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_new, p_old;
      exception when others then null;   -- never block signing in
      end;
    when others then null;
    end;
  end loop;
  -- files stay in the old account's folder; remember the move so the new account can still open them
  update private.account_moves set new_uid = p_new where new_uid = p_old;
  insert into private.account_moves (old_uid, new_uid) values (p_old, p_new)
    on conflict (old_uid) do update set new_uid = excluded.new_uid, moved_at = now();
end $$;
revoke execute on function private.move_account(uuid, uuid) from public, anon, authenticated;

create or replace function public.my_old_folders() returns text[]
language sql stable security definer set search_path = public, private as $$
  select coalesce(array_agg(old_uid::text), '{}') from private.account_moves where new_uid = auth.uid()
$$;
revoke execute on function public.my_old_folders() from public, anon;
grant execute on function public.my_old_folders() to authenticated;

-- Bills, documents, Motomart photos, chat files and photos saved by the old account still open and can be deleted
drop policy if exists moved_files_read on storage.objects;
drop policy if exists moved_files_delete on storage.objects;
create policy moved_files_read on storage.objects for select to authenticated
  using (bucket_id in ('bills', 'docs', 'motomart', 'talk', 'avatars') and (storage.foldername(name))[1] = any (public.my_old_folders()));
create policy moved_files_delete on storage.objects for delete to authenticated
  using (bucket_id in ('bills', 'docs', 'motomart', 'talk', 'avatars') and (storage.foldername(name))[1] = any (public.my_old_folders()));

-- Admins can correct every answer, now including the email
create or replace function public.admin_update_member(p_member_id bigint, p jsonb) returns text
language plpgsql security definer set search_path = public, private as $$
declare
  ph  text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 10);
  em  text := lower(trim(coalesce(p ->> 'email', '')));
  m   members;
  app_email text;
  other text;
  moving boolean := false;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into m from members where id = p_member_id;
  if m.id is null then raise exception 'Member not found'; end if;
  if p ? 'phone' and length(ph) <> 10 then raise exception 'WhatsApp No. needs a 10-digit number'; end if;
  if p ? 'phone' and exists (select 1 from members where phone = ph and id <> p_member_id) then
    raise exception 'Another member already has WhatsApp No. %', ph;
  end if;
  if p ? 'email' and em is distinct from lower(coalesce(m.email, '')) then
    if em = '' and m.user_id is not null then raise exception 'They''re on the app, so they need an email'; end if;
    if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Please check the email'; end if;
    select full_name into other from members where lower(email) = em and id <> p_member_id and status = 'active' limit 1;
    if other is not null then raise exception '% already uses this email', other; end if;
    if m.user_id is not null then
      select lower(email) into app_email from auth.users where id = m.user_id;
      moving := em is distinct from coalesce(app_email, '');   -- their own app email = nothing to move
    end if;
  end if;
  if moving then
    -- sign the old account out of RWB: it's no longer linked, and its phone stops getting RWB notifications
    update members set user_id = null, move_from = m.user_id where id = p_member_id;
    delete from fcm_tokens where user_id = m.user_id;
  end if;
  update members set
    full_name       = coalesce(nullif(regexp_replace(trim(p ->> 'full_name'), '\s+', ' ', 'g'), ''), full_name),
    nickname        = case when p ? 'nickname'        then nullif(trim(p ->> 'nickname'), '')        else nickname end,
    dob             = case when p ? 'dob'             then nullif(p ->> 'dob', '')::date              else dob end,
    phone           = case when p ? 'phone'           then ph                                         else phone end,
    email           = case when p ? 'email'           then nullif(em, '')                             else email end,
    vrn             = case when p ? 'vrn'             then nullif(upper(trim(p ->> 'vrn')), '')       else vrn end,
    bike            = case when p ? 'bike'            then nullif(trim(p ->> 'bike'), '')            else bike end,
    blood_group     = case when p ? 'blood_group'     then nullif(trim(p ->> 'blood_group'), '')     else blood_group end,
    locality        = case when p ? 'locality'        then nullif(trim(p ->> 'locality'), '')        else locality end,
    hideout         = case when p ? 'hideout'         then nullif(trim(p ->> 'hideout'), '')         else hideout end,
    emergency_phone = case when p ? 'emergency_phone' then nullif(right(regexp_replace(p ->> 'emergency_phone', '\D', '', 'g'), 10), '') else emergency_phone end,
    alt_phone       = case when p ? 'alt_phone'       then nullif(right(regexp_replace(p ->> 'alt_phone', '\D', '', 'g'), 10), '')       else alt_phone end
  where id = p_member_id;
  return case when moving then 'moved' else 'saved' end;
end $$;
revoke execute on function public.admin_update_member(bigint, jsonb) from public, anon;
grant execute on function public.admin_update_member(bigint, jsonb) to authenticated;

-- Signing in: a member, a member whose email an admin changed, a waiting entry, or not found
create or replace function public.link_account() returns text
language plpgsql security definer set search_path = public, private as $$
declare
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  m   members; rid bigint;
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
    -- filled the join form with this email and is waiting for approval
    if not exists (select 1 from link_requests where user_id = auth.uid()) then
      select id into rid from link_requests where lower(email) = em and user_id is null and status = 'pending' order by created_at desc limit 1;
      if rid is not null then update link_requests set user_id = auth.uid() where id = rid; return 'pending'; end if;
    end if;
  end if;
  if exists (select 1 from link_requests where user_id = auth.uid() and status = 'pending') then return 'pending'; end if;
  if exists (select 1 from link_requests where user_id = auth.uid() and status = 'rejected') then return 'rejected'; end if;
  if exists (select 1 from members where move_from = auth.uid()) then return 'moved'; end if;   -- an admin changed their email
  return 'not_found';
end $$;
revoke execute on function public.link_account() from public, anon;
grant execute on function public.link_account() to authenticated;

-- "Can't use that email?": the member's records now move to the new account too
create or replace function public.claim_membership(p_phone text, p_vrn text, p_dob date) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members; em text := lower(coalesce(auth.jwt() ->> 'email', '')); old_email text;
begin
  if exists (select 1 from members where user_id = auth.uid()) then return jsonb_build_object('ok', true, 'name', ''); end if;
  if em = '' or not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'Please sign in with a Google account first';
  end if;
  m := private.find_member(p_phone, p_vrn);
  if m.id is null or p_dob is null or m.dob is null
     or not (m.dob = p_dob or (extract(year from m.dob) = 1904 and to_char(m.dob, 'MM-DD') = to_char(p_dob, 'MM-DD'))) then
    if m.id is not null and m.dob is null then raise exception 'Your RWB record has no date of birth, so we can''t verify you here. Please WhatsApp the admins.'; end if;
    return jsonb_build_object('ok', false);
  end if;
  old_email := m.email;
  if m.move_from is not null then perform set_config('rwb.quiet_join', 'on', true); end if;
  update members set user_id = auth.uid(), email = em, move_from = null where id = m.id;   -- the sheet's email updates too
  delete from private.find_attempts where user_id = auth.uid();
  perform private.move_account(coalesce(m.user_id, m.move_from), auth.uid());
  if m.user_id is not null then
    -- it was on the app with another Google account: tell the admins
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'App account moved: ' || m.full_name,
            m.full_name || ' verified with WhatsApp no., VRN and date of birth and now uses ' || em || ' (was ' || coalesce(old_email, 'another account') || '). If this wasn''t them, check with them on WhatsApp.',
            '#admin', 'admins', auth.uid());
  end if;
  return jsonb_build_object('ok', true, 'name', split_part(m.full_name, ' ', 1), 'moved', m.user_id is not null);
end $$;
revoke execute on function public.claim_membership(text, text, date) from public, anon;
grant execute on function public.claim_membership(text, text, date) to authenticated;

-- "A new Ronin joined the app" only for real newcomers, not for someone whose email changed
create or replace function private.member_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and (tg_op = 'INSERT' or old.user_id is null)
     and coalesce(current_setting('rwb.quiet_join', true), '') <> 'on' then
    insert into notifications (kind, title, body, url, created_by)
    values ('member', 'A new Ronin joined the app 🏍️', 'Say hello to ' || new.full_name || '!', '#home', new.user_id);
  end if;
  return new;
end $$;

-- Removed while waiting to sign in with the new email: delete the old app account too (as removal does)
create or replace function private.members_drop_moved() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status <> 'active' and old.status = 'active' and old.move_from is not null then
    delete from auth.users where id = old.move_from;
    new.move_from := null;
  end if;
  return new;
end $$;
drop trigger if exists members_drop_moved on public.members;
create trigger members_drop_moved before update of status on public.members for each row execute function private.members_drop_moved();

notify pgrst, 'reload schema';
