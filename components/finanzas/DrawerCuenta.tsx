'use client'

import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Banknote, Building2, Loader2, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { useActualizarCuenta, useCrearCuenta } from '@/lib/hooks/useCuentas'
import { cn } from '@/lib/utils'
import type { CuentaRow, TipoCuenta } from '@/types/database'

const esquemaCuenta = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(80, 'Máximo 80 caracteres'),
  tipo: z.enum(['caja', 'banco', 'billetera_virtual']),
  saldo_actual: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? 0 : Number(v)))
    .pipe(z.number()),
  banco: z.string().trim().max(80).optional().or(z.literal('')),
  numero_cuenta: z.string().trim().max(60).optional().or(z.literal('')),
  alias_cbu: z.string().trim().max(60).optional().or(z.literal('')),
  notas: z.string().trim().max(200).optional().or(z.literal('')),
  activo: z.boolean(),
  retencion_iibb_porcentaje: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? 0 : Number(v)))
    .pipe(z.number().min(0).max(100)),
})

type DatosForm = z.input<typeof esquemaCuenta>

const TIPOS: Array<{
  valor: TipoCuenta
  etiqueta: string
  icono: React.ElementType
  descripcion: string
}> = [
  { valor: 'caja', etiqueta: 'Caja', icono: Banknote, descripcion: 'Efectivo físico' },
  { valor: 'banco', etiqueta: 'Banco', icono: Building2, descripcion: 'Cuenta bancaria' },
  {
    valor: 'billetera_virtual',
    etiqueta: 'Billetera',
    icono: Smartphone,
    descripcion: 'Mercado Pago, Ualá, etc.',
  },
]

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  cuenta: CuentaRow | null
}

