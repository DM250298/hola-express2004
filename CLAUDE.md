# CLAUDE.md — Hola Express

Sistema ERP para **Hola Express**, autoservicio 24 horas en La Rioja, Argentina.
Operación 24/7 con hasta 15 empleados, modelo de referencia: el sistema
integrado de 7-Eleven (cada venta actualiza stock, cada movimiento queda
registrado, dueños con visibilidad en tiempo real).

> ⚠️ **Next.js 16, no 13/14.** APIs, convenciones y file structure pueden
> diferir del training data. Leé `node_modules/next/dist/docs/` antes de
> escribir routing o data fetching nuevo. Atendé las deprecation notices.

---

## Comandos

```bash
npm run dev      # dev server
npm run build    # build de producción (corre TypeScript check)
npm run start    # sirve el build
```

No hay test runner ni linter configurados. Los errores de TypeScript salen
en `npm run build`. **Siempre correr `npm run build` antes de cada commit
grande** — es la única red de seguridad.

---

## Stack técnico

| Capa | Tecnología | Nota |
|---|---|---|
| Framework | **Next.js 16** (App Router) | Server Components por defecto |
| UI | **React 19** + **TypeScript estricto** | `strict: true`, sin `any` |
| Estilos | **Tailwind CSS v4** | Sin `tailwind.config.js`, todo CSS-first |
| Componentes | **shadcn/ui** sobre `@base-ui/react` | **NO Radix**, ver gotcha más abajo |
| DB / Auth | **Supabase** (`@supabase/ssr` v0.10) | PostgreSQL + Auth + RLS |
| Data fetching | **TanStack Query v5** | Wrappers en `lib/hooks/` |
| Formularios | **Zod v4** + **react-hook-form v7** | |
| Gráficos | **Recharts v3** | |
| Toasts | **sonner** | |
| PDF | **jsPDF** + **html2canvas** | |
| Offline POS | **idb** (IndexedDB) | Cola de ventas + catálogo cacheado |
| Deploy | **Vercel** (auto-deploy desde GitHub main) | |

---

## Arquitectura

### Estructura de rutas

Todas las páginas autenticadas viven bajo `app/(dashboard)/`. El layout en
`app/(dashboard)/layout.tsx` es **Server Component**: lee la sesión de
Supabase y los permisos del usuario, y los pasa como props a `<Sidebar>` y
`<Header>`. **No hay chequeo de auth en cliente** — si el layout renderiza,
el usuario está autenticado.

Existe un segundo grupo `app/(tienda)/` para la tienda online pública (no
requiere login, max-w-lg mobile-first).

**Rutas autenticadas:** `/` (dashboard), `/pos`, `/ventas`, `/inventario`
(con `/movimientos` y `/clasificacion-abc`), `/vencimientos`, `/compras`
(unificado), `/etiquetas`, `/finanzas`, `/contabilidad`, `/rrhh`,
`/clientes`, `/proyectos`, `/agenda`, `/reportes`, `/tablero`, `/alertas`,
`/mapa`, `/produccion`,
`/terminales`, `/configuracion` (productos, categorías, proveedores,
usuarios).

**Rutas públicas:** `/login`, `/tienda` (catálogo, carrito, checkout,
confirmado), `/api/tienda/*`.

**Rutas legacy redirigidas:** `/pedidos` y `/recepcion` → `/compras` (módulo
unificado).

### Cliente Supabase (no mezclar)

- **Server Components / layouts**: `createServerClient()` de
  `@/lib/supabase/server`
- **Client Components / hooks / queries**: `createClient()` de
  `@/lib/supabase/client`
- El server lee cookies vía Next.js headers; el browser usa
  `createBrowserClient` de `@supabase/ssr`

Nunca mezclarlos.

### Patrón de capa de datos

Toda feature sigue este layering:

```
lib/queries/<feature>.ts      ← Supabase raw, tipado contra Database
lib/hooks/use<Feature>.ts     ← Wrappers TanStack (useQuery/useMutation)
components/<feature>/         ← UI; SOLO consume hooks, nunca queries directas
```

**Mutaciones financieras u operaciones que necesitan atomicidad** llaman
RPCs Postgres (`supabase.rpc('fn_...')`) en lugar de múltiples inserts del
cliente. Este es el patrón crítico — la falta de transacciones en el
cliente Supabase obliga a empujar la lógica al server.

RPCs principales: `fn_crear_venta`, `fn_anular_venta`, `fn_crear_devolucion`,
`fn_recibir_pedido`, `fn_guardar_factura_compra`, `fn_pagar_cuenta`,
`fn_crear_movimiento`, `fn_crear_transferencia`, `fn_validar_arqueo`,
`fn_generar_remesa`, `fn_acreditar_pago`, `fn_aplicar_conciliacion`,
`fn_aprobar_conteo`, `fn_crear_ajuste_stock`, `fn_crear_egreso`,
`fn_crear_asiento`, `fn_crear_activo`, `fn_cerrar_periodo`,
`fn_reabrir_periodo`.

Helpers SQL transversales: `fn_tiene_permiso(clave)` y `fn_mi_rol()`
(usados por las policies RLS), `fn_costo(producto_id)` / `fn_set_costo(...)`
(leer/escribir el costo gateado), `fn_periodo_cerrado(fecha)` (guarda de
cierre), `fn_auditar(...)` + `fn_ip()` (log de auditoría).

### Sistema de permisos

Permisos = string keys en `lib/permisos.ts`. Cada user tiene un `rol` en
`usuarios`; cada rol tiene `permisos: string[]` en la tabla `roles` (con
fallback `PERMISOS_POR_ROL_LEGACY`).

