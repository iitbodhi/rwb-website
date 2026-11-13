-- RWB App setup file 69: security tidy-up and housekeeping (Nov 2026 audit).
-- 1. 22 helper functions get a fixed search_path, so nobody can make them use a look-alike table or function
--    (Supabase security advisor: "function_search_path_mutable"). They work exactly as before.
-- 2. The scheduled jobs' run history (cron.job_run_details) grew by ~1,700 rows a day (Track's 1-minute job):
--    a daily job now keeps only the last 3 days.
-- 3. Three read rules made faster, 9 missing indexes added (Supabase performance advisor).
-- Safe to run more than once.

do $$
declare f text;
begin
  foreach f in array array[
    'private.change_vrn_clean()', 'private.dist_m(double precision, double precision, double precision, double precision)',
    'private.has_ronin(text)', 'private.hint_email(text)', 'private.mark_from_sheet()', 'private.mask_email(text)',
    'private.mask_name(text)', 'private.mask_phone(text)', 'private.members_short_answers()', 'private.members_vrn_check()',
    'private.missing_items(members)', 'private.norm_vrn(text)', 'private.request_touched()', 'private.requests_short_answers()',
    'private.shares(members, text)', 'private.short_keys(jsonb)', 'private.tnc_current()', 'private.tnc_stamp()',
    'private.track_ok(double precision, double precision)', 'private.vrn_clean()', 'private.vrn_taken_text(text, text, text)',
    'public.today_ist()']
  loop
    if to_regprocedure(f) is not null then
      execute format('alter function %s set search_path = public, private, extensions, pg_temp', f);
    end if;
  end loop;
end $$;

-- 2. keep 3 days of scheduled-job history
select cron.unschedule('rwb-cron-history') where exists (select 1 from cron.job where jobname = 'rwb-cron-history');
select cron.schedule('rwb-cron-history', '41 20 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
delete from cron.job_run_details where end_time < now() - interval '3 days';

-- 3. Speed (Supabase performance advisor): three read rules checked "who is asking" once per ROW; now once per
--    request, with the same meaning. The notifications list is read on every app open.
drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  ((audience = 'all') and (select is_member()))
  or ((audience = 'moderators') and (select is_moderator()))
  or ((audience = 'going') and exists (select 1 from event_rsvps r where r.event_id = notifications.event_id
        and r.user_id = (select auth.uid()) and r.status = any (array['going', 'maybe'])))
  or ((audience = 'user') and (target_user = (select auth.uid())))
  or ((audience <> 'user') and (select is_admin())));
drop policy if exists member_bikes_select on public.member_bikes;
create policy member_bikes_select on public.member_bikes for select to authenticated using (
  (select is_admin()) or member_id in (select m.id from members m where m.user_id = (select auth.uid())));
drop policy if exists change_requests_select on public.change_requests;
create policy change_requests_select on public.change_requests for select to authenticated using (
  (select is_admin()) or member_id in (select m.id from members m where m.user_id = (select auth.uid())));

-- 4. indexes for links between tables (faster deletes and look-ups)
create index if not exists event_expenses_created_by_idx on public.event_expenses (created_by);
create index if not exists event_expenses_paid_by_idx on public.event_expenses (paid_by);
create index if not exists events_created_by_idx on public.events (created_by);
create index if not exists notifications_created_by_idx on public.notifications (created_by);
create index if not exists notifications_event_id_idx on public.notifications (event_id);
create index if not exists notifications_target_user_idx on public.notifications (target_user);
create index if not exists reports_reporter_idx on public.reports (reporter);
create index if not exists track_live_event_id_idx on public.track_live (event_id);
create index if not exists track_sos_member_id_idx on public.track_sos (member_id);

notify pgrst, 'reload schema';
