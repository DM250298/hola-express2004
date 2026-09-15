'use client'

import { useMemo, useState } from 'react'
import { Loader2, MapPin, PackageSearch } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { getProductoByBarcode } from '@/lib/queries/productos'
import {
  asignarUbicacionPrincipal,
  agregarUbicacionSecundaria,
  getUbicacionesProducto,
  rutaUbicacion,
} from '@/lib/queries/ubicaciones'
import { useArbolUbicaciones, MAPA_KEY } from '@/lib/hooks/useMapa'
import { useQueryClient } from '@tanstack/react-query'
import { EscanerCamara } from './EscanerCamara'

interface Asignado {
  id: number
  nombre: string
  como: 'principal' | 'secundaria' | 'ya estaba'
}

/**
 * Carga del mapa por escaneo en cadena (Fase B2): elegís una ubicación del
 * árbol y escaneás productos uno atrás de otro. Regla igual que el conteo
 * anclado: PRINCIPAL si el producto no tenía ninguna; si ya tenía, queda
 * como secundaria (no se pisan asignaciones hechas a mano).
 */
export function AsignarUbicacionMovil() {
  const { data: arbol } = useArbolUbicaciones()
  const qc = useQueryClient()
  const [ubicacion, setUbicacion] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [asignados, setAsignados] = useState<Asignado[]>([])

  const opciones = useMemo(() => {
    if (!arbol) return []
    return arbol.planas
      .filter((u) => u.activo && u.tipo !== 'sucursal')
      .map((u) => ({ id: u.id, ruta: rutaUbicacion(u.id, arbol.planas) }))
      .sort((a, b) => a.ruta.localeCompare(b.ruta, 'es-AR'))
  }, [arbol])

  if (arbol === null) {
    return (
      <div className="rounded-2xl border-2 border-[#e4a42a]/50 bg-[#f9b44c]/10 p-5 text-sm text-[#6f3a2a]">
        Falta correr la migración 170 (mapa del local) para usar esta pantalla.
      </div>
    )
  }

  async function alEscanear(codigo: string) {
    const ubicacionId = Number.parseInt(ubicacion, 10)
    if (!ubicacionId) {
      toast.error('Primero elegí la ubicación donde estás parado.')
      return
    }
    if (ocupado) return
    setOcupado(true)
    try {
      const prod = await getProductoByBarcode(codigo)
      if (!prod) {
        toast.error(`No encontré un producto con el código ${codigo}`)
        return
      }
      const filas = (await getUbicacionesProducto(prod.id)) ?? []
      const yaAca = filas.some((f) => f.ubicacion_id === ubicacionId)
      const tienePrincipal = filas.some((f) => f.es_principal)

      let como: Asignado['como']
      if (yaAca) {
        como = 'ya estaba'
      } else if (!tienePrincipal) {
        await asignarUbicacionPrincipal(prod.id, ubicacionId)
        como = 'principal'
      } else {
        await agregarUbicacionSecundaria(prod.id, ubicacionId)
        como = 'secundaria'
      }

      setAsignados((prev) =>
        [
          { id: prod.id, nombre: prod.nombre, como },
          ...prev.filter((a) => a.id !== prod.id),
        ].slice(0, 15)
      )
      if (como === 'ya estaba') {
        toast.info(`${prod.nombre} ya estaba en esta ubicación`)
      } else {
        toast.success(`${prod.nombre} → ${como}`)
      }
      qc.invalidateQueries({ queryKey: [...MAPA_KEY, 'arbol'] })
      qc.invalidateQueries({ queryKey: [...MAPA_KEY, 'producto', prod.id] })
    } catch (e) {
      toast.error(
        `No se pudo asignar: ${e instanceof Error ? e.message : 'error'}`
      )
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
        <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
          <MapPin className="h-3.5 w-3.5" />
          ¿Dónde estás parado?
        </label>
        <select
          value={ubicacion}
          onChange={(e) => setUbicacion(e.target.value)}
          className={cn(
            'h-11 w-full rounded-xl border border-[#e4c9b0] bg-white px-3 text-base text-[#391511]',
            'focus:outline-none focus:ring-2 focus:ring-[#f9b44c]/50'
          )}
        >
          <option value="">Elegir ubicación…</option>
          {opciones.map((o) => (
            <option key={o.id} value={o.id}>
              {o.ruta}
            </option>
          ))}
        </select>
        {opciones.length === 0 && (
          <p className="mt-2 text-xs text-[#c8a58a]">
            Primero cargá góndolas en el Mapa del local (escritorio).
          </p>
        )}
      </div>

      {ubicacion !== '' && (
        <EscanerCamara
          onDetectado={alEscanear}
          ayuda="Escaneá los productos de esta ubicación, uno atrás de otro"
        />
      )}

      {ocupado && (
        <p className="flex items-center justify-center gap-2 text-sm text-[#6f3a2a]">
          <Loader2 className="h-4 w-4 animate-spin" /> Asignando…
        </p>
      )}

      {asignados.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
            Asignados recién ({asignados.length})
          </p>
          <ul className="space-y-2">
            {asignados.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#e4c9b0]/60 bg-white px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#391511]">
                  {a.nombre}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                    a.como === 'principal'
                      ? 'bg-[#f9b44c]/25 text-[#9e6b15]'
                      : a.como === 'secundaria'
                        ? 'bg-[#1e5fb0]/10 text-[#1e5fb0]'
                        : 'bg-[#e4c9b0]/40 text-[#6f3a2a]'
                  )}
                >
                  {a.como}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        ubicacion !== '' &&
        !ocupado && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-6 text-center text-sm text-[#6f3a2a]">
            <PackageSearch className="h-6 w-6 text-[#c8a58a]" />
            Escaneá el primer producto de esta ubicación.
          </div>
        )
      )}
    </div>
  )
}
