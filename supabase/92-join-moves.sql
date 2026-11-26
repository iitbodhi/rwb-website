-- 92-join-moves.sql (Nov 26 2026)
-- Admin → Approvals → Rejected: a rejected request can now go straight to On hold or be approved,
-- not only back to New. Moving it out of Rejected also lifts a spam block, like "Move to New" already did.
-- Safe to run twice.

create or replace function public.admin_hold_request(p_request_id bigint, p_note text default null)
returns text language plpgsql security definer set search_path = public, private as $$
declare r link_requests;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if exists (select 1 from link_requests x join link_requests o on o.phone = x.phone and o.id <> x.id and o.status in ('pending', 'hold')
             where x.id = p_request_id and x.status = 'rejected') then
    raise exception 'There is already a newer request with this WhatsApp number in New or On hold.';
  end if;
  perform set_config('rwb.admin_check', 'on', true);
  update link_requests set status = 'hold', hold_note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
    reject_reason = null, spam = false, decided_at = now(), decided_by = private.admin_name()
  where id = p_request_id and status in ('pending', 'hold', 'rejected') returning * into r;
  if not found then raise exception 'This entry was already handled'; end if;
  delete from private.join_blocked where request_id = r.id;
  return 'hold';
end $$;

create or replace function public.admin_approve_request(p_request_id bigint)
returns text language plpgsql security definer set search_path = public, private as $$
declare r link_requests; m members;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into r from link_requests where id = p_request_id and status in ('pending', 'hold', 'rejected');
  if not found then raise exception 'This entry was already handled'; end if;
  if r.status = 'rejected' and exists (select 1 from link_requests o where o.phone = r.phone and o.id <> r.id and o.status in ('pending', 'hold')) then
    raise exception 'There is already a newer request with this WhatsApp number in New or On hold.';
  end if;
  select * into m from members where phone = r.phone;
  if found then
    if r.user_id is not null and m.user_id is not null and m.user_id <> r.user_id then
      raise exception 'That WhatsApp number is already linked to another app account. Remove it first if this is the same person.';
    end if;
    if r.user_id is not null then
      update members set user_id = null where user_id = r.user_id and id <> m.id;
    end if;
    update members set user_id = coalesce(r.user_id, user_id), email = coalesce(r.email, email),
      full_name = coalesce(nullif(r.full_name, ''), full_name), dob = coalesce(r.dob, dob), vrn = coalesce(r.vrn, vrn),
      locality = coalesce(r.locality, locality), bike = coalesce(r.bike, bike), blood_group = coalesce(r.blood_group, blood_group),
      hideout = coalesce(r.hideout, hideout), emergency_phone = coalesce(r.emergency_phone, emergency_phone),
      alt_phone = coalesce(r.alt_phone, alt_phone),
      vrn_verified = case when r.vrn_verified then true when private.norm_vrn(coalesce(r.vrn, vrn)) = private.norm_vrn(vrn) then vrn_verified else false end,
      status = 'active', removed_at = null, removed_by = null, removed_note = null,
      joined_at = case when m.status <> 'active' then now() else joined_at end
    where id = m.id;
    delete from private.removed_phones where phone = r.phone;
  else
    insert into members (full_name, phone, email, dob, vrn, locality, bike, blood_group, hideout, emergency_phone, alt_phone, user_id, vrn_verified, joined_at)
    values (r.full_name, r.phone, r.email, r.dob, r.vrn, r.locality, r.bike, r.blood_group, r.hideout, r.emergency_phone, r.alt_phone, r.user_id, r.vrn_verified, now());
  end if;
  update link_requests set status = 'approved', reject_reason = null, spam = false, decided_at = now(), decided_by = private.admin_name() where id = r.id;
  delete from private.join_blocked where request_id = r.id;
  if r.source = 'form' then perform private.sheet_post(jsonb_build_object('action', 'status', 'status', 'approved', 'phone', r.phone, 'form_ts', r.form_ts)); end if;
  return 'approved';
end $$;

-- the welcome note and the join answers also follow an approval straight from Rejected
create or replace function private.after_approve()
returns trigger language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'approved' and old.status in ('pending', 'hold', 'rejected') then
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
