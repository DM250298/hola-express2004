'use client'

import { useEffect, useState } from 'react'
import { MapPin, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { redondearCantidad } from '@/lib/utils/formato'
import { rutaUbicacion, type ArbolUbicaciones } from '@/lib/queries/ubicaciones'
import {
  useAsignarUbicacionPrincipal,
  useBorrarConteoParcial,
  useQuitarProductoDeUbicacion,
} from '@/lib/hooks/useMapa'
import { useUpdateProducto } from '@/lib/hooks/useProductos'

export interface UbicacionDelProducto {
  ubicacion_id: number
  es_principal: boolean
}

interface Props {
  abierto: boolean
  producto: {
    id: number
    nombre: string
    venta_por_peso: boolean
    stock_minimo: number
    stock_maximo: number | null
  } | null
  ubicaciones: UbicacionDelProducto[]
  /** Dónde está parado el empleado ahora. */
  ubicacionActual: number | null
  arbol: ArbolUbicaciones
  onCerrar: () => void
  /** Se llama después de cambiar principal o quitar, para refrescar la lista. */
  onCambio: (ubicaciones: UbicacionDelProducto[]) => void
  /** Se llama tras guardar mín/máx, con los valores nuevos. */
  onMinMax: (minimo: number, maximo: number | null) => void
}

/**
 * Corregir la ubicación de un producto sin salir del escaneo.
 *
 * La asignación automática (primera ubicación = principal, el resto
 * secundarias) acierta casi siempre, pero cuando erra había que ir a una
 * computadora. Acá se arregla con dos toques: fijar la principal correcta o
 * sacar el producto de un estante donde ya no va.
 *
 * El mín/máx vive acá y no en una pantalla aparte porque el momento en que
 * alguien sabe cuánto tiene que haber de algo es justo cuando lo está mirando
 * en la góndola.
 */
export function HojaUbicacionProducto({
  abierto,
  producto,
  ubicaciones,
  ubicacionActual,
  arbol,
  onCerrar,
  onCambio,
  onMinMax,
}: Props) {
  const fijarPrincipal = useAsignarUbicacionPrincipal()
  const quitar = useQuitarProductoDeUbicacion()
  const borrarParcial = useBorrarConteoParcial()
  const actualizar = useUpdateProducto()
  const [minimo, setMinimo] = useState('')
  const [maximo, setMaximo] = useState('')

  // Al abrir con otro producto hay que recargar los campos; el guard evita
  // pisar lo que el usuario está tipeando mientras la hoja sigue abierta.
  useEffect(() => {
    if (!abierto || !producto) return
    setMinimo(String(producto.stock_minimo ?? 0))
    setMaximo(producto.stock_maximo == null ? '' : String(producto.stock_maximo))
  }, [abierto, producto?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!producto) return null

  const ocupado =
    fijarPrincipal.isPending || quitar.isPending || actualizar.isPending

  function nombreDe(id: number): string {
    return rutaUbicacion(id, arbol.planas) || `Ubicación #${id}`
  }

  async function alFijarPrincipal(ubicacionId: number) {
    if (!producto) return
    await fijarPrincipal.mutateAsync({ productoId: producto.id, ubicacionId })
    onCambio(
      ubicaciones.map((u) => ({ ...u, es_principal: u.ubicacion_id === ubicacionId }))
    )
  }

  async function alQuitar(ubicacionId: number) {
    if (!producto) return
    if (
      !window.confirm(
        `¿Sacar ${producto.nombre} de ${nombreDe(ubicacionId)}? No toca el stock.`
      )
    ) {
      return
    }
    await quitar.mutateAsync({ productoId: producto.id, ubicacionId })
    // El conteo a medias de ese lugar ya no espera a nadie.
    borrarParcial.mutate({ productoId: producto.id, ubicacionId })
    onCambio(ubicaciones.filter((u) => u.ubicacion_id !== ubicacionId))
  }

  async function guardarMinMax() {
    if (!producto) return
    const porPeso = producto.venta_por_peso
    const min = minimo.trim() === '' ? 0 : Number(minimo)
    const max = maximo.trim() === '' ? null : Number(maximo)
    // Por kg van hasta 3 decimales; por unidad, enteros (mismo criterio que la
    // ficha del producto).
    const invalido = (n: number) =>
      Number.isNaN(n) || n < 0 || (!porPeso && !Number.isInteger(n))
    if (invalido(min)) {
      toast.error(porPeso ? 'Mínimo inválido.' : 'El mínimo tiene que ser entero.')
      return
    }
    if (max != null && invalido(max)) {
      toast.error(porPeso ? 'Máximo inválido.' : 'El máximo tiene que ser entero.')
      return
    }
    if (max != null && max < min) {
      toast.error('El máximo no puede ser menor que el mínimo.')
      return
    }
    if (min === producto.stock_minimo && max === producto.stock_maximo) {
      onCerrar()
      return
    }
    await actualizar.mutateAsync({
      id: producto.id,
      datos: {
        stock_minimo: redondearCantidad(min, porPeso),
        stock_maximo: max == null ? null : redondearCantidad(max, porPeso),
      },
    })
    onMinMax(min, max)
    onCerrar()
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(v, detalles) => {
        // Igual que en recepción: el click afuera no cierra, se usa con una
        // mano ocupada.
        if (!v && detalles.reason === 'outside-press') {
          detalles.cancel()
          return
        }
        if (!v) onCerrar()
      }}
    >
      <SheetContent
        side="bottom"
        className="max-h-[92vh] gap-0 overflow-y-auto rounded-t-2xl border-[#e4c9b0] bg-[#fdfaf6] pb-4"
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="pr-8 text-left text-base leading-tight text-[#391511]">
            {producto.nombre}
          </SheetTitle>
          <SheetDescription className="text-xs text-[#6f3a2a]">
            Dónde vive este producto y cuánto tiene que haber.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
              Ubicaciones
            </p>
            {ubicaciones.length === 0 ? (
              <p className="text-sm text-[#6f3a2a]">
                Todavía no está en ningún lado.
              </p>
            ) : (
              <ul className="space-y-2">
                {ubicaciones.map((u) => (
                  <li
                    key={u.ubicacion_id}
                    className={cn(
                      'rounded-xl border px-3 py-2.5',
                      u.ubicacion_id === ubicacionActual
                        ? 'border-[#f9b44c] bg-[#f9b44c]/10'
                        : 'border-[#e4c9b0]/60 bg-white'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#c8a58a]" />
                      <span className="min-w-0 flex-1 text-sm text-[#391511]">
                        {nombreDe(u.ubicacion_id)}
                        {u.ubicacion_id === ubicacionActual && (
                          <span className="ml-1 text-xs text-[#9e6b15]">
                            (estás acá)
                          </span>
                        )}
                      </span>
                      {u.es_principal && (
                        <span className="shrink-0 rounded-md bg-[#f9b44c]/25 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#9e6b15]">
                          principal
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex gap-2">
                      {!u.es_principal && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={ocupado}
                          onClick={() => void alFijarPrincipal(u.ubicacion_id)}
                          className="h-10 flex-1 border-[#e4c9b0] text-xs text-[#391511]"
                        >
                          <Star className="mr-1.5 h-4 w-4" />
                          Fijar como principal
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        disabled={ocupado}
                        onClick={() => void alQuitar(u.ubicacion_id)}
                        className="h-10 border-[#e4c9b0] text-xs text-[#9e2f25]"
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Quitar
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {ubicaciones.length > 1 && (
              <p className="mt-2 text-xs text-[#6f3a2a]">
                Está en {ubicaciones.length} lugares: el conteo se suma entre
                todos antes de tocar el stock.
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
              Cuánto tiene que haber en todo el local
              {producto.venta_por_peso ? ' (kg)' : ''}
            </p>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="hoja-min" className="text-xs text-[#6f3a2a]">
                  Mínimo
                </Label>
                <Input
                  id="hoja-min"
                  type="number"
                  min="0"
                  step={producto.venta_por_peso ? '0.001' : '1'}
                  inputMode={producto.venta_por_peso ? 'decimal' : 'numeric'}
                  value={minimo}
                  onChange={(e) => setMinimo(e.target.value)}
                  className="h-11 border-[#e4c9b0] text-center tabular-nums"
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="hoja-max" className="text-xs text-[#6f3a2a]">
                  Máximo
                </Label>
                <Input
                  id="hoja-max"
                  type="number"
                  min="0"
                  step={producto.venta_por_peso ? '0.001' : '1'}
                  inputMode={producto.venta_por_peso ? 'decimal' : 'numeric'}
                  value={maximo}
                  onChange={(e) => setMaximo(e.target.value)}
                  placeholder="sin tope"
                  className="h-11 border-[#e4c9b0] text-center tabular-nums"
                />
              </div>
            </div>
            <p className="mt-1.5 text-xs text-[#c8a58a]">
              El máximo es opcional: en blanco significa sin tope.
            </p>
          </div>

          <Button
            type="button"
            disabled={ocupado}
            onClick={() => void guardarMinMax()}
            className="h-12 w-full rounded-xl bg-[#f9b44c] text-base font-bold text-[#391511] hover:bg-[#e4a42a]"
          >
            Listo
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
