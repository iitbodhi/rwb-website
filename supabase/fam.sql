-- RWB App setup file 45: RWB FAM (up to 3 family members per RWB member) + a note when sharing on Track.
-- * A member shares their FAM invite code (link roninwb.in/fam/?c=RWB-XXXX). Family members sign in with any Google
--   account and enter the code: they join that member's FAM (max 3 per member).
-- * FAM users can only VIEW: their rider's odometer, events (no RSVP / expenses), important announcements, members,
--   leaderboards, the VRN check, and on Track their own rider (plus riders on the same event ride). No sharing, no SOS.
-- * A FAM user can switch off ("disapprove") the link at any time: then they see nothing, and can alert the admins.
-- * Members can remove their FAM; admins see and can remove every FAM user.
-- * Track: an optional short note when sharing ("to Simlipal!").
-- Safe to run more than once.

create table if not exists public.fam_members (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  member_id bigint not null references public.members(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  phone text check (phone is null or phone ~ '^[0-9]{10}$'),
  address text check (address is null or char_length(address) <= 300),
  email text,
  approved boolean not null default true,
  tnc_agreed_at timestamptz,
  alerted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists fam_members_member on public.fam_members (member_id);
create table if not exists public.fam_codes (
  member_id bigint primary key references public.members(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default now()
);
alter table public.fam_members enable row level security;
alter table public.fam_codes enable row level security;

-- this signed-in person is a FAM user who has the link switched on, and their member is still in RWB
create or replace function private.fam_ok() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from fam_members f join members m on m.id = f.member_id
                 where f.user_id = auth.uid() and f.approved and m.status = 'active')
$$;
grant execute on function private.fam_ok() to authenticated;
create or replace function public.is_fam_viewer() returns boolean language sql stable security definer set search_path = public, private as $$ select private.fam_ok() $$;
grant execute on function public.is_fam_viewer() to authenticated;

-- the rider's latest odometer reading (services, fill-ups or a manual update)
create or replace function private.latest_odo(p_user uuid) returns integer language sql stable security definer set search_path = public as $$
  select r.km from (
    select s.odometer_km as km, s.service_date as d, s.created_at as c from service_records s where s.user_id = p_user
    union all select f.odometer_km, f.fill_date, f.created_at from fuel_logs f where f.user_id = p_user
    union all select m.odo_km, m.odo_date, now() from members m where m.user_id = p_user and m.odo_km is not null and m.odo_date is not null
  ) r where r.km > 0 order by r.d desc, r.c desc limit 1
$$;

-- ---------- for members: my FAM ----------
create or replace function public.my_fam() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members; c text; a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  select * into m from members where user_id = auth.uid() and status = 'active';
  if m.id is null then raise exception 'Members only'; end if;
  select code into c from fam_codes where member_id = m.id;
  while c is null loop
    c := 'RWB-' || (select string_agg(substr(a, 1 + floor(random() * length(a))::int, 1), '') from generate_series(1, 4));
    begin insert into fam_codes (member_id, code) values (m.id, c); exception when unique_violation then c := null; end;
  end loop;
  return jsonb_build_object('code', c, 'max', 3,
    'fam', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'full_name', f.full_name, 'phone', f.phone, 'approved', f.approved, 'created_at', f.created_at) order by f.created_at)
                     from fam_members f where f.member_id = m.id), '[]'::jsonb));
end $$;

-- a member removes one of their FAM; admins can remove anyone's
create or replace function public.remove_fam(p_id bigint) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  delete from fam_members f where f.id = p_id
    and (is_admin() or f.member_id = (select id from members where user_id = auth.uid()));
  if not found then raise exception 'Not allowed'; end if;
  return 'removed';
end $$;

-- ---------- joining ----------
-- what the invite page shows (no personal details: the member's first name and the places left)
create or replace function public.fam_invite_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', split_part(coalesce(nullif(m.nickname, ''), m.full_name), ' ', 1),
                            'left', 3 - (select count(*) from fam_members f where f.member_id = m.id))
  from fam_codes c join members m on m.id = c.member_id where c.code = upper(trim(p_code)) and m.status = 'active'
