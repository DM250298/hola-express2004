'use client'

import { useEffect, useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAplicarSancion, useIncidenciasEmpleado } from '@/lib/hooks/useIncidencias'
import { hoyAr } from './asistenciaConstantes'
import { fechaCortaLocal } from './constantes'
import { ORDEN_TIPOS_SANCION, TIPOS_SANCION } from './incidenciasConstantes'
import type { TipoSancion } from '@/types/database'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  empleadoId: number
  nombre: string
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const claseTextarea =
  'w-full rounded-md border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] disabled:opacity-50 resize-none'

export function ModalSancion({ abierto, onCambioAbierto, empleadoId, nombre }: Props) {
  const aplicar = useAplicarSancion()
  const { data: incidencias } = useIncidenciasEmpleado(abierto ? empleadoId : null)

  const [tipo, setTipo] = useState<TipoSancion>('apercibimiento')
  const [fecha, setFecha] = useState(hoyAr())
  const [motivo, setMotivo] = useState('')
  const [dias, setDias] = useState('')
  const [acta, setActa] = useState('')
  const [resolucion, setResolucion] = useState('')
  const [vinculadas, setVinculadas] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (!abierto) return
    setTipo('apercibimiento')
    setFecha(hoyAr())
    setMotivo('')
    setDias('')
    setActa('')
    setResolucion('')
    setVinculadas(new Set())
  }, [abierto])

  const itemsTipo: Record<string, string> = Object.fromEntries(
    ORDEN_TIPOS_SANCION.map((t) => [t, TIPOS_SANCION[t].label])
  )

  const requiereDias = tipo === 'suspension'
  const requiereActa = tipo === 'suspension' || tipo === 'exclusion'
  const diasNum = Number(dias)
  const diasOk = !requiereDias || (Number.isInteger(diasNum) && diasNum >= 1 && diasNum <= 30)
  const actaOk = !requiereActa || acta.trim().length > 0

  const procesando = aplicar.isPending
  const puedeGuardar = motivo.trim().length > 0 && !!fecha && diasOk && actaOk && !procesando

  // Candidatas a vincular: últimos 90 días, más recientes primero.
  const candidatas = (incidencias ?? []).slice(0, 30)

  function toggle(id: number) {
    setVinculadas((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function guardar() {
    if (!puedeGuardar) return
    aplicar.mutate(
      {
        empleadoId,
        tipo,
        fecha,
        motivo: motivo.trim(),
        dias: requiereDias ? diasNum : null,
        incidenciaIds: Array.from(vinculadas),
        referenciaActa: acta.trim() || null,
        resolucion: resolucion.trim() || null,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-[#c43e2c]" />
            Aplicar sanción formal
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {nombre} · Estatuto art. 13. Solo Dirección. Salvo el llamado de
            atención, queda en el legajo (art. 18).
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[64vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Tipo</Label>
              <Select
                items={itemsTipo}
                value={tipo}
                onValueChange={(v) => v && setTipo(v as TipoSancion)}
                disabled={procesando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(itemsTipo).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[#c8a58a] text-[11px]">{TIPOS_SANCION[tipo].ayuda}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Fecha</Label>
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
            </div>
          </div>

          {requiereDias && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Días de suspensión (1 a 30)</Label>
              <Input
                type="number"
                min="1"
                max="30"
                step="1"
                value={dias}
                onChange={(e) => setDias(e.target.value)}
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
              {dias && !diasOk && (
                <p className="text-[#c43e2c] text-xs">Entre 1 y 30 días.</p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Motivo</Label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Hechos que fundamentan la sanción."
              disabled={procesando}
              className={claseTextarea}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Acta / sumario {requiereActa ? '' : '(opcional)'}
              </Label>
              <Input
                value={acta}
                onChange={(e) => setActa(e.target.value)}
                placeholder="Ej: Acta CA 12/2026"
                disabled={procesando}
                className={claseInput}
              />
              {requiereActa && !actaOk && (
                <p className="text-[#c43e2c] text-xs">Obligatorio para suspensión y exclusión.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Resolución (opcional)</Label>
              <Input
                value={resolucion}
                onChange={(e) => setResolucion(e.target.value)}
                placeholder="Nº o referencia"
                disabled={procesando}
                className={claseInput}
              />
            </div>
          </div>

          {candidatas.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Incidencias que fundamentan (se cierran al aplicar)
              </Label>
              <ul className="rounded-xl border border-[#e4c9b0]/60 divide-y divide-[#e4c9b0]/40 max-h-44 overflow-y-auto">
                {candidatas.map((i) => (
                  <li key={i.id}>
                    <label className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-[#fdfaf6]">
                      <input
                        type="checkbox"
                        checked={vinculadas.has(i.id)}
                        onChange={() => toggle(i.id)}
                        disabled={procesando}
                        className="mt-1 accent-[#f9b44c]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-[#391511]">
                          <span className="tabular-nums text-[#c8a58a]">{fechaCortaLocal(i.fecha)}</span>
                          {' · '}
                          {i.tipologias_incidencia?.nombre ?? 'Incidencia'}
                          <span
                            className={cn(
                              'ml-1.5 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full',
                              i.estado === 'abierta'
                                ? 'bg-[#f9b44c]/30 text-[#391511]'
                                : 'bg-[#f3ece4] text-[#c8a58a]'
                            )}
                          >
                            {i.estado}
                          </span>
                        </span>
                        <span className="block text-xs text-[#6f3a2a] truncate">{i.descripcion}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#c43e2c] hover:bg-[#a83424] text-white font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Aplicando…
              </>
            ) : (
              `Aplicar ${TIPOS_SANCION[tipo].label.toLowerCase()}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
