-- 65 · MotoMart: one shop for used gear, new accessories and RWB merch, plus the coordinators' panel.
-- Run once in Supabase → SQL Editor, AFTER speed.sql (64). Safe to run more than once.
--
-- What this does, in plain words:
-- 1. Every MotoMart post gets a "kind":
--      used  = a member selling their own gear
--      new   = a new accessory, with a link to the store page (admins and coordinators only)
--      merch = RWB merch (admins and coordinators only)
-- 2. Who needs approval:
--      admins: nothing they post needs approval, it goes live at once
--      members and coordinators: every post waits until an admin or ANOTHER coordinator approves it
--      (nobody except an admin can approve their own post)
-- 3. New accessories can't be "sold": they only send people to the store. Edit or delete them instead.
--    Merch can be marked sold out and back in stock. Used gear marked sold is deleted (with photos) 15 days later by the app.
-- 4. roninwb.in reads new accessories and merch straight from here (public_motomart). No names or phone numbers are shared.
-- 5. Photos: only small JPEG/WebP pictures (the app shrinks them to about 200 KB), at most 400 KB each, in the poster's own folder.
--    A member can have at most 8 posts on sale or waiting at a time, and post at most 5 a day (keeps the free storage safe).
-- 6. Coordinators can now approve Teach Pookie answers (not their own) and handle reports, as well as MotoMart posts.

-- ---------- 1. New columns ----------
alter table public.listings add column if not exists kind      text not null default 'used';
alter table public.listings add column if not exists link      text;
alter table public.listings add column if not exists image_url text;
alter table public.listings add column if not exists sold_at   timestamptz;

-- seller name and phone are needed only for used gear (accessories and merch have no private seller)
alter table public.listings alter column seller_name  drop not null;
alter table public.listings alter column seller_phone drop not null;

do $$ begin
  alter table public.listings drop constraint if exists listings_kind_check;
  alter table public.listings add constraint listings_kind_check check (kind in ('used','new','merch'));
  alter table public.listings drop constraint if exists listings_seller_needed;
  alter table public.listings add constraint listings_seller_needed check (kind <> 'used' or (seller_name is not null and seller_phone is not null));
  alter table public.listings drop constraint if exists listings_link_check;
  alter table public.listings add constraint listings_link_check check (link is null or (link ~* '^https?://' and char_length(link) <= 1000));
  alter table public.listings drop constraint if exists listings_image_url_check;
  alter table public.listings add constraint listings_image_url_check check (image_url is null or (image_url ~* '^https://' and char_length(image_url) <= 1500));
  alter table public.listings drop constraint if exists listings_photos_check;
  alter table public.listings drop constraint if exists listings_photos_max;
  alter table public.listings add constraint listings_photos_max check (cardinality(photos) <= 5) not valid;   -- old posts are left as they are
end $$;
create index if not exists listings_kind_idx on public.listings (kind, status);

-- posts already marked sold: count their 15 days from their last change
update public.listings set sold_at = updated_at where status = 'sold' and sold_at is null;

-- ---------- 2. Rules (enforced by the database) ----------
create or replace function public.listings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  adm boolean := is_admin();
  modr boolean := is_moderator();
  judge boolean;   -- may approve / reject / change anything on this post
begin
  if tg_op = 'INSERT' then
    new.user_id := me; new.created_at := now(); new.updated_at := now(); new.reject_reason := null;
    new.kind := coalesce(new.kind, 'used');
    if new.kind in ('new','merch') and not modr then raise exception 'Only admins and coordinators can list accessories and merch'; end if;
    if not adm then
      if (select count(*) from listings where user_id = me and status in ('pending','live')) >= 8 then
        raise exception 'You already have 8 posts on MotoMart. Mark one sold or delete one first.';
      end if;
      if (select count(*) from listings where user_id = me and created_at > now() - interval '1 day') >= 5 then
        raise exception 'That''s 5 posts today. Please post the rest tomorrow.';
      end if;
    end if;
    if adm then   -- admins: live at once
      new.status := case when new.status = 'sold' and new.kind = 'merch' then 'sold' else 'live' end;
      new.published_at := now();
    else          -- members and coordinators: an admin or another coordinator approves it
      new.status := 'pending'; new.published_at := null;
    end if;
    new.sold_at := case when new.status = 'sold' then now() end;
    return new;
  end if;

  judge := adm or (modr and old.user_id is distinct from me);
  new.user_id := old.user_id; new.created_at := old.created_at; new.updated_at := now();
  new.kind := old.kind;                                   -- a post can't switch between used / new / merch
  if old.kind in ('new','merch') and not modr then raise exception 'Only admins and coordinators can change this'; end if;
  if new.kind = 'new' and new.status = 'sold' then raise exception 'Accessories can''t be marked sold. Edit or delete the listing instead.'; end if;
  if not judge then
    new.published_at := old.published_at;
    if old.status = 'rejected' or (old.status = 'pending' and new.status = 'pending') then
      new.status := 'pending'; new.reject_reason := null;
    elsif new.status is distinct from old.status
          and not (old.status in ('live','sold') and new.status in ('live','sold')) then
      raise exception 'This post is waiting for approval by an admin or another coordinator';
    else
      new.reject_reason := old.reject_reason;
    end if;
  end if;
  if new.status = 'live' and old.published_at is null then new.published_at := now(); end if;
  if new.status <> 'rejected' then new.reject_reason := null; end if;
  if new.status = 'sold' then new.sold_at := coalesce(case when old.status = 'sold' then old.sold_at end, now()); else new.sold_at := null; end if;
  return new;
