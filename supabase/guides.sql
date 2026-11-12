-- 66 · Guides: one place (the ? button) for App, Maintenance and Ride guides: short videos, PDFs and images.
-- Run once in Supabase → SQL Editor, AFTER motomart.sql (65). Safe to run more than once.
--
-- What this does, in plain words:
-- 1. A new list, guide_items. Every item is in one category and is one kind:
--      categories: app (how to use the RWB App), maint (maintenance), ride (riding)
--      kinds:      video (a short, 60 seconds or less), pdf, image
--    The App category only has videos.
-- 2. Who can add things:
--      super admin (Bodhi): App, Maintenance and Ride
--      admins:              Maintenance and Ride
--      coordinators:        Ride
--      members:             nothing (they can watch, read and search everything)
--    Whoever added an item can change its title or delete it, as long as they can still post in that category.
--    Admins can also change or delete anyone's item in the categories they can post in.
-- 3. The files themselves are NOT stored in Supabase (to keep the free storage and data allowance safe).
--    The "guides-media" Edge Function puts them in a free GitHub repository and they are served free by jsDelivr.
--    Only that function can add or delete items (the app can't write to this list directly).
-- 4. Limits (also checked by the app and the function): videos up to 60 s and 20 MB (the app shrinks them to 720p),
--    PDFs up to 10 MB, images shrunk to about 300 KB. Admins can add 25 items a day, coordinators 10.

-- ---------- 1. The list ----------
create table if not exists public.guide_items (
  id          bigint generated always as identity primary key,
  cat         text not null check (cat in ('app','maint','ride')),
  kind        text not null check (kind in ('video','pdf','image')),
  title       text not null check (char_length(btrim(title)) between 2 and 80),
  description text check (description is null or char_length(description) <= 400),
  tags        text check (tags is null or char_length(tags) <= 200),
  url         text not null check (url ~ '^https://' and char_length(url) <= 600),
  thumb_url   text check (thumb_url is null or (thumb_url ~ '^https://' and char_length(thumb_url) <= 600)),
  path        text,          -- where the file sits in the GitHub repository (used to delete it)
  thumb_path  text,
  file_sha    text,
  thumb_sha   text,
  bytes       integer check (bytes is null or bytes between 0 and 21000000),
  duration_s  real check (duration_s is null or duration_s between 0 and 62),
  width       integer,
  height      integer,
  pages       integer,
  user_id     uuid references auth.users(id) on delete set null default auth.uid(),
  uploader    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint guide_items_app_videos check (cat <> 'app' or kind = 'video')
);
create index if not exists guide_items_cat_idx on public.guide_items (cat, kind, created_at desc);
create index if not exists guide_items_user_idx on public.guide_items (user_id);

alter table public.guide_items enable row level security;
revoke insert, update, delete on public.guide_items from anon, authenticated;
grant select on public.guide_items to authenticated;

drop policy if exists guide_items_read on public.guide_items;
create policy guide_items_read on public.guide_items for select to authenticated using ((select is_member()));

-- ---------- 2. Who can post where ----------
create or replace function public.guide_my_cats() returns text[]
language sql stable security definer set search_path = public as $$
  select case (select role from members where user_id = auth.uid() and coalesce(status, 'active') = 'active' limit 1)
    when 'superadmin'  then array['app','maint','ride']
    when 'admin'       then array['maint','ride']
    when 'coordinator' then array['ride']
    else '{}'::text[] end
$$;
revoke execute on function public.guide_my_cats() from public, anon;
grant execute on function public.guide_my_cats() to authenticated;

create or replace function public.guide_can(p_cat text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_cat = any(guide_my_cats())
$$;
revoke execute on function public.guide_can(text) from public, anon;
grant execute on function public.guide_can(text) to authenticated;

-- may I change or delete this item?
create or replace function public.guide_can_manage(p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from guide_items g where g.id = p_id and guide_can(g.cat) and (g.user_id = auth.uid() or is_admin()))
$$;
revoke execute on function public.guide_can_manage(bigint) from public, anon;
grant execute on function public.guide_can_manage(bigint) to authenticated;

-- how many items I added today (the function uses it for the daily limit) and how much space all files use
create or replace function public.guide_usage() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bytes', coalesce((select sum(coalesce(bytes, 0)) from guide_items), 0),
    'items', (select count(*) from guide_items),
    'today', (select count(*) from guide_items where user_id = auth.uid() and created_at > now() - interval '24 hours'),
    'cats',  guide_my_cats())
$$;
revoke execute on function public.guide_usage() from public, anon;
grant execute on function public.guide_usage() to authenticated;

-- change the title, description or keywords
create or replace function public.guide_edit(p_id bigint, p_title text, p_description text, p_tags text) returns public.guide_items
language plpgsql security definer set search_path = public as $$
declare r guide_items;
begin
  if not guide_can_manage(p_id) then raise exception 'You can''t change this item'; end if;
  update guide_items set title = btrim(p_title), description = nullif(btrim(coalesce(p_description, '')), ''),
         tags = nullif(btrim(coalesce(p_tags, '')), ''), updated_at = now()
   where id = p_id returning * into r;
  return r;
end $$;
revoke execute on function public.guide_edit(bigint, text, text, text) from public, anon;
grant execute on function public.guide_edit(bigint, text, text, text) to authenticated;

notify pgrst, 'reload schema';
