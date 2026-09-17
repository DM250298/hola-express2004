'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { MapPin, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { tienePermiso } from '@/lib/permisos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  useAgregarUbicacionSecundaria,
  useArbolUbicaciones,
  useAsignarUbicacionPrincipal,
  useQuitarUbicacionProducto,
  useUbicacionesProducto,
} from '@/lib/hooks/useMapa'
import { rutaUbicacion } from '@/lib/queries/ubicaciones'

/**
 * Panel "Ubicación en el local" de la ficha de producto (Fase B).
 * Muestra dónde vive el SKU (principal + secundarias) y permite cambiarlo.
 * Si la migración 170 no corrió, no renderiza nada (fallback silencioso).
 */
export function PanelUbicacionProducto({ productoId }: { productoId: number }) {
  const { data: usuario } = useUsuario()
  const { data: arbol } = useArbolUbicaciones()
  const { data: filas } = useUbicacionesProducto(productoId)
  const asignar = useAsignarUbicacionPrincipal()
  const agregar = useAgregarUbicacionSecundaria()
  const quitar = useQuitarUbicacionProducto()

  const puedeEditar = tienePermiso(usuario?.permisos, 'inventario')
  const [editando, setEditando] = useState(false)
  const [seleccion, setSeleccion] = useState('')

  // Opciones: cualquier nodo activo salvo la sucursal raíz, con su ruta.
  const opciones = useMemo(() => {
    if (!arbol) return []
    return arbol.planas
      .filter((u) => u.activo && u.tipo !== 'sucursal')
      .map((u) => ({ id: u.id, ruta: rutaUbicacion(u.id, arbol.planas) }))
      .sort((a, b) => a.ruta.localeCompare(b.ruta, 'es-AR'))
  }, [arbol])

  // Migración 170 pendiente → el panel no existe todavía.
  if (arbol === null || filas === null) return null

  const principal = (filas ?? []).find((f) => f.es_principal)
  const secundarias = (filas ?? []).filter((f) => !f.es_principal)
  const guardando = asignar.isPending || agregar.isPending

  const confirmar = (comoPrincipal: boolean) => {
    const ubicacionId = Number.parseInt(seleccion, 10)
    if (!ubicacionId) return
    const fin = {
      onSuccess: () => {
        setEditando(false)
        setSeleccion('')
      },
    }
    if (comoPrincipal) asignar.mutate({ productoId, ubicacionId }, fin)
    else agregar.mutate({ productoId, ubicacionId }, fin)
  }

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="h-4 w-4 text-[#f9b44c]" />
        <h2 className="text-[#391511] font-bold">Ubicación en el local</h2>
        <Link
          href="/mapa"
          className="ml-auto text-xs text-[#6f3a2a] hover:text-[#391511] underline underline-offset-2"
        >
          Ver mapa
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {principal && arbol ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f9b44c]/20 border border-[#e4a42a]/50 px-2.5 py-1 text-sm font-medium text-[#391511]">
            {rutaUbicacion(principal.ubicacion_id, arbol.planas)}
            <span className="text-[9px] uppercase tracking-wider text-[#6f3a2a] font-bold">
              principal
            </span>
          </span>
        ) : (
          <span className="text-sm text-[#c8a58a]">Sin ubicación asignada</span>
        )}

        {arbol &&
          secundarias.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e4c9b0] px-2.5 py-1 text-sm text-[#6f3a2a]"
            >
              {rutaUbicacion(f.ubicacion_id, arbol.planas)}
              {puedeEditar && (
                <button
                  type="button"
                  title="Quitar"
                  onClick={() => quitar.mutate({ filaId: f.id, productoId })}
                  className="text-[#c8a58a] hover:text-[#9e2f25]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}

        {puedeEditar && !editando && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#c8a58a] px-2.5 py-1 text-sm text-[#6f3a2a] hover:border-[#391511] hover:text-[#391511]"
          >
            <Plus className="h-3.5 w-3.5" />
            {principal ? 'Cambiar / agregar' : 'Asignar ubicación'}
          </button>
        )}
      </div>

      {editando && (
        <div className="mt-3 pt-3 border-t border-[#e4c9b0]/60 flex flex-wrap items-center gap-2">
          <select
            value={seleccion}
            onChange={(e) => setSeleccion(e.target.value)}
            className={cn(
              'h-9 rounded-lg border border-[#e4c9b0] bg-white px-2 text-sm text-[#391511]',
              'focus:outline-none focus:ring-2 focus:ring-[#f9b44c]/50 min-w-56'
            )}
          >
            <option value="">Elegir ubicación…</option>
            {opciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.ruta}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!seleccion || guardando}
            onClick={() => confirmar(true)}
          >
            Fijar como principal
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!seleccion || guardando}
            onClick={() => confirmar(false)}
          >
            Agregar como secundaria
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={guardando}
            onClick={() => {
              setEditando(false)
              setSeleccion('')
            }}
          >
            Cancelar
          </Button>
          {opciones.length === 0 && (
            <span className="text-xs text-[#c8a58a]">
              Primero cargá góndolas en el mapa del local.
            </span>
          )}
        </div>
      )}
    </div>
  )
}
