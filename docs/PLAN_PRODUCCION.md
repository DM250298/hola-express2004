# Plan de implementación — Módulo Producción (elaboración de comida)

> **Estado:** diseño cerrado y verificado por revisión adversarial. Listo para implementar.
> **Fecha:** 2026-06-09 · **Última migración del repo:** 074 → el módulo arranca en **075**.
> Este documento es la guía de ejecución. Cada fase tiene smoke tests; **no avanzar** si fallan.

---

## 0. Resumen y decisiones cerradas

Módulo nuevo `/produccion` para elaborar comida (sándwiches, empanadas, salsas) integrado con inventario, compras, finanzas y vencimientos **sin tocar el POS ni `fn_crear_venta`**.

Decisiones de diseño (no reabrir):

- **Semi-elaborado = un producto más** en `productos`. Taxonomía `productos.tipo` (text libre): `insumo | semi_elaborado | elaborado | reventa`.
- **Modelo de unidades = "unidad natural por producto"**: la unidad de stock es `productos.unidad` (kg/lt/unidad). Se agrega `productos.dimension` (`peso|volumen|conteo`) como guardarrail: **solo se convierte dentro de la misma dimensión** (kg↔g sí, kg↔unidad jamás). Factores físicos (1 kg = 1000 g) son **constantes en código y en una función SQL**, no una tabla. Se eligió base natural y no gramos/ml puros porque el cuello de botella real es la columna de costo (ver P1).
- **Modelo B (orden con proceso)**: al **iniciar** se descuentan insumos por **FEFO**; al **cerrar** se ingresa la cantidad **real** producida, se crea lote con vencimiento, se costea y se materializa con `fn_set_costo`. Se mide merma real.
- **Costeo solo insumos** (sin mano de obra). `fn_costo_receta` recursiva (semi-elaborados anidados) con anti-ciclo. El costo derivado se materializa al cerrar la orden (consistente con cómo se costea reventa hoy).
- **FEFO sin genealogía** lote-a-lote. **Una receta viva por producto** (`producto_id` UNIQUE) en el MVP.
- **Compra de insumos fraccionados habilitada** (completar la Fase 2 pendiente de la mig 062). **Sin factor de empaque** (compra == stock). **Sin microinsumos**.

---

## 1. Convenciones del repo a respetar

- **Stack:** Next.js 15 App Router, Supabase (PostgreSQL), TypeScript estricto (sin `any`), TanStack Query v5.
- **Layering:** `lib/queries/*` (acceso a datos + RPCs) → `lib/hooks/*` (TanStack Query, toasts e invalidaciones) → `components/*`.
- **Server Components por defecto**; `"use client"` solo con interactividad.
- **Idioma:** nombres, variables y comentarios en español.
- **Fechas** con `date-fns` locale `es-AR`; **moneda** `Intl.NumberFormat('es-AR', { style:'currency', currency:'ARS' })` (componente `MontoARS`).
- **Errores** con try/catch + toast (en los hooks). **Loading** con `SkeletonTabla`.
- **`types/database.ts` es hand-written**: toda tabla/RPC nueva debe registrarse en `Tables`/`Functions` o `supabase.from`/`rpc` devuelve `never[]` y no compila (supabase-js 2.105+, usar `type` aliases).
- **RLS** gateada por `fn_tiene_permiso('clave')`. UI gateada por permisos (Sidebar filtra, middleware protege ruta).
- **Cada migración** cierra con `notify pgrst, 'reload schema';`.
- **Red de seguridad de build:** `npm run build` (no hay linter ni test runner).

---

## 2. Orden de migraciones (075–082)

**Regla de oro:** orden numérico = orden de ejecución. El `ALTER TYPE` del enum va **aislado** y **antes** de las RPCs que lo usan (ADD VALUE no es usable en su misma transacción). Smoke test del circuito vivo entre cada migración de la Fase 0.

