-- 74: Guides robot (Nov 2026). Safe to run twice.
-- .github/workflows/slim-guides.yml makes uploaded guide PDFs lighter and adds preview pictures,
-- through the guides-slim Edge Function, which accepts only a one-time key the robot puts in private.slim_tokens.
alter table public.guide_items add column if not exists slim text;   -- null: not checked yet · done · skip (already light) · fail (kept as uploaded)
update public.guide_items set slim = 'done' where slim is null and path like 'maint/pdfs/drive/%';   -- the 7 moved guides were slimmed by hand
create table if not exists private.slim_tokens (token text primary key, expires_at timestamptz not null default now() + interval '15 minutes');
create or replace function public.slim_use_token(p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  delete from private.slim_tokens where expires_at < now();
  delete from private.slim_tokens where token = p_token returning true into ok;
  return coalesce(ok, false);
end $$;
revoke all on function public.slim_use_token(text) from public, anon, authenticated;
grant execute on function public.slim_use_token(text) to service_role;
notify pgrst, 'reload schema';