- **Middleware** (`middleware.ts`): controla acceso a rutas usando
  `PERMISO_RUTA` (permiso → prefijos de ruta). Redirige no autorizados a
  `/`. También maneja `RUTAS_PUBLICAS` y `RUTAS_SOLO_ANON` (ej: `/login`
  redirige logueados al dashboard, pero `/tienda` no).
- **Layout**: lee permisos de la DB y los pasa down como props.
- **Sidebar**: filtra items por permiso. Soporta `permisosAlt` para items
  visibles con cualquiera de N permisos (ej: `/compras` se ve con
  `compras`, `pedidos` o `recepcion`). Los datos del menú viven en
  `lib/config/navegacion.ts` (ver "Menú por pilares").
- **RLS real (migración 047+)**: las tablas sensibles dejaron de ser
  `using(true)`. Ahora están gateadas por permiso vía
  `fn_tiene_permiso(clave)` (que lee `usuarios.rol` + `roles.permisos`;
  **admin = acceso total** hardcodeado). Gateadas: finanzas (cuentas,
  movimientos_cuenta, cuentas_a_pagar, acreditaciones, arqueos, remesas,
  extractos), contabilidad (asientos, plan_cuentas, activos), rrhh
  (empleados, liquidaciones, sueldos, ctacte), costos (`costos_producto`).
  `egresos`/`sangrias`: el cajero ve solo los de su turno. Los RPCs son
  `security definer` → **bypassean RLS**, así que el POS/anular/recepción
  no se afectan. Desde la mig 218, `caja_turnos`, `ventas`, `items_venta` y
  `pagos_venta` son **solo SELECT** para authenticated: toda escritura pasa
  por RPC (`fn_abrir_turno`, `fn_cerrar_turno`, `fn_crear_venta`, …).
- **Roles del mostrador y compras (oct-2026)**: cajero y fiambrero ven lo
  propio de Personal con `mi_panel`, no `rrhh` (mig 256, D8). El permiso
  `proveedores` (mig 257, D9) abre solo `/configuracion/proveedores` y el
  catálogo `proveedor_producto` a quien compra sin `configuracion` (que
  además abre usuarios y datos fiscales); todo rol con `configuracion` lo
  tiene. La ficha `proveedores` la lee cualquier sesión y la escriben solo
  `compras`, `pedidos`, `configuracion`, `proveedores` o `finanzas` (mig 258).

**Para agregar una ruta protegida nueva:** sumar la clave a `PERMISOS` en
`lib/permisos.ts`, agregar el prefijo a `PERMISO_RUTA` en `middleware.ts`,
asignarla a roles en la tabla `roles` y, si va en el menú, sumarla en
`lib/config/navegacion.ts` y en `FOTO_MENU_OCT_2026` del test.

### Menú por pilares (oct-2026)

`lib/config/navegacion.ts` tiene los dos menús como datos puros (íconos por
nombre, sin imports con alias) y `Sidebar.tsx` solo los dibuja:
- `MENU_SEIS_PILARES`: arriba sin título Inicio, Mi panel, Mis tareas, Mi pase
  de turno y Mi agenda; después **Resultados** (Tablero del dueño, Reportes),
  **Operaciones** (Turnos y equipo = `/rrhh`, Alertas, Producción, Tableros de
  tareas — oculto por ahora con `MOSTRAR_TABLEROS_TAREAS = false`; la ruta
  `/proyectos` sigue andando), **Ventas** (Punto de venta, Historial de ventas, Clientes y cuentas corrientes),
  **Compras** (Compras + atajo a `/configuracion/proveedores`), **Stock**
  (Stock, Conteo físico, Vencimientos, Mapa, Etiquetas) y **Finanzas**
  (Finanzas y tesorería, Cobros con posnet = `/terminales`, Contabilidad); al
  pie Modo móvil y Configuración.
- `MENU_ANTERIOR`: el menú hasta oct-2026, intacto. `MENU_PILARES = false`
  vuelve a él sin tocar nada más.
- Las rutas y los permisos son los mismos en los dos (el único agregado es el
  atajo a Proveedores, que ve quien tiene `configuracion` o el permiso
  `proveedores`, mig 257).
  `lib/config/navegacion.test.ts` (`npm test`) lo verifica contra una foto
  del menú anterior y por rol.
- `<Sidebar variante="hoja">` es el que va dentro del menú hamburguesa del
  Header (la variante fija está oculta por debajo de `md`).
- Las decisiones del dueño (2026-10-13) están en el plan
  `pasted-content-id-ff5d-revis-hex-v1-zesty-token.md` y en la página
  "Pilares de navegación HEX".

### Modo offline (solo POS)

`lib/offline/`:
- `db.ts` — schema IndexedDB con `idb`
- `cola.ts` — encola ventas cuando hay error de red (`encolarVenta`)
- `sync.ts` — reenvía cuando vuelve la conexión (`esErrorDeRed` detecta
  network errors)
- `catalogo.ts` — cachea el catálogo de productos para búsqueda offline

Las ventas pasan por `crearVenta` en `lib/queries/ventas.ts` que chequea
`navigator.onLine` y cae a la cola. Las encoladas vuelven como
`pendiente: true` para que el POS pueda imprimir el ticket igual.

### Migraciones de DB

Viven en `supabase/migrations/` numeradas secuencialmente (`044_xxx.sql`).
**No hay migration runner en el repo** — se corren a mano desde el SQL
Editor de Supabase o `supabase db push`. **Nunca modificar una migración
existente**, siempre crear una nueva.

