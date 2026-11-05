-- Allow one customer visit to have multiple independently managed unavailable items.
ALTER TABLE public.unavailable_items DROP CONSTRAINT IF EXISTS unavailable_items_visit_id_key;

CREATE INDEX IF NOT EXISTS unavailable_items_visit_id_idx
  ON public.unavailable_items (visit_id);

CREATE OR REPLACE FUNCTION public.record_unavailable_items(
  p_branch_id uuid,
  p_outcome text,
  p_reason text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  new_visit_id uuid;
  new_visit_date date;
  item jsonb;
  clean_item_name text;
  clean_image_path text;
  item_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to record unavailable items.';
  END IF;

  IF p_outcome NOT IN ('purchased', 'not_purchased') THEN
    RAISE EXCEPTION 'Unsupported visit outcome.';
  END IF;
  IF p_outcome = 'not_purchased' AND p_reason IS DISTINCT FROM 'Item unavailable' THEN
    RAISE EXCEPTION 'No-purchase unavailable-item reports must use the Item unavailable reason.';
  END IF;
  IF p_outcome = 'purchased' AND p_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Purchased reports must not include a no-purchase reason.';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Provide a list of unavailable items.';
  END IF;

  item_count := jsonb_array_length(p_items);
  IF item_count < 1 OR item_count > 10 THEN
    RAISE EXCEPTION 'Add between 1 and 10 unavailable items per visit.';
  END IF;
  IF NOT public.can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch.';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    clean_item_name := trim(coalesce(item->>'item_name', ''));
    clean_image_path := nullif(trim(coalesce(item->>'image_path', '')), '');
    IF length(clean_item_name) < 1 OR length(clean_item_name) > 180 THEN
      RAISE EXCEPTION 'Each item name must be between 1 and 180 characters.';
    END IF;
    IF clean_image_path IS NOT NULL AND (
      length(clean_image_path) > 300
      OR split_part(clean_image_path, '/', 1) <> auth.uid()::text
      OR position('..' in clean_image_path) > 0
    ) THEN
      RAISE EXCEPTION 'A photo path is invalid.';
    END IF;
  END LOOP;

  INSERT INTO public.visits (
    branch_id, visit_date, recorded_at, outcome, reason,
    unavailable_item_requested, created_by
  ) VALUES (
    p_branch_id, (now() AT TIME ZONE 'Africa/Lagos')::date, now(), p_outcome,
    CASE WHEN p_outcome = 'not_purchased' THEN p_reason ELSE NULL END,
    true, auth.uid()
  )
  RETURNING id, visit_date INTO new_visit_id, new_visit_date;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    clean_item_name := trim(item->>'item_name');
    clean_image_path := nullif(trim(coalesce(item->>'image_path', '')), '');
    INSERT INTO public.unavailable_items (
      visit_id, branch_id, item_name, reported_on, created_by, updated_by, image_path
    ) VALUES (
      new_visit_id, p_branch_id, clean_item_name, new_visit_date, auth.uid(), auth.uid(), clean_image_path
    );
  END LOOP;

  RETURN new_visit_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_unavailable_items(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_unavailable_items(uuid, text, text, jsonb) TO authenticated;