export function DrawerCuenta({ abierto, onCambioAbierto, cuenta }: Props) {
  const esEdicion = cuenta !== null
  // La bóveda (candado, mig 118): su saldo lo mueve SOLO el circuito de la
  // caja fuerte (arqueo validado / movimiento manual / remesa). Acá no se
  // edita saldo, tipo ni activo para no romper el candado.
  const esBoveda = esEdicion && (cuenta?.es_caja_fuerte ?? false)
  const crear = useCrearCuenta()
  const actualizar = useActualizarCuenta()

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DatosForm>({
    resolver: zodResolver(esquemaCuenta),
    defaultValues: {
      nombre: '',
      tipo: 'caja',
      saldo_actual: '0',
      banco: '',
      numero_cuenta: '',
      alias_cbu: '',
      notas: '',
      activo: true,
      retencion_iibb_porcentaje: '0',
    },
  })

  useEffect(() => {
    if (abierto) {
      reset({
        nombre: cuenta?.nombre ?? '',
        tipo: cuenta?.tipo ?? 'caja',
        saldo_actual: String(cuenta?.saldo_actual ?? 0),
        banco: cuenta?.banco ?? '',
        numero_cuenta: cuenta?.numero_cuenta ?? '',
        alias_cbu: cuenta?.alias_cbu ?? '',
        notas: cuenta?.notas ?? '',
        activo: cuenta?.activo ?? true,
        retencion_iibb_porcentaje: String(cuenta?.retencion_iibb_porcentaje ?? 0),
      })
    }
  }, [abierto, cuenta, reset])

  const guardando = crear.isPending || actualizar.isPending

  async function onSubmit(datos: DatosForm) {
    const validado = esquemaCuenta.parse(datos)
    const base = {
      nombre: validado.nombre,
      banco: validado.banco?.trim() ? validado.banco : null,
      numero_cuenta: validado.numero_cuenta?.trim()
        ? validado.numero_cuenta
        : null,
      alias_cbu: validado.alias_cbu?.trim() ? validado.alias_cbu : null,
      notas: validado.notas?.trim() ? validado.notas : null,
      retencion_iibb_porcentaje: validado.retencion_iibb_porcentaje,
    }
    // Para la bóveda NO se persisten saldo/tipo/activo: el saldo lo maneja el
    // circuito del candado y la cuenta debe seguir siendo caja activa.
    const payload = esBoveda
      ? base
      : {
          ...base,
          tipo: validado.tipo,
          saldo_actual: validado.saldo_actual,
          activo: validado.activo,
        }

    try {
      if (esEdicion && cuenta) {
        await actualizar.mutateAsync({ id: cuenta.id, datos: payload })
      } else {
        await crear.mutateAsync({
          ...base,
          nombre: validado.nombre,
          tipo: validado.tipo,
          saldo_actual: validado.saldo_actual,
          activo: validado.activo,
        })
      }
      onCambioAbierto(false)
    } catch {
      // toast manejado en hooks
    }
  }

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent side="right" className="sm:max-w-md w-full flex flex-col p-0">
        <SheetHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] text-lg">
            {esEdicion ? 'Editar cuenta' : 'Nueva cuenta'}
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a]">
            {esEdicion
              ? `Modificá los datos de "${cuenta?.nombre}".`
              : 'Caja, banco o billetera virtual donde se mueve la plata del negocio.'}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          {/* Tipo */}
          <div>
            <Label className="text-[#391511] font-medium mb-2 block">
              Tipo de cuenta
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
                        disabled={guardando || esBoveda}
                        className={cn(
                          'flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 transition-all',
                          activo
                            ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                            : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                        )}
                      >
                        <Icono className="h-4 w-4" />
                        <span className="text-xs font-bold">{t.etiqueta}</span>
                        <span className="text-[10px] leading-none opacity-70">
                          {t.descripcion}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            />
          </div>

          {/* Nombre */}
          <div className="space-y-1.5">
            <Label htmlFor="nombre" className="text-[#391511] font-medium">
              Nombre <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="nombre"
              {...register('nombre')}
              placeholder="Ej: Caja Efectivo, Banco Nación, Mercado Pago"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.nombre && (
              <p className="text-[#c43e2c] text-xs">{errors.nombre.message}</p>
            )}
          </div>

          {/* Saldo inicial */}
          <div className="space-y-1.5">
            <Label htmlFor="saldo" className="text-[#391511] font-medium">
              {esEdicion ? 'Saldo actual' : 'Saldo inicial'}
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f3a2a] font-bold">
                $
              </span>
              <Input
                id="saldo"
                type="number"
                step="0.01"
                {...register('saldo_actual')}
                disabled={guardando || esBoveda}
                className="pl-7 h-12 text-lg tabular-nums font-semibold border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <p className="text-[10px] text-[#6f3a2a]">
              {esBoveda
                ? '🔒 Esta cuenta es la caja fuerte: el saldo lo mueve solo el circuito (arqueo validado, movimientos manuales, depósitos). No se edita a mano.'
                : esEdicion
                  ? '⚠️ Editar el saldo directamente NO crea un movimiento. Usá "Nuevo movimiento" o "Ajuste".'
                  : 'Si la cuenta ya tiene plata cuando la creás, ingresá ese saldo acá.'}
            </p>
          </div>

          {/* Banco / número solo para tipo banco */}
          <div className="space-y-1.5">
            <Label htmlFor="banco" className="text-[#391511] font-medium">
              Banco (opcional)
            </Label>
            <Input
              id="banco"
              {...register('banco')}
              placeholder="Ej: Banco Nación"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="numero" className="text-[#391511] font-medium">
                Nº cuenta / CBU
              </Label>
              <Input
                id="numero"
                {...register('numero_cuenta')}
                placeholder="0000000000000000000000"
                disabled={guardando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alias" className="text-[#391511] font-medium">
                Alias
              </Label>
              <Input
                id="alias"
                {...register('alias_cbu')}
                placeholder="hola.express"
                disabled={guardando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] font-mono text-xs"
              />
            </div>
          </div>

          {/* Retención IIBB */}
          <div className="space-y-1.5">
            <Label
              htmlFor="iibb"
              className="text-[#391511] font-medium flex items-center gap-1"
            >
              Retención de Ingresos Brutos (%)
              <AyudaContextual titulo="Ingresos Brutos (IIBB)">
                Es un impuesto provincial que algunos medios te descuentan de
                cada venta. En La Rioja, Mercado Pago suele retener ~3%. Si es
                efectivo o no te retienen, dejá 0.
              </AyudaContextual>
            </Label>
            <div className="relative">
              <Input
                id="iibb"
                type="number"
                step="0.01"
                min={0}
                max={100}
                {...register('retencion_iibb_porcentaje')}
                disabled={guardando}
                placeholder="0"
                className="pr-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6f3a2a] font-bold text-sm">
                %
              </span>
            </div>
            <p className="text-[10px] text-[#6f3a2a] leading-snug">
              Se descuenta solo de cada ingreso a esta cuenta, además de la
              comisión. Ejemplo: si entran $100 con 3%, te quedan $97. Dejá en{' '}
              <strong>0</strong> si no corresponde (efectivo, o medios que no
              te retienen).
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notas" className="text-[#391511] font-medium">
              Notas (opcional)
            </Label>
            <Input
              id="notas"
              {...register('notas')}
              placeholder="Cualquier observación"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          {esEdicion && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60">
              <div>
                <Label htmlFor="activo" className="text-[#391511] font-medium cursor-pointer">
                  Cuenta activa
                </Label>
                <p className="text-[#6f3a2a] text-xs mt-0.5">
                  Las inactivas no aparecen en los selectores.
                </p>
              </div>
              <Controller
                control={control}
                name="activo"
                render={({ field }) => (
                  <Switch
                    id="activo"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={guardando || esBoveda}
                    className="data-[state=checked]:bg-[#f9b44c]"
                  />
                )}
              />
            </div>
          )}
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
              'Crear cuenta'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
