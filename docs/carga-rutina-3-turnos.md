# Carga de la rutina de los 3 turnos · HEX

> Para trabajar con Claude Code. Guardalo en el repo como `docs/carga-rutina-3-turnos.md`, junto con `docs/rutina-3-turnos.json`.

## 1. Qué hay que hacer

Cargar en **Turnos y equipo › Tareas › Configurar rutina** (`/rrhh?tab=tareas`) las 51 tareas de rutina de los tres turnos que están en `docs/rutina-3-turnos.json`, usando el módulo **como está hoy**. Esto no es la v2 de `docs/tareas-v2.md`: no se cambian pantallas ni permisos. La gestión no se carga.

- **51 tareas:** Mañana 19, Tarde 17 y Noche 15. Hay 40 de todos los días (la T010 va de lunes a sábado) y 11 semanales sin hora fija.
- **Pasos:** 11 tareas tienen pasos, 78 en total. Son los traspasos, los cierres, las tandas de producción, las medialunas y la auditoría de normas.
- **Vigencia:** la rutina nueva rige desde el **lunes 19/10/2026 a las 07:00** (turno mañana). La agenda de hoy no se toca.
- **Origen:** el JSON sale del Excel "Carga de tareas HEX" (hojas Rutina y Pasos) y reemplaza al Anexo A de `docs/tareas-v2.md`.

**El local:**

- Mañana, 07 a 15: Sonia (Encargada de sucursal) y dos personas más.
- Tarde, 15 a 23: Rebeca (encargada del turno) y una persona más.
- Noche, 23 a 07: un vendedor solo, que desde las 00:00 atiende por la reja.

## 2. Reglas

1. **No se borra nada.** Las tareas viejas de la rutina se desactivan, y el historial de Cumplimiento queda como está.
2. **Respaldo primero.** Antes de cargar, exportá la rutina actual completa a un JSON.
3. **Sin duplicados.** La carga crea o actualiza por `codigo` (T004…T151); si la rutina es por sucursal, la clave es sucursal + código. Si se corre dos veces, la segunda no cambia nada.
4. **Todo o nada.** Se hace en una sola transacción, así que si algo falla no queda nada a medias.
5. **Primero en prueba.** Si hay base de prueba (una rama de Supabase o una base local), cargá ahí primero. Si no hay, corré el modo de prueba (`--dry-run`) contra producción y mostrame el resultado antes de cargar.
6. **Sin inventar.** Sin mi OK, no crees puestos, áreas ni pantallas, ni cambies cómo se genera la agenda.
7. **Rama nueva** para el script y la migración, si hace falta una. Sin claves en el repo.

## 3. Paso 1 · Relevamiento (sin tocar la base)

Revisá:

- **La tabla de la rutina y sus columnas:** turno, título, descripción, inicio, duración o fin, días de la semana, puesto o persona, modo, prioridad, checklist, área y activa.
- **Cómo se usa el horario:** si es la hora de inicio o un límite ("a más tardar"), y si con él se marca una tarea como atrasada.
- **Cómo y cuándo se genera la agenda desde la rutina:**
  - si se genera al abrir la pantalla, con un cron o con una función;
  - si la de mañana ya está generada;
  - si correrla dos veces duplica tareas;
  - si cargar hoy metería tareas nuevas en la agenda de hoy.
- **Con qué fecha queda la noche.** La que arranca el domingo a las 23, ¿es del domingo o del lunes? En el JSON, la noche es del día en que arranca.
- **Los puestos de HEX y quién los tiene.** Mirá qué puesto tienen en el cronograma de las últimas 4 semanas Rebeca a la tarde y cada vendedor de la noche.
- **Las tareas de la rutina actual,** activas e inactivas.

Mostrame cuatro tablas y esperá mi OK:

