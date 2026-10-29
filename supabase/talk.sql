-- RWB App setup file 50: Talk, a walkie-talkie for event rides. Run after file 49. Safe to run more than once
-- (also over an earlier version of this file).
-- * Members who RSVP "Going" for an event ride hold the Talk button on the Track map and speak (up to 3 minutes);
--   on release it goes to everyone going on that ride. Talk is on for the ride from 6 hours before it starts until
--   6 hours after it ends. Everyone going receives every message (no switch), and it plays out loud straight away
--   (the RWB Android app plays it even with the screen off; iPhone / browser while the app is open).
-- * A member can also send a voice message to one of their RWB FAM, from their FAM list.
-- * Admins: every message in Admin → Talk (replay, delete, reported ones), mute / unmute any member.
-- * Messages are deleted after 7 days (files too). At most 30 messages an hour per member.

-- ---------- storage: one private folder per sender ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('talk', 'talk', false, 3145728, array['audio/webm','audio/mp4','audio/ogg','audio/aac','audio/mpeg','audio/x-m4a','audio/wav'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------- tables (only read and written through the functions below) ----------
create table if not exists public.talk_messages (
  id bigint generated always as identity primary key,
  sender_id bigint not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('event','rider','fam')),
  event_id bigint references public.events(id) on delete set null,
  to_member bigint references public.members(id) on delete set null,
  path text not null, url text not null,
  secs smallint not null check (secs between 1 and 185),
  created_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by text,
  reported_at timestamptz, reported_by text, report_note text
);
create index if not exists talk_messages_time on public.talk_messages (created_at desc);
create index if not exists talk_messages_sender on public.talk_messages (sender_id, created_at desc);
create table if not exists public.talk_recipients (
  msg_id bigint not null references public.talk_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  aloud boolean not null default false,          -- played out loud on arrival (they were sharing live, or FAM)
  heard_at timestamptz,
  primary key (msg_id, user_id)
);
create index if not exists talk_recipients_user on public.talk_recipients (user_id, msg_id desc);
create table if not exists public.talk_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  receive boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.talk_muted (
  member_id bigint primary key references public.members(id) on delete cascade,
  by_name text, at timestamptz not null default now()
);
alter table public.talk_messages enable row level security;
alter table public.talk_recipients enable row level security;
alter table public.talk_settings enable row level security;
alter table public.talk_muted enable row level security;

-- ---------- helpers ----------
create or replace function private.talk_is_muted(p_uid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from talk_muted t join members m on m.id = t.member_id where m.user_id = p_uid)
$$;
-- an event "on" for Talk: from 6 hours before it starts until 6 hours after it ends (like Ride live on the event)
create or replace function private.talk_event_live(e public.events) returns boolean language sql stable as $$
  select e.status = 'live' and now() between e.starts_at - interval '6 hours' and coalesce(e.ends_at, e.starts_at + interval '6 hours') + interval '6 hours'
$$;
create or replace function private.talk_sharing(p_member bigint) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from track_live where member_id = p_member and until > now())
$$;
-- Talk is always on while someone shares their location for an event ride they are going to
create or replace function private.talk_forced(p_uid uuid) returns boolean language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from members m join track_live l on l.member_id = m.id
    where m.user_id = p_uid and m.status = 'active' and l.until > now()
      and (l.event_id is not null or exists (select 1 from event_rsvps r join events e on e.id = r.event_id
            where r.user_id = p_uid and r.status = 'going' and private.talk_event_live(e))))
$$;
-- everyone going on a ride receives Talk (there is no off switch)
create or replace function private.talk_on(p_uid uuid) returns boolean language sql stable as $$ select true $$;
create or replace function private.talk_who() returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nickname, full_name) from members where user_id = auth.uid()), (select full_name from fam_members where user_id = auth.uid()), 'Someone')
$$;

-- ---------- for the sender: the rides I can talk on right now, and my FAM ----------
drop function if exists public.talk_targets();
create or replace function public.talk_targets() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me();
begin
  return jsonb_build_object(
    'muted', exists (select 1 from talk_muted where member_id = m.id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at,
        'riders', (select count(*) from event_rsvps r2 join members x on x.user_id = r2.user_id
                   where r2.event_id = e.id and r2.status = 'going' and x.status = 'active' and x.id <> m.id)) order by e.starts_at)
      from event_rsvps r join events e on e.id = r.event_id
      where r.user_id = auth.uid() and r.status = 'going' and private.talk_event_live(e)), '[]'::jsonb),
    'fam', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.full_name) order by f.created_at)
      from fam_members f where f.member_id = m.id and f.approved), '[]'::jsonb));
end $$;

