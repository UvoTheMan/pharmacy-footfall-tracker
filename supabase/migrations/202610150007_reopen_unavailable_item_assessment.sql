-- When staff corrects an unavailable-item name after admin review, reopen its assessment.
-- Staff cannot directly set a status; a genuine name edit automatically resets it to pending.
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

    if new.item_name is distinct from old.item_name then
      new.status := 'pending';
    end if;
  end if;

  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;
