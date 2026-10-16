-- Multi-tenant TimeClock schema
-- Run this in your new Supabase project SQL editor

-- Profiles (shop owners)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  shop_name text,
  logo_url text,
  tier text default 'basic',
  created_at timestamptz default now()
);

-- Staff (with profile details)
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  pin text not null,
  email text,
  dob date,
  address text,
  photo_url text,
  created_at timestamptz default now(),
  unique (owner_id, pin)
);

-- Add columns if table already exists
alter table staff add column if not exists email text;
alter table staff add column if not exists dob date;
alter table staff add column if not exists address text;
alter table staff add column if not exists photo_url text;

-- Clocks
create table if not exists clocks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade not null,
  staff_id uuid references staff(id) on delete cascade not null,
  type text not null check (type in ('in','out','break_start','break_end')),
  timestamp timestamptz default now()
);

-- Schedules
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  date date not null,
  start_time text,
  end_time text
);

-- Documents (right to work, contracts, etc.)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references profiles(id) on delete cascade not null,
  staff_id uuid references staff(id) on delete cascade not null,
  type text not null,
  file_url text not null,
  file_name text,
  uploaded_at timestamptz default now()
);

-- Enable RLS
alter table profiles enable row level security;
alter table staff enable row level security;
alter table clocks enable row level security;
alter table schedules enable row level security;
alter table documents enable row level security;

-- Drop existing policies if they exist (safe to re-run)
drop policy if exists "Owners manage own profile" on profiles;
drop policy if exists "Owners manage own staff" on staff;
drop policy if exists "Owners manage own clocks" on clocks;
drop policy if exists "Owners manage own schedules" on schedules;
drop policy if exists "Owners manage own documents" on documents;

-- Recreate policies
create policy "Owners manage own profile" on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "Owners manage own staff" on staff
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owners manage own clocks" on clocks
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owners manage own schedules" on schedules
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "Owners manage own documents" on documents
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, shop_name)
  values (new.id, 'My Shop')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger if not exists on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