1. **Campos:** cada campo del JSON y dónde va en HEX. Si no hay dónde, decí qué proponés según la sección 4.
2. **Puestos:** cada puesto del JSON, el puesto de HEX que le corresponde y quién lo tiene esta semana en ese turno. Marcá los días y turnos en que un puesto queda sin nadie.
3. **Rutina actual:** cada tarea vieja con el código nuevo que la reemplaza, o "sin equivalente". Ya sabemos que "Controlar los insumos críticos antes de producir" pasó a ser el primer paso de T008 y T018.
4. **Plan:**
   - qué migración hace falta, si hace falta alguna;
   - cómo es el script;
   - en qué base lo probás;
   - cómo se asegura la vigencia desde el lunes sin tocar la agenda de hoy.

## 4. Cómo resolver lo que el módulo no tenga

| Si el módulo no tiene… | Hacé esto |
| --- | --- |
| Un código externo | Proponé agregar `codigo text`, que puede quedar vacío y lleva índice único. Es un cambio aditivo. Si no lo apruebo, la clave es turno + título. |
| Inicio y duración (tiene un solo horario) | Si con ese horario se marca el atraso, cargá la hora de fin, porque si no, una tanda de 3 horas figura atrasada apenas empieza. Poné el rango al principio de la descripción ("De 07:30 a 10:30"). Si es solo el inicio, cargá el inicio. |
| Tareas sin hora fija | Inicio 0 y duración de todo el turno (480 min). Al principio de la descripción poné "En cualquier momento del turno". |
| Días de la semana | Proponé el cambio mínimo: una columna `dias_semana smallint[]` con todos los días por defecto, y el filtro con `extract(isodow from fecha)` en la generación. Si no lo apruebo hoy, cargá solo las 40 diarias (a la T010 le agregás "De lunes a sábado" en la descripción) y dejá las 11 semanales para después. |
| Checklist | Usá `descripcion_con_pasos`, que trae el detalle y los pasos numerados. |
| Varios puestos en una tarea | Para las grupales de "Cajero/a + Fiambrero/Producción", usá "todos los del turno" en modo grupal, si existe. Si no existe, asignalas a Cajero/a. Avisame cuáles quedaron así. |
| Un puesto para el vendedor de la noche | Usá el puesto que tiene en el cronograma. Si cambia según la persona, asigná las tareas a todos los del turno (está solo). |
| Un puesto para Rebeca | Usá el que tiene en el cronograma de la tarde. Si no tiene uno propio, avisame y lo decidimos. |
| Área | No la cargues, queda para la v2. Si hay un campo parecido (por ejemplo, categoría), mapealo con `area_clave`. |
| Foto y aviso de atraso | No los cargues. Quedan en el JSON para la v2. |

Los pasos marcados como `sola_reloj`, `sola_caja_hex` o `sola_produccion_hex` los va a marcar HEX solo en la v2. Hoy se cargan como pasos comunes.

## 5. Paso 2 · Script de carga

- **Qué es:** un script `scripts/cargar-rutina-3-turnos`, en el lenguaje que ya usa el repo, que lee `docs/rutina-3-turnos.json`.
- **Modo de prueba:** con `--dry-run` no escribe nada. Lista cuántas tareas crea, actualiza, desactiva y deja igual, y las advertencias.
- **Qué hace:** crea o actualiza por código, y desactiva las viejas según la tabla 3 aprobada.
- **Validación previa:** que sean 51 tareas, con códigos únicos, días entre 1 y 7, inicio + duración ≤ 480 y todos los puestos mapeados. Si algo no cierra, no escribe nada.
- **Ojo con los días:** en JavaScript `getDay()` da 0 el domingo, y en el JSON el domingo es 7.

## 6. Paso 3 · Controles

En la base de prueba, o con el `--dry-run` si no hay:

- **Las tareas:** 51 activas con código (Mañana 19, Tarde 17, Noche 15), y las viejas inactivas.
- **Sin duplicados:** correr la carga otra vez no cambia nada.
- **La agenda de la semana:**

