# Guia de conversacion WhatsApp - Rocky

Documento base para revisar, proyectar y modificar el flujo conversacional de WhatsApp del proyecto.

## Alcance

Esta guia describe el flujo actual implementado en `whatsapp-backend/src/app.js` para:

- Identificacion del empleado por telefono o cedula.
- Confirmacion de identidad.
- Registro diario de asistencia.
- Registro de compensatorio.
- Registro de novedades con fechas.
- Actualizacion de telefono y sede.
- Flujo QR para sedes con registro QR activo.

No cubre el portal web de empleados, certificados laborales ni la tablet QR salvo donde el flujo de WhatsApp los invoca.

## Principios del flujo

- El usuario puede reiniciar la conversacion escribiendo `Hola`.
- Cada telefono mantiene una sesion en `whatsapp_sessions`.
- Cada mensaje recibido se audita en `whatsapp_incoming`.
- El bot usa botones para menus cortos y listas para selecciones largas.
- Las fechas se solicitan como `DD/MM/AAAA`.
- Si la respuesta no se entiende, se pide seleccionar una opcion del menu.
- Si hay error interno, el usuario recibe un mensaje operativo y el evento queda marcado como fallido.

## Estados de sesion

| Estado | Significado |
| --- | --- |
| `idle` | Sin flujo activo. |
| `awaiting_document` | Espera cedula del usuario. |
| `awaiting_action` | Espera accion principal del empleado. |
| `awaiting_working_sede_keyword` | Supernumerario debe escribir palabra clave de sede para trabajar. |
| `awaiting_working_sede_selection` | Espera seleccion de sede donde trabajara el supernumerario. |
| `awaiting_qr_attendance_action` | Espera si el QR sera para ingreso o salida. |
| `awaiting_qr_location` | Espera ubicacion actual de WhatsApp. |
| `awaiting_update_action` | Espera si actualizara sede o telefono. |
| `awaiting_transfer_keyword` | Espera palabra clave de sede destino. |
| `awaiting_transfer_selection` | Espera seleccion de sede destino. |
| `awaiting_phone` | Espera nuevo numero de telefono. |
| `awaiting_novelty` | Espera seleccion de novedad. |
| `awaiting_date_start` | Espera fecha inicial de novedad. |
| `awaiting_date_end` | Espera fecha final de novedad. |
| `completed` | Flujo finalizado. |

## Entrada inicial

### Usuario escribe `Hola`

El backend reinicia la sesion y busca el empleado por el numero de WhatsApp.

### Si el telefono esta registrado

Para empleado regular:

```text
Hola, soy Rocky

Eres: {nombre}
Cedula: {documento}
Estas en: {sede}

Elige una opcion:
```

Botones:

- `Soy Yo`
- `No Soy Yo`
- `Actualizar Datos`

Para supernumerario:

```text
Hola, soy Rocky

Eres: {nombre}
Cedula: {documento}
Estas como SUPERNUMERARIO

Elige una opcion:
```

Botones:

- `Trabajando`
- `Novedad`
- `Actualizar Datos`

### Si el telefono no esta registrado

```text
Hola, no encontramos tu numero registrado en la base de datos, por favor escribe tu cedula sin puntos.
```

Si la cedula no existe:

```text
No estas registrado en nuestra base de datos, por favor comunicate con tu supervisor.
```

Si la cedula existe, el flujo continua como identificado por documento.

## Flujo empleado regular

### Confirmacion: `Soy Yo`

Antes de mostrar el menu operativo se valida si el empleado tiene incapacidad activa para la fecha actual.

Si tiene incapacidad activa:

```text
Te encuentras incapacitado, Muchas Gracia por el registro.
```

Si no tiene incapacidad activa:

```text
Elige una opcion:
```

Botones:

- `Trabajando`
- `Compensatorio`
- `Novedad`

### Confirmacion: `No Soy Yo`

El bot solicita cedula:

```text
Por favor escribe tu numero de cedula sin puntos:
```

## Registro `Trabajando`

### Empleado regular en sede sin QR

Se registra la novedad `Trabajando` con codigo `1` en `attendance`.

Respuesta final:

```text
Registro confirmado. Fecha: {fecha}, Hora: {hora}, Novedad: Trabajando, Muchas Gracias.
```

### Empleado regular en sede con QR

Si la sede tiene `qr_enabled = true`, no se registra directamente. El bot abre el flujo QR:

```text
La sede {sede} usa registro por QR.

Que deseas registrar?
```

Botones:

- `Ingreso`
- `Salida`

### Supernumerario trabajando

El bot pide palabra clave de la sede:

```text
Escribe una palabra clave del nombre de la sede en la que te encuentras:
```

Si encuentra sedes, muestra lista:

```text
Selecciona la sede:
```

