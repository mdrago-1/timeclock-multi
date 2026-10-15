-- Multi-tenant TimeClock schema
-- Run this in your new Supabase project SQL editor

-- Profiles (shop owners)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  shop_name text,
  logo_url text,
  tier text default 'basic',
  created_at timestamptz default now()
);

-- Staff
create table staff (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  pin text not null,
  created_at timestamptz default now(),
  unique (owner_id, pin)
);

-- Clocks
create table clocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade not null,
  staff_id uuid references staff(id) on delete cascade not null,
  type text not null check (type in ('in','out','break_start','break_end')),
  timestamp timestamptz default now()
);

-- Schedules
create table schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  date date not null,
  start_time text,
  end_time text
);

-- Enable RLS
alter table profiles enable row level security;
alter table staff enable row level security;
alter table clocks enable row level security;
alter table schedules enable row level security;

-- Policies (owner can only access their own data)
create policy "Owners manage own profile" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "Owners manage own staff" on staff
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owners manage own clocks" on clocks
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owners manage own schedules" on schedules
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, shop_name)
  values (new.id, 'My Shop');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
