-- 60 · Which copy of the app each member uses (Play Store test, website APK or browser). Run once in Supabase → SQL Editor.
-- Safe to run more than once (the second version adds exact column types, so it works whatever type your columns have). The app notes it at most once a day; admins see the totals and who to nudge to the Play test.

create table if not exists public.app_seen (
  user_id uuid not null references auth.users on delete cascade,
  copy text not null check (copy in ('play', 'apk', 'browser')),
  build integer,
  seen_at timestamptz not null default now(),
  primary key (user_id, copy)
);
alter table public.app_seen enable row level security;   -- no policies: only the functions below touch it

-- the app: "I'm using this copy"
create or replace function public.app_seen_ping(p_copy text, p_build integer default null) returns void
language sql security definer set search_path = public as $$
  insert into app_seen (user_id, copy, build, seen_at)
  select auth.uid(), p_copy, p_build, now() where auth.uid() is not null and p_copy in ('play', 'apk', 'browser')
  on conflict (user_id, copy) do update set build = excluded.build, seen_at = now();
$$;

-- admins: every member with an app account and the copy they used in the last 30 days (Play beats APK beats browser)
drop function if exists public.admin_app_copies();
create or replace function public.admin_app_copies()
returns table (member_id bigint, full_name text, nickname text, phone text, avatar_url text, copy text, build integer, seen_at timestamptz, apk_too boolean)
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
  select m.id::bigint, m.full_name::text, m.nickname::text, m.phone::text, m.avatar_url::text,
         coalesce(b.copy, 'none')::text, b.build::integer, b.seen_at::timestamptz,
         exists (select 1 from app_seen s where s.user_id = m.user_id and s.copy = 'apk' and s.seen_at > now() - interval '30 days')
  from members m
  left join lateral (
    select s.copy, s.build, s.seen_at from app_seen s
    where s.user_id = m.user_id and s.seen_at > now() - interval '30 days'
    order by case s.copy when 'play' then 1 when 'apk' then 2 else 3 end, s.seen_at desc limit 1) b on true
  where m.user_id is not null and m.status = 'active' and coalesce(m.role, '') <> 'fam'
  order by m.full_name;
end $$;

revoke execute on function public.app_seen_ping(text, integer) from public, anon;
grant execute on function public.app_seen_ping(text, integer) to authenticated;
revoke execute on function public.admin_app_copies() from public, anon;
grant execute on function public.admin_app_copies() to authenticated;
notify pgrst, 'reload schema';
