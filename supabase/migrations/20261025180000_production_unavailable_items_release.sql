-- Forward-only Production release for the unavailable-item register.
-- This migration creates schema and functions only. It does not copy or seed data.
-- It intentionally does not replay the initial schema or legacy visit-correction migrations.
-- Target: add unavailable-item capability with stricter branch-scoped photo reads than the legacy Staging policy.

begin;

create table if not exists public.unavailable_items (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.visits(id) on delete restrict,
  branch_id uuid not null references public.branches(id) on delete restrict,
  item_name text not null check (length(trim(item_name)) between 1 and 180),
  reported_on date not null,
  recorded_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'resolved')),
  image_path text
);

create index if not exists unavailable_items_reported_on_idx
  on public.unavailable_items (reported_on desc, branch_id);
create index if not exists unavailable_items_item_name_idx
  on public.unavailable_items (lower(item_name));
create index if not exists unavailable_items_created_by_idx
  on public.unavailable_items (created_by);

alter table public.unavailable_items enable row level security;

alter table public.unavailable_items
  drop constraint if exists unavailable_items_image_path_owner_check;
alter table public.unavailable_items
  add constraint unavailable_items_image_path_owner_check
  check (
    image_path is null or (
      length(image_path) between 1 and 300
      and split_part(image_path, '/', 1) = created_by::text
      and position('..' in image_path) = 0
    )
  );

drop policy if exists "Active staff and admins can view unavailable items" on public.unavailable_items;
drop policy if exists "Users can view unavailable items in accessible branches" on public.unavailable_items;
create policy "Users can view unavailable items in accessible branches"
on public.unavailable_items for select to authenticated
using (
  public.is_active_admin()
  or (
    exists (
      select 1 from public.profiles p
      where p.user_id = (select auth.uid()) and p.active = true
    )
    and public.can_access_branch(branch_id)
  )
);

drop policy if exists "Assigned staff can report unavailable items" on public.unavailable_items;
create policy "Assigned staff can report unavailable items"
on public.unavailable_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and public.can_access_branch(branch_id)
  and exists (
    select 1 from public.visits v
    where v.id = unavailable_items.visit_id
      and v.branch_id = unavailable_items.branch_id
      and v.visit_date = unavailable_items.reported_on
      and v.unavailable_item_requested = true
  )
);

drop policy if exists "Authors or admins can correct unavailable items" on public.unavailable_items;
create policy "Authors or admins can correct unavailable items"
on public.unavailable_items for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.active = true
  )
  and (created_by = (select auth.uid()) or public.is_active_admin())
)
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.active = true
  )
  and (created_by = (select auth.uid()) or public.is_active_admin())
);

create or replace function public.guard_unavailable_item_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_active_admin() then
    if new.status is distinct from old.status
      or new.branch_id is distinct from old.branch_id
      or new.visit_id is distinct from old.visit_id
      or new.reported_on is distinct from old.reported_on
      or new.created_by is distinct from old.created_by
      or new.recorded_at is distinct from old.recorded_at
      or new.image_path is distinct from old.image_path then
      raise exception 'Staff can correct the item name only.';
    end if;

    if new.item_name is distinct from old.item_name then
      new.status := 'pending';
    end if;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists unavailable_items_guard_update on public.unavailable_items;
create trigger unavailable_items_guard_update
before update on public.unavailable_items
for each row execute procedure public.guard_unavailable_item_update();

