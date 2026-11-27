-- 96-wa-todo.sql: the RWB WhatsApp group to-do list (Nov 27 2026).
-- When an admin approves or removes someone in the app and picks "Add later" / "Remove later",
-- the job is kept here so every admin sees it in Admin → WhatsApp. Safe to run twice.

create table if not exists public.wa_todo (
    id bigint generated always as identity primary key,
    member_id bigint not null references public.members(id) on delete cascade,
    action text not null check (action in ('add', 'remove')),
    added_by text,
    created_at timestamptz not null default now()
);
create unique index if not exists wa_todo_one on public.wa_todo (member_id, action);
alter table public.wa_todo enable row level security;   -- no policies: only the functions below touch it
revoke all on public.wa_todo from anon, authenticated;

-- the list, for admins
create or replace function public.admin_wa_todo()
returns table (id bigint, member_id bigint, action text, full_name text, phone text, status text, added_by text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Admins only'; end if;
    return query select t.id, t.member_id, t.action, m.full_name, m.phone, m.status, t.added_by, t.created_at
        from wa_todo t join members m on m.id = t.member_id order by t.created_at;
end $$;

-- "later": keep the job. Adding someone cancels a waiting remove for them, and the other way round.
create or replace function public.admin_wa_todo_add(p_member bigint, p_action text)
returns void language plpgsql security definer set search_path = public as $$
declare who text;
begin
    if not is_admin() then raise exception 'Admins only'; end if;
    if p_action not in ('add', 'remove') then raise exception 'Unknown action'; end if;
    select private.first_name(full_name) into who from members where user_id = (select auth.uid()) limit 1;
    delete from wa_todo where member_id = p_member;
    insert into wa_todo (member_id, action, added_by) values (p_member, p_action, who);
end $$;

-- done (or not needed any more)
create or replace function public.admin_wa_todo_done(p_member bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
    if not is_admin() then raise exception 'Admins only'; end if;
    delete from wa_todo where member_id = p_member;
end $$;

revoke all on function public.admin_wa_todo() from public, anon;
revoke all on function public.admin_wa_todo_add(bigint, text) from public, anon;
revoke all on function public.admin_wa_todo_done(bigint) from public, anon;
grant execute on function public.admin_wa_todo() to authenticated;
grant execute on function public.admin_wa_todo_add(bigint, text) to authenticated;
grant execute on function public.admin_wa_todo_done(bigint) to authenticated;

notify pgrst, 'reload schema';
