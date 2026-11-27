-- Match published shifts to the signed-in employee by staff id.
-- Names are only used for older rows, and only when that name is unique
-- in the business. Duplicate names stay unmatched on purpose.
-- Safe to run more than once.

begin;

alter table public.schedules
  add column if not exists staff_id uuid;

update public.schedules as s
set staff_id = st.id
from public.staff as st
where s.staff_id is null
  and s.owner_id = st.owner_id
  and s.name = st.name
  and (
    select count(*)
    from public.staff as same
    where same.owner_id = s.owner_id
      and same.name = s.name
  ) = 1;

alter table public.schedules
  drop constraint if exists schedules_staff_id_fkey;

alter table public.schedules
  add constraint schedules_staff_id_fkey
  foreign key (staff_id) references public.staff (id)
  on delete set null
  not valid;

alter table public.schedules
  validate constraint schedules_staff_id_fkey;

create index if not exists schedules_owner_staff_date_idx
  on public.schedules (owner_id, staff_id, date);

-- Rows still unmatched (a shared name, or a name that no longer exists).
-- Re-save that week in Schedule, or make the employee names unique, then re-save.
-- select owner_id, name, count(*) as rows
-- from public.schedules
-- where staff_id is null
-- group by owner_id, name
-- order by owner_id, name;

create or replace function public.my_shifts()
returns table(week_start date, date date, start_time text, end_time text)
language sql
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.owner_id, p.name
    from public.my_staff_profile() as p
    limit 1
  ),
  weeks as (
    select pw.week_start::date as week_start
    from public.published_weeks as pw
    join me on me.owner_id = pw.owner_id
    order by pw.week_start::date desc
    limit 4
  )
  select w.week_start, s.date, s.start_time, s.end_time
  from weeks as w
  cross join me
  left join public.schedules as s
    on s.owner_id = me.owner_id
   and s.date >= w.week_start
   and s.date < w.week_start + 7
   and (
     s.staff_id = me.id
     or (
       s.staff_id is null
       and s.name = me.name
       and (
         select count(*)
         from public.staff as same
         where same.owner_id = me.owner_id
           and same.name = me.name
       ) = 1
     )
   )
  order by w.week_start desc, s.date nulls last, s.start_time;
$$;

revoke all on function public.my_shifts() from public;
revoke all on function public.my_shifts() from anon;
grant execute on function public.my_shifts() to authenticated;

commit;
