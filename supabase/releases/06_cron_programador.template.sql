-- ============================================================
-- Rocky | 06 Programador de cierres (Supabase Cron)  -- OPCIONAL, UNA VEZ POR PROYECTO
-- Generado por supabase/build_release_bundles.mjs. Editar la plantilla en el generador.
--
-- NO forma parte de la actualizacion 01..05: contiene la URL y el secreto del backend de cada
-- proyecto. Ejecutalo solo al activar el cierre automatico o cuando cambien URL o secreto.
-- Nunca guardes el secreto real en el repositorio: reemplaza los dos valores en el editor SQL.
-- Requiere haber ejecutado antes los bundles 01..05 y haber desplegado el backend.
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  backend_base_url text := 'https://TU_BACKEND.vercel.app';
  cron_secret text := 'TU_CRON_SECRET';
  close_shifts_url text;
  close_daily_url text;
begin
  if backend_base_url = 'https://TU_BACKEND.vercel.app' or cron_secret = 'TU_CRON_SECRET' then
    raise exception 'Reemplaza backend_base_url y cron_secret antes de ejecutar este script.';
  end if;

  backend_base_url := regexp_replace(trim(backend_base_url), '/+$', '');
  close_shifts_url := backend_base_url || '/api/cron/close-shifts';
  close_daily_url := backend_base_url || '/api/cron/close-daily-operation';

  begin perform cron.unschedule('rocky_close_shifts_every_15_minutes'); exception when others then null; end;
  begin perform cron.unschedule('rocky_close_daily_operation_legacy'); exception when others then null; end;

  perform cron.schedule(
    'rocky_close_shifts_every_15_minutes',
    '*/15 * * * *',
    format($cron$
      select net.http_get(
        url := %L,
        headers := jsonb_build_object('Authorization', 'Bearer ' || %L),
        timeout_milliseconds := 25000
      ) as request_id;
    $cron$, close_shifts_url, cron_secret)
  );

  -- Cierre diario a las 02:10 America/Bogota (07:10 UTC), franja de baja actividad de marcaciones.
  perform cron.schedule(
    'rocky_close_daily_operation_legacy',
    '10 7 * * *',
    format($cron$
      select net.http_get(
        url := %L,
        headers := jsonb_build_object('Authorization', 'Bearer ' || %L),
        timeout_milliseconds := 25000
      ) as request_id;
    $cron$, close_daily_url, cron_secret)
  );
end $$;

-- Verificacion sin exponer el comando ni sus credenciales:
select jobid, jobname, schedule, active
from cron.job
where jobname in ('rocky_close_shifts_every_15_minutes', 'rocky_close_daily_operation_legacy')
order by jobname;
