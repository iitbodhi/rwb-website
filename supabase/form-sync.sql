-- =====================================================================
-- RWB App: automatic sync from the Google Form (join registrations)
-- Run once in Supabase > SQL Editor. Safe to run again.
-- The Google Sheet's Apps Script (tools/form-sync.gs) calls sheet_upsert_member
-- every time someone submits the join form.
-- =====================================================================

-- People an admin removed: an old sheet row must not bring them back.
-- If they fill the join form again later, they are added again.
create table if not exists private.removed_phones (
  phone      text primary key,
  removed_at timestamptz not null default now()
);

-- Remember the number whenever an admin removes a member (same as before, plus that one line)
create or replace function public.admin_remove_member(p_member_id bigint) returns text
language plpgsql security definer set search_path = public, auth, private as $$
declare m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into m from members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;
  if m.user_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  if m.role = 'superadmin' then raise exception 'The super admin cannot be removed'; end if;
  if m.role = 'admin' and not is_superadmin() then raise exception 'Only the super admin can remove an admin'; end if;
  if m.phone is not null then
    insert into private.removed_phones (phone) values (m.phone)
    on conflict (phone) do update set removed_at = now();
  end if;
  delete from members where id = m.id;
  if m.user_id is not null then
    delete from auth.users where id = m.user_id;
  end if;
  return 'removed';
end $$;

-- Add (or fill in) a member from one form response. Needs the shared sync secret.
-- Existing members are never overwritten: only their empty fields get filled.
create or replace function public.sheet_upsert_member(p_secret text, p jsonb) returns text
language plpgsql security definer set search_path = public, private as $$
declare
  ph   text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 10);
  nm   text := nullif(trim(p ->> 'full_name'), '');
  ts   timestamptz := coalesce(nullif(p ->> 'joined_at', '')::timestamptz, now());
  dob  date;
  gone timestamptz;
  added boolean;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then
    raise exception 'Not allowed';
  end if;
  if length(ph) <> 10 or nm is null then return 'skipped: no name or number'; end if;
  select removed_at into gone from private.removed_phones where phone = ph;
  if gone is not null then
    if ts <= gone then return 'skipped: removed by admin'; end if;
    delete from private.removed_phones where phone = ph;   -- they registered again after removal
  end if;
  begin dob := nullif(p ->> 'dob', '')::date; exception when others then dob := null; end;

  insert into members (full_name, dob, phone, email, vrn, bike, blood_group, locality, hideout, emergency_phone, alt_phone, joined_at)
  values (nm, dob, ph, nullif(lower(trim(p ->> 'email')), ''), nullif(upper(trim(p ->> 'vrn')), ''), nullif(trim(p ->> 'bike'), ''),
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
notify pgrst, 'reload schema';
