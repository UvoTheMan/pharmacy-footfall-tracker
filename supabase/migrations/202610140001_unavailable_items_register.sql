-- Shared unavailable-item register for Footlytics staging/preview.
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
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'resolved'))
);

create index if not exists unavailable_items_reported_on_idx
  on public.unavailable_items (reported_on desc, branch_id);
create index if not exists unavailable_items_item_name_idx
  on public.unavailable_items (lower(item_name));
create index if not exists unavailable_items_created_by_idx
  on public.unavailable_items (created_by);

alter table public.unavailable_items enable row level security;

drop policy if exists "Active staff and admins can view unavailable items" on public.unavailable_items;
create policy "Active staff and admins can view unavailable items"
on public.unavailable_items for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.user_id = (select auth.uid()) and p.active = true
));

drop policy if exists "Assigned staff can report unavailable items" on public.unavailable_items;
create policy "Assigned staff can report unavailable items"
on public.unavailable_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and updated_by = (select auth.uid())
  and public.can_access_branch(branch_id)
  and exists (
    select 1 from public.visits v
    where v.id = visit_id and v.branch_id = branch_id
      and v.visit_date = reported_on
      and v.unavailable_item_requested = true
  )
);

drop policy if exists "Authors or admins can correct unavailable items" on public.unavailable_items;
create policy "Authors or admins can correct unavailable items"
on public.unavailable_items for update to authenticated
using (
  exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active = true)
  and (created_by = (select auth.uid()) or public.is_active_admin())
)
with check (
  exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active = true)
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
      or new.recorded_at is distinct from old.recorded_at then
      raise exception 'Staff can correct the item name only.';
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

-- One transaction records the visit and its unavailable product together.
create or replace function public.record_unavailable_item(
  p_branch_id uuid,
  p_outcome text,
  p_reason text,
  p_item_name text
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
  if p_outcome not in ('purchased', 'not_purchased') then
    raise exception 'Unsupported visit outcome.';
  end if;
  if p_outcome = 'not_purchased' and p_reason is distinct from 'Item unavailable' then
    raise exception 'No-purchase unavailable-item reports must use the Item unavailable reason.';
  end if;
  if p_outcome = 'purchased' and p_reason is not null then
    raise exception 'Purchased reports must not include a no-purchase reason.';
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
    visit_id, branch_id, item_name, reported_on, created_by, updated_by
  ) values (
    new_visit_id, p_branch_id, clean_item_name, new_visit_date, auth.uid(), auth.uid()
  );

  return new_visit_id;
end;
$$;

grant select, insert, update on public.unavailable_items to authenticated;
revoke delete on public.unavailable_items from authenticated;
grant execute on function public.record_unavailable_item(uuid, text, text, text) to authenticated;
