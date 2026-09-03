'use client'

import { useMemo, useState } from 'react'
import { ChefHat, ChevronDown, ChevronUp, Plus, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { InputNumero } from './InputNumero'
import { TablaDisponibilidad } from './TablaDisponibilidad'
import {
  useDisponibilidadInsumos,
  useProduccionRapida,
  useRecetas,
} from '@/lib/hooks/useProduccion'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { formatearNumero } from '@/lib/utils/formato'

/** Atajos de tanda: la unidad, la media docena, la docena y las dos docenas. */
const ATAJOS = [1, 6, 12, 24]

interface Props {
  /** Se llama con la orden recién elaborada, para ofrecer las etiquetas. */
  onElaborado: (ordenId: number) => void
  /** Abre el asistente del circuito completo (borrador → iniciar → cerrar). */
  onNuevaOrden: () => void
}

/**
 * Elaboración de un paso, la acción por defecto del día a día: se elige receta
 * y cantidad y en un click se descuentan los insumos, se ingresa lo producido
 * con su lote y se ofrecen las etiquetas.
 *
 * El circuito completo (con control de consumo real) sigue disponible acá al
 * lado, para las producciones grandes.
 */
export function PanelElaborarAhora({ onElaborado, onNuevaOrden }: Props) {
  const { data: usuario } = useUsuario()
  const { data: recetas, isLoading } = useRecetas()
  const elaborar = useProduccionRapida()

  const [recetaId, setRecetaId] = useState<number | undefined>()
  const [cantidad, setCantidad] = useState(1)
  const [verInsumos, setVerInsumos] = useState(false)
  const [confirmarFaltante, setConfirmarFaltante] = useState(false)

  const receta = recetas?.find((r) => r.id === recetaId)
  const { data: disponibilidad } = useDisponibilidadInsumos(recetaId, cantidad)

  const faltantes = useMemo(
    () => (disponibilidad ?? []).filter((d) => !d.alcanza),
    [disponibilidad]
  )

  const puedeElaborar = !!receta && cantidad > 0 && !!usuario && !elaborar.isPending

  function ejecutar() {
    if (!receta || !usuario) return
    elaborar.mutate(
      {
        producto_id: receta.producto_id,
        receta_id: receta.id,
        cantidad,
        usuario_id: usuario.id,
      },
      {
        onSuccess: (res) => {
          setConfirmarFaltante(false)
          onElaborado(res.orden_id)
        },
      }
    )
  }

  function intentar() {
    if (!puedeElaborar) return
    // El servidor no bloquea por falta de stock (queda negativo a propósito),
    // así que el aviso lo damos acá antes de mover nada.
    if (faltantes.length > 0) {
      setConfirmarFaltante(true)
      return
    }
    ejecutar()
  }

  return (
    <div className="rounded-2xl border border-[#f9b44c]/50 bg-[#f9b44c]/10 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f9b44c]/30">
            <Zap className="h-4 w-4 text-[#b07d1e]" />
          </span>
          <div>
            <h2 className="text-[#391511] font-bold leading-tight">
              Elaborar ahora
            </h2>
            <p className="text-xs text-[#6f3a2a]">
              Descuenta insumos, ingresa lo producido con su lote e imprime las
              etiquetas.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={onNuevaOrden}
          className="border-[#e4c9b0] bg-white text-[#6f3a2a] gap-1.5 shrink-0"
        >
          <Plus className="h-4 w-4" />
          Orden planificada
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[240px]">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Qué se elabora
          </Label>
          <select
            value={recetaId ?? ''}
            onChange={(e) => setRecetaId(Number(e.target.value) || undefined)}
            disabled={isLoading}
            className="w-full h-10 rounded-lg border border-[#e4c9b0] bg-white px-3 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
          >
            <option value="">
              {isLoading ? 'Cargando recetas…' : 'Elegí una receta…'}
            </option>
            {(recetas ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.producto?.nombre ?? 'Producto'} · rinde {r.rendimiento}{' '}
                {r.unidad_rendimiento}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Cantidad {receta ? `(${receta.unidad_rendimiento})` : ''}
          </Label>
          <div className="flex items-center gap-1.5">
            <InputNumero
              min={0}
              step="0.001"
              value={cantidad}
              onChange={setCantidad}
              className="w-24 h-10 text-center font-bold bg-white"
            />
            {ATAJOS.map((n) => (
              <Button
                key={n}
                type="button"
                variant="outline"
                onClick={() => setCantidad(n)}
                className="border-[#e4c9b0] bg-white text-[#6f3a2a] h-10 px-2.5"
              >
                ×{n}
              </Button>
            ))}
          </div>
        </div>

        <Button
          onClick={intentar}
          disabled={!puedeElaborar}
          className="h-10 bg-[#391511] hover:bg-[#4a1d16] text-white font-semibold gap-1.5 disabled:opacity-50"
        >
          <ChefHat className="h-4 w-4" />
          {elaborar.isPending ? 'Elaborando…' : 'Elaborar ahora'}
        </Button>
      </div>

      {recetaId && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setVerInsumos((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#6f3a2a] hover:text-[#391511]"
          >
            {verInsumos ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {faltantes.length > 0
              ? `Faltan ${faltantes.length} insumo${faltantes.length > 1 ? 's' : ''}`
              : 'Los insumos alcanzan'}
          </button>
          {verInsumos && (
            <div className="mt-2 bg-white rounded-xl overflow-hidden">
              <TablaDisponibilidad recetaId={recetaId} cantidad={cantidad} />
            </div>
          )}
        </div>
      )}

      <ConfirmacionAccion
        abierto={confirmarFaltante}
        onCambioAbierto={setConfirmarFaltante}
        titulo="No alcanzan los insumos"
        descripcion="Se puede elaborar igual, pero el stock de esos insumos va a quedar en negativo hasta que los cargues."
        textoConfirmar="Elaborar igual"
        destructiva
        procesando={elaborar.isPending}
        onConfirmar={ejecutar}
      >
        <ul className="space-y-1 text-sm">
          {faltantes.map((f) => (
            <li key={f.insumo_id} className="flex justify-between gap-3">
              <span className="text-[#391511]">{f.nombre}</span>
              <span className="tabular-nums text-[#c43e2c]">
                faltan {formatearNumero(f.necesario - f.stock_actual)}{' '}
                {f.unidad_stock}
              </span>
            </li>
          ))}
        </ul>
      </ConfirmacionAccion>
    </div>
  )
}
