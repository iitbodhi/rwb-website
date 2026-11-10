-- 59 · Pookie Warriors leaderboard: who has taught Pookie the most (Teach Pookie XP). Run once in Supabase → SQL Editor.
-- Needs setup file 56. Safe to run more than once. 10 XP for each answer admins approved, 2 for each waiting for a check.
create or replace function public.pookie_board()
returns table (member_id bigint, full_name text, nickname text, avatar_url text, bike text, xp integer, approved integer, is_me boolean)
language sql stable security definer set search_path = public, private as $$
  select x.id, x.full_name, x.nickname, x.avatar_url, x.bike,
         (count(*) filter (where a.status = 'approved') * 10 + count(*) filter (where a.status = 'pending') * 2)::int,
         (count(*) filter (where a.status = 'approved'))::int, x.user_id = auth.uid()
  from pookie_answers a join members x on x.user_id = a.user_id
  where x.status = 'active' and x.show_on_leaderboard
    and (exists (select 1 from members me where me.user_id = auth.uid() and me.status = 'active') or private.fam_ok())
  group by x.id
  having count(*) filter (where a.status in ('approved', 'pending')) > 0
  order by 6 desc limit 200
$$;
revoke execute on function public.pookie_board() from public, anon;
grant execute on function public.pookie_board() to authenticated;
