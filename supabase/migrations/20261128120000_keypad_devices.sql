-- A paired shop tablet keeps its own keypad token.
-- The token is stored as a hash. The business login is not kept on that device.
-- Safe to run more than once.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.keypad_devices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists keypad_devices_owner_idx
  on public.keypad_devices (owner_id)
  where revoked_at is null;

alter table public.keypad_devices enable row level security;

revoke all on table public.keypad_devices from public, anon, authenticated;

create or replace function public._keypad_owner_from_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  rec public.keypad_devices%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;

  select * into rec
  from public.keypad_devices
  where token_hash = encode(digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
    and revoked_at is null;

  if rec.id is null then
    return null;
  end if;

  update public.keypad_devices
  set last_used_at = now()
  where id = rec.id;

  return rec.owner_id;
end;
$$;

revoke all on function public._keypad_owner_from_token(text) from public, anon, authenticated;

create or replace function public.keypad_pair_device(p_name text)
returns table(id uuid, token text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid;
  new_token text;
  label text;
begin
  if auth.uid() is null then
    raise exception 'Please log in';
  end if;

  label := left(coalesce(nullif(trim(p_name), ''), 'Shop tablet'), 80);
  new_token := encode(gen_random_bytes(32), 'hex');

  insert into public.keypad_devices (owner_id, name, token_hash)
  values (
    auth.uid(),
    label,
    encode(digest(convert_to(new_token, 'utf8'), 'sha256'), 'hex')
  )
  returning keypad_devices.id into new_id;

  id := new_id;
  token := new_token;
  return next;
end;
$$;

create or replace function public.keypad_list_devices()
returns table(id uuid, name text, created_at timestamptz, last_used_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select d.id, d.name, d.created_at, d.last_used_at
  from public.keypad_devices as d
  where d.owner_id = auth.uid()
    and d.revoked_at is null
  order by d.created_at desc;
$$;

create or replace function public.keypad_revoke_device(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Please log in';
  end if;

  update public.keypad_devices
  set revoked_at = now()
  where id = p_id
    and owner_id = auth.uid()
    and revoked_at is null;
end;
$$;

create or replace function public.keypad_revoke_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  updated uuid;
begin
  if auth.uid() is null then
    raise exception 'Please log in as the business owner';
  end if;

  update public.keypad_devices
  set revoked_at = now()
  where token_hash = encode(digest(convert_to(p_token, 'utf8'), 'sha256'), 'hex')
    and owner_id = auth.uid()
    and revoked_at is null
  returning id into updated;

  if updated is null then
    raise exception 'Only the business owner can remove this keypad';
  end if;
end;
$$;

create or replace function public.keypad_device_open(p_token text)
returns table(logo_url text, geofence_enabled boolean, geofence_lat double precision, geofence_lng double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  owner := public._keypad_owner_from_token(p_token);
  if owner is null then
    return;
  end if;

  return query
  select
    p.logo_url,
    coalesce(p.geofence_enabled, false),
    p.geofence_lat::double precision,
    p.geofence_lng::double precision
  from public.profiles as p
  where p.id = owner;
end;
$$;

create or replace function public.keypad_device_verify_pin(p_token text, p_pin text)
returns table(id uuid, name text, photo_url text)
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  owner := public._keypad_owner_from_token(p_token);
  if owner is null then
    raise exception 'This keypad has been removed. Ask your manager to set it up again.';
  end if;

  return query
  select v.id, v.name, v.photo_url
  from public.keypad_verify_pin(owner, p_pin) as v;
end;
$$;

create or replace function public.keypad_device_last_clock(p_token text, p_staff_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  owner := public._keypad_owner_from_token(p_token);
  if owner is null then
    raise exception 'This keypad has been removed. Ask your manager to set it up again.';
  end if;

  return public.keypad_last_clock(owner, p_staff_id);
end;
$$;

create or replace function public.keypad_device_clock(p_token text, p_staff_id uuid, p_type text, p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  owner := public._keypad_owner_from_token(p_token);
  if owner is null then
    raise exception 'This keypad has been removed. Ask your manager to set it up again.';
  end if;

  if p_type in ('in', 'out') and public.keypad_can_clock(owner) is false then
    raise exception 'Clock-in is locked. The site trial has ended or the plan does not include it.';
  end if;

  perform public.keypad_clock(owner, p_staff_id, p_type, p_pin);
end;
$$;

revoke all on function public.keypad_pair_device(text) from public, anon;
revoke all on function public.keypad_list_devices() from public, anon;
revoke all on function public.keypad_revoke_device(uuid) from public, anon;
revoke all on function public.keypad_revoke_token(text) from public, anon;
grant execute on function public.keypad_pair_device(text) to authenticated;
grant execute on function public.keypad_list_devices() to authenticated;
grant execute on function public.keypad_revoke_device(uuid) to authenticated;
grant execute on function public.keypad_revoke_token(text) to authenticated;

grant execute on function public.keypad_device_open(text) to anon, authenticated;
grant execute on function public.keypad_device_verify_pin(text, text) to anon, authenticated;
grant execute on function public.keypad_device_last_clock(text, uuid) to anon, authenticated;
grant execute on function public.keypad_device_clock(text, uuid, text, text) to anon, authenticated;

commit;
