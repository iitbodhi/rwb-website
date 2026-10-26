-- RWB App setup file 33: Permanent Hideout is now required (same as the join form)
-- Members without one show under Follow-ups → Missing details, and get it in their reminders.
-- Safe to run more than once.
create or replace function private.missing_items(m public.members) returns text[] language sql stable as $$
  select array_remove(array[
    case when m.tnc_agreed is not true then 'rules' end,
    case when nullif(trim(coalesce(m.emergency_phone, '')), '') is null then 'emergency contact' end,
    case when nullif(trim(coalesce(m.blood_group, '')), '') is null then 'blood group' end,
    case when m.dob is null then 'date of birth' end,
    case when nullif(trim(coalesce(m.vrn, '')), '') is null then 'VRN' end,
    case when nullif(trim(coalesce(m.locality, '')), '') is null then 'locality' end,
    case when nullif(trim(coalesce(m.hideout, '')), '') is null then 'permanent hideout' end], null)
$$;
