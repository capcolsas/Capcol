# Supabase Setup - Nueva cuenta

## Estado
- El frontend, el backend de WhatsApp, el portal de empleados, la app de supervisores y el lector QR usan Supabase/PostgreSQL.
- La configuracion activa del frontend vive en `src/assets/js/config.js`.
- La configuracion del backend vive en variables de entorno de Vercel y en `whatsapp-backend/src/config.js`.
- Para instalar o actualizar cualquier proyecto, nuevo o existente, ejecutar en orden los archivos `01` a `05` de `supabase/releases/`.
- Todos los proyectos deben quedar en la ultima version del esquema.

## Instalacion y actualizacion en 5 archivos
Las 65 fases historicas (`supabase/schema_*.sql`) se agrupan en cinco bundles generados. Ejecutarlos completos, en orden, en el editor SQL de Supabase:

| Orden | Archivo | Incluye |
| --- | --- | --- |
| 01 | `supabase/releases/01_base_operacion.sql` | Base, catalogos, operacion diaria, WhatsApp, gobierno, portal de empleados, QR, RLS de supervisores y supernumerarios (fases 0-26) |
| 02 | `supabase/releases/02_turnos_y_rendimiento.sql` | Turnos, contadores de codigos e indices (fases 27-37) |
| 03 | `supabase/releases/03_multicontrato.sql` | Contratos, accesos por contrato, calculos operativos, configuracion e imagenes (fases 38-49) |
| 04 | `supabase/releases/04_rotaciones_y_modulos.sql` | Rotaciones, asistencia por turno, retiros, cargos, inventarios y visitas (fases 50-59) |
| 05 | `supabase/releases/05_asistencia_movil_y_revision.sql` | Asistencia movil, alertas, revision de turnos y descansos (fases 60 en adelante) |
| 06 | `supabase/releases/06_cron_programador.template.sql` | Opcional y por proyecto: programador de cierres (URL y secreto propios) |

Reglas:
- **Proyecto nuevo:** ejecutar 01 a 05, crear el primer superadmin y, cuando se active el cierre automatico, ejecutar 06.
- **Proyecto existente, en cualquier version:** ejecutar 01 a 05 completos. No hace falta saber en que fase quedo: los bundles son idempotentes, lo ya aplicado no cambia y los respaldos de datos de una sola vez (contrato inicial, cargos por contrato, accesos de supernumerarios, radio QR) se ejecutan una unica vez, sin revivir datos que un administrador elimino.
- **06 nunca forma parte de una actualizacion:** contiene la URL y el secreto del backend de cada proyecto. Reemplazar `TU_BACKEND` y `TU_CRON_SECRET` en el editor y no guardar el secreto real en el repositorio.
- Si un bundle falla a mitad, corregir la causa y volver a ejecutarlo completo; es seguro repetirlo.

## Mantenimiento de los bundles
- Los bundles se generan a partir de las fases fuente y **no se editan a mano**. Las fases fuente (`schema_*.sql`) se conservan como historial y las leen los tests.
- Regenerar despues de cambiar o agregar una fase: `node supabase/build_release_bundles.mjs`. Comprobar que estan al dia: `node supabase/build_release_bundles.mjs --check`.
- Una fase nueva (`schema_operations_phaseNN_*.sql`) debe poder re-ejecutarse: `create ... if not exists`, `create or replace function`, `drop policy/trigger if exists`, y cualquier respaldo de datos protegido para ejecutarse una sola vez. Las fases 60 en adelante entran automaticamente al bundle 05.
- Verificar: `cd tests && node release-bundles.mjs` (usa PGlite). Compara los bundles con aplicar las fases originales una por una, prueba la re-ejecucion, la actualizacion desde cada version intermedia y que no se pisen datos. `RELEASE_QUICK=1` reduce los puntos de partida.
- Las fases 28 y 62 (cron) no van en los bundles; su version vigente es `06_cron_programador.template.sql`.

## Programador de cierres (cron)
El cierre automatico de turnos y del dia lo ejecuta Supabase Cron llamando al backend. El script trae **valores de ejemplo que hay que modificar antes de ejecutarlo**; con los marcadores sin cambiar, falla a proposito con `Reemplaza backend_base_url y cron_secret`.

1. Desplegar el backend y definir `CRON_SECRET` en Vercel (un valor largo y aleatorio, distinto por proyecto).
2. Abrir `supabase/releases/06_cron_programador.template.sql` en el editor SQL de Supabase (no en el repositorio).
3. Reemplazar `https://TU_BACKEND.vercel.app` por el dominio publico del backend y `TU_CRON_SECRET` por el mismo `CRON_SECRET` de Vercel.
4. Ejecutar el script. Programa `/api/cron/close-shifts` cada 15 minutos y `/api/cron/close-daily-operation` a las 02:10 America/Bogota (07:10 UTC).
5. Comprobar con la consulta final del script que ambos jobs figuren activos.

