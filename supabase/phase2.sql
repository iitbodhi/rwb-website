-- =====================================================================
-- RWB App, Phase 2: Motomart, announcements and push notifications
-- Run AFTER schema.sql: Supabase > SQL Editor > New query > paste all > Run.
-- Safe to run again.
-- =====================================================================

create extension if not exists pg_net;     -- lets the database call the push sender
create extension if not exists pg_cron;    -- daily birthday notification

-- Private settings (push keys). Not reachable from the app at all.
create schema if not exists private;
revoke all on schema private from public;
create table if not exists private.config (key text primary key, value text not null);
revoke all on private.config from public;

-- Which notifications each member wants (announcements always arrive)
alter table public.members add column if not exists notify jsonb not null
  default '{"birthday": true, "motomart": true, "member": true}';
grant update (notify) on public.members to authenticated;

-- ---------- 1. Motomart listings ----------
create table if not exists public.listings (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_name  text not null check (char_length(product_name) between 2 and 120),
  category      text not null check (char_length(category) <= 60),
  size          text check (char_length(size) <= 60),
  age           text check (char_length(age) <= 60),
  condition     text check (char_length(condition) <= 60),
  reason        text check (char_length(reason) <= 300),
  details       text check (char_length(details) <= 1000),
  price         integer not null check (price between 0 and 10000000),
  seller_name   text not null check (char_length(seller_name) <= 80),
  seller_phone  text not null check (seller_phone ~ '^[0-9]{10}$'),
  photos        text[] not null default '{}' check (cardinality(photos) <= 6),
  status        text not null default 'pending' check (status in ('pending','live','sold','rejected')),
  reject_reason text check (char_length(reject_reason) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  published_at  timestamptz
);
create index if not exists listings_status_idx on public.listings (status, published_at desc);
create index if not exists listings_user_idx on public.listings (user_id);

-- Approval rules, enforced by the database:
--  * every new post starts as "pending" until an admin approves it
--  * sellers can switch their own approved post between live and sold
--  * editing a rejected post sends it back for approval
create or replace function public.listings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare adm boolean := is_admin();
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid(); new.status := 'pending'; new.reject_reason := null;
    new.published_at := null; new.created_at := now(); new.updated_at := now();
    return new;
  end if;
  new.user_id := old.user_id; new.created_at := old.created_at; new.updated_at := now();
  if not adm then
    new.published_at := old.published_at;
    if old.status = 'rejected' or (old.status = 'pending' and new.status = 'pending') then
      new.status := 'pending'; new.reject_reason := null;
    elsif new.status is distinct from old.status
          and not (old.status in ('live','sold') and new.status in ('live','sold')) then
      raise exception 'This post is waiting for admin approval';
    else
      new.reject_reason := old.reject_reason;
    end if;
  end if;
  if new.status = 'live' and old.published_at is null then new.published_at := now(); end if;
  if new.status <> 'rejected' then new.reject_reason := null; end if;
  return new;
end $$;
drop trigger if exists listings_guard on public.listings;
create trigger listings_guard before insert or update on public.listings
  for each row execute function public.listings_guard();

alter table public.listings enable row level security;
revoke all on public.listings from anon;
drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select to authenticated
  using ((status in ('live','sold') and public.is_member()) or user_id = auth.uid() or public.is_admin());
drop policy if exists listings_add on public.listings;
create policy listings_add on public.listings for insert to authenticated
  with check (public.is_member());
drop policy if exists listings_change on public.listings;
create policy listings_change on public.listings for update to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists listings_remove on public.listings;
create policy listings_remove on public.listings for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Photos: public pictures (anyone with the link can view), each seller writes only to their own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('motomart', 'motomart', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists motomart_add on storage.objects;
drop policy if exists motomart_see on storage.objects;
drop policy if exists motomart_remove on storage.objects;
create policy motomart_add on storage.objects for insert to authenticated
  with check (bucket_id = 'motomart' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());
create policy motomart_see on storage.objects for select to authenticated
  using (bucket_id = 'motomart' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy motomart_remove on storage.objects for delete to authenticated
  using (bucket_id = 'motomart' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- For removing a member: their Motomart photos (the app deletes these first)
create or replace function public.admin_listing_photos(p_member_id bigint) returns text[]
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return coalesce((select array_agg(p) from listings l join members m on m.user_id = l.user_id,
                   unnest(l.photos) p where m.id = p_member_id), '{}');
end $$;

-- ---------- 2. Announcements / notification feed ----------
create table if not exists public.notifications (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('announcement','birthday','motomart','member','admin')),
  title       text not null check (char_length(title) <= 120),
  body        text check (char_length(body) <= 1000),
  url         text,
  audience    text not null default 'all' check (audience in ('all','admins')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_time_idx on public.notifications (created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
revoke insert, update on public.notifications from authenticated;
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using ((audience = 'all' and public.is_member()) or public.is_admin());
drop policy if exists notifications_remove on public.notifications;
create policy notifications_remove on public.notifications for delete to authenticated
  using (public.is_admin());

-- Admins post an announcement to everyone
create or replace function public.admin_announce(p_title text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if char_length(trim(coalesce(p_title, ''))) < 2 then raise exception 'Please add a title'; end if;
  insert into notifications (kind, title, body, url, created_by)
  values ('announcement', trim(p_title), nullif(trim(p_body), ''), '#news', auth.uid()) returning id into nid;
  return nid;
end $$;

-- Admins: send a test push to all admins (including yourself) to check notifications work
create or replace function public.admin_test_push() returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  insert into notifications (kind, title, body, url, audience)
  values ('admin', 'Test notification ✅', 'Push notifications are working on this phone.', '#news', 'admins') returning id into nid;
  return nid;
end $$;

-- ---------- 3. Push subscriptions (one per phone/browser) ----------
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Invalid subscription'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  return 'saved';
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns text
language plpgsql security definer set search_path = public as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
  return 'deleted';
end $$;

-- ---------- 4. Sending pushes ----------
-- Every new notification calls the "send-push" Edge Function. If push isn't set up yet, nothing happens.
create or replace function private.send_push() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare u text; s text; k text;
begin
  select value into u from private.config where key = 'push_url';
  select value into s from private.config where key = 'push_secret';
  select value into k from private.config where key = 'anon_key';
  if u is not null and s is not null then
    perform net.http_post(
      url := u,
      body := jsonb_build_object('id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(k, ''), 'x-push-secret', s));
  end if;
  return new;
exception when others then
  return new;   -- a push problem must never block the app
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications
  for each row execute function private.send_push();

-- The push sender asks for the message, the keys and the list of phones. Needs the shared secret.
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
    'payload', jsonb_build_object('title', n.title, 'body', n.body, 'url', coalesce(n.url, '#home'), 'tag', n.kind || '-' || n.id),
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
      from push_subscriptions s join members m on m.user_id = s.user_id
      where (n.audience = 'all' or m.role in ('admin','superadmin'))
        and (n.created_by is null or s.user_id <> n.created_by)
        and (n.kind in ('announcement','admin') or coalesce((m.notify ->> n.kind)::boolean, true))
    ), '[]'::jsonb));
end $$;

create or replace function public.push_gone(p_secret text, p_endpoints text[]) returns integer
language plpgsql security definer set search_path = public, private as $$
declare c integer;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then
    raise exception 'Not allowed';
  end if;
  delete from push_subscriptions where endpoint = any(p_endpoints);
  get diagnostics c = row_count;
  return c;
end $$;

-- ---------- 5. Automatic notifications ----------
-- Motomart: admins hear about new posts to approve; everyone hears when a post goes live
create or replace function private.listing_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (old.status <> 'pending' and new.status = 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'Motomart post waiting for approval',
            new.product_name || ' · ₹' || new.price || ' by ' || new.seller_name, '#admin/motomart', 'admins', new.user_id);
  elsif new.status = 'live' and old.status = 'pending' then
    insert into notifications (kind, title, body, url, created_by)
    values ('motomart', 'New on RWB Motomart', new.product_name || ' · ₹' || to_char(new.price, 'FM99,99,99,999'),
            '#motomart/' || new.id, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists listings_events on public.listings;
create trigger listings_events after insert or update of status on public.listings
  for each row execute function private.listing_events();

-- New member on the app
create or replace function private.member_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and (tg_op = 'INSERT' or old.user_id is null) then
    insert into notifications (kind, title, body, url, created_by)
    values ('member', 'A new Ronin joined the app 🏍️', 'Say hello to ' || new.full_name || '!', '#home', new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists members_events on public.members;
create trigger members_events after insert or update of user_id on public.members
  for each row execute function private.member_events();

-- Someone asked for access
create or replace function private.request_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'New access request', new.full_name || ' wants to join the app', '#admin', 'admins', new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists link_requests_events on public.link_requests;
create trigger link_requests_events after insert or update of status on public.link_requests
  for each row execute function private.request_events();

-- Birthdays: every morning at 8:00 IST
create or replace function public.post_birthdays() returns integer
language plpgsql security definer set search_path = public as $$
declare names text[]; d date := today_ist();
begin
  if exists (select 1 from notifications where kind = 'birthday' and (created_at at time zone 'Asia/Kolkata')::date = d) then
    return 0;
  end if;
  select array_agg(full_name order by full_name) into names from members m where m.dob is not null and (
       (extract(month from m.dob) = extract(month from d) and extract(day from m.dob) = extract(day from d))
    or (extract(month from m.dob) = 2 and extract(day from m.dob) = 29 and extract(month from d) = 2 and extract(day from d) = 28
        and extract(day from (date_trunc('year', d) + interval '2 months' - interval '1 day')) = 28));
  if names is null then return 0; end if;
  insert into notifications (kind, title, body, url)
  values ('birthday', '🎂 Happy Birthday!',
          case when cardinality(names) = 1 then 'Wish ' || names[1] || ' a great ride ahead!'
               else 'Wish ' || array_to_string(names[1:cardinality(names) - 1], ', ') || ' and ' || names[cardinality(names)] || ' a great ride ahead!' end,
          '#home');
  return cardinality(names);
end $$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'rwb-birthdays') then perform cron.unschedule('rwb-birthdays'); end if;
  perform cron.schedule('rwb-birthdays', '30 2 * * *', 'select public.post_birthdays()');
end $$;

-- ---------- 6. Who may call what ----------
do $$ declare f text; begin
  foreach f in array array['admin_listing_photos(bigint)','admin_announce(text,text)','admin_test_push()',
    'save_push_subscription(text,text,text)','delete_push_subscription(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['push_job(bigint,text)','push_gone(text,text[])','post_birthdays()','listings_guard()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.push_job(bigint,text) to service_role';
  execute 'grant execute on function public.push_gone(text,text[]) to service_role';
end $$;
