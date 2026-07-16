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
`/clientes`, `/tableros`, `/proyectos`, `/agenda`, `/reportes`,
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
  `compras`, `pedidos` o `recepcion`).
- **RLS real (migración 047+)**: las tablas sensibles dejaron de ser
  `using(true)`. Ahora están gateadas por permiso vía
  `fn_tiene_permiso(clave)` (que lee `usuarios.rol` + `roles.permisos`;
  **admin = acceso total** hardcodeado). Gateadas: finanzas (cuentas,
  movimientos_cuenta, cuentas_a_pagar, acreditaciones, arqueos, remesas,
  extractos), contabilidad (asientos, plan_cuentas, activos), rrhh
  (empleados, liquidaciones, sueldos, ctacte), costos (`costos_producto`).
  `egresos`/`sangrias`: el cajero ve solo los de su turno. Los RPCs son
  `security definer` → **bypassean RLS**, así que el POS/anular/recepción
  no se afectan.

**Para agregar una ruta protegida nueva:** sumar la clave a `PERMISOS` en
`lib/permisos.ts`, agregar el prefijo a `PERMISO_RUTA` en `middleware.ts`,
asignarla a roles en la tabla `roles`.

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
  tabs — Conteo (asignar/contar/aprobar), Ajustes (formulario + historial,
  gated con `inventario_ajustes`), Movimientos (historial global con
  filtros y export CSV). `/inventario/movimientos` redirige acá
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
- **Caja fuerte**: KPIs (en buzón, en caja fuerte, arqueado, remesado),
  arqueo con nota de ajuste obligatoria si hay diferencia, generación de
  remesas que ingresan a la cuenta bancaria
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
- **Egresos**: gastos categorizados

Sidebar: sección **"Finanzas y Tesorería"** agrupa Finanzas + Contabilidad.

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

### 10. RRHH (`/rrhh`)
Empleados, novedades (horas extra, faltas, adelantos), liquidación de
sueldos, cuenta corriente de empleados.

### 11. Reportes (`/reportes`)
Ventas, top productos, rotación, mermas, export PDF.

### 12. Proyectos y Agenda (`/proyectos`, `/tableros`, `/agenda`)
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
  / `getTotalRemesado()` de `lib/queries/posicionCaja.ts` (los consumen
  Tablero, Cuentas, Caja fuerte y Flujo proyectado). La cuenta "Caja
  Efectivo" es un acumulado histórico — las remesas no la bajan — así que
  todo cálculo de disponible debe restar lo remesado vía ese helper, no
  re-derivarlo a mano. Cuando `fn_generar_remesa` descuente de Caja
  Efectivo (fix de fondo pendiente), la resta se elimina solo ahí.
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

### `fn_crear_venta` recibe 6 argumentos
Firma actual: `(p_turno_id integer, p_usuario_id uuid, p_pagos jsonb,
p_items jsonb, p_cliente_uuid uuid default null, p_cliente_id integer
default null)`. Si tocás esta función, no rompas la firma o se cae el POS.

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
