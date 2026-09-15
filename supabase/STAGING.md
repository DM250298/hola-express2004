# Proyecto de prueba (staging) — instructivo

Cómo armar una copia de producción para probar migraciones sin tocar el negocio.

**Método: clonar y anonimizar**, no reconstruir desde las migraciones. Con el historial que
tuvo este repo, una reconstrucción no sería fiel — y probar contra una copia infiel es peor
que no probar.

**Sin Docker.** Se usan `pg_dump` y `psql` nativos. (Docker Desktop viene dando problemas en
esta máquina; no vale la pena pelearlo para esto.)

> ⚠️ **Nunca** pegues las cadenas de conexión en un chat, un commit ni una captura: llevan la
> contraseña de la base. Acá van siempre como `<PROD_URL>` y `<PRUEBAS_URL>`.

---

## Antes de empezar — datos a recolectar

Corré esto **en producción** y guardá los resultados; los vas a necesitar para verificar después:

```sql
-- 1. Versión de Postgres (pg_dump tiene que ser IGUAL o MÁS NUEVO)
select version();

-- 2. Códigos de rol reales (ojo: NO existe 'admin' en producción)
select codigo, nombre from public.roles order by codigo;

-- 3. Conteos de referencia, para comparar contra la copia
select 'productos' as tabla, count(*) from public.productos
union all select 'clientes',          count(*) from public.clientes
union all select 'ventas',            count(*) from public.ventas
union all select 'items_venta',       count(*) from public.items_venta
union all select 'movimientos_stock', count(*) from public.movimientos_stock
union all select 'empleados',         count(*) from public.empleados
union all select 'usuarios',          count(*) from public.usuarios
order by 1;
```

Anotá también la **región** del proyecto de producción (Project Settings → General).

---

## Paso 1 — Crear el proyecto de pruebas

En el panel de Supabase, dentro de la **misma organización**:

- Nombre: `hola-express-PRUEBAS` (que no haya dudas de cuál es cuál)
- Región: **la misma que producción**
- Contraseña de base: una nueva, guardala en tu gestor de contraseñas
- Verificá qué suma a tu factura de Pro antes de confirmar

Después, botón **Connect** → copiá la cadena de conexión. Usá el **session pooler
(puerto 5432)**, nunca el transaction pooler (6543): `pg_dump` y `psql` necesitan una
sesión completa. (La conexión directa es solo IPv6 y suele fallar en redes hogareñas.)

---

## Paso 2 — Instalar las herramientas

Hacen falta `pg_dump` y `psql` nativos en Windows, de versión **igual o más nueva que la de
tu Supabase** (la del paso anterior); si son más viejos, el dump falla con error de versión.

**Ya están instalados** (2026-09-14): binarios de PostgreSQL 18.4 descomprimidos en
`C:\Users\Win11Solu\Desktop\HEX-V1\herramientas\pgsql\bin` (sin instalador ni servicio).
Y los pasos 3 y 4 están automatizados en
`C:\Users\Win11Solu\Desktop\HEX-V1\herramientas\clonar-a-pruebas.ps1`, que además verifica
que las cadenas de conexión no estén cruzadas antes de tocar nada.

---

## Paso 3 — Sacar la copia de producción

Son operaciones de **solo lectura**: no modifican producción.

```
pg_dump "<PROD_URL>" --schema-only --schema=public --no-owner -f esquema.sql

pg_dump "<PROD_URL>" --data-only --schema=public --no-owner -f datos.sql

pg_dump "<PROD_URL>" --data-only --table=auth.users --no-owner -f auth_users.sql
```

Qué hace cada uno:

1. **esquema.sql** — tablas, funciones, triggers, vistas y políticas RLS. La estructura.
2. **datos.sql** — el contenido de todas las tablas de `public`.
3. **auth_users.sql** — solo las filas de usuarios de autenticación. Hace falta porque
   `public.usuarios.id` tiene una clave foránea a `auth.users(id)`
   (`schema.sql:43`): sin esas filas, la restauración falla.

---

## Paso 4 — Restaurar en el proyecto de pruebas

**En este orden.** El `session_replication_role = replica` desactiva triggers y chequeos de
clave foránea durante la carga; sin eso, el orden de las tablas rompe todo.

```
psql "<PRUEBAS_URL>" --variable ON_ERROR_STOP=1 -f esquema.sql

psql "<PRUEBAS_URL>" --variable ON_ERROR_STOP=1 -c "SET session_replication_role = replica" -f auth_users.sql

psql "<PRUEBAS_URL>" --variable ON_ERROR_STOP=1 -c "SET session_replication_role = replica" -f datos.sql
```

