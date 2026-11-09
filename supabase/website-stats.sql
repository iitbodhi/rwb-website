-- 53 · Website: live member count (just a number, no member details)
-- Run once in Supabase → SQL Editor. The website shows this on the home page ("640+ Members").
create or replace function public.public_member_count() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from members where status = 'active';
$$;
revoke all on function public.public_member_count() from public;
grant execute on function public.public_member_count() to anon, authenticated;
