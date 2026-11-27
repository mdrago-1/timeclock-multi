-- Hourly rate history. Timesheet pay uses the rate that applied on each day.
-- Only the signed-in business owner can read or change these rows.

create table if not exists public.pay_rates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  hourly_rate numeric(10,2) not null,
  effective_from date not null,
  created_at timestamptz default now(),
  unique (staff_id, effective_from)
);

alter table public.pay_rates enable row level security;

drop policy if exists "Owners manage own pay rates" on public.pay_rates;
create policy "Owners manage own pay rates" on public.pay_rates
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke all on table public.pay_rates from public;
revoke all on table public.pay_rates from anon;
grant select, insert, update, delete on table public.pay_rates to authenticated;

insert into public.pay_rates (owner_id, staff_id, hourly_rate, effective_from)
select s.owner_id,
       s.id,
       coalesce(s.hourly_rate, 0),
       coalesce(
         case
           when (s.starter_form_data->>'agreed_start_date') ~ '^\d{4}-\d{2}-\d{2}$'
             then (s.starter_form_data->>'agreed_start_date')::date
           else null
         end,
         date '2000-01-01'
       )
from public.staff s
where coalesce(s.hourly_rate, 0) > 0
on conflict (staff_id, effective_from) do nothing;

do $record$
begin
  insert into supabase_migrations.schema_migrations (version, name)
  values ('20261127190000', 'pay_rates')
  on conflict (version) do nothing;
exception when others then
  begin
    insert into supabase_migrations.schema_migrations (version)
    values ('20261127190000')
    on conflict (version) do nothing;
  exception when others then
    null;
  end;
end
$record$;
