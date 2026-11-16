-- Track reliable resolution timestamps for unavailable-item reports.
-- Existing resolved rows intentionally remain NULL because their actual
-- resolution time cannot be reconstructed from updated_at.
ALTER TABLE public.unavailable_items
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE OR REPLACE FUNCTION public.guard_unavailable_item_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
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

  -- Only record a timestamp when an admin changes the status into resolved.
  -- Clear it if a resolved report is reopened, so a later resolution gets
  -- a fresh and accurate timestamp.
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := now();
  elsif new.status is distinct from 'resolved' then
    new.resolved_at := null;
  else
    new.resolved_at := old.resolved_at;
  end if;

  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$function$;