Boton de lista:

- `Ver sedes`

Cada opcion muestra:

- Nombre de sede.
- Codigo de sede.
- Zona.

Si la sede seleccionada tiene QR activo, continua con flujo QR. Si no, registra `Trabajando`.

## Flujo QR desde WhatsApp

Aplica cuando la sede seleccionada tiene `qr_enabled = true`.

### Paso 1: accion QR

Botones:

- `Ingreso`
- `Salida`

Validaciones:

- Si ya hay ingreso hoy y el usuario solicita ingreso:

```text
Ya tienes un ingreso registrado para hoy. Si necesitas marcar salida, escribe "Hola" y selecciona Salida.
```

- Si solicita salida sin ingreso:

```text
No encontramos un ingreso registrado para hoy. Primero debes registrar Ingreso.
```

- Si ya tiene salida:

```text
Ya tienes una salida registrada para hoy. No es necesario generar otro QR.
```

### Paso 2: ubicacion actual

```text
Para generar el QR comparte tu ubicacion actual desde WhatsApp. Debes estar a maximo 500 metros de la sede.
```

Validaciones:

- Debe ser una ubicacion real de WhatsApp.
- No se acepta ubicacion buscada por nombre o direccion.
- La sede debe tener `qr_latitude` y `qr_longitude`.
- El radio se toma de `qr_radius_meters`; si no existe, usa 500 metros.

Mensajes de error:

```text
Por favor comparte tu ubicacion actual usando la opcion Ubicacion de WhatsApp para generar el QR.
```

```text
Recibimos una ubicacion con nombre o direccion, que puede corresponder a una busqueda. Para generar el QR comparte tu ubicacion actual desde WhatsApp, sin seleccionar una direccion del mapa.
```

```text
Esta sede tiene QR activo pero no tiene latitud/longitud configurada. Comunicate con el supervisor.
```

```text
Tu ubicacion esta a {metros} metros de la sede. El maximo permitido es {radio} metros. Comparte tu ubicacion actual cuando estes en la sede.
```

### Paso 3: QR temporal

Si la ubicacion es valida, se crea un token en `attendance_qr_tokens` y se envia una imagen QR.

Caption:

```text
QR temporal para registrar {ingreso|salida}.
Empleado: {nombre}
Sede: {sede}
Ubicacion validada: {metros} m de la sede.
Vence en {minutos} minutos.
```

Si falla el envio de imagen, el bot envia un enlace alterno al QR.

### Paso 4: lectura desde tablet

La tablet escanea el QR y llama al backend.

- Ingreso crea registro en `attendance`.
- Salida crea registro en `employee_daily_exits`.
- Cada lectura queda en `attendance_qr_scans`.

## Registro `Compensatorio`

Solo aparece como boton para empleado regular despues de `Soy Yo`.

Registra codigo `7` en `attendance`.

Respuesta final:

```text
Registro confirmado. Fecha: {fecha}, Hora: {hora}, Novedad: Compensatorio, Muchas Gracias.
```

## Registro de novedades

El usuario selecciona `Novedad`.

Mensaje:

```text
Selecciona la novedad que presentas:
```

Boton de lista:

- `Seleccionar novedad`

Opciones para empleado regular:

- `Enfermedad General` - codigo `3`
- `Accidente Laboral` - codigo `2`
- `Calamidad` - codigo `4`
- `Licencia No Remunerada` - codigo `5`
- `Vacaciones` - codigo `9`
- `Licencia Remunerada` - codigo `6`

Opciones para supernumerario:

- `Enfermedad General` - codigo `3`
- `Accidente Laboral` - codigo `2`
- `Calamidad` - codigo `4`
- `Licencia No Remunerada` - codigo `5`
- `Vacaciones` - codigo `9`

Nota: `Licencia Remunerada` no se muestra para supernumerarios.

### Fechas

Todas las novedades listadas solicitan fecha inicial y final.

Para incapacidad:

```text
Selecciona las fechas de incapacidad:

Fecha de inicio de incapacidad, por favor escribe DD/MM/AAAA:
```

```text
Fecha de terminacion de incapacidad, por favor escribe DD/MM/AAAA:
```

Para licencia:

```text
Selecciona las fechas de licencia:

Fecha de inicio de licencia, por favor escribe DD/MM/AAAA:
```

```text
Fecha de terminacion de licencia, por favor escribe DD/MM/AAAA:
```

Para vacaciones:

```text
Selecciona las fechas de vacaciones:

Fecha de inicio de vacaciones, por favor escribe DD/MM/AAAA:
```

```text
Fecha de terminacion de vacaciones, por favor escribe DD/MM/AAAA:
```

Validaciones:

- Fecha invalida: repite el prompt correspondiente.
- Fecha final menor a fecha inicial:

