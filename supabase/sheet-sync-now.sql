-- 58 · "Sync sheet now" button for admins in the app. Run once in Supabase → SQL Editor. Safe to run more than once.
-- The app asks the member sheet to run its full check (the one that now runs every 12 hours), and the sheet reports
-- back when it's done, so the app can show the result.

-- admins: start a sync (at most once every 2 minutes; each one downloads every member)
create or replace function public.admin_sheet_sync() returns text
language plpgsql security definer set search_path = public, private as $$
declare last timestamptz;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select value::timestamptz into last from private.config where key = 'sheet_sync_requested';
  if last is not null and last > now() - interval '2 minutes' then raise exception 'A sync was started less than 2 minutes ago. Please wait for it to finish.'; end if;
  if not exists (select 1 from private.config where key = 'sheet_webhook_url' and value like 'https://%') then
    raise exception 'The member sheet isn''t connected (no web app address). Set it up from the sheet: RWB → Connect to the app.';
  end if;
  insert into private.config (key, value) values ('sheet_sync_requested', now()::text)
    on conflict (key) do update set value = excluded.value;
  perform private.sheet_post(jsonb_build_object('action', 'sync'));
  return 'started';
end $$;

-- the sheet: report how the sync went
create or replace function public.sheet_sync_done(p_secret text, p_summary text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.sheet_ok(p_secret);
  insert into private.config (key, value) values ('sheet_last_sync', jsonb_build_object('at', now(), 'summary', left(coalesce(p_summary, ''), 4000))::text)
    on conflict (key) do update set value = excluded.value;
  return 'ok';
end $$;

-- admins: when the last sync was asked for and finished, and what it did
create or replace function public.admin_sheet_sync_status() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'requested', (select value from private.config where key = 'sheet_sync_requested'),
    'last', (select value::jsonb from private.config where key = 'sheet_last_sync'));
end $$;

revoke execute on function public.admin_sheet_sync() from public, anon;
grant execute on function public.admin_sheet_sync() to authenticated;
revoke execute on function public.admin_sheet_sync_status() from public, anon;
grant execute on function public.admin_sheet_sync_status() to authenticated;
revoke execute on function public.sheet_sync_done(text, text) from public;
grant execute on function public.sheet_sync_done(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
