-- 95-nick-opt-in.sql (Nov 27 2026)
-- Bodhi: first name by default everywhere; a nickname shows only when the rider picks one
-- (Me → Name in the app). The nicknames saved before this (admins / old forms, 84 riders) were
-- never chosen by the riders for display, so they move to members.nick_old (kept, shown as a
-- suggestion in the rider's Name sheet) and members.nickname is cleared.
-- From now on members.nickname = "the name I chose to be shown as".
-- Track (map, ride notifications) always uses the real first name. Safe to run twice.

alter table members add column if not exists nick_old text;

do $$ begin
  if not exists (select 1 from members where nick_old is not null) then   -- only the first run moves them
    update members set nick_old = nickname, nickname = null where nullif(trim(nickname), '') is not null;
  end if;
end $$;

-- the real first name only (Track, WhatsApp): disp_name without a nickname
create or replace function private.first_name(p_full text) returns text
language sql immutable set search_path = public, private as $$ select private.disp_name(null, p_full) $$;

-- "📍 <first name> is riding live": Track always uses the first name
create or replace function private.track_notify(p_member bigint, p_event bigint, p_note text) returns void
language plpgsql security definer set search_path = public, private as $$
declare x members; ev bigint; evt text; who text;
begin
  select * into x from members where id = p_member;
  if x.id is null then return; end if;
  delete from notifications where kind = 'track' and created_at < now() - interval '12 hours';
  if (select count(*) from notifications where kind = 'track' and created_at > now() - interval '1 hour') >= 12 then return; end if;
  who := coalesce(private.first_name(x.full_name), 'A rider');
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

-- "WhatsApp the admins": the admin's real first name (messages use first names)
create or replace function public.join_help_admins() returns table (first_name text, phone text)
language sql stable security definer set search_path = public as $$
  select private.first_name(m.full_name), m.phone from members m
  where auth.uid() is not null
    and (exists (select 1 from members x where x.user_id = auth.uid() and x.status = 'active')
         or exists (select 1 from fam_members f where f.user_id = auth.uid()))
    and m.status = 'active' and m.role in ('superadmin', 'admin') and length(coalesce(m.phone, '')) = 10
  order by case m.role when 'superadmin' then 0 else 1 end, m.full_name
$$;

-- SOS (team only): first name + full name
create or replace function public.track_sos(p_lat double precision, p_lng double precision, p_acc real default null)
returns bigint language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); s track_sos; nm text;
begin
  if not private.track_ok(p_lat, p_lng) then raise exception 'No GPS location yet. Step into the open and try again, or call an admin.'; end if;
  nm := coalesce(private.first_name(m.full_name), 'A rider');
  select * into s from track_sos where member_id = m.id and resolved_at is null and at > now() - interval '24 hours' order by at desc limit 1;
  if s.id is not null then
    update track_sos set lat = p_lat, lng = p_lng, acc = p_acc where id = s.id;
    if s.at > now() - interval '2 minutes' then return s.id; end if;
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
