-- 56 · VRN check shows a little more to members + "Teach Pookie". Run once in Supabase → SQL Editor. Safe to run more than once.

-- ================= 1. VRN check (members) =================
-- Members now see the rider's name partly hidden (e.g. "Bod****** M***") and just their area (the first part of
-- their locality, never the full address). If the rider shares "VRN and bike numbers" in Me → What members see,
-- the full name shows. Admins and coordinators keep seeing everything, as before.
create or replace function private.mask_name(n text) returns text language sql immutable as $$
  select string_agg(case when i = 1 then left(w, 3) || repeat('*', greatest(length(w) - 3, 2)) else left(w, 1) || '***' end, ' ' order by i)
  from unnest(regexp_split_to_array(trim(coalesce(n, '')), '\s+')) with ordinality as t(w, i) where w <> ''
$$;

create or replace function public.vrn_check_info(p_vrn text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v text := private.norm_vrn(p_vrn); m public.members; full_ok boolean;
begin
  if not is_member() then raise exception 'Members only'; end if;
  if v is null or length(v) < 6 then return null; end if;
  select x.* into m from members x where x.status = 'active'
    and (private.norm_vrn(x.vrn) = v or exists (select 1 from member_bikes b where b.member_id = x.id and private.norm_vrn(b.vrn) = v))
  limit 1;
  if not found then return jsonb_build_object('member', false); end if;
  full_ok := private.shares(m, 'vrn') or is_moderator();
  return jsonb_build_object('member', true, 'full', full_ok,
    'name', case when full_ok then m.full_name else private.mask_name(m.full_name) end,
    'area', nullif(trim(split_part(coalesce(m.locality, ''), ',', 1)), ''));
end $$;
revoke execute on function public.vrn_check_info(text) from public, anon;
grant execute on function public.vrn_check_info(text) to authenticated;

-- ================= 2. Teach Pookie =================
-- Members answer Pookie's questions about the TVS Ronin 225 (maintenance, problems, tyres, touring, local tips).
-- Every answer waits for an admin to check it; approved answers become Pookie's knowledge and it uses them in replies.
-- The maintenance PDFs in Guides are read by Pookie too (Admin → Pookie → "Learn from Guides").
create table if not exists public.pookie_questions (
  id         bigint generated always as identity primary key,
  category   text not null,
  question   text not null unique,
  active     boolean not null default true,
  source     text not null default 'seed',
  created_at timestamptz not null default now()
);
create table if not exists public.pookie_answers (
  id          bigint generated always as identity primary key,
  question_id bigint not null references public.pookie_questions(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  member_name text,
  answer      text not null,
  final       text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (question_id, user_id)
);
create table if not exists public.pookie_knowledge (
  id         bigint generated always as identity primary key,
  source     text not null check (source in ('answer', 'guide', 'admin')),
  ref        text not null,
  title      text not null,
  content    text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, ref)
);
alter table public.pookie_questions enable row level security;
alter table public.pookie_answers   enable row level security;
alter table public.pookie_knowledge enable row level security;
revoke all on public.pookie_questions, public.pookie_answers, public.pookie_knowledge from anon, authenticated;

insert into public.pookie_questions (category, question) values
  ('Engine & oil', 'Which engine oil brand and grade do you use in your Ronin 225, and how has the engine felt with it?'),
  ('Engine & oil', 'How many kilometres do you go between oil changes, and why that interval?'),
  ('Engine & oil', 'Have you ever noticed oil weeping or seepage anywhere on the Ronin engine? Where, and how was it fixed?'),
  ('Engine & oil', 'How do you check the engine oil level on the Ronin correctly (bike on main stand or side stand, engine warm or cold)?'),
  ('Engine & oil', 'Does your Ronin''s engine heat up a lot in Kolkata traffic? What do you do about it?'),
  ('Engine & oil', 'What does a healthy Ronin 225 engine sound like at idle, and what sounds should make a rider worried?'),
  ('Engine & oil', 'Have you had the valve clearance checked or adjusted on your Ronin? At what km, and did it change how it rides?'),
  ('Engine & oil', 'What is your experience with the Ronin''s cold start in winter mornings?'),
  ('Engine & oil', 'Have you used fully synthetic vs semi-synthetic oil in the Ronin? What difference did you feel?'),
  ('Engine & oil', 'How often do you clean or replace the air filter, especially after dusty rides?'),
  ('Service & costs', 'How much did your last paid service at a TVS service centre cost, and what was included?'),
  ('Service & costs', 'Which service centre in Bengal gave you the best service for the Ronin, and why?'),
  ('Service & costs', 'What should a rider check or ask for before handing over the Ronin for a service?'),
  ('Service & costs', 'What did the free services (1st, 2nd, 3rd) include for your Ronin?'),
  ('Service & costs', 'Which parts wore out first on your Ronin, and at what km?'),
  ('Service & costs', 'Have you ever been charged for something unnecessary at a service? How can members avoid that?'),
  ('Service & costs', 'How long does a regular Ronin service usually take at the service centre?'),
  ('Service & costs', 'What do you do yourself at home instead of going to the service centre?'),
  ('Service & costs', 'How much did a new set of tyres or brake pads cost you for the Ronin, and where did you buy them?'),
  ('Common issues & fixes', 'Have you faced any electrical glitch on the Ronin (cluster, switches, lights)? What was the fix?'),
  ('Common issues & fixes', 'Have you experienced any rattling or vibration noise on the Ronin? Where was it coming from and how did you solve it?'),
  ('Common issues & fixes', 'Did your Ronin ever fail to start? What was the cause and how did you fix it?'),
  ('Common issues & fixes', 'Have you had issues with the Ronin''s clutch (hard pull, slipping, noise)? What helped?'),
  ('Common issues & fixes', 'Have you noticed any gear-shifting problems (false neutral, hard shifts) on the Ronin? What fixed it?'),
  ('Common issues & fixes', 'Have you faced the ISG / engine malfunction warning light coming on? What did it turn out to be?'),
  ('Common issues & fixes', 'Has water entered anywhere on your Ronin after rain or washing (cluster, headlight, connectors)? How did you deal with it?'),
  ('Common issues & fixes', 'Have you had a battery problem on the Ronin? How long did the original battery last?'),
  ('Common issues & fixes', 'Have you had any warranty claim on the Ronin? What was it and how smooth was the process?'),
  ('Common issues & fixes', 'Any problem with the Ronin''s side stand sensor or kill switch stopping the bike from starting?'),
  ('Brakes, tyres & suspension', 'What tyre pressures (front and rear) do you run on the Ronin, solo and with a pillion?'),
  ('Brakes, tyres & suspension', 'Which tyres came on your Ronin and how many km did they last?'),
  ('Brakes, tyres & suspension', 'Have you upgraded the Ronin''s tyres? Which tyres, and how was the grip in rain?'),
  ('Brakes, tyres & suspension', 'How many km did your brake pads last on the Ronin, front and rear?'),
  ('Brakes, tyres & suspension', 'What rear monoshock preload setting do you use, and when do you change it?'),
  ('Brakes, tyres & suspension', 'How does the Ronin''s ABS behave on wet or gravel roads in your experience?'),
  ('Brakes, tyres & suspension', 'How do you fix a puncture on the Ronin''s tubeless tyres on the road? What kit do you carry?'),
  ('Brakes, tyres & suspension', 'Have you had the brake fluid changed? At what km or years?'),
  ('Chain & drive', 'How often do you clean and lube the chain on your Ronin, and which products do you use?'),
  ('Chain & drive', 'How do you check and adjust chain slack on the Ronin?'),
  ('Chain & drive', 'How many km did the original chain sprocket kit last on your Ronin?'),
  ('Chain & drive', 'Which chain lube works best in monsoon for you?'),
  ('Mileage & fuel', 'What real-world mileage do you get on the Ronin in the city and on the highway?'),
  ('Mileage & fuel', 'What riding habits improved your Ronin''s mileage the most?'),
  ('Mileage & fuel', 'Do you use normal petrol or premium (power/speed) petrol in the Ronin? Did you notice any difference?'),
  ('Mileage & fuel', 'How far can you ride on the Ronin after the low-fuel warning comes on?'),
  ('Riding & touring', 'What is the most comfortable cruising speed on the Ronin for long highway rides?'),
  ('Riding & touring', 'How do you pack luggage on the Ronin for a multi-day tour?'),
  ('Riding & touring', 'What is the longest ride you''ve done on the Ronin in a day, and what did you learn?'),
  ('Riding & touring', 'How does the Ronin handle hills and ghats, like the roads to Darjeeling or Sikkim?'),
  ('Riding & touring', 'What tips would you give a new rider for riding the Ronin in heavy rain?'),
  ('Riding & touring', 'How do you handle the Ronin with a pillion on bad roads?'),
  ('Riding & touring', 'What checks do you do on the Ronin before a long ride?'),
  ('Riding & touring', 'What did you carry in your toolkit on your last long ride?'),
  ('Riding & touring', 'How does the Ronin perform at high altitude or in very cold weather?'),
  ('Riding & touring', 'Any tips for riding the Ronin safely at night on highways?'),
  ('Accessories & mods', 'Which crash guard / engine guard do you use on your Ronin, and would you recommend it?'),
  ('Accessories & mods', 'Which aux lights or fog lamps did you fit, and are they legal and useful?'),
  ('Accessories & mods', 'Have you fitted a windscreen or visor on the Ronin? Did it help on highways?'),
  ('Accessories & mods', 'Which saddle bags, tank bag or tail bag work best with the Ronin?'),
  ('Accessories & mods', 'Which mobile holder and charger do you use on the Ronin, and did it damage your phone camera?'),
  ('Accessories & mods', 'Have you changed the seat or added a seat cover for comfort? What helped?'),
  ('Accessories & mods', 'Which accessories would you NOT recommend for the Ronin, and why?'),
  ('Accessories & mods', 'Which riding gear (helmet, jacket, gloves, boots) do you use and recommend on a budget?'),
  ('Ownership & paperwork', 'What should a buyer check when buying a second-hand Ronin 225?'),
  ('Ownership & paperwork', 'How did you get your Ronin''s insurance renewed, and what add-ons are worth it?'),
  ('Ownership & paperwork', 'What should a rider do if the Ronin''s PUC or other papers are about to expire?'),
  ('Ownership & paperwork', 'Which Ronin variant do you own and why did you choose it?'),
  ('Ownership & paperwork', 'What do you love most about the Ronin, and what would you change?'),
  ('RWB & local tips', 'Which petrol pumps or places along popular RWB routes (like NH12 or towards Digha) are good stops?'),
  ('RWB & local tips', 'Which mechanic or workshop near you do you trust for small Ronin jobs, and in which area?'),
  ('RWB & local tips', 'Where can members in your area get genuine Ronin spare parts quickly?'),
  ('RWB & local tips', 'What should a new member know before joining their first RWB group ride?'),
  ('RWB & local tips', 'Which breakfast or tea stops do RWB riders love around Kolkata?')
on conflict (question) do nothing;

-- my progress: 10 XP per approved answer, 2 per answer waiting for a check
create or replace function private.teach_stats(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (select count(*) filter (where status = 'approved') ok, count(*) filter (where status = 'pending') wait, count(*) n from pookie_answers where user_id = uid),
  board as (select a.user_id, max(a.member_name) nm, count(*) filter (where status = 'approved') ok, count(*) filter (where status = 'pending') wait
            from pookie_answers a group by a.user_id),
  ranked as (select *, ok * 10 + wait * 2 xp, rank() over (order by ok * 10 + wait * 2 desc) rk from board)
  select jsonb_build_object(
    'answered', (select n from mine), 'approved', (select ok from mine), 'waiting', (select wait from mine),
    'xp', (select ok * 10 + wait * 2 from mine),
    'rank', (select rk from ranked where user_id = uid),
    'questions', (select count(*) from pookie_questions where active),
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', split_part(nm, ' ', 1), 'xp', xp, 'approved', ok, 'me', user_id = uid) order by xp desc)
                     from (select * from ranked where xp > 0 order by xp desc limit 5) t), '[]'::jsonb))
