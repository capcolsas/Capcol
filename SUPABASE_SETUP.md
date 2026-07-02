# Supabase Setup - Nueva cuenta

## Estado
- El frontend, el backend de WhatsApp, el portal de empleados, la app de supervisores y el lector QR usan Supabase/PostgreSQL.
- La configuracion activa del frontend vive en `src/assets/js/config.js`.
- La configuracion del backend vive en variables de entorno de Vercel y en `whatsapp-backend/src/config.js`.
- Para una base nueva, ejecutar todas las fases SQL disponibles en este repo, en el orden indicado abajo.

## Esquemas SQL
Ejecutar en este orden desde el SQL Editor de Supabase:

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

## Que habilita cada bloque
- `phase0` instala `pgcrypto` para `gen_random_uuid()`.
- `initial` crea perfiles, roles, overrides y RLS base.
- `phase1` crea catalogos: zonas, dependencias, sedes, cargos y novedades.
- `phase2` crea empleados, historial de cargo y supervisores.
- `phase3` crea importaciones, asistencia, ausentismo, metricas y cierres.
- `phase4` crea WhatsApp: incoming, sessions e incapacidades.
- `phase5` agrega indices unicos por fecha/documento.
- `governance phase6` crea `audit_logs` y campos de auditoria en `profiles`.
- `operations 6-8` ajustan `daily_closures` e historial de cargos.
- `phase9` crea `daily_sede_closures`.
- `phase10` crea `employee_daily_status`.
- `phase11` crea RPCs para consolidar `employee_daily_status`.
- `phase12` crea RPCs para recalcular `sede_status` y `daily_metrics`.
- `phase13` agrega a `supabase_realtime` las tablas que la app escucha en vivo.
- `phase14` crea sesiones y auditoria del portal de empleados.
- `phase15` agrega soportes a incapacidades y crea el bucket `incapacidades-soportes`.
- `phase16` habilita registro QR por sede, dispositivos, tokens, salidas y escaneos.
- `phase17 employee certificates` agrega auditoria de certificados laborales.
- `phase17 tablet QR role` agrega el rol dedicado `tablet_qr`.
- `phase18 supervisor RLS` limita lecturas de supervisores a sus zonas y crea funciones de alcance.

## Variables del frontend
Configurar en `src/assets/js/config.js`:

```js
export const SUPABASE_URL = 'https://daxltsptgkfvbupncbkt.supabase.co';
export const SUPABASE_ANON_KEY = 'ANON_OR_PUBLISHABLE_KEY';
export const SUPABASE_PROFILES_TABLE = 'profiles';
export const EMPLOYEE_PORTAL_API_BASE = 'https://capcol-whatsapp-backend.vercel.app';
```

Para migrar a otra cuenta, reemplazar `SUPABASE_URL` y `SUPABASE_ANON_KEY` por los valores del nuevo proyecto.

## Auth: recuperacion de contrasena
El login administrativo usa Supabase Auth. Para que el flujo `Olvide mi contrasena` funcione en proyectos nuevos, configurar las URLs de autenticacion en Supabase antes de probar el envio de correos.

Ruta de la app:
- Solicitar recuperacion: `app.html#/forgot-password`
- Crear nueva contrasena: `app.html#/reset-password`
- Redirect tecnico usado por Supabase: `app.html?reset_password=1`

En Supabase ir a:

`Authentication` -> `URL Configuration`

Configurar `Site URL` con la URL publica del panel administrativo:

```text
https://TU-DOMINIO-PRODUCTIVO/app.html
```

Ejemplos:

```text
https://rocky-demo.vercel.app/app.html
https://tudominio.com/RockyDEMO/app.html
```

Agregar en `Redirect URLs` la URL exacta para recuperacion:

```text
https://TU-DOMINIO-PRODUCTIVO/app.html?reset_password=1
```

Si se trabaja localmente, agregar tambien:

```text
http://localhost:5173/app.html?reset_password=1
```

No dejar `Site URL` apuntando a `http://localhost:3000` en productivo. Si Supabase no encuentra permitido el `redirectTo`, puede caer al `Site URL`; por eso un proyecto mal configurado puede terminar en una URL como:

```text
http://localhost:3000/#error=access_denied&error_code=otp_expired
```

El frontend arma el `redirectTo` de forma dinamica desde la URL actual:

```js
`${window.location.origin}${window.location.pathname}?reset_password=1`
```

