-- Restrict unavailable-item reads to assigned branches for staff.
-- Active admins retain cross-branch visibility for operational review.
drop policy if exists "Active staff and admins can view unavailable items" on public.unavailable_items;
create policy "Users can view unavailable items in accessible branches"
on public.unavailable_items for select to authenticated
using (
  public.is_active_admin()
  or (
    exists (
      select 1 from public.profiles p
      where p.user_id = (select auth.uid()) and p.active = true
    )
    and public.can_access_branch(branch_id)
  )
);
