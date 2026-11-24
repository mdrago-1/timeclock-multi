-- Employee portal: the signed-in employee can read their own published shifts.
-- The staff row is resolved by my_staff_profile(), which already links auth.uid().

create or replace function public.my_shifts()
returns table(week_start date, date date, start_time text, end_time text)
language sql
security definer
set search_path = public
as $$
  with me as (
    select p.owner_id, p.name
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
   and s.name = me.name
   and s.date >= w.week_start
   and s.date < w.week_start + 7
  order by w.week_start desc, s.date nulls last, s.start_time;
$$;

revoke all on function public.my_shifts() from public;
revoke all on function public.my_shifts() from anon;
grant execute on function public.my_shifts() to authenticated;
