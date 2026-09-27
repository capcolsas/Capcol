-- Decisions by circumstance. No payroll calculation or alteration of markings.
begin;
alter table public.employee_shift_status
  add column if not exists review_decisions jsonb not null default '{}'::jsonb;

create or replace function public.shift_review_pending_types(r jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(t.key order by t.ord), '{}'::text[])
  from (values
    (1, 'entrada_anticipada', 'early_entry_minutes', 'early_entry_reason', ''),
    (2, 'entrada_tardia', 'late_entry_minutes', 'late_entry_reason', 'trabajado_tardio'),
    (3, 'salida_anticipada', 'early_exit_minutes', 'early_exit_reason', 'retiro_anticipado'),
    (4, 'salida_tardia', 'late_exit_minutes', 'late_exit_reason', ''),
    (5, 'salida_sin_registro', '', '', 'salida_pendiente'),
    (6, 'registro_post_cierre', '', '', 'post_cierre_pendiente')
  ) t(ord,key,minutes_field,reason_field,status)
  where coalesce(r->>'estado_turno','') not in ('ausente_con_novedad','ausente_sin_reemplazo','sin_registro','cancelado')
    and not (r->>'estado_turno' = 'ajustado' and not coalesce((r->>'requires_review')::boolean,false))
    and not coalesce(r->'review_decisions','{}'::jsonb) ? t.key
    and not (t.key = 'entrada_anticipada' and nullif(r->>'entry_authorization_id','') is not null)
    and not (t.key = 'salida_tardia' and nullif(r->>'exit_authorization_id','') is not null)
    and (coalesce((r->>t.minutes_field)::numeric,0) > 0
      or (t.status <> '' and r->>'estado_turno' = t.status)
      or (coalesce((r->'timing_alerts'->>t.key)::numeric,0) > 0 and nullif(trim(r->>t.reason_field),'') is null));
$$;

