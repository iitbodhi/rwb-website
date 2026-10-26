-- RWB App setup file 35: members marked in the sheet by colour (red = removed for breaking the T&C, grey = left)
-- are marked the same in the app. They show under RWB → Left / removed (with the note) and can be restored there.
-- Safe to run more than once.
create or replace function public.sheet_mark_gone(p_secret text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r jsonb; ph text; st text; done jsonb := '{}'::jsonb; k integer;
begin
  perform private.sheet_ok(p_secret);
  perform set_config('rwb.from_sheet', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    ph := right(regexp_replace(coalesce(r ->> 'phone', ''), '\D', '', 'g'), 10);
    st := case when r ->> 'status' = 'removed' then 'removed' else 'left' end;
    update members set status = st, removed_at = coalesce(removed_at, now()), removed_by = 'Sheet colour',
      removed_note = left(nullif(trim(coalesce(r ->> 'note', '')), ''), 200)
    where phone = ph and status = 'active';
    get diagnostics k = row_count;
    done := done || jsonb_build_object(ph, case when k > 0 then st else 'not an active member' end);
  end loop;
  return done;
end $$;
revoke execute on function public.sheet_mark_gone(text, jsonb) from public;
grant execute on function public.sheet_mark_gone(text, jsonb) to anon, authenticated;
