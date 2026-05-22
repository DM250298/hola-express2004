'use client'

import { useEffect, useState } from 'react'
import { Loader2, ScanLine, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { useCrearConteo, useUsuariosActivos } from '@/lib/hooks/useConteos'
import { getProductoByBarcode } from '@/lib/queries/productos'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

const SIN_EMPLEADO = '__sin__'

interface ProductoSuelto {
  id: number
  nombre: string
}

export function ModalNuevoConteo({ abierto, onCambioAbierto }: Props) {
  const { data: usuario } = useUsuario()
  const { data: categorias } = useCategorias()
  const { data: usuarios } = useUsuariosActivos()
  const crear = useCrearConteo()

  const [nombre, setNombre] = useState('')
  const [empleado, setEmpleado] = useState<string>(SIN_EMPLEADO)
  const [catSeleccionadas, setCatSeleccionadas] = useState<number[]>([])
  const [productos, setProductos] = useState<ProductoSuelto[]>([])
  const [codigo, setCodigo] = useState('')
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    if (abierto) {
      setNombre('')
      setEmpleado(SIN_EMPLEADO)
      setCatSeleccionadas([])
      setProductos([])
      setCodigo('')
    }
  }, [abierto])

  const itemsEmpleado: Record<string, string> = {
    [SIN_EMPLEADO]: 'Elegir empleado…',
    ...Object.fromEntries((usuarios ?? []).map((u) => [u.id, u.nombre])),
  }

  function toggleCategoria(id: number) {
    setCatSeleccionadas((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    )
  }

  async function agregarProducto() {
    const cod = codigo.trim()
    if (!cod || buscando) return
    setBuscando(true)
    try {
      const prod = await getProductoByBarcode(cod)
      if (!prod) {
        toast.error(`No se encontró el código ${cod}`)
        return
      }
      setProductos((prev) =>
        prev.some((p) => p.id === prod.id)
          ? prev
          : [...prev, { id: prod.id, nombre: prod.nombre }]
      )
      setCodigo('')
    } catch {
      toast.error('Error al buscar el producto')
    } finally {
      setBuscando(false)
    }
  }

  const puedeCrear =
    nombre.trim().length > 0 &&
    empleado !== SIN_EMPLEADO &&
    (catSeleccionadas.length > 0 || productos.length > 0) &&
    !crear.isPending

  function crearConteo() {
    if (!puedeCrear || !usuario) return
    crear.mutate(
      {
        nombre: nombre.trim(),
        usuario_asignado: empleado,
        usuario_creador: usuario.id,
        categoria_ids: catSeleccionadas,
        producto_ids: productos.map((p) => p.id),
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !crear.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg">
            Nuevo conteo de mercadería
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Asigná categorías o productos a un empleado para que los cuente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Nombre */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">
              Nombre del conteo
            </Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Conteo góndola bebidas"
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          {/* Empleado */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">
              Empleado asignado
            </Label>
            <Select
              items={itemsEmpleado}
              value={empleado}
              onValueChange={(v) => setEmpleado(v ?? SIN_EMPLEADO)}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue placeholder="Elegir empleado…" />
              </SelectTrigger>
              <SelectContent>
                {(usuarios ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nombre} · {u.rol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Categorías */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">
              Categorías a contar
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {(categorias ?? []).map((c) => {
                const sel = catSeleccionadas.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleCategoria(c.id)}
                    className={cn(
                      'px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors',
                      sel
                        ? 'border-[#f9b44c] bg-[#f9b44c]/20 text-[#391511]'
                        : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                    )}
                  >
                    {c.nombre}
                  </button>
                )
              })}
              {(categorias ?? []).length === 0 && (
                <span className="text-xs text-[#c8a58a]">
                  No hay categorías cargadas.
                </span>
              )}
            </div>
          </div>

          {/* Productos sueltos */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">
              Productos sueltos (opcional)
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
                <Input
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      agregarProducto()
                    }
                  }}
                  placeholder="Escaneá un código…"
                  className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={agregarProducto}
                disabled={buscando || !codigo.trim()}
                className="border-[#e4c9b0] text-[#6f3a2a]"
              >
                {buscando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Agregar'
                )}
              </Button>
            </div>
            {productos.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {productos.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[#fdfaf6] border border-[#e4c9b0] text-xs text-[#391511]"
                  >
                    {p.nombre}
                    <button
                      type="button"
                      onClick={() =>
                        setProductos((prev) =>
                          prev.filter((x) => x.id !== p.id)
                        )
                      }
                      className="text-[#c8a58a] hover:text-[#c43e2c]"
                      aria-label="Quitar"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={crear.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={crearConteo}
            disabled={!puedeCrear}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creando…
              </>
            ) : (
              'Crear y asignar conteo'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
