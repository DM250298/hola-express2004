'use client'

import { AlertTriangle, Calendar, Info, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { aTipeo } from '@/lib/utils/fechaCorta'
import { formatearCantidad, formatearNumero } from '@/lib/utils/formato'
import {
  facturaEnBlanco,
  unidadesDeCargas,
  type FacturaEntrega,
} from '@/lib/recepcion/borrador'
import type { Advertencia, ItemEstado } from './tipos'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  facturas: FacturaEntrega[]
  porId: Map<number, ItemEstado>
  advertencias: Advertencia[]
  controlado: boolean
  procesando: boolean
  onControlado: (v: boolean) => void
  onIrAFactura: (idx: number) => void
  onCerrar: () => void
  onConfirmar: () => void
}

/**
 * Último control antes de grabar.
 *
 * Muestra, factura por factura, exactamente lo que va a viajar a la base y en
 * qué orden — que es el mismo orden en que administración después carga los
 * precios. Es el lugar donde se atajan los tres errores caros: la factura sin
 * N°, el renglón que quedó sin cantidad y la fecha de vencimiento que faltó.
 *
 * El tilde final ("controlé la mercadería contra el papel") no lo verifica
 * ningún sistema: sirve para que quien recibe sepa que está firmando algo, que
 * es lo único que se puede hacer contra el hábito de copiar las cantidades de
 * la orden de compra sin contar de verdad. Queda registrado quién confirmó.
 */
export function HojaRevision({
  abierto,
  facturas,
  porId,
  advertencias,
  controlado,
  procesando,
  onControlado,
  onIrAFactura,
  onCerrar,
  onConfirmar,
}: Props) {
  const conCarga = facturas
    .map((f, idx) => ({ f, idx }))
    .filter(({ f }) => !facturaEnBlanco(f))

  const bloqueantes = advertencias.filter((a) => a.bloqueante)
  const avisos = advertencias.filter((a) => !a.bloqueante)
  const puedeConfirmar = bloqueantes.length === 0 && controlado && !procesando

  const totalUnidades = facturas.reduce(
    (acc, f) => acc + unidadesDeCargas(f.cargas),
    0
  )
  const totalRenglones = facturas.reduce((acc, f) => acc + f.orden.length, 0)

  return (
    <Sheet
      open={abierto}
      onOpenChange={(v, detalles) => {
        if (!v && (procesando || detalles.reason === 'outside-press')) {
          detalles.cancel()
          return
        }
        if (!v) onCerrar()
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[94vh] gap-0 overflow-y-auto rounded-t-2xl border-[#e4c9b0] bg-[#fdfaf6] pb-4"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="pr-8 text-left text-lg text-[#391511]">
            Revisá antes de confirmar
          </SheetTitle>
          <SheetDescription className="text-left text-xs text-[#6f3a2a]">
            {totalRenglones} renglón{totalRenglones === 1 ? '' : 'es'} ·{' '}
            {formatearNumero(Math.round(totalUnidades * 1000) / 1000)} u. en{' '}
            {conCarga.length} factura{conCarga.length === 1 ? '' : 's'}. Una vez
            confirmado entra al stock y se crea la deuda al proveedor.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-3 px-4">
          {advertencias.length > 0 && (
            <ul className="space-y-1.5">
              {[...bloqueantes, ...avisos].map((a) => (
                <li key={a.clave}>
                  <button
                    type="button"
                    onClick={() => {
                      if (a.facturaIdx != null) {
                        onIrAFactura(a.facturaIdx)
                        onCerrar()
                      }
                    }}
                    disabled={a.facturaIdx == null}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs',
                      a.bloqueante
                        ? 'border-[#c43e2c]/40 bg-[#c43e2c]/10 text-[#391511]'
                        : 'border-[#e4a42a]/40 bg-[#f9b44c]/15 text-[#391511]',
                      a.facturaIdx != null && 'active:scale-[0.99]'
                    )}
                  >
                    {a.bloqueante ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#c43e2c]" />
                    ) : (
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#9e6b15]" />
                    )}
                    <span className="min-w-0 flex-1">{a.texto}</span>
                    {a.facturaIdx != null && (
                      <span className="shrink-0 font-semibold text-[#9e6b15]">
                        Ver
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {conCarga.map(({ f, idx }) => (
            <div
              key={f.id}
              className="overflow-hidden rounded-xl border border-[#e4c9b0]/70 bg-white"
            >
              <button
                type="button"
                onClick={() => {
                  onIrAFactura(idx)
                  onCerrar()
                }}
                className="flex w-full items-center justify-between gap-2 border-b border-[#e4c9b0]/50 bg-[#fdfaf6] px-3 py-2 text-left active:opacity-70"
              >
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
                    Factura {idx + 1}
                  </span>
                  <span
                    className={cn(
                      'block truncate text-sm font-bold',
                      f.numero.trim() ? 'text-[#391511]' : 'text-[#c43e2c]'
                    )}
                  >
                    {f.numero.trim() || 'Falta el N° — tocá para cargarlo'}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[11px] tabular-nums text-[#6f3a2a]">
                  <span className="block font-bold text-[#391511]">
                    {formatearNumero(
                      Math.round(unidadesDeCargas(f.cargas) * 1000) / 1000
                    )}{' '}
                    u.
                  </span>
                  {f.orden.length} renglón{f.orden.length === 1 ? '' : 'es'}
                </span>
              </button>

              <ul className="divide-y divide-[#e4c9b0]/30">
                {f.orden.map((id, i) => {
                  const item = porId.get(id)
                  const c = f.cargas[id]
                  if (!item) return null
                  const cant = Number(c?.cantidad) || 0
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs"
                    >
                      <span className="w-5 shrink-0 text-right tabular-nums text-[#c8a58a]">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[#391511]">
                        {item.nombre}
                      </span>
                      {c?.sin_vencimiento ? (
                        <span className="shrink-0 text-[10px] text-[#6f3a2a]">
                          no vence
                        </span>
                      ) : c?.fecha_vencimiento ? (
                        <span className="flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums text-[#6f3a2a]">
                          <Calendar className="h-2.5 w-2.5" />
                          {aTipeo(c.fecha_vencimiento)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] font-semibold text-[#9e6b15]">
                          sin fecha
                        </span>
                      )}
                      <span
                        className={cn(
                          'w-16 shrink-0 text-right font-bold tabular-nums',
                          cant > 0 ? 'text-[#391511]' : 'text-[#c43e2c]'
                        )}
                      >
                        {cant > 0
                          ? formatearCantidad(cant, item.venta_por_peso)
                          : '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

          <label
            className={cn(
              'flex items-start gap-2 rounded-xl border-2 p-3 text-sm transition',
              controlado
                ? 'border-[#2f7d4f]/40 bg-[#2f7d4f]/10'
                : 'border-[#e4a42a]/60 bg-white'
            )}
          >
            <input
              type="checkbox"
              checked={controlado}
              onChange={(e) => onControlado(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#2f7d4f]"
            />
            <span className="font-medium text-[#391511]">
              Controlé la mercadería contra el papel
              <span className="mt-0.5 block text-[11px] font-normal text-[#6f3a2a]">
                Las cantidades son las que conté, no las de la orden de compra.
              </span>
            </span>
          </label>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCerrar}
              disabled={procesando}
              className="h-12 flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Volver
            </Button>
            <Button
              type="button"
              onClick={onConfirmar}
              disabled={!puedeConfirmar}
              className="h-12 flex-[2] bg-[#f9b44c] text-base font-semibold text-[#391511] hover:bg-[#e4a42a]"
            >
              {procesando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Grabando…
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Confirmar recepción
                </>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