- Volver a ejecutarlo solo cuando cambie la URL o el secreto; reemplaza los jobs existentes.
- Nunca guardar la URL ni el secreto reales en el repositorio ni volver a editarlos en `schema_operations_phase28_supabase_cron.sql`, que tambien queda con marcadores.
- Si un secreto llego a subirse a un repositorio, rotar `CRON_SECRET` en Vercel y volver a ejecutar el script con el valor nuevo.

## Historial: que habilita cada fase
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
- `phase19 supernumerario occupancy` evita doble ocupacion de supernumerarios en reemplazos del dia.
- `phase20 supernumerario incapacities` lista incapacidades activas de supernumerarios.
- `phase21 admin permission RLS` permite que supervisores habilitados usen escrituras administrativas de empleados segun sus permisos.
- `phase22 supernumerarios by date` hace que la app liste supernumerarios segun el cargo vigente en la fecha operativa y trate el retiro del dia como vigente hasta terminar la jornada.
- `phase22 report indexes` agrega indices para acelerar reportes operativos e incapacidades.
- `phase23 profile role protection` protege rol, estado y campos administrativos del perfil contra cambios de autoservicio.
- `phase24 Colombia holiday July 9` actualiza la funcion de festivos con el 9 de julio.
- `phase25 employee extended info` agrega datos ampliados del empleado: fecha de nacimiento, seguridad social y dotacion.
- `phase26 sede catalog reference sync` asegura que los cambios de sede sincronicen referencias de catalogo.
- `phase27 shifts` agrega turnos, programacion, asignaciones y cierres por turno.
- `phase28 supabase cron` instala tareas programadas para cierres operativos.
- `phase32 code counters` agrega contadores transaccionales para generar codigos consecutivos.
- `phase33 performance indexes` agrega indices de rendimiento generales.
- `phase34 search optimization` optimiza consultas de busqueda administrativa.
- `phase36 employee novelties indexes` agrega indices para novedades de empleados.
- `phase37 employees admin indexes` agrega indices para consultas administrativas de empleados.
- `phase38 contracts` crea contratos con datos del cliente y agrega la referencia contractual a dependencias, zonas, sedes, empleados e historial.
- `phase39 contract reporting scope` agrega contrato a `employee_daily_status`, `daily_sede_closures`, `sede_status`, `attendance`, `absenteeism` e `import_replacements`, y materializa `daily_contract_metrics`.
- `phase40 contract access RLS` crea accesos de usuario por contrato y limita al rol administrador de contrato a sus contratos asignados.
- `phase41 contract operational calculations` alinea el flujo `employee_daily_status -> sede_status -> daily_contract_metrics -> daily_metrics -> daily_sede_closures -> daily_closures` y valida que las sumas por contrato cuadren con las metricas globales.
- `phase42 contract profile permissions` agrega `contrato_codigo` y `contratos_permitidos` a `profiles`, sincroniza esos campos con `profile_contract_access` y refuerza RLS para que usuarios internos vean todo y administradores de contrato solo sus contratos.
- `phase43 backend contract context` agrega contrato/cliente a tokens, escaneos y salidas QR, incapacidades y auditoria de certificados; tambien refuerza RLS de esas tablas por contrato.

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

`EMPLOYEE_PORTAL_ALLOWED_ORIGINS` debe listar dominios publicos del frontend separados por coma. Para desarrollo local, el backend permite por codigo origenes `localhost` y `127.0.0.1`.

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
- `daily_contract_metrics`
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
- `contracts`
- `profile_contract_access`

## Storage
- Bucket requerido: `incapacidades-soportes`.
- Se crea en `supabase/releases/01_base_operacion.sql` (fase 15).
- Debe permitir PDF, JPG, PNG y WEBP hasta 10 MB.
- La lectura queda publica para descargar/ver soportes desde la app.

## RPCs requeridas
- `refresh_employee_daily_status`
- `refresh_employee_daily_status_range`
- `recompute_sede_status_from_employee_daily_status`
- `recompute_daily_metrics_from_employee_daily_status`
- `recompute_daily_contract_metrics_from_employee_daily_status`
- `recompute_daily_sede_closures_from_sede_status`
- `validate_daily_contract_metric_consistency`
- `refresh_operational_snapshots_from_employee_daily_status`
- `current_profile_is_active_non_supervisor`
- `current_profile_is_internal_user`
- `current_supervisor_can_read_zone`
- `can_read_zone_data`
- `can_read_sede_data`
- `can_read_employee_data`
- `can_read_operational_sede_or_employee`
- `current_profile_can_manage_contract_access`
- `current_profile_contract_codes`
- `current_profile_has_contract_access`
- `can_read_contract_data`
- `can_read_dependency_data`
- `current_supervisor_can_write_operational_replacement`
- `can_view_qr_registry`
- `list_supernumerarios_for_current_supervisor`
- `list_supernumerario_replacement_occupancy`
- `list_supernumerario_incapacities_for_current_supervisor`
- `is_colombia_holiday_sql`

