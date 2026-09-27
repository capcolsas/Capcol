# Rocky

## Inventarios y entregas

Nuevo módulo por contrato en `app.html#/inventory`: productos, ingresos, existencias, entregas, recepciones parciales con firma, devoluciones, actas PDF y exportación CSV. Para activarlo, ejecutar los bundles de `supabase/releases/` (`01` a `05`; el inventario va en el `04`). Guía de uso y alcance en [docs/inventarios.md](docs/inventarios.md).

Plataforma de gestion operativa y administrativa para el seguimiento de servicios, personal y novedades.

## Estado actual
- Frontend desplegado en Vercel.
- Autenticacion y datos operando con Supabase/PostgreSQL.
- Backend de WhatsApp desplegado en Vercel.
- Portal de empleados, app de supervisores, lector QR, certificados laborales y cron operativo conectados al mismo backend/Supabase.

## Flujo de acceso
- Pagina principal informativa: `index.html`
- Centro de accesos: `access.html`
- Ingreso administrativo: `app.html#/login`
- App de supervisores: `supervisor.html`
- Portal para empleados: `employee.html`
- Tablet/lector QR dedicado: `qr.html`

## Modulos principales
- Login
- Centro de permisos
- Gestion administrativa
- Contratos y clientes
- Gestion empleados
- Operacion
- Registro QR
- Certificados laborales
- Supernumerarios
- Consultas y reportes

## Supabase
- Configuracion activa del frontend en `src/assets/js/config.js`
- Cliente principal de datos en `src/assets/js/supabase.js`
- Scripts SQL de migracion en `supabase/`
- Para una base nueva o una base ya funcional, ejecutar en orden `supabase/releases/01_base_operacion.sql` a `05_asistencia_movil_y_revision.sql` (ver `SUPABASE_SETUP.md`); son idempotentes y sirven para proyectos nuevos y existentes.
- Bucket requerido para soportes de incapacidades: `incapacidades-soportes`.
- Recuperacion de contrasena: configurar `Site URL` y `Redirect URLs` segun `SUPABASE_SETUP.md`.

## Backend WhatsApp
- Backend actual en `whatsapp-backend/`
- Guia de migracion y despliegue en `WHATSAPP_BACKEND_MIGRATION.md`
- Configurar nuevos secretos en `whatsapp-backend/.env` y en Vercel.
- Atiende webhook de WhatsApp, portal de empleados, certificados laborales, registro QR y cron de cierre diario.
- Los registros creados por WhatsApp/QR guardan contexto de contrato y cliente para cierres, dashboards y reportes por contrato.
- Variables principales:
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
- Cron demo en Supabase:
  - abrir `supabase/releases/06_cron_programador.template.sql` en el editor SQL, **modificar** `TU_BACKEND` (URL del backend) y `TU_CRON_SECRET` (el mismo `CRON_SECRET` de Vercel) y ejecutarlo. Ver `SUPABASE_SETUP.md`.
  - `/api/cron/close-shifts` cada 15 minutos.
  - `/api/cron/close-daily-operation` diario a las 07:10 UTC (02:10 America/Bogota) como consolidacion legacy del dia anterior, en una franja de baja actividad de marcaciones. Los turnos nocturnos mantienen su cierre independiente al terminar su ventana de salida; el resumen diario es un corte a las 02:10, no una confirmacion de esas salidas.
  - Para actualizar un programador existente, volver a ejecutar `supabase/releases/06_cron_programador.template.sql` con los mismos valores.
  - Cada ejecucion diaria revisa primero el dia anterior al que corresponde cerrar (anteayer), y luego ayer. Los dias ya cerrados se omiten sin recalcular; si uno falla, se intenta el otro y el endpoint devuelve HTTP 500 con el resultado de ambos. La recuperacion se limita a esas dos fechas.

