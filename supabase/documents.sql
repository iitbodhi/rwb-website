-- =====================================================================
-- RWB App: My Documents (DL, RC, PUC, insurance and others). Private to each rider: admins can't see them.
-- Run once in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create table if not exists public.documents (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('dl','rc','puc','insurance','other')),
  title text check (title is null or length(title) <= 80),
  doc_number text check (doc_number is null or length(doc_number) <= 60),
  expiry_date date,
  files text[] not null default '{}' check (cardinality(files) <= 4),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_user_idx on public.documents (user_id);
alter table public.documents enable row level security;
drop policy if exists documents_own on public.documents;
create policy documents_own on public.documents for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member());
revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;

-- Private storage: each rider's files sit in a folder named after their account. Max 3 MB per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 3145728, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists docs_own_read on storage.objects;
drop policy if exists docs_own_write on storage.objects;
drop policy if exists docs_own_delete on storage.objects;
drop policy if exists docs_admin_see_removed on storage.objects;
drop policy if exists docs_admin_remove on storage.objects;
create policy docs_own_read on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy docs_own_write on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());
create policy docs_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and (storage.foldername(name))[1] = auth.uid()::text);
-- Admins can reach a rider's files only while that rider is being removed, and only to delete them
create policy docs_admin_see_removed on storage.objects for select to authenticated
  using (bucket_id = 'docs' and public.is_admin() and public.is_being_removed((storage.foldername(name))[1]));
create policy docs_admin_remove on storage.objects for delete to authenticated
  using (bucket_id = 'docs' and public.is_admin() and public.is_being_removed((storage.foldername(name))[1]));

-- During removal: the list of that rider's document files, so the app can delete them
create or replace function public.admin_removal_docs(p_member_id bigint) returns text[]
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into m from members where id = p_member_id;
  if not found or not m.removing or m.user_id is null then return '{}'; end if;
  return coalesce((select array_agg(f) from documents d, unnest(d.files) f where d.user_id = m.user_id), '{}');
end $$;
revoke execute on function public.admin_removal_docs(bigint) from public, anon;
grant execute on function public.admin_removal_docs(bigint) to authenticated;
notify pgrst, 'reload schema';
