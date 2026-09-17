-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migration 199 · Lo que el local real necesita del mapa             ║
-- ║                                                                     ║
-- ║  El documento "Mapeo comercial y operativo" describe el local con   ║
-- ║  datos que el árbol de ubicaciones (mig 170) no sabía guardar:      ║
-- ║   · tipo_mueble        → góndola, isla, heladera, freezer,          ║
-- ║                          mostrador, exhibidor, estantería, mesa.    ║
-- ║                          Permite separar frío de seco.              ║
-- ║   · categoria_id       → qué categoría va en ese espacio            ║
-- ║                          ("Divisor 03 = Librería"). Base para       ║
-- ║                          detectar productos fuera de lugar.         ║
-- ║   · marca_exclusiva_id → heladeras de marca (Coca-Cola, Pepsi…).    ║
-- ║   · responsable_id     → a quién le llegan las tareas del sector.   ║
-- ║                                                                     ║
-- ║  Todo nullable y heredable: si un estante no tiene categoría o      ║
-- ║  responsable, vale el de su góndola o su sector.                    ║
-- ║  Las RLS de ubicaciones (mig 170) cubren las columnas nuevas.       ║
-- ║                                                                     ║
-- ║  Después: types/database.ts (UbicacionRow/Insert/Update).           ║
-- ║  REQUIERE: migs 170 y 177. Ejecutar UNA sola vez, COMPLETO.         ║
-- ╚════════════════════════════════════════════════════════════════════╝

alter table public.ubicaciones
  add column if not exists tipo_mueble text
    check (tipo_mueble is null or tipo_mueble in
      ('gondola', 'isla', 'heladera', 'freezer', 'mostrador', 'exhibidor', 'estanteria', 'mesa')),
  add column if not exists categoria_id integer
    references public.categorias(id) on delete set null,
  add column if not exists marca_exclusiva_id integer
    references public.marcas(id) on delete set null,
  add column if not exists responsable_id uuid
    references public.usuarios(id) on delete set null;

comment on column public.ubicaciones.tipo_mueble is
  'Qué mueble es: gondola, isla, heladera, freezer, mostrador, exhibidor,
   estanteria o mesa. heladera y freezer cuentan como frío.';
comment on column public.ubicaciones.categoria_id is
  'Categoría que debería haber en este espacio. NULL = hereda del padre o sin
   asignar. La regla de alerta fuera_de_lugar la compara con la del producto.';
comment on column public.ubicaciones.marca_exclusiva_id is
  'Marca dueña del mueble (heladera de marca). La regla marca_ajena avisa si
   hay productos de otra marca adentro.';
comment on column public.ubicaciones.responsable_id is
  'Encargado del sector o mueble: se precarga como responsable al crear tareas
   desde alertas de productos ubicados acá. Hereda del padre.';

create index if not exists ubicaciones_categoria_idx on public.ubicaciones(categoria_id);
create index if not exists ubicaciones_responsable_idx on public.ubicaciones(responsable_id);

notify pgrst, 'reload schema';

-- Verificación (debe dar 4):
select count(*) as columnas_nuevas
from information_schema.columns
where table_schema = 'public' and table_name = 'ubicaciones'
  and column_name in ('tipo_mueble', 'categoria_id', 'marca_exclusiva_id', 'responsable_id');
