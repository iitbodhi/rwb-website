-- =====================================================================
-- RWB App: Events (like WhatsApp events) with RSVPs, reminders and a shared expense splitter
-- Run once in Supabase > SQL Editor, AFTER 18-coordinators-and-team.sql. Safe to run again.
-- =====================================================================

-- ---------- 1. Events: only admins and coordinators publish ----------
create table if not exists public.events (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) between 2 and 100),
  description text check (description is null or length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at is null or ends_at > starts_at),
  location text check (location is null or length(location) <= 200),
  map_url text check (map_url is null or map_url ~* '^https?://'),
  call_link text check (call_link is null or call_link ~* '^https?://'),
  reminder_minutes integer check (reminder_minutes is null or reminder_minutes between 0 and 10080),
  allow_guests boolean not null default false,
  status text not null default 'live' check (status in ('live','cancelled')),
  reminded_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists events_start_idx on public.events (starts_at);
alter table public.events enable row level security;
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated using (public.is_member());
drop policy if exists events_add on public.events;
create policy events_add on public.events for insert to authenticated with check (public.is_moderator());
drop policy if exists events_change on public.events;
create policy events_change on public.events for update to authenticated using (public.is_moderator());
drop policy if exists events_remove on public.events;
create policy events_remove on public.events for delete to authenticated using (public.is_moderator());
revoke all on public.events from anon;
grant select, insert, update, delete on public.events to authenticated;

create or replace function private.events_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); new.reminded_at := null;
  else
    new.created_by := old.created_by; new.created_at := old.created_at;
    -- moved to a new time: the reminder goes out again
    if new.starts_at is distinct from old.starts_at or new.reminder_minutes is distinct from old.reminder_minutes then new.reminded_at := null; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists events_guard on public.events;
create trigger events_guard before insert or update on public.events for each row execute function private.events_guard();

