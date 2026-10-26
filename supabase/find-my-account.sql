-- RWB App setup file 41: members who aren't on the app yet get in by themselves (no admin needed).
-- On the "No Account Found!" screen, after signing in with Google:
--   1. Find my email: WhatsApp no. + VRN → a hint of the email they joined with (e.g. ne•••@gmail.com).
--   2. Can't use that email? WhatsApp no. + VRN + date of birth → if all three match their RWB record, the Google
--      account they're signed in with becomes their RWB account (email updated in the app and the sheet).
-- Safety: both need the WhatsApp number AND a VRN on the same member; 10 tries per hour per Google account;
-- a membership already used on the app by another Google account is never moved (they must ask an admin).
-- Safe to run more than once.

create table if not exists private.find_attempts (user_id uuid not null, at timestamptz not null default now());
create index if not exists find_attempts_user on private.find_attempts (user_id, at);

-- the active member with this WhatsApp number who owns this VRN (main bike or bike 2 / 3), after a rate-limit check
create or replace function private.find_member(p_phone text, p_vrn text) returns members
language plpgsql security definer set search_path = public, private as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); v text := private.norm_vrn(p_vrn); m members;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  delete from private.find_attempts where at < now() - interval '1 day';
  if (select count(*) from private.find_attempts where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many tries. Please wait an hour, or WhatsApp the admins.';
  end if;
  insert into private.find_attempts (user_id) values (auth.uid());
  if length(ph) <> 10 then raise exception 'Enter your 10-digit WhatsApp number'; end if;
  if v is null or length(v) < 6 then raise exception 'Enter your full VRN, e.g. WB02AB1234'; end if;
  select * into m from members x where x.phone = ph and x.status = 'active'
    and (private.norm_vrn(x.vrn) = v or exists (select 1 from member_bikes b where b.member_id = x.id and private.norm_vrn(b.vrn) = v))
  limit 1;
  return m;
end $$;

-- 1. which email did I join with? (a hint only)
create or replace function public.find_my_email(p_phone text, p_vrn text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members;
begin
  m := private.find_member(p_phone, p_vrn);
  if m.id is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'hint', private.mask_email(m.email), 'on_app', m.user_id is not null);
end $$;
revoke execute on function public.find_my_email(text, text) from public, anon;
grant execute on function public.find_my_email(text, text) to authenticated;

-- 2. verify with date of birth and use the Google account I'm signed in with
create or replace function public.claim_membership(p_phone text, p_vrn text, p_dob date) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members; em text := lower(coalesce(auth.jwt() ->> 'email', ''));
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
  if m.user_id is not null then
    raise exception 'This membership is already used on the app with another Google account (%). Sign in with that account, or WhatsApp the admins.', coalesce(private.mask_email(m.email), 'a different email');
  end if;
  update members set user_id = auth.uid(), email = em where id = m.id;   -- the sheet's email updates too
  delete from private.find_attempts where user_id = auth.uid();
  return jsonb_build_object('ok', true, 'name', split_part(m.full_name, ' ', 1));
end $$;
revoke execute on function public.claim_membership(text, text, date) from public, anon;
grant execute on function public.claim_membership(text, text, date) to authenticated;

notify pgrst, 'reload schema';
