'use client'

import { useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { CardLote } from '@/components/vencimientos/CardLote'
import { ModalBajaLote } from '@/components/vencimientos/ModalBajaLote'
import { useLotesActivos } from '@/lib/hooks/useVencimientos'
import type { LoteConProducto } from '@/lib/queries/vencimientos'
import { cn } from '@/lib/utils'

/**
 * Versión móvil del control de vencimientos: una sola columna, priorizando los
 * lotes que necesitan acción (vencidos → próximos → atención) y dejando los
 * que están al día detrás de un toggle. Reusa las piezas de escritorio
 * (CardLote y ModalBajaLote), así la lógica de baja/merma es la misma.
 */
export function VencimientosMovil() {
  const { data: lotes, isLoading, isError } = useLotesActivos()
  const [busqueda, setBusqueda] = useState('')
  const [loteBaja, setLoteBaja] = useState<LoteConProducto | null>(null)
  const [verOk, setVerOk] = useState(false)

  const grupos = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const vencidos: LoteConProducto[] = []
    const proximos: LoteConProducto[] = []
    const atencion: LoteConProducto[] = []
    const ok: LoteConProducto[] = []
    for (const l of lotes ?? []) {
      if (q) {
        const nombre = l.producto.nombre.toLowerCase()
        const cod = (l.producto.codigo_barras ?? '').toLowerCase()
        if (!nombre.includes(q) && !cod.includes(q)) continue
      }
      if (l.clase === 'vencido') vencidos.push(l)
      else if (l.clase === 'rojo') proximos.push(l)
      else if (l.clase === 'amarillo') atencion.push(l)
      else ok.push(l)
    }
    return { vencidos, proximos, atencion, ok }
  }, [lotes, busqueda])

  const totalUrgentes =
    grupos.vencidos.length + grupos.proximos.length + grupos.atencion.length

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl bg-[#f9d2a2]/30" />
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-8 text-center text-sm text-[#c43e2c]">
        No se pudo cargar la lista de lotes. Probá de nuevo.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
        <Input
          placeholder="Buscar por nombre o código…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="h-11 border-[#e4c9b0] bg-white pl-9 focus-visible:ring-[#f9b44c]"
        />
      </div>

      {totalUrgentes === 0 && grupos.ok.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#e4c9b0]/60 bg-white p-8 text-center">
          <div className="rounded-full bg-[#2f7d4f]/12 p-3">
            <CheckCircle2 className="h-6 w-6 text-[#2f7d4f]" />
          </div>
          <p className="font-semibold text-[#391511]">
            {busqueda.trim() ? 'Nada coincide con la búsqueda' : 'Todo en orden'}
          </p>
          <p className="text-sm text-[#6f3a2a]">
            {busqueda.trim()
              ? 'Probá con otro nombre o código.'
              : 'No hay lotes próximos a vencer ni vencidos.'}
          </p>
        </div>
      ) : (
        <>
          <Seccion
            titulo="Vencidos"
            color="#c43e2c"
            lotes={grupos.vencidos}
            onDarDeBaja={setLoteBaja}
          />
          <Seccion
            titulo="Próximos a vencer"
            color="#c43e2c"
            lotes={grupos.proximos}
            onDarDeBaja={setLoteBaja}
          />
          <Seccion
            titulo="Atención"
            color="#e4a42a"
            lotes={grupos.atencion}
            onDarDeBaja={setLoteBaja}
          />

          {totalUrgentes === 0 && (
            <p className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-6 text-center text-sm text-[#6f3a2a]">
              Sin urgencias: ningún lote vence en los próximos 7 días.
            </p>
          )}

          {grupos.ok.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setVerOk((v) => !v)}
                className="flex w-full items-center justify-between rounded-xl border border-[#e4c9b0]/60 bg-white px-4 py-3 text-sm font-semibold text-[#6f3a2a]"
              >
                <span>Al día ({grupos.ok.length})</span>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform',
                    verOk && 'rotate-180'
                  )}
                />
              </button>
              {verOk && (
                <div className="mt-2 space-y-2">
                  {grupos.ok.map((l) => (
                    <CardLote key={l.id} lote={l} onDarDeBaja={setLoteBaja} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ModalBajaLote
        abierto={loteBaja !== null}
        onCambioAbierto={(v) => !v && setLoteBaja(null)}
        lote={loteBaja}
      />
    </div>
  )
}

function Seccion({
  titulo,
  color,
  lotes,
  onDarDeBaja,
}: {
  titulo: string
  color: string
  lotes: LoteConProducto[]
  onDarDeBaja: (l: LoteConProducto) => void
}) {
  if (lotes.length === 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color }}
        />
        <h2 className="text-sm font-bold text-[#391511]">{titulo}</h2>
        <span className="text-xs font-semibold text-[#c8a58a]">
          {lotes.length}
        </span>
      </div>
      {lotes.map((l) => (
        <CardLote key={l.id} lote={l} onDarDeBaja={onDarDeBaja} />
      ))}
    </div>
  )
}
