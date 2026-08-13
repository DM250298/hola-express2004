'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, EyeOff, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useEliminarProducto,
  useProductoEliminable,
  useToggleProductoActivo,
} from '@/lib/hooks/useProductos'
import { PRODUCTO_CON_HISTORIAL } from '@/lib/queries/productos'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  producto: { id: number; nombre: string; activo: boolean } | null
}

/**
 * Diálogo de borrado inteligente: si el producto no tiene historial ofrece
 * eliminarlo en forma definitiva; si tiene ventas o movimientos vinculados
 * (no se puede borrar) ofrece desactivarlo, conservando la trazabilidad.
 */
export function ModalEliminarProducto({
  abierto,
  onCambioAbierto,
  producto,
}: Props) {
  const router = useRouter()
  const eliminar = useEliminarProducto()
  const toggle = useToggleProductoActivo()
  // Carrera: si entre el chequeo y el borrado le cargan historial, el RPC lo
  // rechaza y forzamos la vista de "no eliminable" sin volver a preguntar.
  const [forzarNoEliminable, setForzarNoEliminable] = useState(false)

  const habilitado = abierto && producto != null
  const {
    data: eliminableData,
    isLoading: verificando,
    isError,
  } = useProductoEliminable(producto?.id ?? 0, habilitado)

  const ocupado = eliminar.isPending || toggle.isPending
  const esEliminable = eliminableData === true && !forzarNoEliminable

  function cerrar(v: boolean) {
    if (ocupado) return
    if (!v) setForzarNoEliminable(false)
    onCambioAbierto(v)
  }

  async function onEliminar() {
    if (!producto) return
    try {
      await eliminar.mutateAsync(producto.id)
      toast.success('Producto eliminado')
      onCambioAbierto(false)
      router.push('/inventario')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes(PRODUCTO_CON_HISTORIAL)) {
        setForzarNoEliminable(true)
      } else {
        toast.error(`No se pudo eliminar: ${msg}`)
      }
    }
  }

  function onDesactivar() {
    if (!producto) return
    toggle.mutate(
      { id: producto.id, activo: false },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  if (!producto) return null

  return (
    <Dialog open={abierto} onOpenChange={cerrar}>
      <DialogContent className="sm:max-w-md">
        {verificando ? (
          <div className="flex items-center gap-3 py-8 text-[#6f3a2a] text-sm">
            <Loader2 className="h-5 w-5 animate-spin shrink-0" />
            Verificando si el producto se puede eliminar…
          </div>
        ) : isError ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[#391511] text-lg">
                No se pudo verificar
              </DialogTitle>
              <DialogDescription className="text-[#6f3a2a]">
                Hubo un problema al comprobar si el producto se puede eliminar.
                Volvé a intentarlo en un momento.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => cerrar(false)}
                className="border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cerrar
              </Button>
            </DialogFooter>
          </>
        ) : esEliminable ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#c43e2c]/12 text-[#c43e2c] shrink-0">
                  <Trash2 className="h-4 w-4" />
                </span>
                ¿Eliminar producto?
              </DialogTitle>
              <DialogDescription className="text-[#6f3a2a]">
                Se va a eliminar{' '}
                <span className="font-semibold text-[#391511]">
                  {producto.nombre}
                </span>{' '}
                de forma permanente. Esta acción no se puede deshacer.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => cerrar(false)}
                disabled={ocupado}
                className="border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cancelar
              </Button>
              <Button
                onClick={onEliminar}
                disabled={ocupado}
                className="bg-[#c43e2c] hover:bg-[#9e2f25] text-white font-semibold"
              >
                {eliminar.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Eliminando…
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Eliminar definitivamente
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#e4a42a]/20 text-[#9e2f25] shrink-0">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                No se puede eliminar
              </DialogTitle>
              <DialogDescription className="text-[#6f3a2a]">
                <span className="font-semibold text-[#391511]">
                  {producto.nombre}
                </span>{' '}
                tiene ventas o movimientos vinculados, así que no se puede borrar
                sin perder ese historial.
                {producto.activo
                  ? ' Podés desactivarlo: deja de aparecer en el POS y en las listas operativas, pero se conserva todo el historial. Lo encontrás cuando quieras en Configuración › Productos con el filtro Estado → Solo inactivos, desde donde podés reactivarlo o editarlo.'
                  : ' El producto ya está desactivado: no aparece en el POS. Lo encontrás en Configuración › Productos con el filtro Estado → Solo inactivos, desde donde podés reactivarlo o editarlo.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => cerrar(false)}
                disabled={ocupado}
                className="border-[#e4c9b0] text-[#6f3a2a]"
              >
                {producto.activo ? 'Cancelar' : 'Cerrar'}
              </Button>
              {producto.activo && (
                <Button
                  onClick={onDesactivar}
                  disabled={ocupado}
                  className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
                >
                  {toggle.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Desactivando…
                    </>
                  ) : (
                    <>
                      <EyeOff className="mr-2 h-4 w-4" />
                      Desactivar producto
                    </>
                  )}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