$$;
create or replace function public.fam_join(p_code text, p_name text, p_phone text default null, p_address text default null, p_agree boolean default false) returns text
language plpgsql security definer set search_path = public, private as $$
declare m members; nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'); ph text := nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '');
begin
  if auth.uid() is null then raise exception 'Please sign in with Google first'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'You are already an RWB member'; end if;
  if exists (select 1 from fam_members where user_id = auth.uid()) then return 'joined'; end if;
  if not coalesce(p_agree, false) then raise exception 'Please agree to the RWB Terms & Conditions and Privacy Policy'; end if;
  if char_length(nm) < 2 then raise exception 'Please enter your name'; end if;
  if ph is not null and length(ph) <> 10 then raise exception 'Enter a 10-digit mobile number'; end if;
  select mm.* into m from fam_codes c join members mm on mm.id = c.member_id where c.code = upper(trim(p_code)) and mm.status = 'active';
  if m.id is null then raise exception 'That FAM code isn''t valid. Check it with the RWB member who invited you.'; end if;
  perform 1 from members where id = m.id for update;
  if (select count(*) from fam_members where member_id = m.id) >= 3 then raise exception 'This member''s RWB FAM is full (3 of 3).'; end if;
  insert into fam_members (user_id, member_id, full_name, phone, address, email, tnc_agreed_at)
  values (auth.uid(), m.id, left(nm, 80), ph, left(nullif(trim(p_address), ''), 300), lower(auth.jwt() ->> 'email'), now());
  if m.user_id is not null then
    insert into notifications (kind, title, body, url, audience, target_user, created_by)
    values ('personal', '👨‍👩‍👧 ' || nm || ' joined your RWB FAM', 'They can now see your Track location while you share, your odometer and RWB events. Manage your FAM on Home.', '#home', 'user', m.user_id, auth.uid());
  end if;
  return 'joined';
end $$;

-- ---------- for FAM users ----------
create or replace function public.fam_me() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare f fam_members; m members;
begin
  select * into f from fam_members where user_id = auth.uid();
  if f.id is null then return null; end if;
  select * into m from members where id = f.member_id;
  return jsonb_build_object('id', f.id, 'full_name', f.full_name, 'phone', f.phone, 'address', f.address, 'email', f.email,
    'approved', f.approved, 'created_at', f.created_at, 'active', m.status = 'active',
    'member', case when f.approved and m.status = 'active' then jsonb_build_object('id', m.id, 'full_name', m.full_name, 'nickname', m.nickname,
      'avatar_url', m.avatar_url, 'bike', m.bike, 'odo', private.latest_odo(m.user_id), 'on_app', m.user_id is not null)
      else jsonb_build_object('full_name', m.full_name, 'nickname', m.nickname, 'avatar_url', m.avatar_url) end);
end $$;
create or replace function public.fam_update(p_name text, p_phone text default null, p_address text default null) returns text
language plpgsql security definer set search_path = public as $$
declare nm text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'); ph text := nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10), '');
begin
  if char_length(nm) < 2 then raise exception 'Please enter your name'; end if;
  if ph is not null and length(ph) <> 10 then raise exception 'Enter a 10-digit mobile number'; end if;
  update fam_members set full_name = left(nm, 80), phone = ph, address = left(nullif(trim(p_address), ''), 300) where user_id = auth.uid();
  if not found then raise exception 'FAM only'; end if;
  return 'saved';
end $$;
create or replace function public.fam_set_approved(p_ok boolean) returns text
language plpgsql security definer set search_path = public as $$
begin
  update fam_members set approved = coalesce(p_ok, false) where user_id = auth.uid();
  if not found then raise exception 'FAM only'; end if;
  return case when p_ok then 'approved' else 'disapproved' end;
end $$;
create or replace function public.fam_alert_admins() returns text
language plpgsql security definer set search_path = public as $$
declare f fam_members; m members;
begin
  select * into f from fam_members where user_id = auth.uid();
  if f.id is null then raise exception 'FAM only'; end if;
  if f.alerted_at > now() - interval '1 day' then return 'already'; end if;
  select * into m from members where id = f.member_id;
  update fam_members set alerted_at = now() where id = f.id;
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('admin', '⚠️ FAM consent: ' || f.full_name, f.full_name || coalesce(' (' || f.phone || ')', '') || ' says ' || m.full_name || ' added them to RWB FAM without their consent or knowledge. Check in Admin → Members → FAM.', '#admin/members', 'admins', auth.uid());
  return 'sent';
