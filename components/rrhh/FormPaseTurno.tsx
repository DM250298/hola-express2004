'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Save, Send, Trash2 } from 'lucide-react'
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
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import {
  useBorradorPase,
  useEntregarPaseTurno,
  useUltimoPaseRecibido,
} from '@/lib/hooks/usePaseTurno'
import { nombreCompleto } from './constantes'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { BLOQUES_PASE, turnoActualPorHora } from './paseTurnoConstantes'
import type { PendientePase } from '@/types/database'

interface Props {
  /** Legajo de quien entrega. Con 'rrhh' puede ser otro (p_saliente_empleado_id). */
  salienteEmpleadoId: number
  /** true cuando la encargada carga a nombre de otro: muestra selector de empleado. */
  puedeElegirSaliente?: boolean
  onEntregado?: () => void
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const claseTextarea =
  'w-full rounded-md border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] placeholder:text-[#c8a58a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] disabled:opacity-50 resize-none'
const SIN = '__sin__'

/** Formulario de entrega del pase (saliente). Mobile-first. */
export function FormPaseTurno({ salienteEmpleadoId, puedeElegirSaliente = false, onEntregado }: Props) {
  const { data: turnos } = useTurnos()
  const { data: empleados } = useEmpleados()
  const { data: ultimo } = useUltimoPaseRecibido()
  const entregar = useEntregarPaseTurno()

  const [fecha, setFecha] = useState(hoyAr())
  const [turnoSaliente, setTurnoSaliente] = useState<string>(SIN)
  const [turnoEntrante, setTurnoEntrante] = useState<string>(SIN)
  const [saliente, setSaliente] = useState(String(salienteEmpleadoId))
  const [reposicion, setReposicion] = useState('')
  const [orden, setOrden] = useState('')
  const [novedades, setNovedades] = useState('')
  const [pendientes, setPendientes] = useState<PendientePase[]>([])
  const [arrastrados, setArrastrados] = useState(false)

  // Preselección de turnos por hora actual (una vez que llegan los turnos).
  useEffect(() => {
    if (!turnos || turnoSaliente !== SIN) return
    const { saliente: s, entrante: e } = turnoActualPorHora(turnos)
    if (s) setTurnoSaliente(String(s.id))
    if (e) setTurnoEntrante(String(e.id))
  }, [turnos, turnoSaliente])

  const turnoSalienteId = turnoSaliente === SIN ? null : Number(turnoSaliente)
  const { data: borrador } = useBorradorPase(fecha, turnoSalienteId)

  // Si hay borrador propio para esa fecha/turno, cargarlo.
  useEffect(() => {
    if (!borrador) return
    if (borrador.estado !== 'borrador') return
    setReposicion(borrador.reposicion ?? '')
    setOrden(borrador.orden_limpieza ?? '')
    setNovedades(borrador.novedades ?? '')
    setPendientes(borrador.pendientes ?? [])
    if (borrador.turno_entrante_id) setTurnoEntrante(String(borrador.turno_entrante_id))
    setArrastrados(true)
  }, [borrador])

  // Arrastrar pendientes no hechos del último pase recibido (solo si no hay
  // borrador y todavía no se cargó nada).
  useEffect(() => {
    if (arrastrados || borrador || !ultimo) return
    const noHechos = (ultimo.pendientes ?? []).filter((p) => !p.hecho)
    if (noHechos.length > 0) setPendientes(noHechos)
    setArrastrados(true)
  }, [ultimo, borrador, arrastrados])

  const activos = useMemo(() => (empleados ?? []).filter((e) => e.activo), [empleados])
  const itemsTurno: Record<string, string> = {
    [SIN]: 'Elegí el turno',
    ...Object.fromEntries((turnos ?? []).filter((t) => t.activo).map((t) => [String(t.id), NOMBRE_TURNO[t.nombre]])),
  }
  const itemsEmpleado: Record<string, string> = Object.fromEntries(
    activos.map((e) => [String(e.id), nombreCompleto(e)])
  )
  const itemsResponsable: Record<string, string> = {
    [SIN]: 'Responsable…',
    ...itemsEmpleado,
  }

  const yaEntregado = !!borrador && borrador.estado !== 'borrador'
  const procesando = entregar.isPending
  const bloquesOk = reposicion.trim() && orden.trim() && novedades.trim()
  const pendientesOk = pendientes.every((p) => p.texto.trim() && p.responsable_empleado_id != null)
  const puedeEntregar = !!turnoSalienteId && !!bloquesOk && pendientesOk && !procesando && !yaEntregado

  function setPend(i: number, cambio: Partial<PendientePase>) {
    setPendientes((prev) => prev.map((p, j) => (j === i ? { ...p, ...cambio } : p)))
  }

  function enviar(entregarAhora: boolean) {
    if (!turnoSalienteId) return
    entregar.mutate(
      {
        fecha,
        turnoSalienteId,
        turnoEntranteId: turnoEntrante === SIN ? null : Number(turnoEntrante),
        reposicion: reposicion.trim(),
        ordenLimpieza: orden.trim(),
        novedades: novedades.trim(),
        pendientes: pendientes.map((p) => ({ ...p, texto: p.texto.trim() })),
        entregar: entregarAhora,
        // Con selector (encargada/admin) se manda siempre: la RPC lo acepta si
        // es el propio legajo o si tiene 'rrhh'. Sin selector va null y la
        // RPC usa fn_mi_empleado_id().
        salienteEmpleadoId: puedeElegirSaliente ? Number(saliente) : null,
      },
      {
        onSuccess: (p) => {
          if (p.estado === 'entregado') onEntregado?.()
        },
      }
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[#391511] font-medium text-sm">Fecha</Label>
          <Input
            type="date"
            value={fecha}
            max={hoyAr()}
            onChange={(e) => setFecha(e.target.value)}
            disabled={procesando}
            className={`${claseInput} tabular-nums`}
          />
        </div>
        {puedeElegirSaliente && (
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Entrega</Label>
            <Select items={itemsEmpleado} value={saliente} onValueChange={(v) => v && setSaliente(v)} disabled={procesando}>
              <SelectTrigger className={`w-full ${claseInput}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(itemsEmpleado).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-[#391511] font-medium text-sm">Turno que termina</Label>
          <Select items={itemsTurno} value={turnoSaliente} onValueChange={(v) => setTurnoSaliente(v ?? SIN)} disabled={procesando}>
            <SelectTrigger className={`w-full ${claseInput}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(itemsTurno).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[#391511] font-medium text-sm">Turno que entra</Label>
          <Select items={itemsTurno} value={turnoEntrante} onValueChange={(v) => setTurnoEntrante(v ?? SIN)} disabled={procesando}>
            <SelectTrigger className={`w-full ${claseInput}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(itemsTurno).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {yaEntregado && (
        <div className="rounded-xl border border-[#2f7d4f]/30 bg-[#2f7d4f]/10 px-3 py-2 text-sm text-[#2f7d4f]">
          El pase de este turno ya fue entregado
          {borrador?.estado === 'recibido' ? ' y recibido.' : '. Falta que lo reciba el turno entrante.'}
        </div>
      )}

      {BLOQUES_PASE.map((b) => {
        const valor = b.clave === 'reposicion' ? reposicion : b.clave === 'orden_limpieza' ? orden : novedades
        const set = b.clave === 'reposicion' ? setReposicion : b.clave === 'orden_limpieza' ? setOrden : setNovedades
        return (
          <div key={b.clave} className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">{b.etiqueta}</Label>
            <textarea
              value={valor}
              onChange={(e) => set(e.target.value)}
              rows={3}
              placeholder={b.ayuda}
              disabled={procesando || yaEntregado}
              className={claseTextarea}
            />
          </div>
        )
      })}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[#391511] font-medium text-sm">Pendientes (qué queda y quién lo toma)</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setPendientes((p) => [...p, { texto: '', responsable_empleado_id: null, hecho: false }])}
            disabled={procesando || yaEntregado}
            className="text-[#6f3a2a] gap-1 h-7 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </Button>
        </div>
        {pendientes.length === 0 ? (
          <p className="text-[#c8a58a] text-xs">Sin pendientes.</p>
        ) : (
          <ul className="space-y-2">
            {pendientes.map((p, i) => (
              <li key={i} className="flex gap-2 items-start">
                <Input
                  value={p.texto}
                  onChange={(e) => setPend(i, { texto: e.target.value })}
                  placeholder="Qué queda pendiente"
                  disabled={procesando || yaEntregado}
                  className={`flex-1 ${claseInput}`}
                />
                <Select
                  items={itemsResponsable}
                  value={p.responsable_empleado_id != null ? String(p.responsable_empleado_id) : SIN}
                  onValueChange={(v) => setPend(i, { responsable_empleado_id: v && v !== SIN ? Number(v) : null })}
                  disabled={procesando || yaEntregado}
                >
                  <SelectTrigger className={`w-36 sm:w-44 ${claseInput}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(itemsResponsable).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendientes((prev) => prev.filter((_, j) => j !== i))}
                  disabled={procesando || yaEntregado}
                  className="h-9 w-9 p-0 text-[#c43e2c]"
                  aria-label="Quitar pendiente"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          onClick={() => enviar(false)}
          disabled={procesando || yaEntregado || !turnoSalienteId}
          className="flex-1 border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
        >
          <Save className="h-4 w-4" />
          Guardar borrador
        </Button>
        <Button
          onClick={() => enviar(true)}
          disabled={!puedeEntregar}
          className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold gap-1.5 disabled:opacity-50"
        >
          {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Entregar turno
        </Button>
      </div>
    </div>
  )
}