| Mig | Contenido | Fase |
|-----|-----------|------|
| **075** | `costos_producto.precio_costo` → `numeric(12,4)`; `movimientos_stock.stock_anterior/stock_nuevo` → `numeric(12,3)` | 0 |
| **076** | `items_pedido` + `conteos_items.cantidad_contada` → `numeric(12,3)`; reissue completo de `fn_recibir_pedido`, `fn_crear_devolucion`, `fn_aprobar_conteo` | 0 |
| **077** | Canonicalizar `productos.unidad` + agregar `productos.dimension` | 0 |
| **078** | `ALTER TYPE tipo_movimiento ADD VALUE` (`consumo_produccion`, `ingreso_produccion`) — **aislada** | 0 |
| **079** | 4 tablas + RLS + taxonomía `tipo` (default → `reventa` + check suave) | 1 |
| **080** | `fn_convertir_unidad` + `fn_costo_receta` (recursiva, anti-ciclo) | 2 |
| **081** | `fn_iniciar` / `fn_cerrar` / `fn_cancelar_orden_produccion` | 2 |
| **082** | Seed permiso `produccion` (admin/encargado) | 5 |

> Nota: el repo ya tiene números duplicados (062, 063). Igual usamos 075+ que está libre. Verificar con `ls supabase/migrations` antes de crear.

---

## 3. FASE 0 — Prerequisitos de base de datos

**Objetivo:** dejar la base apta para costeo multinivel y producción fraccionada con FEFO, arreglando además dos bugs latentes.

### Mig 075 — Ensanchar costo y saldos de movimientos

```sql
-- P1: prerequisito del costeo multinivel (sin esto el costo derivado trunca a centavos)
alter table public.costos_producto alter column precio_costo type numeric(12,4);

-- P2: arregla bug latente — fn_crear_venta v7 (mig 072) ya inserta numeric aquí
--     y Postgres redondea el saldo del historial en cada venta por peso.
alter table public.movimientos_stock alter column stock_anterior type numeric(12,3);
alter table public.movimientos_stock alter column stock_nuevo    type numeric(12,3);

notify pgrst, 'reload schema';
```

- `fn_costo` / `fn_set_costo` **no** requieren reissue (ya operan en numeric).
- **Verificado:** ninguna vista referencia esas columnas (`vista_cobertura_stock` usa `stock_actual` e `items_venta.cantidad`). No hay drop/recreate de vistas.
- **Aceptación:** `information_schema.columns` muestra `numeric 12 4` y `12 3`. Una venta por peso de `0.250 kg` deja `stock_anterior/stock_nuevo` con decimales en `movimientos_stock`.
- **Smoke test:** registrar una venta por peso → saldos con decimales + asiento CMV correcto.

### Mig 076 — items_pedido fraccionado + reissue completo (Fase 2 de mig 062)

```sql
alter table public.items_pedido   alter column cantidad_pedida   type numeric(12,3);
alter table public.items_pedido   alter column cantidad_recibida type numeric(12,3);
alter table public.conteos_items  alter column cantidad_contada  type numeric(12,3); -- HOY es integer
```

Reissue con `create or replace function` (firma **idéntica**, `language plpgsql security definer set search_path = public`), migrando **todas las variables internas** a `numeric` (no solo el cast de entrada):

- **`fn_recibir_pedido`** (vigente = mig 061): `v_cant`, `v_stock_ant`, `v_stock_nuevo`, `v_total_pedido`, `v_total_recibido_unid` → `numeric`; cast `(v_item->>'cantidad_recibida')::numeric`.
- **`fn_crear_devolucion`** (vigente = mig 071): `v_cant`, `v_vendida`, `v_ya_dev`, `v_stock_ant`, `v_stock_nuevo` → `numeric`; casts `::integer` → `::numeric`. **(corrección de la revisión: el draft lo omitía y truncaba devoluciones por peso).**
- **`fn_aprobar_conteo`** (vigente = mig 018): `v_stock_ant` → `numeric`.

```sql
notify pgrst, 'reload schema';
```

- **No reissuear** `fn_crear_ajuste_stock` (la vigente es la 062, ya usa `fn_costo`).
- **Aceptación:** recibir un pedido con `cantidad_pedida=10.5` suma 10.5 al stock, crea lote 10.5 y cuenta a pagar provisoria. `select proname, count(*) from pg_proc group by proname having count(*)>1` = 0 filas (sin firmas duplicadas).
- **Smoke test:** recibir 10.5 kg + devolver 0.5 kg + aprobar un conteo de 10.5 kg → todos conservan decimales.

### Mig 077 — Canonicalizar unidad + dimensión

