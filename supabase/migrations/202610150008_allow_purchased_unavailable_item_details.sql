-- Allow deferred product details for both unavailable-item paths:
-- 1. no-purchase visits whose reason is Item unavailable
-- 2. purchased visits where the customer bought something else but the requested item was unavailable.
-- This preserves the visit outcome while allowing the existing Add details workflow to complete.
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

  select *
  into v
  from public.visits
  where id = p_visit_id
  for update;

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
  set unavailable_item_requested = true,
      updated_at = now()
  where id = v.id
    and unavailable_item_requested is distinct from true;

  insert into public.unavailable_items (
    visit_id,
    branch_id,
    item_name,
    reported_on,
    created_by,
    updated_by,
    image_path
  )
  values (
    v.id,
    v.branch_id,
    clean_item_name,
    v.visit_date,
    auth.uid(),
    auth.uid(),
    p_image_path
  )
  returning id into new_item_id;

  return new_item_id;
end;
$$;

revoke all on function public.add_unavailable_item_details(uuid, text, text) from public, anon;
grant execute on function public.add_unavailable_item_details(uuid, text, text) to authenticated;
