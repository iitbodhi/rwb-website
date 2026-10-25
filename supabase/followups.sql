-- =====================================================================
-- RWB App: live approval cards + the RWB WhatsApp group link
--   • An entry shows "Updated" when the person changes their details while it waits (app, form or sheet)
--   • Admins can save the RWB WhatsApp group's invite link, so members can welcome new Ronins in the group in one tap
--   • Admins can set each of the 4 approval checks themselves (with who set it)
-- Run once in Supabase > SQL Editor, after 30. Safe to run again.
-- =====================================================================
alter table public.link_requests add column if not exists updated_at timestamptz;
create or replace function private.request_touched() returns trigger language plpgsql as $$
begin
  if (new.full_name, new.phone, new.dob, new.vrn, new.bike, new.blood_group, new.locality, new.hideout, new.emergency_phone, new.alt_phone, new.tnc, new.answers, new.email)
     is distinct from (old.full_name, old.phone, old.dob, old.vrn, old.bike, old.blood_group, old.locality, old.hideout, old.emergency_phone, old.alt_phone, old.tnc, old.answers, old.email)
     and new.status = 'pending' then
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists link_requests_touched on public.link_requests;
create trigger link_requests_touched before update on public.link_requests for each row execute function private.request_touched();

-- App settings members can read (only what's listed here)
create or replace function public.app_settings() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when public.is_member() then jsonb_build_object('wa_group_link', (select value from private.config where key = 'wa_group_link')) else '{}'::jsonb end
$$;
revoke execute on function public.app_settings() from public, anon;
grant execute on function public.app_settings() to authenticated;

create or replace function public.admin_set_setting(p_key text, p_value text) returns text
language plpgsql security definer set search_path = public, private as $$
declare v text := nullif(trim(coalesce(p_value, '')), '');
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_key not in ('wa_group_link') then raise exception 'Unknown setting'; end if;
  if p_key = 'wa_group_link' and v is not null and v !~ '^https://chat\.whatsapp\.com/[A-Za-z0-9]+' then
    raise exception 'Please paste the group''s invite link (it starts with https://chat.whatsapp.com/)';
  end if;
  if v is null then delete from private.config where key = p_key;
  else insert into private.config (key, value) values (p_key, v) on conflict (key) do update set value = excluded.value; end if;
  return coalesce(v, '');
end $$;
revoke execute on function public.admin_set_setting(text, text) from public, anon;
grant execute on function public.admin_set_setting(text, text) to authenticated;

-- ---------- Admins decide each of the 4 checks themselves ----------
alter table public.link_requests add column if not exists checks jsonb not null default '{}'::jsonb;
-- an admin's choice is not "the person updated their details"
create or replace function private.request_touched() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('rwb.admin_check', true), '') = 'on' then return new; end if;
  if (new.full_name, new.phone, new.dob, new.vrn, new.bike, new.blood_group, new.locality, new.hideout, new.emergency_phone, new.alt_phone, new.tnc, new.answers, new.email)
     is distinct from (old.full_name, old.phone, old.dob, old.vrn, old.bike, old.blood_group, old.locality, old.hideout, old.emergency_phone, old.alt_phone, old.tnc, old.answers, old.email)
     and new.status = 'pending' then
    new.updated_at := now();
  end if;
  return new;
end $$;

-- p_check: entry | ronin | vrn | tnc     p_value: ok | no | booked (ronin) | dup (entry) | auto (back to automatic)
create or replace function public.admin_set_request_check(p_id bigint, p_check text, p_value text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r link_requests; c jsonb; who text := private.admin_name();
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from link_requests where id = p_id and status = 'pending';
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
revoke execute on function public.admin_set_request_check(bigint, text, text) from public, anon;
grant execute on function public.admin_set_request_check(bigint, text, text) to authenticated;

notify pgrst, 'reload schema';