end $$;

-- ---------- for admins and coordinators: every FAM user ----------
create or replace function public.admin_fam_list() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_moderator() then raise exception 'RWB team only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'full_name', f.full_name, 'phone', f.phone, 'address', f.address, 'email', f.email,
      'approved', f.approved, 'created_at', f.created_at, 'alerted_at', f.alerted_at,
      'member', jsonb_build_object('id', m.id, 'full_name', m.full_name, 'nickname', m.nickname, 'avatar_url', m.avatar_url, 'phone', m.phone, 'status', m.status))
    order by m.full_name, f.created_at) from fam_members f join members m on m.id = f.member_id), '[]'::jsonb);
end $$;

-- ---------- what FAM users may read ----------
drop policy if exists events_read on public.events;
create policy events_read on public.events for select using (is_member() or private.fam_ok());
drop policy if exists notifications_fam on public.notifications;
create policy notifications_fam on public.notifications for select using (audience = 'all' and kind = 'announcement' and private.fam_ok());

-- the member list, leaderboards and VRN check also open for FAM users (same view as a member)
do $$ declare fn text; src text; begin
  foreach fn in array array['member_directory', 'warrior_boards', 'vrn_check', 'odometer_leaderboard'] loop
    select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = fn limit 1;
    if src is not null and src like '%if not is_member() then%' then
      execute replace(src, 'if not is_member() then', 'if not (is_member() or private.fam_ok()) then');
    end if;
  end loop;
end $$;
create or replace function public.gps_board() returns table (member_id bigint, full_name text, nickname text, avatar_url text, bike text, km numeric, rides integer, is_me boolean)
language sql stable security definer set search_path = public, private as $$
  select x.id, x.full_name, x.nickname, x.avatar_url, x.bike, t.km, t.rides, x.user_id = auth.uid()
  from track_stats t join members x on x.id = t.member_id
  where t.km >= 0.1 and x.status = 'active' and x.show_on_leaderboard
    and (exists (select 1 from members me where me.user_id = auth.uid() and me.status = 'active') or private.fam_ok())
  order by t.km desc limit 200
$$;
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if not (is_member() or exists (select 1 from fam_members where user_id = auth.uid())) then raise exception 'Members only'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Invalid subscription'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return 'saved';
end $$;
create or replace function public.save_fcm_token(p_token text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not (exists (select 1 from members where user_id = auth.uid()) or exists (select 1 from fam_members where user_id = auth.uid())) then raise exception 'Members only'; end if;
  if length(coalesce(p_token, '')) < 20 then raise exception 'Bad token'; end if;
  insert into fcm_tokens (token, user_id) values (p_token, auth.uid())
  on conflict (token) do update set user_id = auth.uid(), updated_at = now();
  return 'saved';
end $$;
-- announcements also reach FAM users' phones
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
  union
  select f.user_id from fam_members f join members mm on mm.id = f.member_id
  where n.kind = 'announcement' and n.audience = 'all' and f.approved and mm.status = 'active'
$$;

-- ---------- Track: a short note when sharing, and the FAM view ----------
alter table public.track_live add column if not exists note text check (note is null or char_length(note) <= 60);
drop function if exists public.track_start(double precision, double precision, real, integer, bigint);
create or replace function public.track_start(p_lat double precision, p_lng double precision, p_acc real default null,
  p_hours integer default 4, p_event bigint default null, p_note text default null) returns timestamptz
language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); u timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 4), 1), 12)); was boolean;
        nt text := left(nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), ''), 60);