Tipos en `types/database.ts` se mantienen **a mano** (no auto-generados).
Usar `type` aliases (no `interface`) e incluir las keys `Relationships` y
`CompositeTypes` para evitar `never[]` con `@supabase/supabase-js` v2.105+.

---

## Módulos del sistema

### 1. POS (`/pos`) — punto de venta
Búsqueda + grid de frecuentes, carrito con +/- y **cantidad editable a mano**
(input directo, clampea al stock), cobro multi-medio (efectivo con vuelto,
débito/crédito/transferencia, terminal Mercado Pago, venta por peso),
apertura/cierre de caja con conteo de billetes, **sangrías** (retiros a caja
fuerte que descuentan del cierre), gastos del turno, selector de cliente,
atajos F1–F12, modo offline. La venta crea asiento contable automático.

**Cobro con terminal MP Point (`ModalCobroTerminal`):** el cajero elige solo
el **canal** (Tarjeta/Point o QR) con un toggle; NO elige la forma de pago.
Al aprobarse la orden, MP devuelve `payment_method.type/id` y el sistema
auto-detecta el medio exacto vía `matchMedioPagoPorMP` (filtra por canal +
type, resuelve ambigüedad débito Point vs QR), registrando con la **comisión
real** de ese método. Ver "Medios de pago y comisiones MP" abajo.

**Devoluciones** (permiso `devoluciones`): se busca la venta original, se
eligen items y cantidades, cada uno va **a stock** (repone) o **merma** (se
da de baja). Reembolso por **efectivo** (egreso del turno) o **reverso a
tarjeta** (ajusta/cancela las acreditaciones pendientes de esa venta).
Genera contra-asiento y comprobante térmico. RPC `fn_crear_devolucion`.
*(La nota de crédito existe en el schema pero se quitó de la UI.)*

### 2. Ventas (`/ventas`)
Listado con filtros, drawer de detalle, anulación con asiento contable
inverso.

### 3. Clientes (`/clientes`) — CRM
ABM + historial de compras.

### 4. Inventario (`/inventario`)
- **Stock** (`/inventario`): vista operativa pura — panel de alertas (KPIs
  clickeables), filtros (búsqueda, categoría, proveedor, estado, orden),
  tabla con acciones (ver detalle, etiqueta, ajustar). Detalle por producto
  con gráfico de evolución 30 días e historial paginado
- **Control de stock** (`/inventario/control`): operaciones de control en
  tabs — Ajustes (formulario + historial, gated con `inventario_ajustes`) y
  Movimientos (historial global con filtros y export CSV).
  `/inventario/movimientos` redirige acá. La pestaña Conteo (flujo viejo de
  `conteos`/`conteos_items`: asignar/contar/aprobar) está escondida desde
  oct-2026 (D7, `MOSTRAR_CONTEOS_ASIGNADOS = false` en
  `lib/config/inventario.ts`), igual que "Conteos asignados" del celular y la
  tarjeta "Conteos por aprobar": se cuenta con el Conteo físico por zonas
  (`/inventario/conteo`). Las tablas quedan; el Conteo rápido del celular no
  cambia
- **Clasificación ABC** (`/inventario/clasificacion-abc`): análisis Pareto
  por ingresos
- ABM de productos vive en `/configuracion/productos` — no es parte
  del módulo operativo de stock

### 5. Vencimientos (`/vencimientos`)
Semáforo verde/amarillo/rojo por lote, baja con merma automática,
vencimiento mínimo configurable.

### 6. **Compras (`/compras`) — módulo unificado**
Hub con 4 tabs según permisos:
- **Reposición**: sugerido de stock bajo + cotización Excel/PDF + borrador
- **Órdenes**: lista + crear OC (absorbe `/pedidos` legacy)
- **Recepción**: escaneo guiado, recepción parcial, **clave de supervisor**
  para excesos, alerta de variación de costo (absorbe `/recepcion` legacy)
- **Costos**: monitor de variación de costos + umbral configurable

**Three-way match (Opción B):** la recepción crea una cuenta a pagar
**provisoria** (`provisoria=true`, `tiene_factura=false`). Al cargar la
factura, se ajusta al monto real y se cierra el match. Si nunca se carga
factura, la deuda queda registrada con el monto estimado de la recepción.

**Catálogo N:M proveedor↔producto** (`proveedor_producto`): un producto
puede comprarse a varios proveedores con costos y códigos distintos.

**Compra directa (sin orden, pagada al instante)** — migs 121+122,
`fn_registrar_compra_directa`. Botón "Compra directa" en el POS
(`ModalCompraFactura` contexto pos, pago con el efectivo del turno) y en
Compras › Facturas (contexto finanzas, pago desde una cuenta). Toggle
"¿mueve stock?": con stock crea `items_factura_compra` con producto +
entrada de stock/costo/precio (como recepción); sin stock, una línea
`producto_id NULL` + `descripcion` (para el Libro IVA). NO crea cuenta a
pagar (se paga en el acto). Categoría del egreso `compra_mercaderia`
(excluida del P&L: va a Mercadería/CMV). Gateada por permiso `compras`.
Anulación `fn_anular_compra_directa` (repone stock, revierte pago y asiento).
Requisito: `cuentas_a_pagar.pedido_id` y `items_factura_compra.producto_id`
pasaron a nullable (mig 121).

### 7. Etiquetas (`/etiquetas`)
Generación e impresión de etiquetas de precio masivo.

### 8. **Finanzas y Tesorería (`/finanzas`) — unificado**
Tabs:
- **Tablero (directivo)**: centro de mando solo-lectura — resultado del
  período (ventas − CMV − mermas − egresos − comisiones − IIBB; las
  comisiones y el IIBB salen de `movimientos_cuenta`, no de `egresos`),
  posición de caja, capital inmovilizado en inventario (a costo), por
  cobrar, flujo del período, deudas corto plazo (7/15/30 días),
  comisiones, diferencias de arqueo
