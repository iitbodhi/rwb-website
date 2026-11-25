-- 85: a tiny "how many riders are sharing on Track right now" number for the Track button's live ring.
-- Members get everyone sharing; RWB FAM get 1 when their own rider is sharing, else 0. A few bytes per call (egress-friendly).
-- Safe to run twice.
create or replace function public.track_live_count()
returns int language plpgsql stable security definer set search_path = public, private as $$
declare mid bigint; fid bigint;
begin
  select id into mid from members where user_id = (select auth.uid()) and status = 'active';
  if mid is not null then
    return (select count(*) from track_live l join members x on x.id = l.member_id and x.status = 'active' where l.until > now());
  end if;
  select member_id into fid from fam_members where user_id = (select auth.uid());
  if fid is null or not private.fam_ok() then return 0; end if;
  return (select count(*) from track_live l where l.member_id = fid and l.until > now());
end $$;
revoke all on function public.track_live_count() from public, anon;
grant execute on function public.track_live_count() to authenticated;
notify pgrst, 'reload schema';