```sql
alter table public.productos add column if not exists dimension text;

-- Set cerrado: 'kg','g','lt','ml','unidad'
update public.productos set unidad='kg'     where lower(trim(unidad)) in ('kg','kilo','kilos','kilogramo');
update public.productos set unidad='lt'     where lower(trim(unidad)) in ('lt','l','litro','litros');
update public.productos set unidad='unidad' where lower(trim(unidad)) in ('un','u','unidad','unidades','c/u') or unidad is null;
-- (mantener 'g' y 'ml' si ya están limpios)

-- Backfill dimensión
update public.productos set dimension='peso'    where unidad in ('kg','g');
update public.productos set dimension='volumen' where unidad in ('lt','ml');
update public.productos set dimension='conteo'  where unidad='unidad';

notify pgrst, 'reload schema';
```

- **No** se agrega CHECK rígido sobre `unidad` (rompería inserts existentes); el set cerrado se valida en `lib/utils/unidades.ts`.
- **Aceptación:** `select distinct unidad from productos` solo devuelve valores del set cerrado; toda fila tiene `dimension` consistente.

### Mig 078 — Enum tipo_movimiento (AISLADA)

```sql
-- Enum actual: ('entrada','salida','ajuste','merma','venta')
alter type public.tipo_movimiento add value if not exists 'consumo_produccion';
alter type public.tipo_movimiento add value if not exists 'ingreso_produccion';

notify pgrst, 'reload schema';
```

- **NADA más** en este archivo (ni tablas ni funciones). Gotcha documentado en mig 042: ADD VALUE no es usable en la misma transacción que lo consume.
- **Aceptación:** `enum_range(null::public.tipo_movimiento)` incluye los 2 valores. Re-correrla no falla (idempotente).

**Gate Fase 0:** correr 075→076→077→078 una por una, con smoke test del circuito tocado tras cada una. `npm run build` pasa. **No avanzar** si algún smoke test falla.

---

## 4. FASE 1 — Tablas, RLS, taxonomía y utilidades de unidad

### Mig 079 — Tablas del módulo + RLS + taxonomía

```sql
create table if not exists public.recetas (
  id serial primary key,
  producto_id integer not null unique references public.productos(id) on delete cascade,
  rendimiento numeric(14,4) not null check (rendimiento > 0),
  unidad_rendimiento text not null,
  vida_util_dias integer not null default 0 check (vida_util_dias >= 0),
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receta_ingredientes (
  id serial primary key,
  receta_id integer not null references public.recetas(id) on delete cascade,
  insumo_id integer not null references public.productos(id),
  cantidad numeric(14,4) not null check (cantidad > 0),
  unidad text not null,
  merma_pct numeric(6,3) not null default 0 check (merma_pct >= 0 and merma_pct < 100),
  created_at timestamptz not null default now()
);

create table if not exists public.ordenes_produccion (
  id serial primary key,
  producto_id integer not null references public.productos(id),
  receta_id integer references public.recetas(id),
  cantidad_planificada numeric(14,4) not null check (cantidad_planificada > 0),
  cantidad_producida numeric(14,4),
  estado text not null default 'borrador' check (estado in ('borrador','iniciada','cerrada','cancelada')),
  lote_id integer references public.lotes(id),
  costo_total numeric(14,4) not null default 0,
  usuario_id uuid references public.usuarios(id),
  fecha_inicio timestamptz, fecha_cierre timestamptz, nota text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.items_orden_prod (
  id serial primary key,
  orden_id integer not null references public.ordenes_produccion(id) on delete cascade,
  insumo_id integer not null references public.productos(id),
  cantidad_consumida numeric(14,4) not null,   -- en unidad de stock del insumo (ya convertida)
  costo_unitario numeric(12,4) not null default 0,
  subtotal numeric(14,4) not null default 0,
  created_at timestamptz not null default now()
);

-- Índices
create index if not exists idx_receta_ing_receta on public.receta_ingredientes(receta_id);
create index if not exists idx_receta_ing_insumo on public.receta_ingredientes(insumo_id);
create index if not exists idx_op_estado on public.ordenes_produccion(estado);
create index if not exists idx_op_producto on public.ordenes_produccion(producto_id);
create index if not exists idx_iop_orden on public.items_orden_prod(orden_id);

-- RLS (patrón inline mig 047): por cada tabla
alter table public.recetas enable row level security;
drop policy if exists gate_rw on public.recetas;
create policy gate_rw on public.recetas for all to authenticated
  using (public.fn_tiene_permiso('produccion')) with check (public.fn_tiene_permiso('produccion'));
-- (repetir idéntico para receta_ingredientes, ordenes_produccion, items_orden_prod)

-- Taxonomía: reclasificar catálogo + frenar la deriva (corrección de la revisión)
update public.productos set tipo='reventa' where tipo='simple' or tipo is null;
alter table public.productos alter column tipo set default 'reventa';
-- check suave, seguro tras el bulk update:
alter table public.productos add constraint productos_tipo_chk
  check (tipo in ('insumo','semi_elaborado','elaborado','reventa')) not valid;
-- 'not valid' = no revalida filas viejas, solo nuevas; evita romper imports legacy.

-- Validación servidor de unidad_rendimiento (corrección de la revisión)
create or replace function public.fn_valida_receta() returns trigger language plpgsql as $$
begin
  if new.unidad_rendimiento <> (select unidad from public.productos where id = new.producto_id) then
    raise exception 'unidad_rendimiento (%) debe igualar la unidad del producto', new.unidad_rendimiento;
  end if;
  return new;
end $$;
drop trigger if exists trg_valida_receta on public.recetas;
create trigger trg_valida_receta before insert or update on public.recetas
  for each row execute function public.fn_valida_receta();

notify pgrst, 'reload schema';
```

