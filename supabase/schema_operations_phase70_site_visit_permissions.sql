-- Phase 70: split site-visit access into consult (viewSiteVisits) and manage (manageSiteVisits).
-- Apply after phase 69.
--
-- Until now visit_admin() required editContracts for reading AND managing visits, so the
-- Centro de Permisos could not grant one without the other. Both new keys fall back to
-- editContracts, so roles and users without an explicit value keep exactly their current access.
begin;

-- Manage: program cycles (visit_save_settings) and review visits (visit_review).
create or replace function public.visit_admin(p_contract text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.can_read_contract_data(p_contract) and public.current_profile_has_permission('manageSiteVisits','editContracts'),false)
$$;

-- Consult: read every cycle, assignment and visit of the contract.
create or replace function public.visit_viewer(p_contract text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.can_read_contract_data(p_contract) and (
   public.current_profile_has_permission('viewSiteVisits','editContracts')
   or public.current_profile_has_permission('manageSiteVisits','editContracts')
 ),false)
$$;
grant execute on function public.visit_viewer(text) to authenticated;

create or replace function public.visit_assignment_read(p_assignment uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from visit_assignments a where a.id=p_assignment and
 (visit_viewer(a.contrato_codigo) or (a.supervisor_id=auth.uid() and visit_active_user())))
$$;

drop policy if exists visit_settings_read on public.visit_settings;
create policy visit_settings_read on public.visit_settings for select to authenticated using(visit_viewer(contrato_codigo));
drop policy if exists visit_cycles_read on public.visit_cycles;
create policy visit_cycles_read on public.visit_cycles for select to authenticated using(visit_viewer(contrato_codigo) or exists(select 1 from visit_assignments a where a.cycle_id=visit_cycles.id and a.supervisor_id=auth.uid()));

commit;
