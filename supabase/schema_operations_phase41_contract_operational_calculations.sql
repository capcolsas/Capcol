-- Phase 41: contract-scoped operational calculations.
-- The daily closure remains global, but operational metrics are reconciled by
-- contract before being rolled up to daily_metrics.

do $$
begin
  if to_regprocedure('public.refresh_employee_daily_status_base(text)') is null then
    alter function public.refresh_employee_daily_status(text) rename to refresh_employee_daily_status_base;
  end if;
end $$;

create or replace function public.refresh_employee_daily_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  v_rows := public.refresh_employee_daily_status_base(p_fecha);

  with resolved as (
    select
      eds.id,
      ctx.contrato_codigo,
      ctx.contrato_nombre,
      ctx.cliente_nombre_snapshot,
      ctx.cliente_nit_snapshot
    from public.employee_daily_status eds
    cross join lateral public.resolve_contract_context(eds.sede_codigo, null, eds.employee_id, eds.documento) ctx
    where eds.fecha = p_fecha
  )
  update public.employee_daily_status eds
  set
    contrato_codigo = coalesce(resolved.contrato_codigo, eds.contrato_codigo),
    contrato_nombre = coalesce(resolved.contrato_nombre, eds.contrato_nombre),
    cliente_nombre_snapshot = coalesce(resolved.cliente_nombre_snapshot, eds.cliente_nombre_snapshot),
    cliente_nit_snapshot = coalesce(resolved.cliente_nit_snapshot, eds.cliente_nit_snapshot)
  from resolved
  where eds.id = resolved.id
    and (
      eds.contrato_codigo is distinct from coalesce(resolved.contrato_codigo, eds.contrato_codigo)
      or eds.contrato_nombre is distinct from coalesce(resolved.contrato_nombre, eds.contrato_nombre)
      or eds.cliente_nombre_snapshot is distinct from coalesce(resolved.cliente_nombre_snapshot, eds.cliente_nombre_snapshot)
      or eds.cliente_nit_snapshot is distinct from coalesce(resolved.cliente_nit_snapshot, eds.cliente_nit_snapshot)
    );

  return v_rows;
end;
$$;

create or replace function public.recompute_sede_status_from_employee_daily_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para sede_status: %', p_fecha;
  end if;

  if exists (
    select 1
    from public.daily_closures dc
    where dc.fecha = p_fecha
      and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
  ) then
    select count(*)::integer
    into v_rows
    from public.sede_status
    where fecha = p_fecha;
    return v_rows;
  end if;

  delete from public.sede_status where fecha = p_fecha;

  with active_sedes as (
    select s.*
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
  ),
  contracted_by_sede as (
    select
      eds.sede_codigo,
      count(*)::integer as contratados,
      count(*) filter (where eds.cuenta_pago_servicio = true)::integer as cubiertos
    from public.employee_daily_status eds
    where eds.fecha = p_fecha
      and eds.tipo_personal = 'empleado'
      and eds.servicio_programado = true
    group by eds.sede_codigo
  )
  insert into public.sede_status (
    id,
    fecha,
    sede_codigo,
    sede_nombre,
    contrato_codigo,
    contrato_nombre,
    cliente_nombre_snapshot,
    cliente_nit_snapshot,
    operarios_esperados,
    operarios_presentes,
    faltantes
  )
  select
    concat(p_fecha, '_', s.codigo) as id,
    p_fecha,
    s.codigo,
    s.nombre,
    s.contrato_codigo,
    s.contrato_nombre,
    s.cliente_nombre_snapshot,
    s.cliente_nit_snapshot,
    coalesce(c.contratados, 0),
    coalesce(c.cubiertos, 0),
    greatest(coalesce(c.contratados, 0) - coalesce(c.cubiertos, 0), 0)
  from active_sedes s
  left join contracted_by_sede c on c.sede_codigo = s.codigo;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.recompute_daily_contract_metrics_from_employee_daily_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para daily_contract_metrics: %', p_fecha;
  end if;

  delete from public.daily_contract_metrics where fecha = p_fecha;

  with active_sedes as (
    select s.*
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
      and nullif(trim(s.contrato_codigo), '') is not null
  ),
  per_sede as (
    select
      s.contrato_codigo,
      s.contrato_nombre,
      s.cliente_nombre_snapshot,
      s.cliente_nit_snapshot,
      greatest(coalesce(s.numero_operarios, 0), 0)::integer as planeados,
      coalesce(ss.operarios_esperados, 0)::integer as contratados,
      coalesce(ss.operarios_presentes, 0)::integer as asistencias,
      coalesce(ss.operarios_presentes, 0)::integer as pagados,
      coalesce(ss.faltantes, 0)::integer as ausentismos,
      greatest(greatest(coalesce(s.numero_operarios, 0), 0) - coalesce(ss.operarios_esperados, 0), 0)::integer as no_contratados,
      coalesce(ss.faltantes, 0)::integer as faltan,
      greatest(coalesce(ss.operarios_presentes, 0) - greatest(coalesce(s.numero_operarios, 0), 0), 0)::integer as sobran
    from active_sedes s
    left join public.sede_status ss
      on ss.fecha = p_fecha
      and ss.sede_codigo = s.codigo
  ),
  closure_flag as (
    select exists (
      select 1
      from public.daily_closures dc
      where dc.fecha = p_fecha
        and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
    ) as is_closed
  ),
  grouped as (
    select
      p_fecha as fecha,
      contrato_codigo,
      max(contrato_nombre) as contrato_nombre,
      max(cliente_nombre_snapshot) as cliente_nombre_snapshot,
      max(cliente_nit_snapshot) as cliente_nit_snapshot,
      sum(planeados)::integer as planeados,
      sum(contratados)::integer as contratados,
      sum(asistencias)::integer as asistencias,
      sum(ausentismos)::integer as ausentismos,
      sum(pagados)::integer as pagados,
      sum(no_contratados)::integer as no_contratados,
      sum(faltan)::integer as faltan,
      sum(sobran)::integer as sobran,
      (select is_closed from closure_flag) as closed
    from per_sede
    group by contrato_codigo
  )
  insert into public.daily_contract_metrics (
    fecha,
    contrato_codigo,
    contrato_nombre,
    cliente_nombre_snapshot,
    cliente_nit_snapshot,
    planeados,
    contratados,
    asistencias,
    ausentismos,
    pagados,
    no_contratados,
    faltan,
    sobran,
    closed
  )
  select
    fecha,
    contrato_codigo,
    contrato_nombre,
    cliente_nombre_snapshot,
    cliente_nit_snapshot,
    planeados,
    contratados,
    asistencias,
    ausentismos,
    pagados,
    no_contratados,
    faltan,
    sobran,
    closed
  from grouped;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.recompute_daily_metrics_from_employee_daily_status(p_fecha text)