- **Aceptación:** las 4 tablas existen con FKs e índices; un cajero (sin permiso `produccion`) ve 0 filas por RLS; receta con `producto_id` duplicado falla por UNIQUE; insertar receta con `unidad_rendimiento` distinta de la del producto lanza excepción.

### `lib/utils/unidades.ts` (utilidad pura, sin `"use client"`)

```ts
export type UnidadCanonica = 'kg' | 'g' | 'lt' | 'ml' | 'unidad'
export type Dimension = 'peso' | 'volumen' | 'conteo'

export const DIMENSION_POR_UNIDAD: Record<UnidadCanonica, Dimension> = {
  kg: 'peso', g: 'peso', lt: 'volumen', ml: 'volumen', unidad: 'conteo',
}
// factor a la unidad base de cada dimensión (g para peso, ml para volumen, unidad para conteo)
const FACTOR_A_BASE: Record<UnidadCanonica, number> = { kg: 1000, g: 1, lt: 1000, ml: 1, unidad: 1 }

export function dimensionDe(u: UnidadCanonica): Dimension { return DIMENSION_POR_UNIDAD[u] }
export function mismaDimension(a: UnidadCanonica, b: UnidadCanonica): boolean {
  return DIMENSION_POR_UNIDAD[a] === DIMENSION_POR_UNIDAD[b]
}
export function convertir(cantidad: number, desde: UnidadCanonica, hacia: UnidadCanonica): number {
  if (!mismaDimension(desde, hacia)) throw new Error(`No se puede convertir de ${desde} a ${hacia}: distinta dimensión`)
  return (cantidad * FACTOR_A_BASE[desde]) / FACTOR_A_BASE[hacia]
}
export function esUnidadCanonica(u: string): u is UnidadCanonica { return u in DIMENSION_POR_UNIDAD }
```

- **Aceptación:** `convertir(1,'kg','g')===1000`; `convertir(500,'g','kg')===0.5`; `convertir(1,'kg','unidad')` lanza Error; `mismaDimension('kg','lt')===false`.

**Gate Fase 1:** correr 079, verificar tablas + RLS + reclasificación. `npm run build`. Validar `convertir()` a mano.

---

## 5. FASE 2 — RPCs del circuito (Modelo B)

> **Correcciones de la revisión incorporadas aquí:** (1) conversión de unidad explícita en SQL; (2) gateo por `controlar_stock`; (3) manejo de `cantidad_producida = 0`.

### Mig 080 — Conversión de unidad + costeo recursivo

