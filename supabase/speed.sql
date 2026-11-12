-- 64 · Speed: makes the database answer the app faster. Nothing about who can see what changes.
-- Run once in Supabase → SQL Editor. Safe to run more than once.
--
-- 1. Security rules (row level security) asked "who is this user? are they a member / admin?" once for EVERY row
--    they looked at. With 600+ members that's hundreds of repeat checks per screen. Wrapping each check in
--    (select …) makes Postgres ask once per request instead (Supabase's own advice). Same rules, same results.
-- 2. Every table that stores a user's own rows gets an index on user_id, so "my services / my documents…" is instant.

do $$
declare
  p record; q text; c text; n int := 0; skipped int := 0;
  pat constant text := '(^|[^A-Za-z0-9_.])((auth\.uid|(public\.)?is_member|(public\.)?is_admin|(public\.)?is_moderator|(public\.)?is_superadmin|(public\.)?is_fam_viewer|private\.fam_ok|(public\.)?my_old_folders)\(\))';
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') ~ pat or coalesce(with_check, '') ~ pat)
      and position('SELECT' in upper(coalesce(qual, '') || coalesce(with_check, ''))) = 0   -- already done, or has its own sub-query
  loop
    q := case when p.qual is null then null else regexp_replace(p.qual, pat, '\1(select \2)', 'g') end;
    c := case when p.with_check is null then null else regexp_replace(p.with_check, pat, '\1(select \2)', 'g') end;
    begin
      execute format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename)
        || case when q is not null then format(' using (%s)', q) else '' end
        || case when c is not null then format(' with check (%s)', c) else '' end;
      n := n + 1;
    exception when others then
      skipped := skipped + 1;   -- e.g. a storage rule owned by Supabase itself: left as it was
    end;
  end loop;
  raise notice 'Faster security rules: % updated, % left as they were', n, skipped;
end $$;

do $$
declare t record; k int := 0;
begin
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'user_id'
      and not exists (                     -- no index starting with user_id yet
        select 1 from pg_index i
        join pg_class r on r.oid = i.indrelid join pg_namespace s on s.oid = r.relnamespace
        join pg_attribute a on a.attrelid = r.oid and a.attnum = i.indkey[0]
        where s.nspname = 'public' and r.relname = c.table_name and a.attname = 'user_id')
  loop
    execute format('create index if not exists %I on public.%I (user_id)', t.table_name || '_user_id_idx', t.table_name);
    k := k + 1;
  end loop;
  raise notice 'New user_id indexes: %', k;
end $$;

analyze;
notify pgrst, 'reload schema';
