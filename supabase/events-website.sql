-- RWB App setup file 38: the website's Events section comes from the app.
-- * Events get a tag (e.g. Ride), optional seats, and a "show on roninwb.in" switch.
-- * public_events: what roninwb.in shows (no member details: titles, dates, places, seats left).
-- * admin_import_events: past events from the old website sheet are added to the app once, quietly.
-- * Events added with a date in the past never notify members.
-- Safe to run more than once.

alter table public.events add column if not exists tag text check (tag is null or length(tag) <= 40);
alter table public.events add column if not exists capacity integer check (capacity is null or capacity between 1 and 10000);
alter table public.events add column if not exists on_website boolean not null default true;
alter table public.events add column if not exists source_key text unique;

-- notifications for new / changed events, but not for events that are already over (or imported)
create or replace function private.event_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare when_txt text := to_char(new.starts_at at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM');
begin
  if coalesce(current_setting('rwb.quiet', true), '') = 'on' or coalesce(new.ends_at, new.starts_at) < now() then return new; end if;
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

-- what roninwb.in shows: live events marked for the website, with seats taken when seats are set
create or replace function public.public_events() returns table (id bigint, title text, description text, starts_at timestamptz, ends_at timestamptz,
  location text, tag text, capacity integer, taken integer)
language sql stable security definer set search_path = public as $$
  select e.id, e.title, e.description, e.starts_at, e.ends_at, e.location, e.tag, e.capacity,
         case when e.capacity is null then null else
           (select coalesce(sum(1 + r.guests), 0)::int from event_rsvps r where r.event_id = e.id and r.status = 'going') end
  from events e where e.status = 'live' and e.on_website
  order by e.starts_at desc
  limit 200
$$;
revoke execute on function public.public_events() from public;
grant execute on function public.public_events() to anon, authenticated;

-- one-time import of the website's old events (admins only); the same event is never added twice
create or replace function public.admin_import_events(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0; k integer; s timestamptz; e timestamptz;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  perform set_config('rwb.quiet', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin s := (r ->> 'starts_at')::timestamptz; e := nullif(r ->> 'ends_at', '')::timestamptz; exception when others then continue; end;
    if s is null or nullif(trim(r ->> 'title'), '') is null then continue; end if;
    if e is not null and e <= s then e := null; end if;
    insert into events (title, description, starts_at, ends_at, location, tag, capacity, reminder_minutes, status, on_website, source_key)
    values (left(trim(r ->> 'title'), 100), left(nullif(trim(r ->> 'description'), ''), 2000), s, e, left(nullif(trim(r ->> 'location'), ''), 200),
            left(nullif(trim(r ->> 'tag'), ''), 40), nullif(nullif(r ->> 'capacity', ''), '0')::int, null, 'live', true,
            'sheet:' || lower(trim(r ->> 'title')) || ':' || to_char(s at time zone 'Asia/Kolkata', 'YYYY-MM-DD'))
    on conflict (source_key) do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function public.admin_import_events(jsonb) from public, anon;
grant execute on function public.admin_import_events(jsonb) to authenticated;

notify pgrst, 'reload schema';