```sql
-- Helper SQL que espeja lib/utils/unidades.ts (corrección crítica: el costeo DEBE convertir)
create or replace function public.fn_convertir_unidad(p_cantidad numeric, p_desde text, p_hacia text)
returns numeric language plpgsql immutable as $$
declare v_fd numeric; v_fh numeric; v_dd text; v_dh text;
begin
  v_fd := case p_desde when 'kg' then 1000 when 'g' then 1 when 'lt' then 1000 when 'ml' then 1 when 'unidad' then 1 end;
  v_fh := case p_hacia when 'kg' then 1000 when 'g' then 1 when 'lt' then 1000 when 'ml' then 1 when 'unidad' then 1 end;
  v_dd := case p_desde when 'kg' then 'peso' when 'g' then 'peso' when 'lt' then 'volumen' when 'ml' then 'volumen' when 'unidad' then 'conteo' end;
  v_dh := case p_hacia when 'kg' then 'peso' when 'g' then 'peso' when 'lt' then 'volumen' when 'ml' then 'volumen' when 'unidad' then 'conteo' end;
  if v_fd is null or v_fh is null then raise exception 'Unidad no canónica: % / %', p_desde, p_hacia; end if;
  if v_dd <> v_dh then raise exception 'No se puede convertir de % a %: distinta dimensión', p_desde, p_hacia; end if;
  return (p_cantidad * v_fd) / v_fh;
end $$;

-- Costeo recursivo de la receta (semi-elaborados anidados) con anti-ciclo por profundidad
create or replace function public.fn_costo_receta(p_producto_id integer, p_depth integer default 0)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_costo numeric := 0; v_rend numeric; v_unidad_prod text; v_ing record; v_costo_ing numeric; v_cant_stock numeric;
begin
  if p_depth > 20 then raise exception 'Receta con ciclo o demasiado profunda (producto %)', p_producto_id; end if;
  select rendimiento into v_rend from public.recetas where producto_id = p_producto_id and activa = true;
  if v_rend is null then return public.fn_costo(p_producto_id); end if; -- insumo hoja: costo directo

  for v_ing in
    select ri.insumo_id, ri.cantidad, ri.unidad, ri.merma_pct
    from public.receta_ingredientes ri
    join public.recetas r on r.id = ri.receta_id
    where r.producto_id = p_producto_id and r.activa = true
  loop
    -- costo del insumo: recursivo si tiene receta activa, si no fn_costo (= $/unidad de stock)
    if exists (select 1 from public.recetas where producto_id = v_ing.insumo_id and activa = true) then
      v_costo_ing := public.fn_costo_receta(v_ing.insumo_id, p_depth + 1);
    else
      v_costo_ing := public.fn_costo(v_ing.insumo_id);
    end if;
    -- CONVERSIÓN unidad de receta -> unidad de stock del insumo (corrección crítica)
    select unidad into v_unidad_prod from public.productos where id = v_ing.insumo_id;
    v_cant_stock := public.fn_convertir_unidad(v_ing.cantidad, v_ing.unidad, v_unidad_prod);
    v_costo := v_costo + (v_cant_stock * (1 + v_ing.merma_pct / 100.0)) * v_costo_ing;
  end loop;

  return case when v_rend > 0 then v_costo / v_rend else 0 end;
end $$;
grant execute on function public.fn_costo_receta(integer, integer) to authenticated;

notify pgrst, 'reload schema';
```

- **Aceptación:** costo de un elaborado con 2 insumos = `Σ (cantidad_convertida × costo × (1+merma)) / rendimiento`; semi anidado computa recursivo; ciclo A→B→A corta por profundidad con excepción; producto sin receta devuelve `fn_costo`.

### Mig 081 — Iniciar / cerrar / cancelar orden

Las 3 funciones `language plpgsql security definer set search_path = public`. Variables numeric. **Patrón clave a respetar en las 3:** gatear el bloque de inventario con `coalesce(controlar_stock, true)` igual que `fn_crear_venta` (mig 072) y `fn_anular_venta`/`fn_crear_devolucion` (mig 071) — **corrección crítica para no reintroducir el stock fantasma que la 071 cerró**.

**`fn_iniciar_orden_produccion(p_orden_id integer, p_usuario_id uuid) returns jsonb`**
1. Validar `estado='borrador'` (else raise). Calcular `v_factor := cantidad_planificada / receta.rendimiento`.
2. Por cada `receta_ingrediente`:
   - `v_cant_receta := ri.cantidad * (1 + ri.merma_pct/100) * v_factor`.
   - **Convertir a unidad de stock del insumo:** `v_cant := fn_convertir_unidad(v_cant_receta, ri.unidad, prod.unidad)`.
   - Leer `v_controlar := coalesce(controlar_stock, true)` del insumo.
   - **Si `v_controlar`:** descontar stock + insertar `movimientos_stock` tipo `'consumo_produccion'` (ref = orden) + consumir lotes por **FEFO** (`order by fecha_vencimiento asc ... least() ... marcar 'agotado'`, réplica del bloque de `fn_crear_venta` mig 072).
   - Insertar snapshot en `items_orden_prod` (`cantidad_consumida` ya convertida, `costo_unitario = fn_costo(insumo)`, `subtotal`). El snapshot se registra **aunque** `controlar_stock=false` (para costeo), pero sin mover stock.
