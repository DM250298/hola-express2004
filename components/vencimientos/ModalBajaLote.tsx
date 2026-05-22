'use client'

import { useEffect } from 'react'
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
import { formatearFechaCorta } from '@/lib/utils/formato'
import type { LoteConProducto } from '@/lib/queries/vencimientos'
import { cn } from '@/lib/utils'

const esquema = z.object({
  cantidad: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().int('Solo enteros').min(1, 'Debe ser al menos 1')),
})

type DatosForm = z.input<typeof esquema>

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  lote: LoteConProducto | null
}

export function ModalBajaLote({ abierto, onCambioAbierto, lote }: Props) {
  const { data: usuario } = useUsuario()
  const dardeBaja = useDarDeBajaLote()

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
  const excede = lote ? cantidadActual > lote.cantidad_actual : false

  function onSubmit(datos: DatosForm) {
    if (!usuario || !lote) return
    const validado = esquema.parse(datos)
    dardeBaja.mutate(
      {
        lote_id: lote.id,
        cantidad: validado.cantidad,
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
                  {lote.cantidad_actual}
                </span>
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="cantidad"
              className="text-[#391511] font-medium text-sm"
            >
              Cantidad a dar de baja <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="cantidad"
              type="number"
              inputMode="numeric"
              min="1"
              max={lote.cantidad_actual}
              step="1"
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
            {excede && (
              <p className="text-[#c43e2c] text-xs">
                No podés dar de baja más unidades que las disponibles en el lote.
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
                {cantidadActual} × precio costo · queda registrado para reportes
                de finanzas.
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
