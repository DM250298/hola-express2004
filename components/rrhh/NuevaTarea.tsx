'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CamposTarea, Opcion } from './CamposTarea'
import { nombreCompleto } from './constantes'
import { NOMBRE_TURNO, hoyAr } from './asistenciaConstantes'
import { AREAS } from './calendarioTurno'
import {
  aPuntual,
  aRutina,
  formularioVacio,
  resumen,
  validar,
  type FormNuevaTarea,
  type Frecuencia,
} from './nuevaTareaLogica'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import { useAQuienLeToca, useCrearTareaPuntual, useGuardarPlantilla } from '@/lib/hooks/useTareas'
import { isoMasDias } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'
import type { DatosRutina } from '@/lib/queries/tareas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Día que se está mirando en la agenda. */
  fechaDefault: string
  turnoDefault?: number | null
  frecuenciaInicial?: Frecuencia
  /** Administrador de tareas: puede crear privadas. */
  esAdmin: boolean
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'

/**
 * "Nueva tarea" (Tareas v2, Etapa 3): de una sola vez o de la rutina,
 * con horario, área, quién la hace (puesto según el cronograma o personas)
 * y el resumen "Así va a quedar". Editar sigue en ModalTarea / ModalPlantilla.
 */
export function NuevaTarea({
  abierto,
  onCambioAbierto,
  fechaDefault,
  turnoDefault = null,
  frecuenciaInicial = 'una_vez',
  esAdmin,
}: Props) {
  const { data: turnos } = useTurnos()
  const { data: empleados } = useEmpleados()
  const crear = useCrearTareaPuntual()
  const guardarRutina = useGuardarPlantilla()
  const activosTurnos = useMemo(() => (turnos ?? []).filter((t) => t.activo), [turnos])

  const [f, setF] = useState<FormNuevaTarea>(() => formularioVacio(fechaDefault, turnoDefault, frecuenciaInicial))
  const [intento, setIntento] = useState(false)
  const set = (p: Partial<FormNuevaTarea>) => setF((x) => ({ ...x, ...p }))

  useEffect(() => {
    if (!abierto) return
    setF(formularioVacio(fechaDefault, turnoDefault ?? activosTurnos[0]?.id ?? null, frecuenciaInicial))
    setIntento(false)
    // Solo al abrir: no pisar lo que se está cargando.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const turno = activosTurnos.find((t) => t.id === f.turnoId) ?? null
  // Para "le toca a": el día elegido; en la rutina, mañana (desde cuándo rige).
  const fechaConsulta = f.frecuencia === 'una_vez' ? f.fecha : isoMasDias(hoyAr(), 1)
  const { data: leToca, isFetching: buscando } = useAQuienLeToca(
    fechaConsulta,
    f.turnoId,
    !f.privada && f.quien === 'puesto' ? f.puestos : []
  )

  const activos = (empleados ?? []).filter((e) => e.activo)
  const nombrePorId = new Map(activos.map((e) => [e.id, nombreCompleto(e)]))
  const quienes =
    f.quien === 'puesto'
      ? (leToca ?? []).map((p) => p.nombre)
      : f.personas.map((id) => nombrePorId.get(id) ?? `Legajo ${id}`)

  const errores = validar(f, turno)
  const procesando = crear.isPending || guardarRutina.isPending
  const lineas = resumen(f, {
    turno,
    nombreTurno: turno ? NOMBRE_TURNO[turno.nombre] : 'sin turno',
    diaLegible: f.fecha ? format(parseISO(f.fecha), "EEEE d/MM", { locale: es }) : '—',
    nombreArea: AREAS.find((a) => a.clave === f.area)?.nombre ?? 'Sin área',
    quienes,
  })

  function guardar() {
    setIntento(true)
    if (errores.length > 0 || procesando) return
    const cerrar = { onSuccess: () => onCambioAbierto(false) }
    if (f.frecuencia === 'una_vez') {
      crear.mutate(aPuntual(f), cerrar)
    } else {
      const { datos, asignados } = aRutina(f, esAdmin)
      guardarRutina.mutate({ id: null, datos: datos as DatosRutina, asignados, aplicar: 'manana' }, cerrar)
    }
  }

  function toggle<T>(lista: T[], v: T): T[] {
    return lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">Nueva tarea</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Elegí si es algo de una sola vez o si entra en la rutina del turno.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 max-h-[68vh] overflow-y-auto text-sm">
          {/* Frecuencia */}
          <fieldset className="space-y-1.5">
            <legend className="text-[#391511] font-semibold text-sm mb-1.5">¿Cada cuánto se hace?</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['una_vez', 'Solo una vez', 'Para un día y un turno.'],
                  ['rutina', 'Se repite', 'Entra en la rutina del turno.'],
                ] as [Frecuencia, string, string][]
              ).map(([v, l, ayuda]) => (
                <Opcion key={v} activa={f.frecuencia === v} onClick={() => set({ frecuencia: v })} titulo={l} ayuda={ayuda} />
              ))}
            </div>
          </fieldset>

          <CamposTarea
            f={f}
            set={set}
            esAdmin={esAdmin}
            turnos={activosTurnos}
            empleados={activos.map((e) => ({ id: e.id, nombre: nombreCompleto(e) }))}
            quienes={quienes}
            buscando={buscando}
          />

          {/* Así va a quedar */}
          <section className="rounded-xl border border-[#e4c9b0] bg-[#fdfaf6] px-3.5 py-3 space-y-1">
            <h3 className="text-[13px] font-extrabold text-[#391511]">Así va a quedar</h3>
            {lineas.map((l, i) => (
              <p key={i} className={cn('text-[13px]', i === 0 ? 'font-semibold text-[#391511]' : 'text-[#6f3a2a]')}>
                {l}
              </p>
            ))}
          </section>

          {intento && errores.length > 0 && (
            <ul className="rounded-xl border border-[#c43e2c]/40 bg-[#c43e2c]/5 px-3.5 py-2.5 text-xs text-[#a3271d] space-y-0.5" role="alert">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {!esAdmin && (
            <p className="text-xs text-[#6f3a2a]">Lo que cargues queda en el registro de cambios y los administradores lo ven.</p>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button variant="outline" onClick={() => onCambioAbierto(false)} disabled={procesando} className="flex-1 border-[#e4c9b0] text-[#6f3a2a]">
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={procesando} className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold">
            {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar tarea'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
