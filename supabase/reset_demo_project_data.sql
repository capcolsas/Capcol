-- Reset demo project data while preserving access configuration.
-- Run this only in the Supabase project you want to clean.
--
-- Preserved:
-- - public.profiles
-- - public.roles_matrix
-- - public.user_overrides
-- - auth.users and Supabase Storage files
--
-- Paused:
-- - Supabase Cron jobs for automatic closures. Re-run phase 28 when you are
--   ready to activate automatic closures again.
--
-- Deleted:
-- - all other public tables, including catalogs, employees, shifts,
--   WhatsApp sessions/events, attendance, closures, audits, QR data, reports.

begin;

do $$
begin
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
end $$;

do $$
declare
  table_list text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ' order by tablename)
    into table_list
  from pg_tables
  where schemaname = 'public'
    and tablename not in (
      'profiles',
      'roles_matrix',
      'user_overrides'
    );

  if table_list is not null then
    execute 'truncate table ' || table_list || ' restart identity cascade';
  end if;
end $$;

commit;

-- Verify remaining rows by table.
select
  schemaname,
  relname as table_name,
  n_live_tup as estimated_rows
from pg_stat_user_tables
where schemaname = 'public'
order by relname;

-- Verify Supabase Cron jobs are paused/removed. This should return no rows
-- until phase 28 is executed again.
select jobid, jobname, schedule, active
from cron.job
where jobname in (
  'rocky_close_shifts_every_15_minutes',
  'rocky_close_daily_operation_legacy'
)
order by jobname;

-- Optional full public wipe, not recommended unless you already know how to recreate access:
-- truncate table public.profiles, public.roles_matrix, public.user_overrides restart identity cascade;
--
-- If you also want a completely empty Authentication module, delete users from
-- Supabase Dashboard > Authentication > Users. Do not do that unless you are ready
-- to create the first superadmin again with supabase/create_first_superadmin.template.sql.
