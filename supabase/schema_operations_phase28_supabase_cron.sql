-- Phase 28: Supabase Cron scheduler for shift closures.
-- Replace the two values below before running this script in Supabase SQL Editor.
-- Example backend URL: https://capcol-whatsapp-backend.vercel.app

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  backend_base_url text := 'https://capcol-whatsapp-backend.vercel.app';
  cron_secret text := 'capcol_cron_2026_seguro';
  close_shifts_url text;
  close_daily_url text;
begin
  if backend_base_url = 'https://TU_BACKEND.vercel.app' or cron_secret = 'TU_CRON_SECRET' then
    raise exception 'Reemplaza backend_base_url y cron_secret antes de ejecutar phase28.';
  end if;

  backend_base_url := regexp_replace(trim(backend_base_url), '/+$', '');
  close_shifts_url := backend_base_url || '/api/cron/close-shifts';
  close_daily_url := backend_base_url || '/api/cron/close-daily-operation';

  begin
    perform cron.unschedule('rocky_close_shifts_every_15_minutes');
  exception when others then
    null;
  end;

  begin
    perform cron.unschedule('rocky_close_daily_operation_legacy');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'rocky_close_shifts_every_15_minutes',
    '*/15 * * * *',
    format(
      $cron$
        select net.http_get(
          url := %L,
          headers := jsonb_build_object('Authorization', 'Bearer ' || %L),
          timeout_milliseconds := 25000
        ) as request_id;
      $cron$,
      close_shifts_url,
      cron_secret
    )
  );

  perform cron.schedule(
    'rocky_close_daily_operation_legacy',
    '0 18 * * *',
    format(
      $cron$
        select net.http_get(
          url := %L,
          headers := jsonb_build_object('Authorization', 'Bearer ' || %L),
          timeout_milliseconds := 25000
        ) as request_id;
      $cron$,
      close_daily_url,
      cron_secret
    )
  );
end $$;

-- Verification:
-- select jobid, jobname, schedule, command, active
-- from cron.job
-- where jobname in ('rocky_close_shifts_every_15_minutes', 'rocky_close_daily_operation_legacy')
-- order by jobname;
--
-- Run history:
-- select *
-- from cron.job_run_details
-- where jobid in (
--   select jobid from cron.job
--   where jobname in ('rocky_close_shifts_every_15_minutes', 'rocky_close_daily_operation_legacy')
-- )
-- order by start_time desc
-- limit 20;
--
-- HTTP responses from pg_net:
-- select *
-- from net._http_response
-- order by created desc
-- limit 20;
