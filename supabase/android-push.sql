-- RWB App setup file 44: notifications for the RWB Android app (Firebase Cloud Messaging), run after file 43.
-- * Phones using the Android app register an FCM token; notifications go to them through Firebase (free).
-- * Phones using the browser / iPhone keep getting web push as before.
-- * SOS alerts go out as urgent on the "SOS alerts" channel (the 10-second siren).
-- Safe to run more than once.

create table if not exists public.fcm_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index if not exists fcm_tokens_user on public.fcm_tokens (user_id);
alter table public.fcm_tokens enable row level security;

create or replace function public.save_fcm_token(p_token text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from members where user_id = auth.uid()) then raise exception 'Members only'; end if;
  if length(coalesce(p_token, '')) < 20 then raise exception 'Bad token'; end if;
  insert into fcm_tokens (token, user_id) values (p_token, auth.uid())
  on conflict (token) do update set user_id = auth.uid(), updated_at = now();
  return 'saved';
end $$;
create or replace function public.delete_fcm_token(p_token text) returns text
language sql security definer set search_path = public as $$
  delete from fcm_tokens where token = p_token and user_id = auth.uid(); select 'deleted'::text
$$;
revoke execute on function public.save_fcm_token(text) from public, anon;
revoke execute on function public.delete_fcm_token(text) from public, anon;
grant execute on function public.save_fcm_token(text) to authenticated;
grant execute on function public.delete_fcm_token(text) to authenticated;

-- who gets a notification (same rules for web push and the Android app)
create or replace function private.push_audience(n public.notifications) returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select m.user_id from members m
  where m.user_id is not null and m.status = 'active'
    and (n.audience = 'all'
         or (n.audience = 'admins' and m.role in ('admin','superadmin'))
         or (n.audience = 'moderators' and m.role in ('coordinator','admin','superadmin'))
         or (n.audience = 'going' and exists (select 1 from event_rsvps r where r.event_id = n.event_id and r.user_id = m.user_id and r.status in ('going','maybe')))
         or (n.audience = 'user' and m.user_id = n.target_user))
    and (n.created_by is null or m.user_id <> n.created_by)
    and (n.kind in ('announcement','admin','event','personal','sos') or coalesce((m.notify ->> n.kind)::boolean, true))
$$;

create or replace function public.push_job(p_id bigint, p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n notifications;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then
    raise exception 'Not allowed';
  end if;
  select * into n from notifications where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'subject',      (select value from private.config where key = 'vapid_subject'),
    'vapid_public', (select value from private.config where key = 'vapid_public'),
    'vapid_private',(select value from private.config where key = 'vapid_private'),
    'payload', jsonb_build_object('title', n.title, 'body', n.body, 'url', coalesce(n.url, '#home'), 'tag', n.kind || '-' || n.id,
                                  'sos', n.kind = 'sos' and n.title like '🆘%'),
    'urgent', n.kind = 'sos',
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
      from push_subscriptions s where s.user_id in (select a.user_id from private.push_audience(n) a)), '[]'::jsonb),
    'fcm', coalesce((select jsonb_agg(t.token) from fcm_tokens t where t.user_id in (select a.user_id from private.push_audience(n) a)), '[]'::jsonb));
end $$;
revoke execute on function public.push_job(bigint, text) from public, anon, authenticated;
grant execute on function public.push_job(bigint, text) to service_role;

-- tokens Firebase says are no longer valid (app removed)
create or replace function public.fcm_gone(p_secret text, p_tokens text[]) returns integer
language plpgsql security definer set search_path = public, private as $$
declare k integer;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then raise exception 'Not allowed'; end if;
  delete from fcm_tokens where token = any(p_tokens); get diagnostics k = row_count; return k;
end $$;
revoke execute on function public.fcm_gone(text, text[]) from public, anon, authenticated;
grant execute on function public.fcm_gone(text, text[]) to service_role;

notify pgrst, 'reload schema';
