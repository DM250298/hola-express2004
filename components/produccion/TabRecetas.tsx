'use client'

import { useCallback, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { ListaRecetas } from './ListaRecetas'
import { PanelReceta } from './PanelReceta'

/** Qué está abierto en el panel derecho. */
type Seleccion =
  | { tipo: 'nada' }
  | { tipo: 'nueva' }
  | { tipo: 'receta'; productoId: number }

export function TabRecetas() {
  const [seleccion, setSeleccion] = useState<Seleccion>({ tipo: 'nada' })
  const [sucio, setSucio] = useState(false)
  /** Selección que espera confirmación por haber cambios sin guardar. */
  const [pendiente, setPendiente] = useState<Seleccion | null>(null)

  // El panel avisa cuándo tiene cambios; se memoiza para no reprogramar su
  // effect en cada render del tab.
  const handleSucio = useCallback((v: boolean) => setSucio(v), [])

  function pedirSeleccion(productoId: number | undefined) {
    const destino: Seleccion =
      productoId == null ? { tipo: 'nueva' } : { tipo: 'receta', productoId }
    // A diferencia del diálogo de antes, acá se puede cambiar de receta con
    // cambios a medio hacer: hay que preguntar antes de perderlos.
    if (sucio) {
      setPendiente(destino)
      return
    }
    aplicar(destino)
  }

  function aplicar(destino: Seleccion) {
    setSucio(false)
    setSeleccion(destino)
  }

  function descartarYSeguir() {
    if (!pendiente) return
    aplicar(pendiente)
    setPendiente(null)
  }

  const claveInstancia =
    seleccion.tipo === 'receta' ? seleccion.productoId : 'nueva'

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6f3a2a]">
        Recetas activas. El costo se calcula en cascada (incluye las
        preparaciones intermedias) y de acá salen los datos que se imprimen en
        la etiqueta de cada tanda.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
        <div className="lg:sticky lg:top-4">
          <ListaRecetas
            seleccionadoId={
              seleccion.tipo === 'receta' ? seleccion.productoId : undefined
            }
            nuevaActiva={seleccion.tipo === 'nueva'}
            onSeleccionar={pedirSeleccion}
          />
        </div>

        {seleccion.tipo === 'nada' ? (
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <BookOpen className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">Elegí una receta</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Tocá una de la lista para ver sus ingredientes, su costo y la
              etiqueta que va a imprimir, o creá una nueva.
            </p>
          </div>
        ) : (
          <PanelReceta
            key={claveInstancia}
            productoIdInicial={
              seleccion.tipo === 'receta' ? seleccion.productoId : undefined
            }
            onGuardada={(productoId) =>
              aplicar({ tipo: 'receta', productoId })
            }
            onCancelar={() => aplicar({ tipo: 'nada' })}
            onSucioChange={handleSucio}
          />
        )}
      </div>

      <ConfirmacionAccion
        abierto={!!pendiente}
        onCambioAbierto={(v) => !v && setPendiente(null)}
        titulo="Tenés cambios sin guardar"
        descripcion="Si salís de esta receta ahora, lo que modificaste se pierde."
        textoConfirmar="Descartar cambios"
        textoCancelar="Seguir editando"
        destructiva
        onConfirmar={descartarYSeguir}
      />
    </div>
  )
}
