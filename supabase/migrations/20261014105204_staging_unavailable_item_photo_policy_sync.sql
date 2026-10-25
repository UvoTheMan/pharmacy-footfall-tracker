-- Canonical reconciliation for unavailable-item photo storage policies.
-- The original staging-only source file for this recorded version was not
-- present in the integration history. This idempotent definition reasserts
-- the same policy behavior currently verified in staging; it is not claimed
-- to be a byte-for-byte recovery of the historical SQL.
--
-- The base photo migration creates these policies too. Reapplying them here
-- is intentional and safe on fresh databases, while this version is already
-- recorded as applied in staging.

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

DROP POLICY IF EXISTS "Owners can remove unlinked unavailable-item photos" ON storage.objects;
CREATE POLICY "Owners can remove unlinked unavailable-item photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'unavailable-item-photos'
  AND split_part(name, '/', 1) = (SELECT auth.uid())::text
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid()) AND p.active = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.unavailable_items ui
    WHERE ui.image_path = storage.objects.name
  )
);