## Ingreso y salida por turno
- Marcación en distintas sedes por cargo: aplicar la fase 60 y consultar [la guía de activación](docs/mobile-attendance.md). Conserva el turno administrativo y registra por separado las sedes físicas de ingreso y salida.
- Migracion requerida: bundle `supabase/releases/04_rotaciones_y_modulos.sql` (fase 54), despues de los bundles 01 a 03.
- Cada sede puede activar o desactivar `qr_enabled`.
- Si una sede tiene QR activo, el flujo WhatsApp `Soy yo -> Ingreso / Salida` solicita `Ingreso` o `Salida`, pide ubicacion actual y envia un QR temporal solo si el operario esta dentro del radio permitido.
- El radio de marcacion por sede queda en `qr_radius_meters`; por defecto son 200 metros desde la fase 54. Ingreso y salida requieren ubicacion; solo las sedes con QR activo generan un codigo para escanear.
- El ingreso registra en `attendance`; la salida registra en `employee_daily_exits`.
- La tablet usa `app.html#/lector-qr` y debe activarse con un token de dispositivo generado desde `Sedes`.
- Para tablets dedicadas usa `qr.html` con un usuario de rol `tablet_qr`; solo habilita el lector QR.
- El seguimiento diario de ambas modalidades se consulta en `app.html#/registro-qr`, incluyendo hora de ingreso, hora de salida y alerta por celular diferente.
- El historico de asistencia de dias cerrados se consulta en `app.html#/reports-qr-history` y permite exportar registros y pendientes.
- Variables opcionales del backend:
  - `WHATSAPP_BACKEND_PUBLIC_URL` o `PUBLIC_BACKEND_URL`
  - `ATTENDANCE_QR_TOKEN_MINUTES`

## Certificados laborales
- Se generan desde el portal de empleados y desde el panel administrativo.
- El backend genera PDFs en memoria con PDFKit.
- Cada certificado queda auditado en `employee_certificate_audit`.
- Cada PDF incluye codigo/QR de verificacion publica en `/api/certificates/verify/:code`.
- Assets privados y configuracion en `whatsapp-backend/src/certificates/`.
- Migracion requerida: bundle `supabase/releases/01_base_operacion.sql` (fase 17).

## Supernumerarios
- Modulo administrativo en `app.html#/supernumerarios`.
- La disponibilidad se calcula segun cargo vigente por fecha operativa.
- Las fases 19, 20 y 22 agregan ocupacion diaria, incapacidades activas y listado por fecha.
- Los indices de la fase 22 (`supabase/releases/01_base_operacion.sql`) ayudan a reportes e incapacidades.

## Rutas de la app
- `#/login`
- `#/forgot-password`
- `#/reset-password`
- `#/`
- `#/about`
- `#/notes`
- `#/contact`
- `#/data-treatment`
- `#/gobierno-dashboard`
- `#/permissions`
- `#/permissions-audit`
- `#/users`
- `#/contracts`
- `#/zones`
- `#/dependencies`
- `#/sedes`
- `#/bulk-upload-sedes`
- `#/empleados-dashboard`
- `#/employees`
- `#/employee-novelties`
- `#/supernumerarios`
- `#/bulk-upload`
- `#/cargos`
- `#/novedades`
- `#/supervisors`
- `#/operacion-dashboard`
- `#/registros-vivo`
- `#/registro-sede`
- `#/lector-qr`
- `#/tablets-qr`
- `#/registro-qr`
- `#/imports-replacements`
- `#/import-history`
- `#/absenteeism`
- `#/reportes-dashboard`
- `#/reports`
- `#/reports-daily-history`
- `#/reports-qr-history`
- `#/reports-employees`
- `#/reports-hiring`
- `#/contract-dashboard`
- `#/reports-contracts`
- `#/reports-novelties-consolidated`
- `#/reports-services-consolidated`
- `#/reports-consolidated`
- `#/cargue-masivo-dashboard`
- `#/upload`

