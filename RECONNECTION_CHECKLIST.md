# RockyDEMO - Checklist de reconexion

## 1. GitHub
- Crear un repositorio nuevo en la cuenta destino.
- En local, apuntar `origin` al repo nuevo:

```powershell
git remote add origin https://github.com/TU-USUARIO-O-ORG/RockyDEMO.git
git branch -M main
git push -u origin main
```

## 2. Supabase
- Crear un proyecto nuevo en Supabase.
- Ejecutar los esquemas SQL en el orden documentado en `SUPABASE_SETUP.md`.
  Desde una base nueva, incluye `schema_foundation_phase0.sql` y todas las fases hasta `schema_operations_phase13.sql`.
- Actualizar `src/assets/js/config.js` con:

```js
export const SUPABASE_URL = 'https://daxltsptgkfvbupncbkt.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheGx0c3B0Z2tmdmJ1cG5jYmt0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzOTI5MDMsImV4cCI6MjA4OTk2ODkwM30.loe5u6Wrnv-pRSY4pOV6gdi-WvXsd6e9vui2SXkGvtY';
```

- Actualizar `whatsapp-backend/.env` y variables de Vercel:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

## 3. WhatsApp Cloud API
- Crear o seleccionar la nueva app en Meta.
- Configurar estos valores en `whatsapp-backend/.env` y Vercel:
  - `WHATSAPP_VERIFY_TOKEN`
  - `WHATSAPP_ACCESS_TOKEN`
  - `WHATSAPP_PHONE_NUMBER_ID`
  - `WHATSAPP_GRAPH_VERSION`
  - `WHATSAPP_APP_SECRET`
  - `CRON_SECRET`
- Registrar el nuevo webhook con la URL del backend nuevo:
  - `https://TU-BACKEND/api/webhooks/whatsapp`

## 4. Vercel
- Crear un proyecto nuevo para el frontend.
- Crear un proyecto nuevo para `whatsapp-backend/`.
- Cargar las variables de entorno nuevas en cada proyecto.
- Verificar que el cron de `whatsapp-backend/vercel.json` quede activo en la cuenta nueva.

## 5. Validacion final
- Probar login en frontend.
- Probar lectura/escritura en Supabase.
- Confirmar que `attendance`, `import_replacements` y `daily_metrics` quedaron agregadas a `supabase_realtime`.
- Probar verificacion `GET /api/webhooks/whatsapp`.
- Probar envio y recepcion de un mensaje real en WhatsApp.
