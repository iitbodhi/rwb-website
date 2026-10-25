-- RWB App setup file 32: editing the main bike
-- * Changing only the model of your main bike saves straight away (no approval).
-- * A new VRN for the main bike still goes to the admins; approving keeps "verified" if the VRN didn't change.
-- Safe to run more than once.

create or replace function public.request_change(p_kind text, p_value text, p_slot integer default null, p_model text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare m members; v text := nullif(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'), ''); old text;
begin
  select * into m from members where user_id = auth.uid() and status = 'active';
  if not found then raise exception 'Members only'; end if;
  if p_kind = 'name' then
    if v is null or char_length(v) < 3 then raise exception 'Please enter your full name'; end if;
    if v = m.full_name then return 'unchanged'; end if; old := m.full_name;
  elsif p_kind = 'phone' then
    v := right(regexp_replace(coalesce(v, ''), '\D', '', 'g'), 10);
    if length(v) <> 10 then raise exception 'WhatsApp No. needs a 10-digit number'; end if;
    if v = m.phone then return 'unchanged'; end if;
    if exists (select 1 from members where phone = v and id <> m.id) then raise exception 'Another member already has this number. Please message an admin.'; end if;
    old := m.phone;
  elsif p_kind = 'vrn' then
    v := upper(v);
    if v is null or length(regexp_replace(v, '[^A-Z0-9]', '', 'g')) < 6 then raise exception 'Please check the VRN (for example WB 02 AB 1234)'; end if;
    if private.norm_vrn(v) = private.norm_vrn(m.vrn) and coalesce(nullif(trim(p_model), ''), m.bike) is not distinct from m.bike then return 'unchanged'; end if;
    -- same VRN, only the model changed: no approval needed
    if private.norm_vrn(v) = private.norm_vrn(m.vrn) then
      update members set bike = nullif(trim(p_model), '') where id = m.id;
      delete from change_requests where member_id = m.id and kind = 'vrn' and status = 'pending';
      return 'saved';
    end if;
    old := concat_ws(' · ', m.vrn, m.bike);
  elsif p_kind = 'bike' then
    if p_slot not in (2, 3) then raise exception 'You can add up to 3 bikes'; end if;
    if v is null then   -- removing a bike needs no approval
      delete from member_bikes where member_id = m.id and slot = p_slot;
      delete from change_requests where member_id = m.id and kind = 'bike' and slot = p_slot and status = 'pending';
      return 'removed';
    end if;
    v := upper(v);
    if length(regexp_replace(v, '[^A-Z0-9]', '', 'g')) < 6 then raise exception 'Please check the VRN (for example WB 02 AB 1234)'; end if;
    select concat_ws(' · ', vrn, model) into old from member_bikes where member_id = m.id and slot = p_slot;
  elsif p_kind = 'tnc' then
    v := case when lower(coalesce(v, '')) in ('agree', 'yes', 'true') then 'agree' else 'disagree' end;
    if (v = 'agree') = m.tnc_agreed then return 'unchanged'; end if;
    if v = 'agree' then update members set tnc_agreed = true where id = m.id; return 'saved'; end if;
    old := 'agree';
  else raise exception 'Unknown change';
  end if;
  delete from change_requests where member_id = m.id and kind = p_kind and coalesce(slot, 0) = coalesce(p_slot, 0) and status = 'pending';
  insert into change_requests (member_id, kind, slot, old_value, new_value, new_model)
  values (m.id, p_kind, case when p_kind = 'bike' then p_slot end, old, v, nullif(trim(coalesce(p_model, '')), ''));
  insert into notifications (kind, title, body, url, audience, created_by)
  values ('admin', 'Change to approve',
          m.full_name || case p_kind when 'name' then ' wants to change their name' when 'phone' then ' wants to change their WhatsApp No.'
            when 'vrn' then ' changed their VRN / main bike' when 'bike' then ' added a bike' else ' no longer agrees to the RWB Terms & Conditions' end,
          '#admin', 'admins', auth.uid());
  return 'pending';
end $$;
revoke execute on function public.request_change(text, text, integer, text) from public, anon;
grant execute on function public.request_change(text, text, integer, text) to authenticated;

create or replace function public.admin_decide_change(p_id bigint, p_approve boolean, p_reason text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare c change_requests;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select * into c from change_requests where id = p_id and status = 'pending';
  if not found then raise exception 'This change was already handled'; end if;
  if p_approve then
    if c.kind = 'name' then update members set full_name = c.new_value where id = c.member_id;
    elsif c.kind = 'phone' then
      if exists (select 1 from members where phone = c.new_value and id <> c.member_id) then raise exception 'Another member already has this number'; end if;
      update members set phone = c.new_value where id = c.member_id;
    elsif c.kind = 'vrn' then update members set vrn = c.new_value, bike = coalesce(c.new_model, bike),
      vrn_verified = c.vrn_verified or (vrn_verified and private.norm_vrn(vrn) = private.norm_vrn(c.new_value)) where id = c.member_id;
    elsif c.kind = 'bike' then
      insert into member_bikes (member_id, slot, vrn, model, verified, verified_by) values (c.member_id, c.slot, c.new_value, c.new_model, c.vrn_verified, case when c.vrn_verified then private.admin_name() end)
      on conflict (member_id, slot) do update set vrn = excluded.vrn, model = excluded.model, verified = excluded.verified, verified_by = excluded.verified_by;
    elsif c.kind = 'tnc' then update members set tnc_agreed = false where id = c.member_id;
    end if;
  end if;
  update change_requests set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now(), decided_by = private.admin_name(),
    reject_reason = case when p_approve then null else nullif(trim(coalesce(p_reason, '')), '') end
  where id = c.id;
  return case when p_approve then 'approved' else 'rejected' end;
end $$;
revoke execute on function public.admin_decide_change(bigint, boolean, text) from public, anon;
grant execute on function public.admin_decide_change(bigint, boolean, text) to authenticated;
