-- =====================================================================
-- RWB App: live approval cards + the RWB WhatsApp group link
--   • An entry shows "Updated" when the person changes their details while it waits (app, form or sheet)
--   • Admins can save the RWB WhatsApp group's invite link, so members can welcome new Ronins in the group in one tap
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

notify pgrst, 'reload schema';
