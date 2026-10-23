-- =====================================================================
-- RWB App: "Pookie" chatbot (free, Google Gemini)
-- Run in Supabase > SQL Editor. Safe to run again.
-- The Gemini key itself is added separately (private file), never on GitHub.
-- =====================================================================

-- How many questions each member asked today (keeps us inside Google's free limits)
create table if not exists public.chat_usage (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null,
  count    integer not null default 0,
  primary key (user_id, day)
);
alter table public.chat_usage enable row level security;
revoke all on public.chat_usage from anon, authenticated;

-- Default limits (admins can change these values in the SQL editor later)
insert into private.config (key, value) values ('chat_daily_limit', '20'), ('chat_global_daily_limit', '500')
on conflict (key) do nothing;

-- Called (as the member) before every question. Returns questions left today, or explains why not.
create or replace function public.chat_take_quota() returns integer
language plpgsql security definer set search_path = public, private as $$
declare
  d   date := today_ist();
  lim integer := coalesce((select value::int from private.config where key = 'chat_daily_limit'), 20);
  glb integer := coalesce((select value::int from private.config where key = 'chat_global_daily_limit'), 500);
  c   integer;
begin
  if not is_member() then raise exception 'Members only'; end if;
  if is_admin() then lim := lim * 3; end if;
  if (select coalesce(sum(count), 0) from chat_usage where day = d) >= glb then
    raise exception 'Pookie has answered a lot of questions today and is resting. Please try again tomorrow.';
  end if;
  insert into chat_usage (user_id, day, count) values (auth.uid(), d, 1)
  on conflict (user_id, day) do update set count = chat_usage.count + 1
  returning count into c;
  if c > lim then
    raise exception 'You have used all % questions for today. Pookie will be back for you tomorrow.', lim;
  end if;
  return lim - c;
end $$;

-- Give a question back if the AI failed to answer
create or replace function public.chat_refund() returns void
language sql security definer set search_path = public as $$
  update chat_usage set count = greatest(count - 1, 0) where user_id = auth.uid() and day = today_ist();
$$;

-- Admin-written notes the AI should know (patron service centres, RWB tips, ride rules…)
create or replace function public.admin_get_chat_notes() returns text
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return coalesce((select value from private.config where key = 'chat_notes'), '');
end $$;

create or replace function public.admin_set_chat_notes(p_notes text) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if char_length(coalesce(p_notes, '')) > 8000 then raise exception 'Please keep the notes under 8000 characters'; end if;
  insert into private.config (key, value) values ('chat_notes', coalesce(p_notes, ''))
  on conflict (key) do update set value = excluded.value;
  return 'saved';
end $$;

-- What the chatbot's server needs (service role only: the Gemini key never reaches phones)
create or replace function public.chat_config() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'key',    (select value from private.config where key = 'gemini_key'),
    'models', coalesce((select value from private.config where key = 'gemini_models'), 'gemini-flash-latest,gemini-flash-lite-latest'),
    'notes',  coalesce((select value from private.config where key = 'chat_notes'), ''),
    'groq_key',    (select value from private.config where key = 'groq_key'),
    'groq_models', coalesce((select value from private.config where key = 'groq_models'), 'llama-3.3-70b-versatile,llama-3.1-8b-instant'));
$$;

revoke execute on function public.chat_take_quota() from public, anon;
revoke execute on function public.chat_refund() from public, anon;
revoke execute on function public.admin_get_chat_notes() from public, anon;
revoke execute on function public.admin_set_chat_notes(text) from public, anon;
revoke execute on function public.chat_config() from public, anon, authenticated;
grant execute on function public.chat_take_quota() to authenticated;
grant execute on function public.chat_refund() to authenticated;
grant execute on function public.admin_get_chat_notes() to authenticated;
grant execute on function public.admin_set_chat_notes(text) to authenticated;
grant execute on function public.chat_config() to service_role;
notify pgrst, 'reload schema';
