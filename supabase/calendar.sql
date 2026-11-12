-- 62 · Calendar: the member's own reminders, plus morning notifications for renewals, service and My Ride parts.
-- Run once in Supabase → SQL Editor. Safe to run more than once.
-- * my_reminders: private to each member (admins can't see them), like documents and My Ride.
--   source 'custom'  = reminders the member adds in the Calendar (FASTag recharge, loan EMI…), can repeat monthly or yearly.
--   source 'service' / 'part' = next service and parts due, worked out by the app and kept up to date by it.
-- * Every morning at 8:30 AM (IST) the database sends a notification (kind 'reminder', only to that member):
--   documents: 30, 7 and 1 day before the expiry date and on the day;  service and parts: 7 and 1 day before and on the day;
--   own reminders: the chosen number of days before and on the day.
--   Members can turn these off in Me → Notifications ("Renewal, service and my reminders").

create table if not exists public.my_reminders (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source      text not null default 'custom' check (source in ('custom', 'service', 'part')),
  key         text check (char_length(key) <= 60),                       -- 'service', 'part:engine_oil'… (app-made ones)
  title       text not null check (char_length(title) between 1 and 80),
  note        text check (char_length(note) <= 300),
  due_date    date not null,
  repeat      text not null default 'none' check (repeat in ('none', 'monthly', 'yearly')),
  notify_days integer not null default 1 check (notify_days between 0 and 60),
  url         text check (char_length(url) <= 60),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists my_reminders_user_idx on public.my_reminders (user_id, due_date);
create unique index if not exists my_reminders_key_idx on public.my_reminders (user_id, key) where key is not null;
alter table public.my_reminders enable row level security;
drop policy if exists my_reminders_own on public.my_reminders;
create policy my_reminders_own on public.my_reminders for all to authenticated
  using (user_id = auth.uid() and public.is_member()) with check (user_id = auth.uid() and public.is_member());
revoke all on public.my_reminders from anon;
grant select, insert, update, delete on public.my_reminders to authenticated;

-- The app sends its list of service / part due dates; old ones not in the list are removed
create or replace function public.sync_my_reminders(p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare it jsonb; k integer := 0; keys text[] := '{}';
begin
  if auth.uid() is null or not is_member() then raise exception 'Members only'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 40 then raise exception 'Bad list'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it->>'source', '') not in ('service', 'part') or coalesce(it->>'key', '') = '' then continue; end if;
    keys := keys || left(it->>'key', 60);
    insert into my_reminders (user_id, source, key, title, note, due_date, url, notify_days)
    values (auth.uid(), it->>'source', left(it->>'key', 60), left(coalesce(nullif(it->>'title', ''), 'Due'), 80), left(it->>'note', 300),
            (it->>'due_date')::date, left(it->>'url', 60), 7)
    on conflict (user_id, key) where key is not null do update
      set title = excluded.title, note = excluded.note, due_date = excluded.due_date, url = excluded.url, updated_at = now();
    k := k + 1;
  end loop;
  delete from my_reminders where user_id = auth.uid() and source <> 'custom' and not (key = any(keys));
  return k;
end $$;
revoke execute on function public.sync_my_reminders(jsonb) from public, anon;
grant execute on function public.sync_my_reminders(jsonb) to authenticated;

-- A new kind of notification: 'reminder' (members can switch it off in Me → Notifications)
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array['announcement','birthday','motomart','member','admin','event','personal','sos','reminder']));

