'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Monitor,
  Upload,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { ModalImportarReloj } from './ModalImportarReloj'
import { ModalCeldaAsistencia } from './ModalCeldaAsistencia'
import {
  ABREV_TURNO,
  ESTADO_ASISTENCIA,
} from './asistenciaConstantes'
import { nombreCompleto } from './constantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import {
  useAsistenciaRango,
  useCopiarSemana,
  useHorariosRango,
  useTurnos,
} from '@/lib/hooks/useAsistencia'
import { cn } from '@/lib/utils'
import type {
  AsistenciaDiariaRow,
  HorarioAsignadoRow,
  TurnoPlantillaRow,
} from '@/types/database'

function lunesDe(d: Date): string {
  return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
}

export function PantallaAsistencia() {
  const [inicio, setInicio] = useState(() => lunesDe(new Date()))
  const dias = useMemo(
    () => Array.from({ length: 7 }, (_, i) => format(addDays(parseISO(inicio), i), 'yyyy-MM-dd')),
    [inicio]
  )
  const fin = dias[6]

  const { data: empleados, isLoading: cargandoEmp } = useEmpleados()
  const { data: turnos } = useTurnos()
  const { data: horarios, isLoading: cargandoHor } = useHorariosRango(inicio, fin)
  const { data: asistencia } = useAsistenciaRango(inicio, fin)
  const copiar = useCopiarSemana()

  const [celda, setCelda] = useState<{ empleadoId: number; fecha: string } | null>(null)
  const [importAbierto, setImportAbierto] = useState(false)

  const activos = useMemo(
    () => (empleados ?? []).filter((e) => e.activo),
    [empleados]
  )
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

  const cargando = cargandoEmp || cargandoHor

  return (
    <div className="p-4 sm:p-6 max-w-[1400px] mx-auto space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Asistencia</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Grilla de turnos y fichajes. La fuente principal es el Excel del reloj.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href="/rrhh/kiosco"
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'border-[#e4c9b0] text-[#6f3a2a] gap-1.5'
            )}
          >
            <Monitor className="h-4 w-4" />
            Abrir kiosco
          </Link>
          <Button
            onClick={() => setImportAbierto(true)}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Upload className="h-4 w-4" />
            Importar reloj
          </Button>
        </div>
      </header>

      {/* Navegación de semana */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white border border-[#e4c9b0]/60 rounded-2xl px-4 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInicio(format(addDays(parseISO(inicio), -7), 'yyyy-MM-dd'))}
            className="h-8 w-8 p-0 text-[#6f3a2a]"
            aria-label="Semana anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-[#391511] font-semibold text-sm tabular-nums min-w-[200px] text-center">
            {format(parseISO(inicio), "d 'de' MMM", { locale: es })} —{' '}
            {format(parseISO(fin), "d 'de' MMM yyyy", { locale: es })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInicio(format(addDays(parseISO(inicio), 7), 'yyyy-MM-dd'))}
            className="h-8 w-8 p-0 text-[#6f3a2a]"
            aria-label="Semana siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setInicio(lunesDe(new Date()))}
            className="h-8 text-xs text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
          >
            Hoy
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={copiar.isPending}
          onClick={() =>
            copiar.mutate({
              desde: format(addDays(parseISO(inicio), -7), 'yyyy-MM-dd'),
              hacia: inicio,
            })
          }
          className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
        >
          <Copy className="h-3.5 w-3.5" />
          Copiar semana anterior
        </Button>
      </div>

      {/* Grilla empleados × días */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {cargando ? (
          <div className="p-6">
            <SkeletonTabla filas={6} columnas={8} />
          </div>
        ) : activos.length === 0 ? (
          <div className="p-12 text-center text-[#6f3a2a] text-sm">
            No hay empleados activos. Cargalos en RRHH › Empleados.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#fdfaf6] border-b border-[#e4c9b0]/60">
                  <th className="sticky left-0 bg-[#fdfaf6] text-left px-4 py-2.5 text-[#391511] font-semibold text-sm min-w-[180px] z-10">
                    Empleado
                  </th>
                  {dias.map((d) => {
                    const dt = parseISO(d)
                    const domingo = dt.getDay() === 0
                    return (
                      <th
                        key={d}
                        className={cn(
                          'px-2 py-2.5 text-center text-xs font-semibold min-w-[92px]',
                          domingo ? 'text-[#c43e2c]' : 'text-[#391511]'
                        )}
                      >
                        <div className="capitalize">{format(dt, 'EEE', { locale: es })}</div>
                        <div className="text-[#c8a58a] tabular-nums">{format(dt, 'd/MM')}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {activos.map((e) => (
                  <tr key={e.id} className="border-b border-[#e4c9b0]/30 hover:bg-[#fdfaf6]/60">
                    <td className="sticky left-0 bg-white px-4 py-2 text-[#391511] text-sm font-medium min-w-[180px] z-10">
                      <div className="truncate">{nombreCompleto(e)}</div>
                      <div className="text-[#c8a58a] text-xs tabular-nums">{e.legajo}</div>
                    </td>
                    {dias.map((d) => {
                      const hor = horarioMap.get(`${e.id}|${d}`)
                      const asis = asistMap.get(`${e.id}|${d}`)
                      const turno = hor?.turno_id ? turnoPorId.get(hor.turno_id) : undefined
                      const estilo = asis ? ESTADO_ASISTENCIA[asis.estado] : null
                      return (
                        <td key={d} className="px-1.5 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => setCelda({ empleadoId: e.id, fecha: d })}
                            className={cn(
                              'w-full min-h-[42px] rounded-lg border text-xs font-medium px-1 py-1 transition-colors',
                              estilo
                                ? `${estilo.clase} border-transparent`
                                : hor
                                  ? 'bg-[#f9d2a2]/20 text-[#6f3a2a] border-[#e4c9b0]/60'
                                  : 'bg-transparent text-[#c8a58a] border-dashed border-[#e4c9b0]/60 hover:bg-[#f9d2a2]/20'
                            )}
                          >
                            {turno && (
                              <span className="block font-bold">{ABREV_TURNO[turno.nombre]}</span>
                            )}
                            {asis ? (
                              <span className="block text-[10px] leading-tight">{estilo?.label}</span>
                            ) : !hor ? (
                              <span className="text-[#c8a58a]">+</span>
                            ) : null}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Leyenda */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(ESTADO_ASISTENCIA).map(([k, v]) => (
          <span
            key={k}
            className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', v.clase)}
          >
            {v.label}
          </span>
        ))}
      </div>

      {celda && (
        <ModalCeldaAsistencia
          abierto={!!celda}
          onCambioAbierto={(v) => !v && setCelda(null)}
          empleadoId={celda.empleadoId}
          fecha={celda.fecha}
          nombre={
            nombreCompleto(activos.find((e) => e.id === celda.empleadoId) ?? { nombre: '' })
          }
          turnos={turnos ?? []}
          horario={horarioMap.get(`${celda.empleadoId}|${celda.fecha}`)}
          asistencia={asistMap.get(`${celda.empleadoId}|${celda.fecha}`)}
        />
      )}
      <ModalImportarReloj abierto={importAbierto} onCambioAbierto={setImportAbierto} />
    </div>
  )
}