-- Preserve Production's existing correction window (no same-day restriction),
-- correction history, and branch authorization. The flag update below is a new
-- behavior required for unavailable-item tracking.
create or replace function public.correct_visit(p_visit_id uuid, p_outcome text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.visits%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign-in required';
  end if;
  if p_outcome is null or p_outcome not in ('purchased', 'not_purchased') then
    raise exception 'Invalid outcome';
  end if;
  if p_outcome = 'not_purchased' and p_reason is null then
    raise exception 'Reason required';
  end if;
  if p_outcome = 'purchased' and p_reason is not null then
    raise exception 'Purchased visit cannot have a reason';
  end if;
  if p_reason is not null and p_reason not in (
    'Item unavailable', 'Price too high', 'Only enquiring',
    'Preferred brand unavailable', 'Customer changed mind',
    'Will buy later', 'Other / Unknown'
  ) then
    raise exception 'Invalid reason';
  end if;

  select * into v from public.visits where id = p_visit_id for update;
  if not found then
    raise exception 'Visit not found';
  end if;
  if not public.can_access_branch(v.branch_id) then
    raise exception 'No access to this branch';
  end if;

  insert into public.visit_corrections (
    visit_id, branch_id, changed_by, previous_outcome, previous_reason, new_outcome, new_reason
  ) values (
    v.id, v.branch_id, auth.uid(), v.outcome, v.reason, p_outcome, p_reason
  );

  -- Preserve Production's existing correction window. Only maintain the new
  -- unavailable-item flag when a correction explicitly marks a no-purchase
  -- visit as Item unavailable; otherwise preserve its current value.
  update public.visits
  set outcome = p_outcome,
      reason = p_reason,
      unavailable_item_requested = case
        when p_outcome = 'not_purchased' then p_reason = 'Item unavailable'
        else v.unavailable_item_requested
      end,
      updated_at = now()
  where id = v.id;
end;
$$;

revoke all on function public.correct_visit(uuid, text, text) from public, anon;
grant execute on function public.correct_visit(uuid, text, text) to authenticated;

-- Atomic creation: visit and item report either both succeed or both fail.
create or replace function public.record_unavailable_item(
  p_branch_id uuid,
  p_outcome text,
  p_reason text,
  p_item_name text,
  p_image_path text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_visit_id uuid;
  new_visit_date date;
  clean_item_name text := trim(coalesce(p_item_name, ''));
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to record an unavailable item.';
  end if;
  if length(clean_item_name) < 1 or length(clean_item_name) > 180 then
    raise exception 'Enter an item name between 1 and 180 characters.';
  end if;
  if p_outcome is null or p_outcome not in ('purchased', 'not_purchased') then
    raise exception 'Unsupported visit outcome.';
  end if;
  if p_outcome = 'not_purchased' and p_reason is distinct from 'Item unavailable' then
    raise exception 'No-purchase unavailable-item reports must use the Item unavailable reason.';
  end if;
  if p_outcome = 'purchased' and p_reason is not null then
    raise exception 'Purchased reports must not include a no-purchase reason.';
  end if;
  if p_image_path is not null and (
    length(p_image_path) > 300
    or split_part(p_image_path, '/', 1) <> auth.uid()::text
    or position('..' in p_image_path) > 0
  ) then
    raise exception 'The photo path is invalid.';
  end if;
  if not public.can_access_branch(p_branch_id) then
    raise exception 'You do not have access to this branch.';
  end if;

  insert into public.visits (
    branch_id, visit_date, recorded_at, outcome, reason,
    unavailable_item_requested, created_by
  ) values (
    p_branch_id, (now() at time zone 'Africa/Lagos')::date, now(), p_outcome,
    case when p_outcome = 'not_purchased' then p_reason else null end,
    true, auth.uid()
  )
  returning id, visit_date into new_visit_id, new_visit_date;

  insert into public.unavailable_items (
    visit_id, branch_id, item_name, reported_on, created_by, updated_by, image_path
  ) values (
    new_visit_id, p_branch_id, clean_item_name, new_visit_date, auth.uid(), auth.uid(), p_image_path
  );
  return new_visit_id;
end;
$$;

revoke all on function public.record_unavailable_item(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_unavailable_item(uuid, text, text, text, text) to authenticated;

-- Attach details to a visit already recorded through the quick-entry workflow.
-- Purchased visits are accepted only when the unavailable-item flag is set.
create or replace function public.add_unavailable_item_details(
  p_visit_id uuid,
  p_item_name text,
  p_image_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.visits%rowtype;
  new_item_id uuid;
  clean_item_name text := trim(coalesce(p_item_name, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign-in required';
  end if;
  if length(clean_item_name) < 1 or length(clean_item_name) > 180 then
    raise exception 'Enter an item name between 1 and 180 characters.';
  end if;
  if p_image_path is not null and (
    length(p_image_path) > 300
    or split_part(p_image_path, '/', 1) <> auth.uid()::text
    or position('..' in p_image_path) > 0
  ) then
    raise exception 'The photo path is invalid.';
  end if;

  select * into v from public.visits where id = p_visit_id for update;
  if not found then
    raise exception 'Visit not found';
  end if;
  if not public.can_access_branch(v.branch_id) then
    raise exception 'You do not have access to this branch.';
  end if;
  if not (
    (v.outcome = 'not_purchased' and v.reason = 'Item unavailable')
    or (v.outcome = 'purchased' and v.unavailable_item_requested is true)
  ) then
    raise exception 'This visit must be marked as an unavailable-item visit.';
  end if;

  update public.visits
  set unavailable_item_requested = true, updated_at = now()
  where id = v.id and unavailable_item_requested is distinct from true;

  insert into public.unavailable_items (
    visit_id, branch_id, item_name, reported_on, created_by, updated_by, image_path
  ) values (
    v.id, v.branch_id, clean_item_name, v.visit_date, auth.uid(), auth.uid(), p_image_path
  )
  returning id into new_item_id;

  return new_item_id;
end;
$$;

revoke all on function public.add_unavailable_item_details(uuid, text, text) from public, anon;
grant execute on function public.add_unavailable_item_details(uuid, text, text) to authenticated;

-- Private image bucket. This does not upload/copy any objects or test images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'unavailable-item-photos', 'unavailable-item-photos', false, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[];

drop policy if exists "Active staff can upload unavailable-item photos" on storage.objects;
create policy "Active staff can upload unavailable-item photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'unavailable-item-photos'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active = true)
);

drop policy if exists "Active staff can view unavailable-item photos" on storage.objects;
create policy "Active staff can view unavailable-item photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'unavailable-item-photos'
  and exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid()) and p.active = true
  )
  and exists (
    select 1
    from public.unavailable_items ui
    where ui.image_path = storage.objects.name
      and (public.is_active_admin() or public.can_access_branch(ui.branch_id))
  )
);

drop policy if exists "Owners can remove unlinked unavailable-item photos" on storage.objects;
create policy "Owners can remove unlinked unavailable-item photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'unavailable-item-photos'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active = true)
  and not exists (select 1 from public.unavailable_items ui where ui.image_path = storage.objects.name)
);

revoke all on public.unavailable_items from public, anon;
grant select, insert, update on public.unavailable_items to authenticated;
revoke delete, truncate, references, trigger on public.unavailable_items from authenticated;

commit;
