'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { formatearNumero } from '@/lib/utils/formato'
import type { ConteoCoberturaRow } from '@/types/database'

interface Props {
  filas: ConteoCoberturaRow[]
  /** Botón para resolverlo (sumar tareas, volver a abrir la sesión…). */
  accion?: ReactNode
}

interface Grupo {
  clave: string
  ubicacion: string
  motivo: ConteoCoberturaRow['motivo']
  tarea: string | null
  productos: string[]
}

/**
 * Productos contados a medias: se contaron en un lugar pero viven también en
 * otro que nadie contó. El total es la suma de los lugares, así que al cerrar
 * darían un faltante que no existe. Es un aviso: el encargado decide.
 */
export function AvisoCobertura({ filas, accion }: Props) {
  const [abierto, setAbierto] = useState<string | null>(null)

  const grupos = useMemo(() => {
    const mapa = new Map<string, Grupo>()
    for (const f of filas) {
      const clave = `${f.ubicacion_id}|${f.motivo}|${f.tarea ?? ''}`
      const grupo = mapa.get(clave)
      if (grupo) grupo.productos.push(f.nombre)
      else
        mapa.set(clave, {
          clave,
          ubicacion: f.ubicacion,
          motivo: f.motivo,
          tarea: f.tarea,
          productos: [f.nombre],
        })
    }
    return [...mapa.values()].sort((a, b) => b.productos.length - a.productos.length)
  }, [filas])

  const productos = useMemo(
    () => new Set(filas.map((f) => f.producto_id)).size,
    [filas]
  )

  if (filas.length === 0) return null

  return (
    <div className="space-y-2 rounded-2xl border border-[#f9b44c] bg-[#f9b44c]/10 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#a3641c]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#391511]">
            {formatearNumero(productos)} producto{productos === 1 ? '' : 's'}{' '}
            contado{productos === 1 ? '' : 's'} a medias
          </p>
          <p className="text-xs text-[#6f3a2a]">
            Se contaron en un lugar, pero según el mapa viven también en otro
            que nadie contó. Si se ajusta así, van a figurar como faltante.
          </p>
        </div>
      </div>

      <ul className="space-y-1">
        {grupos.map((g) => (
          <li key={g.clave} className="rounded-xl bg-white">
            <button
              type="button"
              onClick={() => setAbierto((v) => (v === g.clave ? null : g.clave))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-[#391511]">{g.ubicacion}</span>
                <span className="block text-xs text-[#6f3a2a]">
                  {g.motivo === 'sin_tarea'
                    ? 'Nadie tiene este lugar en su tarea'
                    : `Quedó sin cargar en “${g.tarea}”`}
                </span>
              </span>
              <span className="shrink-0 rounded-lg bg-[#f9b44c]/25 px-2 py-0.5 text-xs font-semibold tabular-nums text-[#a3641c]">
                {formatearNumero(g.productos.length)}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[#6f3a2a] transition-transform ${abierto === g.clave ? 'rotate-180' : ''}`}
              />
            </button>
            {abierto === g.clave && (
              <ul className="max-h-40 overflow-y-auto border-t border-[#e4c9b0]/40 px-3 py-2 text-xs text-[#6f3a2a]">
                {g.productos.map((p, i) => (
                  <li key={`${p}-${i}`} className="truncate py-0.5">
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-[#6f3a2a]">
        Si el producto ya no está en ese lugar, corregilo en el mapa del local
        y el aviso desaparece.
      </p>
      {accion}
    </div>
  )
}
