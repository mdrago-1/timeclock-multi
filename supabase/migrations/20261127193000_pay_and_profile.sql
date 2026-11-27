-- Pay rates can only be saved for this owner's own staff.
-- The employee profile no longer returns bank details or National Insurance.
-- Employees can read their own clock times, and nothing else.

drop policy if exists "Owners manage own pay rates" on public.pay_rates;
create policy "Owners manage own pay rates" on public.pay_rates
  for all
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from public.staff s
      where s.id = staff_id and s.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.staff s
      where s.id = staff_id and s.owner_id = auth.uid()
    )
  );

revoke all on table public.pay_rates from public;
revoke all on table public.pay_rates from anon;
grant select, insert, update, delete on table public.pay_rates to authenticated;

do $priv$
begin
  execute 'revoke truncate, references, trigger on table public.pay_rates from authenticated';
  begin
    execute 'revoke maintain on table public.pay_rates from authenticated';
  exception when others then
    null;
  end;
end
$priv$;

drop function if exists public.my_shifts();
drop function if exists public.my_staff_profile();

create function public.my_staff_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  data jsonb;
  form jsonb;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'staff' and column_name = 'user_id'
  ) then
    execute $q$
      select to_jsonb(s) from public.staff s where s.user_id = auth.uid() limit 1
    $q$ into data;
  end if;

  if data is null then
    select to_jsonb(s) into data
    from public.staff s
    where coalesce(s.email, '') <> ''
      and lower(s.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1;
  end if;

  if data is null then
    return null;
  end if;

  form := coalesce(data->'starter_form_data', '{}'::jsonb)
    - 'bank_account_name' - 'bank_sort_code' - 'bank_account_number'
    - 'ni_number' - 'student_loan' - 'sort_code' - 'account_number';

  return jsonb_build_object(
    'id', data->'id',
    'owner_id', data->'owner_id',
    'name', data->'name',
    'email', data->'email',
    'phone', data->'phone',
    'dob', data->'dob',
    'address', data->'address',
    'pin', data->'pin',
    'hourly_rate', data->'hourly_rate',
    'photo_url', data->'photo_url',
    'starter_form_completed', data->'starter_form_completed',
    'starter_form_completed_at', data->'starter_form_completed_at',
    'starter_form_data', form,
    'notify_holiday_result', data->'notify_holiday_result',
    'notify_shift_start', data->'notify_shift_start'
  );
end;
$$;

revoke all on function public.my_staff_profile() from public;
revoke all on function public.my_staff_profile() from anon;
grant execute on function public.my_staff_profile() to authenticated;

create or replace function public.my_shifts()
returns table(week_start date, date date, start_time text, end_time text)
language sql
security definer
set search_path = public
as $$
  with me as (
    select (p->>'id')::uuid as id, (p->>'owner_id')::uuid as owner_id
    from (select public.my_staff_profile() as p) profile
    where p is not null
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

create or replace function public.my_hours()
returns table(timestamp timestamptz, type text)
language sql
security definer
set search_path = public
as $$
  select c.timestamp, c.type
  from public.clocks c
  where c.staff_id = (
    select (p->>'id')::uuid
    from (select public.my_staff_profile() as p) profile
    where p is not null
    limit 1
  )
  order by c.timestamp desc
  limit 200;
$$;

revoke all on function public.my_hours() from public;
revoke all on function public.my_hours() from anon;
grant execute on function public.my_hours() to authenticated;