-- ---------- send (after the app uploaded the recording to the talk bucket) ----------
-- p_kind 'event' (p_target = the event: everyone going on it) or 'fam' (p_target = one of my FAM)
create or replace function public.talk_send(p_kind text, p_target bigint, p_path text, p_url text, p_secs integer) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); e events; f fam_members; mid bigint; n integer; u text; s text; k text;
begin
  if exists (select 1 from talk_muted where member_id = m.id) then raise exception 'You have been muted by the admins'; end if;
  if (select count(*) from talk_messages where sender_id = m.id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'That''s a lot of messages. Please wait a little before sending more';
  end if;
  if p_secs is null or p_secs < 1 or p_secs > 185 then raise exception 'A voice message can be up to 3 minutes'; end if;
  if p_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]{8,64}\.(webm|m4a|mp4|ogg|aac)$') then raise exception 'Bad recording'; end if;
  if position('/storage/v1/object/sign/talk/' || p_path in coalesce(p_url, '')) = 0 then raise exception 'Bad recording link'; end if;

  create temp table if not exists _talk_to (user_id uuid primary key) on commit drop;
  truncate _talk_to;
  if p_kind = 'event' then
    select * into e from events where id = p_target;
    if e.id is null or not private.talk_event_live(e) then raise exception 'Talk is on for a ride from 6 hours before it starts until 6 hours after it ends'; end if;
    if not exists (select 1 from event_rsvps where event_id = e.id and user_id = auth.uid() and status = 'going') then
      raise exception 'RSVP Going for this ride to use Talk';
    end if;
    insert into _talk_to select x.user_id from event_rsvps r join members x on x.user_id = r.user_id
      where r.event_id = e.id and r.status = 'going' and x.status = 'active' and x.id <> m.id;
    if not found then raise exception 'Nobody else is going on this ride yet'; end if;
  elsif p_kind = 'fam' then
    select * into f from fam_members where id = p_target and member_id = m.id;
    if f.id is null then raise exception 'Family member not found'; end if;
    if not f.approved then raise exception '% has RWB FAM switched off', f.full_name; end if;
    insert into _talk_to values (f.user_id);
  else
    raise exception 'Talk is for event rides and your FAM';
  end if;
  select count(*) into n from _talk_to;

  insert into talk_messages (sender_id, kind, event_id, to_member, path, url, secs)
  values (m.id, p_kind, case when p_kind = 'event' then e.id end, null, p_path, p_url, p_secs)
  returning id into mid;
  insert into talk_recipients (msg_id, user_id, aloud) select mid, user_id, true from _talk_to;

  -- phones get it straight away (the push sender has the Android app play it)
  begin
    select value into u from private.config where key = 'push_url';
    select value into s from private.config where key = 'push_secret';
    select value into k from private.config where key = 'anon_key';
    if u is not null and s is not null then
      perform net.http_post(url := u, body := jsonb_build_object('talk', mid),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(k, ''), 'x-push-secret', s));
    end if;
  exception when others then null;
  end;
  return jsonb_build_object('id', mid, 'to', n, 'live', n);
end $$;

