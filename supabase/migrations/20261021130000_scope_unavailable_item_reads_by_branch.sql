-- Restrict unavailable-item reads to branches the signed-in user can access.
-- Active admins retain cross-branch visibility for operational review.
-- Drop both names so this migration remains safe if the policy already exists.
drop policy if exists "Active staff and admins can view unavailable items" on public.unavailable_items;
drop policy if exists "Users can view unavailable items in accessible branches" on public.unavailable_items;

create policy "Users can view unavailable items in accessible branches"
on public.unavailable_items
for select
to authenticated
using (
  public.is_active_admin()
  or (
    exists (
      select 1
      from public.profiles p
      where p.user_id = (select auth.uid())
        and p.active = true
    )
    and public.can_access_branch(branch_id)
  )
);
