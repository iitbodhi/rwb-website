-- RWB App setup file 39: one way to join RWB, the join form on roninwb.in (Join us).
-- * The app no longer takes join requests: new riders fill in the RWB join form. Their entry waits in the
--   app's approval list; once approved they sign in with the same email and their details are already there.
-- * Someone who signs in with an email that isn't registered sees "No Account Found!" with the admins'
--   WhatsApp (admins only, first name and number) and the join form link.
-- * Rejected entries are kept in the app for 60 days (so the sheet can delete their row), then deleted.
-- Safe to run more than once.

-- 1. join requests from inside the app are closed (requests already waiting stay in the approval list)
create or replace function public.request_access(p_full_name text, p_phone text, p_dob date default null,
  p_vrn text default null, p_locality text default null, p_bike text default null, p_blood_group text default null,
  p_hideout text default null, p_emergency_phone text default null, p_alt_phone text default null,
  p_tnc boolean default false, p_answers jsonb default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  raise exception 'New riders join through the RWB join form on roninwb.in (Join us). Once an admin approves you, sign in here with the same email.';
end $$;

-- 2. "No Account Found!": who to WhatsApp (RWB admins only), for anyone signed in with Google
create or replace function public.join_help_admins() returns table (first_name text, phone text)
language sql stable security definer set search_path = public as $$
  select split_part(coalesce(nullif(m.nickname, ''), m.full_name), ' ', 1), m.phone from members m
  where auth.uid() is not null and m.status = 'active' and m.role in ('superadmin', 'admin') and length(coalesce(m.phone, '')) = 10
  order by case m.role when 'superadmin' then 0 else 1 end, m.full_name
$$;
revoke execute on function public.join_help_admins() from public, anon;
grant execute on function public.join_help_admins() to authenticated;

-- 3. the sheet's 10-minute check: also clears rejected entries older than 60 days (their sheet row is already gone)
create or replace function public.sheet_export_all(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.sheet_ok(p_secret);
  delete from link_requests where status = 'rejected' and decided_at < now() - interval '60 days';
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(private.member_json(m) || jsonb_build_object('status', m.status, 'tnc_agreed', m.tnc_agreed,
        'on_app', m.user_id is not null, 'removed_note', m.removed_note, 'removed_at', m.removed_at)) from members m), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('phone', r.phone, 'form_ts', r.form_ts)) from link_requests r where r.status = 'pending'), '[]'::jsonb),
    'rejected', coalesce((select jsonb_agg(jsonb_build_object('phone', r.phone, 'form_ts', r.form_ts, 'reason', r.reject_reason))
        from link_requests r where r.status = 'rejected' and r.decided_at > now() - interval '60 days'
          and not exists (select 1 from members m where m.phone = r.phone and m.status = 'active')), '[]'::jsonb),
    'at', now());
end $$;
revoke execute on function public.sheet_export_all(text) from public;
grant execute on function public.sheet_export_all(text) to anon, authenticated;

notify pgrst, 'reload schema';
