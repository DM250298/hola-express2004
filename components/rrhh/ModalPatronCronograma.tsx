'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react'
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
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useGuardarPatron } from '@/lib/hooks/useCronograma'
import type { MiembroPatronInput, PatronConMiembros } from '@/lib/queries/cronograma'
import { nombreCompleto } from './constantes'
import { NOMBRE_TURNO } from './asistenciaConstantes'
import {
  ORDEN_DIAS_DEFAULT,
  TIPOS_PATRON,
  abrevDiaDesdeAncla,
  esLunes,
  lunesDe,
  nombreDiaDesdeAncla,
} from './cronogramaConstantes'
import type { TipoPatronCronograma } from '@/types/database'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  patron?: PatronConMiembros | null
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'
const SIN = '__sin__'

export function ModalPatronCronograma({ abierto, onCambioAbierto, patron }: Props) {
  const { data: empleados } = useEmpleados()
  const { data: turnos } = useTurnos()
  const guardar = useGuardarPatron()
  const editando = !!patron

  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<TipoPatronCronograma>('franco_rotativo')
  const [turnoId, setTurnoId] = useState(SIN)
  const [ancla, setAncla] = useState(lunesDe(new Date()))
  const [pivote, setPivote] = useState(SIN)
  const [miembros, setMiembros] = useState<MiembroPatronInput[]>([])
  const [ordenDias, setOrdenDias] = useState<number[]>(ORDEN_DIAS_DEFAULT)
  const [bloqueDias, setBloqueDias] = useState('7')
  const [agregar, setAgregar] = useState(SIN)

  useEffect(() => {
    if (!abierto) return
    setNombre(patron?.nombre ?? '')
    setTipo(patron?.tipo ?? 'franco_rotativo')
    setTurnoId(patron?.turno_id != null ? String(patron.turno_id) : SIN)
    setAncla(patron?.fecha_ancla ?? lunesDe(new Date()))
    setPivote(patron?.pivote_empleado_id != null ? String(patron.pivote_empleado_id) : SIN)
    setOrdenDias(patron?.orden_dias?.length ? patron.orden_dias : ORDEN_DIAS_DEFAULT)
    setBloqueDias(String(patron?.bloque_dias ?? 7))
    setMiembros(
      (patron?.patron_cronograma_miembros ?? []).map((m) => ({
        empleado_id: m.empleado_id,
        turno_id: m.turno_id,
      }))
    )
    setAgregar(SIN)
  }, [abierto, patron])

  const activos = useMemo(() => (empleados ?? []).filter((e) => e.activo), [empleados])
  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])
  const enLista = new Set(miembros.map((m) => m.empleado_id))

  const itemsTipo: Record<string, string> = Object.fromEntries(
    Object.entries(TIPOS_PATRON).map(([k, v]) => [k, v.label])
  )
  const itemsTurno: Record<string, string> = {
    [SIN]: tipo === 'franco_rotativo' ? 'Sin turno por defecto' : 'Elegí el turno',
    ...Object.fromEntries((turnos ?? []).filter((t) => t.activo).map((t) => [String(t.id), NOMBRE_TURNO[t.nombre]])),
  }
  const itemsTurnoMiembro: Record<string, string> = {
    [SIN]: 'Turno del patrón',
    ...Object.fromEntries((turnos ?? []).filter((t) => t.activo).map((t) => [String(t.id), NOMBRE_TURNO[t.nombre]])),
  }
  const itemsAgregar: Record<string, string> = {
    [SIN]: 'Agregar empleado…',
    ...Object.fromEntries(activos.filter((e) => !enLista.has(e.id)).map((e) => [String(e.id), nombreCompleto(e)])),
  }
  const itemsPivote: Record<string, string> = {
    [SIN]: 'Sin pivote (nadie cubre)',
    ...Object.fromEntries(miembros.map((m) => [String(m.empleado_id), nombrePorId.get(m.empleado_id) ?? `#${m.empleado_id}`])),
  }

  // franco_rotativo: el ancla es cualquier día (primer día de la semana 1);
  // noche_ab: tiene que ser el lunes de la semana A.
  const anclaOk = !!ancla && (tipo !== 'noche_ab' || esLunes(ancla))
  const slotsOk = tipo !== 'franco_rotativo' || ordenDias.length === miembros.length
  const minMiembros = 2
  const maxMiembros = tipo === 'noche_ab' ? 2 : 99
  const bloqueNum = Number(bloqueDias)
  const bloqueOk = tipo !== 'bloques_alternados' || (Number.isInteger(bloqueNum) && bloqueNum >= 1 && bloqueNum <= 31)
  const turnosOk =
    tipo !== 'franco_rotativo'
      ? turnoId !== SIN
      : miembros.every(
          (m) => m.turno_id != null || turnoId !== SIN || String(m.empleado_id) === pivote
        )
  const procesando = guardar.isPending
  const puedeGuardar =
    nombre.trim().length > 0 &&
    anclaOk &&
    miembros.length >= minMiembros &&
    miembros.length <= maxMiembros &&
    turnosOk &&
    slotsOk &&
    bloqueOk &&
    !procesando

  function mover(i: number, dir: -1 | 1) {
    setMiembros((prev) => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const n = [...prev]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  }

  function onGuardar() {
    if (!puedeGuardar) return
    guardar.mutate(
      {
        id: patron?.id,
        datos: {
          nombre: nombre.trim(),
          tipo,
          turno_id: turnoId === SIN ? null : Number(turnoId),
          fecha_ancla: ancla,
          orden_dias: tipo === 'franco_rotativo' ? ordenDias : ORDEN_DIAS_DEFAULT,
          bloque_dias: tipo === 'bloques_alternados' ? bloqueNum : 7,
          pivote_empleado_id: tipo === 'franco_rotativo' && pivote !== SIN ? Number(pivote) : null,
        },
        miembros,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Editar patrón' : 'Nuevo patrón de cronograma'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">{TIPOS_PATRON[tipo].ayuda}</DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[64vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-[#391511] font-medium text-sm">Nombre</Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Francos mañana y tarde"
                disabled={procesando}
                className={claseInput}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Tipo</Label>
              <Select
                items={itemsTipo}
                value={tipo}
                onValueChange={(v) => {
                  if (!v) return
                  setTipo(v as TipoPatronCronograma)
                  if (v !== 'franco_rotativo') setPivote(SIN)
                }}
                disabled={procesando || editando}
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
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                {tipo === 'franco_rotativo' ? 'Turno por defecto' : 'Turno'}
              </Label>
              <Select items={itemsTurno} value={turnoId} onValueChange={(v) => setTurnoId(v ?? SIN)} disabled={procesando}>
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
              <Label className="text-[#391511] font-medium text-sm">
                {tipo === 'noche_ab'
                  ? 'Lunes de la semana A'
                  : tipo === 'bloques_alternados'
                    ? 'Primer día del primer bloque (del 1º)'
                    : 'Primer día de la semana 1'}
              </Label>
              <Input
                type="date"
                value={ancla}
                onChange={(e) => setAncla(e.target.value)}
                disabled={procesando}
                className={cn(claseInput, 'tabular-nums', !anclaOk && 'border-[#c43e2c]')}
              />
              <p className={cn('text-[11px]', anclaOk ? 'text-[#c8a58a]' : 'text-[#c43e2c]')}>
                {!anclaOk
                  ? 'Tiene que ser un lunes.'
                  : tipo === 'noche_ab'
                    ? 'Esa semana es la "A".'
                    : tipo === 'bloques_alternados'
                      ? `Desde ese ${nombreDiaDesdeAncla(ancla, 0)} trabaja el 1º; cada bloque arranca un ${nombreDiaDesdeAncla(ancla, 0)}.`
                      : `La semana arranca en ${nombreDiaDesdeAncla(ancla, 0)}; ese día descansa el 1º de la lista.`}
              </p>
            </div>
            {tipo === 'bloques_alternados' && (
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm">Días corridos por persona</Label>
                <Input
                  type="number"
                  min="1"
                  max="31"
                  value={bloqueDias}
                  onChange={(e) => setBloqueDias(e.target.value)}
                  disabled={procesando}
                  className={cn(claseInput, 'tabular-nums', !bloqueOk && 'border-[#c43e2c]')}
                />
                <p className="text-[#c8a58a] text-[11px]">Ej: 7 = una semana cada uno.</p>
              </div>
            )}
            {tipo === 'franco_rotativo' && (
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm">Pivote (cubre francos)</Label>
                <Select items={itemsPivote} value={pivote} onValueChange={(v) => setPivote(v ?? SIN)} disabled={procesando}>
                  <SelectTrigger className={`w-full ${claseInput}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(itemsPivote).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {tipo === 'franco_rotativo' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-[#391511] font-medium text-sm">Días con franco, en orden de rotación</Label>
                <button
                  type="button"
                  onClick={() => setOrdenDias(ORDEN_DIAS_DEFAULT)}
                  disabled={procesando}
                  className="text-[11px] text-[#6f3a2a] hover:underline"
                >
                  Todos en orden
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 7 }, (_, p) => {
                  const slot = ordenDias.indexOf(p)
                  const activo = slot >= 0
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={procesando}
                      onClick={() =>
                        setOrdenDias((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))
                      }
                      className={cn(
                        'h-9 min-w-[64px] rounded-lg border px-2 text-xs font-semibold capitalize transition-colors',
                        activo
                          ? 'bg-[#f9b44c]/25 border-[#f9b44c] text-[#391511]'
                          : 'bg-white border-dashed border-[#e4c9b0] text-[#c8a58a] line-through'
                      )}
                      title={activo ? `Slot ${slot + 1}` : 'Nadie descansa este día'}
                    >
                      {activo && <span className="tabular-nums text-[#c8a58a] mr-1">{slot + 1}.</span>}
                      {abrevDiaDesdeAncla(ancla, p)}
                    </button>
                  )
                })}
              </div>
              <p className="text-[#c8a58a] text-[11px]">
                Tocá los días en el orden en que avanza el franco de cada persona semana a semana. Los tachados
                son días en que nadie descansa (ej. viernes). Tiene que haber tantos días como personas en la lista.
              </p>
              {!slotsOk && miembros.length > 0 && (
                <p className="text-[#c43e2c] text-xs">
                  {ordenDias.length} día{ordenDias.length === 1 ? '' : 's'} con franco y {miembros.length} persona
                  {miembros.length === 1 ? '' : 's'}: tienen que coincidir.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[#391511] font-medium text-sm">
                {tipo === 'noche_ab'
                  ? 'Las 2 personas (1º y 2º)'
                  : tipo === 'bloques_alternados'
                    ? 'Orden de los bloques (1º arranca en el ancla)'
                    : 'Orden de la rotación'}
              </Label>
              <span className="text-[#c8a58a] text-xs">{miembros.length} en la lista</span>
            </div>
            {miembros.length === 0 ? (
              <p className="text-[#c8a58a] text-xs">
                {tipo === 'noche_ab'
                  ? 'Agregá las 2 personas.'
                  : tipo === 'bloques_alternados'
                    ? 'Agregá a las personas en el orden en que se turnan.'
                    : 'Agregá a las personas en el orden en que descansan la semana 1 (1º = primer día elegido arriba).'}
              </p>
            ) : (
              <ol className="rounded-xl border border-[#e4c9b0]/60 divide-y divide-[#e4c9b0]/40">
                {miembros.map((m, i) => (
                  <li key={m.empleado_id} className="flex items-center gap-2 px-2 py-1.5">
                    <span className="w-6 text-center text-[#c8a58a] text-xs font-bold tabular-nums">{i + 1}</span>
                    <span className="flex-1 min-w-0 text-sm text-[#391511] truncate">
                      {nombrePorId.get(m.empleado_id) ?? `#${m.empleado_id}`}
                      {String(m.empleado_id) === pivote && (
                        <span className="ml-1.5 text-[10px] uppercase font-bold text-[#2f7d4f]">pivote</span>
                      )}
                    </span>
                    {tipo === 'franco_rotativo' && String(m.empleado_id) !== pivote && (
                      <Select
                        items={itemsTurnoMiembro}
                        value={m.turno_id != null ? String(m.turno_id) : SIN}
                        onValueChange={(v) =>
                          setMiembros((prev) =>
                            prev.map((x, j) => (j === i ? { ...x, turno_id: v && v !== SIN ? Number(v) : null } : x))
                          )
                        }
                        disabled={procesando}
                      >
                        <SelectTrigger className={`h-8 w-32 text-xs ${claseInput}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(itemsTurnoMiembro).map(([v, l]) => (
                            <SelectItem key={v} value={v}>
                              {l}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button type="button" variant="ghost" size="sm" onClick={() => mover(i, -1)} disabled={i === 0 || procesando} className="h-7 w-7 p-0 text-[#6f3a2a]" aria-label="Subir">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => mover(i, 1)} disabled={i === miembros.length - 1 || procesando} className="h-7 w-7 p-0 text-[#6f3a2a]" aria-label="Bajar">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMiembros((prev) => prev.filter((_, j) => j !== i))
                        if (String(m.empleado_id) === pivote) setPivote(SIN)
                      }}
                      disabled={procesando}
                      className="h-7 w-7 p-0 text-[#c43e2c]"
                      aria-label="Quitar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            {miembros.length < maxMiembros && (
              <div className="flex gap-2">
                <Select items={itemsAgregar} value={agregar} onValueChange={(v) => setAgregar(v ?? SIN)} disabled={procesando}>
                  <SelectTrigger className={`flex-1 ${claseInput}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(itemsAgregar).map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (agregar === SIN) return
                    setMiembros((prev) => [...prev, { empleado_id: Number(agregar), turno_id: null }])
                    setAgregar(SIN)
                  }}
                  disabled={agregar === SIN || procesando}
                  className="border-[#e4c9b0] text-[#6f3a2a] gap-1"
                >
                  <Plus className="h-4 w-4" />
                  Agregar
                </Button>
              </div>
            )}
            {!turnosOk && miembros.length > 0 && (
              <p className="text-[#c43e2c] text-xs">
                {tipo !== 'franco_rotativo'
                  ? 'Elegí el turno del patrón.'
                  : 'Cada miembro (salvo el pivote) necesita turno, o definí un turno por defecto.'}
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button variant="outline" onClick={() => onCambioAbierto(false)} disabled={procesando} className="flex-1 border-[#e4c9b0] text-[#6f3a2a]">
            Cancelar
          </Button>
          <Button onClick={onGuardar} disabled={!puedeGuardar} className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50">
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : editando ? (
              'Guardar cambios'
            ) : (
              'Crear patrón'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
