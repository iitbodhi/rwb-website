-- RWB App setup file 48: "Stop sharing" straight from the Track notification on Android (like WhatsApp live location).
-- The notification has a Stop button; it uses the private sharing key (setup file 46), so it works even when the app is closed.
-- Safe to run more than once.

create or replace function public.track_stop_key(p_key text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if length(coalesce(p_key, '')) < 40 then return 'stopped'; end if;
  delete from track_live where ping_token = p_key;
  return 'stopped';
end $$;
revoke execute on function public.track_stop_key(text) from public;
grant execute on function public.track_stop_key(text) to anon, authenticated;

notify pgrst, 'reload schema';
