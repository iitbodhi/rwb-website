-- RWB App setup file 67: the sheet's 12-hour check downloads ~7x less (Supabase egress).
-- Each member's join-form answers are keyed by the question's title, and the T&C question's title is ~10,000
-- characters, so every member carried it: 8.75 MB per check for 687 members, 96% of it that one title.
-- The check now gets each title cut to its first 120 characters (still unique); form-sync.gs matches a cut title
-- to its column by the start of the column title. Nothing else changes: the app still sees the full titles.
-- Also fixes the duplicates report (file 49): it cleared its list with a DELETE without WHERE, which Supabase
-- refuses when the call comes from the sheet, so admins' duplicate alerts stopped updating.
-- Safe to run more than once.

create or replace function public.sheet_export_all(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.sheet_ok(p_secret);
  delete from link_requests where status = 'rejected' and decided_at < now() - interval '60 days';
  return jsonb_build_object(
    'members', coalesce((select jsonb_agg(j || jsonb_build_object('answers',
          (select coalesce(jsonb_object_agg(left(k, 120), v), '{}'::jsonb) from jsonb_each(coalesce(j -> 'answers', '{}'::jsonb)) e(k, v))))
        from (select private.member_json(m) || jsonb_build_object('status', m.status, 'tnc_agreed', m.tnc_agreed,
          'on_app', m.user_id is not null, 'removed_note', m.removed_note, 'removed_at', m.removed_at) j from members m) x), '[]'::jsonb),
    'waiting', coalesce((select jsonb_agg(jsonb_build_object('phone', r.phone, 'form_ts', r.form_ts)) from link_requests r where r.status = 'pending'), '[]'::jsonb),
    'rejected', coalesce((select jsonb_agg(jsonb_build_object('phone', r.phone, 'form_ts', r.form_ts, 'reason', r.reject_reason))
        from link_requests r where r.status = 'rejected' and r.decided_at > now() - interval '60 days'
          and not exists (select 1 from members m where m.phone = r.phone and m.status = 'active')), '[]'::jsonb),
    'at', now());
end $$;
revoke execute on function public.sheet_export_all(text) from public;
grant execute on function public.sheet_export_all(text) to anon, authenticated;

create or replace function public.sheet_set_dupes(p_secret text, p_groups jsonb) returns integer
language plpgsql security definer set search_path = public, private as $$
declare g jsonb; ents jsonb; s text; n integer := 0; old jsonb;
begin
  perform private.sheet_ok(p_secret);
  select coalesce(jsonb_object_agg(gkey, seen_at), '{}'::jsonb) into old from private.sheet_dupes;   -- when each group was first seen
  delete from private.sheet_dupes where true;   -- "where true": Supabase refuses a DELETE without WHERE from the API
  for g in select * from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    -- entries an admin already removed (waiting for the sheet to move them) are left out
    select coalesce(jsonb_agg(e), '[]'::jsonb) into ents from jsonb_array_elements(g -> 'entries') e
    where not exists (select 1 from private.dupe_actions a where a.entry_id = e ->> 'id' and a.done_at is null);
    if jsonb_array_length(ents) < 2 then continue; end if;
    select string_agg(x, ',' order by x) into s from (select e ->> 'id' x from jsonb_array_elements(ents) e) q;
    if exists (select 1 from private.dupe_ignored where sig = s) then continue; end if;
    insert into private.sheet_dupes (gkey, kind, value, entries, sig, seen_at)
    values (g ->> 'key', coalesce(g ->> 'kind', ''), coalesce(g ->> 'value', ''), ents, s, coalesce((old ->> (g ->> 'key'))::timestamptz, now()))
    on conflict (gkey) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

notify pgrst, 'reload schema';
