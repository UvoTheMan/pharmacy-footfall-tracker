-- Footlytics records exactly two visit outcomes.
-- Stop safely if historical undecided rows still need a human decision.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.visits
    WHERE outcome = 'undecided'
  ) THEN
    RAISE EXCEPTION
      'Cannot remove the undecided visit outcome while historical undecided records remain. Review and classify those records first.';
  END IF;
END
$$;

ALTER TABLE public.visits
  DROP CONSTRAINT IF EXISTS visits_outcome_check;

ALTER TABLE public.visits
  ADD CONSTRAINT visits_outcome_check
  CHECK (outcome IN ('purchased', 'not_purchased'));
