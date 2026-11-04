'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useAsignarPluBalanza,
  useBuscarProductos,
} from '@/lib/hooks/useProductos'
import { parsearCodigoBalanza, validarPluTexto } from '@/lib/pos/codigoBalanza'
import { buscarProductoEscaneado } from '@/lib/queries/productos'
import type { ProductoConRelaciones } from '@/lib/queries/productos'

interface Props {
  /** Producto elegido; null = se elige acá buscando por nombre (o código). */
  producto: ProductoConRelaciones | null
  onCambiarProducto: (p: ProductoConRelaciones | null) => void
  /** Texto del campo PLU. Controlado: el celular lo rellena con la cámara. */
  plu: string
  onCambiarPlu: (v: string) => void
  onGuardado: (producto: ProductoConRelaciones, plu: number) => void
  /** Lo pasa el modal del POS; la pantalla del celular no tiene Cancelar. */
  onCancelar?: () => void
  /** En el POS sí (el cajero tipea o escanea enseguida); en el celular no,
   *  para que no salte el teclado tapando la cámara. */
  autoFocusBusqueda?: boolean
}

/** Solo pesables simples: un combo o un producto por unidad no va en la balanza. */
export function esPesableParaPlu(p: ProductoConRelaciones): boolean {
  return p.venta_por_peso && p.tipo !== 'combo'
}

/**
 * Cargar o corregir el PLU de balanza de un pesable desde el mostrador
 * (mig 327). Lo comparten el modal del POS (`ModalPluBalanza`, sin cámara: el
 * lector USB escribe en el buscador) y la pantalla del celular
 * (`AsignarPluMovil`, que suma la cámara arriba). La escritura es directa
 * (`asignarPluBalanza`); el hook muestra los toasts de éxito y error.
 */
