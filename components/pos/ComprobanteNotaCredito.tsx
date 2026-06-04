'use client'

import { formatearFechaHora, formatearMonto } from '@/lib/utils/formato'

interface Props {
  codigo: string
  monto: number
  ventaId?: number | null
}

/**
 * Vale de nota de crédito para impresora térmica de 80mm.
 * Se renderiza fuera de pantalla con `.imprimir-termico`; el CSS de
 * `@media print` lo hace visible y oculta el resto al hacer `window.print()`.
 */
export function ComprobanteNotaCredito({ codigo, monto, ventaId }: Props) {
  return (
    <div className="imprimir-termico">
      <div className="ticket-termico">
        <div className="ticket-marca">¡Hola! Express</div>
        <div className="ticket-sub">Autoservicio 24 horas · La Rioja</div>

        <hr className="ticket-sep ticket-sep-fuerte" />

        <div className="ticket-titulo-bloque" style={{ textAlign: 'center', fontSize: '1.1em' }}>
          NOTA DE CRÉDITO
        </div>
        <div className="ticket-sub" style={{ textAlign: 'center' }}>
          Vale para tu próxima compra
        </div>

        <hr className="ticket-sep" />

        {/* Código grande */}
        <div
          style={{
            textAlign: 'center',
            fontFamily: 'monospace',
            fontSize: '1.6em',
            fontWeight: 800,
            letterSpacing: '0.08em',
            margin: '3mm 0',
          }}
        >
          {codigo}
        </div>

        {/* Monto */}
        <div className="ticket-total">
          <span className="ticket-total-label">SALDO</span>
          <span className="ticket-total-monto">{formatearMonto(monto)}</span>
        </div>

        <hr className="ticket-sep" />

        <div className="ticket-meta">
          <div>Emitida: {formatearFechaHora(new Date().toISOString())}</div>
          {ventaId ? <div>Origen: venta N° {ventaId}</div> : null}
        </div>

        <hr className="ticket-sep ticket-sep-fuerte" />

        <div className="ticket-pie" style={{ textAlign: 'center' }}>
          Presentá este código al pagar.
          <br />
          No es canjeable por efectivo.
        </div>
        <div className="ticket-gracias">¡Te esperamos!</div>
      </div>
    </div>
  )
}
