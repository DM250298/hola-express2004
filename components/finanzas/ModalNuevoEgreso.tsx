'use client'

import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  useActualizarEgreso,
  useCrearEgreso,
} from '@/lib/hooks/useFinanzas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { CATEGORIAS_EGRESO } from '@/lib/queries/finanzas'
import type { EgresoRow } from '@/types/database'

const esquema = z.object({
  descripcion: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(200, 'Máximo 200 caracteres'),
  monto: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().min(0.01, 'Debe ser mayor a $0')),
  categoria: z.enum([
    'alquiler',
    'servicios',
    'sueldos',
    'pago_proveedores',
    'mantenimiento',
    'impuestos',
    'otros',
  ]),
  fecha: z.string().min(1, 'Fecha requerida'),
})

type DatosForm = z.input<typeof esquema>

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Si se pasa un egreso, el modal funciona en modo edición. */
  egreso?: EgresoRow | null
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const CATEGORIAS_VALIDAS = new Set<string>(
  CATEGORIAS_EGRESO.map((c) => c.valor)
)

export function ModalNuevoEgreso({ abierto, onCambioAbierto, egreso }: Props) {
  const { data: usuario } = useUsuario()
  const crear = useCrearEgreso()
  const actualizar = useActualizarEgreso()

  const esEdicion = !!egreso
  const procesando = crear.isPending || actualizar.isPending

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DatosForm>({
    resolver: zodResolver(esquema),
    defaultValues: {
      descripcion: '',
      monto: '',
      categoria: 'otros',
      fecha: hoyIso(),
    },
  })

  useEffect(() => {
    if (abierto) {
      reset(
        egreso
          ? {
              descripcion: egreso.descripcion,
              monto: String(egreso.monto),
              categoria: (CATEGORIAS_VALIDAS.has(egreso.categoria)
                ? egreso.categoria
                : 'otros') as DatosForm['categoria'],
              fecha: egreso.fecha.slice(0, 10),
            }
          : {
              descripcion: '',
              monto: '',
              categoria: 'otros',
              fecha: hoyIso(),
            }
      )
    }
  }, [abierto, egreso, reset])

  function onSubmit(datos: DatosForm) {
    const validado = esquema.parse(datos)
    if (esEdicion && egreso) {
      actualizar.mutate(
        {
          id: egreso.id,
          datos: {
            descripcion: validado.descripcion,
            monto: validado.monto,
            categoria: validado.categoria,
            fecha: validado.fecha,
          },
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      if (!usuario) return
      crear.mutate(
        {
          descripcion: validado.descripcion,
          monto: validado.monto,
          categoria: validado.categoria,
          fecha: validado.fecha,
          usuario_id: usuario.id,
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-[#f9b44c]" />
            {esEdicion ? 'Editar gasto' : 'Nuevo egreso'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {esEdicion
              ? 'Modificá los datos del gasto registrado.'
              : 'Registrá un gasto operativo.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="descripcion"
              className="text-[#391511] font-medium text-sm"
            >
              Descripción <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="descripcion"
              {...register('descripcion')}
              placeholder="Ej: Factura de luz noviembre"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.descripcion && (
              <p className="text-[#c43e2c] text-xs">
                {errors.descripcion.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="monto"
                className="text-[#391511] font-medium text-sm"
              >
                Monto <span className="text-[#c43e2c]">*</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                  $
                </span>
                <Input
                  id="monto"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  {...register('monto')}
                  placeholder="0,00"
                  disabled={procesando}
                  className="pl-7 h-11 text-lg font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              {errors.monto && (
                <p className="text-[#c43e2c] text-xs">{errors.monto.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="fecha"
                className="text-[#391511] font-medium text-sm"
              >
                Fecha <span className="text-[#c43e2c]">*</span>
              </Label>
              <Input
                id="fecha"
                type="date"
                {...register('fecha')}
                disabled={procesando}
                className="h-11 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              {errors.fecha && (
                <p className="text-[#c43e2c] text-xs">{errors.fecha.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Categoría <span className="text-[#c43e2c]">*</span>
            </Label>
            <Controller
              control={control}
              name="categoria"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={procesando}
                >
                  <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_EGRESO.map((c) => (
                      <SelectItem key={c.valor} value={c.valor}>
                        {c.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </form>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit(onSubmit)}
            disabled={procesando}
            className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : esEdicion ? (
              'Guardar cambios'
            ) : (
              'Registrar egreso'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
