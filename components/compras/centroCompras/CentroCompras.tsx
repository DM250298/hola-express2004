'use client'

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Centro de Compras — contenedor                                        ║
// ║                                                                        ║
// ║  Un solo fetch (fn_sugerencias_compra sin filtro, ~4000 filas) y el    ║
// ║  agrupado por proveedor en memoria. Los estados visuales               ║
// ║  (rojo/naranja/verde/gris + sobrestock) se calculan acá con el motor   ║
// ║  TS (lib/compras/cobertura.ts) para poder tunearlos sin migración.     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useSugerenciasCompra } from '@/lib/hooks/useCompras'
import { useConfigCompras } from '@/lib/hooks/useHistorialCostos'
import { clasificarEstado, esSobrestock } from '@/lib/compras/cobertura'
import type { EstadoCobertura } from '@/lib/compras/tiposCobertura'
import type { SugerenciaCompra } from '@/lib/queries/compras'
import { ResumenProveedores } from './ResumenProveedores'
import { TablaSugerencias } from './TablaSugerencias'

/** Fila del RPC + estado visual calculado en el cliente. */
export interface SugerenciaFila extends SugerenciaCompra {
  estado: EstadoCobertura
  es_sobrestock: boolean
  /** 0 sin stock · 1 necesita compra · 2 cerca · 3 normal · 4 sobrestock · 5 sin ventas. */
  urgencia: number
}

/** Grupo por proveedor con sus contadores para las cards del resumen. */
export interface GrupoProveedor {
  proveedor_id: number | null
  proveedor_nombre: string
  filas: SugerenciaFila[]
  sinStock: number
  necesitanCompra: number
  cerca: number
  sobrestock: number
  sinVentas: number
  /** Σ sugerido × costo. 0 para usuarios sin permiso 'costos' (el RPC gatea). */
  totalSugerido: number
}

function enriquecer(
  f: SugerenciaCompra,
  umbralSobrestock: number | null
): SugerenciaFila {
  const estado = clasificarEstado({
    ventaDiaria: f.venta_diaria,
    stockActual: f.stock_actual,
    disponible: f.stock_actual + f.stock_en_transito,
    puntoReposicion: f.punto_reposicion,
    requiereCompra: f.requiere_compra,
  })
  const sobre = esSobrestock(
    f.dias_stock,
    f.dias_cobertura_objetivo,
    umbralSobrestock
  )
  const urgencia =
    estado === 'rojo'
      ? f.stock_actual <= 0
        ? 0
        : 1
      : estado === 'naranja'
        ? 2
        : estado === 'verde'
          ? sobre
            ? 4
            : 3
          : 5
  return { ...f, estado, es_sobrestock: sobre, urgencia }
}

export function CentroCompras() {
  const { data, isLoading, isError, error } = useSugerenciasCompra()
  const { data: config } = useConfigCompras()
  // undefined = resumen; {proveedorId} = tabla de ese proveedor (null = sin proveedor)
  const [seleccion, setSeleccion] = useState<
    { proveedorId: number | null } | undefined
  >(undefined)

  const filas = useMemo(() => {
    if (!data) return []
    const umbral = config?.umbral_sobrestock_dias ?? null
    return data.map((f) => enriquecer(f, umbral))
  }, [data, config?.umbral_sobrestock_dias])

  const grupos = useMemo(() => {
    const mapa = new Map<number | null, GrupoProveedor>()
    for (const f of filas) {
      let g = mapa.get(f.proveedor_id)
      if (!g) {
        g = {
          proveedor_id: f.proveedor_id,
          proveedor_nombre: f.proveedor_nombre ?? 'Sin proveedor',
          filas: [],
          sinStock: 0,
          necesitanCompra: 0,
          cerca: 0,
          sobrestock: 0,
          sinVentas: 0,
          totalSugerido: 0,
        }
        mapa.set(f.proveedor_id, g)
      }
      g.filas.push(f)
      if (f.urgencia === 0) g.sinStock++
      if (f.requiere_compra) g.necesitanCompra++
      if (f.estado === 'naranja') g.cerca++
      if (f.es_sobrestock) g.sobrestock++
      if (f.estado === 'gris') g.sinVentas++
      g.totalSugerido += f.cantidad_sugerida_redondeada * f.precio_costo
    }
    // Proveedores que requieren acción primero; "Sin proveedor" al final.
    return Array.from(mapa.values()).sort((a, b) => {
      if (a.proveedor_id === null) return 1
      if (b.proveedor_id === null) return -1
      if (b.sinStock !== a.sinStock) return b.sinStock - a.sinStock
      if (b.necesitanCompra !== a.necesitanCompra)
        return b.necesitanCompra - a.necesitanCompra
      return a.proveedor_nombre.localeCompare(b.proveedor_nombre, 'es-AR')
    })
  }, [filas])

  const grupoSeleccionado = useMemo(
    () =>
      seleccion === undefined
        ? undefined
        : grupos.find((g) => g.proveedor_id === seleccion.proveedorId),
    [grupos, seleccion]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[#6f3a2a]">
        <Loader2 className="h-5 w-5 animate-spin" />
        Calculando la cobertura del catálogo…
      </div>
    )
  }

  if (isError) {
    const migracionPendiente =
      (error as { code?: string })?.code === 'PGRST202'
    return (
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center space-y-2">
        <AlertTriangle className="h-6 w-6 text-[#c43e2c] mx-auto" />
        {migracionPendiente ? (
          <>
            <p className="text-[#391511] font-semibold">
              Falta correr la migración 151
            </p>
            <p className="text-[#6f3a2a] text-sm">
              El Centro de Compras usa fn_sugerencias_compra
              (151_compras_por_cobertura.sql). Corré la migración en el SQL
              Editor de Supabase y recargá.
            </p>
          </>
        ) : (
          <p className="text-[#c43e2c] text-sm">
            No se pudieron cargar las sugerencias de compra.
          </p>
        )}
      </div>
    )
  }

  if (grupoSeleccionado) {
    return (
      <TablaSugerencias
        grupo={grupoSeleccionado}
        onVolver={() => setSeleccion(undefined)}
      />
    )
  }

  return (
    <ResumenProveedores
      grupos={grupos}
      onElegir={(proveedorId) => setSeleccion({ proveedorId })}
    />
  )
}
