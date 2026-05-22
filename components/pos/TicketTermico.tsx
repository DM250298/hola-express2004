'use client'

import { useMediosPago } from '@/lib/hooks/useMediosPago'
import { etiquetaMedioFallback } from '@/lib/utils/iconosMedioPago'
import { formatearFechaHora, formatearMonto } from '@/lib/utils/formato'
import type { VentaCompleta } from '@/lib/queries/ventas'

interface Props {
  venta: VentaCompleta
  vuelto: number | null
  nombreCajero: string
}

/**
 * Ticket de venta para impresora térmica de 80mm.
 *
 * Se renderiza fuera de pantalla (clase `.imprimir-termico`); el CSS de
 * `@media print` en globals.css lo hace visible y oculta el resto al
 * ejecutar `window.print()`.
 */
export function TicketTermico({ venta, vuelto, nombreCajero }: Props) {
  const { data: medios } = useMediosPago()

  function etiquetaMedio(codigo: string): string {
    return (
      (medios ?? []).find((m) => m.codigo === codigo)?.nombre ??
      etiquetaMedioFallback(codigo)
    )
  }

  return (
    <div className="imprimir-termico">
      <div className="ticket-termico">
        {/* Encabezado */}
        <div className="ticket-marca">¡Hola! Express</div>
        <div className="ticket-sub">Autoservicio 24 horas · La Rioja</div>

        <hr className="ticket-sep" />

        {/* Datos del comprobante */}
        <div className="ticket-meta">
          {venta.pendiente ? (
            <div className="ticket-pendiente">
              Comprobante no fiscal
              <br />
              Pendiente de sincronizar
            </div>
          ) : (
            <div className="ticket-meta-num">Ticket N° {venta.venta.id}</div>
          )}
          <div>{formatearFechaHora(venta.venta.fecha)}</div>
          <div>Atendió: {nombreCajero}</div>
        </div>

        <hr className="ticket-sep" />

        {/* Detalle de productos */}
        <div>
          {venta.items.map((it) => (
            <div className="ticket-item" key={it.producto_id}>
              <span className="ticket-item-cant">{it.cantidad}×</span>
              <span className="ticket-item-nombre">
                {it.nombre}
                {it.cantidad > 1 && (
                  <span className="ticket-item-unit">
                    {formatearMonto(it.precio_unitario)} c/u
                  </span>
                )}
              </span>
              <span className="ticket-item-precio">
                {formatearMonto(it.subtotal)}
              </span>
            </div>
          ))}
        </div>

        <hr className="ticket-sep ticket-sep-fuerte" />

        {/* Total */}
        <div className="ticket-total">
          <span className="ticket-total-label">TOTAL</span>
          <span className="ticket-total-monto">
            {formatearMonto(venta.total)}
          </span>
        </div>

        <hr className="ticket-sep" />

        {/* Pagos */}
        <div className="ticket-titulo-bloque">
          {venta.pagos.length === 1 ? 'Forma de pago' : 'Pagos'}
        </div>
        {venta.pagos.map((p, i) => (
          <div className="ticket-fila" key={i}>
            <span>{etiquetaMedio(p.medio_pago)}</span>
            <span>{formatearMonto(p.monto)}</span>
          </div>
        ))}
        {vuelto != null && vuelto > 0 && (
          <div className="ticket-fila ticket-fila-fuerte">
            <span>Vuelto</span>
            <span>{formatearMonto(vuelto)}</span>
          </div>
        )}

        <hr className="ticket-sep ticket-sep-fuerte" />

        {/* Pie */}
        <div className="ticket-gracias">¡Gracias por su compra!</div>
        <div className="ticket-pie">
          Te esperamos · Abierto las 24 horas
        </div>
      </div>
    </div>
  )
}