3. `update ordenes_produccion set estado='iniciada', fecha_inicio=now(), costo_total=(select sum(subtotal) ...), usuario_id=p_usuario_id`.

> **Invariante documentada:** los insumos se consumen al **planificado** en `iniciar`; el rinde real solo afecta el ingreso del producido. La diferencia es **merma de proceso esperada** — NO devolver insumo sobrante (rompería `stock_actual == sum(lotes activos)`).

**`fn_cerrar_orden_produccion(p_orden_id integer, p_cantidad_producida numeric, p_usuario_id uuid) returns jsonb`**
1. Validar `estado='iniciada'`. **Manejo de `p_cantidad_producida = 0` (corrección):** si es 0 → `raise exception 'Producción 0: cancelá la orden para reponer insumos'` (o variante: cerrar registrando toda la planificada como merma, **sin** crear lote ni ingreso). Definir uno; el MVP usa el `raise`.
2. `v_costo_unit_real := costo_total / p_cantidad_producida`.
3. Leer `v_controlar` del producido. **Si `v_controlar`:** ingresar stock (`stock += producida`) + `movimientos_stock` tipo `'ingreso_produccion'`.
4. Crear lote: `fecha_vencimiento = current_date + receta.vida_util_dias`, `cantidad_inicial = cantidad_actual = p_cantidad_producida`, estado `'activo'`. (El check `cantidad_inicial > 0` queda cubierto por el paso 1.)
5. `perform fn_set_costo(producido, v_costo_unit_real)`.
6. **Merma trazable:** `v_merma := cantidad_planificada - p_cantidad_producida`; si `> 0`, insertar `movimientos_stock` tipo `'merma'` (registro de rinde, no descuenta — ya se ingresó lo real).
7. `update ordenes_produccion set estado='cerrada', cantidad_producida, lote_id, fecha_cierre=now()`.

**`fn_cancelar_orden_produccion(p_orden_id integer, p_usuario_id uuid) returns jsonb`**
- Si `estado='cerrada'` → `raise exception 'No se puede cancelar una orden cerrada (usar ajuste de stock)'`.
- Si `estado='iniciada'`: por cada `items_orden_prod`, **reponer** stock + `movimientos_stock` tipo `'entrada'` + sumar al lote más nuevo (`order by fecha_vencimiento desc, id desc limit 1`, reactivar a `'activo'` si estaba agotado), réplica de `fn_anular_venta`. Solo repone lo que el snapshot registró (los `controlar_stock=false` no movieron stock, así que su reposición es no-op coherente).
- `update ... set estado='cancelada'`.

```sql
grant execute on function public.fn_iniciar_orden_produccion(integer, uuid) to authenticated;
grant execute on function public.fn_cerrar_orden_produccion(integer, numeric, uuid) to authenticated;
grant execute on function public.fn_cancelar_orden_produccion(integer, uuid) to authenticated;
notify pgrst, 'reload schema';
```

**Gate Fase 2:** correr 080 y 081 (con 078/079 ya aplicadas; verificar `enum_range` antes de 081). `pg_proc having count(*)>1` = 0. Smoke E2E en SQL: receta → orden borrador → iniciar (verificar consumo FEFO, conversión correcta, snapshot) → cerrar (ingreso + lote + vencimiento + `fn_set_costo` + merma) → cancelar otra (reposición). Test con un insumo `controlar_stock=false` y un cierre con cantidad 0.

---

## 6. FASE 3 — Backend TypeScript

### `types/database.ts`
- Unions: `EstadoOrdenProduccion`, `DimensionUnidad`, `TipoProducto`; ampliar `TipoMovimiento` con `'consumo_produccion' | 'ingreso_produccion'`.
- `Row/Insert/Update` de las 4 tablas (molde triple). Agregar `dimension?: string | null` a `ProductoRow`.
- En `Tables`: registrar las 4 tablas **con `Relationships` pobladas** (corrección: `insumo_id→productos`, `receta_id→recetas`, `producto_id→productos`, `lote_id→lotes`, `orden_id→ordenes_produccion`) para que los embeds infieran tipado.
- En `Functions`: `fn_costo_receta`, `fn_iniciar/cerrar/cancelar_orden_produccion` con **`Returns` inline tipado** (no `Json`).

