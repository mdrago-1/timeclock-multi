-- Employee portal: the signed-in employee can read their own published shifts.
-- The staff row comes from my_staff_profile(), which already links auth.uid().
-- Shifts are matched by schedules.staff_id, not by name.

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

create or replace function public.my_shifts()
returns table(week_start date, date date, start_time text, end_time text)
language sql
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.owner_id
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
   and s.staff_id = me.id
   and s.date >= w.week_start
   and s.date < w.week_start + 7
  order by w.week_start desc, s.date nulls last, s.start_time;
$$;

revoke all on function public.my_shifts() from public;
revoke all on function public.my_shifts() from anon;
grant execute on function public.my_shifts() to authenticated;

do $record$
begin
  insert into supabase_migrations.schema_migrations (version, name)
  values ('20261124121400', 'my_shifts')
  on conflict (version) do nothing;
exception when others then
  begin
    insert into supabase_migrations.schema_migrations (version)
    values ('20261124121400')
    on conflict (version) do nothing;
  exception when others then
    null;
  end;
end
$record$;
