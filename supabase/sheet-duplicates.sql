-- RWB App setup file 49: duplicates in the RWB contact sheet are never removed by themselves any more.
-- Every 10 minutes the sheet reports rows that share a WhatsApp number or a VRN. Admins see an alert in the app
-- (Home and Admin → Duplicates) and choose which entry to keep and which to remove:
--   * a removed entry with the same number as a kept one: only its sheet row moves to the "Older entries" tab;
--   * a removed entry with a different number: that member is removed from RWB (like Admin → Remove), and their
--     row moves to "Removed members", so they can be restored later;
--   * "Not a duplicate": the group is never shown again (unless its entries change).
-- Run after file 48. Safe to run more than once.

create table if not exists private.sheet_dupes (
  gkey    text primary key,                 -- vrn:WB02AB1234 or phone:9876543210
  kind    text not null,                    -- vrn | phone
  value   text not null,
  entries jsonb not null,                   -- [{id, row, name, phone, vrn, email, joined, status, filled, tnc, best}]
  sig     text not null,                    -- the entry ids, sorted: the same group with the same entries
  seen_at timestamptz not null default now()
);
create table if not exists private.dupe_ignored (sig text primary key, by_name text, at timestamptz not null default now());
create table if not exists private.dupe_actions (
  id bigserial primary key, entry_id text not null, gkey text, note text, by_name text,
  at timestamptz not null default now(), done_at timestamptz, result text
);

-- the sheet reports every duplicate group it finds (replaces the last report)
create or replace function public.sheet_set_dupes(p_secret text, p_groups jsonb) returns integer
language plpgsql security definer set search_path = public, private as $$
declare g jsonb; ents jsonb; s text; n integer := 0; old jsonb;
begin
  perform private.sheet_ok(p_secret);
  select coalesce(jsonb_object_agg(gkey, seen_at), '{}'::jsonb) into old from private.sheet_dupes;   -- when each group was first seen
  delete from private.sheet_dupes;
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
revoke execute on function public.sheet_set_dupes(text, jsonb) from public;
grant execute on function public.sheet_set_dupes(text, jsonb) to anon, authenticated;

-- the sheet asks which rows admins removed, then says what it did
create or replace function public.sheet_dupe_actions(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  perform private.sheet_ok(p_secret);
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'entry', entry_id, 'note', note) order by id)
    from private.dupe_actions where done_at is null), '[]'::jsonb);
end $$;
revoke execute on function public.sheet_dupe_actions(text) from public;
grant execute on function public.sheet_dupe_actions(text) to anon, authenticated;

create or replace function public.sheet_dupe_done(p_secret text, p_done jsonb) returns integer
language plpgsql security definer set search_path = public, private as $$
declare n integer;
begin
  perform private.sheet_ok(p_secret);
  update private.dupe_actions a set done_at = now(), result = left(coalesce(d ->> 'result', 'done'), 100)
  from jsonb_array_elements(coalesce(p_done, '[]'::jsonb)) d where a.id = (d ->> 'id')::bigint and a.done_at is null;
  get diagnostics n = row_count;
  delete from private.dupe_actions where done_at < now() - interval '30 days';
  return n;
end $$;
revoke execute on function public.sheet_dupe_done(text, jsonb) from public;
grant execute on function public.sheet_dupe_done(text, jsonb) to anon, authenticated;

-- admins: the duplicate groups, each entry with what the app knows about that number
create or replace function public.admin_dupes() returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('key', g.gkey, 'kind', g.kind, 'value', g.value, 'seen_at', g.seen_at,
      'entries', (select jsonb_agg(e || jsonb_build_object('member_id', m.id, 'member', m.status, 'on_app', m.user_id is not null, 'role', m.role) order by o)
                  from jsonb_array_elements(g.entries) with ordinality x(e, o)
                  left join members m on m.phone = right(regexp_replace(coalesce(e ->> 'phone', ''), '\D', '', 'g'), 10)))
    order by g.seen_at, g.gkey) from private.sheet_dupes g), '[]'::jsonb);
end $$;
revoke execute on function public.admin_dupes() from public, anon;
grant execute on function public.admin_dupes() to authenticated;

-- admins decide: p_remove = the entry ids to remove (at least one entry must stay), or p_ignore = not a duplicate
create or replace function public.admin_resolve_dupe(p_key text, p_remove text[] default '{}', p_ignore boolean default false) returns jsonb
language plpgsql security definer set search_path = public, auth, private as $$
declare g private.sheet_dupes; who text; e jsonb; keep_phones text[]; ph text; m members; moved integer := 0; removed integer := 0; note text; kept text;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into g from private.sheet_dupes where gkey = p_key;
  if not found then raise exception 'Already sorted out (the list was refreshed)'; end if;
  select coalesce(nickname, full_name) into who from members where user_id = auth.uid();
  if p_ignore then
    insert into private.dupe_ignored (sig, by_name) values (g.sig, who) on conflict (sig) do nothing;
    delete from private.sheet_dupes where gkey = p_key;
    return jsonb_build_object('result', 'ignored');
  end if;
  p_remove := coalesce(p_remove, '{}');
  if cardinality(p_remove) = 0 then raise exception 'Choose an entry to remove'; end if;
  if exists (select 1 from unnest(p_remove) r where not exists (select 1 from jsonb_array_elements(g.entries) x where x ->> 'id' = r)) then
    raise exception 'The list changed, please refresh';
  end if;
  if not exists (select 1 from jsonb_array_elements(g.entries) x where not (x ->> 'id' = any(p_remove))) then
    raise exception 'Keep at least one entry';
  end if;
  select array_agg(distinct right(regexp_replace(coalesce(x ->> 'phone', ''), '\D', '', 'g'), 10)), string_agg(x ->> 'name', ', ')
    into keep_phones, kept from jsonb_array_elements(g.entries) x where not (x ->> 'id' = any(p_remove));
  for e in select x from jsonb_array_elements(g.entries) x where x ->> 'id' = any(p_remove) loop
    ph := right(regexp_replace(coalesce(e ->> 'phone', ''), '\D', '', 'g'), 10);
    note := left('Duplicate ' || case g.kind when 'vrn' then 'VRN ' else 'number ' end || g.value || ': kept ' || coalesce(kept, 'another entry'), 200);
    select * into m from members where phone = ph and status = 'active';
    if found and not (ph = any(keep_phones)) then
      -- a different person on the member list: removed from RWB (restorable under Left / removed)
      perform public.admin_remove_member(m.id, 'removed', note);
      removed := removed + 1;
    end if;
    insert into private.dupe_actions (entry_id, gkey, note, by_name) values (e ->> 'id', g.gkey, note || ' · by ' || coalesce(who, 'an admin'), who);
    moved := moved + 1;
  end loop;
  delete from private.sheet_dupes where gkey = p_key;
  perform private.sheet_post(jsonb_build_object('action', 'dupes'));   -- the sheet moves the rows now (and every 10 minutes)
  return jsonb_build_object('result', 'done', 'rows', moved, 'members_removed', removed);
end $$;
revoke execute on function public.admin_resolve_dupe(text, text[], boolean) from public, anon;
grant execute on function public.admin_resolve_dupe(text, text[], boolean) to authenticated;

notify pgrst, 'reload schema';