## App de supervisores
- Acceso dedicado: `supervisor.html`.
- Usa el mismo login de Supabase/Auth que el portal administrativo.
- Requiere perfil con `role = supervisor` y `supervisor_eligible = true`.
- Filtra el registro diario por `zonas_permitidas` o `zona_codigo` del perfil.
- Al asignar `role = supervisor`, el perfil de acceso sincroniza automaticamente `supervisor_eligible`, `zona_codigo` y `zonas_permitidas` desde el supervisor operativo asociado por documento.
- Si cambia la zona en el modulo Supervisores, tambien se actualiza el perfil de acceso del usuario supervisor asociado.
- Para usuarios que ya tenian rol supervisor antes de esta mejora, usa la accion `Sincronizar acceso supervisor` en Usuarios.
- Primera version mobile-first con resumen del dia, registros, novedades y perfil.
- Migracion RLS incluida en `supabase/releases/01_base_operacion.sql` (fase 18).
  Esta migracion limita lecturas de supervisores a sus zonas en sedes, empleados, registro diario, QR, ausentismo, reemplazos e incapacidades.

## Portal de empleados
- Acceso dedicado: `employee.html`
- No usa registro en `Auth`.
- Valida `documento + ultimos 4 del celular` contra `employees`.
- Si el empleado tiene un perfil activo administrativo (`superadmin`, `admin`, `editor`, `consultor` o `tablet_qr`), se redirige al portal principal. Los supervisores tambien pueden entrar al portal de empleados para gestionar sus incapacidades y certificados.
- El backend de este portal vive en `whatsapp-backend/src/app.js`.
- Permite gestionar incapacidades propias, cargar soportes y generar certificados laborales.
- Requiere variables backend en `whatsapp-backend`:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `EMPLOYEE_PORTAL_ALLOWED_ORIGINS`
  - `EMPLOYEE_PORTAL_SESSION_HOURS`
- Para certificados y QR tambien requiere `WHATSAPP_BACKEND_PUBLIC_URL` o `PUBLIC_BACKEND_URL`.
- El frontend usa `EMPLOYEE_PORTAL_API_BASE` en `src/assets/js/config.js` para apuntar al backend cuando esta en otro dominio.
- Requiere el bundle `supabase/releases/01_base_operacion.sql` (fases 14, 15 y 17).

## Ejecucion local
1. Abrir `index.html` con Live Server.
2. Entrar al centro de accesos desde `access.html`.
3. Elegir `Administrativo`, `Empleados` o `Supervisores` segun el perfil.
4. Para probar `employee.html`, configurar `EMPLOYEE_PORTAL_API_BASE` hacia el dominio del backend `whatsapp-backend` que expone `/api/employee-*`; Live Server por si solo no sirve esas funciones.
5. Para probar el backend localmente, configurar `whatsapp-backend/.env` y ejecutar `npm run dev` dentro de `whatsapp-backend/`.
6. Para Live Server contra el backend desplegado, los origenes locales `localhost` y `127.0.0.1` quedan permitidos por CORS; los dominios publicos deben estar en `EMPLOYEE_PORTAL_ALLOWED_ORIGINS`.

## Formulario de propuesta
- El landing usa `POST /api/contact`.
- El envio se hace por SMTP SSL desde Vercel.
- Variables requeridas en Vercel:
  - `SMTP_HOST`
  - `SMTP_PORT`
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_SECURE` (`true` para SSL)
  - `CONTACT_FROM_EMAIL` (opcional, por defecto `SMTP_USER`)
  - `CONTACT_TO_EMAIL` (opcional, por defecto `capcol@capcol.com.co`)

## Documentacion operativa
- Supabase: `SUPABASE_SETUP.md`
- WhatsApp backend: `WHATSAPP_BACKEND_MIGRATION.md`
- Guia de conversacion WhatsApp: `WHATSAPP_CONVERSATION_GUIDE.md`
- Reconexion completa: `RECONNECTION_CHECKLIST.md`

Marcaciones por turno: instalacion y pruebas en [docs/shift-attendance.md](docs/shift-attendance.md).
