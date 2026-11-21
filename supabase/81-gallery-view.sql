-- 81-gallery-view.sql (Nov 2026): the full RWB Gallery list only for members and RWB FAM.
-- The RWB Gallery script (tools/gallery.gs) gives everyone else (roninwb.in, anyone who finds the script link)
-- only 30 random photos a day. The app asks for a one-time "view" pass (a few bytes, at most every 12 hours per
-- phone) and sends it with the list request; the script checks it with gallery_use_ticket.
-- View passes are deleted after a day (they're not part of the add/delete log). Safe to run twice.

alter table private.gallery_tickets drop constraint if exists gallery_tickets_action_check;
alter table private.gallery_tickets add constraint gallery_tickets_action_check check (action in ('add', 'delete', 'view'));

create or replace function public.gallery_ticket(p_action text, p_file text default null) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare m record; t uuid; uid uuid := (select auth.uid());
begin
  if p_action = 'view' then
    -- active members and approved RWB FAM
    if not exists (select 1 from members where user_id = uid and coalesce(status, 'active') = 'active') and not private.fam_ok() then
      raise exception 'Sign in to see the RWB Gallery';
    end if;
    if (select count(*) from private.gallery_tickets where user_id = uid and action = 'view' and created_at > now() - interval '1 hour') >= 20 then
      raise exception 'Please try again in a little while.';
    end if;
    delete from private.gallery_tickets where action = 'view' and created_at < now() - interval '1 day';
    insert into private.gallery_tickets (user_id, who, role, action) values (uid, 'viewer', 'viewer', 'view') returning token into t;
    return t;
  end if;
  select id, full_name, nickname, role into m from members
   where user_id = uid and coalesce(status, 'active') = 'active'
     and role in ('coordinator', 'admin', 'superadmin') limit 1;
  if m is null then raise exception 'Only RWB admins and coordinators can change the gallery'; end if;
  if p_action not in ('add', 'delete') then raise exception 'Unknown gallery action'; end if;
  if p_action = 'delete' and coalesce(p_file, '') !~ '^[A-Za-z0-9_-]{10,}$' then raise exception 'Unknown photo'; end if;
  if (select count(*) from private.gallery_tickets where user_id = uid and action <> 'view' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That''s a lot of photos in one go. Please try again in a little while.';
  end if;
  delete from private.gallery_tickets where action <> 'view' and created_at < now() - interval '120 days';
  insert into private.gallery_tickets (user_id, who, role, action, file_id)
  values (uid, coalesce(nullif(m.nickname, ''), m.full_name), m.role, p_action, case when p_action = 'delete' then p_file end)
  returning token into t;
  return t;
end $$;
revoke execute on function public.gallery_ticket(text, text) from public, anon;
grant execute on function public.gallery_ticket(text, text) to authenticated;

-- the log shows only adds and deletes
create or replace function public.admin_gallery_log() returns table (at timestamptz, who text, role text, action text, file_id text)
language sql stable security definer set search_path = public, private as $$
  select used_at, who, role, action, file_id from private.gallery_tickets
   where used_at is not null and action <> 'view' and (select is_admin()) order by used_at desc limit 200
$$;

notify pgrst, 'reload schema';
