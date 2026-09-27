-- Apply before deploying the backend that emits retirement certificates.
begin;
alter table public.employee_certificate_audit
  drop constraint if exists employee_certificate_audit_certificate_type_check;
alter table public.employee_certificate_audit
  add constraint employee_certificate_audit_certificate_type_check
  check (certificate_type in ('basic', 'with_salary', 'retired'));
commit;
