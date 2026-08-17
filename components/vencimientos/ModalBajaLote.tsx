'use client'

import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Loader2 } from 'lucide-react'
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
import { MontoARS } from '@/components/shared/MontoARS'
import { useDarDeBajaLote } from '@/lib/hooks/useVencimientos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  formatearCantidad,
  formatearFechaCorta,
  formatearNumero,
  redondearCantidad,
} from '@/lib/utils/formato'
import type { LoteConProducto } from '@/lib/queries/vencimientos'
import { cn } from '@/lib/utils'

const esquemaBase = z.object({
  cantidad: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().positive('Debe ser mayor a 0')),
})

/**
 * La baja de un lote por peso se carga en kg (mínimo 1 g); la de uno por
 * unidad, en unidades enteras (mínimo 1).
 */
function crearEsquemaBaja(porPeso: boolean) {
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
  lote: LoteConProducto | null
}

export function ModalBajaLote({ abierto, onCambioAbierto, lote }: Props) {
  const { data: usuario } = useUsuario()
  const dardeBaja = useDarDeBajaLote()

  const porPeso = lote?.producto.venta_por_peso ?? false
  const esquema = useMemo(() => crearEsquemaBaja(porPeso), [porPeso])

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<DatosForm>({
    resolver: zodResolver(esquema),
    defaultValues: { cantidad: '' },
  })

  useEffect(() => {
    if (abierto && lote) {
      // Pre-cargar con el total del lote — es lo más común al dar de baja por vencimiento
      reset({ cantidad: String(lote.cantidad_actual) })
    }
  }, [abierto, lote, reset])

  const cantidadActual = Number(watch('cantidad')) || 0
  const valorMerma = lote ? cantidadActual * lote.producto.precio_costo : 0
  // Tolerancia de 1 g: dar de baja el lote COMPLETO es el caso más común y no
  // puede marcarse como exceso por el ruido de float de un decimal precargado.
  const excede = lote ? cantidadActual > lote.cantidad_actual + 0.0005 : false

  function onSubmit(datos: DatosForm) {
    if (!usuario || !lote) return
    const validado = esquema.parse(datos)
    dardeBaja.mutate(
      {
        lote_id: lote.id,
        cantidad: redondearCantidad(validado.cantidad, porPeso),
        usuario_id: usuario.id,
      },
      {
        onSuccess: () => onCambioAbierto(false),
      }
    )
  }

  if (!lote) return null

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !dardeBaja.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[#c43e2c]" />
            Dar de baja por vencimiento
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Queda registrado como merma. La cantidad se descuenta del stock.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 py-5 space-y-4">
          {/* Info del lote */}
          <div className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-xl p-3 space-y-1">
            <div className="font-semibold text-[#391511]">
              {lote.producto.nombre}
            </div>
            <div className="flex gap-3 text-xs text-[#6f3a2a]">
              <span>
                Lote{' '}
                <span className="font-mono text-[#391511]">#{lote.id}</span>
              </span>
              <span>
                Vence{' '}
                <span className="font-semibold text-[#391511]">
                  {formatearFechaCorta(lote.fecha_vencimiento)}
                </span>
              </span>
              <span>
                Disponible{' '}
                <span className="font-bold text-[#391511] tabular-nums">
                  {formatearCantidad(lote.cantidad_actual, porPeso)}
                </span>
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="cantidad"
              className="text-[#391511] font-medium text-sm"
            >
              Cantidad a dar de baja
              {porPeso && <span className="text-[#9e6b15]"> (kg)</span>}{' '}
              <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="cantidad"
              type="number"
              inputMode={porPeso ? 'decimal' : 'numeric'}
              min={porPeso ? '0.001' : '1'}
              max={lote.cantidad_actual}
              step={porPeso ? '0.001' : '1'}
              {...register('cantidad')}
              disabled={dardeBaja.isPending}
              autoFocus
              className="h-12 text-xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.cantidad && (
              <p className="text-[#c43e2c] text-xs">
                {errors.cantidad.message}
              </p>
            )}
            {porPeso && cantidadActual > 0 && !excede && (
              <p className="text-[10px] text-[#6f3a2a]">
                = {formatearNumero(Math.round(cantidadActual * 1000))} g
              </p>
            )}
            {excede && (
              <p className="text-[#c43e2c] text-xs">
                No podés dar de baja más de lo disponible en el lote.
              </p>
            )}
          </div>

          {/* Preview de la merma */}
          {cantidadActual > 0 && !excede && (
            <div
              className={cn(
                'rounded-xl p-3 border',
                'bg-[#c43e2c]/[0.05] border-[#c43e2c]/30'
              )}
            >
              <div className="flex justify-between items-baseline">
                <span className="text-xs uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Valor de la merma
                </span>
                <span className="text-xl font-extrabold text-[#9e2f25] tabular-nums">
                  <MontoARS monto={valorMerma} />
                </span>
              </div>
              <p className="text-[10px] text-[#6f3a2a] mt-1">
                {formatearCantidad(cantidadActual, porPeso)} × precio costo ·
                queda registrado para reportes de finanzas.
              </p>
            </div>
          )}
        </form>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={dardeBaja.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit(onSubmit)}
            disabled={
              dardeBaja.isPending || excede || cantidadActual <= 0
            }
            className="flex-1 bg-[#c43e2c] hover:bg-[#9e2f25] text-white font-semibold"
          >
            {dardeBaja.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Procesando…
              </>
            ) : (
              'Confirmar baja'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
