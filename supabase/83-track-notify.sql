-- 83: a notification to every member when a rider starts sharing on Track (Nov 2026)
-- * new kind 'track'; members can switch it off in Me → Notifications ("Riders who start sharing on Track")
-- * only when a NEW ride starts (same rule as the Track Warriors ride count: stopping and sharing again within 3 hours doesn't notify again)
-- * a group ride notifies once: "📍 <event> is live on Track" (once per event every 3 hours), not once per rider
-- * at most 12 Track notifications an hour across RWB, and they're removed after 12 hours so they don't crowd the updates list
-- * the rider who shares doesn't get their own notification; a notification problem never stops the sharing
-- Safe to run twice.

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('announcement','birthday','motomart','member','admin','event','personal','sos','reminder','track'));
create index if not exists notifications_kind_at on public.notifications (kind, created_at);

create or replace function private.track_notify(p_member bigint, p_event bigint, p_note text)
returns void language plpgsql security definer set search_path = public, private as $$
declare x members; ev bigint; evt text; who text;
begin
  select * into x from members where id = p_member;
  if x.id is null then return; end if;
  delete from notifications where kind = 'track' and created_at < now() - interval '12 hours';
  if (select count(*) from notifications where kind = 'track' and created_at > now() - interval '1 hour') >= 12 then return; end if;
  who := coalesce(nullif(trim(x.nickname), ''), split_part(trim(x.full_name), ' ', 1), 'A rider');
  -- the event: the one they picked, else a live RWB event they're Going to that's on now
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
  return;   -- a notification problem must never stop the sharing
end $$;
revoke execute on function private.track_notify(bigint, bigint, text) from public, anon, authenticated;

create or replace function public.track_start(p_lat double precision, p_lng double precision, p_acc real default null, p_hours integer default 4, p_event bigint default null, p_note text default null)
returns timestamptz language plpgsql security definer set search_path = public, private as $$
declare m members := private.track_me(); u timestamptz := now() + make_interval(hours => least(greatest(coalesce(p_hours, 4), 1), 12)); was boolean; fresh boolean;
        nt text := left(nullif(regexp_replace(trim(coalesce(p_note, '')), '\s+', ' ', 'g'), ''), 60);
begin
  if not private.track_ok(p_lat, p_lng) then raise exception 'No GPS location yet'; end if;
  select true into was from track_live where member_id = m.id and until > now();
  fresh := not coalesce(was, false) and not exists (select 1 from track_stats where member_id = m.id and last_ride > now() - interval '3 hours');
  insert into track_live (member_id, lat, lng, acc, at, moved_at, since, until, event_id, note, ride_km, top_spd)
  values (m.id, p_lat, p_lng, p_acc, now(), now(), now(), u, p_event, nt, 0, 0)
  on conflict (member_id) do update set lat = excluded.lat, lng = excluded.lng, acc = excluded.acc, at = now(), moved_at = now(),
    since = case when track_live.until > now() then track_live.since else now() end, until = u, event_id = excluded.event_id, note = excluded.note,
    ride_km = case when track_live.until > now() then track_live.ride_km else 0 end,
    top_spd = case when track_live.until > now() then track_live.top_spd else 0 end;
  if not coalesce(was, false) then
    insert into track_stats (member_id, rides, last_ride) values (m.id, 1, now())
    on conflict (member_id) do update set rides = track_stats.rides + case when track_stats.last_ride > now() - interval '3 hours' then 0 else 1 end,
      last_ride = now(), updated_at = now();
  end if;
  if fresh then perform private.track_notify(m.id, p_event, nt); end if;
  return u;
end $$;

notify pgrst, 'reload schema';
