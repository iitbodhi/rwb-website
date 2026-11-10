-- 54 · Remove Talk (voice messages) completely. Run once in Supabase → SQL Editor. Safe to run more than once.
-- Removes everything setup file 50 created: the hourly clean-up job, the storage rules, every Talk function and the
-- Talk tables (messages, receivers, settings, mutes). Nothing else is touched: Track, SOS, FAM, events and the rest
-- keep working as they are.
-- After running it, empty and delete the "talk" storage bucket: Storage → talk → ⋯ → Empty bucket, then Delete bucket.
-- (Supabase doesn't allow deleting stored files from SQL.)

-- the hourly clean-up job
do $$ begin
  perform cron.unschedule('rwb-talk-cleanup');
exception when others then null;
end $$;

-- storage rules for the talk bucket
drop policy if exists talk_add on storage.objects;
drop policy if exists talk_own_read on storage.objects;
drop policy if exists talk_own_delete on storage.objects;

-- every Talk function (public.talk_*, public.admin_talk_*, private.talk_*)
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and (p.proname like 'talk\_%' or p.proname like 'admin\_talk\_%')
  loop execute 'drop function if exists ' || f.sig || ' cascade'; end loop;
end $$;

-- the Talk tables
drop table if exists public.talk_recipients cascade;
drop table if exists public.talk_settings cascade;
drop table if exists public.talk_muted cascade;
drop table if exists public.talk_messages cascade;

-- the bucket becomes private and accepts no new files (delete it in Storage when it's empty)
update storage.buckets set public = false, allowed_mime_types = array['application/x-rwb-removed'] where id = 'talk';
