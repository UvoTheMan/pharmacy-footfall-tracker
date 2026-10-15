-- Securely attach unavailable-product details to an existing corrected visit.
-- This avoids client-side INSERTs being blocked by the register's RLS policy.
create or replace function public.correct_visit(p_visit_id uuid, p_outcome text, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v public.visits%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign-in required'; end if;
 if p_outcome not in ('purchased','not_purchased') then raise exception 'Invalid outcome'; end if;
 if p_outcome='not_purchased' and p_reason is null then raise exception 'Reason required'; end if;
 if p_outcome='purchased' and p_reason is not null then raise exception 'Purchased visit cannot have a reason'; end if;
 if p_reason is not null and p_reason not in ('Item unavailable','Price too high','Only enquiring','Preferred brand unavailable','Customer changed mind','Will buy later','Other / Unknown') then raise exception 'Invalid reason'; end if;
 select * into v from public.visits where id=p_visit_id for update;
 if not found then raise exception 'Visit not found'; end if;
 if not public.can_access_branch(v.branch_id) then raise exception 'No access to this branch'; end if;
 insert into public.visit_corrections(visit_id,branch_id,changed_by,previous_outcome,previous_reason,new_outcome,new_reason)
 values(v.id,v.branch_id,auth.uid(),v.outcome,v.reason,p_outcome,p_reason);
 update public.visits
 set outcome=p_outcome,
     reason=p_reason,
     unavailable_item_requested = case
       when p_outcome='not_purchased' then p_reason='Item unavailable'
       else v.unavailable_item_requested
     end,
     updated_at=now()
 where id=v.id;
end;
$$;
revoke all on function public.correct_visit(uuid,text,text) from public;
grant execute on function public.correct_visit(uuid,text,text) to authenticated;

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

  select * into v
  from public.visits
  where id = p_visit_id
  for update;

  if not found then raise exception 'Visit not found'; end if;
  if not public.can_access_branch(v.branch_id) then
    raise exception 'You do not have access to this branch.';
  end if;
  if v.outcome <> 'not_purchased' or v.reason <> 'Item unavailable' then
    raise exception 'This visit must have the Item unavailable no-purchase reason.';
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

revoke all on function public.add_unavailable_item_details(uuid,text,text) from public, anon;
grant execute on function public.add_unavailable_item_details(uuid,text,text) to authenticated;