- **Caja fuerte (CANDADO, migs 118+119)**: la cuenta **"Caja Efectivo" ES la
  caja fuerte** (`cuentas.es_caja_fuerte`, única, resuelta por
  `fn_cuenta_caja_fuerte()`). Flujo duro: venta → caja POS → cierre (control
  cajero) → buzón (`sangrias`) → **control administrativo** (`fn_validar_arqueo`
  v3, que ACREDITA la cuenta con el monto físico verificado) → Caja Efectivo.
  La venta en efectivo **NO acredita** ninguna cuenta:
  `medios_pago('efectivo').cuenta_id = NULL`, blindado por el trigger
  `trg_guard_medio_cuenta` (re-nulifica aunque la UI intente setearlo).
  `fn_generar_remesa` v3 = transferencia real bóveda→banco;
  `fn_registrar_mov_caja_fuerte` v2 mueve también la cuenta (guard de negativo
  sobre el saldo real). `getSaldoCajaFuerte` LEE `saldo_actual` (fuente única)
  y expone `descuadre` (cuenta vs. circuito; ≠0 = banner rojo). El buzón
  ("Por contar") queda aparte. Control de diferencias con período local: por
  empleado (cierres) + control del buzón (arqueos). Remesas ocultas tras
  `MOSTRAR_REMESAS` (`lib/config/tesoreria.ts`). DrawerCuenta no permite
  editar saldo/tipo/activo de la bóveda
- **Por cobrar (Clearing digital)**: acreditaciones pendientes de ventas
  con tarjeta/MP. Cada medio de pago tiene `dias_acreditacion` y
  `comision_porcentaje`. Las ventas con plazo > 0 generan una
  `acreditacion` pendiente en vez de impactar el saldo; se acredita (manual
  o al conciliar) y la plata neta entra al banco
- **Cuentas**: cuentas bancarias / billeteras / caja con saldos. Cada cuenta
  tiene `retencion_iibb_porcentaje` (ej: MP retiene 3% IIBB La Rioja): se
  descuenta del saldo en cada ingreso (venta inmediata o acreditación),
  registrando un movimiento aparte con categoría `iibb`. Configurable en
  `DrawerCuenta`. La config de medios de pago vive al final de esta tab
  (`ConfiguracionCobros`) — ver "Medios de pago y comisiones MP" abajo
- **Movimientos**: filtros por cuenta/tipo/categoría
- **Cuentas a pagar**: deudas a proveedores con `provisoria` /
  `tiene_factura`
- **Egresos**: gastos categorizados. El egreso de Finanzas **debita una
  cuenta de pago** elegida (`fn_crear_egreso` v2, mig 120): baja
  `cuentas.saldo_actual` + `movimientos_cuenta` + Haber por tipo; guard de
  negativo solo para la bóveda. **Regla de oro:** un egreso con `turno_id`
  (gasto del POS) NUNCA debita cuenta (ya se descuenta en el cierre →
  doble conteo). Anulación por `fn_anular_egreso` (repone saldo + revierte
  asiento). Los pagos desde la bóveda entran al circuito de
  `getSaldoCajaFuerte` (referencia_tipo egreso/cuenta_a_pagar) para no
  disparar descuadre falso

Sidebar: pilar **"Finanzas"** agrupa Finanzas y tesorería, Cobros con posnet
(`/terminales`) y Contabilidad.

#### Medios de pago y comisiones MP (cross-cutting POS ↔ Finanzas)

Tabla `medios_pago` (dinámica, ver `lib/queries/mediosPago.ts` +
`useMediosPago`). Campos clave:
- `activo` → aparece en el modal de cobro manual del POS
- `disponible_terminal` → aparece en el flujo de cobro con posnet
  (`ModalCobroTerminal`). **Flags independientes**: un medio puede estar en
  uno, ambos o ninguno
- `comision_porcentaje` → comisión del medio, **con IVA incluido** (las tasas
  públicas de MP NO incluyen IVA → cargar `tasa × 1.21`). Se descuenta como
  egreso categoría `comisiones` al vender
- `mp_payment_type` / `mp_payment_method_id` → mapeo a lo que devuelve la API
  de MP Point (`account_money`, `debit_card`, `credit_card`, `prepaid_card`;
  id como `visa`, `master`, etc. — NULL = wildcard del type)
- `mp_channel` (`'point' | 'qr' | null`) → desambigua medios con mismo
  `payment_type` pero distinta comisión. **Caso crítico:** la API devuelve
  `debit_card` igual para Point (3.74%) y QR (1.69%); el cajero elige el
  canal en el toggle del modal y eso resuelve cuál aplica. `null` = sirve
  para ambos canales (crédito y prepaga tienen igual tasa en los dos)

**Auto-detección** (`matchMedioPagoPorMP`): al aprobarse la orden, filtra por
type → por canal (prefiere específicos sobre agnósticos) → por method_id. Si
queda un único candidato, ese se registra (con su comisión real); si hay
ambigüedad o MP no devolvió datos, cae al medio default del canal. El cajero
**no elige forma de pago**, solo el canal.

Seed real del comercio (La Rioja, acreditación al instante, con IVA): códigos
`mp2_*` — QR cuenta 0.97%, débito Point 3.74%, débito QR 1.69%, crédito 7.48%,
prepaga 4.69%, QR cuotas 1.68%. Migraciones 055–059 (la 058 `retencion_iibb`
reescribe `fn_crear_venta` v6 + `fn_acreditar_pago` v3 **sobre la base v5 que
usa `fn_costo`** — no vuelve a `productos.precio_costo`, agrega el egreso IIBB).
Ajustar tasas desde la UI, no por código.

