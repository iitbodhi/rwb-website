-- RWB App setup file 51: Track never goes quiet (like WhatsApp live location). Run after file 50. Safe to run more than once.
-- Every minute the server checks riders who are sharing their location: if a phone hasn't sent a position for 2.5 minutes
-- (the phone froze the app to save battery), the server sends it a high-priority wake-up push. The RWB Android app then
-- sends its position straight away, or restarts sharing if Android stopped it. At most one wake-up every 3 minutes per rider.

alter table public.track_live add column if not exists woke_at timestamptz;

-- for the push sender (send-push Edge Function): the phones to wake up now
create or replace function public.track_wake_job(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r jsonb;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then raise exception 'Not allowed'; end if;
  with due as (
    update track_live set woke_at = now()
    where until > now() and ping_token is not null and at < now() - interval '150 seconds'
      and (woke_at is null or woke_at < now() - interval '3 minutes')
    returning member_id)
  select coalesce(jsonb_agg(f.token), '[]'::jsonb) into r
  from due join members m on m.id = due.member_id join fcm_tokens f on f.user_id = m.user_id;
  return r;
end $$;
revoke execute on function public.track_wake_job(text) from public, anon, authenticated;
grant execute on function public.track_wake_job(text) to service_role;

-- every minute: only calls the push sender when someone's phone has gone quiet
create or replace function private.track_wake() returns void
language plpgsql security definer set search_path = public, private as $$
declare u text; s text; k text;
begin
  if not exists (select 1 from track_live where until > now() and ping_token is not null and at < now() - interval '150 seconds'
                 and (woke_at is null or woke_at < now() - interval '3 minutes')) then return; end if;
  select value into u from private.config where key = 'push_url';
  select value into s from private.config where key = 'push_secret';
  select value into k from private.config where key = 'anon_key';
  if u is not null and s is not null then
    perform net.http_post(url := u, body := jsonb_build_object('track_wake', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(k, ''), 'x-push-secret', s));
  end if;
end $$;
revoke execute on function private.track_wake() from public, anon, authenticated;
do $$ begin perform cron.unschedule('rwb-track-wake'); exception when others then null; end $$;
do $$ begin perform cron.schedule('rwb-track-wake', '* * * * *', 'select private.track_wake()');
exception when others then raise notice 'pg_cron not available: wake-ups will not run'; end $$;

notify pgrst, 'reload schema';