### `lib/queries/produccion.ts` (clonar patrón de `lib/queries/pedidos.ts`)
- `getRecetas()`, `getRecetaDeProducto(productoId)`, `getOrdenes(filtros)`, `getOrdenDetalle(id)`.
- `guardarReceta(payload)`: upsert por `producto_id` UNIQUE + replace de `receta_ingredientes`; **validación anti-ciclo en cliente** (recorrer grafo aguas arriba antes de escribir) + validar dimensiones compatibles vía `lib/utils/unidades`.
- `previewCostoReceta(productoId)`: `rpc('fn_costo_receta', { p_producto_id })`.
- `getDisponibilidadInsumos(recetaId, cantidad)`: explota receta y compara necesario (con `convertir()`) vs `stock_actual` para la tabla de disponibilidad.
- `crearOrden(payload)` + `iniciarOrden` / `cerrarOrden` / `cancelarOrden` (las 3 RPCs). Patrón `if (error) throw error`. Costo siempre vía `fn_costo`/embed `costos_producto`, nunca `productos.precio_costo`.

### `lib/hooks/useProduccion.ts` (clonar `lib/hooks/usePedidos.ts`)
- Query keys constantes; `useQuery` con `staleTime: 30_000` y `enabled: !!id`.
- Mutaciones con **toast en el hook** + invalidación en cascada. `iniciar`/`cerrar`/`cancelar` mueven stock+lotes+costo → invalidar `['productos']`, `['inventario']`, `['alertas-stock']`, `['lotes-activos']`, `['historial-costos']`, `['movimientos-stock']`, y `cerrar` también `['vencimientos']` (lote nuevo).

**Gate Fase 3:** `npm run build` pasa (sin `any`); `supabase.from('ordenes_produccion')` infiere `OrdenProduccionRow[]` (no `never[]`).

---

## 7. FASE 4 — Frontend

`app/(dashboard)/produccion/page.tsx` (Server Component) delega a `<PantallaProduccion>` (orquestador cliente, 3 tabs, clon de `components/compras/PantallaCompras.tsx`, estilo de marca, icono `ChefHat`).

**Tab Producir** (tablet): `TabOrdenesProduccion` (lista + `BadgeEstadoOrden` + acciones) · `AsistenteNuevaOrden` (elegir producto con receta + cantidad + `TablaDisponibilidad` con `Semaforo`) · `ModalCierreOrden` (cantidad real, muestra merma y costo unitario con `MontoARS`).

**Tab Recetas** (desktop): `TablaRecetas` (con costo preview) · `EditorReceta` (producto, rendimiento+unidad, vida útil, ingredientes vía `BuscadorInsumo`) · `PanelCostoReceta` (preview on-read de `fn_costo_receta`). `BuscadorInsumo` clona el debounce/teclado de `pos/BuscadorProducto` pero filtra `tipo in ('insumo','semi_elaborado')` (no reusar el del POS, está acoplado a venta).

**Tab Análisis** (desktop): `AnalisisMargen` (costo materializado vs precio vs margen $/%; historial de órdenes con merma). Solo lectura, `SkeletonTabla` en loading. Cajero no la ve (sin permiso).

**Gate Fase 4:** `npm run build` + recorrido E2E en `npm run dev`: receta → preview costo → orden → disponibilidad → iniciar (inventario/vencimientos se refrescan solos) → cerrar → ver lote en `/vencimientos` y costo en `/inventario` → Análisis.

---

## 8. FASE 5 — Wiring del módulo

1. **`components/shared/Sidebar.tsx`**: importar `ChefHat`; agregar `{ href:'/produccion', etiqueta:'Producción', icono:ChefHat, permiso:'produccion' }` en la sección **Stock**.
2. **`lib/permisos.ts`** (4 lugares): `PERMISOS` (`{ clave:'produccion', etiqueta:'Producción / Elaboración', grupo:'Stock' }`); `PERMISOS_POR_ROL_LEGACY.encargado` (agregar `'produccion'`, **no** a cajero); `RUTA_POR_PERMISO` (`produccion:'/produccion'`); `PRIORIDAD_INICIO`.
3. **`middleware.ts`**: `PERMISO_RUTA` → `produccion: ['/produccion']`.
4. **Mig 082** — seed permiso en tabla `roles` (idempotente, clon de `010_permiso_compras.sql`):
   ```sql
   do $$ begin
     if exists (select 1 from information_schema.tables where table_schema='public' and table_name='roles') then
       update public.roles set permisos = array_append(permisos,'produccion'), updated_at = now()
       where codigo in ('admin','encargado') and not ('produccion' = any(permisos));
     end if;
   end $$;
   notify pgrst, 'reload schema';
   ```
