-- Apply before deploying the cargo editor and certificates with functions.
begin;
alter table public.cargos add column if not exists funciones text not null default '';
alter table public.cargos drop constraint if exists cargos_funciones_length_check;
alter table public.cargos add constraint cargos_funciones_length_check check (char_length(funciones) <= 12000);
comment on column public.cargos.funciones is 'Funciones del cargo incluidas en los certificados laborales; texto plano, una función por línea.';
alter table public.employee_certificate_audit drop constraint if exists employee_certificate_audit_certificate_type_check;
alter table public.employee_certificate_audit add constraint employee_certificate_audit_certificate_type_check
  check (certificate_type in ('basic', 'with_salary', 'retired', 'with_functions', 'retired_with_functions'));
commit;