create or replace function public.resolve_shift_review_decision(
  p_status_id text, p_circumstance text, p_effect text, p_minutes integer,
  p_reason text, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  s public.employee_shift_status%rowtype;
  shift_id uuid;
  v_shift public.scheduled_shifts%rowtype;
  v_before jsonb;
  v_decision jsonb;
  v_pending text[];
  v_authorization uuid;
  v_actor uuid := auth.uid();
  v_email text := auth.jwt()->>'email';
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null or not public.current_profile_has_permission('manageShiftReview','manageOperationRegistry') then
    raise exception 'No tienes permiso para gestionar revisiones.';
  end if;
  if p_effect is null or p_effect not in ('addition','deduction','none')
    or p_minutes is null or (p_effect = 'none' and p_minutes <> 0)
    or (p_effect <> 'none' and p_minutes <= 0) or nullif(trim(p_reason),'') is null then
    raise exception 'La decision requiere un motivo y minutos validos.';
  end if;
  select scheduled_shift_id into shift_id from public.employee_shift_status where id = p_status_id;
  -- Same lock order as attendance and automatic closure.
  select * into v_shift from public.scheduled_shifts where id = shift_id for update;
  select * into s from public.employee_shift_status where id = p_status_id for update;
  if not found or not public.can_read_contract_data(s.contrato_codigo) then
    raise exception 'Registro no disponible en tu contrato.';
  end if;
  if p_expected_updated_at is null or s.updated_at is distinct from p_expected_updated_at then
    raise exception 'El registro cambio. Consulta nuevamente antes de decidir.';
  end if;
  v_before := to_jsonb(s);
  v_pending := public.shift_review_pending_types(v_before);
  if p_circumstance is null or not p_circumstance = any(v_pending) then
    raise exception 'La circunstancia ya fue gestionada o no esta pendiente.';
  end if;
  if (p_effect = 'addition' and p_circumstance not in ('entrada_anticipada','salida_tardia'))
    or (p_effect = 'deduction' and p_circumstance not in ('entrada_tardia','salida_anticipada')) then
    raise exception 'El tipo de ajuste no corresponde a esta circunstancia.';
  end if;
  -- Preserve existing additional-time authorizations. Deductions are decisions
  -- in shift_adjustments, never negative minutes in an attendance authorization.
  if p_effect = 'addition' then
    insert into public.shift_time_authorizations (
      scheduled_shift_id, employee_id, documento, authorization_type, minutes_authorized, authorized_from, authorized_until,
      reason, estado, requested_by_uid, requested_by_email, approved_by_uid, approved_by_email, approved_at
    ) values (s.scheduled_shift_id, s.employee_id, s.documento,
      case p_circumstance when 'entrada_anticipada' then 'early_entry' else 'late_exit' end,
      p_minutes,
      case p_circumstance when 'entrada_anticipada' then s.entrada_at else v_shift.ends_at end,
      case p_circumstance when 'entrada_anticipada' then v_shift.starts_at else s.salida_at end,
      trim(p_reason), 'aprobada', v_actor, v_email, v_actor, v_email, v_now)
    returning id into v_authorization;
  end if;
  v_decision := jsonb_build_object('effect',p_effect,'minutes',p_minutes,
    'signedMinutes',case p_effect when 'addition' then p_minutes when 'deduction' then -p_minutes else 0 end,
    'reason',trim(p_reason),'actorUid',v_actor,'actorEmail',v_email,'decidedAt',v_now,'authorizationId',v_authorization);
  s.review_decisions := s.review_decisions || jsonb_build_object(p_circumstance,v_decision);
  v_pending := public.shift_review_pending_types(to_jsonb(s));
  update public.employee_shift_status set
    review_decisions = s.review_decisions,
    requires_review = cardinality(v_pending) > 0,
    estado_turno = case when cardinality(v_pending) = 0 then 'ajustado' else s.estado_turno end,
    entry_authorization_id = case when p_circumstance = 'entrada_anticipada' and v_authorization is not null then v_authorization else s.entry_authorization_id end,
    exit_authorization_id = case when p_circumstance = 'salida_tardia' and v_authorization is not null then v_authorization else s.exit_authorization_id end,
    updated_at = v_now
  where id = p_status_id;
  if not found then raise exception 'No se pudo actualizar la revision.'; end if;
  insert into public.shift_adjustments (
    scheduled_shift_id, employee_id, documento, tipo, estado, before_snapshot, after_snapshot,
    motivo, approved_by_uid, approved_by_email, approved_at
  ) values (s.scheduled_shift_id,s.employee_id,s.documento,
    case p_circumstance when 'salida_sin_registro' then 'correccion_manual' else p_circumstance end,
    'aprobado',v_before,jsonb_build_object('circumstance',p_circumstance,'decision',v_decision),
    trim(p_reason),v_actor,v_email,v_now);
  insert into public.audit_logs(actor_uid,actor_email,target_type,target_id,action,before_data,after_data,note)
  values(v_actor,v_email,'employee_shift_status',p_status_id,'resolve_shift_review_decision',v_before,
    jsonb_build_object('circumstance',p_circumstance,'decision',v_decision),trim(p_reason));
  return jsonb_build_object('decision',v_decision,'remaining',v_pending);
end;
$$;
revoke all on function public.resolve_shift_review_decision(text,text,text,integer,text,timestamptz) from public, anon;
grant execute on function public.resolve_shift_review_decision(text,text,text,integer,text,timestamptz) to authenticated;

-- A later marking must not inherit the approval of an earlier marking.
create or replace function public.invalidate_changed_shift_review_decisions()
returns trigger language plpgsql set search_path = public as $$
declare v_previous jsonb := new.review_decisions;
begin
  if new.entrada_at is distinct from old.entrada_at
    or new.early_entry_minutes is distinct from old.early_entry_minutes
    or new.late_entry_minutes is distinct from old.late_entry_minutes then
    new.review_decisions := new.review_decisions - 'entrada_anticipada' - 'entrada_tardia';
    if old.review_decisions ? 'entrada_anticipada' then new.entry_authorization_id := null; end if;
  end if;
  if new.salida_at is distinct from old.salida_at
    or new.early_exit_minutes is distinct from old.early_exit_minutes
    or new.late_exit_minutes is distinct from old.late_exit_minutes then
    new.review_decisions := new.review_decisions - 'salida_anticipada' - 'salida_tardia' - 'salida_sin_registro' - 'registro_post_cierre';
    if old.review_decisions ? 'salida_tardia' then new.exit_authorization_id := null; end if;
  end if;
  if new.review_decisions is distinct from v_previous then
    new.requires_review := true;
    if new.estado_turno = 'ajustado' then new.estado_turno := 'trabajado'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists invalidate_changed_shift_review_decisions on public.employee_shift_status;
create trigger invalidate_changed_shift_review_decisions before update on public.employee_shift_status
for each row execute function public.invalidate_changed_shift_review_decisions();
commit;