$$;

-- the next question for me (ones fewest riders have answered first), skipping the ones I passed on this time
create or replace function public.teach_next(p_skip bigint[] default '{}') returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare q record;
begin
  if not is_member() then raise exception 'Members only'; end if;
  select pq.id, pq.category, pq.question,
         (select count(*) from pookie_answers a where a.question_id = pq.id and a.status = 'approved') ok
    into q from pookie_questions pq
   where pq.active and not (pq.id = any(coalesce(p_skip, '{}')))
     and not exists (select 1 from pookie_answers a where a.question_id = pq.id and a.user_id = auth.uid())
   order by ok, random() limit 1;
  return jsonb_build_object('question', case when q.id is null then null else jsonb_build_object('id', q.id, 'category', q.category, 'question', q.question, 'answers', q.ok) end,
                            'stats', private.teach_stats(auth.uid()));
end $$;

-- save my answer (it waits for an admin). At most 40 answers a day.
create or replace function public.teach_answer(p_qid bigint, p_answer text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t text := trim(coalesce(p_answer, '')); who text;
begin
  if not is_member() then raise exception 'Members only'; end if;
  if length(t) < 8 then raise exception 'Write a little more so Pookie can learn from it'; end if;
  if (select count(*) from pookie_answers where user_id = auth.uid() and created_at > now() - interval '1 day') >= 40 then
    raise exception 'That''s 40 answers today, thank you! Come back tomorrow for more.';
  end if;
  select full_name into who from members where user_id = auth.uid() limit 1;
  insert into pookie_answers (question_id, user_id, member_name, answer)
  values (p_qid, auth.uid(), who, left(t, 1500))
  on conflict (question_id, user_id) do update set answer = excluded.answer, status = 'pending', final = null, created_at = now();
  return private.teach_stats(auth.uid());
end $$;

create or replace function public.teach_stats() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not is_member() then raise exception 'Members only'; end if;
  return private.teach_stats(auth.uid());
end $$;

-- admins: answers waiting for a check
create or replace function public.admin_teach_queue()
returns table (id bigint, question text, category text, answer text, member_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query select a.id, q.question, q.category, a.answer, a.member_name, a.created_at
    from pookie_answers a join pookie_questions q on q.id = a.question_id where a.status = 'pending' order by a.created_at limit 200;
end $$;

-- approve (optionally with a corrected text) or reject an answer
create or replace function public.admin_teach_review(p_id bigint, p_ok boolean, p_text text default null) returns text
language plpgsql security definer set search_path = public, private as $$
declare a record;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select x.*, q.question into a from pookie_answers x join pookie_questions q on q.id = x.question_id where x.id = p_id;
  if not found then raise exception 'Answer not found'; end if;
  update pookie_answers set status = case when p_ok then 'approved' else 'rejected' end,
    final = case when p_ok then left(coalesce(nullif(trim(p_text), ''), a.answer), 1500) end,
    reviewed_by = private.admin_name(), reviewed_at = now() where id = p_id;
  if p_ok then
    insert into pookie_knowledge (source, ref, title, content)
    values ('answer', p_id::text, a.question, left(coalesce(nullif(trim(p_text), ''), a.answer), 1500) || ' (RWB rider ' || split_part(coalesce(a.member_name, 'member'), ' ', 1) || ')')
    on conflict (source, ref) do update set title = excluded.title, content = excluded.content, active = true, updated_at = now();
  else
    update pookie_knowledge set active = false, updated_at = now() where source = 'answer' and ref = p_id::text;
  end if;
  return case when p_ok then 'approved' else 'rejected' end;
end $$;

-- admins: what Pookie has learned (answers and guide PDFs), and switching an item off
create or replace function public.admin_pookie_knowledge()
returns table (id bigint, source text, title text, content text, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query select k.id, k.source, k.title, k.content, k.updated_at from pookie_knowledge k where k.active order by k.source, k.updated_at desc limit 1000;
end $$;
create or replace function public.admin_pookie_forget(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update pookie_knowledge set active = false, updated_at = now() where id = p_id;
  update pookie_answers set status = 'rejected' where id::text = (select ref from pookie_knowledge where id = p_id and source = 'answer');
  return 'forgotten';
end $$;
-- admins: add questions (typed, or written by AI from Admin → Pookie)
create or replace function public.admin_pookie_add_questions(p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  with ins as (
    insert into pookie_questions (category, question, source)
    select left(coalesce(nullif(trim(x ->> 'category'), ''), 'General'), 40), left(trim(x ->> 'question'), 300), coalesce(x ->> 'source', 'admin')
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x where length(trim(coalesce(x ->> 'question', ''))) > 10
    on conflict (question) do nothing returning 1)
  select count(*) into n from ins;
  return n;
end $$;

do $$ declare f text; begin
  foreach f in array array['teach_next(bigint[])', 'teach_answer(bigint, text)', 'teach_stats()', 'admin_teach_queue()', 'admin_teach_review(bigint, boolean, text)',
                           'admin_pookie_knowledge()', 'admin_pookie_forget(bigint)', 'admin_pookie_add_questions(jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
