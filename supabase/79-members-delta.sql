-- RWB setup file 79 (Nov 21 2026): the admin member list downloads only what changed.
-- Before: every time an admin opened Members, the app downloaded all ~700 members (~1.4 MB), the biggest
-- remaining egress on the free plan. Now the admin's phone keeps the list and asks
-- admin_members_since(<last time>) for just the members added, edited or removed since then (usually a few KB).
-- Safe to run twice.

-- 1) when each member row last changed
alter table public.members add column if not exists updated_at timestamptz not null default now();
create index if not exists members_updated_at_idx on public.members (updated_at);

create or replace function private.members_touch() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists zz_members_touch on public.members;
create trigger zz_members_touch before update on public.members for each row execute function private.members_touch();

-- 2) bike changes and removed members (kept in private tables, so the member row and its sheet triggers aren't touched)
create table if not exists private.member_touch (member_id bigint primary key, at timestamptz not null default now());
create table if not exists private.member_gone (member_id bigint primary key, at timestamptz not null default now());
create index if not exists member_touch_at_idx on private.member_touch (at);
create index if not exists member_gone_at_idx on private.member_gone (at);

create or replace function private.bikes_touch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.member_touch (member_id, at) values (coalesce(new.member_id, old.member_id), clock_timestamp())
  on conflict (member_id) do update set at = excluded.at;
  return null;
end $$;
drop trigger if exists member_bikes_touch on public.member_bikes;
create trigger member_bikes_touch after insert or update or delete on public.member_bikes for each row execute function private.bikes_touch();

create or replace function private.members_gone() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.member_gone (member_id, at) values (old.id, clock_timestamp())
  on conflict (member_id) do update set at = excluded.at;
  return null;
end $$;
drop trigger if exists members_gone on public.members;
create trigger members_gone after delete on public.members for each row execute function private.members_gone();

-- a member id that comes back (restore) is no longer "gone"
create or replace function private.members_back() returns trigger language plpgsql security definer set search_path = '' as $$
begin delete from private.member_gone where member_id = new.id; return null; end $$;
drop trigger if exists members_back on public.members;
create trigger members_back after insert on public.members for each row execute function private.members_back();

-- 3) admins: members changed since p_since (all of them when p_since is null), plus the ids removed since then
create or replace function public.admin_members_since(p_since timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_now timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'now', v_now,
    'full', p_since is null,
    'rows', coalesce((
      select jsonb_agg(to_jsonb(m) || jsonb_build_object('member_bikes', coalesce((
               select jsonb_agg(jsonb_build_object('slot', b.slot, 'vrn', b.vrn, 'model', b.model, 'verified', b.verified) order by b.slot)
               from public.member_bikes b where b.member_id = m.id), '[]'::jsonb)) order by m.full_name)
      from public.members m
      where p_since is null or m.updated_at > p_since
         or m.id in (select t.member_id from private.member_touch t where t.at > p_since)), '[]'::jsonb),
    'deleted', case when p_since is null then '[]'::jsonb else coalesce((
      select jsonb_agg(g.member_id) from private.member_gone g where g.at > p_since), '[]'::jsonb) end);
end $$;
revoke all on function public.admin_members_since(timestamptz) from public, anon;
grant execute on function public.admin_members_since(timestamptz) to authenticated;

notify pgrst, 'reload schema';
