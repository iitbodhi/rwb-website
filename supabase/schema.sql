-- =====================================================================
-- RWB App: database setup for Supabase (free plan)
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- It is safe to run again: it only creates what is missing.
-- =====================================================================

-- ---------- 1. Members (imported from the RWB join form sheet) ----------
create table if not exists public.members (
  id              bigint generated always as identity primary key,
  full_name       text not null,
  nickname        text,
  dob             date,
  phone           text unique check (phone ~ '^[0-9]{10}$'),   -- WhatsApp number, last 10 digits
  email           text,
  vrn             text,                                         -- bike registration number
  bike            text,
  blood_group     text,
  locality        text,
  hideout         text,
  emergency_phone text,
  alt_phone       text,
  joined_at       timestamptz default now(),
  user_id         uuid unique references auth.users(id) on delete set null,  -- set once they sign in to the app
  role            text not null default 'member' check (role in ('member','admin','superadmin')),
  removing        boolean not null default false,                -- set while an admin is removing them
  created_at      timestamptz not null default now()
);
create index if not exists members_email_idx on public.members (lower(email));
create index if not exists members_dob_md_idx on public.members (extract(month from dob), extract(day from dob));

-- ---------- 2. Access requests (people whose Google email is not in the sheet) ----------
create table if not exists public.link_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  email       text,
  full_name   text not null,
  phone       text not null check (phone ~ '^[0-9]{10}$'),
  dob         date,
  vrn         text,
  locality    text,
  status      text not null default 'pending' check (status in ('pending','rejected')),
  created_at  timestamptz not null default now()
);

-- ---------- 3. Service records ----------
create table if not exists public.service_records (
  id              bigint generated always as identity primary key,
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  service_date    date not null,
  odometer_km     integer not null check (odometer_km between 0 and 2000000),
  service_center  text,
  service_type    text not null default 'paid' check (service_type in ('free','paid','amc','repair','self')),
  service_no      smallint check (service_no between 1 and 20),   -- which free / AMC service
  items           text[] not null default '{}',
  cost            numeric(10,2) check (cost >= 0),
  next_due_km     integer check (next_due_km >= 0),
  next_due_date   date,
  notes           text check (char_length(notes) <= 2000),
  bill_path       text,                                           -- file in the private "bills" bucket
  created_at      timestamptz not null default now()
);
create index if not exists service_records_user_idx on public.service_records (user_id, service_date desc);

-- ---------- 4. Fuel log (mileage tracker) ----------
create table if not exists public.fuel_logs (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fill_date    date not null,
  odometer_km  integer not null check (odometer_km between 0 and 2000000),
  litres       numeric(6,2) not null check (litres > 0 and litres < 100),
  amount       numeric(10,2) check (amount >= 0),
  full_tank    boolean not null default true,
  trip_a_km    numeric(7,1) check (trip_a_km >= 0),
  notes        text check (char_length(notes) <= 500),
  created_at   timestamptz not null default now()
);
create index if not exists fuel_logs_user_idx on public.fuel_logs (user_id, odometer_km);

-- ---------- 5. Helper checks ----------
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid() and role in ('admin','superadmin'));
$$;

create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where user_id = auth.uid() and role = 'superadmin');
$$;

create or replace function public.today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ---------- 6. Row level security: who can see / change what ----------
alter table public.members         enable row level security;
alter table public.link_requests   enable row level security;
alter table public.service_records enable row level security;
alter table public.fuel_logs       enable row level security;

-- Nobody who is signed out can touch anything
revoke all on public.members, public.link_requests, public.service_records, public.fuel_logs from anon;

-- Members: you see your own row; admins see everyone. Members may edit only their own personal details.
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists members_update_self on public.members;
create policy members_update_self on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.members from authenticated;
grant update (nickname, dob, vrn, bike, blood_group, locality, hideout, emergency_phone, alt_phone)
  on public.members to authenticated;

-- Access requests: you see your own; admins see all. Changes go through the functions below.
drop policy if exists link_requests_select on public.link_requests;
create policy link_requests_select on public.link_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
revoke insert, update, delete on public.link_requests from authenticated;

-- Service records and fuel logs are private to their owner (admins cannot read them)
drop policy if exists service_own on public.service_records;
create policy service_own on public.service_records for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());
drop policy if exists fuel_own on public.fuel_logs;
create policy fuel_own on public.fuel_logs for all to authenticated
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- ---------- 7. Signing in: link the Google account to the sheet row ----------
-- Called right after sign-in. If the Google email matches the sheet, the member is in at once.
create or replace function public.link_account() returns text
language plpgsql security definer set search_path = public as $$
declare
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  mid bigint;
begin
  if auth.uid() is null then return 'signed_out'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  -- only trust an email the sign-in provider has verified (Google always does)
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then em := ''; end if;
  if em <> '' then
    select id into mid from members where lower(email) = em and user_id is null order by id desc limit 1;
    if mid is not null then
      update members set user_id = auth.uid() where id = mid;
      delete from link_requests where user_id = auth.uid();
      return 'member';
    end if;
  end if;
  if exists (select 1 from link_requests where user_id = auth.uid() and status = 'pending') then return 'pending'; end if;
  if exists (select 1 from link_requests where user_id = auth.uid() and status = 'rejected') then return 'rejected'; end if;
  return 'not_found';
