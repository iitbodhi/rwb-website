-- RWB App setup file 34: one VRN per member, VRNs without spaces, and a sheet that always matches the app.
-- * VRNs are stored without spaces or dashes (WB 02 AB 1234 → WB02AB1234), everywhere, from now on.
-- * Joining in the app (or changing / adding a bike) with a VRN another member already has is refused,
--   with a hint of the email and WhatsApp number it's registered with (only a few characters shown).
-- * The sheet script checks the app every 15 minutes and repairs the sheet (sheet_export_all), fills gaps
--   in the app from the sheet (sheet_fill_members), and tidies duplicate VRNs (sheet_vrn_owners / sheet_archive_duplicates).
-- * The sheet script registers its own web address here, so instant updates always reach the current sheet.
-- Safe to run more than once.

-- ---------- 1. VRNs without spaces ----------
create or replace function private.vrn_clean() returns trigger language plpgsql as $$
begin
  new.vrn := private.norm_vrn(new.vrn);
  return new;
end $$;
drop trigger if exists members_vrn_clean on public.members;
create trigger members_vrn_clean before insert or update of vrn on public.members for each row execute function private.vrn_clean();
drop trigger if exists bikes_vrn_clean on public.member_bikes;
create trigger bikes_vrn_clean before insert or update of vrn on public.member_bikes for each row execute function private.vrn_clean();
drop trigger if exists requests_vrn_clean on public.link_requests;
create trigger requests_vrn_clean before insert or update of vrn on public.link_requests for each row execute function private.vrn_clean();
create or replace function private.change_vrn_clean() returns trigger language plpgsql as $$
begin
  if new.kind in ('vrn', 'bike') then new.new_value := private.norm_vrn(new.new_value); end if;
  return new;
end $$;
drop trigger if exists changes_vrn_clean on public.change_requests;
create trigger changes_vrn_clean before insert or update of new_value on public.change_requests for each row execute function private.change_vrn_clean();

-- clean the VRNs already saved (quietly: the sheet is tidied by the sheet script)
do $$ begin
  perform set_config('rwb.from_sheet', 'on', true);
  update public.members set vrn = private.norm_vrn(vrn) where vrn is distinct from private.norm_vrn(vrn);
  update public.member_bikes set vrn = private.norm_vrn(vrn) where vrn is distinct from private.norm_vrn(vrn);
  update public.link_requests set vrn = private.norm_vrn(vrn) where vrn is distinct from private.norm_vrn(vrn);
  update public.change_requests set new_value = private.norm_vrn(new_value) where kind in ('vrn', 'bike') and new_value is distinct from private.norm_vrn(new_value);
  -- helper columns from the sheet (titles like "45" holding counts) are not form answers
  update public.members m set form_answers = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(m.form_answers) e(k, v) where k !~ '^\s*[0-9.]*\s*$')
  where form_answers is not null and exists (select 1 from jsonb_object_keys(m.form_answers) k where k ~ '^\s*[0-9.]*\s*$');
  update public.link_requests r set answers = (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(r.answers) e(k, v) where k !~ '^\s*[0-9.]*\s*$')
  where answers is not null and exists (select 1 from jsonb_object_keys(r.answers) k where k ~ '^\s*[0-9.]*\s*$');
end $$;

-- ---------- 2. Who already has this VRN? (shown masked) ----------
create or replace function private.mask_email(e text) returns text language sql immutable as $$
  select case when coalesce(e, '') !~ '@' then null
    else left(split_part(e, '@', 1), 2) || '•••@' || split_part(e, '@', 2) end
$$;
create or replace function private.mask_phone(p text) returns text language sql immutable as $$
  select case when length(coalesce(p, '')) < 6 then null else left(p, 2) || '••••••' || right(p, 2) end
