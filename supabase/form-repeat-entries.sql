-- RWB App setup file 40: an existing member who fills in the join form again doesn't need approval.
-- * Same WhatsApp number, same name, same VRN (and the same email, or none on record): the new answers update their
--   details straight away (blanks never erase anything), the T&C answer counts as agreeing to the current T&C,
--   and the sheet keeps only their newest row. Nothing goes to the approval list.
-- * If the name, VRN or email is different, the entry still waits for an admin, like a change in Me.
-- * New riders still always wait for approval.
-- Safe to run more than once.

create or replace function public.sheet_upsert_member(p_secret text, p jsonb) returns text
language plpgsql security definer set search_path = public, private as $$
declare
  ph   text := right(regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g'), 10);
  nm   text := nullif(regexp_replace(trim(coalesce(p ->> 'full_name', '')), '\s+', ' ', 'g'), '');
  ts   timestamptz := coalesce(nullif(p ->> 'joined_at', '')::timestamptz, now());
  tc   boolean := case lower(coalesce(p ->> 'tnc', '')) when 'yes' then true when 'no' then false else null end;
  em   text := nullif(lower(trim(coalesce(p ->> 'email', ''))), '');
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
  -- an existing member filled in the form again with the same name, VRN and email: update them, no approval needed
  if found and ex.status = 'active'
     and lower(nm) = lower(regexp_replace(trim(coalesce(ex.full_name, '')), '\s+', ' ', 'g'))
     and (private.norm_vrn(p ->> 'vrn') is null or private.norm_vrn(p ->> 'vrn') = private.norm_vrn(ex.vrn))
     and (em is null or ex.email is null or lower(ex.email) = em) then
    update members set
      email = coalesce(email, em), dob = coalesce(v_dob, dob),
      locality = coalesce(nullif(trim(p ->> 'locality'), ''), locality), bike = coalesce(nullif(trim(p ->> 'bike'), ''), bike),
      blood_group = coalesce(nullif(trim(p ->> 'blood_group'), ''), blood_group), hideout = coalesce(nullif(trim(p ->> 'hideout'), ''), hideout),
      emergency_phone = coalesce(nullif(right(regexp_replace(coalesce(p ->> 'emergency_phone', ''), '\D', '', 'g'), 10), ''), emergency_phone),
      alt_phone = coalesce(nullif(right(regexp_replace(coalesce(p ->> 'alt_phone', ''), '\D', '', 'g'), 10), ''), alt_phone),
      tnc_agreed = case when tc then true else tnc_agreed end,
      tnc_version = case when tc then private.tnc_current() else tnc_version end,
      tnc_agreed_at = case when tc then now() else tnc_agreed_at end
    where id = ex.id;
    -- an older copy of the same entry waiting for an admin is no longer needed
    update link_requests set status = 'approved', decided_at = now(), decided_by = 'Join form (same details)'
    where phone = ph and status = 'pending' and source = 'form' and user_id is null;
    return 'updated';
  end if;
  -- a new entry (or a member filling the form with a different name, VRN or email): it waits for an admin
  select id into rid from link_requests where phone = ph and status = 'pending' order by created_at desc limit 1;
  if rid is null then
    insert into link_requests (user_id, source, email, full_name, phone, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, alt_phone, tnc, form_ts, status)
    values (null, 'form', em, nm, ph, v_dob, nullif(upper(trim(p ->> 'vrn')), ''), nullif(trim(p ->> 'locality'), ''),
            nullif(trim(p ->> 'bike'), ''), nullif(trim(p ->> 'blood_group'), ''), nullif(trim(p ->> 'hideout'), ''),
            nullif(right(regexp_replace(coalesce(p ->> 'emergency_phone', ''), '\D', '', 'g'), 10), ''),
            nullif(right(regexp_replace(coalesce(p ->> 'alt_phone', ''), '\D', '', 'g'), 10), ''), tc, ts, 'pending');
  else
    update link_requests set source = 'form', full_name = nm, email = coalesce(em, email), dob = coalesce(v_dob, dob),
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

notify pgrst, 'reload schema';
