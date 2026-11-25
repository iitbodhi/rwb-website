-- 86: Events v2 (Nov 2026)
-- 1. Only "Going": Maybe and Can't go are gone. Leaving an event deletes your RSVP. Old Maybe answers become Going only
--    where that rider is already in the event's expenses (they clearly took part); every other Maybe / Can't go is removed.
--    Expenses are shared only between people going (the existing checks for 'going','maybe' now only ever see 'going').
-- 2. Slots are kept: a rider can't join (or add a +1) when the event is full. The RWB team can still add people.
-- 3. Admins and coordinators manage the Going list: add anyone (also members not on the app yet, kept in
--    public.event_added and moved to their own RSVP when they sign in), add/remove a +1, take people off, also after the event.
--    event_rsvps.set_by = who on the team added them ("Added by …"); the rider answering again clears it.
--    The rider gets a personal note when the team adds or removes them (upcoming events only).
-- 4. "🏍️ <nick> is going to <event>" for every member (kind 'rsvp', switch "Riders joining events" in Me → Notifications).
--    Joins within 30 minutes of the last note for that event are merged into it (the text updates, no second buzz);
--    at most 20 an hour RWB-wide; removed after 3 days; never for past or cancelled events; errors never block an RSVP.
-- 5. Event cover photo (landscape 16:9, shrunk on the phone to ~100 KB WebP): saved on GitHub (iitbodhi/rwb-media, served
--    free by jsDelivr) by the guides-media Edge Function (op "event_cover"), NOT in Supabase, so it costs no Supabase
--    storage or egress. events.cover_url / cover_path / cover_sha can only be changed by that function.
--    roninwb.in gets cover_url through public_events().
-- Safe to run twice.

-- ---------- 1. Going only ----------
do $$ begin
  perform set_config('rwb.rsvp_quiet', 'on', true);   -- the clean-up below sends no notifications
  update event_rsvps r set status = 'going', guests = 0
  where r.status = 'maybe'
    and exists (select 1 from events e where e.id = r.event_id and e.status = 'live')
    and exists (select 1 from event_expenses x where x.event_id = r.event_id
                and (x.paid_by = r.user_id or x.split @> jsonb_build_array(jsonb_build_object('u', r.user_id::text))));
  delete from event_rsvps where status <> 'going';
  perform set_config('rwb.rsvp_quiet', '', true);
end $$;
alter table public.event_rsvps drop constraint if exists event_rsvps_status_check;
alter table public.event_rsvps add constraint event_rsvps_status_check check (status = 'going');

drop policy if exists rsvps_own_remove on public.event_rsvps;
create policy rsvps_own_remove on public.event_rsvps for delete to authenticated using (user_id = (select auth.uid()));
grant delete on public.event_rsvps to authenticated;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('announcement','birthday','motomart','member','admin','event','personal','sos','reminder','track','rsvp'));

alter table public.event_rsvps add column if not exists set_by uuid references auth.users(id) on delete set null;
create index if not exists event_rsvps_set_by on public.event_rsvps (set_by);

-- members who aren't on the app yet, added by the team
create table if not exists public.event_added (
  event_id   bigint not null references public.events(id) on delete cascade,
  member_id  bigint not null references public.members(id) on delete cascade,
  status     text   not null default 'going' check (status = 'going'),
  guests     int    not null default 0 check (guests between 0 and 1),
  set_by     uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index if not exists event_added_member on public.event_added (member_id);
create index if not exists event_added_set_by on public.event_added (set_by);
alter table public.event_added enable row level security;   -- no policies: only the functions below touch it
revoke all on public.event_added from anon, authenticated;

-- heads going (riders + their guests), app riders and team-added members together
create or replace function private.event_heads(p_event bigint, p_skip_user uuid default null)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(1 + c.guests), 0)::int from (
    select r.guests from event_rsvps r where r.event_id = p_event and r.status = 'going' and r.user_id is distinct from p_skip_user
    union all select a.guests from event_added a where a.event_id = p_event) c;
$$;
revoke execute on function private.event_heads(bigint, uuid) from public, anon, authenticated;

-- ---------- 2. RSVP checks: going only, slots, "added by" ----------
create or replace function private.rsvp_guard() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare e events; me uuid := (select auth.uid());
begin
  select * into e from events where id = new.event_id;
  if e.status <> 'live' then raise exception 'This event was cancelled'; end if;
  if new.status <> 'going' then raise exception 'Please close and reopen the RWB app to update it, then try again.'; end if;
  if not e.allow_guests then new.guests := 0; end if;
  if new.user_id = me then new.set_by := null; end if;
  if tg_op = 'UPDATE' and new.set_by is distinct from old.set_by and new.set_by is not null and not public.is_moderator() then new.set_by := old.set_by; end if;
  -- slots: only riders joining themselves are stopped (the team can always add)
  if e.capacity is not null and new.user_id = me and not public.is_moderator()
     and (tg_op = 'INSERT' or new.guests > old.guests)
     and private.event_heads(new.event_id, new.user_id) + 1 + new.guests > e.capacity then
    raise exception '%', case when tg_op = 'INSERT' then 'Sorry, this event is full.' else 'No slot left for a guest.' end;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------- 3. who's going ----------
