'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { EstadoError } from '@/components/shared/EstadoError'
import { cn } from '@/lib/utils'
import { useActualizarReglaAlerta, useReglasAlerta } from '@/lib/hooks/useAlertas'
import {
  ETIQUETA_SEVERIDAD,
  SEVERIDADES,
  type ParametrosRegla,
  type ReglaAlerta,
  type SeveridadAlerta,
} from '@/lib/queries/alertas'
import { CAMPOS_REGLA, COLOR_SEVERIDAD, SUGERENCIA_REGLA } from './presentacion'

const CLASES_ABC = ['A', 'B', 'C']

/**
 * Configuración sin código: prender/apagar, severidad y umbrales. Los tipos
 * de regla están codificados (no se inventan reglas nuevas desde acá).
 */
export function TabReglasAlerta({ puedeEditar }: { puedeEditar: boolean }) {
  const { data, isLoading, isError, refetch } = useReglasAlerta()

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
    )
  }
  if (isError) {
    return <EstadoError mensaje="No pudimos cargar las reglas." onReintentar={refetch} />
  }
  if (!data) {
    return (
      <p className="text-sm text-[#6f3a2a]">Faltan correr las migraciones de alertas (183 a 189).</p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#6f3a2a]">
        {puedeEditar
          ? 'Menos reglas y umbrales más exigentes = menos ruido. Los cambios se aplican en la próxima revisión.'
          : 'Solo quien tiene el permiso del tablero del dueño puede cambiar las reglas.'}
      </p>
      {data.map((regla) => (
        <FilaRegla
          key={`${regla.codigo}-${regla.updated_at}`}
          regla={regla}
          puedeEditar={puedeEditar}
        />
      ))}
    </div>
  )
}

function FilaRegla({ regla, puedeEditar }: { regla: ReglaAlerta; puedeEditar: boolean }) {
  const [activa, setActiva] = useState(regla.activa)
  const [severidad, setSeveridad] = useState<SeveridadAlerta>(regla.severidad)
  const [parametros, setParametros] = useState<ParametrosRegla>(regla.parametros)
  const actualizar = useActualizarReglaAlerta()

  const campos = CAMPOS_REGLA[regla.codigo] ?? []
  const cambiado =
    activa !== regla.activa ||
    severidad !== regla.severidad ||
    JSON.stringify(parametros) !== JSON.stringify(regla.parametros)

  const cambiarParametro = (clave: keyof ParametrosRegla, valor: number | boolean | string[]) =>
    setParametros((prev) => ({ ...prev, [clave]: valor }))

  const guardar = () =>
    actualizar.mutate({ codigo: regla.codigo, cambios: { activa, severidad, parametros } })

  return (
    <div
      className={cn(
        'rounded-2xl border bg-white p-4 shadow-sm',
        activa ? COLOR_SEVERIDAD[severidad].borde : 'border-[#e4c9b0]/60 opacity-75'
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <Switch
          checked={activa}
          onCheckedChange={(v) => setActiva(v)}
          disabled={!puedeEditar}
          aria-label={activa ? 'Desactivar regla' : 'Activar regla'}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#391511]">{regla.nombre}</p>
          <p className="text-xs text-[#6f3a2a]">{regla.descripcion}</p>
          {SUGERENCIA_REGLA[regla.codigo] && (
            <p className="mt-0.5 text-xs text-[#c8a58a]">
              Sugerencia que muestra: {SUGERENCIA_REGLA[regla.codigo]}
            </p>
          )}
        </div>
        <select
          value={severidad}
          onChange={(e) => setSeveridad(e.target.value as SeveridadAlerta)}
          disabled={!puedeEditar}
          className={cn(
            'rounded-lg border border-[#e4c9b0] bg-white px-2 py-1 text-xs font-semibold',
            COLOR_SEVERIDAD[severidad].texto
          )}
          aria-label="Severidad"
        >
          {SEVERIDADES.map((s) => (
            <option key={s} value={s}>
              {ETIQUETA_SEVERIDAD[s]}
            </option>
          ))}
        </select>
      </div>

      {campos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 pl-11">
          {campos.map((c) => {
            if (c.tipo === 'numero') {
              const valor = parametros[c.clave] as number | undefined
              return (
                <label key={c.clave} className="flex items-center gap-2 text-sm text-[#391511]">
                  {c.etiqueta}
                  <Input
                    type="number"
                    min={0}
                    value={valor ?? 0}
                    onChange={(e) => {
                      const numero = Math.max(0, Number(e.target.value) || 0)
                      // Solo el margen admite decimales; días y pesos van enteros.
                      cambiarParametro(
                        c.clave,
                        c.clave === 'margen_minimo_pct' ? numero : Math.round(numero)
                      )
                    }}
                    disabled={!puedeEditar}
                    className="h-7 w-24"
                  />
                  {c.sufijo && <span className="text-xs text-[#6f3a2a]">{c.sufijo}</span>}
                </label>
              )
            }
            if (c.tipo === 'booleano') {
              const valor = (parametros[c.clave] as boolean | undefined) ?? false
              return (
                <label key={c.clave} className="flex items-center gap-2 text-sm text-[#391511]">
                  <input
                    type="checkbox"
                    checked={valor}
                    onChange={(e) => cambiarParametro(c.clave, e.target.checked)}
                    disabled={!puedeEditar}
                    className="accent-[#e4a42a]"
                  />
                  {c.etiqueta}
                </label>
              )
            }
            const clases = (parametros[c.clave] as string[] | undefined) ?? []
            return (
              <div key={c.clave} className="flex items-center gap-2 text-sm text-[#391511]">
                {c.etiqueta}
                {CLASES_ABC.map((clase) => {
                  const marcada = clases.includes(clase)
                  return (
                    <button
                      key={clase}
                      type="button"
                      disabled={!puedeEditar}
                      onClick={() =>
                        cambiarParametro(
                          c.clave,
                          marcada ? clases.filter((x) => x !== clase) : [...clases, clase].sort()
                        )
                      }
                      className={cn(
                        'h-7 w-7 rounded-md border text-xs font-bold',
                        marcada
                          ? 'border-[#e4a42a] bg-[#f9b44c]/25 text-[#391511]'
                          : 'border-[#e4c9b0] text-[#c8a58a]'
                      )}
                    >
                      {clase}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {puedeEditar && cambiado && (
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setActiva(regla.activa)
              setSeveridad(regla.severidad)
              setParametros(regla.parametros)
            }}
            disabled={actualizar.isPending}
          >
            Deshacer
          </Button>
          <Button size="sm" onClick={guardar} disabled={actualizar.isPending}>
            {actualizar.isPending ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      )}
    </div>
  )
}
