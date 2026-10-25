-- Expose active branch labels to the shared unavailable-item register without widening
-- the branches table RLS policy used to control staff branch selection.
CREATE OR REPLACE FUNCTION public.list_active_branch_labels()
RETURNS TABLE (id uuid, slug text, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.id, b.slug, b.name
  FROM public.branches AS b
  WHERE b.active = true
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.user_id = (SELECT auth.uid())
        AND p.active = true
    )
  ORDER BY b.name;
$$;

REVOKE ALL ON FUNCTION public.list_active_branch_labels() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_branch_labels() TO authenticated;
