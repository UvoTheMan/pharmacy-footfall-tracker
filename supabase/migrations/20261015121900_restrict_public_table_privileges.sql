-- Restrict direct table privileges in the exposed public schema.
-- RLS remains the row-level authorization layer; table grants are an additional boundary.
-- Anonymous clients have no intended access to Footlytics application tables.
REVOKE ALL PRIVILEGES ON TABLE
  public.branch_correction_requests,
  public.branch_memberships,
  public.branches,
  public.profiles,
  public.unavailable_items,
  public.visit_corrections,
  public.visits
FROM anon;

-- TRUNCATE is not governed by RLS. Remove it from signed-in app users.
-- REFERENCES and TRIGGER are also not required by the browser application.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.branch_correction_requests,
  public.branch_memberships,
  public.branches,
  public.profiles,
  public.unavailable_items,
  public.visit_corrections,
  public.visits
FROM authenticated;
