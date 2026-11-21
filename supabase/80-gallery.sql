-- 80-gallery.sql (Nov 2026): RWB admins and coordinators add and delete Gallery photos from the app.
-- The photos themselves never touch Supabase: the phone sends them straight to the RWB Gallery Apps Script
-- (tools/gallery.gs), which saves them in the gallery's Google Drive folder.
-- Supabase only hands out a one-time pass (a ticket) for each add or delete, so the script knows the
-- request comes from a real admin or coordinator. Each pass is a few bytes; it is also the log of who did what.
-- Safe to run twice.

create table if not exists private.gallery_tickets (
  token      uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  who        text not null,
  role       text not null,
  action     text not null check (action in ('add', 'delete')),
  file_id    text,                         -- the Drive file, for a delete
  created_at timestamptz not null default now(),
  used_at    timestamptz
);
create index if not exists gallery_tickets_user_idx on private.gallery_tickets (user_id);
create index if not exists gallery_tickets_made_idx on private.gallery_tickets (created_at);

-- the phone asks for a pass (admins and coordinators only; at most 60 an hour each)
create or replace function public.gallery_ticket(p_action text, p_file text default null) returns uuid
language plpgsql security definer set search_path = public, private as $$
declare m record; t uuid;
begin
  select id, full_name, nickname, role into m from members
   where user_id = (select auth.uid()) and coalesce(status, 'active') = 'active'
     and role in ('coordinator', 'admin', 'superadmin') limit 1;
  if m is null then raise exception 'Only RWB admins and coordinators can change the gallery'; end if;
  if p_action not in ('add', 'delete') then raise exception 'Unknown gallery action'; end if;
  if p_action = 'delete' and coalesce(p_file, '') !~ '^[A-Za-z0-9_-]{10,}$' then raise exception 'Unknown photo'; end if;
  if (select count(*) from private.gallery_tickets where user_id = (select auth.uid()) and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That''s a lot of photos in one go. Please try again in a little while.';
  end if;
  delete from private.gallery_tickets where created_at < now() - interval '120 days';   -- keep the log for 4 months
  insert into private.gallery_tickets (user_id, who, role, action, file_id)
  values ((select auth.uid()), coalesce(nullif(m.nickname, ''), m.full_name), m.role, p_action, case when p_action = 'delete' then p_file end)
  returning token into t;
  return t;
end $$;
revoke execute on function public.gallery_ticket(text, text) from public, anon;
grant execute on function public.gallery_ticket(text, text) to authenticated;

-- the Gallery script spends the pass: valid once, for 15 minutes, for that action (and that photo)
create or replace function public.gallery_use_ticket(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t record;
begin
  update private.gallery_tickets set used_at = now()
   where token = p_token and used_at is null and created_at > now() - interval '15 minutes'
  returning * into t;
  if t is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'action', t.action, 'file', t.file_id, 'who', t.who, 'role', t.role);
end $$;
revoke execute on function public.gallery_use_ticket(uuid) from public;
grant execute on function public.gallery_use_ticket(uuid) to anon, authenticated;

-- the super admin can see who added or deleted what (Admin panel, later; or the SQL Editor)
create or replace function public.admin_gallery_log() returns table (at timestamptz, who text, role text, action text, file_id text)
language sql stable security definer set search_path = public, private as $$
  select used_at, who, role, action, file_id from private.gallery_tickets
   where used_at is not null and (select is_admin()) order by used_at desc limit 200
$$;
revoke execute on function public.admin_gallery_log() from public, anon;
grant execute on function public.admin_gallery_log() to authenticated;

notify pgrst, 'reload schema';
