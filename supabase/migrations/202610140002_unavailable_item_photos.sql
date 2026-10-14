-- Optional photos for the shared unavailable-item register. Staging/Preview only.
ALTER TABLE public.unavailable_items
  ADD COLUMN IF NOT EXISTS image_path text;

ALTER TABLE public.unavailable_items
  DROP CONSTRAINT IF EXISTS unavailable_items_image_path_owner_check;
ALTER TABLE public.unavailable_items
  ADD CONSTRAINT unavailable_items_image_path_owner_check
  CHECK (
    image_path IS NULL OR (
      length(image_path) BETWEEN 1 AND 300
      AND split_part(image_path, '/', 1) = created_by::text
      AND position('..' in image_path) = 0
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'unavailable-item-photos',
  'unavailable-item-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']::text[];

DROP POLICY IF EXISTS "Active staff can upload unavailable-item photos" ON storage.objects;
CREATE POLICY "Active staff can upload unavailable-item photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'unavailable-item-photos'
  AND split_part(name, '/', 1) = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid()) AND p.active = true
  )
);

DROP POLICY IF EXISTS "Active staff can view unavailable-item photos" ON storage.objects;
CREATE POLICY "Active staff can view unavailable-item photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'unavailable-item-photos'
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid()) AND p.active = true
  )
);

DROP FUNCTION IF EXISTS public.record_unavailable_item(uuid, text, text, text);
CREATE OR REPLACE FUNCTION public.record_unavailable_item(
  p_branch_id uuid,
  p_outcome text,
  p_reason text,
  p_item_name text,
  p_image_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  new_visit_id uuid;
  new_visit_date date;
  clean_item_name text := trim(coalesce(p_item_name, ''));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to record an unavailable item.';
  END IF;
  IF length(clean_item_name) < 1 OR length(clean_item_name) > 180 THEN
    RAISE EXCEPTION 'Enter an item name between 1 and 180 characters.';
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
  IF p_image_path IS NOT NULL AND (
    length(p_image_path) > 300
    OR split_part(p_image_path, '/', 1) <> auth.uid()::text
    OR position('..' in p_image_path) > 0
  ) THEN
    RAISE EXCEPTION 'The photo path is invalid.';
  END IF;
  IF NOT public.can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'You do not have access to this branch.';
  END IF;

  INSERT INTO public.visits (
    branch_id, visit_date, recorded_at, outcome, reason,
    unavailable_item_requested, created_by
  ) VALUES (
    p_branch_id, (now() AT TIME ZONE 'Africa/Lagos')::date, now(), p_outcome,
    CASE WHEN p_outcome = 'not_purchased' THEN p_reason ELSE NULL END,
    true, auth.uid()
  )
  RETURNING id, visit_date INTO new_visit_id, new_visit_date;

  INSERT INTO public.unavailable_items (
    visit_id, branch_id, item_name, reported_on, created_by, updated_by, image_path
  ) VALUES (
    new_visit_id, p_branch_id, clean_item_name, new_visit_date, auth.uid(), auth.uid(), p_image_path
  );

  RETURN new_visit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_unavailable_item(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_unavailable_item(uuid, text, text, text, text) TO authenticated;