-- ---------- receiving ----------
-- my messages (newer than p_after), how many I haven't played, and my Talk settings
create or replace function public.talk_inbox(p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members; isfam boolean;
begin
  select * into m from members where user_id = auth.uid() and status = 'active';
  isfam := m.id is null;
  if isfam and not private.fam_ok() then raise exception 'Members only'; end if;
  return jsonb_build_object(
    'muted', not isfam and exists (select 1 from talk_muted where member_id = m.id),
    'receive', private.talk_on(auth.uid()), 'forced', private.talk_forced(auth.uid()), 'fam', isfam,
    'unheard', (select count(*) from talk_recipients r join talk_messages t on t.id = r.msg_id
                where r.user_id = auth.uid() and r.heard_at is null and t.deleted_at is null and t.created_at > now() - interval '7 days'),
    'items', coalesce((select jsonb_agg(x order by i desc) from (
        select t.id as i, jsonb_build_object('id', t.id, 'kind', t.kind, 'secs', t.secs, 'url', t.url, 'at', t.created_at,
          'heard', r.heard_at is not null, 'aloud', r.aloud, 'mine', false,
          'from', jsonb_build_object('id', s.id, 'name', s.full_name, 'nick', s.nickname, 'avatar', s.avatar_url),
          'event', (select title from events where id = t.event_id)) x
        from talk_recipients r join talk_messages t on t.id = r.msg_id join members s on s.id = t.sender_id
        where r.user_id = auth.uid() and t.id > coalesce(p_after, 0) and t.deleted_at is null and t.created_at > now() - interval '7 days'
        union all
        select t.id, jsonb_build_object('id', t.id, 'kind', t.kind, 'secs', t.secs, 'url', t.url, 'at', t.created_at,
          'heard', true, 'mine', true, 'to', (select count(*) from talk_recipients where msg_id = t.id),
          'to_name', case t.kind when 'fam' then coalesce((select f.full_name from talk_recipients r join fam_members f on f.user_id = r.user_id where r.msg_id = t.id limit 1), 'your FAM') when 'event' then (select title from events where id = t.event_id)
                       else (select coalesce(nickname, full_name) from members where id = t.to_member) end,
          'event', (select title from events where id = t.event_id))
        from talk_messages t where t.sender_id = m.id and t.id > coalesce(p_after, 0) and t.deleted_at is null and t.created_at > now() - interval '7 days'
        order by 1 desc limit 60) q), '[]'::jsonb));
end $$;

create or replace function public.talk_heard(p_id bigint) returns void
language sql security definer set search_path = public as $$
  update talk_recipients set heard_at = coalesce(heard_at, now()) where msg_id = p_id and user_id = auth.uid()
$$;

create or replace function public.talk_set_receive(p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not (exists (select 1 from members where user_id = auth.uid() and status = 'active') or private.fam_ok()) then raise exception 'Members only'; end if;
  insert into talk_settings (user_id, receive) values (auth.uid(), coalesce(p_on, true))
  on conflict (user_id) do update set receive = excluded.receive, updated_at = now();
  return jsonb_build_object('receive', private.talk_on(auth.uid()), 'forced', private.talk_forced(auth.uid()));
end $$;

-- a receiver reports a message (misuse, abusive language): the admins get a notification
create or replace function public.talk_report(p_id bigint, p_note text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare t talk_messages; who text := private.talk_who(); sname text;
begin
  select * into t from talk_messages where id = p_id and deleted_at is null;
  if t.id is null or not exists (select 1 from talk_recipients where msg_id = p_id and user_id = auth.uid()) then raise exception 'Message not found'; end if;
  if t.reported_at is null then
    update talk_messages set reported_at = now(), reported_by = who, report_note = left(nullif(trim(coalesce(p_note, '')), ''), 200) where id = p_id;
    select full_name into sname from members where id = t.sender_id;
    insert into notifications (kind, title, body, url, audience)
    values ('admin', '🎙️ Voice message reported', left(who || ' reported a Talk message from ' || coalesce(sname, 'a member') || coalesce(': ' || nullif(trim(coalesce(p_note, '')), ''), ''), 1000), '#admin/talk', 'admins');
  end if;
  return 'reported';
end $$;

-- the sender (unsend) or an admin removes a message for everyone
create or replace function public.talk_delete(p_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  update talk_messages set deleted_at = now(), deleted_by = private.talk_who()
  where id = p_id and deleted_at is null
    and (is_admin() or sender_id = (select id from members where user_id = auth.uid()));
  if not found then raise exception 'Message not found'; end if;
  return 'deleted';
end $$;

-- ---------- admins ----------
create or replace function public.admin_talk_log() returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'secs', t.secs, 'url', t.url, 'at', t.created_at,
        'from', jsonb_build_object('id', s.id, 'name', s.full_name, 'nick', s.nickname, 'avatar', s.avatar_url),
        'muted', exists (select 1 from talk_muted where member_id = s.id),
        'to_name', case t.kind when 'fam' then coalesce((select f.full_name || ' (FAM)' from talk_recipients r join fam_members f on f.user_id = r.user_id where r.msg_id = t.id limit 1), 'FAM') when 'event' then (select title from events where id = t.event_id)
                     else (select full_name from members where id = t.to_member) end,
        'to', (select count(*) from talk_recipients where msg_id = t.id), 'heard', (select count(*) from talk_recipients where msg_id = t.id and heard_at is not null),
        'reported', t.reported_at is not null, 'reported_by', t.reported_by, 'report_note', t.report_note) order by t.id desc)
      from (select * from talk_messages where deleted_at is null and created_at > now() - interval '7 days' order by id desc limit 200) t
      join members s on s.id = t.sender_id), '[]'::jsonb),
    'muted', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'by', tm.by_name, 'at', tm.at) order by tm.at desc)
      from talk_muted tm join members x on x.id = tm.member_id), '[]'::jsonb));
end $$;

create or replace function public.admin_talk_mute(p_member bigint, p_mute boolean) returns text
language plpgsql security definer set search_path = public, private as $$
declare x members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into x from members where id = p_member;
  if x.id is null then raise exception 'Member not found'; end if;
  if p_mute then
    if x.user_id = auth.uid() then raise exception 'You cannot mute yourself'; end if;
    if x.role = 'superadmin' then raise exception 'The super admin cannot be muted'; end if;
    insert into talk_muted (member_id, by_name) values (x.id, private.talk_who()) on conflict (member_id) do nothing;
    return 'muted';
  end if;
  delete from talk_muted where member_id = x.id;
  return 'unmuted';
