-- 65 · MotoMart: one shop for used gear, new accessories and RWB merch.
-- Run once in Supabase → SQL Editor, AFTER speed.sql (64). Safe to run more than once.
--
-- What this does, in plain words:
-- 1. Every MotoMart post gets a "kind":
--      used  = a member selling their own gear (same as before: an admin/coordinator approves it first)
--      new   = a new accessory listed by an admin/coordinator, with a link to the store page (replaces the Accessories sheet)
--      merch = RWB merch listed by an admin/coordinator (replaces the RWB Marketplace sheet)
--    Only admins and coordinators can list "new" and "merch". Those go live at once (no approval step).
-- 2. When a post is marked sold, the date is kept. The app deletes sold USED posts and their photos 15 days later.
-- 3. roninwb.in reads new accessories and merch straight from here (public_motomart). No seller phone numbers are shared.
-- 4. A one-time import moves the rows from the two old Google Sheets into the app (admin_import_listings).

-- ---------- 1. New columns ----------
alter table public.listings add column if not exists kind      text not null default 'used';
alter table public.listings add column if not exists link      text;
alter table public.listings add column if not exists image_url text;
alter table public.listings add column if not exists sold_at   timestamptz;
alter table public.listings add column if not exists source_key text;

-- seller name and phone are needed only for used gear (new accessories and merch have no private seller)
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
end $$;
create unique index if not exists listings_source_key_idx on public.listings (source_key) where source_key is not null;
create index if not exists listings_kind_idx on public.listings (kind, status);

-- posts already marked sold: count their 15 days from their last change
update public.listings set sold_at = updated_at where status = 'sold' and sold_at is null;

-- ---------- 2. Rules (enforced by the database) ----------
create or replace function public.listings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare adm boolean := is_moderator();
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid(); new.created_at := now(); new.updated_at := now(); new.reject_reason := null;
    new.kind := coalesce(new.kind, 'used');
    if new.kind in ('new','merch') then
      if not adm then raise exception 'Only admins and coordinators can list accessories and merch'; end if;
      new.status := case when new.status = 'sold' then 'sold' else 'live' end;   -- the team's own listings go live at once
      new.published_at := now();
      new.sold_at := case when new.status = 'sold' then now() end;
    else
      new.status := 'pending'; new.published_at := null; new.sold_at := null;
    end if;
    return new;
  end if;

  new.user_id := old.user_id; new.created_at := old.created_at; new.updated_at := now();
  new.kind := old.kind;                                   -- a post can't switch between used / new / merch
  new.source_key := old.source_key;
  if old.kind in ('new','merch') and not adm then raise exception 'Only admins and coordinators can change this'; end if;
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
  if new.status = 'sold' then new.sold_at := coalesce(case when old.status = 'sold' then old.sold_at end, now()); else new.sold_at := null; end if;
  return new;
end $$;
drop trigger if exists listings_guard on public.listings;
create trigger listings_guard before insert or update on public.listings
  for each row execute function public.listings_guard();

-- ---------- 3. Notifications ----------
-- used gear: the team hears about posts to approve; everyone hears when one goes live
-- merch: everyone hears about new merch.  new accessories: no alert (they are often added in bulk)
create or replace function private.listing_events() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('rwb.quiet', true), '') = 'on' then return new; end if;
  if new.kind = 'merch' then
    if tg_op = 'INSERT' and new.status = 'live' then
      insert into notifications (kind, title, body, url, created_by)
      values ('motomart', 'New RWB Merch 🔥', new.product_name || ' · ₹' || to_char(new.price, 'FM99,99,99,999'), '#motomart/' || new.id, new.user_id);
    end if;
    return new;
  end if;
  if new.kind <> 'used' then return new; end if;
  if (tg_op = 'INSERT' and new.status = 'pending') or (tg_op = 'UPDATE' and old.status <> 'pending' and new.status = 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'MotoMart post waiting for approval',
            new.product_name || ' · ₹' || new.price || ' by ' || coalesce(new.seller_name, 'a member'), '#admin/motomart', 'admins', new.user_id);
  elsif tg_op = 'UPDATE' and new.status = 'live' and old.status = 'pending' then
    insert into notifications (kind, title, body, url, created_by)
    values ('motomart', 'New on RWB MotoMart', new.product_name || ' · ₹' || to_char(new.price, 'FM99,99,99,999'),
            '#motomart/' || new.id, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists listings_events on public.listings;
create trigger listings_events after insert or update of status on public.listings
  for each row execute function private.listing_events();

-- ---------- 4. What roninwb.in shows ----------
-- New accessories and merch only (no seller names or phone numbers), plus how many used items are on sale in the app.
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

-- ---------- 5. One-time import from the two old Google Sheets ----------
-- Admins and coordinators only. Quiet (no notifications). The same sheet row is never added twice.
create or replace function public.admin_import_listings(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare r jsonb; n integer := 0; k integer;
begin
  if not is_moderator() then raise exception 'Admins and coordinators only'; end if;
  perform set_config('rwb.quiet', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if nullif(trim(r ->> 'product_name'), '') is null or coalesce(r ->> 'kind', '') not in ('new','merch') then continue; end if;
    insert into listings (kind, product_name, category, price, details, link, image_url, status, source_key)
    values (r ->> 'kind', left(trim(r ->> 'product_name'), 120), left(coalesce(nullif(trim(r ->> 'category'), ''), 'Other'), 60),
            greatest(0, least(10000000, coalesce(nullif(regexp_replace(r ->> 'price', '[^0-9]', '', 'g'), '')::numeric, 0)))::int,
            left(nullif(trim(r ->> 'details'), ''), 1000),
            case when r ->> 'link' ~* '^https?://' then left(r ->> 'link', 1000) end,
            case when r ->> 'image_url' ~* '^https://' then left(r ->> 'image_url', 1500) end,
            case when r ->> 'status' = 'sold' then 'sold' else 'live' end,
            left(r ->> 'source_key', 300))
    on conflict (source_key) where source_key is not null do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function public.admin_import_listings(jsonb) from public, anon;
grant execute on function public.admin_import_listings(jsonb) to authenticated;

notify pgrst, 'reload schema';
