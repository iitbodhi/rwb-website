-- RWB App setup file 37: editing a member's Timestamp in the sheet changes their "Member since" date in the app.
-- Safe to run more than once.
create or replace function public.sheet_set_joined(p_secret text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, private as $$
declare r jsonb; n integer := 0; k integer; ts timestamptz;
begin
  perform private.sheet_ok(p_secret);
  perform set_config('rwb.from_sheet', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin ts := nullif(r ->> 'joined_at', '')::timestamptz; exception when others then ts := null; end;
    if ts is null or ts > now() + interval '1 day' or ts < timestamptz '2015-01-01' then continue; end if;
    update members set joined_at = ts
    where phone = right(regexp_replace(coalesce(r ->> 'phone', ''), '\D', '', 'g'), 10) and status = 'active' and joined_at is distinct from ts;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function public.sheet_set_joined(text, jsonb) from public;
grant execute on function public.sheet_set_joined(text, jsonb) to anon, authenticated;