```text
La fecha de terminacion no puede ser menor a la fecha de inicio ({fecha_inicio}).

{prompt_fecha_final}
```

- Novedad/incapacidad solapada:

```text
Usted ya registro una incapacidad para estas fechas, por favor corrija el registro escribiendo "Hola" o comunicate con el Supervisor.
```

o:

```text
Usted ya registro una novedad para estas fechas, por favor corrija el registro escribiendo "Hola" o comunicate con el Supervisor.
```

### Escritura de datos

Toda novedad crea o actualiza registro en `attendance`.

Si la novedad cuenta como ausentismo:

- Crea o actualiza `absenteeism`.

Si la novedad se rastrea como incapacidad/licencia/vacaciones:

- Inserta en `incapacitados`.
- `canal_registro = whatsapp`.

### Soporte requerido

`Accidente Laboral` y `Enfermedad General` requieren soporte.

Mensaje:

```text
Por favor cargue el soporte ingresando al siguiente link:
https://www.capcol.com.co/employee.html
```

Si la duracion es mayor a 3 dias:

```text
RECUERDA: Si es mayor a tres dias debes cargar la historia clinica o Epicrisis.
```

Para novedades sin soporte requerido:

```text
Registro confirmado. Fecha: {fecha}, Hora: {hora}, Novedad: {novedad}, Muchas Gracias.
```

## Actualizar datos

Desde el menu inicial se puede seleccionar `Actualizar Datos`.

Mensaje:

```text
Selecciona una opcion:
```

Botones:

- `Traslado de Sede`
- `Cambio de Telefono`

### Cambio de telefono

Prompt:

```text
Diligencia el numero de celular nuevo:
```

Si el numero es invalido, repite el prompt.

Al guardar:

```text
Informacion actualizada correctamente, si no haz realizado el registro por favor escribe nuevamente "Hola".
```

Tabla afectada:

- `employees.telefono`

### Traslado de sede

Prompt:

```text
Escribe una palabra clave del nombre de la sede a la que te trasladaron:
```

Si no hay coincidencias:

```text
No encontramos sedes con esa palabra. Intenta con otra palabra clave.
```

Si encuentra sedes, muestra lista:

```text
Selecciona la sede:
```

Al guardar:

```text
Informacion actualizada correctamente, si no haz realizado el registro por favor escribe nuevamente "Hola".
```

Validacion importante:

- Si el empleado ya registro asistencia hoy en la sede anterior, no puede iniciar traslado hoy.

Tablas afectadas:

- `employees`
- `employee_cargo_history`
- Snapshots operativos del dia mediante `refreshOperationalState`.

## Supernumerarios

Diferencias principales:

- No pasan por `Soy Yo` / `No Soy Yo`.
- El menu inicial ofrece `Trabajando`, `Novedad`, `Actualizar Datos`.
- Para `Trabajando` siempre deben seleccionar la sede donde estan.
- No se les muestra `Compensatorio` como accion principal.
- En novedades no se muestra `Licencia Remunerada`.

## Tablas principales

| Tabla | Uso |
| --- | --- |
| `whatsapp_incoming` | Auditoria de mensajes y estados entrantes. |
| `whatsapp_sessions` | Estado conversacional por telefono. |
| `employees` | Identificacion, telefono, sede y datos base. |
| `sedes` | Sedes, QR activo, ubicacion QR y radio. |
| `attendance` | Registro diario de asistencia/novedad. |
| `absenteeism` | Ausentismos reportados. |
| `incapacitados` | Incapacidades, licencias y vacaciones con rango de fechas. |
| `employee_cargo_history` | Historial de asignacion usado en traslados. |
| `attendance_qr_tokens` | Tokens QR generados desde WhatsApp. |
| `attendance_qr_scans` | Auditoria de lecturas QR. |
| `employee_daily_exits` | Salidas QR. |

## Puntos de modificacion proyectables

Usar esta seccion para discutir cambios antes de implementarlos.

### 1. Textos y tono

Archivo principal:

- `whatsapp-backend/src/app.js`

Funciones frecuentes:

- `sendIdentityOrMenu`
- `handleActionSelection`
- `promptQrAttendanceAction`
- `handleQrAttendanceAction`
- `handleQrLocationInput`
- `handleNoveltySelection`
- `getNoveltyDatePrompts`
- `buildSupportMessage`
- `registerNovelty`

Cambios posibles:

- Corregir acentos y redaccion.
- Estandarizar tratamiento: `usted` vs `tu`.
- Reducir mensajes largos.
- Agregar instrucciones mas claras para ubicacion QR.

### 2. Menus

Funciones:

- `sendButtons`
- `sendList`
- `buildNoveltyRows`
- `mapActionChoice`
- `mapNovelty`

Cambios posibles:

