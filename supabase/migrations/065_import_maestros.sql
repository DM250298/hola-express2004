-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 065 · Motor de importación de maestros                   ║
-- ║                                                                     ║
-- ║  - codigo_barras pasa a ser la identidad ÚNICA y OBLIGATORIA del    ║
-- ║    producto (SKU = código de barras). Si falta, se autogenera con   ║
-- ║    formato HEX-000001 vía secuencia (nunca colisiona con los        ║
-- ║    códigos numéricos manuales del usuario).                         ║
-- ║  - Columnas nuevas del maestro: marca, subcategoria, ubicacion,     ║
-- ║    codigo_barras_2 (EAN secundario), codigo_interno.                ║
-- ║  - RPCs transaccionales fn_importar_productos / fn_importar_clientes ║
-- ║    (security definer; matchean por código / documento; conservan    ║
-- ║    los valores existentes cuando una columna no viene en el lote,   ║
-- ║    lo que habilita el modo "solo precios").                         ║
-- ║                                                                     ║
-- ║  Ejecutar UNA sola vez, COMPLETO, en el SQL Editor de Supabase.     ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ─── 1. Secuencia + generador de código ──────────────────────────────
create sequence if not exists public.productos_codigo_seq start 1;

create or replace function public.fn_generar_codigo()
returns text language sql volatile as $$
  select 'HEX-' || lpad(nextval('public.productos_codigo_seq')::text, 6, '0')
$$;
grant execute on function public.fn_generar_codigo() to authenticated;

-- ─── 2. Columnas nuevas del maestro ──────────────────────────────────
alter table public.productos
  add column if not exists marca           text,
  add column if not exists subcategoria    text,
  add column if not exists ubicacion       text,
  add column if not exists codigo_barras_2 text,
  add column if not exists codigo_interno  text;

-- EAN secundario también único (cuando existe), para escanearlo sin chocar
create unique index if not exists productos_codbarras2_key
  on public.productos(codigo_barras_2) where codigo_barras_2 is not null;

-- ─── 3. codigo_barras: obligatorio + autogenerado ────────────────────
-- Backfill de los que no tengan (fn_generar_codigo es volatile => uno por fila)
update public.productos set codigo_barras = public.fn_generar_codigo()
  where codigo_barras is null or btrim(codigo_barras) = '';

alter table public.productos
  alter column codigo_barras set default public.fn_generar_codigo();
alter table public.productos
  alter column codigo_barras set not null;
-- (el unique sobre codigo_barras ya existe desde schema.sql)