begin
  if not private.track_ok(p_lat, p_lng) then raise exception 'No GPS location yet'; end if;
  select true into was from track_live where member_id = m.id and until > now();
  insert into track_live (member_id, lat, lng, acc, at, moved_at, since, until, event_id, note)
  values (m.id, p_lat, p_lng, p_acc, now(), now(), now(), u, p_event, nt)
  on conflict (member_id) do update set lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, at = now(), moved_at = now(),
    since = case when track_live.until > now() then track_live.since else now() end, until = u, event_id = excluded.event_id, note = excluded.note;
  if not coalesce(was, false) then
    insert into track_stats (member_id, rides, last_ride) values (m.id, 1, now())
    on conflict (member_id) do update set rides = track_stats.rides + case when track_stats.last_ride > now() - interval '3 hours' then 0 else 1 end,
      last_ride = now(), updated_at = now();
  end if;
  return u;
end $$;
revoke execute on function public.track_start(double precision, double precision, real, integer, bigint, text) from public, anon;
grant execute on function public.track_start(double precision, double precision, real, integer, bigint, text) to authenticated;

create or replace function public.track_view() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare m members; f fam_members; staff boolean := false; lv track_live;
begin
  delete from track_live where until <= now();
  select * into m from members where user_id = auth.uid() and status = 'active';
  if m.id is null then
    -- a FAM user: their own rider, and riders on the same event ride as their rider
    select * into f from fam_members where user_id = auth.uid();
    if f.id is null or not private.fam_ok() then raise exception 'Members only'; end if;
    select * into lv from track_live where member_id = f.member_id;
    return jsonb_build_object(
      'riders', coalesce((select jsonb_agg(jsonb_build_object('id', l.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
          'lat', l.lat, 'lng', l.lng, 'acc', l.acc, 'spd', l.spd, 'hdg', l.hdg, 'at', l.at, 'since', l.since, 'until', l.until,
          'event_id', l.event_id, 'note', l.note, 'me', false, 'mine', l.member_id = f.member_id, 'role', x.role, 'phone', null) order by (l.member_id = f.member_id) desc, x.full_name)
        from track_live l join members x on x.id = l.member_id
        where x.status = 'active' and (l.member_id = f.member_id or (lv.event_id is not null and l.event_id = lv.event_id))), '[]'::jsonb),
      'sos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'member_id', s.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
          'lat', s.lat, 'lng', s.lng, 'acc', s.acc, 'at', s.at, 'me', false, 'phone', null))
        from track_sos s join members x on x.id = s.member_id where s.member_id = f.member_id and s.resolved_at is null and s.at > now() - interval '24 hours'), '[]'::jsonb),
      'staff', false, 'fam', true, 'rider', f.member_id, 'now', now());
  end if;
  staff := m.role in ('coordinator', 'admin', 'superadmin');
  return jsonb_build_object(
    'riders', coalesce((select jsonb_agg(jsonb_build_object('id', l.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
        'lat', l.lat, 'lng', l.lng, 'acc', l.acc, 'spd', l.spd, 'hdg', l.hdg, 'at', l.at, 'since', l.since, 'until', l.until,
        'event_id', l.event_id, 'note', l.note, 'me', l.member_id = m.id, 'role', x.role, 'phone', case when staff then x.phone end) order by x.full_name)
      from track_live l join members x on x.id = l.member_id where x.status = 'active'), '[]'::jsonb),
    'sos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'member_id', s.member_id, 'name', x.full_name, 'nick', x.nickname, 'avatar', x.avatar_url,
        'lat', s.lat, 'lng', s.lng, 'acc', s.acc, 'at', s.at, 'me', s.member_id = m.id, 'phone', case when staff then x.phone end) order by s.at desc)
      from track_sos s join members x on x.id = s.member_id where s.resolved_at is null and s.at > now() - interval '24 hours'), '[]'::jsonb),
    'staff', staff, 'now', now());
end $$;

-- ---------- who may call what ----------
do $$ declare fn text; begin
  foreach fn in array array['my_fam()', 'remove_fam(bigint)', 'fam_join(text, text, text, text, boolean)', 'fam_me()', 'fam_update(text, text, text)',
    'fam_set_approved(boolean)', 'fam_alert_admins()', 'admin_fam_list()', 'gps_board()', 'track_view()', 'save_push_subscription(text, text, text)', 'save_fcm_token(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
revoke execute on function public.fam_invite_info(text) from public;
grant execute on function public.fam_invite_info(text) to anon, authenticated;

notify pgrst, 'reload schema';
