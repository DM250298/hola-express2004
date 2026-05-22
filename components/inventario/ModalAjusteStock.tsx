'use client'

import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowDown, ArrowUp, Loader2, RefreshCcw } from 'lucide-react'
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
import { useAjustarStock } from '@/lib/hooks/useInventario'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'

const esquema = z.object({
  tipo: z.enum(['entrada', 'salida', 'ajuste']),
  cantidad: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().int('Solo enteros').min(0, 'No puede ser negativo')),
  nota: z
    .string()
    .trim()
    .min(3, 'La nota es obligatoria (mín. 3 caracteres)')
    .max(300, 'Máximo 300 caracteres'),
})

type DatosForm = z.input<typeof esquema>

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  producto: {
    id: number
    nombre: string
    stock_actual: number
  } | null
}

const TIPOS = [
  {
    valor: 'entrada' as const,
    etiqueta: 'Entrada',
    descripcion: 'Suma stock',
    icono: ArrowUp,
    color: '#6f3a2a',
    bg: 'bg-[#f9b44c]/15 border-[#f9b44c]/40',
    bgActivo: 'bg-[#f9b44c] border-[#f9b44c] text-[#391511]',
  },
  {
    valor: 'salida' as const,
    etiqueta: 'Salida',
    descripcion: 'Resta stock',
    icono: ArrowDown,
    color: '#9e2f25',
    bg: 'bg-[#c43e2c]/10 border-[#c43e2c]/30',
    bgActivo: 'bg-[#c43e2c] border-[#c43e2c] text-white',
  },
  {
    valor: 'ajuste' as const,
    etiqueta: 'Corrección',
    descripcion: 'Nuevo total',
    icono: RefreshCcw,
    color: '#6f3a2a',
    bg: 'bg-[#c8a58a]/20 border-[#c8a58a]/40',
    bgActivo: 'bg-[#6f3a2a] border-[#6f3a2a] text-white',
  },
]

export function ModalAjusteStock({ abierto, onCambioAbierto, producto }: Props) {
  const { data: usuario } = useUsuario()
  const ajustar = useAjustarStock()

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<DatosForm>({
    resolver: zodResolver(esquema),
    defaultValues: { tipo: 'entrada', cantidad: '', nota: '' },
  })

  useEffect(() => {
    if (abierto) {
      reset({ tipo: 'entrada', cantidad: '', nota: '' })
    }
  }, [abierto, reset])

  const tipoActual = watch('tipo')
  const cantidadActual = Number(watch('cantidad')) || 0

  function calcularStockResultante(): number | null {
    if (!producto || !cantidadActual) return null
    switch (tipoActual) {
      case 'entrada':
        return producto.stock_actual + cantidadActual
      case 'salida':
        return producto.stock_actual - cantidadActual
      case 'ajuste':
        return cantidadActual
    }
  }

  const stockResultante = calcularStockResultante()

  function onSubmit(datos: DatosForm) {
    if (!producto || !usuario) return
    const validado = esquema.parse(datos)
    ajustar.mutate(
      {
        producto_id: producto.id,
        tipo: validado.tipo,
        cantidad: validado.cantidad,
        nota: validado.nota,
        usuario_id: usuario.id,
      },
      {
        onSuccess: () => onCambioAbierto(false),
      }
    )
  }

  if (!producto) return null

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !ajustar.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Ajustar stock
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            <span className="font-medium text-[#391511]">{producto.nombre}</span>
            {' · '}
            Stock actual:{' '}
            <span className="font-bold text-[#391511] tabular-nums">
              {producto.stock_actual}
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          {/* Tipo */}
          <div>
            <Label className="text-[#391511] font-medium text-sm mb-2 block">
              Tipo de ajuste <span className="text-[#c43e2c]">*</span>
            </Label>
            <Controller
              control={control}
              name="tipo"
              render={({ field }) => (
                <div className="grid grid-cols-3 gap-2">
                  {TIPOS.map((t) => {
                    const activo = field.value === t.valor
                    const Icono = t.icono
                    return (
                      <button
                        key={t.valor}
                        type="button"
                        onClick={() => field.onChange(t.valor)}
                        disabled={ajustar.isPending}
                        className={cn(
                          'flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 transition-all',
                          activo ? t.bgActivo : t.bg
                        )}
                      >
                        <Icono
                          className="h-4 w-4"
                          style={!activo ? { color: t.color } : undefined}
                        />
                        <span className="text-xs font-bold">{t.etiqueta}</span>
                        <span
                          className={cn(
                            'text-[10px] leading-none',
                            activo ? 'opacity-80' : 'opacity-60'
                          )}
                        >
                          {t.descripcion}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            />
          </div>

          {/* Cantidad */}
          <div className="space-y-1.5">
            <Label htmlFor="cantidad" className="text-[#391511] font-medium text-sm">
              {tipoActual === 'ajuste' ? 'Nuevo stock total' : 'Cantidad'}{' '}
              <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="cantidad"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              {...register('cantidad')}
              placeholder="0"
              disabled={ajustar.isPending}
              autoFocus
              className="h-12 text-xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.cantidad && (
              <p className="text-[#c43e2c] text-xs">{errors.cantidad.message}</p>
            )}
            {stockResultante !== null && (
              <div
                className={cn(
                  'mt-1 px-3 py-2 rounded-xl text-sm flex items-center justify-between',
                  stockResultante < 0
                    ? 'bg-[#c43e2c]/15 text-[#9e2f25]'
                    : 'bg-[#f9b44c]/15 text-[#6f3a2a]'
                )}
              >
                <span className="font-medium">Stock resultante</span>
                <span className="font-extrabold text-base tabular-nums">
                  {stockResultante}
                </span>
              </div>
            )}
            {stockResultante !== null && stockResultante < 0 && (
              <p className="text-[#c43e2c] text-xs">
                La salida supera el stock disponible.
              </p>
            )}
          </div>

          {/* Nota */}
          <div className="space-y-1.5">
            <Label htmlFor="nota" className="text-[#391511] font-medium text-sm">
              Motivo / nota <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="nota"
              {...register('nota')}
              placeholder="Ej: Recepción de pedido del proveedor X"
              disabled={ajustar.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.nota && (
              <p className="text-[#c43e2c] text-xs">{errors.nota.message}</p>
            )}
            <p className="text-[#6f3a2a] text-xs">
              Queda registrado en el historial junto con tu usuario.
            </p>
          </div>
        </form>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={ajustar.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit(onSubmit)}
            disabled={
              ajustar.isPending ||
              (stockResultante !== null && stockResultante < 0)
            }
            className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {ajustar.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Aplicando…
              </>
            ) : (
              'Aplicar ajuste'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
