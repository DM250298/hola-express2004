# Tareas v2 · Especificación para HEX

> Para trabajar con Claude Code. Guardalo en el repo como `docs/tareas-v2.md` y poné las capturas del lienzo en `docs/tareas-v2/`.

## 1. Objetivo

Rediseñar **Turnos y equipo › Tareas** (`/rrhh?tab=tareas`) para que:

- cada tarea tenga horario y duración, y la agenda del turno se vea como un calendario;
- además de la rutina existan tareas **puntuales** (un solo día) y **privadas** (solo administradores);
- el dueño y la encargada trabajen en el mismo tablero, con permisos distintos;
- todo cambio quede registrado y no se pueda borrar.

Referencia visual: lienzo "Tablero de tareas HEX" en claude.ai. Pantallas: Agenda del día (admin y encargada), Detalle de la tarea, Nueva tarea, Configurar rutina (admin y encargada), Registro de cambios y Mi turno (celular). Los datos de esas pantallas son de ejemplo: no se cargan en la base, salvo la rutina del Anexo A.

## 2. Qué se mantiene

- Las pestañas Agenda del día · Configurar rutina · Cumplimiento.
- Los horarios de turno (Mañana 07–15, Tarde 15–23, Noche 23–07, que termina al día siguiente) y la regla de que la rutina guarda su inicio en minutos desde el inicio del turno.
- La asignación "según cronograma" por puesto y los modos Cada uno / Grupal.
- La prioridad Alta / Media / Baja.
- El estilo visual actual de HEX y los componentes que ya existen en el repo.

## 3. Reglas de negocio

### 3.1 Tipos de tarea

- **Rutina**: plantilla que se repite los días elegidos. Guarda inicio (minutos desde el inicio del turno) y duración en minutos. Sin duración = "todo el turno".
- **Puntual**: existe solo para una fecha y un turno. Guarda hora de inicio y de fin, o "todo el turno".
- **Privada**: marca que se puede poner en una puntual o en una rutina. Solo la ven y la hacen los administradores; no aparece para la encargada ni en los celulares.

### 3.2 Áreas

| Clave | Nombre en pantalla |
| --- | --- |
| `atencion_caja` | Atención y caja |
| `produccion_fiambreria` | Producción y fiambrería |
| `reposicion_limpieza` | Reposición, depósito y limpieza |
| `control_seguridad` | Control y seguridad |

### 3.3 Asignación

- Por puesto según el cronograma (Encargada de sucursal, Fiambrero/Producción, Cajero/a) o a una persona fija.
- Si la persona está de franco, la tarea pasa a quien la cubre según el cronograma.
- Con varios asignados: **Cada uno** (cada persona la marca por su lado) o **Grupal** (con que uno la marque alcanza).
- Turno noche: si no hay puesto específico, va al vendedor de turno.

### 3.4 Estados

- `pendiente` → `en_curso` → `hecha`.
- `no_se_pudo`, con motivo obligatorio (faltó insumo / no alcanzó el tiempo / se rompió algo / otro) y detalle opcional.
- `cancelada`, solo para puntuales.
- **Atrasada no se guarda**: se calcula (`fin_at < now()` con estado pendiente o en curso) y se muestra con los minutos de atraso.

### 3.5 De la rutina a la agenda

- La agenda de cada día se genera desde la rutina, por turno, con las tareas activas cuyo día de la semana aplica.
- Un cambio en la rutina se aplica desde la agenda de mañana. El botón "Actualizar también la agenda de hoy" regenera solo las tareas de hoy que siguen pendientes y que nadie tocó.
- Las puntuales se suman a la agenda de su día y conviven con la rutina.
- La generación tiene que ser idempotente: correrla dos veces no duplica tareas.

### 3.6 Avisos de atraso

- Cada tarea puede tener "avisar si se atrasa más de N minutos" (por defecto 15 en prioridad alta).
- El aviso va a la encargada. Si la tarea es de la encargada, va al administrador.
- Usar el módulo de Alertas que ya existe.

### 3.7 Registro de cambios

- Todo queda como evento: creación, cambio de horario, área, días, asignados o prioridad, inicio, completada, no se pudo, reabierta, corrección de hora, pedido de quitar, aprobación o rechazo, aviso de atraso.
- Cada evento guarda quién, cuándo, en nombre de quién (si marcó por otro), el valor anterior y el nuevo.
- Nadie puede editar ni borrar eventos, tampoco el administrador.
- Si alguien marca una tarea de otra persona, queda "marcada por X en nombre de Y".
- Corregir una hora guarda la original.