## Realtime
Despues de ejecutar las fases, confirmar que `supabase_realtime` incluya al menos:

- `roles_matrix`
- `user_overrides`
- `contracts`
- `profile_contract_access`
- `daily_contract_metrics`
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
- Certificados laborales: generar PDF desde portal de empleados/admin y verificar el codigo publico.
- Supernumerarios: validar ocupacion por fecha, incapacidades activas y listado por cargo vigente.
- Webhook WhatsApp: `GET /api/webhooks/whatsapp`.
- Mensaje real de WhatsApp con registro de asistencia/novedad.
- Cron del backend en Supabase:
  - abrir `supabase/releases/06_cron_programador.template.sql` en el editor SQL, **modificar los dos valores** y ejecutarlo (ver "Programador de cierres (cron)").
  - reemplazar `backend_base_url` por el dominio publico del backend.
  - reemplazar `cron_secret` por el mismo `CRON_SECRET` configurado en Vercel.

## Scripts de soporte
Estos scripts no son fases obligatorias para una base limpia; usarlos solo para diagnostico o recuperacion:

Scripts SQL:
- `supabase/diagnose_whatsapp_missing_attendance.sql`
- `supabase/diagnose_whatsapp_final_actions_without_attendance.sql`
- `supabase/recover_whatsapp_missing_attendance.sql`
- `supabase/backfill_daily_closures_from_daily_metrics.sql`
- `supabase/payroll_attendance_recovery_playbook.sql`

Scripts Node del backend que usan `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` desde `whatsapp-backend/.env`:
- `whatsapp-backend/scripts/backup-supabase.mjs`
- `whatsapp-backend/scripts/normalize-closed-absenteeism.mjs`
- `whatsapp-backend/scripts/rebuild-daily-closures-summary.mjs`
- `whatsapp-backend/scripts/rebuild-daily-sede-closures.mjs`
- `whatsapp-backend/scripts/rebuild-employee-daily-status.mjs`
- `whatsapp-backend/scripts/refresh-employee-status-2026-04-06-to-2026-05-03.mjs`
- `whatsapp-backend/scripts/repair-missing-employee-cargo-history-transfers.mjs`
- `whatsapp-backend/scripts/repair-overlapping-employee-cargo-history.mjs`
- `whatsapp-backend/scripts/run-payroll-recovery-diagnostics.mjs`

## Imagenes de Referencia de Contratos

Las imagenes de referencia de contratos (fase 49) vienen incluidas en
`supabase/releases/03_multicontrato.sql`; no hay un archivo aparte. Agrega `reference_image_path` y el bucket
privado `contract-reference-images`, con lectura segun acceso al contrato y
escritura administrativa. No requiere configurar un bucket publico.

En Contratos, la accion **Imagen de referencia** permite cargar, reemplazar o
quitar un PNG, JPG o WebP de hasta 2 MB. Se guarda una miniatura WebP de hasta
256 px y la barra lateral la muestra mediante una URL firmada temporal.
Los contratos existentes conservan sus iniciales hasta que se les asigne imagen.

## Fase 54: ingreso y salida por turno

Incluida en `supabase/releases/04_rotaciones_y_modulos.sql`: ejecutar los bundles antes de publicar el nuevo backend. Cambia el radio general a 200 m, guarda evidencia de ubicacion independiente del QR y confirma las marcaciones y los cierres de forma transaccional. Ver `docs/shift-attendance.md` para la secuencia y las verificaciones.

## Retiros de empleados (fase 55)

Incluida en `supabase/releases/04_rotaciones_y_modulos.sql`; ejecutar los bundles antes de publicar el frontend actualizado. Agrega motivo y observación del retiro, conserva cada ciclo en `employee_retirements` y limpia los campos actuales al reingresar. Ver `docs/employee-retirements.md` para comportamiento, compatibilidad y pruebas.

## Visitas de supervisores (fase 59)

Incluida en `supabase/releases/04_rotaciones_y_modulos.sql`; ejecutar los bundles antes de publicar el frontend actualizado. Crea ciclos por contrato, asignaciones por zona, registro GPS, revisión y el bucket privado `visit-evidence`. Programar desde Turnos → Visitas y registrar desde Supervisor → Sedes → Registro de visitas. Ver `docs/site-visits.md` para activación, reglas y pruebas.
