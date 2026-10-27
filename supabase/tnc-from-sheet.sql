-- RWB App setup file 47: "Understood & agreed" on the RWB sheet counts as agreeing to the current RWB Terms (version 2.0).
-- Used by the sheet script's syncTncAgreed: members whose row says "Understood & agreed" stop being asked to agree in the app
-- and leave the "Not agreed to the T&C" follow-up list. Rows that say "I don't agree", or have no answer, are not changed.
-- Safe to run more than once.

create or replace function public.sheet_agree_tnc(p_secret text, p_phones text[]) returns integer
language plpgsql security definer set search_path = public, private as $$
declare n integer := 0;
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then raise exception 'Not allowed'; end if;
  perform set_config('rwb.from_sheet', 'on', true);
  update members set tnc_agreed = true, tnc_version = private.tnc_current(), tnc_agreed_at = coalesce(tnc_agreed_at, now())
  where status = 'active'
    and phone = any (select right(regexp_replace(coalesce(x, ''), '\D', '', 'g'), 10) from unnest(coalesce(p_phones, '{}')) x)
    and (tnc_agreed is not true or tnc_version is distinct from private.tnc_current());
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.sheet_agree_tnc(text, text[]) from public;
grant execute on function public.sheet_agree_tnc(text, text[]) to anon, authenticated;

notify pgrst, 'reload schema';