$$;
-- the member (or waiting entry) holding this VRN, other than the given person
create or replace function private.vrn_holder(p_vrn text, p_phone text, p_email text, p_member_id bigint default null)
returns table (full_name text, email text, phone text, kind text)
language sql stable security definer set search_path = public, private as $$
  with v as (select private.norm_vrn(p_vrn) as n)
  select m.full_name, m.email, m.phone, 'member' from members m, v
  where v.n is not null and length(v.n) >= 6 and m.status = 'active' and m.id is distinct from p_member_id
    and m.phone is distinct from nullif(p_phone, '') and lower(coalesce(m.email, '')) is distinct from lower(nullif(p_email, ''))
    and (private.norm_vrn(m.vrn) = v.n or exists (select 1 from member_bikes b where b.member_id = m.id and private.norm_vrn(b.vrn) = v.n))
  union all
  select r.full_name, r.email, r.phone, 'waiting' from link_requests r, v
  where v.n is not null and length(v.n) >= 6 and r.status = 'pending' and private.norm_vrn(r.vrn) = v.n
    and r.phone is distinct from nullif(p_phone, '') and lower(coalesce(r.email, '')) is distinct from lower(nullif(p_email, ''))
    and r.user_id is distinct from auth.uid()
  limit 1
$$;
create or replace function private.vrn_taken_text(p_email text, p_phone text, p_kind text) returns text language sql immutable as $$
  select 'This VRN is already registered with RWB' ||
    case when private.mask_email(p_email) is not null or private.mask_phone(p_phone) is not null then ' (' ||
      concat_ws(', ', 'email ' || private.mask_email(p_email), 'WhatsApp ' || private.mask_phone(p_phone)) || ')' else '' end ||
    case when p_kind = 'waiting' then ', waiting for approval' else '' end ||
    '. If that''s you, sign in with that email. Otherwise please message an RWB admin.'
$$;
-- for the join form: a hint as soon as the VRN is typed (signed-in people only; only a few characters shown)
create or replace function public.vrn_hint(p_vrn text, p_phone text default null) returns text
language plpgsql stable security definer set search_path = public, private as $$
declare h record;
begin
  if auth.uid() is null then return null; end if;
  select * into h from private.vrn_holder(p_vrn, right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), auth.jwt() ->> 'email',
    (select id from members where user_id = auth.uid()));
  if not found then return null; end if;
  return private.vrn_taken_text(h.email, h.phone, h.kind);
end $$;
revoke execute on function public.vrn_hint(text, text) from public, anon;
grant execute on function public.vrn_hint(text, text) to authenticated;

