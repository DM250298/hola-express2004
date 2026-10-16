'use client'

import { useEffect, useState } from 'react'
import { Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ESTILO_TURNO, NOMBRE_TURNO } from './asistenciaConstantes'
import { etiquetaHorasCorta } from './cronogramaCalculos'
import { useGuardarDotacion } from '@/lib/hooks/useDotacion'
import { cn } from '@/lib/utils'
import type { DotacionRequeridaInsert, DotacionRequeridaRow, TurnoPlantillaRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  turnos: TurnoPlantillaRow[]
  dotacion: DotacionRequeridaRow[]
}

/** Columnas: "Todos" (dia_semana null) y lunes…domingo (1…6, 0). */
const COLUMNAS: { clave: string; dia: number | null; label: string }[] = [
  { clave: 'todos', dia: null, label: 'Todos' },
  { clave: '1', dia: 1, label: 'Lun' },
  { clave: '2', dia: 2, label: 'Mar' },
  { clave: '3', dia: 3, label: 'Mié' },
  { clave: '4', dia: 4, label: 'Jue' },
  { clave: '5', dia: 5, label: 'Vie' },
  { clave: '6', dia: 6, label: 'Sáb' },
  { clave: '0', dia: 0, label: 'Dom' },
]

const k = (turnoId: number, clave: string) => `${turnoId}|${clave}`

/** Mínimo de personas por turno y día. Vacío = sin configurar (la UI no inventa mínimos). */
export function ModalDotacion({ abierto, onCambioAbierto, turnos, dotacion }: Props) {
  const guardar = useGuardarDotacion()
  const [valores, setValores] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!abierto) return
    const v: Record<string, string> = {}
    for (const d of dotacion) v[k(d.turno_id, d.dia_semana === null ? 'todos' : String(d.dia_semana))] = String(d.minimo)
    setValores(v)
  }, [abierto, dotacion])

  const activos = turnos.filter((t) => t.activo)

  function onGuardar() {
    const filas: DotacionRequeridaInsert[] = []
    for (const t of activos) {
      for (const c of COLUMNAS) {
        const raw = (valores[k(t.id, c.clave)] ?? '').trim()
        if (raw === '') continue
        const n = Number(raw)
        if (!Number.isInteger(n) || n < 0) continue
        filas.push({ turno_id: t.id, dia_semana: c.dia, minimo: n })
      }
    }
    guardar.mutate(filas, { onSuccess: () => onCambioAbierto(false) })
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !guardar.isPending && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Users className="h-5 w-5 text-[#f9b44c]" />
            Dotación requerida
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Mínimo de personas por turno. “Todos” aplica a cualquier día; un día cargado tiene
            prioridad. Vacío = sin configurar.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="text-left text-xs font-semibold text-[#391511] pb-2">Turno</th>
                {COLUMNAS.map((c) => (
                  <th key={c.clave} className={cn('text-center text-xs font-semibold pb-2', c.dia === 0 ? 'text-[#c43e2c]' : 'text-[#391511]')}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activos.map((t) => (
                <tr key={t.id} className="border-t border-[#e4c9b0]/40">
                  <td className="py-2 pr-2">
                    <span className={cn('inline-block h-2 w-2 rounded-full mr-1.5', ESTILO_TURNO[t.nombre].punto)} />
                    <span className="font-semibold text-[#391511]">{NOMBRE_TURNO[t.nombre]}</span>
                    <span className="block text-[10px] text-[#c8a58a] tabular-nums pl-3.5">{etiquetaHorasCorta(t)}</span>
                  </td>
                  {COLUMNAS.map((c) => (
                    <td key={c.clave} className="py-2 px-0.5 text-center">
                      <input
                        type="number"
                        min={0}
                        max={30}
                        inputMode="numeric"
                        value={valores[k(t.id, c.clave)] ?? ''}
                        onChange={(e) => setValores((v) => ({ ...v, [k(t.id, c.clave)]: e.target.value }))}
                        disabled={guardar.isPending}
                        aria-label={`${NOMBRE_TURNO[t.nombre]} ${c.label}`}
                        placeholder="—"
                        className={cn(
                          'w-12 h-9 rounded-lg border text-center tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]',
                          c.dia === null ? 'border-[#f9b44c]/70 bg-[#fff8ea]' : 'border-[#e4c9b0]'
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-[#c8a58a] mt-3">
            Cuenta personas, no puestos: un mínimo de 2 no garantiza caja y fiambrería cubiertas.
          </p>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button variant="outline" onClick={() => onCambioAbierto(false)} disabled={guardar.isPending} className="flex-1 border-[#e4c9b0] text-[#6f3a2a]">
            Cancelar
          </Button>
          <Button onClick={onGuardar} disabled={guardar.isPending} className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold">
            {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar dotación'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
