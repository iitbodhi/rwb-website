-- =====================================================================
-- RWB App: one-time catch-up for the RWB contact sheet
-- Lets the sheet's Apps Script ("addMissingFromApp") fetch every current member,
-- so members who were in the app before the sheet sync was set up can be added to the sheet.
-- Protected by the same sync secret as the rest of the sheet sync. Run once in Supabase > SQL Editor.
-- =====================================================================
create or replace function public.sheet_export_members(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if p_secret is null or p_secret <> coalesce((select value from private.config where key = 'sheet_secret'), '') then
    raise exception 'Not allowed';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'full_name', m.full_name, 'dob', m.dob, 'phone', m.phone, 'email', m.email, 'vrn', m.vrn, 'bike', m.bike,
      'blood_group', m.blood_group, 'locality', m.locality, 'hideout', m.hideout,
      'emergency_phone', m.emergency_phone, 'alt_phone', m.alt_phone, 'joined_at', m.joined_at,
      'on_app', m.user_id is not null) order by m.joined_at nulls first, m.id)
    from members m where m.status = 'active'), '[]'::jsonb);
end $$;
revoke all on function public.sheet_export_members(text) from public;
grant execute on function public.sheet_export_members(text) to anon, authenticated;
