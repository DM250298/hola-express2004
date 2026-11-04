'use client'

import { useState } from 'react'
import { Loader2, Scale } from 'lucide-react'
import { toast } from 'sonner'
import { EscanerCamara } from './EscanerCamara'
import {
  FormularioPluBalanza,
  esPesableParaPlu,
  type ProductoParaPlu,
} from '@/components/productos/FormularioPluBalanza'
import { resolverEscaneoPlu } from '@/lib/queries/productos'

interface Cargado {
  id: number
  nombre: string
  plu: number
}

/**
 * "PLU de balanza" en el celular (mig 327): la cámara lee la etiqueta de la
 * balanza (trae el PLU) y el envase (elige el producto); abajo el mismo
 * formulario que usa el POS. Pensado para cargar varios seguidos: al guardar
 * se limpia y el producto queda en "Cargados recién".
 */
export function AsignarPluMovil() {
  const [producto, setProducto] = useState<ProductoParaPlu | null>(null)
  const [plu, setPlu] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [cargados, setCargados] = useState<Cargado[]>([])

  async function alEscanear(codigo: string) {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await resolverEscaneoPlu(codigo)
      if (r.tipo === 'producto') {
        if (!esPesableParaPlu(r.producto)) {
          toast.error(
            `"${r.producto.nombre}" no se vende por kg: no va en la balanza.`
          )
          return
        }
        setProducto(r.producto)
        if (!plu.trim() && r.producto.plu_balanza != null) {
          setPlu(String(r.producto.plu_balanza))
        }
        toast.success(`Leí "${r.producto.nombre}"`)
      } else if (r.tipo === 'etiqueta') {
        setPlu(String(r.etiqueta.plu))
        if (r.producto) {
          setProducto(r.producto)
          toast.info(
            `El PLU ${r.etiqueta.plu} ya es de "${r.producto.nombre}". Guardá para confirmarlo o cambiá el producto.`
          )
        } else {
          toast.info(
            `PLU ${r.etiqueta.plu}: ahora escaneá el envase o buscá el producto por nombre.`
          )
        }
      } else {
        toast.error(`No encontré un producto con el código ${codigo}`)
      }
    } catch {
      toast.error('No pude leer el código. Probá de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  function alGuardar(p: ProductoParaPlu, n: number) {
    setCargados((prev) => [
      { id: p.id, nombre: p.nombre, plu: n },
      ...prev.filter((c) => c.id !== p.id),
    ])
    setProducto(null)
    setPlu('')
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6f3a2a]">
        Escaneá la etiqueta de la balanza (trae el PLU) y después el envase, o
        buscá el producto por nombre y tipeá el número.
      </p>

      <EscanerCamara
        onDetectado={alEscanear}
        ayuda="Escaneá la etiqueta de la balanza o el código del producto"
      />

      {ocupado && (
        <p className="flex items-center justify-center gap-2 text-sm text-[#6f3a2a]">
          <Loader2 className="h-4 w-4 animate-spin" /> Buscando…
        </p>
      )}

      <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
        <FormularioPluBalanza
          producto={producto}
          onCambiarProducto={setProducto}
          plu={plu}
          onCambiarPlu={setPlu}
          onGuardado={alGuardar}
        />
      </div>

      {cargados.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
            Cargados recién ({cargados.length})
          </p>
          <ul className="divide-y divide-[#e4c9b0]/40 rounded-2xl border border-[#e4c9b0]/70 bg-white">
            {cargados.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Scale className="h-4 w-4 shrink-0 text-[#9e6b15]" />
                  <span className="truncate text-sm font-medium text-[#391511]">
                    {c.nombre}
                  </span>
                </span>
                <span className="shrink-0 rounded-lg bg-[#f9d2a2]/60 px-2 py-1 font-mono text-sm font-bold text-[#391511]">
                  PLU {c.plu}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