-- joining in the app: refused when someone else already has the VRN (form entries can't be refused, admins see a warning)
create or replace function private.request_vrn_check() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare h record;
begin
  if new.source is distinct from 'app' or new.vrn is null or new.status <> 'pending' then return new; end if;
  if tg_op = 'UPDATE' and new.vrn is not distinct from old.vrn and old.status = 'pending' then return new; end if;
  select * into h from private.vrn_holder(new.vrn, new.phone, new.email);
  if found then raise exception '%', private.vrn_taken_text(h.email, h.phone, h.kind); end if;
  return new;
end $$;
drop trigger if exists requests_vrn_check on public.link_requests;
create trigger requests_vrn_check before insert or update on public.link_requests for each row execute function private.request_vrn_check();

-- changing the main bike or adding a bike: same rule
create or replace function private.change_vrn_check() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare h record; m members;
begin
  if new.kind not in ('vrn', 'bike') or new.new_value is null or new.status <> 'pending' then return new; end if;
  select * into m from members where id = new.member_id;
  select * into h from private.vrn_holder(new.new_value, m.phone, m.email, m.id);
  if found and h.kind = 'member' then raise exception '%', private.vrn_taken_text(h.email, h.phone, h.kind); end if;
  return new;
end $$;
drop trigger if exists changes_vrn_check on public.change_requests;
create trigger changes_vrn_check before insert on public.change_requests for each row execute function private.change_vrn_check();

-- ---------- 3. The sheet script keeps the sheet matching the app ----------
create or replace function private.sheet_ok(p_secret text) returns void language plpgsql stable security definer set search_path = public, private as $$
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then raise exception 'Not allowed'; end if;
end $$;

-- everything the sheet needs: every member (with status), entries waiting, and recent rejections
create or replace function public.sheet_export_all(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.sheet_ok(p_secret);
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

-- the sheet fills gaps in the app: only empty fields are filled, nothing the app has is overwritten
create or replace function public.sheet_fill_members(p_secret text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, private as $$
declare r jsonb; n integer := 0; k integer; d date;
begin
  perform private.sheet_ok(p_secret);
  perform set_config('rwb.from_sheet', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin d := nullif(r ->> 'dob', '')::date; exception when others then d := null; end;
    update members set
      email = coalesce(email, nullif(lower(trim(r ->> 'email')), '')),
      dob = coalesce(dob, d),
      vrn = coalesce(vrn, private.norm_vrn(r ->> 'vrn')),
      blood_group = coalesce(blood_group, nullif(trim(r ->> 'blood_group'), '')),
      locality = coalesce(locality, nullif(trim(r ->> 'locality'), '')),
      hideout = coalesce(hideout, nullif(trim(r ->> 'hideout'), '')),
      emergency_phone = coalesce(emergency_phone, nullif(right(regexp_replace(coalesce(r ->> 'emergency_phone', ''), '\D', '', 'g'), 10), '')),
      alt_phone = coalesce(alt_phone, nullif(right(regexp_replace(coalesce(r ->> 'alt_phone', ''), '\D', '', 'g'), 10), ''))
    where phone = right(regexp_replace(coalesce(r ->> 'phone', ''), '\D', '', 'g'), 10) and status = 'active';
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function public.sheet_fill_members(text, jsonb) from public;
grant execute on function public.sheet_fill_members(text, jsonb) to anon, authenticated;

-- duplicate VRNs: who is behind each number (so the sheet keeps the right row)
create or replace function public.sheet_vrn_owners(p_secret text, p_phones text[]) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.sheet_ok(p_secret);
  return coalesce((select jsonb_object_agg(m.phone, jsonb_build_object('status', m.status, 'on_app', m.user_id is not null, 'tnc', m.tnc_agreed))
    from members m where m.phone = any(p_phones)), '{}'::jsonb);
end $$;
revoke execute on function public.sheet_vrn_owners(text, text[]) from public;
grant execute on function public.sheet_vrn_owners(text, text[]) to anon, authenticated;

-- duplicate entries for a VRN that another member keeps: archived in the app (admins see them under
-- Left / removed with the reason, and can restore them). Members on the app are never archived this way.
create or replace function public.sheet_archive_duplicates(p_secret text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, private as $$
declare r jsonb; n integer := 0; k integer;
begin
  perform private.sheet_ok(p_secret);
  perform set_config('rwb.from_sheet', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    update members set status = 'removed', removed_at = now(), removed_by = 'Sheet tidy-up',
      removed_note = left('Duplicate VRN ' || coalesce(r ->> 'vrn', '') || ': kept ' || coalesce(r ->> 'kept', 'another entry'), 200)
    where phone = right(regexp_replace(coalesce(r ->> 'phone', ''), '\D', '', 'g'), 10) and status = 'active' and user_id is null;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function public.sheet_archive_duplicates(text, jsonb) from public;
grant execute on function public.sheet_archive_duplicates(text, jsonb) to anon, authenticated;

-- the sheet script tells the app its current web address (only real deployments: …/exec)
create or replace function public.sheet_set_webhook(p_secret text, p_url text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.sheet_ok(p_secret);
  if p_url !~ '^https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec$' then return 'ignored'; end if;
  insert into private.config (key, value) values ('sheet_webhook_url', p_url) on conflict (key) do update set value = excluded.value;
  return 'saved';
end $$;
revoke execute on function public.sheet_set_webhook(text, text) from public;
grant execute on function public.sheet_set_webhook(text, text) to anon, authenticated;