### 3.8 Retiro de caja

En las vistas de empleados no se muestra el monto del tope. El POS avisa "Toca retiro de caja" cuando el efectivo llega al tope, que configura solo el administrador.

## 4. Permisos por rol

| Acción | Administrador | Encargada | Empleado |
| --- | --- | --- | --- |
| Ver la agenda del día | Todo | Todo menos privadas | Solo sus tareas |
| Ver tareas privadas | Sí | No | No |
| Iniciar, completar, no se pudo | Todas | Todas (queda a su nombre si es de otro) | Solo las suyas |
| Crear puntuales | Sí, también privadas | Sí, nunca privadas | No |
| Editar la agenda de hoy (hora, asignado) | Sí | Sí, queda registrado | No |
| Editar la rutina | Sí | Sí, queda registrado | No |
| Quitar tareas de la rutina | Sí (se desactivan, no se borran) | Solo pedirlo | No |
| Aprobar o rechazar pedidos | Sí | No | No |
| Cambiar horarios de turno | Sí | No | No |
| Pantalla Registro de cambios | Sí | No (ve el historial dentro de cada tarea) | No |
| Sueldos, Tablero del dueño, Reportes, Finanzas | Sí | No | No |

**Los permisos se aplican en la base con RLS y funciones, no solo ocultando botones.** Lo mismo para Sueldos: la tabla tiene que tener RLS que solo deje leer al administrador.

## 5. Modelo de datos (propuesta)

Antes de crear tablas, relevá las que ya existen para tareas y adaptá esta propuesta: extender antes que duplicar. Nombres en español y snake_case, como el resto del esquema. Zona horaria `America/Argentina/La_Rioja`.

### 5.1 Enums

- `tarea_area`: atencion_caja, produccion_fiambreria, reposicion_limpieza, control_seguridad
- `tarea_estado`: pendiente, en_curso, hecha, no_se_pudo, cancelada
- `tarea_origen`: rutina, puntual
- `tarea_modo`: cada_uno, grupal
- `tarea_prioridad`: alta, media, baja
- `tarea_evento_tipo`: creada, editada, iniciada, completada, no_se_pudo, reabierta, hora_corregida, cancelada, pedido_quitar, pedido_aprobado, pedido_rechazado, aviso_atraso
- `pedido_estado`: pendiente, aprobado, rechazado

### 5.2 Tablas

**`tareas_rutina`** (plantilla)
id, turno_id, titulo, descripcion, area, inicio_offset_min (null = todo el turno), duracion_min (null = todo el turno), dias_semana smallint[] (1 = lunes … 7 = domingo), puesto_id o empleado_id, modo, prioridad, privada, avisar_atraso_min, requiere_foto, checklist jsonb, activa, created_by, created_at, updated_at.

**`tareas_agenda`** (lo que hay que hacer cada día)
id, fecha, turno_id, rutina_id (null si es puntual), origen, titulo, descripcion, area, inicio_at timestamptz, fin_at timestamptz, todo_el_turno, modo, prioridad, privada, estado, motivo_no_se_pudo, detalle_motivo, nota_proximo_turno, avisar_atraso_min, aviso_atraso_enviado_at, requiere_foto, foto_url, checklist jsonb (con el estado de cada paso), created_by, created_at, iniciada_at, iniciada_por, completada_at, completada_por.
Índice único (fecha, turno_id, rutina_id) para que la generación no duplique. El turno noche cruza la medianoche: con `inicio_at` y `fin_at` como timestamptz se resuelve solo.

**`tareas_agenda_asignados`**
tarea_id, empleado_id, estado (para el modo cada uno), completada_at, completada_por.

**`tareas_eventos`** (solo inserción)
id, tarea_agenda_id, tarea_rutina_id, tipo, actor_id, en_nombre_de uuid[], antes jsonb, despues jsonb, created_at.

**`tareas_pedidos`**
id, tarea_rutina_id, tipo ('quitar'), motivo, pedido_por, estado, resuelto_por, resuelto_at.

### 5.3 Funciones

Igual que `movimientos_stock` con el stock: los cambios de tareas pasan solo por funciones (security definer) que validan el rol y escriben el evento en la misma transacción. Revocar UPDATE y DELETE directos en estas tablas para la encargada y los empleados, y DELETE para todos en `tareas_eventos`.

