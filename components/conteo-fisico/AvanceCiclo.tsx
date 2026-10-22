'use client'

import { useMemo, useState } from 'react'
import { ChartColumn, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { formatearNumero } from '@/lib/utils/formato'
import { usePendientesCiclo } from '@/lib/hooks/useConteoFisico'
import { DIAS_SIN_CONTAR_DEFAULT } from '@/lib/config/inventario'
import {
  parsearEntero,
  pendientesDeClase,
  resumirPorClase,
  type ResumenClase,
} from '@/lib/conteo/ciclo'
import type { TareaInicial } from '@/lib/conteo/tareas'
import type { ClaseConteo, ConteoSesionRow, CriteriosConteo } from '@/types/database'
import { DialogoPendientesCiclo } from './DialogoPendientesCiclo'

/** Las cuatro clases = todo el catálogo que se cuenta. */
const TODAS_LAS_CLASES: CriteriosConteo = { clases_abc: ['A', 'B', 'C', 'N'] }

interface Props {
  sesionActiva: ConteoSesionRow | null
  /** Abre el armado de tareas prellenado con la clase, la cantidad y la ventana. */
  onMandarAContar: (inicial: TareaInicial) => void
}

/**
 * Avance del conteo cíclico por clase ABC (migs 306 a 309): cuántos
 * productos de cada clase se contaron en una sesión cerrada dentro de la
 * ventana, cuántos faltan, y desde ahí mandar a contar la próxima tanda.
 * Solo gestores: la función de la base exige `conteo_cierre`.
 */
export function AvanceCiclo({ sesionActiva, onMandarAContar }: Props) {
  const [diasTxt, setDiasTxt] = useState(String(DIAS_SIN_CONTAR_DEFAULT))
  const dias = parsearEntero(diasTxt) ?? DIAS_SIN_CONTAR_DEFAULT
  const { data, isLoading, isError } = usePendientesCiclo(TODAS_LAS_CLASES, dias)
  const [claseAbierta, setClaseAbierta] = useState<ClaseConteo | null>(null)

  const filas = useMemo(() => data ?? [], [data])
  const resumen = useMemo(() => resumirPorClase(filas), [filas])
  const abierta = resumen.find((r) => r.clase === claseAbierta) ?? null
  const pendientesAbierta = useMemo(
    () => (claseAbierta ? pendientesDeClase(filas, claseAbierta) : []),
    [filas, claseAbierta]
  )

  // null = migración 309 pendiente: la tarjeta no existe todavía.
  if (data === null) return null

  const motivoNoMandar =
    sesionActiva && sesionActiva.estado !== 'abierta'
      ? 'La sesión está en revisión: cerrala o volvé a abrirla para mandar a contar.'
      : null

  function mandar(r: ResumenClase, cantidad: number) {
    onMandarAContar({
      criterios: { clases_abc: [r.clase] },
      cantidad_max: cantidad,
      sin_contar_dias: dias,
      nombre: `${r.etiqueta} · ${formatearNumero(cantidad)} de ${formatearNumero(r.pendientes)} pendientes`,
    })
    setClaseAbierta(null)
  }

  return (
    <section className="space-y-3 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 font-bold text-[#391511]">
            <ChartColumn className="h-4 w-4" />
            Avance por clase ABC
          </h2>
          <p className="text-xs text-[#6f3a2a]">
            Lo contado en una sesión cerrada dentro de la ventana cuenta como
            hecho. Pasada la ventana, vuelve a figurar como pendiente.
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[#6f3a2a]">
          Ventana
          <Input
            type="number"
            min="1"
            inputMode="numeric"
            value={diasTxt}
            onChange={(e) => setDiasTxt(e.target.value)}
            aria-label="Ventana en días"
            className="h-8 w-16 border-[#e4c9b0] bg-white text-center"
          />
          días
        </label>
      </div>

      {isError ? (
        <p className="text-xs text-[#c43e2c]">No se pudo calcular el avance.</p>
      ) : isLoading ? (
        <p className="text-xs text-[#c8a58a]">Calculando…</p>
      ) : (
        <ul className="space-y-2">
          {resumen.map((r) => {
            const porcentaje = r.total > 0 ? Math.round((r.contados / r.total) * 100) : 0
            const completa = r.total > 0 && r.pendientes === 0
            return (
              <li key={r.clase} className="rounded-xl border border-[#e4c9b0]/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-[#391511]">{r.etiqueta}</p>
                  <span className="text-xs tabular-nums text-[#6f3a2a]">
                    {formatearNumero(r.contados)} / {formatearNumero(r.total)} contados
                    {r.en_curso > 0 && ` · ${formatearNumero(r.en_curso)} en curso`}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#e4c9b0]/50">
                    <div
                      className={`h-full rounded-full ${completa ? 'bg-[#2f7d4f]' : 'bg-[#f9b44c]'}`}
                      style={{ width: `${porcentaje}%` }}
                    />
                  </div>
                  {r.total === 0 ? (
                    <span className="shrink-0 text-[11px] text-[#6f3a2a]">Sin productos</span>
                  ) : completa ? (
                    <span className="shrink-0 text-[11px] font-semibold text-[#2f7d4f]">
                      Completa
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setClaseAbierta(r.clase)}
                      className="flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-[#391511] underline-offset-2 hover:underline"
                    >
                      Ver pendientes ({formatearNumero(r.pendientes)})
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {abierta && (
        <DialogoPendientesCiclo
          resumen={abierta}
          filas={pendientesAbierta}
          dias={dias}
          abierto
          onCambioAbierto={(v) => !v && setClaseAbierta(null)}
          motivoNoMandar={motivoNoMandar}
          onMandar={(cantidad) => mandar(abierta, cantidad)}
        />
      )}
    </section>
  )
}
