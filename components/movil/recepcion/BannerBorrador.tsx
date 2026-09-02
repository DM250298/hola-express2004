'use client'

import { History } from 'lucide-react'

interface Props {
  renglones: number
  facturas: number
  /** Nombres de renglones que estaban cargados y ya no están en la orden. */
  nombresDescartados: string[]
  /** Cuántos renglones cambiaron su recibido en la base desde el guardado. */
  recibidoCambio: number
  onDescartar: () => void
}

/**
 * Aviso de que la descarga se recuperó de un cierre.
 *
 * Además de tranquilizar, tiene que decir qué NO se pudo recuperar: si otra
 * sesión sacó un renglón de la orden o ya recibió mercadería mientras este
 * teléfono tenía el borrador dormido, seguir a ciegas duplicaría el stock.
 */
export function BannerBorrador({
  renglones,
  facturas,
  nombresDescartados,
  recibidoCambio,
  onDescartar,
}: Props) {
  return (
    <div className="mb-3 rounded-xl border border-[#e4a42a]/60 bg-[#f9b44c]/15 p-3">
      <div className="flex items-start gap-2">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-[#9e6b15]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#391511]">
            Recuperamos lo que estabas cargando
          </p>
          <p className="text-xs text-[#6f3a2a]">
            {renglones} renglón{renglones === 1 ? '' : 'es'} en {facturas}{' '}
            factura{facturas === 1 ? '' : 's'}. Seguí donde ibas.
          </p>
        </div>
        <button
          type="button"
          onClick={onDescartar}
          className="shrink-0 rounded-md border border-[#e4c9b0] bg-white px-2 py-1 text-xs font-semibold text-[#6f3a2a] active:scale-95"
        >
          Descartar
        </button>
      </div>

      {(nombresDescartados.length > 0 || recibidoCambio > 0) && (
        <ul className="mt-2 space-y-1 border-t border-[#e4a42a]/30 pt-2 text-[11px] text-[#c43e2c]">
          {nombresDescartados.length > 0 && (
            <li>
              <strong>{nombresDescartados.slice(0, 3).join(', ')}</strong>
              {nombresDescartados.length > 3 &&
                ` y ${nombresDescartados.length - 3} más`}{' '}
              ya no {nombresDescartados.length === 1 ? 'está' : 'están'} en la
              orden: se {nombresDescartados.length === 1 ? 'quitó' : 'quitaron'}.
            </li>
          )}
          {recibidoCambio > 0 && (
            <li>
              {recibidoCambio} renglón{recibidoCambio === 1 ? '' : 'es'} ya{' '}
              {recibidoCambio === 1 ? 'fue recibido' : 'fueron recibidos'} en otra
              entrega. Revisá las cantidades antes de confirmar.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
