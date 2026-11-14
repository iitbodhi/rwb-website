-- 71 · RWB Merch "Free" (Nov 2026)
-- Free merch is saved with price 0. The app and roninwb.in show it as "Free"; this makes the
-- MotoMart notifications say "Free" instead of "₹0". Safe to run twice.

create or replace function private.listing_events() returns trigger
language plpgsql security definer set search_path to 'public' as $function$
declare went_live boolean;
        amt text := case when new.price = 0 then 'Free' else '₹' || to_char(new.price, 'FM99,99,99,999') end;
begin
  if (tg_op = 'INSERT' and new.status = 'pending') or (tg_op = 'UPDATE' and old.status <> 'pending' and new.status = 'pending') then
    insert into notifications (kind, title, body, url, audience, created_by)
    values ('admin', 'MotoMart post waiting for approval',
            new.product_name || ' · ' || amt || ' by ' || coalesce(new.seller_name, (select full_name from members where user_id = new.user_id limit 1), 'a member'),
            '#admin/motomart', 'moderators', new.user_id);
    return new;
  end if;
  went_live := new.status = 'live' and (tg_op = 'INSERT' or old.status = 'pending');
  if not went_live or new.kind = 'new' then return new; end if;
  insert into notifications (kind, title, body, url, created_by)
  values ('motomart', case when new.kind = 'merch' then 'New RWB Merch 🔥' else 'New on RWB MotoMart' end,
          new.product_name || ' · ' || amt, '#motomart/' || new.id, new.user_id);
  return new;
end $function$;

notify pgrst, 'reload schema';