- `tarea_iniciar(tarea_id)`
- `tarea_completar(tarea_id, nota, foto_url)`
- `tarea_no_se_pudo(tarea_id, motivo, detalle)`
- `tarea_reabrir(tarea_id)`
- `tarea_corregir_hora(tarea_id, campo, nueva_hora)`
- `tarea_crear_puntual(...)` y `tarea_cancelar(tarea_id)`
- `agenda_mover(tarea_id, inicio_at, fin_at, area, asignados)`
- `rutina_guardar(...)` (crea o edita la plantilla; evento con antes y después)
- `rutina_pedir_quitar(rutina_id, motivo)` y `pedido_resolver(pedido_id, aprobar)`
- `agenda_generar(fecha)` y `agenda_actualizar_hoy(turno_id)`
- Un job cada 5 minutos (pg_cron o Vercel Cron) que detecta atrasos, manda el aviso y registra el evento.

## 6. Pantallas

### 6.1 Agenda del día

- Barra del día con los cuatro tramos (noche de ayer, mañana, tarde, noche), el avance de cada uno y la línea de la hora actual.
- Calendario del turno: horas en vertical; un carril por área, o por persona con el selector "Ver por"; cada tarea ocupa el alto de su duración; si se superponen, van lado a lado; las de menos de 20 minutos se muestran en una línea.
- Franja "Todo el turno" arriba del calendario.
- Estilos: por hacer (color del área), en curso (borde naranja), atrasada (rojo, con los minutos), hecha (apagada, con la hora real), no se pudo (rayada, con el motivo), puntual (borde punteado y etiqueta), privada (carril "Solo administradores", solo para el admin).
- Panel lateral: Ahora, Atrasadas (con a quién se avisó), Lo que sigue y Avance por persona. Al tocar una tarea, el detalle se abre en ese panel.
- Para el admin, arriba del panel: "Para revisar", con los pedidos y los cambios de la semana.
- Filtros Todas / Rutina / Puntuales y selector de fecha.
- Actualización en vivo con Supabase Realtime.
- En la vista por persona, aviso cuando a alguien se le juntan 3 o más tareas a la vez.
- Para la encargada, un aviso fijo: "Lo que cambies queda en el registro y Damián lo ve. Si marcás una tarea de otra persona, queda a tu nombre."

### 6.2 Detalle de la tarea

Etiquetas de tipo (rutina, puntual o privada), prioridad y estado; horario, área, asignados y modo; descripción; checklist de pasos; acciones Iniciar, Completar, No se pudo (abre el motivo) y Volver a abrir; nota para el próximo turno (aparece en el pase de turno); historial de eventos. Si quien la marca no es el asignado, avisar antes que queda "marcada por X en nombre de Y".

### 6.3 Nueva tarea

- Elegir "Solo una vez" (puntual) o "Se repite" (rutina).
- Admin: casilla "Privada: solo administradores". Si está marcada, no se piden asignados (la hace un admin).
- Qué hay que hacer y detalle.
- Puntual: día y turno. Rutina: días de la semana y turno (aplica desde mañana).
- Horario: con horario (desde y hasta) o en cualquier momento del turno.
- Área, quién la hace (según cronograma o persona fija, mostrando quién le toca ese día), cada uno o grupal, prioridad.
- Avisar si se atrasa más de 15 minutos; pedir foto al completarla.
- Resumen "Así va a quedar" y validaciones (título obligatorio, fin después del inicio salvo en el turno noche, al menos un día en rutina).

### 6.4 Configurar rutina

- El mismo calendario, editable: arrastrar para cambiar hora o área y estirar el borde de abajo para cambiar la duración, con saltos de 15 minutos. En el celular se edita desde el formulario.
- Selector de turno y "Ver cómo queda el lunes … domingo" (las tareas que no aplican ese día se ven más claras).
- Panel de edición con los mismos campos que Nueva tarea.
- Admin: "Quitar de la rutina" (desactiva, no borra). Encargada: "Pedir que se quite" (crea el pedido).
- Horarios de turno: editables solo por el admin.

### 6.5 Registro de cambios (solo admin)

Pedidos para aprobar arriba (Aprobar / Rechazar, con deshacer). Abajo, los eventos agrupados por día, con filtros Rutina, Agenda del día, Marcadas por otro y Correcciones; cada evento muestra quién, qué, antes → después y a qué tarea apunta. Resumen semanal los lunes a las 08:00.

### 6.6 Mi turno (celular, dentro de Modo móvil)

