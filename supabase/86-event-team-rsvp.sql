-- 86: the RWB team manages who's going to an event, and members hear when someone joins (Nov 2026)
-- * admins and coordinators can add anyone to an event (Going / Maybe / Can't go, +1 guest) or take them off,
--   also for members who aren't on the app yet (public.event_added) and also after the event (to fix who actually went)
-- * event_rsvps.set_by = the team member who set that answer (null = the rider answered themselves);
--   the rider answering again clears it
-- * a member who isn't on the app and was added keeps that place: when they sign in, it becomes their own RSVP
-- * the rider gets a personal note when the team adds / moves / removes them (upcoming events only)
-- * new notification kind 'rsvp' ("Riders joining events" switch in Me → Notifications): "🏍️ <nick> is going to <event>".
--   Joins within 30 minutes of the last note for that event are merged into it (the list updates, no second buzz);
--   at most 20 an hour RWB-wide; removed after 3 days; never for past or cancelled events; errors never block an RSVP
-- Safe to run twice.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('announcement','birthday','motomart','member','admin','event','personal','sos','reminder','track','rsvp'));

alter table public.event_rsvps add column if not exists set_by uuid references auth.users(id) on delete set null;

-- members who aren't on the app yet, added by the team
create table if not exists public.event_added (
  event_id   bigint not null references public.events(id) on delete cascade,
  member_id  bigint not null references public.members(id) on delete cascade,
  status     text   not null check (status in ('going','maybe')),
  guests     int    not null default 0 check (guests between 0 and 1),
  set_by     uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index if not exists event_added_member on public.event_added (member_id);
create index if not exists event_added_set_by on public.event_added (set_by);
create index if not exists event_rsvps_set_by on public.event_rsvps (set_by);
alter table public.event_added enable row level security;   -- no policies: only the functions below touch it
revoke all on public.event_added from anon, authenticated;

-- the rider's own answer clears "added by the team"
create or replace function private.rsvp_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  select * into e from events where id = new.event_id;
  if e.status <> 'live' then raise exception 'This event was cancelled'; end if;
  if not e.allow_guests or new.status <> 'going' then new.guests := 0; end if;
  if new.user_id = (select auth.uid()) then new.set_by := null; end if;
  if tg_op = 'UPDATE' and new.set_by is distinct from old.set_by and new.set_by is not null and not public.is_moderator() then new.set_by := old.set_by; end if;
  new.updated_at := now();
  return new;
end $$;

-- who's coming: app riders + members added by the team
drop function if exists public.event_people(bigint);
create function public.event_people(p_event bigint)
returns table(user_id uuid, member_id bigint, full_name text, nickname text, avatar_url text, status text, guests integer,
              updated_at timestamptz, set_by_name text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
declare mod boolean := public.is_moderator();
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select x.user_id, x.member_id, x.full_name, x.nickname, x.avatar_url, x.status, x.guests, x.updated_at,
           case when x.set_by is null then null
                when mod then coalesce((select coalesce(nullif(trim(t.nickname), ''), split_part(t.full_name, ' ', 1)) from members t where t.user_id = x.set_by limit 1), 'RWB team')
                else 'RWB team' end,
           x.on_app
    from (
      select r.user_id, m.id member_id, m.full_name, m.nickname, m.avatar_url, r.status, r.guests, r.updated_at, r.set_by, true on_app
      from event_rsvps r join members m on m.user_id = r.user_id
      where r.event_id = p_event
      union all
      select null::uuid, m.id, m.full_name, m.nickname, m.avatar_url, a.status, a.guests, a.updated_at, a.set_by, false
      from event_added a join members m on m.id = a.member_id
      where a.event_id = p_event
    ) x order by x.updated_at;
end $$;

create or replace function public.event_counts()
returns table(event_id bigint, going integer, maybe integer, guests integer, faces jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    with x as (
      select r.event_id, r.status, r.guests, r.updated_at, m.full_name, m.avatar_url
      from event_rsvps r join members m on m.user_id = r.user_id
      union all
      select a.event_id, a.status, a.guests, a.updated_at, m.full_name, m.avatar_url
      from event_added a join members m on m.id = a.member_id
    )
    select x.event_id,
           (count(*) filter (where x.status = 'going'))::int,
           (count(*) filter (where x.status = 'maybe'))::int,
           coalesce(sum(x.guests) filter (where x.status = 'going'), 0)::int,
           coalesce((select jsonb_agg(jsonb_build_object('full_name', f.full_name, 'avatar_url', f.avatar_url))
                     from (select y.full_name, y.avatar_url from x y where y.event_id = x.event_id and y.status = 'going'
                           order by y.updated_at limit 4) f), '[]'::jsonb)
    from x group by x.event_id;
end $$;

-- team: find members to add (name, nickname, bike number or the last digits of the phone); 20 at a time
create or replace function public.event_find_members(p_event bigint, p_q text)
returns table(member_id bigint, full_name text, nickname text, avatar_url text, vrn text, on_app boolean, status text)
language plpgsql stable security definer set search_path = public as $$
declare q text := trim(coalesce(p_q, '')); d text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g'); v text := upper(regexp_replace(coalesce(p_q, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_moderator() then raise exception 'Only the RWB team can do this'; end if;
  if length(q) < 2 then return; end if;
  return query
    select m.id, m.full_name, m.nickname, m.avatar_url, m.vrn, m.user_id is not null,
           coalesce((select r.status from event_rsvps r where r.event_id = p_event and r.user_id = m.user_id),
                    (select a.status from event_added a where a.event_id = p_event and a.member_id = m.id))
    from members m
    where m.status = 'active'
      and (m.full_name ilike '%' || q || '%' or m.nickname ilike '%' || q || '%'
           or (length(v) >= 3 and upper(regexp_replace(coalesce(m.vrn, ''), '[^A-Za-z0-9]', '', 'g')) like '%' || v || '%')
           or (length(d) >= 4 and regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') like '%' || d))
    order by (m.nickname ilike q || '%' or m.full_name ilike q || '%') desc, m.full_name
    limit 20;
end $$;

-- team: set someone's answer (p_status 'going' | 'maybe' | 'no', or null to take them off the list)
create or replace function public.event_team_set(p_event bigint, p_member bigint, p_status text, p_guests int default 0)
returns text language plpgsql security definer set search_path = public, private as $$
declare me uuid := (select auth.uid()); e events; m members; was text; g int := least(greatest(coalesce(p_guests, 0), 0), 1);
        upcoming boolean; msg text;
begin
  if not public.is_moderator() then raise exception 'Only the RWB team can do this'; end if;
  if p_status is not null and p_status not in ('going','maybe','no') then raise exception 'Pick Going, Maybe or Can''t go'; end if;
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'That event is no longer available'; end if;
  if e.status <> 'live' then raise exception 'This event was cancelled'; end if;
  select * into m from members where id = p_member;
  if m.id is null or m.status <> 'active' then raise exception 'That member was not found'; end if;
  if not e.allow_guests or p_status is distinct from 'going' then g := 0; end if;
  upcoming := coalesce(e.ends_at, e.starts_at + interval '12 hours') > now();

  if m.user_id is not null then
    delete from event_added where event_id = p_event and member_id = p_member;   -- an old place from before they joined the app
    select status into was from event_rsvps where event_id = p_event and user_id = m.user_id;
    if p_status is null then
      delete from event_rsvps where event_id = p_event and user_id = m.user_id;
    else
      insert into event_rsvps (event_id, user_id, status, guests, set_by)
      values (p_event, m.user_id, p_status, g, case when m.user_id = me then null else me end)
      on conflict (event_id, user_id) do update set status = excluded.status, guests = excluded.guests, set_by = excluded.set_by;
    end if;
    -- tell the rider (not for past events, not when nothing changed, not when it's yourself)
    if upcoming and m.user_id <> me and was is distinct from p_status then
      msg := case p_status when 'going' then 'The RWB team added you to the Going list.'
                           when 'maybe' then 'The RWB team marked you as Maybe.'
                           when 'no' then 'The RWB team marked you as Can''t go.'
                           else 'The RWB team took you off the list.' end;
      begin
        insert into notifications (kind, title, body, url, audience, target_user, created_by, event_id)
        values ('personal', left('📅 ' || e.title, 120), msg || ' Tap to check or change it.', '#events/' || e.id, 'user', m.user_id, me, e.id);
      exception when others then null;
      end;
    end if;
  else
    if p_status is null or p_status = 'no' then
      delete from event_added where event_id = p_event and member_id = p_member;
    else
      insert into event_added (event_id, member_id, status, guests, set_by, updated_at)
      values (p_event, p_member, p_status, g, me, now())
      on conflict (event_id, member_id) do update set status = excluded.status, guests = excluded.guests, set_by = excluded.set_by, updated_at = now();
    end if;
  end if;
  return coalesce(p_status, 'removed');
end $$;

-- a member added by the team signs in to the app: the place becomes their own RSVP
create or replace function private.event_added_claim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and old.user_id is null then
    begin
      perform set_config('rwb.rsvp_quiet', 'on', true);   -- no "is going" note for places they already had
      insert into event_rsvps (event_id, user_id, status, guests, set_by, updated_at)
      select a.event_id, new.user_id, a.status, a.guests, a.set_by, a.updated_at
      from event_added a join events e on e.id = a.event_id
      where a.member_id = new.id and e.status = 'live'
      on conflict (event_id, user_id) do nothing;
      delete from event_added where member_id = new.id;
      perform set_config('rwb.rsvp_quiet', '', true);
    exception when others then null;   -- never block signing in
    end;
  end if;
  return new;
end $$;
drop trigger if exists members_event_claim on public.members;
create trigger members_event_claim after update of user_id on public.members for each row execute function private.event_added_claim();

-- "🏍️ <nick> is going to <event>" for everyone
create or replace function private.rsvp_notify(p_event bigint, p_member bigint, p_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e events; m members; who text; n notifications; total int; names text; k int;
begin
  select * into e from events where id = p_event;
  if e.id is null or e.status <> 'live' or coalesce(e.ends_at, e.starts_at + interval '12 hours') < now() then return; end if;
  if coalesce(current_setting('rwb.quiet', true), '') = 'on' or coalesce(current_setting('rwb.rsvp_quiet', true), '') = 'on' then return; end if;
  select * into m from members where id = p_member;
  if m.id is null then return; end if;
  who := coalesce(nullif(trim(m.nickname), ''), split_part(trim(m.full_name), ' ', 1), 'A rider');
  delete from notifications where kind = 'rsvp' and created_at < now() - interval '3 days';
  select coalesce(sum(1 + c.guests), 0)::int into total from (
    select r.guests from event_rsvps r where r.event_id = p_event and r.status = 'going'
    union all select a.guests from event_added a where a.event_id = p_event and a.status = 'going') c;

  select * into n from notifications where kind = 'rsvp' and event_id = p_event and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;
  if n.id is not null then
    -- merge: everyone who said Going since that note
    select string_agg(nm, ', ' order by at desc), count(*) into names, k from (
      select coalesce(nullif(trim(x.nickname), ''), split_part(trim(x.full_name), ' ', 1)) nm, r.updated_at at
      from event_rsvps r join members x on x.user_id = r.user_id where r.event_id = p_event and r.status = 'going' and r.updated_at >= n.created_at
      union all
      select coalesce(nullif(trim(x.nickname), ''), split_part(trim(x.full_name), ' ', 1)), a.updated_at
      from event_added a join members x on x.id = a.member_id where a.event_id = p_event and a.status = 'going' and a.updated_at >= n.created_at) j;
    if coalesce(k, 0) <= 1 then return; end if;
    update notifications set
      title = left('🏍️ ' || case when k <= 3 then regexp_replace(names, ', ([^,]*)$', ' and \1') else split_part(names, ', ', 1) || ', ' || split_part(names, ', ', 2) || ' and ' || (k - 2) || ' more' end
                   || ' are going to ' || e.title, 120),
      body = total || ' going now. Tap to see who''s coming.'
    where id = n.id;
    return;
  end if;
  if (select count(*) from notifications where kind = 'rsvp' and created_at > now() - interval '1 hour') >= 20 then return; end if;
  insert into notifications (kind, title, body, url, audience, created_by, event_id)
  values ('rsvp', left('🏍️ ' || who || ' is going to ' || e.title, 120),
          total || ' going now · ' || to_char(e.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon') || '. Tap to join the ride.',
          '#events/' || e.id, 'all', coalesce(m.user_id, p_by), e.id);
exception when others then
  return;   -- a notification problem must never stop an RSVP
end $$;
revoke execute on function private.rsvp_notify(bigint, bigint, uuid) from public, anon, authenticated;

create or replace function private.rsvp_joined() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare mid bigint;
begin
  if new.status = 'going' and (tg_op = 'INSERT' or old.status is distinct from 'going') then
    if tg_table_name = 'event_rsvps' then
      select id into mid from members where user_id = new.user_id limit 1;
    else
      mid := new.member_id;
    end if;
    if mid is not null then perform private.rsvp_notify(new.event_id, mid, new.set_by); end if;
  end if;
  return new;
end $$;
drop trigger if exists rsvp_joined on public.event_rsvps;
create trigger rsvp_joined after insert or update of status on public.event_rsvps for each row execute function private.rsvp_joined();
drop trigger if exists added_joined on public.event_added;
create trigger added_joined after insert or update of status on public.event_added for each row execute function private.rsvp_joined();

revoke execute on function public.event_people(bigint) from public, anon;
revoke execute on function public.event_find_members(bigint, text) from public, anon;
revoke execute on function public.event_team_set(bigint, bigint, text, int) from public, anon;
grant execute on function public.event_people(bigint) to authenticated;
grant execute on function public.event_find_members(bigint, text) to authenticated;
grant execute on function public.event_team_set(bigint, bigint, text, int) to authenticated;
revoke execute on function private.event_added_claim() from public, anon, authenticated;
revoke execute on function private.rsvp_joined() from public, anon, authenticated;

notify pgrst, 'reload schema';
