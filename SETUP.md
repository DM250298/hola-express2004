# Setup — ¡Hola! Express

Guía paso a paso para conectar la app a Supabase y probarla en local.

---

## 1. Crear el proyecto en Supabase

1. Ir a [supabase.com](https://supabase.com) y crear un proyecto nuevo.
2. Anotar la **URL del proyecto** y la **anon key** (Settings → API).

## 2. Configurar variables de entorno

En la raíz de `hola-express/`, completar `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
```

## 3. Crear el schema

En Supabase → **SQL Editor** → **New query**, pegar y ejecutar **una sola vez**:

```
supabase/schema.sql
```

Esto crea las 13 tablas, los enums, índices, triggers (`updated_at` automático
+ creación de `usuarios` al registrar un auth user), RLS básico y habilita
Realtime para `ventas` y `caja_turnos`.

## 4. Cargar datos de prueba

Mismo SQL Editor, pegar y ejecutar:

```
supabase/seed.sql
```

Carga 8 categorías, 5 proveedores, 24 productos y 4 lotes con vencimientos
variados (rojo / amarillo / verde) para probar todos los módulos.

## 5. Crear tu usuario admin

1. Supabase → **Authentication → Users → Add user**
   - Email: `tu@email.com`
   - Password: la que quieras
   - **Auto Confirm User**: activado (evita el paso de confirmación por email)

2. El trigger `on_auth_user_created` ya creó la fila en `public.usuarios`
   con rol `cajero` por defecto. Promoverte a admin:

   ```sql
   update public.usuarios
   set rol = 'admin'
   where email = 'tu@email.com';
   ```

## 6. Levantar la app

Desde `hola-express/`:

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000). Te lleva al login.
Ingresá con el email y password del paso 5.

---

## Flujo recomendado para probar todos los módulos

1. **Dashboard** (`/`) — Lo primero que ves. Sin datos: el panel de
   alertas marca productos bajo stock mínimo (Doritos = 0, Fideos = 4)
   y lotes próximos a vencer.

2. **Configuración → Productos** — La tabla muestra los 24 productos
   del seed. Editá uno o agregá uno nuevo para probar el formulario.

3. **POS** (`/pos`) — Va a pedir abrir caja con un monto inicial
   (ej: `5000`). Después podés vender:
   - Buscá "coca" o escaneá `7790895000010` para Coca-Cola 500ml.
   - Tocá uno de los productos frecuentes (al primer producto vendido
     aparece la grilla).
   - Click "Cobrar" → elegí efectivo, ingresá el recibido, confirmá.
   - Vas a ver el ticket. Otro round: el frecuente ya aparece arriba.
   - Cerrá turno: contá el efectivo (apertura + ventas en efectivo)
     y registralo. Si pones menos, vas a ver la diferencia en rojo.

4. **Inventario** — Al haber hecho ventas, el stock bajó. Click en un
   producto para ver el historial de movimientos y el gráfico de
   evolución del stock.

5. **Vencimientos** — Vas a ver los 4 lotes del seed: pan (rojo
   urgente), leche (rojo), yogurt (amarillo), queso (verde). Dá de
   baja parcial el de la leche → queda registrado como merma.

6. **Pedidos → Nuevo pedido** — Elegí "Distribuidora Norte SA".
   Te sugiere los productos del proveedor bajo stock con cantidad
   pre-cargada. Tocá "Agregar todos" → "Crear y marcar como
   enviado". Después en el detalle del pedido tocá "Registrar
   recepción" → confirmá. Se suma stock y se crea automáticamente
   la cuenta a pagar.

7. **Finanzas** — Ver el P&L del mes (Ventas / CMV / Margen / Mermas
   / Egresos / Resultado neto). En "Cuentas a pagar" aparece la
   cuenta del paso 6 → "Marcar pagada" la cierra y crea un egreso
   automático en la tab "Egresos".

8. **Reportes** — Top 20, rotación, dead stock, mermas. Cada uno
   tiene un botón "Exportar PDF" con el logo de marca.

---

## Pendientes técnicos conocidos para producción

- **CMV histórico aproximado:** se calcula con `productos.precio_costo`
  actual. Si cambia el costo, los CMV pasados quedan aproximados.
  Idealmente agregar `costo_unitario` a `items_venta`.

- **Operaciones multi-tabla no atómicas:** crear venta, recibir pedido,
  ajustar stock, dar de baja lote y pagar cuenta están implementadas
  en el cliente con varios INSERT/UPDATE secuenciales. Si falla a
  mitad, queda inconsistencia parcial. Solución productiva: stored
  procedures transaccionales.

- **RLS permisivo:** las políticas actuales permiten todo a usuarios
  autenticados. Refinar por rol antes de producción.

- **Scanner de código de barras:** la simulación con botón "Escanear"
  genera un EAN-13 aleatorio para testing. En producción, conectar un
  scanner USB (que tipea como teclado) — el `BuscadorProducto` del
  POS ya detecta secuencias de solo dígitos seguidas de Enter.