Es normal ver avisos sobre extensiones o roles que ya existen. Lo que importa es que no haya
un `ERROR` que corte la carga.

> 🔴 **En este punto la copia tiene datos reales de personas.** El paso 5 va inmediatamente
> después, no "cuando haya tiempo".

---

## Paso 5 — Anonimizar

Corré esto **en el SQL Editor del proyecto de PRUEBAS**. Verificá arriba a la izquierda que
dice `hola-express-PRUEBAS` y no `HEX-V1`.

```sql
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  ANONIMIZACIÓN · CORRER SOLO EN EL PROYECTO DE PRUEBAS           ║
-- ║  Reemplaza datos de personas por datos falsos.                   ║
-- ║  NO toca: productos, precios, costos, stock, ventas,             ║
-- ║  movimientos, lotes, cuentas, asientos ni proveedores.           ║
-- ╚══════════════════════════════════════════════════════════════════╝
begin;

-- ─── Clientes ───────────────────────────────────────────────────────
update public.clientes set
  nombre    = 'Cliente ' || lpad(id::text, 4, '0'),
  telefono  = '3804' || lpad(id::text, 6, '0'),
  email     = 'cliente' || id || '@pruebas.local',
  documento = lpad((20000000 + id)::text, 8, '0'),
  direccion = 'Calle Falsa ' || id || ', La Rioja',
  notas     = null;

-- ─── Empleados ──────────────────────────────────────────────────────
update public.empleados set
  nombre           = 'Empleado ' || lpad(id::text, 3, '0'),
  apellido         = 'Prueba',
  dni              = lpad((30000000 + id)::text, 8, '0'),
  documento        = lpad((30000000 + id)::text, 8, '0'),
  cuil             = '20' || lpad((30000000 + id)::text, 8, '0') || '9',
  fecha_nacimiento = null,
  telefono         = '3804' || lpad((900000 + id)::text, 6, '0'),
  email            = 'empleado' || id || '@pruebas.local',
  direccion        = 'Calle Falsa ' || id || ', La Rioja',
  banco_cbu_alias  = null,
  foto_url         = null,
  notas            = null;

-- Sueldos: valores redondos ficticios (es información confidencial)
-- (valor_hora es columna generada: se recalcula sola, no se escribe)
update public.empleado_sueldo set
  sueldo_basico = 500000;

-- Documentos de RRHH: los archivos no viajan, solo las referencias
update public.empleado_documentos set
  nombre_archivo = 'documento-prueba.pdf',
  notas          = null;

-- ─── Usuarios de la aplicación ──────────────────────────────────────
update public.usuarios set
  email  = 'usuario-' || id::text || '@pruebas.local',
  nombre = 'Usuario ' || left(id::text, 8);

-- ─── Usuarios de autenticación ──────────────────────────────────────
-- Se neutraliza la contraseña: nadie puede entrar con estas cuentas.
-- Las cuentas para probar se crean nuevas en el paso 7.
update auth.users set
  email              = 'usuario-' || id::text || '@pruebas.local',
  encrypted_password = 'DESHABILITADO-EN-PRUEBAS',
  phone              = null,
  raw_user_meta_data = '{}'::jsonb;

-- ─── Pedidos de la tienda online ────────────────────────────────────
update public.pedidos_tienda set
  cliente_nombre    = 'Cliente web ' || id,
  cliente_telefono  = '3804' || lpad((800000 + id)::text, 6, '0'),
  cliente_email     = 'web' || id || '@pruebas.local',
  cliente_direccion = 'Calle Falsa ' || id || ', La Rioja',
  cliente_notas     = null;

-- ─── Rastros con datos personales ───────────────────────────────────
update public.auditoria                 set ip       = null;
update public.limite_credito            set nota     = null;
update public.cuenta_corriente_cliente  set concepto = 'Movimiento #' || id;
update public.cuenta_corriente_empleado set concepto = 'Movimiento #' || id;

commit;
```

**Qué se conserva a propósito:** productos, precios, costos, stock, ventas, movimientos,
lotes, cuentas, asientos y `config_fiscal`. Si se tocan, las pruebas dejan de valer.

**Proveedores** también se conservan: es información comercial de empresas, no datos
personales, y hace falta para probar compras y recepción.

---

## Paso 6 — Neutralizar las integraciones

También en el proyecto de **pruebas**. Este paso es el que evita que una prueba toque el
mundo real.

```sql
begin;

-- Terminales de Mercado Pago: sin device_id no puede cobrar de verdad
update public.terminales set device_id = null, activo = false;

-- Notificaciones push: son endpoints de celulares reales de tus empleados
delete from public.push_subscriptions;

commit;
```

Y en las variables de entorno del proyecto de pruebas:

