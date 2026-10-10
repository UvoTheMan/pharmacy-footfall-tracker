-- Branch-selection correction requests. No requester/approver identity is stored.
create table if not exists public.branch_correction_requests (
  id uuid primary key default gen_random_uuid(),
  source_branch_id uuid not null references public.branches(id),
  target_branch_id uuid not null references public.branches(id),
  visit_date date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint branch_correction_different_branches check (source_branch_id <> target_branch_id)
);

create index if not exists branch_correction_pending_idx
on public.branch_correction_requests(status, created_at desc);

alter table public.branch_correction_requests enable row level security;

drop policy if exists "Admins can view branch correction requests" on public.branch_correction_requests;
create policy "Admins can view branch correction requests"
on public.branch_correction_requests for select to authenticated
using (public.is_active_admin());

grant select on public.branch_correction_requests to authenticated;

create or replace function public.request_branch_correction(
  p_source_branch_id uuid,
  p_target_branch_id uuid,
  p_visit_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  if not public.can_access_branch(p_source_branch_id) then
    raise exception 'No access to the selected source branch';
  end if;
  if not public.can_access_branch(p_target_branch_id) then
    raise exception 'No access to the selected destination branch';
  end if;
  if p_source_branch_id = p_target_branch_id then
    raise exception 'Choose a different destination branch';
  end if;
  if p_visit_date <> (now() at time zone 'Africa/Lagos')::date then
    raise exception 'Only the current date can be corrected';
  end if;
  if not exists (
    select 1 from public.branches
    where id = p_target_branch_id and active = true
  ) then raise exception 'Destination branch is unavailable'; end if;
  if not exists (
    select 1 from public.visits
    where branch_id = p_source_branch_id and visit_date = p_visit_date
  ) then raise exception 'No visits exist for this branch and date'; end if;
  if exists (
    select 1 from public.branch_correction_requests
    where source_branch_id = p_source_branch_id
      and target_branch_id = p_target_branch_id
      and visit_date = p_visit_date
      and status = 'pending'
  ) then raise exception 'A correction request is already pending'; end if;

  insert into public.branch_correction_requests(source_branch_id, target_branch_id, visit_date)
  values (p_source_branch_id, p_target_branch_id, p_visit_date)
  returning id into v_request_id;

  return v_request_id;
end;
$$;

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
  if not public.is_active_admin() then raise exception 'Administrator access required'; end if;

  select * into r
  from public.branch_correction_requests
  where id = p_request_id and status = 'pending'
  for update;

  if not found then raise exception 'Pending correction request not found'; end if;
  if coalesce(cardinality(p_visit_ids), 0) = 0 then
    raise exception 'Select at least one visit to move';
  end if;

  select count(*) into v_selected_count
  from public.visits
  where id = any(p_visit_ids)
    and branch_id = r.source_branch_id
    and visit_date = r.visit_date;

  if v_selected_count <> cardinality(p_visit_ids) then
    raise exception 'One or more selected visits do not match this request';
  end if;

  update public.visits
  set branch_id = r.target_branch_id, updated_at = now()
  where id = any(p_visit_ids)
    and branch_id = r.source_branch_id
    and visit_date = r.visit_date;

  update public.branch_correction_requests
  set status = 'approved', resolved_at = now()
  where id = r.id;
end;
$$;

create or replace function public.reject_branch_correction(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_active_admin() then raise exception 'Administrator access required'; end if;
  update public.branch_correction_requests
  set status = 'rejected', resolved_at = now()
  where id = p_request_id and status = 'pending';
  if not found then raise exception 'Pending correction request not found'; end if;
end;
$$;

revoke all on function public.request_branch_correction(uuid, uuid, date) from public;
revoke all on function public.approve_branch_correction(uuid, uuid[]) from public;
revoke all on function public.reject_branch_correction(uuid) from public;
grant execute on function public.request_branch_correction(uuid, uuid, date) to authenticated;
grant execute on function public.approve_branch_correction(uuid, uuid[]) to authenticated;
grant execute on function public.reject_branch_correction(uuid) to authenticated;
