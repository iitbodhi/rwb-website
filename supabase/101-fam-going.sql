-- 101-fam-going.sql (Nov 28 2026, Bodhi): RWB FAM sees who's going to each RWB event and the real slot count
-- (still no expenses). Before this, event_counts / event_people were members only, so FAM saw "8 of 8 slots left"
-- even when riders had joined. Safe to run twice.

create or replace function public.event_counts()
returns table(event_id bigint, going integer, maybe integer, guests integer, faces jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_member() or private.fam_ok()) then raise exception 'Members only'; end if;
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

create or replace function public.event_people(p_event bigint)
returns table(user_id uuid, member_id bigint, full_name text, nickname text, avatar_url text, status text, guests integer, updated_at timestamptz, set_by_name text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
declare mod boolean := public.is_moderator();
begin
  if not (is_member() or private.fam_ok()) then raise exception 'Members only'; end if;
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

notify pgrst, 'reload schema';