export function FormularioPluBalanza({
  producto,
  onCambiarProducto,
  plu,
  onCambiarPlu,
  onGuardado,
  onCancelar,
  autoFocusBusqueda = false,
}: Props) {
  const [busqueda, setBusqueda] = useState('')
  const [busquedaDebounced, setBusquedaDebounced] = useState('')
  const [pluTocado, setPluTocado] = useState(false)
  const pluRef = useRef<HTMLInputElement>(null)
  const asignar = useAsignarPluBalanza()

  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda.trim()), 250)
    return () => clearTimeout(t)
  }, [busqueda])

  // Con el producto elegido, lo que sigue es tipear el PLU.
  const productoId = producto?.id ?? null
  useEffect(() => {
    if (productoId != null) pluRef.current?.focus()
  }, [productoId])

  // Con producto elegido no se busca (cadena vacía = query apagada).
  const { data: resultados, isFetching: buscando } = useBuscarProductos(
    producto ? '' : busquedaDebounced
  )
  const candidatos = (resultados ?? []).filter(esPesableParaPlu).slice(0, 8)

  const validacion = validarPluTexto(plu)
  const errorPlu = pluTocado ? validacion.error : undefined

  function elegir(p: ProductoConRelaciones) {
    onCambiarProducto(p)
    setBusqueda('')
    setBusquedaDebounced('')
    // Para corregir: arranca con el PLU que ya tiene, salvo que ya venga uno
    // (la etiqueta que disparó el modal del POS).
    if (!plu.trim() && p.plu_balanza != null) onCambiarPlu(String(p.plu_balanza))
  }

  function alTipearBusqueda(valor: string) {
    // El lector USB de la PC escribe acá: una etiqueta de balanza trae el PLU.
    const etiqueta = parsearCodigoBalanza(valor)
    if (etiqueta) {
      onCambiarPlu(String(etiqueta.plu))
      setPluTocado(true)
      setBusqueda('')
      toast.info(`Leí el PLU ${etiqueta.plu} de la etiqueta`)
      return
    }
    setBusqueda(valor)
  }

  /** Enter en el buscador: un único candidato se elige; un código (lector) se busca directo. */
  async function alEnterBusqueda() {
    const valor = busqueda.trim()
    if (!valor) return
    if (candidatos.length === 1) {
      elegir(candidatos[0])
      return
    }
    if (!/^\d{6,14}$/.test(valor)) return
    try {
      const r = await buscarProductoEscaneado(valor)
      if (r && esPesableParaPlu(r.producto)) {
        elegir(r.producto)
        return
      }
      toast.error(
        r
          ? `"${r.producto.nombre}" no se vende por kg: no va en la balanza.`
          : `Código ${valor} no encontrado.`
      )
    } catch {
      toast.error('Error buscando por código.')
    }
  }

  async function guardar() {
    setPluTocado(true)
    if (!producto) {
      toast.error('Primero elegí el producto.')
      return
    }
    if (validacion.plu == null) {
      toast.error(validacion.error ?? 'Poné el número de PLU.')
      return
    }
    try {
      await asignar.mutateAsync({ id: producto.id, plu: validacion.plu })
      // El celular limpia el formulario para seguir con otro: que el campo
      // vacío no arranque marcado en rojo.
      setPluTocado(false)
      onGuardado(producto, validacion.plu)
    } catch {
      // el toast de error lo muestra el hook
    }
  }

  return (
    <div className="space-y-3">
      {producto ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[#2f7d4f]/30 bg-[#2f7d4f]/10 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <Check className="h-4 w-4 shrink-0 text-[#2f7d4f]" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[#391511]">
                {producto.nombre}
              </span>
              <span className="block text-[11px] text-[#6f3a2a]">
                {producto.plu_balanza != null
                  ? `Hoy tiene PLU ${producto.plu_balanza}`
                  : 'Sin PLU todavía'}
                {' · '}
                <MontoARS monto={producto.precio_venta} /> /kg
              </span>
            </span>
          </span>
          <button
            type="button"
            onClick={() => onCambiarProducto(null)}
            className="shrink-0 text-xs font-semibold text-[#9e6b15]"
          >
            Cambiar
          </button>
        </div>
      ) : (
        <div>
          <Label className="text-xs text-[#6f3a2a]">Producto por kg</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
            <Input
              autoFocus={autoFocusBusqueda}
              value={busqueda}
              onChange={(e) => alTipearBusqueda(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void alEnterBusqueda()
                }
              }}
              placeholder="Nombre del producto o código…"
              autoComplete="off"
              className="h-11 border-[#e4c9b0] pl-9 focus-visible:ring-[#f9b44c]"
            />
          </div>
          {busquedaDebounced.length >= 2 && (
            <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[#e4c9b0]/70 bg-white">
              {buscando ? (
                <div className="p-3 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-[#9e6b15]" />
                </div>
              ) : candidatos.length === 0 ? (
                <p className="p-3 text-center text-xs text-[#6f3a2a]">
                  No hay productos por kg con ese nombre. Si falta, marcá
                  &quot;Venta por kg&quot; en la ficha.
                </p>
              ) : (
                <ul className="divide-y divide-[#e4c9b0]/40">
                  {candidatos.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => elegir(p)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left active:bg-[#f9d2a2]/30"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[#391511]">
                            {p.nombre}
                          </span>
                          <span className="block text-[10px] text-[#c8a58a]">
                            <MontoARS monto={p.precio_venta} /> /kg
                            {p.codigo_barras && (
                              <>
                                {' · '}
                                <span className="font-mono">{p.codigo_barras}</span>
                              </>
                            )}
                          </span>
                        </span>
                        {p.plu_balanza != null && (
                          <span className="shrink-0 rounded bg-[#f9d2a2]/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#6f3a2a]">
                            PLU {p.plu_balanza}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="plu_balanza_mostrador" className="text-xs text-[#6f3a2a]">
          PLU en la balanza
        </Label>
        <Input
          ref={pluRef}
          id="plu_balanza_mostrador"
          type="number"
          min={1}
          max={99999}
          step={1}
          inputMode="numeric"
          value={plu}
          onChange={(e) => {
            onCambiarPlu(e.target.value)
            setPluTocado(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void guardar()
            }
          }}
          placeholder="Ej: 4"
          className="h-12 border-[#e4c9b0] font-mono text-base focus-visible:ring-[#f9b44c]"
        />
        {errorPlu ? (
          <p className="mt-1 text-xs text-[#c43e2c]">{errorPlu}</p>
        ) : (
          <p className="mt-1 text-[11px] leading-snug text-[#6f3a2a]">
            Es el número que sale en la etiqueta al lado de &quot;PLU&quot;.
          </p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        {onCancelar && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancelar}
            disabled={asignar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
        )}
        <Button
          type="button"
          onClick={guardar}
          disabled={asignar.isPending || !producto || !!validacion.error}
          className="flex-1 bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
        >
          {asignar.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando…
            </>
          ) : (
            'Guardar PLU'
          )}
        </Button>
      </div>
    </div>
  )
}
