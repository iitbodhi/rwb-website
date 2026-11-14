-- 72 · RWB Merch "Coming Soon" (Nov 2026)
-- A teaser post: no price (saved as 0), members see "Coming Soon" instead of "Get now" and can't order or
-- contact anyone; roninwb.in shows it the same way. Members get a "Coming soon" notification when it's posted
-- and a "Now available" one when the team turns Coming Soon off. Safe to run twice.

alter table public.listings add column if not exists coming_soon boolean not null default false;

create or replace function private.listing_events() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare went_live boolean;
        amt text := case when new.kind = 'merch' and new.coming_soon then 'Coming soon'
                         when new.price = 0 then 'Free' else '₹' || to_char(new.price, 'FM99,99,99,999') end;
begin
  if (tg_op = 'INSERT' and new.status = 'pending') or (tg_op = 'UPDATE' and old.status <> 'pending' and new.status = 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'MotoMart post waiting for approval',
            new.product_name || ' · ' || amt || ' by ' || coalesce(new.seller_name, (select full_name from members where user_id = new.user_id limit 1), 'a member'),
            '#admin/motomart', 'moderators', new.user_id);
    return new;
  end if;
  -- a teased merch item is launched: tell members it's out
  if tg_op = 'UPDATE' and new.kind = 'merch' and new.status = 'live' and old.status = 'live'
     and old.coming_soon and not new.coming_soon then
    insert into notifications (kind, title, body, url, created_by)
    values ('motomart', 'Now available on RWB Merch 🔥', new.product_name || ' · ' || amt, '#motomart/' || new.id, new.user_id);
    return new;
  end if;
  went_live := new.status = 'live' and (tg_op = 'INSERT' or old.status = 'pending');
  if not went_live or new.kind = 'new' then return new; end if;
  insert into notifications (kind, title, body, url, created_by)
  values ('motomart', case when new.kind = 'merch' and new.coming_soon then 'Coming soon on RWB Merch 👀'
                           when new.kind = 'merch' then 'New RWB Merch 🔥' else 'New on RWB MotoMart' end,
          new.product_name || ' · ' || amt, '#motomart/' || new.id, new.user_id);
  return new;
end $function$;

-- the website list: adds "soon" and hides the order link of teased items
create or replace function public.public_motomart() returns jsonb
language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'kind', l.kind, 'name', l.product_name, 'category', l.category, 'price', l.price,
        'description', l.details, 'link', case when l.coming_soon then null else l.link end,
        'image_url', l.image_url, 'photo', l.photos[1], 'status', l.status, 'soon', l.coming_soon)
        order by (l.status = 'sold'), l.price)
      from listings l
      where l.kind in ('new','merch') and l.status in ('live','sold')), '[]'::jsonb),
    'used_count', (select count(*) from listings where kind = 'used' and status = 'live'));
$function$;

notify pgrst, 'reload schema';