end $$;
drop trigger if exists listings_guard on public.listings;
create trigger listings_guard before insert or update on public.listings
  for each row execute function public.listings_guard();

-- ---------- 3. Notifications ----------
-- waiting posts: admins and coordinators hear about them. Going live: used gear and merch tell everyone; accessories stay quiet.
create or replace function private.listing_events() returns trigger
language plpgsql security definer set search_path = public as $$
declare went_live boolean;
begin
  if (tg_op = 'INSERT' and new.status = 'pending') or (tg_op = 'UPDATE' and old.status <> 'pending' and new.status = 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'MotoMart post waiting for approval',
            new.product_name || ' · ₹' || new.price || ' by ' || coalesce(new.seller_name, (select full_name from members where user_id = new.user_id limit 1), 'a member'),
            '#admin/motomart', 'moderators', new.user_id);
    return new;
  end if;
  went_live := new.status = 'live' and (tg_op = 'INSERT' or old.status = 'pending');
  if not went_live or new.kind = 'new' then return new; end if;
  insert into notifications (kind, title, body, url, created_by)
  values ('motomart', case when new.kind = 'merch' then 'New RWB Merch 🔥' else 'New on RWB MotoMart' end,
          new.product_name || ' · ₹' || to_char(new.price, 'FM99,99,99,999'), '#motomart/' || new.id, new.user_id);
  return new;
end $$;
drop trigger if exists listings_events on public.listings;
create trigger listings_events after insert or update of status on public.listings
  for each row execute function private.listing_events();

-- ---------- 4. Photos: small pictures only, in your own folder ----------
update storage.buckets set file_size_limit = 409600, allowed_mime_types = array['image/jpeg','image/webp'] where id = 'motomart';
drop policy if exists motomart_add on storage.objects;
create policy motomart_add on storage.objects for insert to authenticated
  with check (bucket_id = 'motomart' and (storage.foldername(name))[1] = (select auth.uid())::text
              and lower(storage.extension(name)) in ('jpg','jpeg','webp') and (select public.is_member()));

-- ---------- 5. What roninwb.in shows ----------
-- New accessories and merch only (no names or phone numbers), plus how many used items are on sale in the app.
create or replace function public.public_motomart() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'kind', l.kind, 'name', l.product_name, 'category', l.category, 'price', l.price,
        'description', l.details, 'link', l.link, 'image_url', l.image_url, 'photo', l.photos[1], 'status', l.status)
        order by (l.status = 'sold'), l.price)
      from listings l
      where l.kind in ('new','merch') and l.status in ('live','sold')), '[]'::jsonb),
    'used_count', (select count(*) from listings where kind = 'used' and status = 'live'));
$$;
revoke execute on function public.public_motomart() from public;
grant execute on function public.public_motomart() to anon, authenticated;

-- ---------- 6. Coordinators' panel: Teach Pookie answers (reports already allow coordinators) ----------
-- Coordinators see and judge other people's answers; only admins can approve their own.
create or replace function public.admin_teach_queue()
returns table (id bigint, question text, category text, answer text, member_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_moderator() then raise exception 'Admins and coordinators only'; end if;
  return query select a.id, q.question, q.category, a.answer, a.member_name, a.created_at
    from pookie_answers a join pookie_questions q on q.id = a.question_id
    where a.status = 'pending' and (is_admin() or a.user_id is distinct from auth.uid())
    order by a.created_at limit 200;
end $$;
revoke execute on function public.admin_teach_queue() from public, anon;
grant execute on function public.admin_teach_queue() to authenticated;

create or replace function public.admin_pookie_pending() returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_moderator() then raise exception 'Admins and coordinators only'; end if;
  return (select count(*) from pookie_answers where status = 'pending' and (is_admin() or user_id is distinct from auth.uid()));
end $$;
revoke execute on function public.admin_pookie_pending() from public, anon;
grant execute on function public.admin_pookie_pending() to authenticated;

create or replace function public.admin_teach_review(p_id bigint, p_ok boolean, p_text text default null) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_moderator() then raise exception 'Admins and coordinators only'; end if;
  if not is_admin() and exists (select 1 from pookie_answers where id = p_id and user_id = auth.uid()) then
    raise exception 'Another admin or coordinator checks your own answers';
  end if;
  if p_ok then perform private.pookie_learn(p_id, p_text); return 'approved'; end if;
  update pookie_answers set status = 'rejected', final = null, reviewed_by = private.admin_name(), reviewed_at = now() where id = p_id;
  if not found then raise exception 'Answer not found'; end if;
  update pookie_knowledge set active = false, updated_at = now() where source = 'answer' and ref = p_id::text;
  return 'rejected';
end $$;
revoke execute on function public.admin_teach_review(bigint, boolean, text) from public, anon;
grant execute on function public.admin_teach_review(bigint, boolean, text) to authenticated;

-- the old one-time sheet import (from an earlier draft of this file) isn't used
drop function if exists public.admin_import_listings(jsonb);
alter table public.listings drop column if exists source_key;

notify pgrst, 'reload schema';