-- ---------- 2. RSVPs: Going / Maybe / Can't go (+1 guest when allowed) ----------
create table if not exists public.event_rsvps (
  event_id bigint not null references public.events(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status text not null check (status in ('going','maybe','no')),
  guests integer not null default 0 check (guests between 0 and 1),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.event_rsvps enable row level security;
drop policy if exists rsvps_read on public.event_rsvps;
create policy rsvps_read on public.event_rsvps for select to authenticated using (public.is_member());
drop policy if exists rsvps_own on public.event_rsvps;
create policy rsvps_own on public.event_rsvps for insert to authenticated with check (user_id = auth.uid() and public.is_member());
drop policy if exists rsvps_own_change on public.event_rsvps;
create policy rsvps_own_change on public.event_rsvps for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.event_rsvps from anon;
grant select, insert, update on public.event_rsvps to authenticated;

create or replace function private.rsvp_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare e events;
begin
  select * into e from events where id = new.event_id;
  if e.status <> 'live' then raise exception 'This event was cancelled'; end if;
  if not e.allow_guests or new.status <> 'going' then new.guests := 0; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists rsvp_guard on public.event_rsvps;
create trigger rsvp_guard before insert or update on public.event_rsvps for each row execute function private.rsvp_guard();

-- Who's in: names and photos of everyone who responded
create or replace function public.event_people(p_event bigint)
returns table (user_id uuid, full_name text, nickname text, avatar_url text, status text, guests integer, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select r.user_id, m.full_name, m.nickname, m.avatar_url, r.status, r.guests, r.updated_at
    from event_rsvps r join members m on m.user_id = r.user_id
    where r.event_id = p_event order by r.updated_at;
end $$;

-- Counts for the event list
create or replace function public.event_counts()
returns table (event_id bigint, going integer, maybe integer, guests integer, faces jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select r.event_id,
           (count(*) filter (where r.status = 'going'))::int,
           (count(*) filter (where r.status = 'maybe'))::int,
           coalesce(sum(r.guests) filter (where r.status = 'going'), 0)::int,
           coalesce((select jsonb_agg(jsonb_build_object('full_name', x.full_name, 'avatar_url', x.avatar_url))
                     from (select m2.full_name, m2.avatar_url from event_rsvps r2 join members m2 on m2.user_id = r2.user_id
                           where r2.event_id = r.event_id and r2.status = 'going' order by r2.updated_at limit 4) x), '[]'::jsonb)
    from event_rsvps r group by r.event_id;
end $$;

-- ---------- 3. Expense splitter (for people who said Going or Maybe) ----------
create or replace function public.is_event_member(p_event bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_moderator() or exists (select 1 from event_rsvps where event_id = p_event and user_id = auth.uid() and status in ('going','maybe'));
$$;

create table if not exists public.event_expenses (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.events(id) on delete cascade,
  kind text not null default 'expense' check (kind in ('expense','settlement')),
  title text check (title is null or length(title) <= 80),
  amount numeric(10,2) not null check (amount > 0 and amount <= 1000000),
  paid_by uuid not null references auth.users(id) on delete cascade,
  split jsonb not null,               -- [{"u": "<user id>", "w": 1}, ...]  w = shares (2 when someone brings a guest)
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists event_expenses_event_idx on public.event_expenses (event_id);
alter table public.event_expenses enable row level security;
drop policy if exists expenses_read on public.event_expenses;
create policy expenses_read on public.event_expenses for select to authenticated using (public.is_event_member(event_id));
drop policy if exists expenses_add on public.event_expenses;
create policy expenses_add on public.event_expenses for insert to authenticated with check (public.is_event_member(event_id));
drop policy if exists expenses_change on public.event_expenses;
create policy expenses_change on public.event_expenses for update to authenticated
  using (public.is_event_member(event_id) and (created_by = auth.uid() or public.is_moderator()));
drop policy if exists expenses_remove on public.event_expenses;
create policy expenses_remove on public.event_expenses for delete to authenticated
  using (public.is_event_member(event_id) and (created_by = auth.uid() or public.is_moderator()));
revoke all on public.event_expenses from anon;
grant select, insert, update, delete on public.event_expenses to authenticated;

-- Everyone in an expense must have responded Going or Maybe
create or replace function private.expense_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare item jsonb; n int := 0;
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now();
  else new.created_by := old.created_by; new.created_at := old.created_at; new.event_id := old.event_id; end if;
  if jsonb_typeof(new.split) <> 'array' or jsonb_array_length(new.split) = 0 then raise exception 'Pick at least one person to split with'; end if;
  if not exists (select 1 from event_rsvps where event_id = new.event_id and user_id = new.paid_by and status in ('going','maybe')) then
    raise exception 'The person who paid must be going to this event';
  end if;
  for item in select * from jsonb_array_elements(new.split) loop
    n := n + 1;
    if coalesce((item->>'w')::int, 0) not between 1 and 5 then raise exception 'Bad split'; end if;
    if not exists (select 1 from event_rsvps where event_id = new.event_id and user_id = (item->>'u')::uuid and status in ('going','maybe')) then
      raise exception 'Everyone in the split must be going to this event';
    end if;
  end loop;
  if n > 200 then raise exception 'Too many people in one expense'; end if;
  return new;
end $$;
drop trigger if exists expense_guard on public.event_expenses;
create trigger expense_guard before insert or update on public.event_expenses for each row execute function private.expense_guard();

-- ---------- 4. Notifications: event alerts stay on Clear; reminders go to people who are going ----------
alter table public.notifications add column if not exists event_id bigint references public.events(id) on delete cascade;
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in ('announcement','birthday','motomart','member','admin','event'));
alter table public.notifications drop constraint if exists notifications_audience_check;
alter table public.notifications add constraint notifications_audience_check check (audience in ('all','admins','moderators','going'));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using ((audience = 'all' and public.is_member())
      or (audience = 'moderators' and public.is_moderator())
      or (audience = 'going' and exists (select 1 from event_rsvps r where r.event_id = notifications.event_id and r.user_id = auth.uid() and r.status in ('going','maybe')))
      or public.is_admin());

create or replace function private.event_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare when_txt text := to_char(new.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM');
begin
  if tg_op = 'INSERT' then
    insert into notifications (kind, title, body, url, created_by, event_id)
    values ('event', '📅 ' || new.title, when_txt || coalesce(' · ' || new.location, ''), '#events/' || new.id, new.created_by, new.id);
  elsif new.status = 'cancelled' and old.status = 'live' then
    insert into notifications (kind, title, body, url, created_by, event_id)
    values ('event', 'Cancelled: ' || new.title, 'This event on ' || when_txt || ' is cancelled.', '#events/' || new.id, auth.uid(), new.id);
  elsif new.status = 'live' and (new.starts_at is distinct from old.starts_at or new.location is distinct from old.location) then
    insert into notifications (kind, title, body, url, created_by, event_id)
    values ('event', 'Updated: ' || new.title, 'Now ' || when_txt || coalesce(' · ' || new.location, ''), '#events/' || new.id, auth.uid(), new.id);
  end if;
  return new;
end $$;
drop trigger if exists event_events on public.events;
create trigger event_events after insert or update on public.events for each row execute function private.event_events();

-- Reminders (checked every 5 minutes) to everyone going or maybe
create or replace function public.post_event_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare e events; n int := 0;
begin
  for e in select * from events where status = 'live' and reminder_minutes is not null and reminded_at is null
             and starts_at > now() - interval '30 minutes' and starts_at - make_interval(mins => reminder_minutes) <= now() loop
    insert into notifications (kind, title, body, url, audience, event_id)
    values ('event', '⏰ ' || e.title,
            case when e.reminder_minutes = 0 then 'Starting now' else 'Starts ' || to_char(e.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM') end
              || coalesce(' · ' || e.location, ''),
            '#events/' || e.id, 'going', e.id);
    update events set reminded_at = now() where id = e.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.post_event_reminders() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'rwb-event-reminders') then perform cron.unschedule('rwb-event-reminders'); end if;
  perform cron.schedule('rwb-event-reminders', '*/5 * * * *', 'select public.post_event_reminders()');
end $$;

-- Push: event alerts always go out; reminders only to people going or maybe
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
      where (n.audience = 'all'
             or (n.audience = 'admins' and m.role in ('admin','superadmin'))
             or (n.audience = 'moderators' and m.role in ('coordinator','admin','superadmin'))
             or (n.audience = 'going' and exists (select 1 from event_rsvps r where r.event_id = n.event_id and r.user_id = s.user_id and r.status in ('going','maybe'))))
        and (n.created_by is null or s.user_id <> n.created_by)
        and (n.kind in ('announcement','admin','event') or coalesce((m.notify ->> n.kind)::boolean, true))
    ), '[]'::jsonb));
end $$;

revoke execute on function public.event_people(bigint) from public, anon;
revoke execute on function public.event_counts() from public, anon;
revoke execute on function public.is_event_member(bigint) from public, anon;
revoke execute on function public.push_job(bigint, text) from public, anon, authenticated;
grant execute on function public.event_people(bigint) to authenticated;
grant execute on function public.event_counts() to authenticated;
grant execute on function public.is_event_member(bigint) to authenticated;
grant execute on function public.push_job(bigint, text) to service_role;
notify pgrst, 'reload schema';