Saludo y avance del día; tarjeta de la tarea atrasada; tarjeta "Ahora" con Completar y No se pudo (botones grandes); lo que está en curso; Más tarde; Todo el turno; Ya pasaron. Cada empleado ve solo sus tareas.

### 6.7 Menú por rol

La encargada no ve Tablero del dueño, Reportes, Finanzas ni la pestaña Sueldos. El encabezado muestra su nombre y su puesto.

## 7. Etapas

Una etapa por sesión de Claude Code. No pasar a la siguiente sin cumplir el "Listo cuando".

1. **Modelo, permisos y registro** (sin pantallas nuevas): migraciones, enums, funciones, RLS, eventos y generación de la agenda.
   *Listo cuando:* las tareas de rutina tienen horario y área aprobados por Damián (ver Anexo A), la agenda de mañana se genera desde la rutina sin duplicar, y las políticas se probaron con un usuario de cada rol.
2. **Agenda del día en calendario**: lectura, acciones, detalle, atrasos calculados, línea de ahora, vista por área y por persona.
   *Listo cuando:* la encargada inicia, completa y marca "no se pudo" desde la PC y el admin lo ve en vivo.
3. **Puntuales y privadas**: Nueva tarea, carril de privadas, filtros.
   *Listo cuando:* una puntual cargada para hoy aparece en su horario, y una privada no la ve la encargada (probado con su usuario).
4. **Rutina en calendario**: edición con arrastre, vista por día, "actualizar también hoy" y pedidos de quitar.
   *Listo cuando:* un cambio de la encargada aparece en la agenda de mañana y queda en el registro, y su pedido de quitar le llega al admin.
5. **Registro de cambios, avisos y resumen semanal.**
   *Listo cuando:* un atraso de una tarea de la encargada le avisa al admin, y el registro no se puede editar ni borrar desde ningún usuario.
6. **Mi turno en el celular.**
   *Listo cuando:* cada empleado ve solo sus tareas y las marca desde el teléfono.

## 8. Cómo trabajar cada etapa

- Rama nueva y preview de Vercel para cada etapa.
- Migraciones probadas primero en una base de prueba (un proyecto de Supabase aparte o una rama), con respaldo de producción antes de aplicarlas.
- Probar con un usuario de cada rol: admin, encargada y empleado.
- No borrar ni renombrar tablas existentes sin migrar sus datos.
- Mostrarle la etapa terminada a la encargada antes de pasar a producción.

## 9. Prompts sugeridos para Claude Code

**Arranque (relevamiento, sin código):**

```
Leé CLAUDE.md y docs/tareas-v2.md, y mirá las capturas de docs/tareas-v2/. Todavía no escribas código.
1. Relevá cómo está hecho hoy el módulo de tareas (/rrhh?tab=tareas): tablas, enums, funciones, políticas RLS, componentes y cómo se genera la agenda desde la rutina.
2. Compará la rutina actual con el Anexo A y armame una tabla con cada tarea, su turno, horario, duración, área y puesto. Marcá las que no tienen equivalente.
3. Proponé el plan de la Etapa 1: migraciones, funciones, RLS y eventos, qué se puede romper y cómo lo probamos.
Esperá mi OK antes de tocar la base.
```

**Cada etapa:**

```
Hacé la Etapa N de docs/tareas-v2.md según el plan aprobado, en una rama nueva. Al terminar, contame qué cambiaste, cómo lo probaste con cada rol y qué falta para cumplir el "Listo cuando".
```

## Anexo A · Rutina de referencia (cronograma 24 h, versión del 16/10/2026)

Prioridad alta marcada con ●. "Todo el turno" = sin horario fijo. Asignación por defecto según el área: Atención y caja → Cajero/a; Producción y fiambrería → Fiambrero/Producción; Reposición → grupal Cajero/a + Fiambrero/Producción; Control → Encargada de sucursal. En el turno noche, todo al vendedor de turno. A confirmar con Damián.

### Mañana (07:00–15:00)

