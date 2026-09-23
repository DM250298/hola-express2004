'use client'

import { useMemo } from 'react'
import { MontoARS } from '@/components/shared/MontoARS'
import type { MovimientoConCuenta } from '@/lib/queries/cuentas'
import { cn } from '@/lib/utils'

/** Nombre legible de cada categoría que escriben los RPCs y la UI. */
const ETIQUETA_CATEGORIA: Record<string, string> = {
  venta: 'Ventas (bruto)',
  acreditacion: 'Acreditaciones de tarjeta / MP',
  comisiones: 'Comisiones',
  iibb: 'Retenciones IIBB',
  pago_proveedores: 'Pagos a proveedores',
  caja_fuerte: 'Caja fuerte (manual)',
  devolucion: 'Devoluciones',
  cobro_cliente: 'Cobros a clientes',
  aporte_socio: 'Aportes de socio',
  retiro_socio: 'Retiros de socio',
  ajuste_conciliacion: 'Ajustes de conciliación',
  sueldos: 'Sueldos',
  servicios: 'Servicios',
  impuestos: 'Impuestos',
  alquiler: 'Alquiler',
  mantenimiento: 'Mantenimiento',
  otros: 'Otros',
  sin_categoria: 'Sin categoría',
  transf_entrada: 'Transferencias recibidas',
  transf_salida: 'Transferencias enviadas',
}

export function etiquetaCategoriaMov(clave: string): string {
  if (ETIQUETA_CATEGORIA[clave]) return ETIQUETA_CATEGORIA[clave]
  const t = clave.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Clave de agrupación: las transferencias van por tipo, el resto por categoría. */
export function claveCategoriaMov(m: Pick<MovimientoConCuenta, 'tipo' | 'categoria'>): string {
  if (m.tipo === 'transferencia_entrada') return 'transf_entrada'
  if (m.tipo === 'transferencia_salida') return 'transf_salida'
  return m.categoria || 'sin_categoria'
}

export function esEntradaMov(tipo: MovimientoConCuenta['tipo']): boolean {
  return tipo === 'ingreso' || tipo === 'transferencia_entrada' || tipo === 'ajuste'
}

interface Props {
  movimientos: MovimientoConCuenta[]
  cuentaNombre: string
}

/**
 * Resumen del período de UNA cuenta, por categoría: saldo inicial + entradas −
 * salidas = saldo final. Es la planilla para comparar renglón por renglón
 * contra el reporte de liquidaciones de Mercado Pago (o el extracto del
 * banco): ventas brutas, comisiones y retenciones por separado.
 */
export function ResumenCategoriasCuenta({ movimientos, cuentaNombre }: Props) {
  const resumen = useMemo(() => {
    const grupos = new Map<string, { entradas: number; salidas: number; cantidad: number }>()
    let entradas = 0
    let salidas = 0
    for (const m of movimientos) {
      const clave = claveCategoriaMov(m)
      const g = grupos.get(clave) ?? { entradas: 0, salidas: 0, cantidad: 0 }
      const monto = Number(m.monto)
      if (esEntradaMov(m.tipo)) {
        g.entradas += monto
        entradas += monto
      } else {
        g.salidas += monto
        salidas += monto
      }
      g.cantidad += 1
      grupos.set(clave, g)
    }
    const filas = [...grupos.entries()]
      .map(([clave, g]) => ({ clave, ...g, neto: g.entradas - g.salidas }))
      .sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto))
    // La lista viene ordenada de la más nueva a la más vieja.
    const masVieja = movimientos[movimientos.length - 1]
    const masNueva = movimientos[0]
    return {
      filas,
      entradas,
      salidas,
      saldoInicial: masVieja ? Number(masVieja.saldo_anterior) : null,
      saldoFinal: masNueva ? Number(masNueva.saldo_nuevo) : null,
    }
  }, [movimientos])

  if (movimientos.length === 0) return null

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm space-y-3">
      <div>
        <h3 className="text-[#391511] font-bold text-sm">
          Resumen por categoría · {cuentaNombre}
        </h3>
        <p className="text-[11px] text-[#6f3a2a]">
          Compará cada renglón contra el reporte de la billetera o el extracto
          del banco del mismo período. Si el saldo final no coincide con el
          real, la diferencia se registra desde Contabilidad › Conciliar banco.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[#6f3a2a] border-b border-[#e4c9b0]/60">
              <th className="py-1.5 text-left font-semibold">Categoría</th>
              <th className="py-1.5 text-right font-semibold">Mov.</th>
              <th className="py-1.5 text-right font-semibold">Entradas</th>
              <th className="py-1.5 text-right font-semibold">Salidas</th>
            </tr>
          </thead>
          <tbody>
            {resumen.saldoInicial !== null && (
              <tr className="border-b border-[#e4c9b0]/40 bg-[#fdfaf6]">
                <td className="py-1.5 font-semibold text-[#391511]" colSpan={2}>
                  Saldo al inicio del período
                </td>
                <td className="py-1.5 text-right tabular-nums font-semibold text-[#391511]" colSpan={2}>
                  <MontoARS monto={resumen.saldoInicial} />
                </td>
              </tr>
            )}
            {resumen.filas.map((f) => (
              <tr key={f.clave} className="border-b border-[#e4c9b0]/40">
                <td className="py-1.5 text-[#391511]">{etiquetaCategoriaMov(f.clave)}</td>
                <td className="py-1.5 text-right tabular-nums text-[#6f3a2a]">{f.cantidad}</td>
                <td className="py-1.5 text-right tabular-nums text-[#6f3a2a]">
                  {f.entradas > 0 ? <MontoARS monto={f.entradas} /> : '—'}
                </td>
                <td className={cn('py-1.5 text-right tabular-nums', f.salidas > 0 ? 'text-[#c43e2c]' : 'text-[#6f3a2a]')}>
                  {f.salidas > 0 ? <MontoARS monto={f.salidas} /> : '—'}
                </td>
              </tr>
            ))}
            <tr className="border-b border-[#e4c9b0]/60 font-semibold">
              <td className="py-1.5 text-[#391511]" colSpan={2}>Total del período</td>
              <td className="py-1.5 text-right tabular-nums text-[#391511]">
                <MontoARS monto={resumen.entradas} />
              </td>
              <td className="py-1.5 text-right tabular-nums text-[#c43e2c]">
                <MontoARS monto={resumen.salidas} />
              </td>
            </tr>
            {resumen.saldoFinal !== null && (
              <tr className="bg-[#fdfaf6]">
                <td className="py-1.5 font-bold text-[#391511]" colSpan={2}>
                  Saldo al final del período
                </td>
                <td className="py-1.5 text-right tabular-nums font-bold text-[#391511]" colSpan={2}>
                  <MontoARS monto={resumen.saldoFinal} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
