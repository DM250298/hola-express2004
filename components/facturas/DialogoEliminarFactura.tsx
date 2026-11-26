'use client'

import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearFechaCortaISO } from '@/lib/utils/formato'
import {
  useEliminarFactura,
  usePrevisualizarEliminarFactura,
} from '@/lib/hooks/useFacturasCompra'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Deuda de la factura (con orden, o directa que dejó saldo). */
  cuentaId: number | null
  /** Factura: se usa cuando no hay deuda (compra directa pagada en el acto). */
  facturaId: number | null
  /** "ARCOR · A 0003-00045812", para el título. */
  descripcion: string
  /** Se llama después de eliminar (para cerrar el panel o el editor). */
  onEliminada?: () => void
}

/**
 * Confirmación de "Eliminar factura": antes de borrar le pregunta a la base
 * qué se va a deshacer (pagos, stock, costos, recepción) y lo muestra. Si el
 * mes está cerrado, lo dice y no deja seguir.
 */
export function DialogoEliminarFactura({
  abierto,
  onCambioAbierto,
  cuentaId,
  facturaId,
  descripcion,
  onEliminada,
}: Props) {
  const clave = abierto && (cuentaId != null || facturaId != null) ? { cuentaId, facturaId } : null
  const previa = usePrevisualizarEliminarFactura(clave)
  const eliminar = useEliminarFactura()
  const r = previa.data
  const procesando = eliminar.isPending
  const bloqueada = !!r?.bloqueo || previa.isError

  function confirmar() {
    if (!clave || bloqueada) return
    eliminar.mutate(clave, {
      onSuccess: () => {
        onCambioAbierto(false)
        onEliminada?.()
      },
    })
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!procesando}>
        <DialogHeader>
          <DialogTitle className="text-[#391511]">Eliminar la factura</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {descripcion}. Se deshace todo lo que generó; no se puede recuperar.
          </DialogDescription>
        </DialogHeader>

        {previa.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-[#6f3a2a]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Revisando qué hay que deshacer…
          </div>
        ) : previa.isError ? (
          <Aviso icono="error">
            No se pudo revisar la factura: {(previa.error as Error).message}
          </Aviso>
        ) : r?.bloqueo ? (
          <Aviso icono="candado">{r.bloqueo}</Aviso>
        ) : r ? (
          <div className="space-y-3 text-sm text-[#391511]">
            <ul className="space-y-2">
              {r.pagos_revertidos.length > 0 && (
                <li>
                  <span className="font-semibold">
                    {r.pagos_revertidos.length === 1
                      ? 'Se revierte 1 pago'
                      : `Se revierten ${r.pagos_revertidos.length} pagos`}
                  </span>
                  : la plata vuelve a la cuenta de la que salió.
                  <ul className="mt-1 space-y-0.5 text-xs text-[#6f3a2a]">
                    {r.pagos_revertidos.map((p, i) => (
                      <li key={i} className="flex justify-between gap-3 tabular-nums">
                        <span>
                          {formatearFechaCortaISO(p.fecha)} · {p.cuenta}
                        </span>
                        <MontoARS monto={p.monto} />
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {r.recepcion_revertida ? (
                <li>
                  <span className="font-semibold">Se deshace la recepción</span>: la
                  mercadería sale del stock, la deuda desaparece y la orden vuelve a
                  &quot;Por recibir&quot;.
                </li>
              ) : (
                r.productos_stock > 0 && (
                  <li>
                    <span className="font-semibold">Sale del stock</span> lo que había
                    entrado con esta compra.
                  </li>
                )
              )}
              <li>
                <span className="font-semibold">Costos y precios</span>:{' '}
                {r.costos_restaurados > 0
                  ? `${r.costos_restaurados} ${r.costos_restaurados === 1 ? 'producto vuelve' : 'productos vuelven'} al costo y precio que tenían antes.`
                  : 'esta factura no dejó cambios para volver atrás.'}
              </li>
              <li>
                Se borran el comprobante, sus cuotas, los pagos agendados y los
                asientos contables. Queda registrado en Auditoría.
              </li>
            </ul>

            {r.productos_negativos.length > 0 && (
              <Aviso icono="error">
                <span className="font-semibold">
                  {r.productos_negativos.length === 1
                    ? '1 producto ya se vendió y va a quedar con stock negativo'
                    : `${r.productos_negativos.length} productos ya se vendieron y van a quedar con stock negativo`}
                </span>
                . Después corregilos con un ajuste de stock.
                <ul className="mt-1 max-h-28 overflow-y-auto text-xs">
                  {r.productos_negativos.map((p) => (
                    <li key={p.producto_id} className="flex justify-between gap-3 tabular-nums">
                      <span className="truncate">{p.nombre}</span>
                      <span className="shrink-0">
                        {p.stock_actual} → {p.stock_final}
                      </span>
                    </li>
                  ))}
                </ul>
              </Aviso>
            )}

            {r.costos_no_restaurados.length > 0 && (
              <div className="rounded-lg border border-[#e4c9b0] bg-[#fdfaf6] px-3 py-2 text-xs text-[#6f3a2a]">
                <span className="font-semibold text-[#391511]">
                  {r.costos_no_restaurados.length === 1
                    ? '1 producto conserva su costo y precio actuales'
                    : `${r.costos_no_restaurados.length} productos conservan su costo y precio actuales`}
                </span>{' '}
                porque una compra posterior ya los cambió:{' '}
                {r.costos_no_restaurados.map((p) => p.nombre).join(', ')}.
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            {bloqueada ? 'Cerrar' : 'Cancelar'}
          </Button>
          {!bloqueada && (
            <Button
              onClick={confirmar}
              disabled={procesando || previa.isLoading || !r}
              className="bg-[#c43e2c] hover:bg-[#9e2f25] text-white font-bold"
            >
              {procesando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Sí, eliminar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Aviso({
  icono,
  children,
}: {
  icono: 'error' | 'candado'
  children: React.ReactNode
}) {
  const Icono = icono === 'candado' ? Lock : AlertTriangle
  return (
    <div className="flex gap-2 rounded-lg border border-[#c43e2c]/40 bg-[#c43e2c]/[0.05] px-3 py-2 text-sm text-[#9e2f25]">
      <Icono className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
