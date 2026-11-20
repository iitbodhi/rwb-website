-- RWB App setup file 76: small fixes to joining (file 75).
-- * A rider who filled the old Google Form and is On hold finds their request when they open roninwb.in/join with
--   the same email (before, only waiting entries were found).
-- * The notes riders get no longer say "Open the RWB App" (many join on the website).
-- Safe to run more than once.

create or replace function public.link_account() returns text
language plpgsql security definer set search_path = public, private as $$
declare
  em  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  m   members; rid bigint; st text;
begin
  if auth.uid() is null then return 'signed_out'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then return 'member'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then em := ''; end if;
  if em <> '' then
    select * into m from members where lower(email) = em and status = 'active' and user_id is null
      order by (move_from is not null) desc, id desc limit 1;
    if m.id is not null then
      if m.move_from is not null then perform set_config('rwb.quiet_join', 'on', true); end if;
      update members set user_id = auth.uid(), move_from = null where id = m.id;
      if m.move_from is not null then perform private.move_account(m.move_from, auth.uid()); end if;
      return 'member';
    end if;
    -- filled the old Google join form with this email: waiting or on hold
    if not exists (select 1 from link_requests where user_id = auth.uid()) then
      select id, status into rid, st from link_requests where lower(email) = em and user_id is null and status in ('pending', 'hold')
        order by created_at desc limit 1;
      if rid is not null then update link_requests set user_id = auth.uid() where id = rid; return st; end if;
    end if;
  end if;
  select status into st from link_requests where user_id = auth.uid() order by created_at desc, id desc limit 1;
  if st in ('pending', 'hold', 'rejected') then return st; end if;
  if private.join_is_blocked(auth.uid(), em, null) then return 'rejected'; end if;
  if exists (select 1 from members where move_from = auth.uid()) then return 'moved'; end if;
  return 'not_found';
end $$;
revoke execute on function public.link_account() from public, anon;
grant execute on function public.link_account() to authenticated;

create or replace function private.after_approve() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'approved' and old.status in ('pending', 'hold') then
    update members set tnc_agreed = coalesce(new.tnc, tnc_agreed),
      form_answers = case when new.answers is not null then coalesce(form_answers, '{}'::jsonb) || new.answers else form_answers end
    where phone = new.phone;
    perform private.tell_member(new.user_id, 'Welcome to RWB! 🎉', 'You''re approved. Explore the app, and check your details in Me (you can add your bike model and up to 3 bikes).', '#me');
  elsif new.status = 'hold' and old.status is distinct from 'hold' then
    perform private.tell_member(new.user_id, 'Your RWB request is on hold', coalesce('Note from the admins: ' || rtrim(new.hold_note, '. ') || '. ', 'The admins will get back to you soon. ') || 'Tap to see it or update your answers.', '#home');
  elsif new.status = 'rejected' and old.status in ('pending', 'hold') then
    perform private.tell_member(new.user_id, 'About your RWB request', 'Your request wasn''t approved' || coalesce(': ' || new.reject_reason, '') || '. Tap to see the details.', '#home');
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
