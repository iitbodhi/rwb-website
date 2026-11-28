-- 102: the RWB WhatsApp group invite link is for admins only (Bodhi, Nov 28 2026, security).
-- Members used to receive it in app_settings(). Now non-admins get wa_group_link = null
-- (a key with null, not {}, so the app's offline copy on their phone is overwritten too).
create or replace function public.app_settings() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when public.is_member() then jsonb_build_object('wa_group_link',
    case when public.is_admin() then (select value from private.config where key = 'wa_group_link') end)
  else '{}'::jsonb end
$$;
revoke execute on function public.app_settings() from public, anon;
grant execute on function public.app_settings() to authenticated;
notify pgrst, 'reload schema';