-- ─── 4. RPC: importar productos ──────────────────────────────────────
-- Recibe un lote (jsonb array). Cada fila ya viene normalizada por el motor
-- del cliente. Clave de identidad: codigo_barras. Campos ausentes en el lote
-- conservan su valor actual (habilita el modo "solo precios").
create or replace function public.fn_importar_productos(p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_fila jsonb;
  v_cat_id integer; v_prov_id integer; v_prod_id integer;
  v_codigo text;
  v_creados integer := 0; v_actualizados integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if not public.fn_tiene_permiso('configuracion') then
    raise exception 'Sin permiso para importar productos';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    begin
      -- Código: el del archivo o uno autogenerado
      v_codigo := nullif(btrim(coalesce(v_fila->>'codigo_barras','')), '');
      if v_codigo is null then v_codigo := public.fn_generar_codigo(); end if;

      -- Categoría (crea si no existe, case-insensitive)
      v_cat_id := null;
      if nullif(btrim(v_fila->>'categoria'),'') is not null then
        select id into v_cat_id from public.categorias
          where lower(nombre) = lower(btrim(v_fila->>'categoria')) limit 1;
        if v_cat_id is null then
          insert into public.categorias (nombre) values (btrim(v_fila->>'categoria'))
            returning id into v_cat_id;
        end if;
      end if;

      -- Proveedor (idem)
      v_prov_id := null;
      if nullif(btrim(v_fila->>'proveedor'),'') is not null then
        select id into v_prov_id from public.proveedores
          where lower(nombre) = lower(btrim(v_fila->>'proveedor')) limit 1;
        if v_prov_id is null then
          insert into public.proveedores (nombre) values (btrim(v_fila->>'proveedor'))
            returning id into v_prov_id;
        end if;
      end if;

      -- ¿Existe por código?
      select id into v_prod_id from public.productos where codigo_barras = v_codigo limit 1;

      if v_prod_id is not null then
        -- UPDATE conservador: coalesce(nuevo, actual) => no borra lo que no vino
        update public.productos set
          codigo_barras_2 = coalesce(nullif(v_fila->>'codigo_barras_2',''), codigo_barras_2),
          codigo_interno  = coalesce(nullif(v_fila->>'codigo_interno',''), codigo_interno),
          nombre          = coalesce(nullif(v_fila->>'nombre',''), nombre),
          marca           = coalesce(nullif(v_fila->>'marca',''), marca),
          subcategoria    = coalesce(nullif(v_fila->>'subcategoria',''), subcategoria),
          categoria_id    = coalesce(v_cat_id, categoria_id),
          proveedor_id    = coalesce(v_prov_id, proveedor_id),
          precio_venta    = coalesce((v_fila->>'precio_venta')::numeric, precio_venta),
          stock_actual    = coalesce((v_fila->>'stock_actual')::numeric, stock_actual),
          stock_minimo    = coalesce((v_fila->>'stock_minimo')::integer, stock_minimo),
          unidad          = coalesce(nullif(v_fila->>'unidad',''), unidad),
          venta_por_peso  = coalesce((v_fila->>'venta_por_peso')::boolean, venta_por_peso),
          iva_venta       = coalesce((v_fila->>'iva')::numeric, iva_venta),
          iva_compra      = coalesce((v_fila->>'iva')::numeric, iva_compra),
          ubicacion       = coalesce(nullif(v_fila->>'ubicacion',''), ubicacion),
          dias_vencimiento_minimo = coalesce(nullif(v_fila->>'dias_vencimiento_minimo','')::integer, dias_vencimiento_minimo),
          activo          = coalesce((v_fila->>'activo')::boolean, activo),
          updated_at      = now()
        where id = v_prod_id;
        v_actualizados := v_actualizados + 1;
      else
        insert into public.productos (
          codigo_barras, codigo_barras_2, codigo_interno, nombre, marca,
          subcategoria, categoria_id, proveedor_id, precio_venta, stock_actual,
          stock_minimo, unidad, venta_por_peso, iva_venta, iva_compra,
          ubicacion, dias_vencimiento_minimo, activo
        ) values (
          v_codigo,
          nullif(v_fila->>'codigo_barras_2',''),
          nullif(v_fila->>'codigo_interno',''),
          coalesce(nullif(v_fila->>'nombre',''), 'Sin nombre'),
          nullif(v_fila->>'marca',''),
          nullif(v_fila->>'subcategoria',''),
          v_cat_id, v_prov_id,
          coalesce((v_fila->>'precio_venta')::numeric, 0),
          coalesce((v_fila->>'stock_actual')::numeric, 0),
          coalesce((v_fila->>'stock_minimo')::integer, 5),
          coalesce(nullif(v_fila->>'unidad',''), 'unidad'),
          coalesce((v_fila->>'venta_por_peso')::boolean, false),
          coalesce((v_fila->>'iva')::numeric, 21),
          coalesce((v_fila->>'iva')::numeric, 21),
          nullif(v_fila->>'ubicacion',''),
          nullif(v_fila->>'dias_vencimiento_minimo','')::integer,
          coalesce((v_fila->>'activo')::boolean, true)
        ) returning id into v_prod_id;
        v_creados := v_creados + 1;
      end if;

      -- Costo => costos_producto (gateada). Solo si vino en el lote.
      if nullif(v_fila->>'precio_costo','') is not null then
        perform public.fn_set_costo(v_prod_id, (v_fila->>'precio_costo')::numeric);
      end if;

      -- codigo_proveedor => catálogo N:M proveedor_producto
      if v_prov_id is not null and nullif(v_fila->>'codigo_proveedor','') is not null then
        insert into public.proveedor_producto (proveedor_id, producto_id, codigo_proveedor, costo, es_principal)
        values (v_prov_id, v_prod_id, btrim(v_fila->>'codigo_proveedor'),
                coalesce((v_fila->>'precio_costo')::numeric, 0), true)
        on conflict (proveedor_id, producto_id)
          do update set codigo_proveedor = excluded.codigo_proveedor;
      end if;

    exception when others then
      v_errores := v_errores || jsonb_build_object(
        'fila', (v_fila->>'fila_origen')::int,
        'codigo', v_codigo,
        'mensaje', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'creados', v_creados,
    'actualizados', v_actualizados,
    'errores', v_errores);
end $$;

grant execute on function public.fn_importar_productos(jsonb) to authenticated;

-- ─── 5. RPC: importar clientes ───────────────────────────────────────
-- Clave de identidad: documento (DNI/CUIT). Sin documento => siempre crea.
create or replace function public.fn_importar_clientes(p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_fila jsonb;
  v_cli_id integer;
  v_doc text;
  v_creados integer := 0; v_actualizados integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if not public.fn_tiene_permiso('clientes') then
    raise exception 'Sin permiso para importar clientes';
  end if;

  for v_fila in select * from jsonb_array_elements(p_filas) loop
    begin
      v_doc := nullif(btrim(coalesce(v_fila->>'documento','')), '');
      v_cli_id := null;
      if v_doc is not null then
        select id into v_cli_id from public.clientes where documento = v_doc limit 1;
      end if;

      if v_cli_id is not null then
        update public.clientes set
          nombre    = coalesce(nullif(v_fila->>'nombre',''), nombre),
          telefono  = coalesce(nullif(v_fila->>'telefono',''), telefono),
          email     = coalesce(nullif(v_fila->>'email',''), email),
          direccion = coalesce(nullif(v_fila->>'direccion',''), direccion),
          notas     = coalesce(nullif(v_fila->>'notas',''), notas),
          activo    = coalesce((v_fila->>'activo')::boolean, activo),
          updated_at = now()
        where id = v_cli_id;
        v_actualizados := v_actualizados + 1;
      else
        insert into public.clientes (nombre, documento, telefono, email, direccion, notas, activo)
        values (
          coalesce(nullif(v_fila->>'nombre',''), 'Sin nombre'),
          v_doc,
          nullif(v_fila->>'telefono',''),
          nullif(v_fila->>'email',''),
          nullif(v_fila->>'direccion',''),
          nullif(v_fila->>'notas',''),
          coalesce((v_fila->>'activo')::boolean, true)
        );
        v_creados := v_creados + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object(
        'fila', (v_fila->>'fila_origen')::int,
        'codigo', coalesce(v_doc, v_fila->>'nombre'),
        'mensaje', sqlerrm);
    end;
  end loop;

  return jsonb_build_object(
    'creados', v_creados,
    'actualizados', v_actualizados,
    'errores', v_errores);
end $$;

grant execute on function public.fn_importar_clientes(jsonb) to authenticated;

-- ─── 6. RPC: importar categorías ─────────────────────────────────────
-- Matching case-insensitive por nombre (evita duplicados "Bebidas"/"bebidas").
create or replace function public.fn_importar_categorias(p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_fila jsonb; v_id integer; v_nombre text;
  v_creados integer := 0; v_actualizados integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if not public.fn_tiene_permiso('configuracion') then
    raise exception 'Sin permiso para importar categorías';
  end if;
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    begin
      v_nombre := nullif(btrim(v_fila->>'nombre'), '');
      if v_nombre is null then continue; end if;
      select id into v_id from public.categorias where lower(nombre) = lower(v_nombre) limit 1;
      if v_id is not null then
        update public.categorias set
          descripcion = coalesce(nullif(v_fila->>'descripcion',''), descripcion)
        where id = v_id;
        v_actualizados := v_actualizados + 1;
      else
        insert into public.categorias (nombre, descripcion)
        values (v_nombre, nullif(v_fila->>'descripcion',''));
        v_creados := v_creados + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object(
        'fila', (v_fila->>'fila_origen')::int, 'codigo', v_nombre, 'mensaje', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados, 'errores', v_errores);
end $$;
grant execute on function public.fn_importar_categorias(jsonb) to authenticated;

-- ─── 7. RPC: importar proveedores ────────────────────────────────────
create or replace function public.fn_importar_proveedores(p_filas jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_fila jsonb; v_id integer; v_nombre text;
  v_creados integer := 0; v_actualizados integer := 0;
  v_errores jsonb := '[]'::jsonb;
begin
  if not public.fn_tiene_permiso('configuracion') then
    raise exception 'Sin permiso para importar proveedores';
  end if;
  for v_fila in select * from jsonb_array_elements(p_filas) loop
    begin
      v_nombre := nullif(btrim(v_fila->>'nombre'), '');
      if v_nombre is null then continue; end if;
      select id into v_id from public.proveedores where lower(nombre) = lower(v_nombre) limit 1;
      if v_id is not null then
        update public.proveedores set
          telefono      = coalesce(nullif(v_fila->>'telefono',''), telefono),
          email         = coalesce(nullif(v_fila->>'email',''), email),
          cuit          = coalesce(nullif(v_fila->>'cuit',''), cuit),
          razon_social  = coalesce(nullif(v_fila->>'razon_social',''), razon_social),
          condicion_iva = coalesce(nullif(v_fila->>'condicion_iva',''), condicion_iva),
          domicilio     = coalesce(nullif(v_fila->>'domicilio',''), domicilio)
        where id = v_id;
        v_actualizados := v_actualizados + 1;
      else
        insert into public.proveedores (nombre, telefono, email, cuit, razon_social, condicion_iva, domicilio)
        values (
          v_nombre, nullif(v_fila->>'telefono',''), nullif(v_fila->>'email',''),
          nullif(v_fila->>'cuit',''), nullif(v_fila->>'razon_social',''),
          nullif(v_fila->>'condicion_iva',''), nullif(v_fila->>'domicilio',''));
        v_creados := v_creados + 1;
      end if;
    exception when others then
      v_errores := v_errores || jsonb_build_object(
        'fila', (v_fila->>'fila_origen')::int, 'codigo', v_nombre, 'mensaje', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('creados', v_creados, 'actualizados', v_actualizados, 'errores', v_errores);
end $$;
grant execute on function public.fn_importar_proveedores(jsonb) to authenticated;

-- ─── 8. Recargar el schema cache de PostgREST ────────────────────────
notify pgrst, 'reload schema';
