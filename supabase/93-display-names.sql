-- 93-display-names.sql (Nov 27 2026)
-- Everyone is shown by their nickname if they set one (Me → Name in the app), else their first name.
-- Same rule as firstName()/firstOf() in app/js/app.js: titles like Md / Sk / Mr / Dr are skipped and
-- ALL CAPS or all-lowercase names are tidied ("RAHUL DAS" → "Rahul"). Keep both the same.
-- Used in member-facing notifications (new member, Track, events) and the small lists the app gets
-- from the server. Admin-only alerts keep the full name. Safe to run twice.

create or replace function private.disp_name(p_nick text, p_full text) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(trim(p_nick), ''), (
    select case when f = upper(f) or f = lower(f) then upper(left(f, 1)) || lower(substr(f, 2)) else f end
    from (select rtrim(coalesce(
            (select w from unnest(regexp_split_to_array(trim(coalesce(p_full, '')), '\s+')) with ordinality t(w, i)
             where w <> '' and w !~* '^(md|mohd|mr|mrs|ms|dr|er|sk|sri|shri|smt)\.?$' order by i limit 1),
            split_part(trim(coalesce(p_full, '')), ' ', 1)), '.,') f) q
    where f <> ''))
$$;
grant execute on function private.disp_name(text, text) to authenticated, anon;

-- "A new Ronin joined the app" (everyone): first name / nickname
create or replace function private.member_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and (tg_op = 'INSERT' or old.user_id is null)
     and coalesce(current_setting('rwb.quiet_join', true), '') <> 'on' then
    insert into notifications (kind, title, body, url, created_by)
    values ('member', 'A new Ronin joined the app 🏍️', 'Say hello to ' || coalesce(private.disp_name(new.nickname, new.full_name), 'a new Ronin') || '!', '#home', new.user_id);
  end if;
  return new;
end $$;

-- "WhatsApp the admins" (members and FAM): the admin's whole nickname, not just its first word
create or replace function public.join_help_admins() returns table (first_name text, phone text)
language sql stable security definer set search_path = public as $$
  select private.disp_name(m.nickname, m.full_name), m.phone from members m
  where auth.uid() is not null
    and (exists (select 1 from members x where x.user_id = auth.uid() and x.status = 'active')
         or exists (select 1 from fam_members f where f.user_id = auth.uid()))
    and m.status = 'active' and m.role in ('superadmin', 'admin') and length(coalesce(m.phone, '')) = 10
  order by case m.role when 'superadmin' then 0 else 1 end, m.full_name
$$;

-- RWB FAM invite page: "Invited by <name>"
create or replace function public.fam_invite_info(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', private.disp_name(m.nickname, m.full_name),
                            'left', 3 - (select count(*) from fam_members f where f.member_id = m.id))
  from fam_codes c join members m on m.id = c.member_id where c.code = upper(trim(p_code)) and m.status = 'active'
$$;

