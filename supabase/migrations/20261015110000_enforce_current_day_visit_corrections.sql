-- Restrict visit outcome corrections to today's Lagos calendar date.
-- The app only loads today's visits in Recent Visits. Enforcing the same rule
-- here prevents direct RPC calls from changing historical records while
-- preserving the existing correction UI, audit log, and unavailable-item flow.
create or replace function public.correct_visit(
  p_visit_id uuid,
  p_outcome text,
  p_reason text
)
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
    'Item unavailable',
    'Price too high',
    'Only enquiring',
    'Preferred brand unavailable',
    'Customer changed mind',
    'Will buy later',
    'Other / Unknown'
  ) then
    raise exception 'Invalid reason';
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
    raise exception 'No access to this branch';
  end if;

  -- Match App.tsx, which loads records for the Africa/Lagos calendar day.
  if v.visit_date is distinct from (now() at time zone 'Africa/Lagos')::date then
    raise exception 'Only visits recorded today can be corrected';
  end if;

  insert into public.visit_corrections (
    visit_id,
    branch_id,
    changed_by,
    previous_outcome,
    previous_reason,
    new_outcome,
    new_reason
  )
  values (
    v.id,
    v.branch_id,
    auth.uid(),
    v.outcome,
    v.reason,
    p_outcome,
    p_reason
  );

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
