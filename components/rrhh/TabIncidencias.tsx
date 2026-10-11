'use client'

import { useMemo, useState } from 'react'
import { format, parseISO, subDays } from 'date-fns'
import { AlertTriangle, Plus, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useIncidencias, useSanciones, useTipologias } from '@/lib/hooks/useIncidencias'
import { nombreCompleto } from './constantes'
import { hoyAr } from './asistenciaConstantes'
import { ListaIncidencias } from './ListaIncidencias'
import { ListaSanciones } from './ListaSanciones'
import { ModalIncidencia } from './ModalIncidencia'
import { cn } from '@/lib/utils'

interface Props {
  /** Dirección: ve y aplica sanciones formales. */
  puedeSancionar: boolean
}

const TODOS = '__todos__'
const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'

function Kpi({
  etiqueta,
  valor,
  alerta,
  icono: Icono,
}: {
  etiqueta: string
  valor: number | string
  alerta?: boolean
  icono?: React.ElementType
}) {
  return (
    <div
      className={cn(
        'bg-white border rounded-2xl shadow-sm p-4',
        alerta ? 'border-[#c43e2c]/40' : 'border-[#e4c9b0]/60'
      )}
    >
      <p className="text-[#6f3a2a] text-xs font-medium flex items-center gap-1">
        {Icono && <Icono className={cn('h-3.5 w-3.5', alerta && 'text-[#c43e2c]')} />}
        {etiqueta}
      </p>
      <p className={cn('text-2xl font-bold tabular-nums mt-1', alerta ? 'text-[#c43e2c]' : 'text-[#391511]')}>
        {valor}
      </p>
    </div>
  )
}

