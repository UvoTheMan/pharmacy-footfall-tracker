-- Targeted consistency hardening for the existing correction workflows.
-- Keep the unavailable-item follow-up flag aligned with the corrected outcome/reason.
-- Existing unavailable_items register rows are deliberately preserved; this migration
-- does not delete operational records or change their assessment status.
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

  if v.visit_date is distinct from (now() at time zone 'Africa/Lagos')::date then
    raise exception 'Only visits recorded today can be corrected';
  end if;

  if not public.can_access_branch(v.branch_id) then
    raise exception 'No access to this branch';
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
      unavailable_item_requested = (
        p_outcome = 'not_purchased' and p_reason = 'Item unavailable'
      ),
      updated_at = now()
  where id = v.id;
end;
$$;

revoke all on function public.correct_visit(uuid, text, text) from public, anon;
grant execute on function public.correct_visit(uuid, text, text) to authenticated, service_role;

-- Recheck the destination branch at approval time, not only when the request
-- was created. FOR SHARE prevents it being deactivated during this transaction.
create or replace function public.approve_branch_correction(
  p_request_id uuid,
  p_visit_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.branch_correction_requests%rowtype;
  v_selected_count integer;
begin
  if not public.is_active_admin() then
    raise exception 'Administrator access required';
  end if;

  select *
  into r
  from public.branch_correction_requests
  where id = p_request_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Pending correction request not found';
  end if;

  if coalesce(cardinality(p_visit_ids), 0) = 0 then
    raise exception 'Select at least one visit to move';
  end if;

  perform 1
  from public.branches
  where id = r.target_branch_id and active = true
  for share;

  if not found then
    raise exception 'Destination branch is no longer active';
  end if;

  select count(*)
  into v_selected_count
  from public.visits
  where id = any(p_visit_ids)
    and branch_id = r.source_branch_id
    and visit_date = r.visit_date;

  if v_selected_count <> cardinality(p_visit_ids) then
    raise exception 'One or more selected visits do not match this request';
  end if;

  update public.visits
  set branch_id = r.target_branch_id,
      updated_at = now()
  where id = any(p_visit_ids)
    and branch_id = r.source_branch_id
    and visit_date = r.visit_date;

  update public.branch_correction_requests
  set status = 'approved',
      resolved_at = now()
  where id = r.id;
end;
$$;

revoke all on function public.approve_branch_correction(uuid, uuid[]) from public, anon;
grant execute on function public.approve_branch_correction(uuid, uuid[]) to authenticated, service_role;
