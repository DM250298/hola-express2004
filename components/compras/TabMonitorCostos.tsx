'use client'

import { useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  PackageSearch,
  Save,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useHistorialCostos,
  useConfigCompras,
  useActualizarConfigCompras,
} from '@/lib/hooks/useHistorialCostos'
import { formatearFechaHora } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { ConfigComprasUpdate } from '@/types/database'

type CampoConfig =
  | 'umbral_variacion_costo'
  | 'dias_cobertura_objetivo_default'
  | 'dias_seguridad_default'
  | 'frecuencia_reposicion_default'
  | 'umbral_sobrestock_dias'

/**
 * Valores por defecto de la reposición por cobertura (config_compras, mig
 * 151). Cada proveedor puede pisarlos en su ficha; vacío allá = estos.
 */
const CAMPOS_REPOSICION: {
  campo: CampoConfig
  etiqueta: string
  ayuda: string
  placeholder?: string
}[] = [
  {
    campo: 'dias_cobertura_objetivo_default',
    etiqueta: 'Cobertura objetivo',
    ayuda: 'Para cuántos días de venta se compra.',
  },
  {
    campo: 'dias_seguridad_default',
    etiqueta: 'Días de seguridad',
    ayuda: 'Colchón por demoras o picos de venta.',
  },
  {
    campo: 'frecuencia_reposicion_default',
    etiqueta: 'Frecuencia de pedido',
    ayuda: 'Cada cuántos días se le pide a un proveedor.',
  },
  {
    campo: 'umbral_sobrestock_dias',
    etiqueta: 'Sobrestock desde',
    ayuda: 'Vacío = el doble de la cobertura objetivo.',
    placeholder: 'automático',
  },
]

/** "12,5" o "12.5" → 12.5; vacío → null; texto inválido → NaN. */
function leerNumero(texto: string): number | null {
  const t = texto.trim().replace(',', '.')
  if (t === '') return null
  return Number(t)
}

