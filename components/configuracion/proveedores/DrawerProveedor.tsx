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
  useCreateProveedor,
  useUpdateProveedor,
} from '@/lib/hooks/useProveedores'
import type { ProveedorRow } from '@/types/database'

const esquemaProveedor = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(120, 'Máximo 120 caracteres'),
  telefono: z.string().trim().max(40, 'Máximo 40 caracteres'),
  email: z
    .string()
    .trim()
    .max(120, 'Máximo 120 caracteres')
    .refine(
      (v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      { message: 'Email inválido' }
    ),
  dias_entrega: z.string().refine(
    (v) => {
      if (v === '') return true
      const n = Number(v)
      return Number.isInteger(n) && n >= 0 && n <= 365
    },
    { message: 'Entero entre 0 y 365' }
  ),
  condicion_pago: z.string().trim().max(80, 'Máximo 80 caracteres'),
})

type DatosFormulario = z.infer<typeof esquemaProveedor>

interface Props {
  abierto: boolean
  onCambioAbierto: (abierto: boolean) => void
  proveedor: ProveedorRow | null
}

export function DrawerProveedor({ abierto, onCambioAbierto, proveedor }: Props) {
  const esEdicion = proveedor !== null
  const crear = useCreateProveedor()
  const actualizar = useUpdateProveedor()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DatosFormulario>({
    resolver: zodResolver(esquemaProveedor),
    defaultValues: {
      nombre: '',
      telefono: '',
      email: '',
      dias_entrega: '',
      condicion_pago: '',
    },
  })

  useEffect(() => {
    if (abierto) {
      reset({
        nombre: proveedor?.nombre ?? '',
        telefono: proveedor?.telefono ?? '',
        email: proveedor?.email ?? '',
        dias_entrega:
          proveedor?.dias_entrega != null ? String(proveedor.dias_entrega) : '',
        condicion_pago: proveedor?.condicion_pago ?? '',
      })
    }
  }, [abierto, proveedor, reset])

  const guardando = crear.isPending || actualizar.isPending

  async function onSubmit(datos: DatosFormulario) {
    const payload = {
      nombre: datos.nombre,
      telefono: datos.telefono.trim() ? datos.telefono.trim() : null,
      email: datos.email.trim() ? datos.email.trim() : null,
      dias_entrega: datos.dias_entrega === '' ? null : Number(datos.dias_entrega),
      condicion_pago: datos.condicion_pago.trim()
        ? datos.condicion_pago.trim()
        : null,
    }

    try {
      if (esEdicion && proveedor) {
        await actualizar.mutateAsync({ id: proveedor.id, datos: payload })
      } else {
        await crear.mutateAsync(payload)
      }
      onCambioAbierto(false)
    } catch {
      // toast manejado en el hook
    }
  }

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent side="right" className="sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] text-lg">
            {esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a] text-sm">
            {esEdicion
              ? `Actualizá los datos de "${proveedor?.nombre}".`
              : 'Datos de contacto y condiciones comerciales.'}
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
              placeholder="Ej: Distribuidora Norte"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.nombre && (
              <p className="text-[#c43e2c] text-xs mt-1">{errors.nombre.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="telefono" className="text-[#391511] font-medium">
                Teléfono
              </Label>
              <Input
                id="telefono"
                {...register('telefono')}
                placeholder="+54 380 ..."
                disabled={guardando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dias_entrega" className="text-[#391511] font-medium">
                Días entrega
              </Label>
              <Input
                id="dias_entrega"
                type="number"
                min={0}
                {...register('dias_entrega')}
                placeholder="Ej: 3"
                disabled={guardando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              {errors.dias_entrega && (
                <p className="text-[#c43e2c] text-xs mt-1">
                  {errors.dias_entrega.message}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-[#391511] font-medium">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              {...register('email')}
              placeholder="ventas@proveedor.com"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.email && (
              <p className="text-[#c43e2c] text-xs mt-1">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="condicion_pago" className="text-[#391511] font-medium">
              Condición de pago
            </Label>
            <Input
              id="condicion_pago"
              {...register('condicion_pago')}
              placeholder="Ej: 30 días"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
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
              'Crear proveedor'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
