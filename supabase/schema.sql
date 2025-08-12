create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role text check (role in ('admin','checker')) default 'checker',
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_self" on public.profiles for insert with check (true);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  venue text,
  start_at timestamptz,
  end_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);
alter table public.events enable row level security;
create policy "events_admin_select" on public.events for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','checker'))
);
create policy "events_admin_insert" on public.events for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "events_admin_update" on public.events for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events on delete cascade,
  guest_name text not null,
  guest_contact text,
  code text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING','CHECKED_IN','CANCELLED')),
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);
alter table public.invites enable row level security;
create policy "invites_select_admin_checker" on public.invites for select using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','checker'))
);
create policy "invites_insert_admin" on public.invites for insert with check (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
);
create policy "invites_update_checkin" on public.invites for update using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','checker'))
) with check (status in ('PENDING','CHECKED_IN','CANCELLED'));
