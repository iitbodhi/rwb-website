-- 70 · RWB Merch: "Direct orders to WhatsApp" switch (Nov 2026)
-- Merch posts no longer carry a personal name or phone. Members tap "Get now" in the app, which opens:
--   1. the post's link (Google Form, store page…) when one is given, else
--   2. the RWB main WhatsApp group when wa_orders is on, else
--   3. RWB's Instagram.
-- roninwb.in always sends merch buyers to Instagram. Safe to run twice.

alter table public.listings add column if not exists wa_orders boolean not null default false;

-- merch never keeps a personal contact
update public.listings set seller_name = null, seller_phone = null
 where kind = 'merch' and (seller_name is not null or seller_phone is not null);

notify pgrst, 'reload schema';