### 9. Contabilidad (`/contabilidad`)
Plan de cuentas jerárquico, libro diario (asientos automáticos + manuales),
conciliaciones, activos fijos con depreciación, impuestos, y
**Cierre y auditoría**: candar meses (`periodos_contables`) — con un mes
cerrado `fn_anular_venta` y `fn_guardar_factura_compra` rechazan operar
sobre ese período; + log de **auditoría** (anulaciones, arqueos, remesas,
cierres) con usuario, fecha e IP. Solo admin cierra/reabre.

Las dos conciliaciones viven acá (movidas de Finanzas en 2026-07):
- **Conciliar Mercado Pago** (`TabConciliacionMP`): importa el
  reporte/extracto de MP (CSV/Excel, parser con auto-detección de columnas),
  cruza contra acreditaciones pendientes (las acredita) y movimientos no
  conciliados, marca anomalías. RPC `fn_aplicar_conciliacion`. Tablas
  `extractos_bancarios`, `lineas_extracto`
- **Conciliar banco** (`TabConciliacion`): tilde manual de movimientos por
  cuenta contra el saldo del extracto

### 10. Personal (`/rrhh`) — hub único de RRHH
Una sola entrada de sidebar ("Turnos y equipo", pilar Operaciones) con
pestañas por `?tab=`:
**Hoy** (`TableroRrhh`: `fn_dashboard_rrhh` + `fn_dashboard_disciplina`),
**Equipo** (empleados, organigrama por `empleados.rol_operativo` /
`reporta_a`, desempeño), **Cronograma** (grilla de turnos y fichajes),
**Tareas** (`tareas_gestion`), **Incidencias**, **Pase de turno** y
**Sueldos** (solo `rrhh_sueldos`: novedades, liquidaciones, cta. cte.).
`/rrhh/dashboard`, `/rrhh/asistencia` y `/rrhh/tareas` redirigen al tab.

- **Incidencias** (migs 230–231, Manual §8): hecho objetivo por empleado y
  tipología (`tipologias_incidencia`). `fn_registrar_incidencia` calcula la
  **instancia** por reincidencia de la misma tipología en 30 días (1ª
  corrección, 2ª observación formal, 3ª escalada; grave = escalada
  inmediata). Alta solo por RPC; el empleado ve las propias en Mi panel.
- **Sanciones formales** (mig 232, estatuto art. 13): permiso
  `rrhh_sanciones` (solo admin por defecto). `fn_aplicar_sancion` exige días
  (1–30) para suspensión y acta para suspensión/exclusión; el llamado de
  atención no va al legajo (`va_al_legajo`). Viven en Ficha › Legajo
  disciplinario.
- **Pase de turno** (migs 233–234, Manual §6.6): `pases_turno`, un registro
  por (fecha, turno saliente). `fn_entregar_pase_turno` exige los 3 bloques
  de texto y pendientes con responsable; `fn_recibir_pase_turno` marca los 4
  conformes y exige observaciones si hay no conforme. El saliente/entrante
  es `fn_mi_empleado_id()` salvo que tenga `rrhh`. Pantalla del empleado en
  `/rrhh/pase-turno` y `/movil/pase-turno`.
- **Generador de cronograma** (migs 236–237, 239–240): `patrones_cronograma` +
  miembros ordenados. Dos tipos: `franco_rotativo` (N personas, N slots de
  franco por semana en `orden_dias` (posiciones 0..6 desde el ancla, en el
  orden en que rota); `lista[(slot − semana) mod N]`; los días fuera de
  `orden_dias` nadie descansa; el pivote cubre el turno del que descansa con
  nota "Cubre a X"), `noche_ab` (2 personas, ciclo 14 días, ancla lunes) y
  `bloques_alternados` (migs 246–247: N personas se turnan en bloques de
  `bloque_dias` días corridos desde el ancla; es la noche real: 7 días de
  jueves a miércoles).
  `fecha_ancla` = primer día de la semana 1. El patrón real desde jul-2026
  (mig 241): ancla domingo, `{0,1,3,2,4,6}` (viernes local lleno).
- **Checklists diarios por puesto** (migs 243, 248–250): los 30 ítems de la
  planilla (mañana 13, tarde 10, noche 7) como `tareas_recurrentes` todos los
  días con `alcance='puesto'` + `roles_puesto` (rol_operativo). Cada día
  `fn_asignados_tareas_dia(fecha)` resuelve quién la hace contra
  `horarios_asignados`: los planificados en el turno con ese rol; si el rol
  falta, UNA persona del turno (pivote → encargado → resp. general → resto)
  con `notas='Cubre a X'`; si el turno está vacío, el asignado fijo / alguien
  del rol / el resp. general con `notas='Sin cronograma…'`. **Nunca queda sin
  dueño.** `alcance='empleados'/'todos'` conserva la regla v3 (franco/licencia
  se omite salvo pivote del patrón). `fn_materializar_tareas_turno` v4 (mig
  250) **sincroniza** en cada llamada (cron 06:00, apertura del tablero / Mis
  tareas, botón "Actualizar según cronograma" en Tareas › Agenda del día): borra las
  pendientes vírgenes de quien ya no corresponde, crea las que faltan y
  reconcilia participantes de las grupales; lo completado, en curso,
  rechazado o `tareas_turno.fijada` (responsable cambiado a mano) no se toca.
