-- 78: MotoMart categories (Nov 21 2026). The app now has one fixed list (no "Other").
-- Moves the posts that used older names into the new categories. Safe to run twice.
-- The listings_guard trigger is paused for this update so the posts keep their dates and status.
begin;
alter table public.listings disable trigger listings_guard;
update public.listings set category = v.cat
from (values
  (39, 'Mesh intercoms'),
  (21, 'Navigation screens and GPS'), (9, 'Navigation screens and GPS'),
  (38, 'Bike covers'), (6, 'Bike covers'),
  (14, 'Helmets'),
  (1, 'Riding jackets'), (36, 'Riding jackets'), (7, 'Riding jackets'), (11, 'Riding jackets'),
  (2, 'Handlebars and risers'), (3, 'Handlebars and risers'),
  (18, 'Grips and bar-end weights'),
  (15, 'Saddle bags and saddle stays'), (4, 'Saddle bags and saddle stays'),
  (16, 'Top boxes and top racks'),
  (10, 'Tail bags'),
  (35, 'Tank and handlebar bags'), (34, 'Tank and handlebar bags'),
  (32, 'Keychains and patches')
) as v(id, cat)
where listings.id = v.id and listings.category is distinct from v.cat;
alter table public.listings enable trigger listings_guard;
commit;
notify pgrst, 'reload schema';
