-- RWB App setup file 42: "Find your account" improvements (run after file 41).
-- * The email hint shows the first 3 characters (e.g. bod•••@gmail.com) instead of 2.
-- * "Can't use that email?" (WhatsApp no. + VRN + date of birth) also works when the membership is already on the app
--   with another Google account: it moves to the account they're signed in with, the old account loses access,
--   and RWB admins get a notification so they can check.
-- Safe to run more than once.

create or replace function private.hint_email(e text) returns text language sql immutable as $$
  select case when coalesce(e, '') !~ '@' then null
    else left(split_part(e, '@', 1), case when length(split_part(e, '@', 1)) > 4 then 3 else 1 end) || '•••@' || split_part(e, '@', 2) end
$$;

create or replace function public.find_my_email(p_phone text, p_vrn text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members;
begin
  m := private.find_member(p_phone, p_vrn);
  if m.id is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'hint', private.hint_email(m.email), 'on_app', m.user_id is not null);
end $$;
revoke execute on function public.find_my_email(text, text) from public, anon;
grant execute on function public.find_my_email(text, text) to authenticated;

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
  update members set user_id = auth.uid(), email = em where id = m.id;   -- the sheet's email updates too
  delete from private.find_attempts where user_id = auth.uid();
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

notify pgrst, 'reload schema';
