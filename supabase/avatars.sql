-- RWB App: profile photos (free: each photo is shrunk to ~30 KB before upload)
-- Run once in Supabase > SQL Editor. Safe to run again.
alter table public.members add column if not exists avatar_url text
  check (avatar_url is null or avatar_url like '%/storage/v1/object/public/avatars/%');
grant update (avatar_url) on public.members to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 307200, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists avatars_add on storage.objects;
drop policy if exists avatars_change on storage.objects;
drop policy if exists avatars_see on storage.objects;
drop policy if exists avatars_remove on storage.objects;
-- members manage only their own photo (folder = their account id); admins can remove any (when removing a member)
create policy avatars_add on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());
create policy avatars_change on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_see on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy avatars_remove on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
notify pgrst, 'reload schema';
