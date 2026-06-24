# Certificados laborales

Esta carpeta contiene la configuracion y los assets privados usados para generar certificados laborales en PDF.

## Guia de diseno

- Formato: carta.
- Encabezado reservado: maximo 3.4 cm de alto.
- Pie reservado: maximo 3.2 cm de alto.
- Firma: imagen dentro del cuerpo del certificado, recomendada en PNG transparente.
- El PDF se genera en memoria y no se almacena.
- El PDF se genera con PDFKit para evitar dependencias de navegador en serverless.

## Archivos configurables por proyecto Rocky

- `config.js`: datos de empresa, logo, pie, firma y firmante.
- `assets/certificate-header-blank.png`: guia/base para el encabezado, 1200 x 480 px.
- `assets/certificate-footer-blank.png`: guia/base para el pie, 1200 x 454 px.
- `assets/certificate-signature-blank.png`: guia/base para la firma, 360 x 180 px.

La firma real debe permanecer en esta carpeta del backend, nunca en `src/assets/img`, porque esa carpeta es publica en el frontend.

Las zonas de encabezado y pie pueden contener imagenes o HTML, pero deben respetar las alturas reservadas para que el cuerpo del certificado no se superponga.

## Donde cambiar los datos

Todos los datos principales se cambian en `config.js`.

Nombre, NIT, regimen y ciudad de la empresa:

```js
companyLegalName: 'NOMBRE LEGAL DE LA EMPRESA',
companyNit: '900.000.000-0',
companyRegimeText: '[ Regimen o datos legales ]',
city: 'Medellin',
```

Nombre y cargo de quien firma:

```js
signature: {
  imagePath: './assets/firma.png',
  signerName: 'NOMBRE DE QUIEN FIRMA',
  signerTitle: 'CARGO DE QUIEN FIRMA'
}
```

La imagen de firma debe guardarse en `whatsapp-backend/src/certificates/assets/` y referenciarse en `signature.imagePath`.

## Texto base del certificado

El texto principal queda construido asi:

```txt
EMPRESA, identificada con NIT XXXXX, CERTIFICA que EMPLEADO,
identificado(a) con documento de identidad No. DOCUMENTO,
se encuentra vinculado(a) laboralmente con nuestra compañía desde FECHA,
desempeñando el cargo de CARGO.
```

Si el certificado es con salario, se agrega el parrafo de salario configurado desde el cargo del empleado.

## Verificacion por QR

Cada certificado genera un codigo unico en `employee_certificate_audit.verification_code`.

El PDF incluye un QR que abre:

```txt
PUBLIC_BACKEND_URL/api/certificates/verify/CODIGO
```

La URL muestra si el certificado existe en la auditoria, la fecha de emision, el tipo de certificado, el canal y datos basicos del empleado. No se almacena el PDF, solo el registro de auditoria.

Para que funcione, aplica la migracion `supabase/schema_operations_phase17_employee_certificates.sql` actualizada, que agrega la columna `verification_code` y su indice unico.