- **Puestos reales (mig 254, oct-2026)**: los valores de `rol_operativo` no cambian,
  solo las etiquetas (`ROLES_OPERATIVOS`): `responsable_general` = Encargada de
  Sucursal (Sonia), `encargado` = Encargado/a de Turno (Rebeca), `cajero` (Camila,
  Juan Ignacio, Fabricio), `fiambreria` = Fiambrero/Producción (Tomas, Agustin),
  `pivote` = Pivot (Matias), `compras` (Fernanda). Todos reportan a Sonia salvo
  Sonia y Fernanda, que reportan a Dirección (Rodrigo). La seed matchea por
  nombre + apellido; no volver a sembrar por primer nombre.
- **Cronograma: Planificación / Fichadas (mig 255, oct-2026)**: la pestaña
  (`PantallaAsistencia.tsx`) tiene dos vistas sobre la misma grilla semanal
  (`GrillaCronograma.tsx`, lógica pura en `cronogramaCalculos.ts`). **Planificación**
  muestra solo `horarios_asignados` (turno con nombre y horas, franco, licencia,
  "sin asignar", "Cubre a X" leído de `notas` con la convención de la 247) y el panel
  de cobertura del día seleccionado contra `dotacion_requerida` (turno × día de
  semana, null = todos; sin filas = "sin configurar", nunca se inventan mínimos).
  **Fichadas** deriva el estado en cliente (`estadoFichada`): un día pasado sin
  marcaciones es "Ausente" SOLO si la última importación del reloj
  (`importaciones_fichajes` completada con `dias_recalculados > 0`) cubre esa fecha;
  si no, "Revisar fichada". Futuro = "Programado". Editar una celda (Sheet
  `PanelAsignacion`) escribe como manual (`patron_id null`, `usuario_id`) y después
  `sincronizarPlan`: si el día ya pasó llama `fn_recalcular_asistencia_empleado`
  (D y D+1; el cron solo cierra planificados y dejaba "ausente" un cambio a franco) y
  si cae en [hoy−1, hoy+7] re-materializa las tareas (no bloqueante). "Copiar semana
  anterior" previsualiza, no pisa por defecto y no copia notas "Cubre a…". Horas por
  empleado = brutas planificadas (la noche cuenta en el día en que empieza). El route
  de importar reloj gatea por permiso `rrhh` (antes por rol).
- **Agenda por turno** (migs 251–253): Tareas ya no es un kanban por estado
  sino una agenda cronológica por turno (`AgendaTurnos.tsx`, lógica pura en
  `tareasAgenda.ts`). `tareas_recurrentes` y `tareas_turno` tienen `hora`
  (NULL = "durante el turno"), `duracion_min`, `ventana_min`, `tipo_actividad`
  (`puntual` | `continua` = banner sin completar | `bloque` = descanso/pase) y
  `checklist`; la plantilla además `minutos_desde_inicio` (alternativa a la
  hora fija: la materialización resuelve `hora_inicio` del turno + minutos).
  **`tareas_turno.fecha` = día en que EMPIEZA el turno**: la agenda del día D
  consulta `fecha in (D−1, D)` y muestra la cola de la noche de D−1 en la
  franja 00:00–hora_fin. `fn_materializar_tareas_turno` v5 (mig 252) copia el
  horario y, paso 2b, aplica los cambios de la rutina a las pendientes
  vírgenes con `fecha ≥ vigencia_desde` ("Aplicar cambios desde" en el modal).
  "Atrasada" es un estado derivado en cliente (`hora + ventana < ahora AR`),
  el enum `estado` no cambia. Acciones por RPC (mig 253, misma regla de
  permiso que `fn_completar_tarea`): `fn_iniciar_tarea` (registra
  `iniciada_por/at`), `fn_omitir_tarea(id, motivo)` (→ cancelada, no cuenta en
  cumplimiento), `fn_trasladar_tarea(id)` (nueva instancia en el turno
  siguiente —día +1 si cruza medianoche— con `trasladada_de`, original
  cancelada con `trasladada_a`, auditada) y `fn_reabrir_tarea` (solo gestión).
  `fn_marcar_tareas_vencidas` v2 no vence la noche de ayer mientras su
  `hora_fin` no pasó. Los horarios de turno se editan en Configurar rutina ›
  Horarios de turno (`EditorTurnos.tsx`, `turnos_plantilla`, permiso `rrhh`);
  `mi_panel` lee `turnos_plantilla` para la agenda del empleado. Las
  incidencias siguen requiriendo `rrhh`: el empleado registra un impedimento
  con "Omitir con motivo"; gestión abre `ModalIncidencia` prellenado con la
  tarea.
  `fn_generar_cronograma(patron, desde, hasta,
  sobrescribir, aplicar)` es **parcial**: solo llena celdas vacías; con
  `sobrescribir` reemplaza solo filas con el mismo `horarios_asignados.patron_id`
  (nunca lo manual). `aplicar=false` = previsualización. UI en Cronograma ›
  Patrones / Generar.

### 11. Reportes (`/reportes`)
Ventas, top productos, rotación, mermas, export PDF.

### 12. Tableros de tareas y Mi agenda (`/proyectos`, `/agenda`)
Kanban con subtareas, tareas recurrentes, "Mi día".

### 13. Terminales (`/terminales`)
Mercado Pago Point: ABM de dispositivos, cobro integrado desde POS.

### 14. Configuración (`/configuracion`)
ABM de productos (con importación Excel), categorías, proveedores (con
catálogo N:M), usuarios y roles con matriz de permisos.

### 15. Tienda online (`/tienda`) — público, sin login
Mobile-first (max-w-lg). Catálogo, carrito en localStorage, checkout
(retiro/delivery), confirmado con código de pedido. Validación server-side
de precios y stock. Tablas: `pedidos_tienda`, `items_pedido_tienda`.