-- event Going list: "Added by <name>" (team only)
create or replace function public.event_people(p_event bigint)
returns table(user_id uuid, member_id bigint, full_name text, nickname text, avatar_url text, status text, guests integer,
              updated_at timestamptz, set_by_name text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
declare mod boolean := public.is_moderator();
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select x.user_id, x.member_id, x.full_name, x.nickname, x.avatar_url, 'going'::text, x.guests, x.updated_at,
           case when x.set_by is null then null
                when mod then coalesce((select private.disp_name(t.nickname, t.full_name) from members t where t.user_id = x.set_by limit 1), 'RWB team')
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

-- "📍 <name> is riding live"
create or replace function private.track_notify(p_member bigint, p_event bigint, p_note text) returns void
language plpgsql security definer set search_path = public, private as $$
declare x members; ev bigint; evt text; who text;
begin
  select * into x from members where id = p_member;
  if x.id is null then return; end if;
  delete from notifications where kind = 'track' and created_at < now() - interval '12 hours';
  if (select count(*) from notifications where kind = 'track' and created_at > now() - interval '1 hour') >= 12 then return; end if;
  who := coalesce(private.disp_name(x.nickname, x.full_name), 'A rider');
  select e.id, e.title into ev, evt from events e
  where (p_event is not null and e.id = p_event)
     or (p_event is null and e.status = 'live'
         and now() between e.starts_at - interval '3 hours' and coalesce(e.ends_at, e.starts_at + interval '12 hours') + interval '3 hours'
         and exists (select 1 from event_rsvps r where r.event_id = e.id and r.user_id = x.user_id and r.status = 'going'))
  order by e.starts_at desc limit 1;
  if ev is not null then
    if exists (select 1 from notifications where kind = 'track' and event_id = ev and created_at > now() - interval '3 hours') then return; end if;
    insert into notifications (kind, title, body, url, audience, created_by, event_id)
    values ('track', left('📍 ' || evt || ' is live on Track', 120), who || ' started sharing. See the group on the map.', '#track/e' || ev, 'all', x.user_id, ev);
  else
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('track', left('📍 ' || who || ' is riding live', 120),
      coalesce('“' || nullif(trim(p_note), '') || '” · see them on the Track map', 'Tap to see them on the Track map.'), '#track', 'all', x.user_id);
  end if;
exception when others then
  return;
end $$;

-- "🏍️ <name> is going to <event>"
create or replace function private.rsvp_notify(p_event bigint, p_member bigint, p_by uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare e events; m members; who text; n notifications; total int; names text; k int;
begin
  select * into e from events where id = p_event;
  if e.id is null or e.status <> 'live' or coalesce(e.ends_at, e.starts_at + interval '12 hours') < now() then return; end if;
  if coalesce(current_setting('rwb.quiet', true), '') = 'on' or coalesce(current_setting('rwb.rsvp_quiet', true), '') = 'on' then return; end if;
  select * into m from members where id = p_member;
  if m.id is null then return; end if;
  who := coalesce(private.disp_name(m.nickname, m.full_name), 'A rider');
  delete from notifications where kind = 'rsvp' and created_at < now() - interval '3 days';
  total := private.event_heads(p_event);

  select * into n from notifications where kind = 'rsvp' and event_id = p_event and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;
  if n.id is not null then
    select string_agg(nm, ', ' order by at desc), count(*) into names, k from (
      select coalesce(private.disp_name(x.nickname, x.full_name), 'A rider') nm, r.updated_at at
      from event_rsvps r join members x on x.user_id = r.user_id where r.event_id = p_event and r.updated_at >= n.created_at
      union all
      select coalesce(private.disp_name(x.nickname, x.full_name), 'A rider'), a.updated_at
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
  return;
end $$;

-- SOS (team only): the title keeps the full name so the team knows exactly who; the line uses the shown name
create or replace function public.track_sos(p_lat double precision, p_lng double precision, p_acc real default null)
returns bigint language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); s track_sos; nm text;
begin
  if not private.track_ok(p_lat, p_lng) then raise exception 'No GPS location yet. Step into the open and try again, or call an admin.'; end if;
  nm := coalesce(private.disp_name(m.nickname, m.full_name), 'A rider');
  select * into s from track_sos where member_id = m.id and resolved_at is null and at > now() - interval '24 hours' order by at desc limit 1;
  if s.id is not null then
    update track_sos set lat = p_lat, lng = p_lng, acc = p_acc where id = s.id;
    if s.at > now() - interval '2 minutes' then return s.id; end if;          -- just sent: only the location is updated
    update track_sos set at = now() where id = s.id;
  else
    insert into track_sos (member_id, lat, lng, acc) values (m.id, p_lat, p_lng, p_acc) returning * into s;
  end if;
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('sos', '🆘 SOS: ' || nm || ' (' || m.full_name || ')', nm || ' needs help. Tap to see where on the map.' || coalesce(' Call ' || m.phone || '.', ''),
          '#track/sos', 'moderators', auth.uid());
  return s.id;
end $$;

notify pgrst, 'reload schema';