- **NO** cargues `MP_ACCESS_TOKEN` ni `MP_WEBHOOK_SECRET` reales. Dejalos vacíos o usá
  credenciales de prueba de Mercado Pago.
- **NO** cargues las claves VAPID de producción.
- Los crons de Vercel apuntan a producción y **no se tocan**.

---

## Paso 7 — Crear los usuarios de prueba

Las cuentas copiadas quedaron sin contraseña utilizable (paso 5), así que se crean nuevas.

En el panel de **pruebas** → **Authentication → Users → Add user**, con **Auto Confirm User**
activado, creá una cuenta por cada rol real:

| Email | Rol a asignar |
|---|---|
| `admin@pruebas.local` | el código de administración |
| `encargado@pruebas.local` | `encargado` |
| `cajero@pruebas.local` | `cajero` |
| `fiambrero@pruebas.local` | `fiambrero` |
| `empleado@pruebas.local` | `empleado` |

El trigger `on_auth_user_created` les crea sola la fila en `public.usuarios` con rol `cajero`
(tiene `on conflict (id) do nothing`, así que no pisa las filas existentes). Después
asignales el rol real:

```sql
-- Reemplazá 'administración' por el código EXACTO que devolvió la consulta
-- del principio. NO uses 'admin': ese rol no existe en producción, y el
-- atajo interno de fn_tiene_permiso solo aplica a 'admin' — si probás con
-- un admin inventado, los permisos andan en pruebas y fallan en producción.

update public.usuarios set rol = 'administración' where email = 'admin@pruebas.local';
update public.usuarios set rol = 'encargado'      where email = 'encargado@pruebas.local';
update public.usuarios set rol = 'cajero'         where email = 'cajero@pruebas.local';
update public.usuarios set rol = 'fiambrero'      where email = 'fiambrero@pruebas.local';
update public.usuarios set rol = 'empleado'       where email = 'empleado@pruebas.local';

select email, rol from public.usuarios where email like '%@pruebas.local' order by rol;
```

---

## Paso 8 — Verificar que la copia sirve

Seis comprobaciones. Si las seis pasan, es un banco de pruebas confiable.

```sql
-- 1. Conteos: tienen que coincidir con los de producción
select 'productos' as tabla, count(*) from public.productos
union all select 'clientes',          count(*) from public.clientes
union all select 'ventas',            count(*) from public.ventas
union all select 'items_venta',       count(*) from public.items_venta
union all select 'movimientos_stock', count(*) from public.movimientos_stock
union all select 'empleados',         count(*) from public.empleados
union all select 'usuarios',          count(*) from public.usuarios
order by 1;

-- 2. Chequeo T1: ninguna función duplicada
select proname, count(*) from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname like 'fn_%'
group by proname having count(*) > 1;              -- → 0 filas

-- 3. Las firmas críticas están completas
select oid::regprocedure::text, pronargs from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('fn_crear_venta', 'fn_guardar_factura_compra')
order by 1;                                        -- → 7 y 12 argumentos

-- 4. Las migraciones 161 y 162 viajaron en la copia
select p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as abierta
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('fn_costo', 'fn_set_costo');   -- → abierta = false

-- 5. No quedó ningún dato personal real
select count(*) as sin_anonimizar from public.clientes
where nombre not like 'Cliente %';                 -- → 0
```

**6. Prueba funcional:** apuntá la app a la copia (paso siguiente), entrá con cada usuario de
prueba y confirmá que:

- el menú lateral muestra lo mismo que en producción para cada rol
- una venta en el POS baja el stock y cuadra el asiento contable
- Inventario muestra los días de cobertura entrando con el cajero

---

## Apuntar la aplicación a la copia

En `.env.local`, reemplazá estas tres variables por las del proyecto de pruebas:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Después `npm run dev`. **Vercel sigue apuntando a producción** — no se toca nada allá.

Guardá una copia del `.env.local` de producción antes de pisarlo, para poder volver.

---

## Refrescar la copia más adelante

Antes de cada migración crítica conviene rehacerla, para que refleje la producción actual:
repetir los pasos 3 a 7. Que la copia sea vieja no invalida las pruebas de lógica, pero si la
estructura de producción cambió, deja de ser fiel.

---

## Reglas permanentes

1. **Toda migración que toque stock, dinero o permisos se prueba acá primero.**
2. La copia **nunca** lleva credenciales reales de Mercado Pago.
3. Los datos personales se anonimizan **en la misma sesión** en que se restauran.
4. Probar en la copia **reduce** el riesgo, no lo elimina: el día que se corre en producción
   siguen haciendo falta respaldo verificado, script de reversión escrito de antemano y una
   ventana con el local tranquilo.
