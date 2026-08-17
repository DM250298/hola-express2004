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
import {
  formatearCantidad,
  formatearNumero,
  pareceGramosEnKg,
  redondearCantidad,
} from '@/lib/utils/formato'

const esquemaBase = z.object({
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
    .pipe(z.number().positive('Debe ser mayor a 0')),
})

/**
 * Un lote de producto por peso se carga en kg (mínimo 1 g); uno por unidad,
 * en unidades enteras (mínimo 1). El flag sale del producto elegido, así que
 * la regla va como refinement sobre el objeto ya parseado.
 */
function crearEsquemaLote(porPeso: boolean) {
  return esquemaBase.superRefine((datos, ctx) => {
    if (porPeso) {
      if (datos.cantidad < 0.001) {
        ctx.addIssue({
          code: 'custom',
          path: ['cantidad'],
          message: 'Debe ser al menos 1 g (0,001 kg)',
        })
      }
      return
    }
    if (!Number.isInteger(datos.cantidad)) {
      ctx.addIssue({
        code: 'custom',
        path: ['cantidad'],
        message: 'Solo enteros: este producto se vende por unidad',
      })
    } else if (datos.cantidad < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['cantidad'],
        message: 'Debe ser al menos 1',
      })
    }
  })
}

type DatosForm = z.input<typeof esquemaBase>

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
  // Se espeja el producto elegido en estado propio (además del form) porque el
  // esquema de validación depende de él y se arma ANTES del useForm.
  const [productoSel, setProductoSel] = useState<string>(SIN_VALOR)

  const productoElegido = useMemo(
    () => (productos ?? []).find((p) => String(p.id) === productoSel) ?? null,
    [productos, productoSel]
  )
  const porPeso = productoElegido?.venta_por_peso ?? false
  const esquemaActual = useMemo(() => crearEsquemaLote(porPeso), [porPeso])

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<DatosForm>({
    resolver: zodResolver(esquemaActual),
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
      setProductoSel(SIN_VALOR)
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

  const cantidadCruda = String(watch('cantidad') ?? '')
  const cantidadNum = Number(cantidadCruda) || 0

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
    const validado = esquemaActual.parse(datos)
    crear.mutate(
      {
        producto_id: validado.producto_id,
        fecha_vencimiento: validado.fecha_vencimiento,
        cantidad: redondearCantidad(validado.cantidad, porPeso),
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
                  onValueChange={(v) => {
                    field.onChange(v)
                    setProductoSel(v ?? SIN_VALOR)
                  }}
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
              Cantidad
              {porPeso && <span className="text-[#9e6b15]"> (kg)</span>}{' '}
              <span className="text-[#c43e2c]">*</span>
              {porPeso && (
                <span className="ml-1.5 rounded-full bg-[#f9b44c]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#9e6b15]">
                  Por kg
                </span>
              )}
            </Label>
            <Input
              id="cantidad"
              type="number"
              inputMode={porPeso ? 'decimal' : 'numeric'}
              min={porPeso ? '0.001' : '1'}
              step={porPeso ? '0.001' : '1'}
              {...register('cantidad')}
              placeholder={porPeso ? '0,000' : 'Ej: 24'}
              disabled={crear.isPending}
              className="h-12 text-xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.cantidad && (
              <p className="text-[#c43e2c] text-xs">
                {errors.cantidad.message}
              </p>
            )}
            {/* Un entero grande en un campo de KILOS suele ser el peso en
                gramos leído de la balanza. */}
            {porPeso && cantidadNum > 0 && (
              pareceGramosEnKg(cantidadCruda) ? (
                <button
                  type="button"
                  onClick={() =>
                    setValue('cantidad', String(cantidadNum / 1000), {
                      shouldValidate: true,
                    })
                  }
                  className="w-full rounded-md border border-[#c43e2c]/50 bg-[#c43e2c]/10 px-2 py-1 text-[11px] font-bold text-[#c43e2c] transition-colors hover:bg-[#c43e2c]/20"
                >
                  ¿{formatearNumero(cantidadNum)} KILOS? Eran gramos → usar{' '}
                  {formatearCantidad(cantidadNum / 1000, true)}
                </button>
              ) : (
                <p className="text-[10px] text-[#6f3a2a]">
                  = {formatearNumero(Math.round(cantidadNum * 1000))} g
                </p>
              )
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
