-- Pharmacy Footfall Tracker: initial schema and row-level security.
-- Run this migration in the Supabase SQL Editor for the project you configure.

create extension if not exists pgcrypto;

create table if not exists public.branches (
  id uuid primary key,
  slug text not null unique,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.branches (id, slug, name) values
  ('10000000-0000-4000-8000-000000000001', 'gbagada', 'Gbagada'),
  ('10000000-0000-4000-8000-000000000002', 'akoka', 'Akoka'),
  ('10000000-0000-4000-8000-000000000003', 'sangotedo', 'Sangotedo')
on conflict (slug) do update set name = excluded.name;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'staff' check (role in ('staff', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branch_memberships (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, branch_id)
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id),
  visit_date date not null,
  recorded_at timestamptz not null default now(),
  outcome text not null check (outcome in ('purchased', 'not_purchased', 'undecided')),
  reason text check (reason is null or reason in (
    'Item unavailable',
    'Price too high',
    'Only enquiring',
    'Preferred brand unavailable',
    'Customer changed mind',
    'Will buy later',
    'Other / Unknown'
  )),
  batch_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_reason_only_for_no_purchase check (reason is null or outcome = 'not_purchased')
);

create index if not exists visits_branch_date_idx on public.visits (branch_id, visit_date, recorded_at desc);
create index if not exists visits_created_by_idx on public.visits (created_by);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    'staff'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.role = 'admin'
      and p.active = true
  );
$$;

create or replace function public.can_access_branch(target_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_admin()
    or exists (
      select 1
      from public.branch_memberships bm
      join public.profiles p on p.user_id = bm.user_id
      where bm.user_id = (select auth.uid())
        and bm.branch_id = target_branch
        and p.active = true
    );
$$;

alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.branch_memberships enable row level security;
alter table public.visits enable row level security;

drop policy if exists "Signed-in users can view active branches they can access" on public.branches;
create policy "Signed-in users can view active branches they can access"
on public.branches for select to authenticated
using (active and public.can_access_branch(id));

drop policy if exists "Users can view their own profile or admins can view all" on public.profiles;
create policy "Users can view their own profile or admins can view all"
on public.profiles for select to authenticated
using (user_id = (select auth.uid()) or public.is_active_admin());

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
on public.profiles for update to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Users can view own branch memberships or admins can view all" on public.branch_memberships;
create policy "Users can view own branch memberships or admins can view all"
on public.branch_memberships for select to authenticated
using (user_id = (select auth.uid()) or public.is_active_admin());

drop policy if exists "Admins manage branch memberships" on public.branch_memberships;
create policy "Admins manage branch memberships"
on public.branch_memberships for all to authenticated
using (public.is_active_admin())
with check (public.is_active_admin());

drop policy if exists "Users can read visits in assigned branches" on public.visits;
create policy "Users can read visits in assigned branches"
on public.visits for select to authenticated
using (public.can_access_branch(branch_id));

drop policy if exists "Users can create visits in assigned branches" on public.visits;
create policy "Users can create visits in assigned branches"
on public.visits for insert to authenticated
with check (
  public.can_access_branch(branch_id)
  and created_by = (select auth.uid())
);

-- Corrections are intentionally not exposed to client updates/deletes yet.
-- Stage 3 adds audited correction records and controlled correction functions.

grant usage on schema public to authenticated;
grant select on public.branches, public.profiles, public.branch_memberships, public.visits to authenticated;
grant insert on public.visits to authenticated;
grant update on public.profiles to authenticated;
grant all on public.branch_memberships to authenticated;

-- New accounts are staff by default and cannot grant themselves admin access.
-- Promote the trusted owner manually from the Supabase SQL Editor:
-- update public.profiles set role = 'admin' where user_id = '<auth-user-uuid>';
-- Then assign staff branches in branch_memberships as an admin, or via SQL during setup.
