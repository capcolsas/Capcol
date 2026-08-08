# Backend WhatsApp - Estado actual y migracion

## Estado
- El webhook ya opera fuera de Firebase.
- El backend activo esta en `whatsapp-backend/`.
- El despliegue actual/objetivo es Vercel con runtime Node 20+.
- El mismo backend atiende WhatsApp, portal de empleados, certificados laborales, registro QR y cron operativo.
- Para migrar a una cuenta nueva se debe crear/enlazar un proyecto Vercel apuntando a `whatsapp-backend/` y volver a configurar secretos, dominio publico, webhook de Meta y variables del frontend.

## Backend actual
Archivos principales:
- `whatsapp-backend/src/app.js:1`
- `whatsapp-backend/src/employee-portal.js:1`
- `whatsapp-backend/src/certificates/certificate-service.js:1`
- `whatsapp-backend/src/certificates/config.js:1`
- `whatsapp-backend/src/config.js:1`
- `whatsapp-backend/src/supabase.js:1`
- `whatsapp-backend/api/index.js:1`
- `whatsapp-backend/src/server.js:1`
- `whatsapp-backend/vercel.json:1`
- `whatsapp-backend/package.json:1`

Dependencias relevantes:
- `express`
- `@supabase/supabase-js`
- `dotenv`
- `qrcode`
- `pdfkit`