drop function if exists public.event_people(bigint);
create function public.event_people(p_event bigint)
returns table(user_id uuid, member_id bigint, full_name text, nickname text, avatar_url text, status text, guests integer,
              updated_at timestamptz, set_by_name text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
declare mod boolean := public.is_moderator();
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select x.user_id, x.member_id, x.full_name, x.nickname, x.avatar_url, 'going'::text, x.guests, x.updated_at,
           case when x.set_by is null then null
                when mod then coalesce((select coalesce(nullif(trim(t.nickname), ''), split_part(t.full_name, ' ', 1)) from members t where t.user_id = x.set_by limit 1), 'RWB team')
                else 'RWB team' end,
           x.on_app
    from (
      select r.user_id, m.id member_id, m.full_name, m.nickname, m.avatar_url, r.guests, r.updated_at, r.set_by, true on_app
      from event_rsvps r join members m on m.user_id = r.user_id
      where r.event_id = p_event and r.status = 'going'
      union all
      select null::uuid, m.id, m.full_name, m.nickname, m.avatar_url, a.guests, a.updated_at, a.set_by, false
      from event_added a join members m on m.id = a.member_id
      where a.event_id = p_event
    ) x order by x.updated_at;
end $$;

-- (maybe stays in the answer, always 0, so older copies of the app keep working)
create or replace function public.event_counts()
returns table(event_id bigint, going integer, maybe integer, guests integer, faces jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    with x as (
      select r.event_id, r.guests, r.updated_at, m.full_name, m.avatar_url
      from event_rsvps r join members m on m.user_id = r.user_id where r.status = 'going'
      union all
      select a.event_id, a.guests, a.updated_at, m.full_name, m.avatar_url
      from event_added a join members m on m.id = a.member_id
    )
    select x.event_id, count(*)::int, 0, coalesce(sum(x.guests), 0)::int,
           coalesce((select jsonb_agg(jsonb_build_object('full_name', f.full_name, 'avatar_url', f.avatar_url))
                     from (select y.full_name, y.avatar_url from x y where y.event_id = x.event_id order by y.updated_at limit 4) f), '[]'::jsonb)
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
           case when exists (select 1 from event_rsvps r where r.event_id = p_event and r.user_id = m.user_id)
                  or exists (select 1 from event_added a where a.event_id = p_event and a.member_id = m.id) then 'going' end
    from members m
    where m.status = 'active'
      and (m.full_name ilike '%' || q || '%' or m.nickname ilike '%' || q || '%'
           or (length(v) >= 3 and upper(regexp_replace(coalesce(m.vrn, ''), '[^A-Za-z0-9]', '', 'g')) like '%' || v || '%')
           or (length(d) >= 4 and regexp_replace(coalesce(m.phone, ''), '\D', '', 'g') like '%' || d))
    order by (m.nickname ilike q || '%' or m.full_name ilike q || '%') desc, m.full_name
    limit 20;
end $$;

-- team: put someone on the Going list (p_status 'going', with or without a +1) or take them off (p_status null)
drop function if exists public.event_team_set(bigint, bigint, text, int);
create function public.event_team_set(p_event bigint, p_member bigint, p_status text, p_guests int default 0)
returns text language plpgsql security definer set search_path = public, private as $$
declare me uuid := (select auth.uid()); e events; m members; was boolean; g int := least(greatest(coalesce(p_guests, 0), 0), 1);
        upcoming boolean;
begin
  if not public.is_moderator() then raise exception 'Only the RWB team can do this'; end if;
  if p_status is not null and p_status <> 'going' then raise exception 'Please close and reopen the RWB app to update it, then try again.'; end if;
  select * into e from events where id = p_event;
  if e.id is null then raise exception 'That event is no longer available'; end if;
  if e.status <> 'live' then raise exception 'This event was cancelled'; end if;
  select * into m from members where id = p_member;
  if m.id is null or m.status <> 'active' then raise exception 'That member was not found'; end if;
  if not e.allow_guests then g := 0; end if;
  upcoming := coalesce(e.ends_at, e.starts_at + interval '12 hours') > now();

  if m.user_id is not null then
    delete from event_added where event_id = p_event and member_id = p_member;   -- an old place from before they joined the app
    was := exists (select 1 from event_rsvps where event_id = p_event and user_id = m.user_id);
    if p_status is null then
      delete from event_rsvps where event_id = p_event and user_id = m.user_id;
    else
      insert into event_rsvps (event_id, user_id, status, guests, set_by)
      values (p_event, m.user_id, 'going', g, case when m.user_id = me then null else me end)
      on conflict (event_id, user_id) do update set guests = excluded.guests, set_by = coalesce(event_rsvps.set_by, excluded.set_by);
    end if;
    -- tell the rider (not for past events, not when nothing changed, not when it's yourself)
    if upcoming and m.user_id <> me and was <> (p_status is not null) then
      begin
        insert into notifications (kind, title, body, url, audience, target_user, created_by, event_id)
        values ('personal', left('📅 ' || e.title, 120),
                case when p_status is null then 'The RWB team took you off the Going list.' else 'The RWB team added you to the Going list.' end || ' Tap to see the event.',
                '#events/' || e.id, 'user', m.user_id, me, e.id);
      exception when others then null;
      end;
    end if;
  else
    if p_status is null then
      delete from event_added where event_id = p_event and member_id = p_member;
    else
      insert into event_added (event_id, member_id, status, guests, set_by, updated_at)
      values (p_event, p_member, 'going', g, me, now())
      on conflict (event_id, member_id) do update set guests = excluded.guests;
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
      select a.event_id, new.user_id, 'going', a.guests, a.set_by, a.updated_at
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

-- ---------- 4. "🏍️ <nick> is going to <event>" ----------
create or replace function private.rsvp_notify(p_event bigint, p_member bigint, p_by uuid)
returns void language plpgsql security definer set search_path = public, private as $$
declare e events; m members; who text; n notifications; total int; names text; k int;
begin
  select * into e from events where id = p_event;
  if e.id is null or e.status <> 'live' or coalesce(e.ends_at, e.starts_at + interval '12 hours') < now() then return; end if;
  if coalesce(current_setting('rwb.quiet', true), '') = 'on' or coalesce(current_setting('rwb.rsvp_quiet', true), '') = 'on' then return; end if;
  select * into m from members where id = p_member;
  if m.id is null then return; end if;
  who := coalesce(nullif(trim(m.nickname), ''), split_part(trim(m.full_name), ' ', 1), 'A rider');
  delete from notifications where kind = 'rsvp' and created_at < now() - interval '3 days';
  total := private.event_heads(p_event);

  select * into n from notifications where kind = 'rsvp' and event_id = p_event and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;
  if n.id is not null then
    -- merge: everyone who joined since that note
    select string_agg(nm, ', ' order by at desc), count(*) into names, k from (
      select coalesce(nullif(trim(x.nickname), ''), split_part(trim(x.full_name), ' ', 1)) nm, r.updated_at at
      from event_rsvps r join members x on x.user_id = r.user_id where r.event_id = p_event and r.updated_at >= n.created_at
      union all
      select coalesce(nullif(trim(x.nickname), ''), split_part(trim(x.full_name), ' ', 1)), a.updated_at
      from event_added a join members x on x.id = a.member_id where a.event_id = p_event and a.updated_at >= n.created_at) j;
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
  if tg_op = 'INSERT' then
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
create trigger rsvp_joined after insert on public.event_rsvps for each row execute function private.rsvp_joined();
drop trigger if exists added_joined on public.event_added;
create trigger added_joined after insert on public.event_added for each row execute function private.rsvp_joined();

-- ---------- 5. cover photo ----------
alter table public.events add column if not exists cover_url text;
alter table public.events add column if not exists cover_path text;
alter table public.events add column if not exists cover_sha text;
-- only the guides-media Edge Function (service role) changes the cover; the app can't point it anywhere else
create or replace function private.events_cover_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    if tg_op = 'INSERT' then new.cover_url := null; new.cover_path := null; new.cover_sha := null;
    else new.cover_url := old.cover_url; new.cover_path := old.cover_path; new.cover_sha := old.cover_sha; end if;
  end if;
  return new;
end $$;
drop trigger if exists events_cover_guard on public.events;
create trigger events_cover_guard before insert or update on public.events for each row execute function private.events_cover_guard();
revoke execute on function private.events_cover_guard() from public, anon, authenticated;

drop function if exists public.public_events();
create function public.public_events() returns table (id bigint, title text, description text, starts_at timestamptz, ends_at timestamptz,
  location text, tag text, capacity integer, taken integer, cover_url text)
language sql stable security definer set search_path = public, private as $$
  select e.id, e.title, e.description, e.starts_at, e.ends_at, e.location, e.tag, e.capacity,
         case when e.capacity is null then null else private.event_heads(e.id) end, e.cover_url
  from events e where e.status = 'live' and e.on_website
  order by e.starts_at desc
  limit 200
$$;
revoke execute on function public.public_events() from public;
grant execute on function public.public_events() to anon, authenticated;

revoke execute on function public.event_people(bigint) from public, anon;
revoke execute on function public.event_find_members(bigint, text) from public, anon;
revoke execute on function public.event_team_set(bigint, bigint, text, int) from public, anon;
grant execute on function public.event_people(bigint) to authenticated;
grant execute on function public.event_find_members(bigint, text) to authenticated;
grant execute on function public.event_team_set(bigint, bigint, text, int) to authenticated;
revoke execute on function private.event_added_claim() from public, anon, authenticated;
revoke execute on function private.rsvp_joined() from public, anon, authenticated;

notify pgrst, 'reload schema';