5. **Verificación con 3 roles:** admin/encargado operan; cajero bloqueado en sidebar + ruta (redirige a `/`) + datos (RLS 0 filas).

---

## 9. Riesgos globales y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| `ALTER TYPE ADD VALUE` con las RPCs en la misma migración | Enum en mig 078 **aislada**, antes de 080/081. Confirmar `enum_range` antes de 081 |
| `ALTER COLUMN` de columna usada por vista | Verificado: ninguna vista bloquea 075. `pg_depend` como sanity check |
| Reissue P3 incompleto (truncar fraccionados) | Migrar **todas** las variables internas + `conteos_items.cantidad_contada`. Smoke test 0.5 kg |
| Recursión infinita en `fn_costo_receta` | Tope de profundidad (`p_depth > 20`) + validación anti-ciclo al guardar receta |
| Conversión cruzando dimensiones | `fn_convertir_unidad` + `productos.dimension` + canonicalización previa (077) |
| Olvidar registrar tabla/RPC en `types/database.ts` | Registrar todo en Fase 3 antes de las queries; `npm run build` |
| Romper el circuito vivo de ventas/compras | Smoke test entre fases; **no** tocar `fn_crear_venta`; cada migración en archivo propio |
| Olvidar `notify pgrst` | Toda migración (075–082) cierra con la línea exacta |
| Stock fantasma por ignorar `controlar_stock` | Gatear inventario con `coalesce(controlar_stock,true)` en las 3 RPCs |

---

## 10. Criterios de cierre del MVP

- [ ] Fase 0 aplicada: costo `numeric(12,4)`; saldos de movimientos `numeric(12,3)` (venta por peso conserva decimales); `items_pedido`/`conteos_items` numeric (recibir 10.5 kg con cuenta a pagar; devolver 0.5 kg; conteo 10.5 kg); `unidad` canonicalizada + `dimension`; enum con los 2 valores.
- [ ] 4 tablas con RLS por `fn_tiene_permiso('produccion')`; catálogo reclasificado (sin `tipo='simple'`); trigger valida `unidad_rendimiento`.
- [ ] `lib/utils/unidades.ts` + `fn_convertir_unidad` convierten solo intra-dimensión.
- [ ] E2E (SQL y UI): receta con costo preview (recursivo, anti-ciclo) → orden → iniciar (FEFO + conversión + `controlar_stock`) → cerrar (ingreso + lote con vencimiento + `fn_set_costo` + merma) → cancelar repone. Caso cantidad 0 manejado.
- [ ] El producido se vende por el POS leyendo costo vía `fn_costo` **sin** tocar `fn_crear_venta`; su lote aparece en `/vencimientos` y el costo en `/inventario`.
- [ ] UI con 3 tabs reutilizando `Semaforo`/`MontoARS`/`SkeletonTabla`; toasts en hooks; skeletons en loading.
- [ ] Wiring completo (Sidebar + permisos + middleware + seed roles); los 3 roles según matriz (cajero bloqueado en sidebar+ruta+RLS).
- [ ] `npm run build` limpio (sin `any`); `pg_proc having count>1` = 0; cada migración cierra con `notify pgrst`.

---

## Apéndice — Qué corrigió la revisión adversarial

El plan crudo era sólido en lo estructural (orden de migraciones, FEFO replicado, costeo materializado, RLS, wiring) pero la crítica atrapó:

1. **🔴 Conversión de unidad en SQL** — el draft asumía que estaba "hecha al guardar"; nada la hacía → costo y stock corruptos. Resuelto con `fn_convertir_unidad` dentro de `fn_costo_receta` y `fn_iniciar`.
2. **🔴 `controlar_stock`** — las RPCs lo ignoraban, reintroduciendo el bug que la mig 071 cerró. Resuelto gateando el inventario.
3. **🟠 P3 incompleto** — `conteos_items.cantidad_contada` es integer hoy, y `fn_crear_devolucion` truncaba. Incluidos en la mig 076.
4. **🟠 `fn_cerrar` con cantidad 0** — violaba `cantidad_inicial > 0` de `lotes`. Resuelto con validación.
5. **🟡 Renumeración** — orden numérico = orden de ejecución (078 enum antes de 079 tablas).
6. **🟡 Validación servidor de `unidad_rendimiento`** + default `tipo` → `reventa` + check suave.
7. **🟢 `Returns` inline** (no `Json`) + `Relationships` pobladas para embeds tipados.
