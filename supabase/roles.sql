-- =====================================================================
-- RWB App: Coordinator role, RWB team on top of the member list, bike numbers visible
-- Run once in Supabase > SQL Editor, AFTER crew.sql. Safe to run again.
-- =====================================================================

-- 1. A new role: coordinator (Motomart moderators)
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check
  check (role in ('member','coordinator','admin','superadmin'));

create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid() and role in ('coordinator','admin','superadmin'));
$$;
revoke execute on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

-- Who can give which role:
--   admin rights: only the super admin
--   coordinator: any admin (or the super admin)
create or replace function public.admin_set_role(p_member_id bigint, p_role text) returns text
language plpgsql security definer set search_path = public as $$
declare cur text;
begin
  if p_role not in ('member','coordinator','admin') then raise exception 'Role must be member, coordinator or admin'; end if;
  select role into cur from members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;
  if cur = 'superadmin' or exists (select 1 from members where id = p_member_id and user_id = auth.uid()) then
    raise exception 'Your own role and the super admin role cannot be changed here';
  end if;
  if (p_role = 'admin' or cur = 'admin') and not is_superadmin() then raise exception 'Only the super admin can give or remove admin rights'; end if;
  if not is_admin() then raise exception 'Admins only'; end if;
  update members set role = p_role where id = p_member_id;
  return p_role;
end $$;

-- 2. Motomart: coordinators moderate exactly like admins
create or replace function public.listings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare adm boolean := is_moderator();
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid(); new.status := 'pending'; new.reject_reason := null;
    new.published_at := null; new.created_at := now(); new.updated_at := now();
    return new;
  end if;
  new.user_id := old.user_id; new.created_at := old.created_at; new.updated_at := now();
  if not adm then
    new.published_at := old.published_at;
    if old.status = 'rejected' or (old.status = 'pending' and new.status = 'pending') then
      new.status := 'pending'; new.reject_reason := null;
    elsif new.status is distinct from old.status
          and not (old.status in ('live','sold') and new.status in ('live','sold')) then
      raise exception 'This post is waiting for approval';
    else
      new.reject_reason := old.reject_reason;
    end if;
  end if;
  if new.status = 'live' and old.published_at is null then new.published_at := now(); end if;
  if new.status <> 'rejected' then new.reject_reason := null; end if;
  return new;
end $$;

drop policy if exists listings_read on public.listings;
create policy listings_read on public.listings for select to authenticated
  using ((status in ('live','sold') and public.is_member()) or user_id = auth.uid() or public.is_moderator());
drop policy if exists listings_change on public.listings;
create policy listings_change on public.listings for update to authenticated
  using (user_id = auth.uid() or public.is_moderator());
drop policy if exists listings_remove on public.listings;
create policy listings_remove on public.listings for delete to authenticated
  using (user_id = auth.uid() or public.is_moderator());

drop policy if exists motomart_see on storage.objects;
drop policy if exists motomart_remove on storage.objects;
create policy motomart_see on storage.objects for select to authenticated
  using (bucket_id = 'motomart' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_moderator()));
create policy motomart_remove on storage.objects for delete to authenticated
  using (bucket_id = 'motomart' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_moderator()));

-- "Post waiting for approval" alerts go to coordinators too
alter table public.notifications drop constraint if exists notifications_audience_check;
alter table public.notifications add constraint notifications_audience_check check (audience in ('all','admins','moderators'));
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using ((audience = 'all' and public.is_member()) or (audience = 'moderators' and public.is_moderator()) or public.is_admin());

create or replace function private.listing_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or (old.status <> 'pending' and new.status = 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'Motomart post waiting for approval',
            new.product_name || ' · ₹' || new.price || ' by ' || new.seller_name, '#motomart/review', 'moderators', new.user_id);
  elsif new.status = 'live' and old.status = 'pending' then
    insert into notifications (kind, title, body, url, created_by)
    values ('motomart', 'New on RWB Motomart', new.product_name || ' · ₹' || to_char(new.price, 'FM99,99,99,999'),
            '#motomart/' || new.id, new.user_id);
  end if;
  return new;
end $$;

create or replace function public.push_job(p_id bigint, p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n notifications;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'push_secret'), '') then
    raise exception 'Not allowed';
  end if;
  select * into n from notifications where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'subject',      (select value from private.config where key = 'vapid_subject'),
    'vapid_public', (select value from private.config where key = 'vapid_public'),
    'vapid_private',(select value from private.config where key = 'vapid_private'),
    'payload', jsonb_build_object('title', n.title, 'body', n.body, 'url', coalesce(n.url, '#home'), 'tag', n.kind || '-' || n.id),
    'subs', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
      from push_subscriptions s join members m on m.user_id = s.user_id
      where (n.audience = 'all'
             or (n.audience = 'admins' and m.role in ('admin','superadmin'))
             or (n.audience = 'moderators' and m.role in ('coordinator','admin','superadmin')))
        and (n.created_by is null or s.user_id <> n.created_by)
        and (n.kind in ('announcement','admin') or coalesce((m.notify ->> n.kind)::boolean, true))
    ), '[]'::jsonb));
end $$;

-- 3. Member list: bike numbers for everyone; the RWB team first, with their phone number for emergencies
drop function if exists public.member_directory();
create function public.member_directory()
returns table (id bigint, full_name text, nickname text, avatar_url text, bike text, vrn text, locality text, role text, phone text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select m.id, m.full_name, m.nickname, m.avatar_url, m.bike, m.vrn, m.locality, m.role,
           case when m.role in ('superadmin','admin','coordinator') then m.phone end,
           m.user_id is not null
    from members m
    order by case m.role when 'superadmin' then 0 when 'admin' then 1 when 'coordinator' then 2 else 3 end, m.full_name;
end $$;
revoke execute on function public.member_directory() from public, anon;
grant execute on function public.member_directory() to authenticated;

-- grants for the replaced functions
revoke execute on function public.admin_set_role(bigint, text) from public, anon;
grant execute on function public.admin_set_role(bigint, text) to authenticated;
revoke execute on function public.push_job(bigint, text) from public, anon, authenticated;
grant execute on function public.push_job(bigint, text) to service_role;
notify pgrst, 'reload schema';
