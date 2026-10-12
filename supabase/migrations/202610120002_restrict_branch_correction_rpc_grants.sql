-- Ensure branch/visit SECURITY DEFINER functions cannot be called anonymously.
-- RPCs needed by the app remain executable by signed-in users; approval/rejection
-- functions enforce admin privileges internally. Trigger functions need no client grants.
revoke all on function public.approve_branch_correction(uuid, uuid[]) from public, anon;
revoke all on function public.reject_branch_correction(uuid) from public, anon;
revoke all on function public.request_branch_correction(uuid, uuid, date) from public, anon;
revoke all on function public.get_active_correction_branches() from public, anon;
revoke all on function public.has_pending_branch_correction(uuid, date) from public, anon;
revoke all on function public.can_access_branch(uuid) from public, anon;
revoke all on function public.correct_visit(uuid, text, text) from public, anon;
revoke all on function public.is_active_admin() from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.prevent_visits_during_branch_correction() from public, anon, authenticated;

grant execute on function public.approve_branch_correction(uuid, uuid[]) to authenticated;
grant execute on function public.reject_branch_correction(uuid) to authenticated;
grant execute on function public.request_branch_correction(uuid, uuid, date) to authenticated;
grant execute on function public.get_active_correction_branches() to authenticated;
grant execute on function public.has_pending_branch_correction(uuid, date) to authenticated;
grant execute on function public.can_access_branch(uuid) to authenticated;
grant execute on function public.correct_visit(uuid, text, text) to authenticated;
grant execute on function public.is_active_admin() to authenticated;