end $$;

-- ---------- for the push sender (send-push Edge Function) ----------
create or replace function public.talk_push_job(p_id bigint, p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t talk_messages; s members;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then raise exception 'Not allowed'; end if;
  select * into t from talk_messages where id = p_id and deleted_at is null and created_at > now() - interval '15 minutes';
  if t.id is null then return null; end if;
  select * into s from members where id = t.sender_id;
  return jsonb_build_object('id', t.id, 'url', t.url, 'secs', t.secs, 'at', t.created_at,
    'from', coalesce(s.nickname, s.full_name), 'avatar', s.avatar_url,
    'to', case t.kind when 'fam' then 'you' when 'event' then (select title from events where id = t.event_id) else 'you' end,
    'recipients', coalesce((select jsonb_agg(jsonb_build_object('aloud', r.aloud,
        'fcm', coalesce((select jsonb_agg(f.token) from fcm_tokens f where f.user_id = r.user_id), '[]'::jsonb),
        'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'keys', jsonb_build_object('p256dh', p.p256dh, 'auth', p.auth)))
                 from push_subscriptions p where p.user_id = r.user_id), '[]'::jsonb)))
      from talk_recipients r where r.msg_id = t.id), '[]'::jsonb),
    'subject', (select value from private.config where key = 'vapid_subject'),
    'vapid_public', (select value from private.config where key = 'vapid_public'),
    'vapid_private', (select value from private.config where key = 'vapid_private'));
end $$;

-- ---------- 7 days, then gone (the push sender deletes the files every hour) ----------
create or replace function public.talk_expired(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'path', path)) from (
    select id, path from talk_messages where created_at < now() - interval '7 days' or deleted_at < now() - interval '10 minutes' order by id limit 500) q), '[]'::jsonb);
end $$;
create or replace function public.talk_purge(p_secret text, p_ids bigint[]) returns integer
language plpgsql security definer set search_path = public, private as $$
declare n integer;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then raise exception 'Not allowed'; end if;
  delete from talk_messages where id = any(p_ids) and (created_at < now() - interval '7 days' or deleted_at is not null);
  get diagnostics n = row_count; return n;
end $$;
create or replace function private.talk_cleanup() returns void
language plpgsql security definer set search_path = public, private as $$
declare u text; s text; k text;
begin
  select value into u from private.config where key = 'push_url';
  select value into s from private.config where key = 'push_secret';
  select value into k from private.config where key = 'anon_key';
  if u is not null and s is not null then
    perform net.http_post(url := u, body := jsonb_build_object('talk_cleanup', true),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(k, ''), 'x-push-secret', s));
  end if;
end $$;
do $$ begin
  perform cron.unschedule('rwb-talk-cleanup');
exception when others then null;
end $$;
do $$ begin
  perform cron.schedule('rwb-talk-cleanup', '17 * * * *', 'select private.talk_cleanup()');
exception when others then raise notice 'pg_cron not available: old Talk messages will not be deleted automatically';
end $$;

-- ---------- storage rules: upload to your own folder (members, not muted); read your own files to make the link ----------
drop policy if exists talk_add on storage.objects;
drop policy if exists talk_own_read on storage.objects;
drop policy if exists talk_own_delete on storage.objects;
create policy talk_add on storage.objects for insert to authenticated
  with check (bucket_id = 'talk' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member() and not private.talk_is_muted(auth.uid()));
create policy talk_own_read on storage.objects for select to authenticated
  using (bucket_id = 'talk' and (storage.foldername(name))[1] = auth.uid()::text);
create policy talk_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'talk' and (storage.foldername(name))[1] = auth.uid()::text);
grant execute on function private.talk_is_muted(uuid) to authenticated;

-- ---------- who may call what ----------
do $$ declare fn text; begin
  foreach fn in array array['talk_targets()', 'talk_send(text, bigint, text, text, integer)', 'talk_inbox(bigint)', 'talk_heard(bigint)',
    'talk_set_receive(boolean)', 'talk_report(bigint, text)', 'talk_delete(bigint)', 'admin_talk_log()', 'admin_talk_mute(bigint, boolean)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array['talk_push_job(bigint, text)', 'talk_expired(text)', 'talk_purge(text, bigint[])'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;
revoke execute on function private.talk_cleanup() from public, anon, authenticated;

notify pgrst, 'reload schema';