## Variables requeridas
Definir en Vercel para el proyecto backend:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_VERSION`
- `WHATSAPP_APP_SECRET`
- `CRON_SECRET`
- `EMPLOYEE_PORTAL_ALLOWED_ORIGINS`
- `EMPLOYEE_PORTAL_SESSION_HOURS`
- `WHATSAPP_BACKEND_PUBLIC_URL` o `PUBLIC_BACKEND_URL`
- `ATTENDANCE_QR_TOKEN_MINUTES`

Tambien actualizar localmente `whatsapp-backend/.env` con esos mismos valores cuando se pruebe en desarrollo.

Notas:
- `WHATSAPP_VERIFY_TOKEN` es obligatorio para validar el webhook de Meta.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son obligatorios para iniciar el backend.
- `WHATSAPP_BACKEND_PUBLIC_URL` o `PUBLIC_BACKEND_URL` debe apuntar al dominio publico del backend sin slash final. Se usa para imagenes QR y verificacion de certificados.
- `EMPLOYEE_PORTAL_ALLOWED_ORIGINS` debe incluir los origenes publicos permitidos del frontend, separados por coma. Los origenes locales `localhost` y `127.0.0.1` se permiten por codigo para pruebas con Live Server/dev server.
- `EMPLOYEE_PORTAL_SESSION_HOURS` por defecto es `12`.
- `ATTENDANCE_QR_TOKEN_MINUTES` por defecto es `10`.
- `WHATSAPP_GRAPH_VERSION` por defecto es `v25.0`.
- Si `WHATSAPP_APP_SECRET` esta vacio, el backend no valida `x-hub-signature-256`. En produccion debe configurarse.

## Vercel
El proyecto `whatsapp-backend/` usa:
- `api/index.js` como entrada serverless.
- `includeFiles: "src/certificates/**"` para incluir assets privados de certificados.
- `memory: 1024`.
- `maxDuration: 300`.
- Cron diario:
  - path: `/api/cron/close-daily-operation`
  - schedule: `10 5 * * *`
- Rewrite global hacia `/api/index`.

Despues de migrar:
1. Crear proyecto Vercel nuevo desde la carpeta `whatsapp-backend/`.
2. Configurar todas las variables de entorno.
3. Confirmar que el cron quede activo en la cuenta nueva.
4. Actualizar el dominio del backend en `src/assets/js/config.js`:
   - `EMPLOYEE_PORTAL_API_BASE`
5. Actualizar `WHATSAPP_BACKEND_PUBLIC_URL` o `PUBLIC_BACKEND_URL` con el dominio final.
6. Configurar el webhook en Meta con la URL publica del backend.

## Rutas expuestas
Salud:
- `GET /health`

WhatsApp Cloud API:
- `GET /webhooks/whatsapp`
- `POST /webhooks/whatsapp`

Cron:
- `GET /cron/close-daily-operation`
- `GET /api/cron/close-daily-operation`

Portal de empleados:
- `POST /employee-login`
- `POST /api/employee-login`
- `GET /employee-me`
- `GET /api/employee-me`
- `GET /employee-incapacities`
- `GET /api/employee-incapacities`
- `POST /employee-incapacities`
- `POST /api/employee-incapacities`
- `POST /employee-incapacities/:id/support`
- `POST /api/employee-incapacities/:id/support`
- `POST /employee-logout`
- `POST /api/employee-logout`

Registro QR:
- `POST /attendance-qr/devices`
- `POST /api/attendance-qr/devices`
- `PATCH /attendance-qr/devices/:deviceId/status`
- `PATCH /api/attendance-qr/devices/:deviceId/status`
- `GET /attendance-qr/daily`
- `GET /api/attendance-qr/daily`
- `GET /attendance-qr/image/:token`
- `GET /api/attendance-qr/image/:token`
- `POST /attendance-qr/scan`
- `POST /api/attendance-qr/scan`

Certificados laborales:
- `POST /employee-certificates`
- `POST /api/employee-certificates`
- `POST /certificates/employees/:employeeId`
- `POST /api/certificates/employees/:employeeId`
- `GET /certificates/verify/:code`
- `GET /api/certificates/verify/:code`

## Base de datos requerida
Para una base nueva, ejecutar las fases SQL disponibles en este orden:

1. `supabase/schema_foundation_phase0.sql`
2. `supabase/schema_initial.sql`
3. `supabase/schema_catalogs_phase1.sql`
4. `supabase/schema_operations_phase2.sql`
5. `supabase/schema_operations_phase3.sql`
6. `supabase/schema_whatsapp_phase4.sql`
7. `supabase/schema_constraints_phase5.sql`
8. `supabase/schema_governance_phase6.sql`
9. `supabase/schema_operations_phase6.sql`
10. `supabase/schema_operations_phase7.sql`
11. `supabase/schema_operations_phase8.sql`
12. `supabase/schema_operations_phase9.sql`
13. `supabase/schema_operations_phase10.sql`
14. `supabase/schema_operations_phase11.sql`
15. `supabase/schema_operations_phase12.sql`
16. `supabase/schema_operations_phase13.sql`
17. `supabase/schema_operations_phase14_employee_portal.sql`
18. `supabase/schema_operations_phase15_incapacidades_support.sql`
19. `supabase/schema_operations_phase16_qr_attendance.sql`
20. `supabase/schema_operations_phase17_employee_certificates.sql`
21. `supabase/schema_operations_phase17_tablet_qr_role.sql`
22. `supabase/schema_operations_phase18_supervisor_rls.sql`
23. `supabase/schema_operations_phase19_supernumerario_occupancy.sql`
24. `supabase/schema_operations_phase20_supernumerario_incapacities.sql`
25. `supabase/schema_operations_phase21_admin_permission_rls.sql`
26. `supabase/schema_operations_phase22_supernumerarios_by_date.sql`
27. `supabase/schema_operations_phase22_report_performance_indexes.sql`
28. `supabase/schema_operations_phase23_profile_role_protection.sql`
29. `supabase/schema_operations_phase24_colombia_holiday_july9.sql`
30. `supabase/schema_operations_phase25_employee_extended_info.sql`

## Que habilitan las fases nuevas
- `phase14` crea sesiones y auditoria del portal de empleados.
- `phase15` agrega soportes a incapacidades y el bucket `incapacidades-soportes`.
- `phase16` habilita sedes con QR, tablets/dispositivos, tokens, salidas y auditoria de escaneos.
- `phase17 employee certificates` crea auditoria de certificados laborales y codigos de verificacion.
- `phase17 tablet QR role` agrega el rol dedicado `tablet_qr`.
- `phase18` agrega RLS para supervisores por zona.
- `phase19` evita doble ocupacion de supernumerarios en reemplazos del dia.
- `phase20` lista incapacidades activas de supernumerarios.
- `phase21` permite escrituras administrativas controladas para supervisores con permisos.
- `phase22 supernumerarios by date` lista supernumerarios segun cargo vigente en la fecha operativa.
- `phase22 report indexes` agrega indices para reportes.
- `phase23` protege rol, estado y campos administrativos del perfil contra cambios de autoservicio.
- `phase24` actualiza festivos de Colombia agregando el 9 de julio.
- `phase25` agrega datos ampliados del empleado: fecha de nacimiento, seguridad social y dotacion.

## Storage requerido
- Bucket: `incapacidades-soportes`.
- Lo crea `supabase/schema_operations_phase15_incapacidades_support.sql`.
- Debe aceptar PDF, JPG, PNG y WEBP hasta 10 MB.
- La lectura se usa desde la app para consultar y descargar soportes.

## Flujos operativos
WhatsApp:
- Verificacion de webhook de Meta.
- Validacion opcional de firma `x-hub-signature-256` con `WHATSAPP_APP_SECRET`.
- Recepcion de mensajes y estados.
- Escritura/upsert en `whatsapp_incoming`.
- Manejo de estado conversacional en `whatsapp_sessions`.
- Saludo inicial con `hola`.
- Identificacion por documento.
- Confirmacion de identidad.
- Menu por rol/empleado.
- Registro de `TRABAJANDO`, `COMPENSATORIO` y `NOVEDAD`.
- Novedades con fechas:
  - Accidente Laboral.
  - Enfermedad General.
  - Calamidad.
  - Licencia No Remunerada.
  - Licencia Remunerada.
  - Vacaciones.
- Registro de incapacidades en `incapacitados`.
- Mensaje de soporte requerido para incapacidades que lo exigen.
- Actualizacion de datos:
  - cambio de telefono.
  - traslado de sede.

QR desde WhatsApp:
- Si la sede tiene `qr_enabled = true`, el flujo `Soy yo -> Trabajando` pide `Ingreso` o `Salida`.
- El empleado debe compartir ubicacion actual desde WhatsApp.
- El backend valida coordenadas contra `qr_latitude`, `qr_longitude` y `qr_radius_meters`.
- El radio por defecto es 500 metros si la sede no define otro valor.
- Si la ubicacion es valida, genera un QR temporal.
- El QR vence segun `ATTENDANCE_QR_TOKEN_MINUTES`.
- El ingreso se registra en `attendance`.
- La salida se registra en `employee_daily_exits`.
- Cada lectura queda auditada en `attendance_qr_scans`.
- La tablet debe enviar `X-QR-Device-Token` o `deviceToken`.

Portal de empleados:
- Valida `documento + ultimos 4 digitos del celular` contra `employees`.
- No usa Supabase Auth para empleados.
- Usa `employee_portal_sessions` con token hash y expiracion.
- Registra auditoria en `employee_portal_audit`.
- Permite consultar incapacidades propias.
- Permite crear incapacidades con soporte.
- Permite cargar o reemplazar soporte de una incapacidad.
- Redirige perfiles administrativos al portal principal cuando corresponde.

Certificados laborales:
- Genera PDF en memoria con PDFKit.
- Permite certificado laboral basico y con salario.
- El certificado puede generarse desde portal de empleados o desde admin.
- Cada emision crea registro en `employee_certificate_audit`.
- Cada PDF incluye un codigo/QR de verificacion.
- La verificacion publica consulta `/api/certificates/verify/:code`.
- Los assets privados viven en `whatsapp-backend/src/certificates/assets/`.

Cron operativo:
- Cierra automaticamente el dia anterior.
- Recalcula snapshots operativos, metricas y cierres.
- Usa `CRON_SECRET` para autorizar la ejecucion.

## Tablas usadas por el backend
- `profiles`
- `employees`
- `employee_cargo_history`
- `cargos`
- `sedes`
- `sede_status`
- `sede_devices`
- `sede_device_sites`
- `attendance`
- `attendance_qr_tokens`
- `attendance_qr_scans`
- `employee_daily_exits`
- `absenteeism`
- `incapacitados`
- `import_replacements`
- `daily_metrics`
- `daily_closures`
- `daily_sede_closures`
- `employee_daily_status`
- `audit_logs`
- `supervisor_profile`
- `whatsapp_incoming`
- `whatsapp_sessions`
- `employee_portal_sessions`
- `employee_portal_audit`
- `employee_certificate_audit`
- `novedades`

## RPCs y funciones importantes
La app y los scripts dependen de RPCs/funciones creadas por las fases SQL:
- `refresh_employee_daily_status`
- `refresh_employee_daily_status_range`
- `recompute_sede_status_from_employee_daily_status`
- `recompute_daily_metrics_from_employee_daily_status`
- `refresh_operational_snapshots_from_employee_daily_status`
- `current_profile_is_active_non_supervisor`
- `current_supervisor_can_read_zone`
- `can_read_zone_data`
- `can_read_sede_data`
- `can_read_employee_data`
- `can_read_operational_sede_or_employee`
- `current_supervisor_can_write_operational_replacement`
- `can_view_qr_registry`
- `list_supernumerarios_for_current_supervisor`
- `list_supernumerario_replacement_occupancy`
- `list_supernumerario_incapacities_for_current_supervisor`
- `is_colombia_holiday_sql`

## Scripts de soporte
Scripts en `whatsapp-backend/scripts/`:
- `backup-supabase.mjs`
- `normalize-closed-absenteeism.mjs`
- `rebuild-daily-closures-summary.mjs`
- `rebuild-daily-sede-closures.mjs`
- `rebuild-employee-daily-status.mjs`
- `refresh-employee-status-2026-04-06-to-2026-05-03.mjs`
- `repair-missing-employee-cargo-history-transfers.mjs`
- `repair-overlapping-employee-cargo-history.mjs`
- `run-payroll-recovery-diagnostics.mjs`

Scripts SQL de diagnostico/recuperacion:
- `supabase/diagnose_whatsapp_missing_attendance.sql`
- `supabase/diagnose_whatsapp_final_actions_without_attendance.sql`
- `supabase/recover_whatsapp_missing_attendance.sql`
- `supabase/backfill_daily_closures_from_daily_metrics.sql`
- `supabase/payroll_attendance_recovery_playbook.sql`

## Checklist de migracion
1. Crear proyecto Supabase nuevo.
2. Ejecutar todas las fases SQL en el orden indicado.
3. Crear/configurar el primer superadmin con `supabase/create_first_superadmin.template.sql`.
4. Confirmar bucket `incapacidades-soportes`.
5. Crear proyecto Vercel para `whatsapp-backend/`.
6. Configurar variables del backend en Vercel.
7. Configurar `whatsapp-backend/.env` para pruebas locales.
8. Configurar `EMPLOYEE_PORTAL_API_BASE` en `src/assets/js/config.js`.
9. Configurar `WHATSAPP_BACKEND_PUBLIC_URL` o `PUBLIC_BACKEND_URL`.
10. Configurar webhook de Meta y token de verificacion.
11. Confirmar que el cron de Vercel este activo.
12. Configurar origenes permitidos en `EMPLOYEE_PORTAL_ALLOWED_ORIGINS`.
13. Validar certificados y assets privados en `whatsapp-backend/src/certificates/`.
14. Probar un mensaje real de WhatsApp.
15. Probar portal de empleados.
16. Probar carga de soporte de incapacidad.
17. Probar generacion y verificacion de certificado.
18. Probar creacion de tablet QR, generacion de QR y lectura desde `qr.html` o `app.html#/lector-qr`.
19. Probar cierre diario manual llamando el cron con autorizacion.
20. Revisar logs de Vercel y `whatsapp_incoming` despues de las pruebas.

## Validacion minima despues de desplegar
- `GET /health` responde `{ ok: true }`.
- `GET /webhooks/whatsapp` valida el challenge de Meta.
- `POST /webhooks/whatsapp` guarda eventos en `whatsapp_incoming`.
- Un mensaje `Hola` inicia sesion en `whatsapp_sessions`.
- Un empleado activo puede identificarse por documento.
- Registro `Trabajando` crea o actualiza `attendance`.
- Novedad con fechas crea `attendance`, `absenteeism` y, si aplica, `incapacitados`.
- Sede QR activa genera QR solo dentro del radio permitido.
- Tablet QR activa registra ingreso/salida.
- Portal de empleados inicia sesion y muestra incapacidades.
- Portal de empleados sube soporte al bucket `incapacidades-soportes`.
- Certificado laboral descarga PDF y su codigo verifica correctamente.
- Cron actualiza `daily_closures`, `daily_sede_closures`, `daily_metrics` y `employee_daily_status`.
