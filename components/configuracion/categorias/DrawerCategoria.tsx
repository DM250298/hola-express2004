'use client'

import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  useCreateCategoria,
  useUpdateCategoria,
} from '@/lib/hooks/useCategorias'
import type { CategoriaRow } from '@/types/database'

const esquemaCategoria = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(80, 'Máximo 80 caracteres'),
  descripcion: z
    .string()
    .trim()
    .max(300, 'Máximo 300 caracteres')
    .optional()
    .or(z.literal('')),
})

type DatosFormulario = z.infer<typeof esquemaCategoria>

interface Props {
  abierto: boolean
  onCambioAbierto: (abierto: boolean) => void
  categoria: CategoriaRow | null
}

export function DrawerCategoria({ abierto, onCambioAbierto, categoria }: Props) {
  const esEdicion = categoria !== null
  const crear = useCreateCategoria()
  const actualizar = useUpdateCategoria()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DatosFormulario>({
    resolver: zodResolver(esquemaCategoria),
    defaultValues: { nombre: '', descripcion: '' },
  })

  useEffect(() => {
    if (abierto) {
      reset({
        nombre: categoria?.nombre ?? '',
        descripcion: categoria?.descripcion ?? '',
      })
    }
  }, [abierto, categoria, reset])

  const guardando = crear.isPending || actualizar.isPending

  async function onSubmit(datos: DatosFormulario) {
    const payload = {
      nombre: datos.nombre,
      descripcion: datos.descripcion?.trim() ? datos.descripcion : null,
    }

    try {
      if (esEdicion && categoria) {
        await actualizar.mutateAsync({ id: categoria.id, datos: payload })
      } else {
        await crear.mutateAsync(payload)
      }
      onCambioAbierto(false)
    } catch {
      // El toast de error ya se dispara desde el hook
    }
  }

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent side="right" className="sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] text-lg">
            {esEdicion ? 'Editar categoría' : 'Nueva categoría'}
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a] text-sm">
            {esEdicion
              ? `Actualizá los datos de "${categoria?.nombre}".`
              : 'Las categorías agrupan productos para facilitar la búsqueda y reportes.'}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          <div className="space-y-1.5">
            <Label htmlFor="nombre" className="text-[#391511] font-medium">
              Nombre <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="nombre"
              {...register('nombre')}
              placeholder="Ej: Bebidas"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.nombre && (
              <p className="text-[#c43e2c] text-xs mt-1">{errors.nombre.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="descripcion" className="text-[#391511] font-medium">
              Descripción
            </Label>
            <Input
              id="descripcion"
              {...register('descripcion')}
              placeholder="Opcional"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.descripcion && (
              <p className="text-[#c43e2c] text-xs mt-1">
                {errors.descripcion.message}
              </p>
            )}
          </div>
        </form>

        <SheetFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={guardando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit(onSubmit)}
            disabled={guardando}
            className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {guardando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : esEdicion ? (
              'Guardar cambios'
            ) : (
              'Crear categoría'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
