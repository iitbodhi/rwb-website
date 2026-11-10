-- RWB App setup file 52: "Delete my account" in the app (required by Google Play). Run after file 51. Safe to run more than once.
-- A member: they leave RWB, their app account and everything they added in the app (records, bills, fuel log, documents)
--   are deleted, like Admin → Remove. The member record stays as "Left", and their row moves to
--   "Removed members" in the admins' sheet, as the Privacy Policy says. Admins can bring them back.
-- An RWB FAM user: their FAM access and Google sign-in are deleted.
create or replace function public.delete_my_account(p_reason text default null) returns text
language plpgsql security definer set search_path = public, auth, private as $$
declare m members; f fam_members; note text := left(coalesce(nullif(trim(p_reason), ''), 'Deleted their account in the app'), 200);
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into m from members where user_id = auth.uid();
  if m.id is not null then
    if m.role = 'superadmin' then raise exception 'The super admin can''t delete this account. Hand over the role first.'; end if;
    update members set status = 'left', removed_at = now(), removed_by = 'Themself', removed_note = note,
                       role = 'member', removing = false, avatar_url = null, odo_km = null, odo_date = null, avg_kmpl = null, kmpl_tanks = null
    where id = m.id;
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'Member deleted their account', m.full_name || ' deleted their RWB App account' || case when note <> 'Deleted their account in the app' then ': ' || note else '.' end, '#admin', 'admins', auth.uid());
    delete from auth.users where id = auth.uid();
    return 'deleted';
  end if;
  select * into f from fam_members where user_id = auth.uid();
  if f.id is not null then
    delete from fam_members where id = f.id;
    delete from auth.users where id = auth.uid();
    return 'deleted';
  end if;
  delete from auth.users where id = auth.uid();   -- signed in but never joined
  return 'deleted';
end $$;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
notify pgrst, 'reload schema';