| Horario | Área | Tarea | |
| --- | --- | --- | --- |
| Todo el turno | Atención y caja | Atención y ventas a clientes | |
| Todo el turno | Atención y caja | Anotar productos nuevos que sugieren los clientes | |
| Todo el turno | Producción y fiambrería | Venta de fiambre y sándwiches | |
| 07:00–07:15 | Control y seguridad | Traspaso con el turno noche: caja, novedades, pedidos pendientes | ● |
| 07:05–07:15 | Producción y fiambrería | Exhibir pan, facturas y medialunas de las 06:30 | |
| 07:30–07:45 | Control y seguridad | Controlar los productos para la elaboración de los próximos días | ● |
| 07:30–09:30 | Atención y caja | Preparar el área de caja: exhibidor, combos, golosinas, precios | ● |
| 07:30–10:30 | Producción y fiambrería | 1.ª tanda de producción (milanesas y sándwiches) | ● |
| 08:00–10:30 | Reposición | Reposición y control de góndolas, etiquetas de precio | |
| 08:00–15:00 | Reposición | Recepción de proveedores: remito, vencimientos, carga en HEX | ● |
| 08:15 | Control y seguridad | Control de temperaturas (1 de 3) | ● |
| 10:30–11:30 | Control y seguridad | Vencimientos: lo vencido afuera, lo que vence en 30 días a oferta o combo | ● |
| 11:30 | Control y seguridad | Verificar el sugerido de compras de HEX contra lo físico | ● |
| 14:00–14:40 | Producción y fiambrería | Limpieza de fiambrería y cocina | ● |
| 14:30–14:45 | Reposición | Reponer bebidas frías para la tarde | |
| 14:40–15:00 | Control y seguridad | Cierre de turno: arqueo ciego, novedades, entrega | ● |

### Tarde (15:00–23:00)

| Horario | Área | Tarea | |
| --- | --- | --- | --- |
| 15:00–15:15 | Control y seguridad | Traspaso con la mañana: caja, producción hecha y pendiente | ● |
| 15:20–17:30 | Producción y fiambrería | 2.ª tanda de sándwiches y milanesas hasta el mínimo | ● |
| 16:00 | Producción y fiambrería | Medialunas, 2.ª tanda | ● |
| 16:00 | Control y seguridad | Control de temperaturas (2 de 3) | ● |
| 16:00–18:00 | Atención y caja | Merienda: combo merienda/mate | |
| 16:30–17:30 | Reposición | Reposición fuerte de bebidas e hielo | ● |
| 17:00–18:00 | Reposición | Snacks y golosinas en góndolas de salida y caja | |
| 20:00 | Reposición | Vereda, frente y cartelera | |
| 21:00 | Control y seguridad | Vencimientos de fríos y abiertos | ● |
| 21:30–22:30 | Producción y fiambrería | Cierre de fiambrería: máquina, mesadas, rotulado | ● |
| 22:00 | Control y seguridad | Supervisión de la encargada: producción, mermas, faltantes | ● |
| 22:30–22:45 | Reposición | Basura y cartón | |
| 22:40–23:00 | Control y seguridad | Cierre: arqueo, rendición de Rapipago y del cadete | ● |

### Noche (23:00–07:00)

| Horario | Área | Tarea | |
| --- | --- | --- | --- |
| 23:00–23:15 | Control y seguridad | Traspaso con la tarde: caja chica, pedidos en curso | ● |
| 23:00–00:00 | Atención y caja | Atención con el local abierto, WhatsApp y delivery | ● |
| 23:15–00:00 | Reposición | Reposición rápida antes de pasar a reja | |
| 00:00 | Control y seguridad | Pasar a atención por reja | ● |
| 00:00–01:00 | Atención y caja | Delivery por reja; a la 01:00 se corta la toma de pedidos | ● |
| 01:00 | Control y seguridad | Cierre del delivery y rendición final del cadete | ● |
| 01:00–02:30 | Reposición | Reposición profunda y frenteo de todo el local | ● |
| 02:00 | Control y seguridad | Control de temperaturas (3 de 3) | ● |
| 02:30–04:00 | Reposición | Limpieza a fondo: pisos, baño, depósito | |
| 04:00–04:45 | Reposición | Orden de depósito, cartón atado | |
| 04:45–05:45 | Control y seguridad | Vencimientos del sector de la noche | ● |
| 05:30–06:30 | Producción y fiambrería | Puesta a punto de fiambrería: dejar todo listo para vender | ● |
| 06:30–06:45 | Producción y fiambrería | Medialunas, 1.ª tanda | ● |
| 06:40–07:00 | Control y seguridad | Cierre de turno: arqueo y novedades | ● |
| 06:45–07:00 | Producción y fiambrería | Cierre y entrega de turno | |

Las tareas con una sola hora (por ejemplo 08:15) son puntuales en el tiempo: cargarlas con 15 minutos de duración.
