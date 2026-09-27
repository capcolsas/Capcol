-- Cierre diario legacy del dia anterior a las 02:10 America/Bogota (07:10 UTC).
-- Franja sin registros de asistencia observados en septiembre de 2026 (00:00-04:59).
-- El minuto 10 evita coincidir con el inicio del job de turnos cada 15 minutos;
-- no garantiza ausencia de solapamiento si una ejecucion se prolonga.
-- Los turnos nocturnos siguen abiertos hasta su fin y ventana de salida.
-- El resumen diario es un corte a esta hora, no certifica la salida nocturna.
-- Conserva URL, autenticacion y configuracion del job existente.
-- No altera el cierre individual de turnos cada 15 minutos.
begin;

do $$
declare
  daily_job_id bigint;
begin
  select jobid into daily_job_id
  from cron.job
  where jobname = 'rocky_close_daily_operation_legacy';

  if daily_job_id is null then
    raise exception 'No existe el job diario. Configura primero schema_operations_phase28_supabase_cron.sql.';
  end if;

  perform cron.alter_job(daily_job_id, schedule := '10 7 * * *');
end $$;

commit;

-- Verificacion sin exponer el comando ni sus credenciales.
select jobid, jobname, schedule, active
from cron.job
where jobname in ('rocky_close_daily_operation_legacy', 'rocky_close_shifts_every_15_minutes');
