# Certificados laborales

Esta carpeta contiene la plantilla HTML/CSS usada para generar certificados laborales en PDF.

## Guia de diseno

- Formato: carta.
- Encabezado reservado: maximo 2.2 cm de alto.
- Pie reservado: maximo 3.2 cm de alto.
- Firma: imagen dentro del cuerpo del certificado, recomendada en PNG transparente.
- El PDF se genera en memoria y no se almacena.
- El motor principal usa HTML/CSS con Chromium. Si el entorno no permite iniciar Chromium, se usa un fallback PDFKit en Node para no bloquear la descarga.

## Archivos configurables por proyecto Rocky

- `config.js`: datos de empresa, logo, pie, firma y firmante.
- `template.html`: diseno completo del certificado.
- `assets/certificate-header-blank.png`: guia/base para el encabezado, 1200 x 312 px.
- `assets/certificate-footer-blank.png`: guia/base para el pie, 1200 x 454 px.
- `assets/certificate-signature-blank.png`: guia/base para la firma, 360 x 180 px.

La firma real debe permanecer en esta carpeta del backend, nunca en `src/assets/img`, porque esa carpeta es publica en el frontend.

Las zonas de encabezado y pie pueden contener imagenes o HTML, pero deben respetar las alturas reservadas para que el cuerpo del certificado no se superponga.
