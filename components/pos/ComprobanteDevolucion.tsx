'use client'

import { formatearFechaHora, formatearMonto } from '@/lib/utils/formato'
import type { TipoReembolso } from '@/types/database'

interface ItemComp {
  nombre: string
  cantidad: number
  subtotal: number
}

interface Props {
  ventaId?: number | null
  total: number
  reembolso: TipoReembolso
  codigoNc?: string | null
  items: ItemComp[]
}

const ETIQUETA_REEMBOLSO: Record<TipoReembolso, string> = {
  efectivo: 'Efectivo',
  nota_credito: 'Nota de crédito',
  tarjeta: 'Reverso a tarjeta',
}

/**
 * Comprobante de devolución para impresora térmica de 80mm.
 * Si el reembolso es nota de crédito, imprime también el código del vale.
 */
export function ComprobanteDevolucion({
  ventaId,
  total,
  reembolso,
  codigoNc,
  items,
}: Props) {
  return (
    <div className="imprimir-termico">
      <div className="ticket-termico">
        <div className="ticket-marca">¡Hola! Express</div>
        <div className="ticket-sub">Autoservicio 24 horas · La Rioja</div>

        <hr className="ticket-sep ticket-sep-fuerte" />

        <div
          className="ticket-titulo-bloque"
          style={{ textAlign: 'center', fontSize: '1.1em' }}
        >
          COMPROBANTE DE DEVOLUCIÓN
        </div>

        <div className="ticket-meta">
          <div>{formatearFechaHora(new Date().toISOString())}</div>
          {ventaId ? <div>Venta de origen N° {ventaId}</div> : null}
        </div>

        <hr className="ticket-sep" />

        {/* Items devueltos */}
        <div>
          {items.map((it, i) => (
            <div className="ticket-item" key={i}>
              <span className="ticket-item-cant">{it.cantidad}×</span>
              <span className="ticket-item-nombre">{it.nombre}</span>
              <span className="ticket-item-precio">
                {formatearMonto(it.subtotal)}
              </span>
            </div>
          ))}
        </div>

        <hr className="ticket-sep ticket-sep-fuerte" />

        <div className="ticket-total">
          <span className="ticket-total-label">DEVUELTO</span>
          <span className="ticket-total-monto">{formatearMonto(total)}</span>
        </div>

        <hr className="ticket-sep" />

        <div className="ticket-fila">
          <span>Reembolso</span>
          <span>{ETIQUETA_REEMBOLSO[reembolso]}</span>
        </div>

        {/* Vale de nota de crédito */}
        {reembolso === 'nota_credito' && codigoNc && (
          <>
            <hr className="ticket-sep" />
            <div className="ticket-sub" style={{ textAlign: 'center' }}>
              NOTA DE CRÉDITO · Vale para tu próxima compra
            </div>
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
              {codigoNc}
            </div>
            <div className="ticket-pie" style={{ textAlign: 'center' }}>
              Presentá este código al pagar.
              <br />
              No es canjeable por efectivo.
            </div>
          </>
        )}

        <hr className="ticket-sep ticket-sep-fuerte" />
        <div className="ticket-gracias">¡Gracias!</div>
      </div>
    </div>
  )
}
