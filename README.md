# RockyDEMO

Plataforma de gestion operativa y administrativa para el seguimiento de servicios, personal y novedades.

## Estado actual
- Clon desacoplado de `RockyEducacion`.
- Pendiente de reconexion a nuevas cuentas de GitHub, Supabase, WhatsApp Cloud API y Vercel.
- La configuracion tracked del frontend fue saneada para no usar el proyecto anterior.

## Flujo de acceso
- Pagina principal informativa: `index.html`
- Ingreso a la aplicacion: `app.html#/login`

## Modulos principales
- Login
- Centro de permisos
- Gestion administrativa
- Operacion
- Consultas y reportes

## Supabase
- Configuracion activa del frontend en `src/assets/js/config.js`
- Cliente principal de datos en `src/assets/js/supabase.js`
- Scripts SQL de migracion en `supabase/`
- Reemplazar `SUPABASE_URL` y `SUPABASE_ANON_KEY` antes de volver a ejecutar la app.

## Backend WhatsApp
- Backend actual en `whatsapp-backend/`
- Guia de migracion y despliegue en `WHATSAPP_BACKEND_MIGRATION.md`
- Configurar nuevos secretos en `whatsapp-backend/.env` y en Vercel.

## Rutas de la app
- `#/login`
- `#/`
- `#/about`
- `#/notes`
- `#/permissions`
- `#/users`
- `#/zones`
- `#/dependencies`
- `#/sedes`
- `#/employees`
- `#/supervisors`
- `#/registros-vivo`
- `#/imports-replacements`
- `#/import-history`
- `#/payroll`
- `#/absenteeism`
- `#/reports`
- `#/upload`

## Ejecucion local
1. Abrir `index.html` con Live Server.
2. Entrar a la app desde `app.html#/login`.
3. Iniciar sesion y validar modulos segun rol/permisos.

## Documentacion operativa
- Supabase: `SUPABASE_SETUP.md`
- WhatsApp backend: `WHATSAPP_BACKEND_MIGRATION.md`
- Reconexion completa: `RECONNECTION_CHECKLIST.md`
