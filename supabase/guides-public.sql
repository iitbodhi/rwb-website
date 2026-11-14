-- 73: Maintenance guides move from Google Drive into Guides (Nov 2026). Safe to run twice.
-- The 7 Drive PDFs were copied into rwb-media (GitHub, served by jsDelivr) as guide_items by a one-time job.
-- 1. roninwb.in/maintenance.html reads Maintenance PDFs from here (titles and file links only, nothing about who posted them).
create or replace function public.public_guides() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'description', description, 'url', url,
           'thumb', thumb_url, 'pages', pages, 'date', created_at) order by created_at desc), '[]'::jsonb)
  from public.guide_items where cat = 'maint' and kind = 'pdf';
$$;
revoke all on function public.public_guides() from public;
grant execute on function public.public_guides() to anon, authenticated;

-- 2. preview pictures for the moved PDFs (first page, kept on roninwb.in/assets/guides)
update public.guide_items g set thumb_url = 'https://roninwb.in/assets/guides/' || v.n || '.jpg'
from (values ('1MId9G2_rx4zHJxcQmtE3PgJ5JYxmXKoN', 1), ('1sgiv1YwZbC4smCZXXYzE2I64TY34ruKk', 2), ('1i3V_Z8s1sS5u4oD00SNVHS9oQ0Ibegs7', 3),
             ('1ljQojLMLtdKUeGgsPPr0t1hQaRRjEGJZ', 4), ('1ZvCrHWhqBNThisacmezfZEwBb0Z82A_9', 5), ('1jp-m-7RCA8mytQ-ie_WD6MdknQGosQuj', 6),
             ('1_OpAmGoMxeaGqt7aHsyIYEYjiIAyQBVG', 7)) as v(drive, n)
where g.path like '%' || v.drive || '.pdf' and g.thumb_url is null;

-- 3. Pookie already learned these PDFs under their Drive IDs: point those teachings at the moved copies, so he doesn't read them twice
update public.pookie_knowledge k set ref = 'gi-' || g.id
from public.guide_items g
where k.source = 'guide' and g.path like '%' || k.ref || '.pdf'
  and not exists (select 1 from public.pookie_knowledge x where x.source = 'guide' and x.ref = 'gi-' || g.id);

notify pgrst, 'reload schema';