Por eso, en produccion el dominio que abre el usuario debe coincidir con una URL permitida en `Redirect URLs`.

Validacion despues de configurar:
1. Abrir la app desplegada en `https://TU-DOMINIO-PRODUCTIVO/app.html#/login`.
2. Hacer clic en `Olvide mi contrasena`.
3. Solicitar un correo nuevo.
4. Abrir el enlace mas reciente recibido.
5. Confirmar que la URL llegue al dominio productivo y contenga `reset_password=1` o abra `app.html#/reset-password`.
6. Guardar la nueva contrasena e iniciar sesion.

Errores comunes:
- `otp_expired`: el enlace expiro, ya fue usado, o se abrio un correo viejo despues de solicitar otro. Solicitar un enlace nuevo.
- Redireccion a `localhost:3000`: corregir `Site URL` y `Redirect URLs` en Supabase; luego solicitar un correo nuevo.
- `Auth session missing`: el enlace no genero sesion de recuperacion. Verificar que el enlace tenga `code=...` o tokens de Supabase y que la URL de redireccion este permitida.

## Variables del backend
Configurar en Vercel para el proyecto `whatsapp-backend/`:
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

## Tablas principales ya usadas
- `profiles`
- `roles_matrix`
- `user_overrides`
- `audit_logs`
- `zones`
- `dependencies`
- `sedes`
- `cargos`
- `novedades`
- `employees`
- `employee_cargo_history`
- `supervisor_profile`
- `attendance`
- `absenteeism`
- `sede_status`
- `import_history`
- `import_replacements`
- `daily_metrics`
- `daily_closures`
- `daily_sede_closures`
- `employee_daily_status`
- `whatsapp_incoming`
- `whatsapp_sessions`
- `incapacitados`
- `employee_portal_sessions`
- `employee_portal_audit`
- `sede_devices`
- `sede_device_sites`
- `attendance_qr_tokens`
- `employee_daily_exits`
- `attendance_qr_scans`
- `employee_certificate_audit`

## Storage
- Bucket requerido: `incapacidades-soportes`.
- Se crea en `supabase/schema_operations_phase15_incapacidades_support.sql`.
- Debe permitir PDF, JPG, PNG y WEBP hasta 10 MB.
- La lectura queda publica para descargar/ver soportes desde la app.

## RPCs requeridas
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

## Realtime
Despues de ejecutar las fases, confirmar que `supabase_realtime` incluya al menos:

- `roles_matrix`
- `user_overrides`
- `zones`
- `dependencies`
- `sedes`
- `cargos`
- `novedades`
- `employees`
- `employee_cargo_history`
- `supervisor_profile`
- `import_history`
- `daily_closures`
- `attendance`
- `import_replacements`
- `daily_metrics`
- `incapacitados`
- `sede_devices`
- `attendance_qr_tokens`
- `employee_daily_exits`
- `employee_daily_status`

## Primer superadmin
1. Crear el primer usuario desde Supabase Auth.
2. Copiar el UUID real del usuario.
3. Editar `supabase/create_first_superadmin.template.sql` con ese UUID, correo y datos base.
4. Ejecutar el script para convertirlo en `superadmin`.
5. Entrar por `app.html#/login` y validar permisos.

## Validacion despues de migrar
- Login administrativo en `app.html`.
- Centro de accesos en `access.html`.
- App de supervisores en `supervisor.html`.
- Portal de empleados en `employee.html`.
- Lectura y escritura de catalogos basicos: zonas, sedes, cargos, novedades y empleados.
- Consulta de registros diarios, reportes, ausentismo e incapacidades.
- Carga y descarga de soportes de incapacidades.
- Registro QR: generar dispositivo, activar sede, crear token y leer QR.
- Webhook WhatsApp: `GET /api/webhooks/whatsapp`.
- Mensaje real de WhatsApp con registro de asistencia/novedad.
- Cron del backend segun `whatsapp-backend/vercel.json`.

## Scripts de soporte
Estos scripts no son fases obligatorias para una base limpia; usarlos solo para diagnostico o recuperacion:

- `supabase/diagnose_whatsapp_missing_attendance.sql`
- `supabase/diagnose_whatsapp_final_actions_without_attendance.sql`
- `supabase/recover_whatsapp_missing_attendance.sql`
- `supabase/backfill_daily_closures_from_daily_metrics.sql`
- `supabase/payroll_attendance_recovery_playbook.sql`
