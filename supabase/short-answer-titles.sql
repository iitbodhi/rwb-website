-- RWB App setup file 68: lighter member data (faster Admin screens, less Supabase egress).
-- Join-form answers are stored by question title, and the T&C question's title is ~10,000 characters, so every
-- member and every join entry carried it: the admin member list was ~9 MB, 93% of it that one title.
-- Titles longer than 120 characters are now stored cut to their first 120 characters (all titles stay unique).
-- The app hides the T&C answer from "More from RWB" anyway, and form-sync.gs matches a cut title to its sheet
-- column by the start of the column title. A trigger keeps it that way for new answers, whatever sends them.
-- Safe to run more than once.

create or replace function private.short_keys(j jsonb) returns jsonb
language sql immutable as $$
  select case when j is null or jsonb_typeof(j) <> 'object' then j else
    (select coalesce(jsonb_object_agg(case when length(k) > 120 then left(k, 120) else k end, v), '{}'::jsonb) from jsonb_each(j) e(k, v)) end
$$;

create or replace function private.members_short_answers() returns trigger
language plpgsql as $$
begin new.form_answers := private.short_keys(new.form_answers); return new; end $$;
drop trigger if exists members_short_answers on public.members;
create trigger members_short_answers before insert or update of form_answers on public.members
  for each row execute function private.members_short_answers();

create or replace function private.requests_short_answers() returns trigger
language plpgsql as $$
begin new.answers := private.short_keys(new.answers); return new; end $$;
drop trigger if exists requests_short_answers on public.link_requests;
create trigger requests_short_answers before insert or update of answers on public.link_requests
  for each row execute function private.requests_short_answers();

-- existing records (quietly: nothing is sent to the sheet, and "last changed" dates stay as they are)
do $$
begin
  perform set_config('rwb.from_sheet', 'on', true);
  perform set_config('rwb.admin_check', 'on', true);
  update public.members set form_answers = form_answers
  where jsonb_typeof(form_answers) = 'object' and exists (select 1 from jsonb_object_keys(form_answers) k where length(k) > 120);
  update public.link_requests set answers = answers
  where jsonb_typeof(answers) = 'object' and exists (select 1 from jsonb_object_keys(answers) k where length(k) > 120);
end $$;

notify pgrst, 'reload schema';
