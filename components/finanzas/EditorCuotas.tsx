'use client'

import { useMemo, useState } from 'react'
import { CalendarClock, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MontoARS } from '@/components/shared/MontoARS'
import { cn } from '@/lib/utils'

/**
 * Editor compartido del plan de cuotas de una deuda a proveedor (mig 148).
 * Es 100% controlado: las cuotas viven en el componente padre (así entran a
 * borradores/payloads); acá solo se editan y se valida que Σ = objetivo.
 * Lo usan: ModalEditarFactura, ModalCompraFactura y ModalCuotasCuenta.
 */

export interface CuotaForm {
  key: string
  monto: string
  /** yyyy-MM-dd */
  fecha: string
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Contador de módulo para keys estables de filas (mismo patrón que pagoKeyRef). */
let seqCuota = 0
const nuevaKey = () => `q${++seqCuota}`

export function sumaCuotas(cuotas: CuotaForm[]): number {
  return r2(cuotas.reduce((acc, c) => acc + (Number(c.monto) || 0), 0))
}

/** Válido = al menos 1 cuota, todas con monto > 0 y fecha, y Σ = objetivo ± $0,01. */
export function cuotasValidas(cuotas: CuotaForm[], objetivo: number): boolean {
  if (cuotas.length === 0) return false
  if (cuotas.some((c) => !(Number(c.monto) > 0) || !c.fecha)) return false
  return Math.abs(sumaCuotas(cuotas) - r2(objetivo)) <= 0.01
}

function hoyIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function isoMasDias(baseIso: string, dias: number): string {
  const [y, m, d] = baseIso.split('-').map(Number)
  const f = new Date(y, (m ?? 1) - 1, (d ?? 1) + dias)
  const mm = String(f.getMonth() + 1).padStart(2, '0')
  const dd = String(f.getDate()).padStart(2, '0')
  return `${f.getFullYear()}-${mm}-${dd}`
}

/**
 * Reparte `objetivo` en cuotas iguales redondeadas a centavos; la última
 * absorbe la diferencia para que la suma cierre exacta.
 */
export function repartirCuotas(
  objetivo: number,
  fechas: string[]
): CuotaForm[] {
  const n = fechas.length
  if (n === 0 || objetivo <= 0) return []
  const base = Math.floor((objetivo / n) * 100) / 100
  return fechas.map((fecha, i) => ({
    key: nuevaKey(),
    fecha,
    monto: String(i === n - 1 ? r2(objetivo - base * (n - 1)) : base),
  }))
}

/**
 * Términos tipo "30/60/90" (o "30 y 60 días") de la condición de pago del
 * proveedor → offsets en días para el generador. null si no hay ≥ 2 números.
 */
function terminosDesdeCondicion(condicion: string | null | undefined): number[] | null {
  const nums = (condicion ?? '').match(/\d+/g)?.map(Number).filter((n) => n > 0 && n <= 365)
  if (!nums || nums.length < 2) return null
  return nums.slice(0, 12)
}

interface Props {
  /** Importe a repartir (el saldo que queda a cuenta corriente). */
  objetivo: number
  cuotas: CuotaForm[]
  onChange: (cuotas: CuotaForm[]) => void
  /** Condición de pago del proveedor ("30/60/90") para el generador rápido. */
  condicionPago?: string | null
  deshabilitado?: boolean
}

export function EditorCuotas({
  objetivo,
  cuotas,
  onChange,
  condicionPago,
  deshabilitado = false,
}: Props) {
  const objetivoR = r2(Math.max(0, objetivo))
  const [cantidad, setCantidad] = useState('3')
  const [primeraFecha, setPrimeraFecha] = useState(() => isoMasDias(hoyIso(), 30))
  const [intervalo, setIntervalo] = useState('30')

  const terminos = useMemo(() => terminosDesdeCondicion(condicionPago), [condicionPago])

  const suma = sumaCuotas(cuotas)
  const diferencia = r2(objetivoR - suma)
  const cierra = Math.abs(diferencia) <= 0.01 && cuotas.length > 0

  const generar = () => {
    const n = Math.min(Math.max(Math.trunc(Number(cantidad)) || 1, 1), 12)
    const cada = Math.min(Math.max(Math.trunc(Number(intervalo)) || 1, 1), 365)
    const fechas = Array.from({ length: n }, (_, i) =>
      isoMasDias(primeraFecha || isoMasDias(hoyIso(), 30), i * cada)
    )
    onChange(repartirCuotas(objetivoR, fechas))
  }

  const generarPorTerminos = () => {
    if (!terminos) return
    const hoy = hoyIso()
    onChange(repartirCuotas(objetivoR, terminos.map((d) => isoMasDias(hoy, d))))
  }

  const setCampo = (key: string, campo: 'monto' | 'fecha', valor: string) => {
    onChange(cuotas.map((c) => (c.key === key ? { ...c, [campo]: valor } : c)))
  }

  const agregar = () => {
    const ultima = cuotas[cuotas.length - 1]
    onChange([
      ...cuotas,
      {
        key: nuevaKey(),
        // Precarga con lo que falta para cerrar (si falta), 30 días después
        // de la última cuota cargada.
        monto: diferencia > 0 ? String(diferencia) : '',
        fecha: isoMasDias(ultima?.fecha || hoyIso(), 30),
      },
    ])
  }

  const quitar = (key: string) => {
    onChange(cuotas.filter((c) => c.key !== key))
  }

  return (
    <div className="space-y-2 rounded-lg border border-[#e4c9b0]/60 bg-white/60 p-2.5">
      {/* Generador rápido */}
      <div className="flex flex-wrap items-end gap-1.5">
        <div className="space-y-0.5">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-[#6f3a2a]">
            Cuotas
          </span>
          <Input
            type="number"
            min={1}
            max={12}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            disabled={deshabilitado}
            className="h-8 w-14 text-xs tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
          />
        </div>
        <div className="space-y-0.5">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-[#6f3a2a]">
            Primera
          </span>
          <Input
            type="date"
            value={primeraFecha}
            onChange={(e) => setPrimeraFecha(e.target.value)}
            disabled={deshabilitado}
            className="h-8 w-34 text-xs tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
          />
        </div>
        <div className="space-y-0.5">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-[#6f3a2a]">
            Cada (días)
          </span>
          <Input
            type="number"
            min={1}
            max={365}
            value={intervalo}
            onChange={(e) => setIntervalo(e.target.value)}
            disabled={deshabilitado}
            className="h-8 w-16 text-xs tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={generar}
          disabled={deshabilitado || objetivoR <= 0}
          className="h-8 border-[#e4c9b0] text-xs text-[#391511] hover:bg-[#f9d2a2]/40"
        >
          <CalendarClock className="mr-1 h-3.5 w-3.5" />
          Generar
        </Button>
        {terminos && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={generarPorTerminos}
            disabled={deshabilitado || objetivoR <= 0}
            className="h-8 border-[#f9b44c] bg-[#f9d2a2]/30 text-xs text-[#391511] hover:bg-[#f9d2a2]/60"
            title="Según la condición de pago del proveedor"
          >
            Usar {terminos.join('/')}
          </Button>
        )}
      </div>

      {/* Filas de cuotas */}
      {cuotas.length > 0 && (
        <div className="space-y-1.5">
          {cuotas.map((c, i) => (
            <div key={c.key} className="flex items-center gap-1.5">
              <span className="w-14 shrink-0 text-[11px] font-semibold tabular-nums text-[#6f3a2a]">
                Cuota {i + 1}
              </span>
              <div className="relative flex-1 min-w-0">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#6f3a2a]/70">
                  $
                </span>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={c.monto}
                  onChange={(e) => setCampo(c.key, 'monto', e.target.value)}
                  disabled={deshabilitado}
                  className="h-8 pl-5 text-xs tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <Input
                type="date"
                value={c.fecha}
                onChange={(e) => setCampo(c.key, 'fecha', e.target.value)}
                disabled={deshabilitado}
                className="h-8 w-34 shrink-0 text-xs tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => quitar(c.key)}
                disabled={deshabilitado}
                className="h-8 w-8 shrink-0 text-[#6f3a2a] hover:text-[#c43e2c]"
                aria-label={`Quitar cuota ${i + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={agregar}
          disabled={deshabilitado}
          className="h-7 px-2 text-xs text-[#6f3a2a] hover:text-[#391511]"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Agregar cuota
        </Button>
        <p
          className={cn(
            'text-[11px] tabular-nums',
            cierra ? 'text-[#2f8f4e]' : 'text-[#c43e2c] font-semibold'
          )}
        >
          Σ <MontoARS monto={suma} /> de <MontoARS monto={objetivoR} />
          {!cierra && cuotas.length > 0 && (
            <>
              {' · '}
              {diferencia > 0 ? 'faltan ' : 'sobran '}
              <MontoARS monto={Math.abs(diferencia)} />
            </>
          )}
        </p>
      </div>
    </div>
  )
}
