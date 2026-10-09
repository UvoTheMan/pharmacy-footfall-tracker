-- Audited, branch-scoped visit corrections.
create table if not exists public.visit_corrections (
 id uuid primary key default gen_random_uuid(),
 visit_id uuid not null references public.visits(id) on delete cascade,
 branch_id uuid not null references public.branches(id),
 changed_by uuid not null references auth.users(id),
 previous_outcome text not null,
 previous_reason text,
 new_outcome text not null,
 new_reason text,
 corrected_at timestamptz not null default now()
);
create index if not exists visit_corrections_visit_id_idx on public.visit_corrections(visit_id, corrected_at desc);
alter table public.visit_corrections enable row level security;
drop policy if exists "Branch members can view visit correction history" on public.visit_corrections;
create policy "Branch members can view visit correction history"
on public.visit_corrections for select to authenticated
using (public.can_access_branch(branch_id));
grant select on public.visit_corrections to authenticated;

create or replace function public.correct_visit(p_visit_id uuid, p_outcome text, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v public.visits%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign-in required'; end if;
 if p_outcome not in ('purchased','not_purchased') then raise exception 'Invalid outcome'; end if;
 if p_outcome='not_purchased' and p_reason is null then raise exception 'Reason required'; end if;
 if p_outcome='purchased' and p_reason is not null then raise exception 'Purchased visit cannot have a reason'; end if;
 if p_reason is not null and p_reason not in ('Item unavailable','Price too high','Only enquiring','Preferred brand unavailable','Customer changed mind','Will buy later','Other / Unknown') then raise exception 'Invalid reason'; end if;
 select * into v from public.visits where id=p_visit_id for update;
 if not found then raise exception 'Visit not found'; end if;
 if not public.can_access_branch(v.branch_id) then raise exception 'No access to this branch'; end if;
 insert into public.visit_corrections(visit_id,branch_id,changed_by,previous_outcome,previous_reason,new_outcome,new_reason)
 values(v.id,v.branch_id,auth.uid(),v.outcome,v.reason,p_outcome,p_reason);
 update public.visits set outcome=p_outcome, reason=p_reason, updated_at=now() where id=v.id;
end;
$$;
revoke all on function public.correct_visit(uuid,text,text) from public;
grant execute on function public.correct_visit(uuid,text,text) to authenticated;
