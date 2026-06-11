'use client'

import { useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalImportarExtracto } from './ModalImportarExtracto'
import { useExtractos, useLineasExtracto } from '@/lib/hooks/useConciliacion'
import { formatearFechaHora, formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

export function TabConciliacionBancaria() {
  const { data: extractos, isLoading } = useExtractos()
  const [modalAbierto, setModalAbierto] = useState(false)
  const [expandido, setExpandido] = useState<number | null>(null)

  return (
    <div className="space-y-5">
      {/* Encabezado + acción */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-[#391511] font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-[#f9b44c]" />
            Conciliar Mercado Pago
          </h3>
          <p className="text-[#6f3a2a] text-sm mt-1 max-w-xl">
            Importá el reporte de Mercado Pago y el sistema acredita las ventas
            liberadas, concilia los movimientos y marca en rojo lo que no cuadra.
          </p>
          <p className="text-[#9b6b53] text-xs mt-1">
            ¿Buscás cruzar el extracto del banco? Andá a Contabilidad → Conciliar
            banco.
          </p>
        </div>
        <Button
          onClick={() => setModalAbierto(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Upload className="h-4 w-4" />
          Importar extracto
        </Button>
      </div>

      {/* Historial de importaciones */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <h3 className="text-[#391511] font-semibold text-sm">
            Importaciones recientes
          </h3>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-[#6f3a2a] text-sm">
            Cargando…
          </div>
        ) : !extractos || extractos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <FileSpreadsheet className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Todavía no importaste ningún extracto
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Tocá “Importar extracto” y subí el CSV de Mercado Pago.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/40">
            {extractos.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() =>
                    setExpandido((prev) => (prev === e.id ? null : e.id))
                  }
                  className="w-full px-5 py-3 flex items-center gap-3 hover:bg-[#fdfaf6] text-left"
                >
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 text-[#c8a58a] transition-transform shrink-0',
                      expandido === e.id && 'rotate-90'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[#391511] truncate">
                      {e.nombre_archivo ?? 'Extracto'}
                    </div>
                    <div className="text-xs text-[#6f3a2a]">
                      {formatearFechaHora(e.created_at)} · {e.lineas_total}{' '}
                      líneas
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#2f7d4f]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {e.lineas_conciliadas}
                    </span>
                    {e.lineas_anomalia > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#c43e2c]">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {e.lineas_anomalia}
                      </span>
                    )}
                  </div>
                </button>
                {expandido === e.id && <DetalleExtracto extractoId={e.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ModalImportarExtracto
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
      />
    </div>
  )
}

function DetalleExtracto({ extractoId }: { extractoId: number }) {
  const { data: lineas, isLoading } = useLineasExtracto(extractoId)

  if (isLoading) {
    return (
      <div className="px-5 py-4 text-center text-[#6f3a2a] text-sm bg-[#fdfaf6]/50">
        Cargando líneas…
      </div>
    )
  }
  if (!lineas || lineas.length === 0) return null

  return (
    <div className="bg-[#fdfaf6]/50 px-5 py-2 divide-y divide-[#e4c9b0]/30">
      {lineas.map((l) => (
        <div
          key={l.id}
          className={cn(
            'py-1.5 flex items-center gap-3 text-sm',
            l.estado === 'anomalia' && 'text-[#c43e2c]'
          )}
        >
          <span className="w-20 shrink-0 text-xs tabular-nums text-[#6f3a2a]">
            {l.fecha ? formatearFechaCorta(l.fecha) : '—'}
          </span>
          <span className="flex-1 truncate">
            {l.descripcion || (
              <span className="text-[#c8a58a] italic">sin descripción</span>
            )}
          </span>
          <EstadoLinea estado={l.estado} />
          <span className="w-24 text-right tabular-nums font-semibold shrink-0">
            <MontoARS monto={l.monto} />
          </span>
        </div>
      ))}
    </div>
  )
}

function EstadoLinea({ estado }: { estado: string }) {
  if (estado === 'conciliada') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-[#2f7d4f] shrink-0">
        <CheckCircle2 className="h-3 w-3" />
        ok
      </span>
    )
  }
  if (estado === 'anomalia') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-[#c43e2c] shrink-0">
        <AlertCircle className="h-3 w-3" />
        anomalía
      </span>
    )
  }
  return (
    <span className="text-[10px] uppercase tracking-wider font-semibold text-[#c8a58a] shrink-0">
      ignorada
    </span>
  )
}
