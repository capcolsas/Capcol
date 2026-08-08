# Rocky - Checklist de reconexion

## 1. GitHub
- Crear un repositorio nuevo en la cuenta destino.
- En local, apuntar `origin` al repo nuevo:

```powershell
git remote add origin https://github.com/TU-USUARIO-O-ORG/RockyXXX.git
git branch -M main
git push -u origin main
```

## 2. Supabase
- Crear un proyecto nuevo en Supabase.
- Ejecutar los esquemas SQL en el orden documentado en `SUPABASE_SETUP.md`.
- Desde una base nueva, ejecutar desde `schema_foundation_phase0.sql` hasta `schema_operations_phase25_employee_extended_info.sql`, incluyendo las fases intermedias de portal de empleados, soportes de incapacidades, QR, certificados, RLS, supernumerarios, indices e informacion ampliada de empleados.
- Crear/verificar el bucket `incapacidades-soportes`.
- Configurar Supabase Auth:
  - `Site URL`: `https://TU-DOMINIO-PRODUCTIVO/app.html`
  - `Redirect URL`: `https://TU-DOMINIO-PRODUCTIVO/app.html?reset_password=1`
- Crear el primer superadmin con `supabase/create_first_superadmin.template.sql`.
- Confirmar Realtime para las tablas documentadas en `SUPABASE_SETUP.md`.
- Guardar estos valores para frontend y backend:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

## 3. Frontend
- Actualizar `src/assets/js/config.js`:

```js
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_ANON_KEY = 'ANON_OR_PUBLISHABLE_KEY';
export const SUPABASE_PROFILES_TABLE = 'profiles';
export const EMPLOYEE_PORTAL_API_BASE = 'https://TU-BACKEND.vercel.app';
```

- Validar accesos:
  - `index.html`
  - `access.html`
  - `app.html`
  - `supervisor.html`
  - `employee.html`
  - `qr.html`

## 4. Backend WhatsApp
- Crear o enlazar un proyecto Vercel nuevo apuntando a `whatsapp-backend/`.
- Configurar en Vercel y en `whatsapp-backend/.env`:
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
- Confirmar que `WHATSAPP_BACKEND_PUBLIC_URL` o `PUBLIC_BACKEND_URL` apunte al dominio publico final del backend.
- Confirmar que los dominios publicos del frontend queden en `EMPLOYEE_PORTAL_ALLOWED_ORIGINS`; `localhost` y `127.0.0.1` se permiten por codigo para pruebas locales.
- Verificar que los assets privados de certificados existan en `whatsapp-backend/src/certificates/assets/`.
- Verificar que el cron de `whatsapp-backend/vercel.json` quede activo:
  - `/api/cron/close-daily-operation`

## 5. WhatsApp Cloud API
- Crear o seleccionar la nueva app en Meta.
- Configurar el webhook con la URL del backend nuevo:
  - `https://TU-BACKEND.vercel.app/webhooks/whatsapp`
- Usar el mismo valor de `WHATSAPP_VERIFY_TOKEN` configurado en Vercel.
- Configurar y probar:
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_GRAPH_VERSION`
  - `WHATSAPP_APP_SECRET`
- En produccion, no dejar `WHATSAPP_APP_SECRET` vacio.

## 6. Vercel
- Crear un proyecto nuevo para el frontend.
- Crear un proyecto nuevo para `whatsapp-backend/`.
- Cargar variables de entorno nuevas en cada proyecto.
- Confirmar que el backend use Node 20+ segun `whatsapp-backend/package.json`.
- Confirmar que `whatsapp-backend/vercel.json` incluya:
  - `includeFiles: "src/certificates/**"`
  - `maxDuration: 300`
  - cron diario de cierre operativo
- Actualizar cualquier dominio personalizado o URL publica que use el frontend.

## 7. Validacion final
- Login administrativo en `app.html`.
- Recuperacion de contrasena con dominio productivo, no `localhost`.
- Centro de accesos en `access.html`.
- App de supervisores en `supervisor.html`.
- Portal de empleados en `employee.html`.
- Lector QR en `qr.html` o `app.html#/lector-qr`.
- Lectura/escritura de catalogos basicos: zonas, dependencias, sedes, cargos, novedades y empleados.
- Consulta de registros diarios, reportes, ausentismo e incapacidades.
- Carga y descarga de soportes de incapacidades.
- Certificados laborales: generar PDF desde portal de empleados/admin y verificar el codigo publico.
- Supernumerarios: validar ocupacion por fecha, incapacidades activas y listado por cargo vigente.
- Registro QR:
  - activar QR en una sede.
  - generar dispositivo/tablet.
  - generar QR desde WhatsApp con ubicacion valida.
  - leer QR y registrar ingreso/salida.
- WhatsApp:
  - probar verificacion `GET /webhooks/whatsapp`.
  - enviar un mensaje real con `Hola`.
  - confirmar escritura en `whatsapp_incoming`.
  - confirmar sesion en `whatsapp_sessions`.
  - registrar asistencia/novedad real.
- Cron:
  - probar `/api/cron/close-daily-operation` con autorizacion.
  - revisar `daily_closures`, `daily_sede_closures`, `daily_metrics` y `employee_daily_status`.
- Revisar logs de Vercel despues de todas las pruebas.

## 8. Referencias
- Supabase: `SUPABASE_SETUP.md`
- Backend WhatsApp: `WHATSAPP_BACKEND_MIGRATION.md`
- Certificados: `whatsapp-backend/src/certificates/README.md`