export function TabMonitorCostos() {
  const { data: historial, isLoading } = useHistorialCostos(100)
  const { data: config } = useConfigCompras()
  const actualizar = useActualizarConfigCompras()
  // Lo que se tipeó y todavía no se guardó; el resto muestra lo de la base.
  const [borrador, setBorrador] = useState<Partial<Record<CampoConfig, string>>>({})

  // El historial resalta contra el umbral guardado, no contra lo que se tipea.
  const umbralActual = config?.umbral_variacion_costo ?? 10

  function valorGuardado(campo: CampoConfig): string {
    if (campo === 'umbral_variacion_costo') return String(umbralActual)
    const v = config?.[campo]
    return v == null ? '' : String(v)
  }
  const valor = (campo: CampoConfig) => borrador[campo] ?? valorGuardado(campo)
  const cambiar = (campo: CampoConfig, texto: string) =>
    setBorrador((b) => ({ ...b, [campo]: texto }))

  // Validación con los mismos límites que los check de la mig 151.
  const umbral = leerNumero(valor('umbral_variacion_costo'))
  const cobertura = leerNumero(valor('dias_cobertura_objetivo_default'))
  const seguridad = leerNumero(valor('dias_seguridad_default'))
  const frecuencia = leerNumero(valor('frecuencia_reposicion_default'))
  const sobrestock = leerNumero(valor('umbral_sobrestock_dias'))
  const errores: Partial<Record<CampoConfig, string>> = {}
  if (umbral == null || Number.isNaN(umbral) || umbral < 0)
    errores.umbral_variacion_costo = 'Tiene que ser 0 o más.'
  if (cobertura == null || Number.isNaN(cobertura) || cobertura <= 0)
    errores.dias_cobertura_objetivo_default = 'Tiene que ser mayor que 0.'
  if (seguridad == null || Number.isNaN(seguridad) || seguridad < 0)
    errores.dias_seguridad_default = 'Tiene que ser 0 o más.'
  if (frecuencia == null || Number.isNaN(frecuencia) || frecuencia <= 0)
    errores.frecuencia_reposicion_default = 'Tiene que ser mayor que 0.'
  if (sobrestock != null && (Number.isNaN(sobrestock) || sobrestock <= 0))
    errores.umbral_sobrestock_dias = 'Vacío o mayor que 0.'
  else if (sobrestock != null && cobertura != null && sobrestock <= cobertura)
    errores.umbral_sobrestock_dias = 'Tiene que superar la cobertura objetivo.'

  const cambiados = (Object.keys(borrador) as CampoConfig[]).filter(
    (c) => (borrador[c] ?? '').trim() !== valorGuardado(c)
  )
  const hayCambios = cambiados.length > 0
  const hayErrores = Object.keys(errores).length > 0

  function guardar() {
    if (!hayCambios || hayErrores) return
    const datos: ConfigComprasUpdate = {}
    for (const c of cambiados) {
      const n = leerNumero(borrador[c] ?? '')
      if (c === 'umbral_sobrestock_dias') datos.umbral_sobrestock_dias = n
      else if (n != null) datos[c] = n
    }
    actualizar.mutate(datos, { onSuccess: () => setBorrador({}) })
  }

  return (
    <div className="space-y-5">
      {/* Parámetros de compras: umbral de costo + defaults de reposición */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm space-y-5">
        <div className="flex items-start gap-3 flex-wrap justify-between">
          <div>
            <h3 className="text-[#391511] font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#f9b44c]" />
              Umbral de alerta de variación de costo
            </h3>
            <p className="text-[#6f3a2a] text-sm mt-1 max-w-md">
              Cuando un producto sube de costo por encima de este porcentaje, el
              sistema te alerta para que evalúes remarcar el precio de venta.
            </p>
          </div>
          <CampoNumero
            id="umbral_variacion_costo"
            etiqueta="Umbral (%)"
            valor={valor('umbral_variacion_costo')}
            onCambio={(t) => cambiar('umbral_variacion_costo', t)}
            error={errores.umbral_variacion_costo}
          />
        </div>

        <div className="border-t border-[#e4c9b0]/60 pt-4 space-y-3">
          <div>
            <h3 className="text-[#391511] font-semibold flex items-center gap-2">
              <PackageSearch className="h-4 w-4 text-[#f9b44c]" />
              Reposición por cobertura: valores por defecto
            </h3>
            <p className="text-[#6f3a2a] text-sm mt-1 max-w-xl">
              Los usa la Reposición por cobertura para los proveedores que no
              tienen los suyos cargados en su ficha. Todo en días.
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {CAMPOS_REPOSICION.map((c) => (
              <CampoNumero
                key={c.campo}
                id={c.campo}
                etiqueta={c.etiqueta}
                ayuda={c.ayuda}
                placeholder={c.placeholder}
                valor={valor(c.campo)}
                onCambio={(t) => cambiar(c.campo, t)}
                error={errores[c.campo]}
                ancho
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          {hayCambios && (
            <Button
              variant="outline"
              onClick={() => setBorrador({})}
              disabled={actualizar.isPending}
              className="h-10 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Descartar
            </Button>
          )}
          <Button
            onClick={guardar}
            disabled={!hayCambios || hayErrores || actualizar.isPending}
            className="h-10 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            {actualizar.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Guardar
          </Button>
        </div>
      </div>

      {/* Historial */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <h3 className="text-[#391511] font-semibold text-sm">
            Variaciones de costo recientes
          </h3>
        </div>
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={8} columnas={6} />
          </div>
        ) : !historial || historial.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <TrendingUp className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Todavía no hay variaciones registradas
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Cuando recibas mercadería o cargues facturas con costos distintos,
              vas a verlas acá.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Fecha
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Producto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Costo anterior
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Costo nuevo
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Variación
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Origen
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historial.map((v) => {
                  const supera = v.variacion_pct >= umbralActual
                  const baja = v.variacion_pct < 0
                  return (
                    <TableRow
                      key={v.id}
                      className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                    >
                      <TableCell className="text-[#6f3a2a] text-xs tabular-nums whitespace-nowrap">
                        {formatearFechaHora(v.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-[#391511] text-sm">
                          {v.producto_nombre}
                        </div>
                        {v.codigo_barras && (
                          <div className="text-[#c8a58a] text-xs font-mono">
                            {v.codigo_barras}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={v.costo_anterior} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-[#391511]">
                        <MontoARS monto={v.costo_nuevo} />
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            baja
                              ? 'inline-flex items-center gap-0.5 font-bold tabular-nums text-[#2f7d4f]'
                              : supera
                                ? 'inline-flex items-center gap-0.5 font-bold tabular-nums text-[#c43e2c]'
                                : 'inline-flex items-center gap-0.5 font-bold tabular-nums text-[#9e6b15]'
                          }
                        >
                          {baja ? (
                            <ArrowDownRight className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          )}
                          {v.variacion_pct > 0 ? '+' : ''}
                          {v.variacion_pct}%
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-[#6f3a2a] bg-[#f9d2a2]/30 rounded-full px-2 py-0.5">
                          {v.origen}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

function CampoNumero({
  id,
  etiqueta,
  ayuda,
  placeholder,
  valor,
  onCambio,
  error,
  ancho = false,
}: {
  id: string
  etiqueta: string
  ayuda?: string
  placeholder?: string
  valor: string
  onCambio: (texto: string) => void
  error?: string
  /** Ocupa todo el ancho de su celda (grilla de reposición). */
  ancho?: boolean
}) {
  return (
    <div className="space-y-1">
      <Label
        htmlFor={id}
        className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold"
      >
        {etiqueta}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={valor}
        placeholder={placeholder}
        onChange={(e) => onCambio(e.target.value)}
        aria-invalid={!!error}
        className={cn(
          'h-10 text-center tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]',
          ancho ? 'w-full' : 'w-24',
          error && 'border-[#c43e2c]'
        )}
      />
      {error ? (
        <p className="text-[11px] text-[#c43e2c]">{error}</p>
      ) : (
        ayuda && <p className="text-[11px] text-[#6f3a2a]">{ayuda}</p>
      )}
    </div>
  )
}
