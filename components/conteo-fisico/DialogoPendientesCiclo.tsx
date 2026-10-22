'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatearFechaCorta, formatearNumero } from '@/lib/utils/formato'
import { CANTIDAD_PARCIAL_SUGERIDA } from '@/lib/config/inventario'
import { agruparPorLugar } from '@/lib/conteo/tareas'
import { cantidadSugerida, parsearEntero, type ResumenClase } from '@/lib/conteo/ciclo'
import type { ConteoPendienteRow } from '@/types/database'

interface Props {
  resumen: ResumenClase
  /** Lo que falta contar de la clase, en orden de recorrido. */
  filas: ConteoPendienteRow[]
  dias: number
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Por qué no se puede mandar a contar ahora. null = se puede. */
  motivoNoMandar: string | null
  onMandar: (cantidad: number) => void
}

/**
 * Qué falta contar de una clase, agrupado por lugar del mapa, con cuándo se
 * contó por última vez cada producto. Desde acá se manda a contar una tanda:
 * los primeros N del recorrido que no estén ya en una tarea abierta.
 */
export function DialogoPendientesCiclo({
  resumen,
  filas,
  dias,
  abierto,
  onCambioAbierto,
  motivoNoMandar,
  onMandar,
}: Props) {
  const aMandar = resumen.pendientes - resumen.en_curso
  const [cantidadTxt, setCantidadTxt] = useState(
    String(cantidadSugerida(resumen.pendientes, resumen.en_curso, CANTIDAD_PARCIAL_SUGERIDA))
  )
  const [lugarAbierto, setLugarAbierto] = useState<string | null>(null)
  const grupos = useMemo(() => agruparPorLugar(filas), [filas])
  const cantidad = Math.min(parsearEntero(cantidadTxt) ?? 0, aMandar)

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            {resumen.etiqueta}: {formatearNumero(resumen.pendientes)} por contar
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {formatearNumero(resumen.contados)} de {formatearNumero(resumen.total)} ya
            se contaron en los últimos {dias} días.
            {resumen.en_curso > 0 &&
              ` ${formatearNumero(resumen.en_curso)} están en una tarea de la sesión en curso.`}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-1.5">
          {grupos.map((g) => {
            const desplegado = lugarAbierto === g.lugar
            return (
              <li key={g.lugar} className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6]">
                <button
                  type="button"
                  onClick={() => setLugarAbierto(desplegado ? null : g.lugar)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                  aria-expanded={desplegado}
                >
                  <span className="min-w-0 truncate text-sm font-semibold text-[#391511]">
                    {g.lugar}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-[#6f3a2a]">
                    {formatearNumero(g.items.length)}
                    <ChevronDown
                      className={cn('h-3.5 w-3.5 transition-transform', desplegado && 'rotate-180')}
                    />
                  </span>
                </button>
                {desplegado && (
                  <ol className="space-y-1 border-t border-[#e4c9b0]/50 px-3 py-2">
                    {g.items.map((p) => (
                      <li key={p.producto_id} className="text-xs">
                        <span className="font-medium text-[#391511]">{p.nombre}</span>
                        <span className="text-[#6f3a2a]">
                          {p.codigo_barras && ` · ${p.codigo_barras}`}
                          {' · '}
                          {p.en_tarea_abierta
                            ? 'en una tarea de la sesión en curso'
                            : p.ultimo_ts
                              ? `último conteo ${formatearFechaCorta(p.ultimo_ts)}${p.ultima_sesion ? ` (${p.ultima_sesion})` : ''}`
                              : 'nunca contado'}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>

        <DialogFooter className="flex-col gap-2 sm:flex-col sm:items-stretch">
          {motivoNoMandar ? (
            <p className="text-xs text-[#a3641c]">{motivoNoMandar}</p>
          ) : aMandar === 0 ? (
            <p className="text-xs text-[#6f3a2a]">
              Todo lo pendiente ya está en una tarea de la sesión en curso.
            </p>
          ) : (
            <label className="flex flex-wrap items-center gap-2 text-xs text-[#6f3a2a]">
              Mandar a contar
              <Input
                type="number"
                min="1"
                max={aMandar}
                inputMode="numeric"
                value={cantidadTxt}
                onChange={(e) => setCantidadTxt(e.target.value)}
                aria-label="Cantidad a mandar a contar"
                className="h-8 w-20 border-[#e4c9b0] bg-white"
              />
              de {formatearNumero(aMandar)}, los primeros del recorrido. Lo que ya se
              contó en los últimos {dias} días no entra.
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              className="border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cerrar
            </Button>
            <Button
              type="button"
              onClick={() => onMandar(cantidad)}
              disabled={cantidad === 0 || motivoNoMandar !== null}
              className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Mandar a contar {cantidad > 0 && formatearNumero(cantidad)}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