end $$;

-- Ask the admins for access (email not in the sheet, or a new joiner)
create or replace function public.request_access(p_full_name text, p_phone text, p_dob date default null,
                                                  p_vrn text default null, p_locality text default null)
returns text language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  if length(ph) <> 10 then raise exception 'Please enter a 10-digit WhatsApp number'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) < 2 then raise exception 'Please enter your full name'; end if;
  insert into link_requests (user_id, email, full_name, phone, dob, vrn, locality, status)
  values (auth.uid(), auth.jwt() ->> 'email', trim(p_full_name), ph, p_dob, nullif(trim(p_vrn), ''), nullif(trim(p_locality), ''), 'pending')
  on conflict (user_id) do update set full_name = excluded.full_name, phone = excluded.phone, dob = excluded.dob,
    vrn = excluded.vrn, locality = excluded.locality, status = 'pending', created_at = now();
  return 'pending';
end $$;

-- ---------- 8. Admin actions ----------
-- Pending requests, with the sheet row that has the same WhatsApp number (if any)
create or replace function public.admin_list_requests()
returns table (id bigint, email text, full_name text, phone text, dob date, vrn text, locality text, created_at timestamptz,
               match_member_id bigint, match_name text, match_linked boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select r.id, r.email, r.full_name, r.phone, r.dob, r.vrn, r.locality, r.created_at,
           m.id, m.full_name, m.user_id is not null
    from link_requests r left join members m on m.phone = r.phone
    where r.status = 'pending' order by r.created_at;
end $$;

-- Approve: link to the matching sheet row, or add them as a new member
create or replace function public.admin_approve_request(p_request_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare r link_requests; m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from link_requests where id = p_request_id;
  if not found then raise exception 'Request not found'; end if;
  select * into m from members where phone = r.phone;
  if found then
    if m.user_id is not null and m.user_id <> r.user_id then
      raise exception 'That WhatsApp number is already linked to another app account. Remove it first if this is the same person.';
    end if;
    update members set user_id = r.user_id, email = coalesce(email, r.email) where id = m.id;
  else
    insert into members (full_name, phone, email, dob, vrn, locality, user_id)
    values (r.full_name, r.phone, r.email, r.dob, r.vrn, r.locality, r.user_id);
  end if;
  delete from link_requests where id = r.id;
  return 'approved';
end $$;

create or replace function public.admin_reject_request(p_request_id bigint) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update link_requests set status = 'rejected' where id = p_request_id;
  return 'rejected';
end $$;

-- Step 1 of removing someone: mark them and return their bill files so the app can delete those
create or replace function public.admin_begin_removal(p_member_id bigint) returns text[]
language plpgsql security definer set search_path = public as $$
declare m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into m from members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;
  if m.user_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  if m.role = 'superadmin' then raise exception 'The super admin cannot be removed'; end if;
  if m.role = 'admin' and not is_superadmin() then raise exception 'Only the super admin can remove an admin'; end if;
  update members set removing = true where id = m.id;
  if m.user_id is null then return '{}'; end if;
  return coalesce((select array_agg(bill_path) from service_records where user_id = m.user_id and bill_path is not null), '{}');
end $$;

create or replace function public.is_being_removed(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where removing and user_id::text = p_folder);
$$;

-- Step 2: remove someone who left RWB: deletes the member row and, if they use the app,
-- their app account with all their service records and fuel logs.
-- (The app deletes their uploaded bills from storage just before calling this.)
create or replace function public.admin_remove_member(p_member_id bigint) returns text
language plpgsql security definer set search_path = public, auth as $$
declare m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into m from members where id = p_member_id;
  if not found then raise exception 'Member not found'; end if;
  if m.user_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  if m.role = 'superadmin' then raise exception 'The super admin cannot be removed'; end if;
  if m.role = 'admin' and not is_superadmin() then raise exception 'Only the super admin can remove an admin'; end if;
  delete from members where id = m.id;
  if m.user_id is not null then
    delete from auth.users where id = m.user_id;   -- cascades to service_records, fuel_logs, link_requests
  end if;
  return 'removed';
end $$;

-- Make someone an admin, or back to member. Only the super admin can do this.
create or replace function public.admin_set_role(p_member_id bigint, p_role text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then raise exception 'Only the super admin can change admins'; end if;
  if p_role not in ('member','admin') then raise exception 'Role must be member or admin'; end if;
  if exists (select 1 from members where id = p_member_id and (user_id = auth.uid() or role = 'superadmin')) then
    raise exception 'The super admin role cannot be changed here';
  end if;
  update members set role = p_role where id = p_member_id;
  return p_role;
end $$;

-- Admins can correct a member's details
create or replace function public.admin_update_member(p_member_id bigint, p jsonb) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update members set
    full_name   = coalesce(nullif(trim(p ->> 'full_name'), ''), full_name),
    nickname    = case when p ? 'nickname'    then nullif(trim(p ->> 'nickname'), '')    else nickname end,
    dob         = case when p ? 'dob'         then nullif(p ->> 'dob', '')::date          else dob end,
    phone       = case when p ? 'phone'       then right(regexp_replace(p ->> 'phone', '\D', '', 'g'), 10) else phone end,
    vrn         = case when p ? 'vrn'         then nullif(trim(p ->> 'vrn'), '')         else vrn end,
    bike        = case when p ? 'bike'        then nullif(trim(p ->> 'bike'), '')        else bike end,
    blood_group = case when p ? 'blood_group' then nullif(trim(p ->> 'blood_group'), '') else blood_group end,
    locality    = case when p ? 'locality'    then nullif(trim(p ->> 'locality'), '')    else locality end
  where id = p_member_id;
  return 'saved';
end $$;

-- ---------- 9. Birthdays ----------
-- Members get names only; admins also get the WhatsApp number. Never the birth year.
-- 29 Feb birthdays show on 28 Feb in non-leap years.
create or replace function public.birthdays(p_days integer default 0)
returns table (member_id bigint, full_name text, nickname text, day date, phone text, on_app boolean)
language plpgsql stable security definer set search_path = public as $$
declare d0 date := today_ist();
begin
  if not is_member() then raise exception 'Members only'; end if;
  return query
    select m.id, m.full_name, m.nickname, g.d::date,
           case when is_admin() then m.phone end, m.user_id is not null
    from generate_series(d0, d0 + greatest(0, least(p_days, 31)), interval '1 day') g(d)
    join members m on m.dob is not null and (
         (extract(month from m.dob) = extract(month from g.d) and extract(day from m.dob) = extract(day from g.d))
      or (extract(month from m.dob) = 2 and extract(day from m.dob) = 29
          and extract(month from g.d) = 2 and extract(day from g.d) = 28
          and extract(day from (date_trunc('year', g.d) + interval '2 months' - interval '1 day')) = 28))
    order by g.d, m.full_name;
end $$;

-- Small counts for the admin panel
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object(
    'members',  (select count(*) from members),
    'on_app',   (select count(*) from members where user_id is not null),
    'pending',  (select count(*) from link_requests where status = 'pending'),
    'admins',   (select count(*) from members where role in ('admin','superadmin')));
end $$;

-- Only signed-in users may call these
do $$ declare f text; begin
  foreach f in array array['is_member()','is_admin()','is_superadmin()','link_account()',
    'request_access(text,text,date,text,text)','admin_list_requests()','admin_approve_request(bigint)',
    'admin_reject_request(bigint)','admin_begin_removal(bigint)','is_being_removed(text)','admin_remove_member(bigint)','admin_set_role(bigint,text)',
    'admin_update_member(bigint,jsonb)','birthdays(integer)','admin_stats()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- 10. Private storage for bills / invoices ----------
-- Each person's files live in a folder named after their account id. Max 2 MB per file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bills', 'bills', false, 2097152, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists bills_own_read   on storage.objects;
drop policy if exists bills_own_write  on storage.objects;
drop policy if exists bills_own_delete on storage.objects;
drop policy if exists bills_admin_remove on storage.objects;
drop policy if exists bills_admin_see_removed on storage.objects;
create policy bills_own_read on storage.objects for select to authenticated
  using (bucket_id = 'bills' and (storage.foldername(name))[1] = auth.uid()::text);
create policy bills_own_write on storage.objects for insert to authenticated
  with check (bucket_id = 'bills' and (storage.foldername(name))[1] = auth.uid()::text and public.is_member());
create policy bills_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'bills' and (storage.foldername(name))[1] = auth.uid()::text);
-- Admins can reach a member's files only while that member is being removed, to delete them
create policy bills_admin_see_removed on storage.objects for select to authenticated
  using (bucket_id = 'bills' and public.is_admin() and public.is_being_removed((storage.foldername(name))[1]));
create policy bills_admin_remove on storage.objects for delete to authenticated
  using (bucket_id = 'bills' and public.is_admin() and public.is_being_removed((storage.foldername(name))[1]));

-- =====================================================================
-- AFTER importing the members sheet, make yourself the super admin.
-- Replace the email below with the Google account you sign in with, then run just this line:
--   update public.members set role = 'superadmin' where lower(email) = lower('YOUR-GOOGLE-EMAIL@gmail.com');
-- The other admins can then be promoted from the app (Admin > Members > Make admin).
-- =====================================================================