| Día | Mañana | Tarde | Noche | Total |
| --- | --- | --- | --- | --- |
| Lunes | 15 | 14 | 15 | 44 |
| Martes | 14 | 14 | 14 | 42 |
| Miércoles | 15 | 14 | 14 | 43 |
| Jueves | 15 | 14 | 14 | 43 |
| Viernes | 14 | 14 | 14 | 42 |
| Sábado | 14 | 14 | 14 | 42 |
| Domingo | 13 | 14 | 14 | 41 |

Si las semanales quedan afuera (no hay días de la semana), son 13, 13 y 14 todos los días.

- **Tareas puntuales:**
  - T008, 1.ª tanda: mañana, de 07:30 a 10:30 (inicio 30, 180 min), con 4 pasos.
  - T034, delivery por reja: noche, de 00:00 a 01:00 (inicio 60).
  - T037, temperaturas 3 de 3: a las 02:00 de la noche que arrancó el día anterior.
  - T043, cierre de la noche: de 06:40 a 07:00 (inicio 460), con 8 pasos.
  - T010, recepción de proveedores: no aparece el domingo.
  - T151, auditoría de normas: solo los lunes, sin hora fija, con 23 pasos.
- **Asignación:** ninguna tarea de la agenda de la semana queda sin persona asignada.

## 7. Paso 4 · Producción

1. Hacé el respaldo y cargá en una transacción.
2. Repetí los controles del Paso 3.
3. La agenda de hoy (domingo 18/10) no cambia: no se agregan tareas nuevas ni se sacan las viejas. Si eso no se puede evitar sin tocar código, avisame antes de cargar.
4. Si la agenda del lunes ya estaba generada con la rutina vieja y nadie tocó esas tareas, regenerala con la nueva, sin duplicar.

## 8. Informe final

Contame:

- qué quedó cargado;
- qué fue a la descripción porque no había campo;
- qué quedó para la v2;
- cómo se deshace con el respaldo.

## 9. Campos del JSON

| Campo | Qué es |
| --- | --- |
| `codigo` | T + número del listado (T004…T151). Es la clave para no duplicar. |
| `numero_listado` | El número en el Listado numerado (1 a 151). |
| `turno` | Mañana, Tarde o Noche. |
| `titulo` | Lo que ve el empleado. |
| `detalle` | La aclaración. Puede venir vacía. |
| `descripcion_con_pasos` | El detalle más los pasos numerados, listo si no hay checklist. |
| `area`, `area_clave` | Una de las cuatro áreas (`atencion_caja`, `produccion_fiambreria`, `reposicion_limpieza`, `control_seguridad`). |
| `puesto`, `puestos` | El puesto del Excel y la lista de puestos. Se mapean a los de HEX (ver `puestos_a_mapear`). |
| `modo` | `cada_uno` o `grupal`. |
| `prioridad` | `alta`, `media` o `baja`. |
| `sin_hora_fija` | `true` cuando se hace en cualquier momento del turno. |
| `hora_inicio`, `hora_fin` | La hora de reloj. En la noche pasa la medianoche. |
| `inicio_offset_min` | Los minutos desde el inicio del turno (07:00, 15:00 o 23:00). |
| `duracion_min` | La duración en minutos. Las de una sola hora tienen 15. |
| `dias_semana`, `dias_texto` | 1 = lunes … 7 = domingo, y el mismo dato en texto. Cuenta el día en que arranca el turno. |
| `aviso_atraso_min`, `pide_foto` | Para la v2. |
| `pasos[]` | `orden`, `texto`, `se_marca` (`a_mano`, `sola_reloj`, `sola_caja_hex`, `sola_produccion_hex`) y `viene_del_numero`. |

En el nivel de arriba también están `turnos`, `puestos_a_mapear`, `no_se_carga` y `esperado_en_la_agenda`, que son los números de la tabla del Paso 3.

## 10. Prompt para arrancar

```
Leé CLAUDE.md y docs/carga-rutina-3-turnos.md. Hoy cargamos en el módulo de tareas actual las 51 tareas de docs/rutina-3-turnos.json. Hacé el Paso 1 sin tocar la base y mostrame las cuatro tablas. Esperá mi OK antes de cargar.
```