---

## Convenciones críticas

- **Idioma**: todo en español argentino. Variables, comentarios y UI.
- **Fechas**: `date-fns` con locale `es`. Utilities en
  `lib/utils/formato.ts`.
- **Moneda**: `Intl.NumberFormat('es-AR', { style: 'currency', currency:
  'ARS' })`. Usar el componente `<MontoARS monto={n} />`.
- **`"use client"`**: solo cuando hay state, effects o event handlers.
  Layouts y páginas de display son Server Components por defecto.
- **shadcn `<Button>` sin `asChild`**: este build usa `@base-ui/react` bajo
  shadcn, **no soporta `asChild`**. Usar `buttonVariants()` + un `<Link>`
  común como wrapper.
- **`<Select>` con `items` prop**: el Select local de shadcn acepta `items`
  prop (`Record<string, string>`) como shorthand, además del patrón
  estándar con `<SelectItem>` children.
- **Toasts**: importar `toast` desde `sonner`. Mostrar success/error desde
  los callbacks `onSuccess`/`onError` del **hook**, no del componente.
- **Precio de costo**: ⚠️ `precio_costo` **ya NO es columna de `productos`**
  (migración 052). Vive en la tabla gateada `costos_producto`, oculta a los
  cajeros por RLS. Las queries lo leen vía embed `costos_producto(precio_costo)`
  y lo mapean con `costoDesdeEmbed()` (en `lib/queries/productos.ts`) — para
  un cajero el embed viene null → costo 0. Las escrituras (`createProducto`,
  `updateProducto`, importación) hacen upsert en `costos_producto`, no en
  productos. En los RPCs se usa `fn_costo()` / `fn_set_costo()`.
- **Posición de caja ("cuánta plata hay")**: usar SIEMPRE `getPosicionCaja()`
  de `lib/queries/posicionCaja.ts` (la consumen Tablero, Cuentas y Flujo
  proyectado). Desde el **candado** (mig 118) la cuenta "Caja Efectivo" es la
  caja fuerte con saldo REAL: se acredita solo al validar arqueos, los
  movimientos manuales la mueven y las remesas la debitan de verdad. **Ya NO
  se resta lo remesado en ningún lado** (hacerlo lo contaría dos veces). El
  saldo de la bóveda se lee de `cuentas.saldo_actual` (fuente única) — el
  circuito (`Σ arqueos + Σ manuales − Σ remesas`) sirve solo de contraste vía
  `descuadre` en `getSaldoCajaFuerte`. Nunca editar `saldo_actual` de la
  bóveda a mano.
- **Columnas `date` vs. rango del período**: `egresos.fecha`,
  `movimientos_cuenta.fecha` y `arqueos_tesoreria.fecha` son `date`.
  Filtrarlas contra el ISO del período (o su `.slice(0,10)`) usa la fecha
  UTC y arrastra un día de más al final del rango: usar `fechaLocal()` de
  `lib/utils/periodos.ts`. Las columnas timestamptz (`ventas.fecha`) van
  con el ISO completo.
- **Combos / packs (migración 112)**: un producto `tipo='combo'` tiene sus
  componentes en `producto_componentes` (sin anidamiento, trigger lo valida).
  Al vender, `fn_crear_venta` descuenta stock/lotes/CMV de los COMPONENTES
  (no del combo); anulación y devolución los reponen. La detección en los
  RPCs es por EXISTENCIA de componentes, no por `tipo`. El `stock_actual`
  que devuelven las queries de productos para un combo es **virtual**
  (mínimo armable, `stockVirtualCombo()`); el real queda en 0 y el drawer lo
  fuerza a 0 al guardar — no escribirle stock a un combo.

---

## Gotchas y patrones de Postgres / Supabase

### Enums vs. text
Varias columnas del schema viejo son enums (`estado_pedido`, `estado_lote`,
`estado_venta`, `tipo_movimiento`, etc.). Al asignar text desde una RPC en
plpgsql, **castear explícitamente**: `'recibido'::public.estado_pedido`.

### `fn_crear_venta` recibe 8 argumentos (v14, mig 218)
Firma actual: `(p_turno_id integer, p_usuario_id uuid, p_pagos jsonb,
p_items jsonb, p_cliente_uuid uuid default null, p_cliente_id integer
default null, p_forzar_turno boolean default false, p_fecha timestamptz
default null)`. Si tocás esta función, partí de la 218 y no rompas la firma
o se cae el POS (y dropeá la firma vieja: ver "CREATE OR REPLACE").

### Identidad: la pone la sesión, la base la exige (mig 218)
El POS arma la pantalla con el usuario del SSR, pero **la base solo acepta
escrituras de caja a nombre de `auth.uid()`**: `fn_crear_venta` rechaza
`p_usuario_id ≠ auth.uid()` (`SESION_CAMBIO:`) y turnos ajenos
(`TURNO_AJENO:`); el trigger `trg_control_identidad` hace lo mismo en
`ventas`, `egresos`, `sangrias`, `devoluciones` y `cuenta_corriente_*` con
`turno_id`. Finanzas (admin incluido) puede operar sobre turnos ajenos
(cierre administrativo, replay de la cola offline). `service_role` y las
llamadas sin JWT (SQL Editor, clonado) confían en los parámetros. Abrir y
cerrar turno va por `fn_abrir_turno` / `fn_cerrar_turno` (un solo turno
abierto por usuario, índice único parcial). Desde la 219/220, `fn_anular_venta`,
`fn_crear_egreso`, `fn_anular_egreso`, `fn_crear_devolucion` y
`fn_cobrar_cta_cte` reemplazan `p_usuario_id` por `fn_usuario_efectivo()`
y exigen permisos en el servidor (`ventas_anular`; `pos_gasto` o
`devoluciones` + turno propio y abierto; cobro de fiado en caja contra el
turno propio y abierto; `finanzas` para operar sin turno o sobre turno ajeno).
**Al reemitir una RPC que recibe `p_usuario_id`, hacé lo mismo.** En el cliente,
`GuardianSesion` recarga la pantalla si la sesión del navegador cambia, los
hooks del POS usan `manejarErrorIdentidad()` y **`signOut` siempre con
`scope: 'local'`** (el global tumbaba la sesión de la PC del mostrador desde
el celular). Cerrar caja en el POS cierra la sesión de esa PC.