- Reordenar opciones.
- Renombrar botones.
- Agregar nueva novedad.
- Ocultar opciones segun rol, sede o tipo de contrato.

Restriccion tecnica:

- WhatsApp limita titulos de botones a 20 caracteres.
- WhatsApp limita titulos de lista a 24 caracteres.
- Descripciones de lista se truncan a 72 caracteres.

### 3. Reglas de asistencia

Funciones:

- `registerNovelty`
- `validateQrActionAvailability`
- `clearDailyOperationalAbsenceArtifacts`
- `refreshOperationalState`

Cambios posibles:

- Evitar sobreescritura de registros existentes.
- Permitir correcciones controladas.
- Bloquear registros despues de cierta hora.
- Diferenciar entrada, salida y novedad por sede.

### 4. QR y ubicacion

Funciones:

- `isQrEnabledForSede`
- `promptQrAttendanceAction`
- `handleQrLocationInput`
- `validateQrLocationForSede`
- `sendAttendanceQr`

Cambios posibles:

- Cambiar radio por defecto.
- Hacer radio obligatorio por sede.
- Permitir salida sin geocerca.
- Enviar instrucciones con imagen o texto mas guiado.
- Agregar reintentos o expiracion visible.

Variables relacionadas:

- `ATTENDANCE_QR_TOKEN_MINUTES`
- `PUBLIC_BACKEND_URL`

### 5. Soportes de incapacidad

Funciones:

- `buildSupportMessage`
- `registerNovelty`

Cambios posibles:

- Pedir soporte dentro de WhatsApp.
- Enviar enlace con parametros prellenados.
- Diferenciar soporte obligatorio por novedad.
- Cambiar regla de Epicrisis para mas de 3 dias.

### 6. Actualizacion de datos

Funciones:

- `handleUpdateSelection`
- `handlePhoneUpdate`
- `handleTransferKeyword`
- `handleTransferSelection`

Cambios posibles:

- Requerir confirmacion antes de guardar traslado.
- Restringir traslados por zona.
- Pedir motivo de traslado.
- Enviar notificacion al supervisor.

## Flujos resumen

### Empleado regular sin QR

```text
Hola
-> Identificacion por telefono
-> Soy Yo
-> Trabajando / Compensatorio / Novedad
-> Registro en attendance
-> Confirmacion final
```

### Empleado regular con QR

```text
Hola
-> Identificacion por telefono
-> Soy Yo
-> Trabajando
-> Ingreso / Salida
-> Compartir ubicacion actual
-> Envio de QR temporal
-> Tablet escanea QR
-> Registro en attendance o employee_daily_exits
```

### Supernumerario

```text
Hola
-> Identificacion por telefono
-> Trabajando
-> Escribe palabra clave de sede
-> Selecciona sede
-> Si sede QR: flujo QR
-> Si sede sin QR: registro en attendance
```

### Novedad con fechas

```text
Hola
-> Identificacion
-> Novedad
-> Seleccion de novedad
-> Fecha inicio
-> Fecha fin
-> Validacion de solapes
-> Registro en attendance / absenteeism / incapacitados
-> Link de soporte o confirmacion final
```

## Checklist para modificar el flujo

- Definir el cambio exacto de conversacion.
- Identificar estado de sesion afectado.
- Actualizar texto, menu o regla en `whatsapp-backend/src/app.js`.
- Revisar tablas afectadas.
- Probar con un numero registrado.
- Probar con un numero no registrado.
- Probar respuesta invalida.
- Probar reinicio con `Hola`.
- Revisar `whatsapp_incoming`.
- Revisar `whatsapp_sessions`.
- Confirmar escritura en tablas operativas.
- Validar que el frontend refleje el resultado en Registro Diario, Registro QR o Reportes.

## Casos de prueba recomendados

1. Telefono registrado, empleado regular, `Soy Yo`, `Trabajando`, sede sin QR.
2. Telefono registrado, empleado regular, `Soy Yo`, `Trabajando`, sede con QR, `Ingreso`, ubicacion valida.
3. Sede con QR, `Salida` sin ingreso previo.
4. Sede con QR, ubicacion por busqueda/direccion.
5. Sede con QR, ubicacion fuera del radio.
6. Supernumerario, `Trabajando`, busqueda de sede sin resultados.
7. Supernumerario, `Trabajando`, seleccion de sede valida.
8. Novedad `Enfermedad General` con fechas validas.
9. Novedad con fecha final menor a inicial.
10. Novedad solapada con incapacidad existente.
11. Cambio de telefono con numero valido.
12. Traslado de sede antes de registrar asistencia.
13. Traslado de sede despues de registrar asistencia.
14. Usuario escribe `Hola` a mitad del flujo.
15. Usuario responde texto libre donde se esperaba boton/lista.