returns public.daily_metrics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result public.daily_metrics;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para daily_metrics: %', p_fecha;
  end if;

  with contract_totals as (
    select
      p_fecha as fecha,
      coalesce(sum(planeados), 0)::integer as planned,
      coalesce(sum(contratados), 0)::integer as expected,
      coalesce(sum(asistencias), 0)::integer as attendance_count,
      coalesce(sum(ausentismos), 0)::integer as absenteeism,
      coalesce(sum(pagados), 0)::integer as paid_services,
      coalesce(sum(no_contratados), 0)::integer as no_contracted,
      coalesce(sum(faltan), 0)::integer as missing
    from public.daily_contract_metrics
    where fecha = p_fecha
  ),
  closure_flag as (
    select exists (
      select 1
      from public.daily_closures dc
      where dc.fecha = p_fecha
        and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
    ) as is_closed
  )
  insert into public.daily_metrics (
    id,
    fecha,
    planned,
    expected,
    unique_count,
    missing,
    attendance_count,
    absenteeism,
    paid_services,
    no_contracted,
    closed
  )
  select
    p_fecha,
    ct.fecha,
    ct.planned,
    ct.expected,
    ct.attendance_count,
    ct.missing,
    ct.attendance_count,
    ct.absenteeism,
    ct.paid_services,
    ct.no_contracted,
    (select is_closed from closure_flag)
  from contract_totals ct
  on conflict (id) do update
  set
    fecha = excluded.fecha,
    planned = excluded.planned,
    expected = excluded.expected,
    unique_count = excluded.unique_count,
    missing = excluded.missing,
    attendance_count = excluded.attendance_count,
    absenteeism = excluded.absenteeism,
    paid_services = excluded.paid_services,
    no_contracted = excluded.no_contracted,
    closed = excluded.closed,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function public.recompute_daily_sede_closures_from_sede_status(p_fecha text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para daily_sede_closures: %', p_fecha;
  end if;

  if exists (
    select 1
    from public.daily_closures dc
    where dc.fecha = p_fecha
      and (dc.locked = true or lower(trim(coalesce(dc.status, ''))) = 'closed')
  ) then
    select count(*)::integer
    into v_rows
    from public.daily_sede_closures
    where fecha = p_fecha;
    return v_rows;
  end if;

  delete from public.daily_sede_closures where fecha = p_fecha;

  with active_sedes as (
    select s.*
    from public.sedes s
    where lower(trim(coalesce(s.estado, 'activo'))) <> 'inactivo'
      and public.is_sede_scheduled_for_date_sql(s.jornada, p_fecha)
  )
  insert into public.daily_sede_closures (
    id,
    fecha,
    sede_codigo,
    sede_nombre,
    zona_codigo,
    zona_nombre,
    dependencia_codigo,
    dependencia_nombre,
    contrato_codigo,
    contrato_nombre,
    cliente_nombre_snapshot,
    cliente_nit_snapshot,
    planeados,
    contratados,
    registrados,
    faltantes,
    sobrantes
  )
  select
    concat(p_fecha, '_', s.codigo) as id,
    p_fecha,
    s.codigo,
    s.nombre,
    s.zona_codigo,
    s.zona_nombre,
    s.dependencia_codigo,
    s.dependencia_nombre,
    s.contrato_codigo,
    s.contrato_nombre,
    s.cliente_nombre_snapshot,
    s.cliente_nit_snapshot,
    greatest(coalesce(s.numero_operarios, 0), 0)::integer as planeados,
    coalesce(ss.operarios_esperados, 0)::integer as contratados,
    coalesce(ss.operarios_presentes, 0)::integer as registrados,
    coalesce(ss.faltantes, 0)::integer as faltantes,
    greatest(coalesce(ss.operarios_presentes, 0) - greatest(coalesce(s.numero_operarios, 0), 0), 0)::integer as sobrantes
  from active_sedes s
  left join public.sede_status ss
    on ss.fecha = p_fecha
    and ss.sede_codigo = s.codigo;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.validate_daily_contract_metric_consistency(p_fecha text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_fecha is null or p_fecha !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Fecha invalida para validacion de metricas: %', p_fecha;
  end if;

  with contract_totals as (
    select
      coalesce(sum(planeados), 0)::integer as planned,
      coalesce(sum(contratados), 0)::integer as expected,
      coalesce(sum(asistencias), 0)::integer as attendance_count,
      coalesce(sum(ausentismos), 0)::integer as absenteeism,
      coalesce(sum(pagados), 0)::integer as paid_services,
      coalesce(sum(no_contratados), 0)::integer as no_contracted,
      coalesce(sum(faltan), 0)::integer as missing
    from public.daily_contract_metrics
    where fecha = p_fecha
  ),
  global_metrics as (
    select
      coalesce(dm.planned, 0)::integer as planned,
      coalesce(dm.expected, 0)::integer as expected,
      coalesce(dm.attendance_count, 0)::integer as attendance_count,
      coalesce(dm.absenteeism, 0)::integer as absenteeism,
      coalesce(dm.paid_services, 0)::integer as paid_services,
      coalesce(dm.no_contracted, 0)::integer as no_contracted,
      coalesce(dm.missing, 0)::integer as missing
    from public.daily_metrics dm
    where dm.fecha = p_fecha
    limit 1
  ),
  global_compare as (
    select
      row_to_json(ct)::jsonb as contract_sum,
      jsonb_build_object(
        'planned', coalesce(gm.planned, 0),
        'expected', coalesce(gm.expected, 0),
        'attendance_count', coalesce(gm.attendance_count, 0),
        'absenteeism', coalesce(gm.absenteeism, 0),
        'paid_services', coalesce(gm.paid_services, 0),
        'no_contracted', coalesce(gm.no_contracted, 0),
        'missing', coalesce(gm.missing, 0)
      ) as daily_metrics,
      ct.planned = coalesce(gm.planned, 0)
        and ct.expected = coalesce(gm.expected, 0)
        and ct.attendance_count = coalesce(gm.attendance_count, 0)
        and ct.absenteeism = coalesce(gm.absenteeism, 0)
        and ct.paid_services = coalesce(gm.paid_services, 0)
        and ct.no_contracted = coalesce(gm.no_contracted, 0)
        and ct.missing = coalesce(gm.missing, 0) as ok
    from contract_totals ct
    left join global_metrics gm on true
  ),
  sede_contract_totals as (
    select
      contrato_codigo,
      coalesce(sum(planeados), 0)::integer as planeados,
      coalesce(sum(contratados), 0)::integer as contratados,
      coalesce(sum(registrados), 0)::integer as asistencias,
      coalesce(sum(faltantes), 0)::integer as ausentismos,
      coalesce(sum(registrados), 0)::integer as pagados,
      coalesce(sum(greatest(coalesce(planeados, 0) - coalesce(contratados, 0), 0)), 0)::integer as no_contratados,
      coalesce(sum(faltantes), 0)::integer as faltan,
      coalesce(sum(sobrantes), 0)::integer as sobran
    from public.daily_sede_closures
    where fecha = p_fecha
      and nullif(trim(contrato_codigo), '') is not null
    group by contrato_codigo
  ),
  metric_contract_totals as (
    select
      contrato_codigo,
      coalesce(planeados, 0)::integer as planeados,
      coalesce(contratados, 0)::integer as contratados,
      coalesce(asistencias, 0)::integer as asistencias,
      coalesce(ausentismos, 0)::integer as ausentismos,
      coalesce(pagados, 0)::integer as pagados,
      coalesce(no_contratados, 0)::integer as no_contratados,
      coalesce(faltan, 0)::integer as faltan,
      coalesce(sobran, 0)::integer as sobran
    from public.daily_contract_metrics
    where fecha = p_fecha
  ),
  contract_mismatches as (
    select
      coalesce(sct.contrato_codigo, mct.contrato_codigo) as contrato_codigo,
      row_to_json(sct)::jsonb as daily_sede_closures_sum,
      row_to_json(mct)::jsonb as daily_contract_metrics,
      (
        coalesce(sct.planeados, 0) = coalesce(mct.planeados, 0)
        and coalesce(sct.contratados, 0) = coalesce(mct.contratados, 0)
        and coalesce(sct.asistencias, 0) = coalesce(mct.asistencias, 0)
        and coalesce(sct.ausentismos, 0) = coalesce(mct.ausentismos, 0)
        and coalesce(sct.pagados, 0) = coalesce(mct.pagados, 0)
        and coalesce(sct.no_contratados, 0) = coalesce(mct.no_contratados, 0)
        and coalesce(sct.faltan, 0) = coalesce(mct.faltan, 0)
        and coalesce(sct.sobran, 0) = coalesce(mct.sobran, 0)
      ) as ok
    from sede_contract_totals sct
    full outer join metric_contract_totals mct on mct.contrato_codigo = sct.contrato_codigo
  ),
  contract_compare as (
    select
      coalesce(bool_and(ok), true) as ok,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'contrato_codigo', contrato_codigo,
          'daily_sede_closures_sum', daily_sede_closures_sum,
          'daily_contract_metrics', daily_contract_metrics
        )
      ) filter (where ok = false), '[]'::jsonb) as mismatches
    from contract_mismatches
  )
  select jsonb_build_object(
    'ok', (select ok from global_compare) and (select ok from contract_compare),
    'fecha', p_fecha,
    'global', jsonb_build_object(
      'ok', (select ok from global_compare),
      'contract_sum', (select contract_sum from global_compare),
      'daily_metrics', (select daily_metrics from global_compare)
    ),
    'contracts', jsonb_build_object(
      'ok', (select ok from contract_compare),
      'mismatches', (select mismatches from contract_compare)
    )
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.refresh_operational_snapshots_from_employee_daily_status(p_fecha text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee_rows integer := 0;
  v_sedes integer := 0;
  v_contracts integer := 0;
  v_sede_closures integer := 0;
  v_metrics public.daily_metrics;
  v_validation jsonb;
begin
  v_employee_rows := public.refresh_employee_daily_status(p_fecha);
  v_sedes := public.recompute_sede_status_from_employee_daily_status(p_fecha);
  v_contracts := public.recompute_daily_contract_metrics_from_employee_daily_status(p_fecha);
  v_metrics := public.recompute_daily_metrics_from_employee_daily_status(p_fecha);
  v_sede_closures := public.recompute_daily_sede_closures_from_sede_status(p_fecha);
  v_validation := public.validate_daily_contract_metric_consistency(p_fecha);

  if coalesce((v_validation ->> 'ok')::boolean, false) = false then
    raise exception 'Inconsistencia en metricas operativas por contrato para %: %', p_fecha, v_validation;
  end if;

  return jsonb_build_object(
    'fecha', p_fecha,
    'employee_daily_status_rows', v_employee_rows,
    'sede_status_rows', v_sedes,
    'daily_contract_metrics_rows', v_contracts,
    'daily_metrics_id', v_metrics.id,
    'daily_sede_closures_rows', v_sede_closures,
    'attendance_count', v_metrics.attendance_count,
    'expected', v_metrics.expected,
    'planned', v_metrics.planned,
    'validation', v_validation
  );
end;
$$;

grant execute on function public.refresh_employee_daily_status(text) to authenticated;
grant execute on function public.recompute_sede_status_from_employee_daily_status(text) to authenticated;
grant execute on function public.recompute_daily_contract_metrics_from_employee_daily_status(text) to authenticated;
grant execute on function public.recompute_daily_metrics_from_employee_daily_status(text) to authenticated;
grant execute on function public.recompute_daily_sede_closures_from_sede_status(text) to authenticated;
grant execute on function public.validate_daily_contract_metric_consistency(text) to authenticated;
grant execute on function public.refresh_operational_snapshots_from_employee_daily_status(text) to authenticated;
