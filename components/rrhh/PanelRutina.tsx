'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CamposTarea } from './CamposTarea'
import { hoyAr } from './asistenciaConstantes'
import { aRutina, validar, type FormNuevaTarea } from './nuevaTareaLogica'
import { cambios, formDesdePlantilla, hhmm, mismosAsignados } from './rutinaCalendario'
import { useTurnos } from '@/lib/hooks/useAsistencia'
import {
  useActualizarAgendaHoy,
  useAQuienLeToca,
  useGuardarPlantilla,
  useQuitarPlantilla,
  useReactivarPlantilla,
} from '@/lib/hooks/useTareas'
import type { DatosRutina, PlantillaConAsignados } from '@/lib/queries/tareas'
import type { TurnoPlantillaRow } from '@/types/database'
import type { Borrador } from './CalendarioRutina'

interface Props {
  plantilla: PlantillaConAsignados
  turno: TurnoPlantillaRow
  /** Cambio hecho arrastrando en el calendario (todavía sin guardar). */
  borrador: Borrador | null
  esGestor: boolean
  esAdmin: boolean
  nombres: Map<number, string>
  onCerrar: () => void
  onGuardado: () => void
}

/** Panel de edición de una tarea de la rutina (Tareas v2, Etapa 4). */
export function PanelRutina({ plantilla, turno, borrador, esGestor, esAdmin, nombres, onCerrar, onGuardado }: Props) {
  const { data: turnos } = useTurnos()
  const guardar = useGuardarPlantilla()
  const actualizarHoy = useActualizarAgendaHoy()
  const quitar = useQuitarPlantilla()
  const reactivar = useReactivarPlantilla()

  const original = useMemo(() => formDesdePlantilla(plantilla, turno), [plantilla, turno])
  const [f, setF] = useState<FormNuevaTarea>(original)
  const [tambienHoy, setTambienHoy] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pidiendo, setPidiendo] = useState(false)
  const set = (p: Partial<FormNuevaTarea>) => setF((x) => ({ ...x, ...p }))

  // Lo que se arrastró en el calendario pasa al formulario.
  useEffect(() => {
    if (!borrador) return
    const inicioTurno = Number(turno.hora_inicio.slice(0, 2)) * 60 + Number(turno.hora_inicio.slice(3, 5))
    setF((x) => ({
      ...x,
      horario: 'con_horario',
      desde: hhmm(inicioTurno + borrador.inicio),
      hasta: hhmm(inicioTurno + borrador.inicio + borrador.duracion),
      area: borrador.area,
    }))
  }, [borrador, turno.hora_inicio])

  const { data: leToca, isFetching: buscando } = useAQuienLeToca(
    hoyAr(),
    f.turnoId,
    f.quien === 'puesto' && !f.privada ? f.puestos : []
  )
  const quienes =
    f.quien === 'puesto'
      ? (leToca ?? []).map((p) => p.nombre)
      : f.personas.map((id) => nombres.get(id) ?? `Legajo ${id}`)

  const base = aRutina(original, esAdmin)
  const nuevo = aRutina(f, esAdmin)
  const diff = cambios(base.datos, nuevo.datos)
  const asignadosCambian = !mismosAsignados(base.asignados, nuevo.asignados)
  const hayCambios = Object.keys(diff).length > 0 || asignadosCambian
  const errores = validar(f, turno)
  const procesando = guardar.isPending || actualizarHoy.isPending
  const pendiente = plantilla.cambios_desde && plantilla.cambios_desde > hoyAr()
  const editable = esGestor && (!plantilla.privada || esAdmin) && plantilla.activa

  function onGuardar() {
    if (!hayCambios) {
      toast.info('No hay cambios para guardar')
      return
    }
    if (errores.length) return
    guardar.mutate(
      {
        id: plantilla.id,
        datos: diff as DatosRutina,
        asignados: asignadosCambian ? nuevo.asignados : null,
        aplicar: 'manana',
      },
      {
        onSuccess: () => {
          onGuardado()
          if (tambienHoy && plantilla.turno_id !== null) {
            actualizarHoy.mutate({ turnoId: plantilla.turno_id, plantillaId: plantilla.id })
          }
        },
      }
    )
  }

  return (
    <section aria-label="Tarea de rutina" className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 space-y-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#6f3a2a]">Tarea de rutina</span>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-[#e4c9b0] hover:bg-[#fdfaf6]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!plantilla.activa && (
        <p className="rounded-xl border border-[#c43e2c]/30 bg-[#c43e2c]/5 px-3 py-2 text-xs text-[#a3271d]">
          Esta tarea está fuera de la rutina{plantilla.cambios_desde ? ` desde el ${plantilla.cambios_desde.split('-').reverse().join('/')}` : ''}.
        </p>
      )}
      {pendiente && plantilla.activa && (
        <p className="rounded-xl border border-[#f3d395] bg-[#fff6e5] px-3 py-2 text-xs text-[#4a3008]">
          Tiene cambios que rigen desde el {plantilla.cambios_desde!.split('-').reverse().join('/')}. Lo que ves es la versión
          nueva; la agenda de hoy sigue con la anterior.
        </p>
      )}
      {borrador && (
        <p className="rounded-xl border border-dashed border-[#391511] px-3 py-2 text-xs text-[#391511]">
          Movida en el calendario: {f.desde} a {f.hasta}. Revisá y tocá “Guardar cambios”.
        </p>
      )}

      {editable ? (
        <>
          <CamposTarea
            f={f}
            set={set}
            esAdmin={esAdmin}
            turnos={(turnos ?? []).filter((t) => t.activo)}
            empleados={[...nombres].map(([id, nombre]) => ({ id, nombre }))}
            quienes={quienes}
            buscando={buscando}
            ocultarPrivada
          />

          <label className="flex items-start gap-2.5 rounded-xl border border-[#e4c9b0]/60 px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={tambienHoy}
              onChange={(e) => setTambienHoy(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#391511]"
            />
            <span>
              <span className="font-semibold text-[#391511]">Actualizar también la agenda de hoy</span>
              <span className="block text-xs text-[#6f3a2a]">
                Si no, el cambio rige desde mañana. Lo que alguien ya empezó o editó a mano no se toca.
              </span>
            </span>
          </label>

          {errores.length > 0 && hayCambios && (
            <ul role="alert" className="rounded-xl border border-[#c43e2c]/40 bg-[#c43e2c]/5 px-3 py-2 text-xs text-[#a3271d]">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onCerrar} disabled={procesando} className="flex-1 border-[#e4c9b0]">
              Cancelar
            </Button>
            <Button
              onClick={onGuardar}
              disabled={procesando || !hayCambios || errores.length > 0}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
            >
              {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar cambios'}
            </Button>
          </div>

          {/* Quitar o pedir que se quite */}
          <div className="border-t border-[#e4c9b0]/60 pt-3">
            {esAdmin ? (
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm(`¿Quitar "${plantilla.titulo}" de la rutina desde mañana? No se borra: se puede volver a poner.`))
                    quitar.mutate({ id: plantilla.id, motivo: null }, { onSuccess: onCerrar })
                }}
                disabled={quitar.isPending}
                className="text-[#a3271d] hover:bg-[#c43e2c]/10 gap-1.5"
              >
                <Trash2 className="h-4 w-4" /> Quitar de la rutina
              </Button>
            ) : pidiendo ? (
              <div className="space-y-2">
                <label htmlFor="motivo-quitar" className="block text-xs font-bold text-[#391511]">
                  ¿Por qué hay que quitarla? Le llega el pedido a un administrador.
                </label>
                <textarea
                  id="motivo-quitar"
                  rows={2}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      quitar.mutate(
                        { id: plantilla.id, motivo: motivo.trim() },
                        { onSuccess: () => { setPidiendo(false); setMotivo('') } }
                      )
                    }
                    disabled={quitar.isPending || motivo.trim().length < 5}
                    className="bg-[#391511] hover:bg-[#2a0f0c] text-white"
                  >
                    Enviar pedido
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPidiendo(false)} className="border-[#e4c9b0]">
                    Volver
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setPidiendo(true)} className="text-[#a3271d] hover:bg-[#c43e2c]/10 gap-1.5">
                <Trash2 className="h-4 w-4" /> Pedir que se quite
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <h2 className="text-base font-extrabold text-[#391511]">{plantilla.titulo}</h2>
          {plantilla.descripcion && <p className="text-[13px] text-[#6f3a2a]">{plantilla.descripcion}</p>}
          {esAdmin && !plantilla.activa && (
            <Button
              variant="outline"
              onClick={() => reactivar.mutate({ id: plantilla.id }, { onSuccess: onCerrar })}
              disabled={reactivar.isPending}
              className="gap-1.5 border-[#e4c9b0]"
            >
              <RotateCcw className="h-4 w-4" /> Volver a la rutina desde mañana
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
