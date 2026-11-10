-- 55 · Report content + Grievance Officer queue (IT Rules 2021, as amended in 2026). Run once in Supabase → SQL Editor.
-- Safe to run more than once.
-- Members (and RWB FAM users) can report a Motomart post or a member's profile (photo / nickname). Every report:
--   * goes into a private queue that only admins and coordinators can see (Admin → Reports),
--   * sends a push to the admins straight away, so it can be acknowledged within 24 hours and resolved within 7 days
--     (2 hours for nudity, sexual content, impersonation or morphed images).

create table if not exists public.reports (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  reporter      uuid references auth.users(id) on delete set null,
  reporter_name text,
  kind          text not null check (kind in ('listing', 'member', 'other')),
  ref           text,
  label         text,
  reason        text not null,
  details       text,
  status        text not null default 'open' check (status in ('open', 'done')),
  outcome       text,
  handled_by    text,
  handled_at    timestamptz
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

-- report something (any signed-in member or RWB FAM user). At most 10 reports an hour per person.
create or replace function public.report_content(p_kind text, p_ref text, p_label text, p_reason text, p_details text default null)
returns bigint
language plpgsql security definer set search_path = public, private as $$
declare rid bigint; who text; urgent boolean;
begin
  if auth.uid() is null or not (is_member() or is_fam_viewer()) then raise exception 'Please sign in to report'; end if;
  if p_kind not in ('listing', 'member', 'other') then raise exception 'Unknown report type'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Choose a reason'; end if;
  if (select count(*) from reports where reporter = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have sent a lot of reports in the last hour. Please message an admin instead.';
  end if;
  select full_name into who from members where user_id = auth.uid() limit 1;
  if who is null then select coalesce(raw_user_meta_data ->> 'full_name', email) into who from auth.users where id = auth.uid(); end if;
  insert into reports (reporter, reporter_name, kind, ref, label, reason, details)
  values (auth.uid(), who, p_kind, left(p_ref, 100), left(p_label, 200), left(trim(p_reason), 100), nullif(left(trim(coalesce(p_details, '')), 1000), ''))
  returning id into rid;
  urgent := p_reason ~* '(nud|sexual|impersonat|fake profile|morphed)';
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('admin', case when urgent then '🚨 Urgent report: remove within 2 hours' else '🚩 New report' end,
          left(trim(p_reason), 100) || ' · ' || coalesce(left(p_label, 80), p_kind) || '. Admin → Reports.', '#admin', 'admins', auth.uid());
  return rid;
end $$;
revoke execute on function public.report_content(text, text, text, text, text) from public, anon;
grant execute on function public.report_content(text, text, text, text, text) to authenticated;

-- the queue (admins and coordinators): open first, then the last 60 days
create or replace function public.admin_reports() returns setof public.reports
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_moderator() then raise exception 'Admins only'; end if;
  return query select * from reports where status = 'open' or created_at > now() - interval '60 days'
    order by (status = 'open') desc, created_at desc limit 200;
end $$;
revoke execute on function public.admin_reports() from public, anon;
grant execute on function public.admin_reports() to authenticated;

-- close a report with what was done (e.g. "Post removed", "No action: not against the Terms")
create or replace function public.admin_report_done(p_id bigint, p_outcome text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_moderator() then raise exception 'Admins only'; end if;
  update reports set status = 'done', outcome = left(coalesce(nullif(trim(p_outcome), ''), 'Handled'), 300),
    handled_by = private.admin_name(), handled_at = now() where id = p_id;
  return 'done';
end $$;
revoke execute on function public.admin_report_done(bigint, text) from public, anon;
grant execute on function public.admin_report_done(bigint, text) to authenticated;

-- RWB is for riders aged 18 and over: an entry whose date of birth makes them under 18 can't be approved from the app
create or replace function private.no_minors() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and auth.uid() is not null
     and new.dob is not null and new.dob > (current_date - interval '18 years')::date then
    raise exception 'Under 18: RWB is for riders aged 18 and over, so this entry can''t be approved. Reject it, or correct the date of birth if it was a typo.';
  end if;
  return new;
end $$;
drop trigger if exists link_requests_no_minors on public.link_requests;
create trigger link_requests_no_minors before update on public.link_requests
  for each row execute function private.no_minors();
