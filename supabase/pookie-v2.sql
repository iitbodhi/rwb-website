-- 61 · Pookie v2: answers only from what RWB taught it, "I don't know that yet" + URGENT questions, a count on the
-- admin Pookie tab, and admins' own Teach Pookie answers go live at once. Run once in Supabase → SQL Editor.
-- Needs setup file 56. Safe to run more than once. After running it, also deploy the new ask-ronin function.

-- ================= 1. URGENT questions =================
-- When a rider asks Pookie something it wasn't taught, the question lands in Teach Pookie marked URGENT,
-- and members see it before every other question until someone's answer is approved.
alter table public.pookie_questions add column if not exists urgent     boolean not null default false;
alter table public.pookie_questions add column if not exists asked      integer not null default 0;
alter table public.pookie_questions add column if not exists last_asked timestamptz;

-- called only by the ask-ronin server (service role), never by phones
create or replace function public.pookie_log_unknown(p_question text) returns void
language plpgsql security definer set search_path = public as $$
declare q text := left(regexp_replace(trim(coalesce(p_question, '')), '\s+', ' ', 'g'), 300);
begin
  if length(q) < 8 then return; end if;
  insert into pookie_questions (category, question, source, urgent, asked, last_asked)
  values ('Asked by riders', q, 'asked', true, 1, now())
  on conflict (question) do update set urgent = true, active = true, asked = pookie_questions.asked + 1, last_asked = now();
end $$;
revoke execute on function public.pookie_log_unknown(text) from public, anon, authenticated;
grant execute on function public.pookie_log_unknown(text) to service_role;

-- my progress (now also: how many urgent questions are waiting)
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
    'urgent', (select count(*) from pookie_questions q where q.active and q.urgent
                 and not exists (select 1 from pookie_answers a where a.question_id = q.id and a.user_id = uid)),
    'top', coalesce((select jsonb_agg(jsonb_build_object('name', split_part(nm, ' ', 1), 'xp', xp, 'approved', ok, 'me', user_id = uid) order by xp desc)
                     from (select * from ranked where xp > 0 order by xp desc limit 5) t), '[]'::jsonb))
$$;

-- the next question for me: URGENT ones first (most-asked first), then the ones fewest riders have answered
create or replace function public.teach_next(p_skip bigint[] default '{}') returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare q record;
begin
  if not is_member() then raise exception 'Members only'; end if;
  select pq.id, pq.category, pq.question, pq.urgent, pq.asked,
         (select count(*) from pookie_answers a where a.question_id = pq.id and a.status = 'approved') ok
    into q from pookie_questions pq
   where pq.active and not (pq.id = any(coalesce(p_skip, '{}')))
     and not exists (select 1 from pookie_answers a where a.question_id = pq.id and a.user_id = auth.uid())
   order by pq.urgent desc, case when pq.urgent then pq.asked else 0 end desc, ok, random() limit 1;
  return jsonb_build_object('question', case when q.id is null then null else jsonb_build_object('id', q.id, 'category', q.category, 'question', q.question,
                              'answers', q.ok, 'urgent', q.urgent, 'asked', q.asked) end,
                            'stats', private.teach_stats(auth.uid()));
end $$;

-- ================= 2. Approving =================
-- shared by admin review and by admins' own answers: make the answer part of what Pookie knows
create or replace function private.pookie_learn(p_id bigint, p_text text) returns void
language plpgsql security definer set search_path = public, private as $$
declare a record;
begin
  select x.*, q.question into a from pookie_answers x join pookie_questions q on q.id = x.question_id where x.id = p_id;
  if not found then raise exception 'Answer not found'; end if;
  update pookie_answers set status = 'approved', final = left(coalesce(nullif(trim(p_text), ''), a.answer), 1500),
    reviewed_by = private.admin_name(), reviewed_at = now() where id = p_id;
  insert into pookie_knowledge (source, ref, title, content)
  values ('answer', p_id::text, a.question, left(coalesce(nullif(trim(p_text), ''), a.answer), 1500) || ' (RWB rider ' || split_part(coalesce(a.member_name, 'member'), ' ', 1) || ')')
  on conflict (source, ref) do update set title = excluded.title, content = excluded.content, active = true, updated_at = now();
  update pookie_questions set urgent = false where id = a.question_id;   -- answered: no longer urgent
end $$;

create or replace function public.admin_teach_review(p_id bigint, p_ok boolean, p_text text default null) returns text
language plpgsql security definer set search_path = public, private as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if p_ok then perform private.pookie_learn(p_id, p_text); return 'approved'; end if;
  update pookie_answers set status = 'rejected', final = null, reviewed_by = private.admin_name(), reviewed_at = now() where id = p_id;
  if not found then raise exception 'Answer not found'; end if;
  update pookie_knowledge set active = false, updated_at = now() where source = 'answer' and ref = p_id::text;
  return 'rejected';
end $$;

-- save my answer. Members' answers wait for an admin; an admin's own answer goes live at once.
create or replace function public.teach_answer(p_qid bigint, p_answer text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t text := trim(coalesce(p_answer, '')); who text; aid bigint;
begin
  if not is_member() then raise exception 'Members only'; end if;
  if length(t) < 8 then raise exception 'Write a little more so Pookie can learn from it'; end if;
  if (select count(*) from pookie_answers where user_id = auth.uid() and created_at > now() - interval '1 day') >= 40 then
    raise exception 'That''s 40 answers today, thank you! Come back tomorrow for more.';
  end if;
  select full_name into who from members where user_id = auth.uid() limit 1;
  insert into pookie_answers (question_id, user_id, member_name, answer)
  values (p_qid, auth.uid(), who, left(t, 1500))
  on conflict (question_id, user_id) do update set answer = excluded.answer, status = 'pending', final = null, created_at = now()
  returning id into aid;
  if is_admin() then perform private.pookie_learn(aid, null); end if;
  return private.teach_stats(auth.uid()) || jsonb_build_object('live', is_admin());
end $$;

-- the number on the admin Pookie tab
create or replace function public.admin_pookie_pending() returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return (select count(*) from pookie_answers where status = 'pending');
end $$;
revoke execute on function public.admin_pookie_pending() from public, anon;
grant execute on function public.admin_pookie_pending() to authenticated;

-- ================= 3. "Admin notes for Pookie" box is gone =================
-- Each line of the old notes becomes something Pookie knows (Admin → Pookie → What Pookie has learned → "Admin"),
-- so nothing is lost. Admins can remove any of them there.
do $$ declare n text; l text; begin
  n := coalesce((select value from private.config where key = 'chat_notes'), '');
  foreach l in array regexp_split_to_array(n, E'\\n+') loop
    l := trim(regexp_replace(l, '^[-*•\s]+', ''));
    if length(l) >= 6 then
      insert into public.pookie_knowledge (source, ref, title, content)
      values ('admin', 'note-' || md5(lower(l)), left(l, 120), 'RWB admins: ' || left(l, 1500))
      on conflict (source, ref) do nothing;
    end if;
  end loop;
end $$;

-- ================= 4. Groq model names that exist today =================
-- (the old Llama names were switched off by Groq, which made every answer slower)
insert into private.config (key, value) values ('groq_models', 'openai/gpt-oss-120b,openai/gpt-oss-20b')
on conflict (key) do update set value = excluded.value;

do $$ declare f text; begin
  foreach f in array array['teach_next(bigint[])', 'teach_answer(bigint, text)', 'admin_teach_review(bigint, boolean, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
