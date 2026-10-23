-- =====================================================================
-- RWB App: birthday wishes can tag the birthday rider (@number) in WhatsApp
-- Members get the phone number only of riders whose birthday is TODAY.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================
create or replace function public.birthdays(p_days integer default 0)
returns table (member_id bigint, full_name text, nickname text, day date, phone text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
declare d0 date := today_ist();
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select m.id, m.full_name, m.nickname, g.d::date,
           case when is_admin() or g.d::date = d0 then m.phone end, m.user_id is not null
    from generate_series(d0, d0 + greatest(0, least(p_days, 31)), interval '1 day') g(d)
    join members m on m.dob is not null and (
         (extract(month from m.dob) = extract(month from g.d) and extract(day from m.dob) = extract(day from g.d))
      or (extract(month from m.dob) = 2 and extract(day from m.dob) = 29
          and extract(month from g.d) = 2 and extract(day from g.d) = 28
          and extract(day from (date_trunc('year', g.d) + interval '2 months' - interval '1 day')) = 28))
    order by g.d, m.full_name;
end $$;
revoke execute on function public.birthdays(integer) from public, anon;
grant execute on function public.birthdays(integer) to authenticated;
notify pgrst, 'reload schema';
