'use client'

import { useEffect, useState } from 'react'
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
import { useConfigCompras } from '@/lib/hooks/useHistorialCostos'
import { calcularDiasHastaEntrega } from '@/lib/compras/cobertura'
import { cn } from '@/lib/utils'
import type { ProveedorRow } from '@/types/database'

/** Días con hasta 1 decimal, acepta coma (es-AR). Vacío = usar default global. */
function validarDias(v: string, minimoExclusivo: boolean): boolean {
  if (v === '') return true
  const n = Number(v.replace(',', '.'))
  if (!Number.isFinite(n) || n > 365) return false
  return minimoExclusivo ? n > 0 : n >= 0
}

/** Parsea el campo de días a número (o null si quedó vacío). */
function diasANumero(v: string): number | null {
  if (v === '') return null
  return Number(v.replace(',', '.'))
}

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
  dias_cobertura_objetivo: z
    .string()
    .refine((v) => validarDias(v, true), { message: 'Mayor a 0, hasta 365' }),
  dias_seguridad: z
    .string()
    .refine((v) => validarDias(v, false), { message: 'Entre 0 y 365' }),
  frecuencia_reposicion_dias: z
    .string()
    .refine((v) => validarDias(v, true), { message: 'Mayor a 0, hasta 365' }),
  cuit: z
    .string()
    .trim()
    .refine((v) => v === '' || /^\d{11}$/.test(v.replace(/\D/g, '')), {
      message: 'CUIT: 11 dígitos',
    }),
  razon_social: z.string().trim().max(160, 'Máximo 160 caracteres'),
  condicion_iva: z.string(),
  domicilio: z.string().trim().max(200, 'Máximo 200 caracteres'),
})

type DatosFormulario = z.infer<typeof esquemaProveedor>

/** Semana lunes-primero para mostrar; el valor es el de Date.getDay() (0=dom). */
const DIAS_SEMANA: { valor: number; etiqueta: string }[] = [
  { valor: 1, etiqueta: 'L' },
  { valor: 2, etiqueta: 'M' },
  { valor: 3, etiqueta: 'X' },
  { valor: 4, etiqueta: 'J' },
  { valor: 5, etiqueta: 'V' },
  { valor: 6, etiqueta: 'S' },
  { valor: 0, etiqueta: 'D' },
]

