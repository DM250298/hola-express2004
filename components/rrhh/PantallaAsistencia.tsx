'use client'

import { useMemo, useState } from 'react'
import { addDays, format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Copy,
  ListOrdered,
  Upload,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { ModalImportarReloj } from './ModalImportarReloj'
import { ModalCeldaAsistencia } from './ModalCeldaAsistencia'
import { ModalPatrones } from './ModalPatrones'
import { ModalGenerarCronograma } from './ModalGenerarCronograma'
import { ModalCopiarSemana } from './ModalCopiarSemana'
import { ModalDotacion } from './ModalDotacion'
import { PanelAsignacion } from './PanelAsignacion'
import { PanelCobertura } from './PanelCobertura'
import { GrillaCronograma } from './GrillaCronograma'
import { ListaDiaCronograma } from './ListaDiaCronograma'
import { CeldaFichada, CeldaPlan } from './celdasCronograma'
import {
  ESTILO_PLAN,
  ESTILO_TURNO,
  NOMBRE_TURNO,
  TONO_FICHADA,
  hoyAr,
} from './asistenciaConstantes'
import { horaActualAr } from './paseTurnoConstantes'
import { lunesDe } from './cronogramaConstantes'
import { nombreCompleto } from './constantes'
import {
  coberturaDia,
  estadoFichada,
  etiquetaHorasCorta,
  minutosSemana,
  ordenarEmpleados,
  type EmpleadoCrono,
} from './cronogramaCalculos'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import {
  useAsistenciaRango,
  useHorariosRango,
  useTurnos,
  useUltimaImportacion,
} from '@/lib/hooks/useAsistencia'
import { useDotacionRequerida } from '@/lib/hooks/useDotacion'
import { cn } from '@/lib/utils'
import type {
  AsistenciaDiariaRow,
  HorarioAsignadoRow,
  TurnoPlantillaRow,
} from '@/types/database'

type Vista = 'plan' | 'fichadas'

interface Props {
  /** Embebida como pestaña "Cronograma" del hub Personal. */
  enHub?: boolean
}

const claseAccion = 'border-[#e4c9b0] text-[#6f3a2a] gap-1.5'

/**
 * Personal › Cronograma. Dos vistas sobre la misma grilla semanal:
 *  · Planificación: qué turno tiene cada persona (horarios_asignados). Nunca
 *    muestra asistencia.
 *  · Fichadas: qué pasó de verdad (asistencia_diaria + marcaciones). Un día
 *    sin importación del reloj se muestra "Revisar fichada", no "Ausente".
 */
export function PantallaAsistencia({ enHub = false }: Props = {}) {
  const hoy = hoyAr()
  const [inicio, setInicio] = useState(() => lunesDe(new Date()))
  const [vista, setVista] = useState<Vista>('plan')
  const [diaSel, setDiaSel] = useState(() => hoy)
  const dias = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(inicio), i), 'yyyy-MM-dd')),
    [inicio]
  )
  const fin = dias[6]
  // El día seleccionado siempre pertenece a la semana visible.
  const diaActivo = dias.includes(diaSel) ? diaSel : dias.includes(hoy) ? hoy : dias[0]

  const { data: empleados, isLoading: cargandoEmp } = useEmpleados()
  const { data: turnos } = useTurnos()
  const { data: horarios, isLoading: cargandoHor } = useHorariosRango(
    format(addDays(parseISO(inicio), -1), 'yyyy-MM-dd'),
    fin
  )
  const { data: asistencia } = useAsistenciaRango(inicio, fin)
  const { data: ultimaImport } = useUltimaImportacion()
  const { data: dotacion } = useDotacionRequerida()

  const [celda, setCelda] = useState<{ empleadoId: number; fecha: string } | null>(null)
  const [importAbierto, setImportAbierto] = useState(false)
  const [patronesAbierto, setPatronesAbierto] = useState(false)
  const [generarAbierto, setGenerarAbierto] = useState(false)
  const [copiarAbierto, setCopiarAbierto] = useState(false)
  const [dotacionAbierta, setDotacionAbierta] = useState(false)

  const activos = useMemo<EmpleadoCrono[]>(
    () => ordenarEmpleados((empleados ?? []).filter((e) => e.activo)),
    [empleados]
  )
  const empleadoPorId = useMemo(() => new Map(activos.map((e) => [e.id, e])), [activos])
  const turnoPorId = useMemo(() => {
    const m = new Map<number, TurnoPlantillaRow>()
    for (const t of turnos ?? []) m.set(t.id, t)
    return m
  }, [turnos])
  const horarioMap = useMemo(() => {
    const m = new Map<string, HorarioAsignadoRow>()
    for (const h of horarios ?? []) m.set(`${h.empleado_id}|${h.fecha}`, h)
    return m
  }, [horarios])
  const asistMap = useMemo(() => {
    const m = new Map<string, AsistenciaDiariaRow>()
    for (const a of asistencia ?? []) m.set(`${a.empleado_id}|${a.fecha}`, a)
    return m
  }, [asistencia])

  const minutosPorEmpleado = useMemo(() => {
    const m = new Map<number, number>()
    const semana = (horarios ?? []).filter((h) => h.fecha >= inicio && h.fecha <= fin)
    for (const e of activos) {
      m.set(e.id, minutosSemana(semana.filter((h) => h.empleado_id === e.id), turnoPorId))
    }
    return m
  }, [horarios, activos, turnoPorId, inicio, fin])

  const cobertura = useMemo(
    () => coberturaDia(diaActivo, horarios ?? [], turnos ?? [], dotacion ?? [], empleadoPorId),
    [diaActivo, horarios, turnos, dotacion, empleadoPorId]
  )

  const horaAhora = horaActualAr()
  const ultimaImportHasta = ultimaImport?.periodo_hasta ?? null

  const turnoDe = (h: HorarioAsignadoRow | undefined) =>
    h?.turno_id ? turnoPorId.get(h.turno_id) : undefined

  const renderCeldaPlan = (e: EmpleadoCrono, fecha: string) => {
    const hor = horarioMap.get(`${e.id}|${fecha}`)
    return (
      <CeldaPlan
        horario={hor}
        turno={turnoDe(hor)}
        seleccionada={celda?.empleadoId === e.id && celda?.fecha === fecha}
        onClick={() => setCelda({ empleadoId: e.id, fecha })}
        etiqueta={`${nombreCompleto(e)}, ${format(parseISO(fecha), 'EEEE d', { locale: es })}`}
      />
    )
  }

  const renderCeldaFichada = (e: EmpleadoCrono, fecha: string) => {
    const hor = horarioMap.get(`${e.id}|${fecha}`)
    const turno = turnoDe(hor)
    const estado = estadoFichada({
      fecha,
      hoy,
      horaAhora,
      horario: hor,
      turno,
      asistencia: asistMap.get(`${e.id}|${fecha}`),
      ultimaImportHasta,
    })
    return (
      <CeldaFichada
        estado={estado}
        turno={turno}
        onClick={() => setCelda({ empleadoId: e.id, fecha })}
        etiqueta={`${nombreCompleto(e)}, ${format(parseISO(fecha), 'EEEE d', { locale: es })}`}
      />
    )
  }

  const renderCelda = vista === 'plan' ? renderCeldaPlan : renderCeldaFichada
  const cargando = cargandoEmp || cargandoHor
  const empleadoSel = celda ? (empleadoPorId.get(celda.empleadoId) ?? null) : null
  const horarioSel = celda ? horarioMap.get(`${celda.empleadoId}|${celda.fecha}`) : undefined
  const horariosDelDia = useMemo(() => {
    const m = new Map<number, HorarioAsignadoRow>()
    if (!celda) return m
    for (const h of horarios ?? []) if (h.fecha === celda.fecha) m.set(h.empleado_id, h)
    return m
  }, [horarios, celda])

  const semanaAnterior = format(addDays(parseISO(inicio), -7), 'yyyy-MM-dd')

  return (
    <div className={cn(!enHub && 'p-4 sm:p-6', 'max-w-[1400px] mx-auto space-y-4')}>
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          {enHub ? (
            <h2 className="text-[#391511] text-lg font-bold">Cronograma de turnos</h2>
          ) : (
            <h1 className="text-[#391511] text-2xl font-bold">Cronograma de turnos</h1>
          )}
          <p className="text-[#6f3a2a] text-sm mt-1">
            {vista === 'plan'
              ? 'Quién trabaja, en qué turno y qué cobertura queda. La asistencia real va en Fichadas.'
              : 'Qué pasó de verdad según el reloj. La fuente principal es el Excel del reloj.'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {vista === 'plan' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setPatronesAbierto(true)} className={claseAccion}>
                <ListOrdered className="h-4 w-4" />
                Patrones
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCopiarAbierto(true)} className={claseAccion}>
                <Copy className="h-4 w-4" />
                Copiar semana anterior
              </Button>
              <Button size="sm" onClick={() => setGenerarAbierto(true)} className="bg-[#391511] hover:bg-[#2a0f0c] text-[#f9d2a2] font-semibold gap-1.5">
                <Wand2 className="h-4 w-4" />
                Generar
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-[#6f3a2a]">
                {ultimaImport ? (
                  <>
                    Última importación:{' '}
                    <b className="text-[#391511]">
                      {format(new Date(ultimaImport.created_at), "d MMM HH:mm", { locale: es })}
                    </b>
                    {ultimaImport.periodo_hasta && (
                      <> · hasta el {format(parseISO(ultimaImport.periodo_hasta), 'd/MM', { locale: es })}</>
                    )}
                    {ultimaImport.archivo_nombre && <> · {ultimaImport.archivo_nombre}</>}
                  </>
                ) : (
                  'Todavía no se importó el reloj.'
                )}
              </span>
              <Button size="sm" onClick={() => setImportAbierto(true)} className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5">
                <Upload className="h-4 w-4" />
                Importar reloj
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Semana + toggle de vista */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white border border-[#e4c9b0]/60 rounded-2xl px-3 py-2 shadow-sm">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setInicio(format(addDays(parseISO(inicio), -7), 'yyyy-MM-dd'))} className="h-8 w-8 p-0 text-[#6f3a2a]" aria-label="Semana anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-[#391511] font-semibold text-sm tabular-nums min-w-[190px] text-center">
            {format(parseISO(inicio), 'd MMM', { locale: es })} — {format(parseISO(fin), 'd MMM yyyy', { locale: es })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setInicio(format(addDays(parseISO(inicio), 7), 'yyyy-MM-dd'))} className="h-8 w-8 p-0 text-[#6f3a2a]" aria-label="Semana siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!dias.includes(hoy) && (
            <Button variant="ghost" size="sm" onClick={() => { setInicio(lunesDe(new Date())); setDiaSel(hoy) }} className="h-8 text-xs text-[#6f3a2a] hover:bg-[#f9d2a2]/40">
              Hoy
            </Button>
          )}
        </div>
        <div className="flex gap-1 p-1 bg-[#f3ece4] rounded-xl" role="group" aria-label="Vista del cronograma">
          {(['plan', 'fichadas'] as Vista[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { setVista(v); setCelda(null) }}
              aria-pressed={vista === v}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]',
                vista === v ? 'bg-white text-[#391511] shadow-sm' : 'text-[#6f3a2a] hover:text-[#391511]'
              )}
            >
              {v === 'plan' ? <Wand2 className="h-3.5 w-3.5" /> : <CalendarCheck className="h-3.5 w-3.5" />}
              {v === 'plan' ? 'Planificación' : 'Fichadas'}
            </button>
          ))}
        </div>
      </div>

      {vista === 'plan' && !cargando && activos.length > 0 && (
        <PanelCobertura fecha={diaActivo} cobertura={cobertura} onConfigurar={() => setDotacionAbierta(true)} />
      )}

      {/* Grilla (escritorio) / lista del día (celular) */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {cargando ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={8} />
          </div>
        ) : activos.length === 0 ? (
          <div className="p-12 text-center text-[#6f3a2a] text-sm">
            No hay empleados activos. Cargalos en Turnos y equipo › Equipo.
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <GrillaCronograma
                empleados={activos}
                dias={dias}
                diaSel={diaActivo}
                onSeleccionarDia={setDiaSel}
                hoy={hoy}
                renderCelda={renderCelda}
                minutosPorEmpleado={vista === 'plan' ? minutosPorEmpleado : undefined}
              />
            </div>
            <div className="md:hidden p-3">
              <ListaDiaCronograma
                fecha={diaActivo}
                hoy={hoy}
                onCambioFecha={(f) => { setDiaSel(f); if (!dias.includes(f)) setInicio(lunesDe(parseISO(f))) }}
                empleados={activos}
                renderCelda={renderCelda}
                minutosPorEmpleado={vista === 'plan' ? minutosPorEmpleado : undefined}
              />
            </div>
          </>
        )}
      </div>

      {/* Leyenda */}
      {vista === 'plan' ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[#6f3a2a]">
          {(turnos ?? []).filter((t) => t.activo).map((t) => (
            <span key={t.id} className="flex items-center gap-1.5">
              <span className={cn('inline-block h-2 w-2 rounded-full', ESTILO_TURNO[t.nombre].punto)} />
              {NOMBRE_TURNO[t.nombre]} <span className="tabular-nums text-[#c8a58a]">{etiquetaHorasCorta(t)}</span>
            </span>
          ))}
          <span className={cn('rounded px-1.5 py-0.5', ESTILO_PLAN.franco)}>Franco</span>
          <span className={cn('rounded px-1.5 py-0.5', ESTILO_PLAN.licencia)}>Licencia</span>
          <span className={cn('rounded px-1.5 py-0.5', ESTILO_PLAN.sin_asignar)}>Sin asignar</span>
          <span>“Cubre a…” = reemplaza a esa persona ese día</span>
          <span className="text-[#c8a58a]">
            Horas: brutas planificadas (sin descansos). No son horas trabajadas ni liquidables. La noche cuenta en el día en que empieza.
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[#6f3a2a]">
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', TONO_FICHADA.ok)}>Presente</span>
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', TONO_FICHADA.atencion)}>Tardanza / Revisar fichada</span>
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', TONO_FICHADA.problema)}>Ausente</span>
          <span className={cn('rounded-full px-2 py-0.5 font-semibold', TONO_FICHADA.neutro)}>Programado / Franco / Sin turno</span>
          <span className="text-[#c8a58a]">
            “Revisar fichada” = falta importar el reloj o el día no cerró; no es una ausencia hasta confirmarla.
          </span>
        </div>
      )}

      {/* Editores */}
      {vista === 'plan' && (
        <PanelAsignacion
          abierto={!!celda}
          onCambioAbierto={(v) => !v && setCelda(null)}
          empleado={empleadoSel}
          fecha={celda?.fecha ?? diaActivo}
          hoy={hoy}
          turnos={turnos ?? []}
          horario={horarioSel}
          horarioAnterior={
            celda ? horarioMap.get(`${celda.empleadoId}|${format(addDays(parseISO(celda.fecha), -1), 'yyyy-MM-dd')}`) : undefined
          }
          empleados={activos}
          horariosDelDia={horariosDelDia}
        />
      )}
      {vista === 'fichadas' && celda && empleadoSel && (
        <ModalCeldaAsistencia
          abierto={!!celda}
          onCambioAbierto={(v) => !v && setCelda(null)}
          empleadoId={celda.empleadoId}
          fecha={celda.fecha}
          nombre={nombreCompleto(empleadoSel)}
          turno={turnoDe(horarioSel)}
          horario={horarioSel}
          asistencia={asistMap.get(`${celda.empleadoId}|${celda.fecha}`)}
        />
      )}
      <ModalImportarReloj abierto={importAbierto} onCambioAbierto={setImportAbierto} />
      <ModalPatrones abierto={patronesAbierto} onCambioAbierto={setPatronesAbierto} />
      <ModalGenerarCronograma abierto={generarAbierto} onCambioAbierto={setGenerarAbierto} semanaInicio={inicio} />
      <ModalCopiarSemana
        abierto={copiarAbierto}
        onCambioAbierto={setCopiarAbierto}
        desde={semanaAnterior}
        hacia={inicio}
        hoy={hoy}
        empleadoPorId={empleadoPorId}
        turnoPorId={turnoPorId}
      />
      <ModalDotacion abierto={dotacionAbierta} onCambioAbierto={setDotacionAbierta} turnos={turnos ?? []} dotacion={dotacion ?? []} />
    </div>
  )
}
