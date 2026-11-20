-- RWB App setup file 77: riders who aren't members yet (waiting, on hold or not approved) can delete their join
-- request and sign-in from the app ("Delete my request"), as Google Play requires for apps where accounts are made.
-- Deleting the sign-in already deletes the request (link_requests.user_id cascades); this also removes an old
-- Google Form entry from the sheet's Members tab and tells the admins. Safe to run more than once.

create or replace function public.delete_my_account(p_reason text default null) returns text
language plpgsql security definer set search_path = public, auth, private as $$
declare m members; f fam_members; r link_requests; note text := left(coalesce(nullif(trim(p_reason), ''), 'Deleted their account in the app'), 200);
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
  -- a rider with a join request (waiting, on hold or not approved)
  select * into r from link_requests where user_id = auth.uid() order by created_at desc limit 1;
  if r.id is not null then
    if r.source = 'form' and r.status in ('pending', 'hold') then
      perform private.sheet_post(jsonb_build_object('action', 'status', 'status', 'rejected', 'phone', r.phone, 'form_ts', r.form_ts, 'reason', 'Deleted by the rider'));
    end if;
    if r.status in ('pending', 'hold') then
      insert into notifications (kind, title, body, url, audience, created_by)
      values ('admin', 'Join request deleted', r.full_name || ' deleted their join request.', '#admin', 'admins', null);
    end if;
  end if;
  delete from auth.users where id = auth.uid();   -- also deletes the join request
  return 'deleted';
end $$;
revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

notify pgrst, 'reload schema';
