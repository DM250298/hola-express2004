'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ClipboardList, Loader2, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useAprobarConteo,
  useConteoDetalle,
  useConteos,
  useGuardarConteoEmpleado,
} from '@/lib/hooks/useConteos'
import { EscanerCamara } from './EscanerCamara'

interface Props {
  usuarioId: string | null
}

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente de contar',
  contado: 'Contado · falta aprobar',
  aprobado: 'Aprobado',
}

/**
 * Conteo formal en el teléfono: lista los conteos abiertos (pendientes o
 * contados), permite contar producto por producto (escaneando para ubicar el
 * ítem) y enviar para aprobación; si la encargada tiene permiso, también aprueba
 * — lo que ajusta el stock vía `fn_aprobar_conteo`.
 */
export function ConteoFormalMovil({ usuarioId }: Props) {
  const [seleccion, setSeleccion] = useState<number | null>(null)
  const { data: conteos, isLoading } = useConteos()

  const abiertos = useMemo(
    () => (conteos ?? []).filter((c) => c.estado !== 'aprobado'),
    [conteos]
  )

  if (seleccion !== null) {
    return (
      <DetalleConteo
        conteoId={seleccion}
        usuarioId={usuarioId}
        onVolver={() => setSeleccion(null)}
      />
    )
  }

  return (
    <div className="space-y-3">
      {isLoading ? (
        <ListaSkeleton />
      ) : abiertos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#e4c9b0] bg-white/60 p-6 text-center text-sm text-[#6f3a2a]">
          No hay conteos abiertos. Los conteos se crean desde Inventario →
          Control de stock.
        </p>
      ) : (
        <ul className="space-y-2">
          {abiertos.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => setSeleccion(c.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 text-left shadow-sm transition active:scale-[0.99]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f9b44c]/20 text-[#9e6b15]">
                  <ClipboardList className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-[#391511]">
                    {c.nombre}
                  </span>
                  <span className="block text-xs text-[#6f3a2a]">
                    {c.total_items} producto{c.total_items === 1 ? '' : 's'} ·{' '}
                    {ETIQUETA_ESTADO[c.estado] ?? c.estado}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface DetalleProps {
  conteoId: number
  usuarioId: string | null
  onVolver: () => void
}

function DetalleConteo({ conteoId, usuarioId, onVolver }: DetalleProps) {
  const { data, isLoading } = useConteoDetalle(conteoId)
  const guardar = useGuardarConteoEmpleado()
  const aprobar = useAprobarConteo()

  // itemId -> cantidad contada (string controlado)
  const [valores, setValores] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!data) return
    const inicial: Record<number, string> = {}
    for (const it of data.items) {
      inicial[it.id] =
        it.cantidad_contada != null ? String(it.cantidad_contada) : ''
    }
    setValores(inicial)
  }, [data])

  function alEscanear(codigo: string) {
    if (!data) return
    const item = data.items.find((it) => it.producto_codigo === codigo)
    if (!item) {
      toast.error('Ese código no pertenece a este conteo.')
      return
    }
    setValores((prev) => {
      const actual = Number(prev[item.id]) || 0
      return { ...prev, [item.id]: String(actual + 1) }
    })
    toast.success(`${item.producto_nombre} · ${(Number(valores[item.id]) || 0) + 1}`)
  }

  function enviar() {
    if (!data) return
    const conteos = data.items.map((it) => ({
      itemId: it.id,
      cantidad: Math.max(0, Number(valores[it.id]) || 0),
    }))
    guardar.mutate({ conteoId, conteos })
  }

  function aprobarConteo() {
    if (!usuarioId) {
      toast.error('No se pudo identificar tu usuario.')
      return
    }
    aprobar.mutate({ conteoId, aprobadorId: usuarioId })
  }

  const estado = data?.conteo.estado

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onVolver}
        className="flex items-center gap-1 text-sm font-medium text-[#6f3a2a]"
      >
        <ChevronLeft className="h-4 w-4" /> Volver a la lista
      </button>

      {isLoading || !data ? (
        <ListaSkeleton />
      ) : (
        <>
          <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-3 shadow-sm">
            <p className="font-bold text-[#391511]">{data.conteo.nombre}</p>
            <p className="text-xs text-[#6f3a2a]">
              {ETIQUETA_ESTADO[data.conteo.estado] ?? data.conteo.estado}
            </p>
          </div>

          <EscanerCamara
            onDetectado={alEscanear}
            ayuda="Escaneá para sumar 1 al producto del conteo"
          />

          <ul className="space-y-2">
            {data.items.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-3 rounded-2xl border border-[#e4c9b0]/70 bg-white p-3 shadow-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-[#391511]">
                    {it.producto_nombre}
                  </p>
                  <p className="text-xs text-[#6f3a2a]">
                    Sistema:{' '}
                    <span className="tabular-nums">{it.stock_sistema}</span>
                  </p>
                </div>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={valores[it.id] ?? ''}
                  onChange={(e) =>
                    setValores((prev) => ({ ...prev, [it.id]: e.target.value }))
                  }
                  placeholder="0"
                  className="h-12 w-24 shrink-0 border-[#e4c9b0] text-center text-lg tabular-nums focus-visible:ring-[#f9b44c]"
                />
              </li>
            ))}
          </ul>

          <div className="sticky bottom-4 z-10 space-y-2">
            {estado !== 'aprobado' && (
              <Button
                type="button"
                onClick={enviar}
                disabled={guardar.isPending}
                variant="outline"
                className="h-12 w-full rounded-2xl border-[#e4c9b0] bg-white font-semibold text-[#391511]"
              >
                {guardar.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar conteo'
                )}
              </Button>
            )}
            <Button
              type="button"
              onClick={aprobarConteo}
              disabled={aprobar.isPending}
              className="h-14 w-full rounded-2xl bg-[#f9b44c] text-base font-bold text-[#391511] shadow-lg hover:bg-[#e4a42a]"
            >
              {aprobar.isPending ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Aprobando…
                </>
              ) : (
                <>
                  <ShieldCheck className="mr-2 h-5 w-5" />
                  Aprobar y ajustar stock
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function ListaSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-2xl border border-[#e4c9b0]/50 bg-white/60"
        />
      ))}
    </div>
  )
}