/** Pestaña "Incidencias" del hub Personal. */
export function TabIncidencias({ puedeSancionar }: Props) {
  const hoy = hoyAr()
  const [desde, setDesde] = useState(format(subDays(parseISO(hoy), 30), 'yyyy-MM-dd'))
  const [hasta, setHasta] = useState(hoy)
  const [empleadoId, setEmpleadoId] = useState(TODOS)
  const [tipologiaId, setTipologiaId] = useState(TODOS)
  const [estado, setEstado] = useState(TODOS)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [vista, setVista] = useState<'incidencias' | 'sanciones'>('incidencias')

  const rangoValido = desde <= hasta
  const { data: incidencias, isLoading } = useIncidencias(
    {
      desde,
      hasta,
      empleadoId: empleadoId === TODOS ? null : Number(empleadoId),
      tipologiaId: tipologiaId === TODOS ? null : Number(tipologiaId),
      estado: estado === TODOS ? null : (estado as 'abierta' | 'cerrada'),
    },
    rangoValido
  )
  const { data: empleados } = useEmpleados()
  const { data: tipologias } = useTipologias()
  const { data: sanciones } = useSanciones(null, puedeSancionar)

  const nombrePorId = useMemo(() => {
    const m = new Map<number, string>()
    for (const e of empleados ?? []) m.set(e.id, nombreCompleto(e))
    return m
  }, [empleados])

  // Resumen de los últimos 7 días (sobre lo cargado, sin filtros de empleado/tipología).
  const resumen = useMemo(() => {
    const corte = format(subDays(parseISO(hoy), 7), 'yyyy-MM-dd')
    const lista = incidencias ?? []
    const ult7 = lista.filter((i) => i.fecha >= corte)
    const abiertas = lista.filter((i) => i.estado === 'abierta').length
    const reinc = lista.filter((i) => i.instancia >= 2 || i.escalada).length
    const porTip = new Map<string, number>()
    for (const i of ult7) {
      const k = i.tipologias_incidencia?.nombre ?? 'Otra'
      porTip.set(k, (porTip.get(k) ?? 0) + 1)
    }
    const top = [...porTip.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    return { ult7: ult7.length, abiertas, reinc, top }
  }, [incidencias, hoy])

  const itemsEmpleado: Record<string, string> = {
    [TODOS]: 'Todos los empleados',
    ...Object.fromEntries((empleados ?? []).map((e) => [String(e.id), nombreCompleto(e)])),
  }
  const itemsTipologia: Record<string, string> = {
    [TODOS]: 'Todas las tipologías',
    ...Object.fromEntries((tipologias ?? []).map((t) => [String(t.id), t.nombre])),
  }
  const itemsEstado: Record<string, string> = {
    [TODOS]: 'Abiertas y cerradas',
    abierta: 'Solo abiertas',
    cerrada: 'Solo cerradas',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] text-lg font-bold">Incidencias operativas</h2>
          <p className="text-[#6f3a2a] text-sm">
            Hechos objetivos por persona. Reincidencia por tipología en 30 días:
            1ª corrección · 2ª observación formal · 3ª escala a Dirección.
          </p>
        </div>
        <Button
          onClick={() => setModalAbierto(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nueva incidencia
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi etiqueta="Últimos 7 días" valor={resumen.ult7} />
        <Kpi etiqueta="Abiertas en el período" valor={resumen.abiertas} alerta={resumen.abiertas > 0} />
        <Kpi
          etiqueta="Reincidencias / escaladas"
          valor={resumen.reinc}
          alerta={resumen.reinc > 0}
          icono={AlertTriangle}
        />
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-4">
          <p className="text-[#6f3a2a] text-xs font-medium">Más repetidas (7 días)</p>
          {resumen.top.length === 0 ? (
            <p className="text-[#c8a58a] text-sm mt-1">—</p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {resumen.top.map(([n, c]) => (
                <li key={n} className="text-[#391511] text-xs flex justify-between gap-2">
                  <span className="truncate">{n}</span>
                  <span className="tabular-nums font-semibold">{c}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {puedeSancionar && (
        <div className="flex gap-1 bg-white border border-[#e4c9b0]/60 rounded-xl p-1 w-fit">
          {(['incidencias', 'sanciones'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                vista === v ? 'bg-[#f9b44c]/20 text-[#391511]' : 'text-[#6f3a2a] hover:bg-[#fdfaf6]'
              )}
            >
              {v === 'incidencias' ? 'Incidencias' : 'Sanciones formales'}
            </button>
          ))}
        </div>
      )}

      {vista === 'incidencias' ? (
        <>
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className={`${claseInput} tabular-nums`}
            />
            <Input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className={`${claseInput} tabular-nums`}
            />
            <Select items={itemsEmpleado} value={empleadoId} onValueChange={(v) => setEmpleadoId(v ?? TODOS)}>
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
            <Select items={itemsTipologia} value={tipologiaId} onValueChange={(v) => setTipologiaId(v ?? TODOS)}>
              <SelectTrigger className={`w-full ${claseInput}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(itemsTipologia).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select items={itemsEstado} value={estado} onValueChange={(v) => setEstado(v ?? TODOS)}>
              <SelectTrigger className={`w-full ${claseInput}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(itemsEstado).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm px-5 py-2">
            {!rangoValido ? (
              <p className="text-[#c43e2c] text-sm py-6 text-center">La fecha "desde" es posterior a "hasta".</p>
            ) : isLoading ? (
              <div className="py-3">
                <SkeletonTabla filas={5} columnas={4} />
              </div>
            ) : (
              <ListaIncidencias
                incidencias={incidencias ?? []}
                nombrePorId={nombrePorId}
                puedeCerrar
              />
            )}
          </div>
        </>
      ) : (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm px-5 py-2">
          <div className="flex items-center gap-2 pt-3 pb-1">
            <ShieldAlert className="h-4 w-4 text-[#c43e2c]" />
            <h3 className="text-[#391511] font-bold">Sanciones formales aplicadas</h3>
          </div>
          <ListaSanciones sanciones={sanciones ?? []} nombrePorId={nombrePorId} puedeAnular />
        </div>
      )}

      <ModalIncidencia abierto={modalAbierto} onCambioAbierto={setModalAbierto} />
    </div>
  )
}
