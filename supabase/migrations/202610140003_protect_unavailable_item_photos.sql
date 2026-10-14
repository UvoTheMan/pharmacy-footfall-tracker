-- Keep photo references immutable for staff corrections. Admins may still update report metadata.
CREATE OR REPLACE FUNCTION public.guard_unavailable_item_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_active_admin() THEN
    IF new.status IS DISTINCT FROM old.status
      OR new.branch_id IS DISTINCT FROM old.branch_id
      OR new.visit_id IS DISTINCT FROM old.visit_id
      OR new.reported_on IS DISTINCT FROM old.reported_on
      OR new.created_by IS DISTINCT FROM old.created_by
      OR new.recorded_at IS DISTINCT FROM old.recorded_at
      OR new.image_path IS DISTINCT FROM old.image_path THEN
      RAISE EXCEPTION 'Staff can correct the item name only.';
    END IF;
  END IF;
  new.updated_by := (SELECT auth.uid());
  new.updated_at := now();
  RETURN new;
END;
$$;