-- Every morning: move repeating reminders on to their next date, then send what's due
create or replace function public.post_reminders() returns integer
language plpgsql security definer set search_path = public as $$
declare d date := today_ist(); r record; n integer := 0; left_days integer;
begin
  update my_reminders set due_date = (due_date + case when repeat = 'monthly' then interval '1 month' else interval '1 year' end)::date, updated_at = now()
  where repeat <> 'none' and due_date < d;
  -- (run again for anything more than one step behind)
  update my_reminders set due_date = (due_date + ((extract(year from age(d, due_date)) * 12 + extract(month from age(d, due_date)) + 1)::int * interval '1 month'))::date
  where repeat = 'monthly' and due_date < d;
  update my_reminders set due_date = (due_date + ((extract(year from age(d, due_date)) + 1)::int * interval '1 year'))::date
  where repeat = 'yearly' and due_date < d;

  for r in
    select x.user_id, x.title, x.body, x.url from (
      -- documents (DL, RC, PUC, insurance, others)
      select doc.user_id,
             case when doc.expiry_date = d then '📄 ' || coalesce(nullif(doc.title, ''), case doc.kind when 'dl' then 'Driving licence' when 'rc' then 'Registration (RC)' when 'puc' then 'PUC certificate' when 'insurance' then 'Insurance' else 'Document' end) || ' expires today'
                  else '📄 ' || coalesce(nullif(doc.title, ''), case doc.kind when 'dl' then 'Driving licence' when 'rc' then 'Registration (RC)' when 'puc' then 'PUC certificate' when 'insurance' then 'Insurance' else 'Document' end) || ' expires in ' || (doc.expiry_date - d) || case when doc.expiry_date - d = 1 then ' day' else ' days' end end as title,
             'Valid till ' || to_char(doc.expiry_date, 'FMDD Mon YYYY') || '. Renew it in time and update My documents.' as body,
             '#docs' as url
      from documents doc
      where doc.expiry_date is not null and (doc.expiry_date - d) in (30, 7, 1, 0)
      union all
      -- next service, My Ride parts, and the member's own reminders
      select m.user_id,
             case when m.due_date = d then (case when m.source = 'custom' then '⏰ ' else '🔧 ' end) || m.title || ' today'
                  else (case when m.source = 'custom' then '⏰ ' else '🔧 ' end) || m.title || ' in ' || (m.due_date - d) || case when m.due_date - d = 1 then ' day' else ' days' end end,
             coalesce(nullif(m.note, ''), 'On ' || to_char(m.due_date, 'FMDD Mon YYYY') || '.'),
             coalesce(m.url, '#calendar')
      from my_reminders m
      where (m.source = 'custom' and (m.due_date - d) in (m.notify_days, 0))
         or (m.source <> 'custom' and (m.due_date - d) in (7, 1, 0))
    ) x
    join members mem on mem.user_id = x.user_id and mem.status = 'active'
  loop
    -- never twice on the same day (if this runs again)
    if not exists (select 1 from notifications where kind = 'reminder' and target_user = r.user_id and title = left(r.title, 120)
                   and (created_at at time zone 'Asia/Kolkata')::date = d) then
      insert into notifications (kind, title, body, url, audience, target_user)
      values ('reminder', left(r.title, 120), left(r.body, 300), r.url, 'user', r.user_id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.post_reminders() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'rwb-reminders') then perform cron.unschedule('rwb-reminders'); end if;
  perform cron.schedule('rwb-reminders', '0 3 * * *', 'select public.post_reminders()');   -- 8:30 AM IST every day
end $$;

-- Pookie: knows about the Calendar
insert into public.pookie_knowledge (source, ref, title, content)
values ('admin', 'feature-calendar', 'The Calendar in the RWB App',
  'RWB admins: The RWB App has a Calendar. Tap the calendar button at the top of any screen (just left of the How-to videos button). '
  || 'It shows, month by month: RWB events (past and coming, with your RSVP), when your documents expire (DL, RC, PUC, insurance and others from My documents), '
  || 'your next service, when My Ride parts fall due (engine oil, chain, tyres, brake pads…; km-based dates are guessed from how much you ride), '
  || 'and the services, parts and fill-ups you logged, plus your own reminders (tap ＋ Reminder: e.g. FASTag recharge or loan EMI, can repeat every month or year). It does not show holidays. '
  || 'Tap the filter button next to the month to show or hide each kind. Tap any item to open it or add it to Google Calendar. '
  || 'You get a notification at about 8:30 AM: 30, 7 and 1 day before a document expires and on the day; 7 and 1 day before service and parts are due and on the day; and for your own reminders. '
  || 'Turn these off in Me → Notifications → "Renewal, service and my reminders". Only you can see your reminders.')
on conflict (source, ref) do update set title = excluded.title, content = excluded.content, active = true, updated_at = now();

notify pgrst, 'reload schema';
