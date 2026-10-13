-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Script (NO migración, solo lectura) · D7: ¿quedan conteos viejos   ║
-- ║  sin aprobar?                                                       ║
-- ║                                                                     ║
-- ║  "Conteos de mercadería" (tablas conteos / conteos_items) se        ║
-- ║  esconde de la app (lib/config/inventario.ts,                       ║
-- ║  MOSTRAR_CONTEOS_ASIGNADOS = false). Una vez escondido ya no se     ║
-- ║  pueden aprobar desde la app. Correr esto en PRODUCCIÓN antes de    ║
-- ║  publicar el cambio:                                                ║
-- ║   · estado 'contado' = el empleado ya contó y falta aprobar. Si     ║
-- ║     tiene diferencias, aprobarlo antes (Stock › Control de stock ›  ║
-- ║     Conteo, en la versión actual) o volver a contar esos productos  ║
-- ║     con el Conteo físico por zonas.                                 ║
-- ║   · estado 'pendiente' = nadie lo contó; se puede abandonar.        ║
-- ║  No borra ni cambia nada.                                           ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- 1. Resumen por estado
select estado, count(*) as conteos, max(fecha_creacion) as el_mas_nuevo
from public.conteos
group by estado
order by estado;

-- 2. Detalle de los que no están aprobados
select c.id,
       c.nombre,
       c.estado,
       c.fecha_creacion,
       c.fecha_conteo,
       ua.nombre as asignado_a,
       count(i.id) as productos,
       count(i.id) filter (where i.contado) as contados,
       count(i.id) filter (
         where i.contado and i.cantidad_contada is distinct from i.stock_sistema
       ) as con_diferencia
from public.conteos c
left join public.usuarios ua on ua.id = c.usuario_asignado
left join public.conteos_items i on i.conteo_id = c.id
where c.estado <> 'aprobado'
group by c.id, ua.nombre
order by c.fecha_creacion desc;
