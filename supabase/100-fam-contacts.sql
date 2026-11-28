-- 100-fam-contacts.sql (Nov 28 2026): RWB FAM Home buttons "Message / Call <rider>" and "Call RWB Coordinator".
-- Safe to run twice.
-- 1. fam_me: an approved FAM member also gets their OWN rider's WhatsApp number (nobody else's).
-- 2. fam_team(): first name, role and phone of RWB admins and coordinators, for approved RWB FAM members
--    (and members). Before this, FAM could only see the admins' numbers (join_help_admins).

create or replace function public.fam_me() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare f fam_members; m members;
begin
  select * into f from fam_members where user_id = auth.uid();
  if f.id is null then return null; end if;
  select * into m from members where id = f.member_id;
  return jsonb_build_object('id', f.id, 'full_name', f.full_name, 'phone', f.phone, 'address', f.address, 'email', f.email,
    'approved', f.approved, 'created_at', f.created_at, 'active', m.status = 'active',
    'member', case when f.approved and m.status = 'active' then jsonb_build_object('id', m.id, 'full_name', m.full_name, 'nickname', m.nickname,
      'avatar_url', m.avatar_url, 'bike', m.bike, 'odo', private.latest_odo(m.user_id), 'on_app', m.user_id is not null,
      'phone', case when length(coalesce(m.phone, '')) = 10 then m.phone end)
      else jsonb_build_object('full_name', m.full_name, 'nickname', m.nickname, 'avatar_url', m.avatar_url) end);
end $$;

create or replace function public.fam_team() returns table(first_name text, role text, phone text)
language sql stable security definer set search_path = public, private as $$
  select private.first_name(m.full_name), m.role, m.phone from members m
  where (select auth.uid()) is not null
    and ((select private.fam_ok()) or exists (select 1 from members x where x.user_id = (select auth.uid()) and x.status = 'active'))
    and m.status = 'active' and m.role in ('superadmin', 'admin', 'coordinator') and length(coalesce(m.phone, '')) = 10
  order by case m.role when 'coordinator' then 0 when 'superadmin' then 1 else 2 end, m.full_name
$$;
revoke execute on function public.fam_team() from public, anon;
grant execute on function public.fam_team() to authenticated;

notify pgrst, 'reload schema';