### CREATE OR REPLACE no pisa firmas distintas
Si la función actual difiere en un argumento (orden, default, tipo),
Postgres crea una nueva en lugar de reemplazar. Hay que **dropearla**
primero por nombre solo (`drop function public.fn_xxx`) y crearla limpia.
PostgREST cachea firmas y devuelve "Could not find function ... in the
schema cache" si hay desalineación con el cliente.

### `notify pgrst, 'reload schema'`
Toda migración debe terminar con esto para que PostgREST recargue el
schema cache. Si después de correr una migración el cliente sigue viendo
firmas viejas, falta este `notify`.

### Tipos `database.ts`
Mantener `Database` con `Tables`, `Functions`, `Enums` y `CompositeTypes`
(aunque `CompositeTypes` esté vacío). Sin ellas, `supabase-js` v2.105+
devuelve `never[]`. Toda tabla nueva debe registrarse en `Tables` o
`supabase.from('x')` no compila.

### RLS: borrar policies viejas antes de gatear
RLS combina policies permissive con **OR**. Si dejás la vieja `using(true)`
y agregás una restrictiva, todos pasan igual por la vieja. Hay que
**dropear todas las policies** de la tabla antes de crear la gateada.

### RLS: fn_tiene_permiso siempre envuelta en (select ...)
Postgres no inlinea plpgsql: `using (fn_tiene_permiso('x'))` se evalúa
**por fila** (y adentro hace 2 selects). En policies nuevas escribir
siempre `using ((select public.fn_tiene_permiso('x')))` → InitPlan, una
evaluación por query. La migración 111 reescribió todas las existentes;
no crear policies nuevas con la llamada desnuda.

### Auditar funciones duplicadas (chequeo T1)
Después de reissuear RPCs, correr:
`select proname, count(*) from pg_proc p join pg_namespace n on
n.oid=p.pronamespace where n.nspname='public' and proname like 'fn_%'
group by proname having count(*)>1;` — debe dar 0 filas.

### Reissue de RPCs: el costo y los enums
Al reescribir una función que toca el costo, leer con `fn_costo(id)` y
escribir con `fn_set_costo(id, costo)` (no `productos.precio_costo`). Al
insertar en `movimientos_stock.tipo` desde una **variable** text, castear
`v_tipo::public.tipo_movimiento` (los literales `'venta'` castean solos,
las variables no).

### shadcn Button + Link
`<Button asChild><Link/></Button>` **no funciona** acá. Patrón correcto:

```tsx
<Link href="/x" className={cn(buttonVariants({ variant: 'default' }), 'extra-classes')}>
  Texto
</Link>
```

---

## Flujo de trabajo

1. Cambio en código → `npm run build` para verificar TypeScript
2. Si la feature toca DB → crear migración numerada en
   `supabase/migrations/NNN_descripcion.sql`
3. Pasarle la migración al usuario para que la corra en SQL Editor de
   Supabase (no hay runner automático)
4. Actualizar `types/database.ts` a mano con los tipos nuevos
5. Commit + push a `main` → Vercel deploya solo

**Nunca skippear hooks de git** ni hacer `--no-verify` sin pedirlo
explícitamente. Siempre crear commits nuevos en lugar de hacer `--amend`.

---

## Estado del proyecto

Migraciones numeradas hasta la 113, ~320 archivos fuente, deploy en Vercel:
`hola-express2004.vercel.app`.

Módulos completos: POS (con offline + **devoluciones**), Ventas, Clientes,
Inventario (con movimientos y ABC), Vencimientos, **Compras unificado**
(3-way match, catálogo N:M, monitor de costos, escaneo, supervisor),
Etiquetas, **Finanzas y Tesorería** (Tablero directivo, Caja Fuerte,
Clearing Digital, P&L, cuentas, egresos),
Contabilidad (asientos automáticos + conciliaciones banco/MP + **cierre de
período y auditoría**),
RRHH, Reportes, Proyectos, Terminales MP, Configuración, Tienda online.

Los 2 manuales operativos (Compras, Tesorería) están **implementados
completos**.

### Revisión integral R0–R5 (completada)
Se auditó el ERP y se corrigió por fases:
- **R0** Integridad: anular venta cancela acreditaciones + contra-asiento +
  repone lotes; comisiones de clearing se asientan como gasto (mig. 046)
- **R1.1** Seguridad: RLS real por permiso en tablas sensibles (mig. 047)
- **R1.2** Costo blindado: `precio_costo` movido a `costos_producto`
  gateada, en 4 partes (migs. 050–052)
- **R2** Devoluciones en POS (migs. 048–049)
- **R3** Tablero directivo (solo frontend)
- **R5** Cierre de período + auditoría (mig. 053)

**Backlog: vacío.** Próximas mejoras posibles (no críticas): devolución sin
ticket, notas de crédito de proveedor, multi-sucursal.