/** Fila de chips de días de la semana (calendario de reposición, mig 152). */
function SelectorDias({
  valor,
  onCambio,
  deshabilitado,
  etiqueta,
}: {
  valor: number[]
  onCambio: (dias: number[]) => void
  deshabilitado: boolean
  etiqueta: string
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs text-[#6f3a2a] w-20">{etiqueta}</span>
      {DIAS_SEMANA.map((d) => {
        const activo = valor.includes(d.valor)
        return (
          <button
            key={d.valor}
            type="button"
            disabled={deshabilitado}
            onClick={() =>
              onCambio(
                activo
                  ? valor.filter((v) => v !== d.valor)
                  : [...valor, d.valor]
              )
            }
            className={cn(
              'h-7 w-7 rounded-full text-xs font-semibold transition-colors',
              activo
                ? 'bg-[#f9b44c] text-[#391511]'
                : 'bg-white border border-[#e4c9b0] text-[#c8a58a] hover:border-[#f9b44c]'
            )}
            aria-pressed={activo}
            aria-label={`${etiqueta} ${d.etiqueta}`}
          >
            {d.etiqueta}
          </button>
        )
      })}
    </div>
  )
}

const CONDICIONES_IVA = [
  { valor: 'responsable_inscripto', etiqueta: 'Responsable Inscripto' },
  { valor: 'monotributo', etiqueta: 'Monotributo' },
  { valor: 'exento', etiqueta: 'Exento' },
  { valor: 'consumidor_final', etiqueta: 'Consumidor Final' },
]

interface Props {
  abierto: boolean
  onCambioAbierto: (abierto: boolean) => void
  proveedor: ProveedorRow | null
}

export function DrawerProveedor({ abierto, onCambioAbierto, proveedor }: Props) {
  const esEdicion = proveedor !== null
  const crear = useCreateProveedor()
  const actualizar = useUpdateProveedor()
  // Defaults globales de reposición: se muestran como placeholder para que se
  // vea qué valor rige cuando el campo queda vacío.
  const { data: configCompras } = useConfigCompras()

  // Calendario semanal (mig 152) fuera de react-hook-form: son arrays que se
  // togglean con chips, no inputs registrables.
  const [diasToma, setDiasToma] = useState<number[]>([])
  const [diasEntrega, setDiasEntrega] = useState<number[]>([])

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
      dias_cobertura_objetivo: '',
      dias_seguridad: '',
      frecuencia_reposicion_dias: '',
      cuit: '',
      razon_social: '',
      condicion_iva: '',
      domicilio: '',
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
        dias_cobertura_objetivo:
          proveedor?.dias_cobertura_objetivo != null
            ? String(proveedor.dias_cobertura_objetivo)
            : '',
        dias_seguridad:
          proveedor?.dias_seguridad != null
            ? String(proveedor.dias_seguridad)
            : '',
        frecuencia_reposicion_dias:
          proveedor?.frecuencia_reposicion_dias != null
            ? String(proveedor.frecuencia_reposicion_dias)
            : '',
        cuit: proveedor?.cuit ?? '',
        razon_social: proveedor?.razon_social ?? '',
        condicion_iva: proveedor?.condicion_iva ?? '',
        domicilio: proveedor?.domicilio ?? '',
      })
      setDiasToma(proveedor?.dias_toma_pedido ?? [])
      setDiasEntrega(proveedor?.dias_entrega_semana ?? [])
    }
  }, [abierto, proveedor, reset])

  const guardando = crear.isPending || actualizar.isPending

  async function onSubmit(datos: DatosFormulario) {
    const cuitDigitos = datos.cuit.replace(/\D/g, '')
    const payload = {
      nombre: datos.nombre,
      telefono: datos.telefono.trim() ? datos.telefono.trim() : null,
      email: datos.email.trim() ? datos.email.trim() : null,
      dias_entrega: datos.dias_entrega === '' ? null : Number(datos.dias_entrega),
      condicion_pago: datos.condicion_pago.trim()
        ? datos.condicion_pago.trim()
        : null,
      dias_cobertura_objetivo: diasANumero(datos.dias_cobertura_objetivo),
      dias_seguridad: diasANumero(datos.dias_seguridad),
      frecuencia_reposicion_dias: diasANumero(datos.frecuencia_reposicion_dias),
      dias_toma_pedido:
        diasToma.length > 0 ? [...diasToma].sort((a, b) => a - b) : null,
      dias_entrega_semana:
        diasEntrega.length > 0 ? [...diasEntrega].sort((a, b) => a - b) : null,
      cuit: cuitDigitos ? cuitDigitos : null,
      razon_social: datos.razon_social.trim() ? datos.razon_social.trim() : null,
      condicion_iva: datos.condicion_iva ? datos.condicion_iva : null,
      domicilio: datos.domicilio.trim() ? datos.domicilio.trim() : null,
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

          {/* Reposición por cobertura (mig 151) */}
          <div className="pt-3 border-t border-[#e4c9b0]/60 space-y-5">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Reposición
              </p>
              <p className="text-xs text-[#6f3a2a] mt-1">
                Vacío = usa el default global. &quot;Días entrega&quot; (arriba)
                es cuánto tarda en llegar la orden; la frecuencia es cada
                cuántos días se le pide.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="dias_cobertura_objetivo"
                  className="text-[#391511] font-medium"
                >
                  Cobertura obj.
                </Label>
                <Input
                  id="dias_cobertura_objetivo"
                  inputMode="decimal"
                  {...register('dias_cobertura_objetivo')}
                  placeholder={
                    configCompras
                      ? `${configCompras.dias_cobertura_objetivo_default} días`
                      : 'días'
                  }
                  disabled={guardando}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
                />
                {errors.dias_cobertura_objetivo && (
                  <p className="text-[#c43e2c] text-xs mt-1">
                    {errors.dias_cobertura_objetivo.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="dias_seguridad"
                  className="text-[#391511] font-medium"
                >
                  Seguridad
                </Label>
                <Input
                  id="dias_seguridad"
                  inputMode="decimal"
                  {...register('dias_seguridad')}
                  placeholder={
                    configCompras
                      ? `${configCompras.dias_seguridad_default} días`
                      : 'días'
                  }
                  disabled={guardando}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
                />
                {errors.dias_seguridad && (
                  <p className="text-[#c43e2c] text-xs mt-1">
                    {errors.dias_seguridad.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="frecuencia_reposicion_dias"
                  className="text-[#391511] font-medium"
                >
                  Frecuencia
                </Label>
                <Input
                  id="frecuencia_reposicion_dias"
                  inputMode="decimal"
                  {...register('frecuencia_reposicion_dias')}
                  placeholder={
                    configCompras
                      ? `${configCompras.frecuencia_reposicion_default} días`
                      : 'días'
                  }
                  disabled={guardando}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
                />
                {errors.frecuencia_reposicion_dias && (
                  <p className="text-[#c43e2c] text-xs mt-1">
                    {errors.frecuencia_reposicion_dias.message}
                  </p>
                )}
              </div>
            </div>

            {/* Calendario real (mig 152): si se cargan AMBAS filas, el punto
                de reposición usa los días hasta la próxima entrega posible
                en lugar de la frecuencia fija. */}
            <div className="space-y-2">
              <SelectorDias
                etiqueta="Toma pedidos"
                valor={diasToma}
                onCambio={setDiasToma}
                deshabilitado={guardando}
              />
              <SelectorDias
                etiqueta="Entrega"
                valor={diasEntrega}
                onCambio={setDiasEntrega}
                deshabilitado={guardando}
              />
              {diasToma.length > 0 && diasEntrega.length > 0 ? (
                <p className="text-xs text-[#2f6f4f]">
                  Con este calendario, la próxima entrega posible desde hoy es
                  en{' '}
                  <span className="font-bold">
                    {calcularDiasHastaEntrega(diasToma, diasEntrega, new Date()) ??
                      '—'}
                  </span>{' '}
                  día(s); ese valor reemplaza a la frecuencia en el punto de
                  reposición.
                </p>
              ) : (
                (diasToma.length > 0 || diasEntrega.length > 0) && (
                  <p className="text-xs text-[#a15c2f]">
                    Cargá las dos filas (toma de pedidos Y entrega) para que el
                    calendario se use; con una sola, sigue rigiendo la
                    frecuencia fija.
                  </p>
                )
              )}
            </div>
          </div>

          {/* Datos fiscales (AFIP) */}
          <div className="pt-3 border-t border-[#e4c9b0]/60 space-y-5">
            <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Datos fiscales (AFIP)
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cuit" className="text-[#391511] font-medium">
                  CUIT
                </Label>
                <Input
                  id="cuit"
                  inputMode="numeric"
                  {...register('cuit')}
                  placeholder="30711842884"
                  disabled={guardando}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
                />
                {errors.cuit && (
                  <p className="text-[#c43e2c] text-xs mt-1">
                    {errors.cuit.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="condicion_iva"
                  className="text-[#391511] font-medium"
                >
                  Condición IVA
                </Label>
                <select
                  id="condicion_iva"
                  {...register('condicion_iva')}
                  disabled={guardando}
                  className="w-full h-9 rounded-md border border-[#e4c9b0] bg-white px-3 text-sm text-[#391511] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] disabled:opacity-50"
                >
                  <option value="">Sin especificar</option>
                  {CONDICIONES_IVA.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="razon_social" className="text-[#391511] font-medium">
                Razón social
              </Label>
              <Input
                id="razon_social"
                {...register('razon_social')}
                placeholder="Como figura en la factura"
                disabled={guardando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              {errors.razon_social && (
                <p className="text-[#c43e2c] text-xs mt-1">
                  {errors.razon_social.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="domicilio" className="text-[#391511] font-medium">
                Domicilio fiscal
              </Label>
              <Input
                id="domicilio"
                {...register('domicilio')}
                placeholder="Calle, número, localidad"
                disabled={guardando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              {errors.domicilio && (
                <p className="text-[#c43e2c] text-xs mt-1">
                  {errors.domicilio.message}
                </p>
              )}
            </div>
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
