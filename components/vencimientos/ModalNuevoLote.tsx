'use client'

import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CalendarPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Semaforo } from '@/components/shared/Semaforo'
import { useCrearLote } from '@/lib/hooks/useVencimientos'
import { useProductos } from '@/lib/hooks/useProductos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  clasificarVencimiento,
  diasHastaVencimiento,
} from '@/lib/queries/vencimientos'

const esquema = z.object({
  producto_id: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .pipe(z.number().int('Seleccioná un producto').positive('Seleccioná un producto')),
  fecha_vencimiento: z
    .string()
    .min(1, 'Ingresá la fecha de vencimiento')
    .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), 'Formato inválido'),
  cantidad: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().int('Solo enteros').min(1, 'Debe ser al menos 1')),
})

type DatosForm = z.input<typeof esquema>

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

const SIN_VALOR = '__sin_valor__'

export function ModalNuevoLote({ abierto, onCambioAbierto }: Props) {
  const { data: usuario } = useUsuario()
  const { data: productos, isLoading: cargandoProductos } = useProductos({
    activo: true,
  })
  const crear = useCrearLote()
  const [busqueda, setBusqueda] = useState('')

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<DatosForm>({
    resolver: zodResolver(esquema),
    defaultValues: {
      producto_id: SIN_VALOR,
      fecha_vencimiento: '',
      cantidad: '',
    },
  })

  useEffect(() => {
    if (abierto) {
      reset({
        producto_id: SIN_VALOR,
        fecha_vencimiento: '',
        cantidad: '',
      })
      setBusqueda('')
    }
  }, [abierto, reset])

  const productosFiltrados = useMemo(() => {
    const lista = productos ?? []
    const q = busqueda.trim().toLowerCase()
    if (!q) return lista.slice(0, 50)
    return lista
      .filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.codigo_barras ?? '').toLowerCase().includes(q)
      )
      .slice(0, 50)
  }, [productos, busqueda])

  const fechaVisible = watch('fecha_vencimiento')
  const previewClase = useMemo(() => {
    if (!fechaVisible || !/^\d{4}-\d{2}-\d{2}$/.test(fechaVisible)) return null
    return clasificarVencimiento(diasHastaVencimiento(fechaVisible))
  }, [fechaVisible])

  const hoy = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  function onSubmit(datos: DatosForm) {
    if (!usuario) return
    const validado = esquema.parse(datos)
    crear.mutate(
      {
        producto_id: validado.producto_id,
        fecha_vencimiento: validado.fecha_vencimiento,
        cantidad: validado.cantidad,
        usuario_id: usuario.id,
      },
      {
        onSuccess: () => onCambioAbierto(false),
      }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !crear.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-[#f9b44c]" />
            Ingresar lote nuevo
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Suma stock y registra el lote con su fecha de vencimiento.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          {/* Producto */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Producto <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              placeholder="Buscar por nombre o código…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              disabled={crear.isPending || cargandoProductos}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            <Controller
              control={control}
              name="producto_id"
              render={({ field }) => (
                <Select
                  value={
                    field.value === undefined ||
                    field.value === null ||
                    field.value === SIN_VALOR
                      ? SIN_VALOR
                      : String(field.value)
                  }
                  onValueChange={field.onChange}
                  disabled={crear.isPending || cargandoProductos}
                >
                  <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                    <SelectValue placeholder="Seleccionar producto…" />
                  </SelectTrigger>
                  <SelectContent>
                    {productosFiltrados.length === 0 ? (
                      <SelectItem value={SIN_VALOR} disabled>
                        Sin resultados
                      </SelectItem>
                    ) : (
                      productosFiltrados.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.nombre}
                          {p.codigo_barras && (
                            <span className="text-[#c8a58a] text-xs ml-2 font-mono">
                              {p.codigo_barras}
                            </span>
                          )}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.producto_id && (
              <p className="text-[#c43e2c] text-xs">
                {errors.producto_id.message}
              </p>
            )}
          </div>

          {/* Fecha de vencimiento */}
          <div className="space-y-1.5">
            <Label
              htmlFor="fecha_vencimiento"
              className="text-[#391511] font-medium text-sm"
            >
              Fecha de vencimiento <span className="text-[#c43e2c]">*</span>
            </Label>
            <div className="flex gap-2 items-start">
              <Input
                id="fecha_vencimiento"
                type="date"
                min={hoy}
                {...register('fecha_vencimiento')}
                disabled={crear.isPending}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums flex-1"
              />
              {previewClase && (
                <div className="pt-1.5">
                  <Semaforo clase={previewClase} size="md" />
                </div>
              )}
            </div>
            {errors.fecha_vencimiento && (
              <p className="text-[#c43e2c] text-xs">
                {errors.fecha_vencimiento.message}
              </p>
            )}
          </div>

          {/* Cantidad */}
          <div className="space-y-1.5">
            <Label
              htmlFor="cantidad"
              className="text-[#391511] font-medium text-sm"
            >
              Cantidad <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="cantidad"
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              {...register('cantidad')}
              placeholder="Ej: 24"
              disabled={crear.isPending}
              className="h-12 text-xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.cantidad && (
              <p className="text-[#c43e2c] text-xs">
                {errors.cantidad.message}
              </p>
            )}
            <p className="text-[#6f3a2a] text-xs">
              Se sumará al stock del producto y queda registrado el movimiento.
            </p>
          </div>
        </form>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={crear.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit(onSubmit)}
            disabled={crear.isPending}
            className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              'Ingresar lote'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
