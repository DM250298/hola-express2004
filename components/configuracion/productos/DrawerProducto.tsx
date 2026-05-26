'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Plus, ScanLine, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  useCreateProducto,
  useUpdateProducto,
} from '@/lib/hooks/useProductos'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { useProveedores } from '@/lib/hooks/useProveedores'
import type { ProductoConRelaciones } from '@/lib/queries/productos'
import type { CostoAdicional } from '@/types/database'

const SIN_VALOR = '__sin_valor__'
const r2 = (n: number) => Math.round(n * 100) / 100

const transformarIdOpcional = (v: unknown) => {
  if (v === SIN_VALOR || v === '' || v === undefined || v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const esquemaProducto = z.object({
  codigo_barras: z
    .string()
    .trim()
    .max(50, 'Máximo 50 caracteres')
    .optional()
    .or(z.literal('')),
  nombre: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(200, 'Máximo 200 caracteres'),
  categoria_id: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform(transformarIdOpcional)
    .pipe(z.number().int().positive().nullable()),
  proveedor_id: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform(transformarIdOpcional)
    .pipe(z.number().int().positive().nullable()),
  stock_actual: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().int('Solo enteros').min(0, 'No puede ser negativo')),
  stock_minimo: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().int('Solo enteros').min(0, 'No puede ser negativo')),
  venta_por_peso: z.boolean().default(false),
  dias_vencimiento_minimo: z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => {
      if (v == null || v === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    })
    .pipe(
      z.number().int('Solo enteros').min(0, 'No puede ser negativo').nullable()
    ),
  tipo: z.string().trim().min(1, 'Requerido'),
  unidad: z.string().trim().min(1, 'Requerido'),
  activo: z.boolean(),
})

type EntradaFormulario = z.input<typeof esquemaProducto>

interface Props {
  abierto: boolean
  onCambioAbierto: (abierto: boolean) => void
  producto: ProductoConRelaciones | null
}

interface AdicionalState {
  descripcion: string
  monto: string
}

function generarCodigoBarrasSimulado(): string {
  let codigo = ''
  for (let i = 0; i < 13; i++) {
    codigo += Math.floor(Math.random() * 10).toString()
  }
  return codigo
}

export function DrawerProducto({ abierto, onCambioAbierto, producto }: Props) {
  const esEdicion = producto !== null
  const crear = useCreateProducto()
  const actualizar = useUpdateProducto()
  const { data: categorias } = useCategorias()
  const { data: proveedores } = useProveedores()
  const refCodigoBarras = useRef<HTMLInputElement | null>(null)

  // ── Bloque de costo / precio (estado propio, fuera de react-hook-form) ──
  const [ivaCompra, setIvaCompra] = useState('21')
  const [costoBase, setCostoBase] = useState('')
  const [adicionales, setAdicionales] = useState<AdicionalState[]>([])
  const [ivaVenta, setIvaVenta] = useState('21')
  const [margen, setMargen] = useState('0')

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<EntradaFormulario>({
    resolver: zodResolver(esquemaProducto),
    defaultValues: {
      codigo_barras: '',
      nombre: '',
      categoria_id: SIN_VALOR,
      proveedor_id: SIN_VALOR,
      stock_actual: '0',
      stock_minimo: '5',
      dias_vencimiento_minimo: '',
      tipo: 'simple',
      unidad: 'unidad',
      activo: true,
      venta_por_peso: false,
    },
  })

  useEffect(() => {
    if (!abierto) return
    reset({
      codigo_barras: producto?.codigo_barras ?? '',
      nombre: producto?.nombre ?? '',
      categoria_id:
        producto?.categoria_id != null
          ? String(producto.categoria_id)
          : SIN_VALOR,
      proveedor_id:
        producto?.proveedor_id != null
          ? String(producto.proveedor_id)
          : SIN_VALOR,
      stock_actual: String(producto?.stock_actual ?? 0),
      stock_minimo: String(producto?.stock_minimo ?? 5),
      dias_vencimiento_minimo:
        producto?.dias_vencimiento_minimo != null
          ? String(producto.dias_vencimiento_minimo)
          : '',
      tipo: producto?.tipo ?? 'simple',
      unidad: producto?.unidad ?? 'unidad',
      activo: producto?.activo ?? true,
      venta_por_peso: producto?.venta_por_peso ?? false,
    })

    // Bloque de costo / precio
    setIvaCompra(String(producto?.iva_compra ?? 21))
    setIvaVenta(String(producto?.iva_venta ?? 21))
    setMargen(String(producto?.margen ?? 0))
    const adic = (producto?.costos_adicionales ?? []) as CostoAdicional[]
    setAdicionales(
      adic.map((a) => ({ descripcion: a.descripcion, monto: String(a.monto) }))
    )
    // El costo base = precio_costo guardado menos los adicionales
    const sumaAdic = adic.reduce((s, a) => s + (Number(a.monto) || 0), 0)
    const base = (producto?.precio_costo ?? 0) - sumaAdic
    setCostoBase(producto ? String(r2(base)) : '')
  }, [abierto, producto, reset])

  const guardando = crear.isPending || actualizar.isPending

  // ── Cálculos en vivo ──
  const calc = useMemo(() => {
    const sumaAdic = adicionales.reduce(
      (s, a) => s + (Number(a.monto) || 0),
      0
    )
    const costoNeto = (Number(costoBase) || 0) + sumaAdic
    const costoConIva = costoNeto * (1 + (Number(ivaCompra) || 0) / 100)
    const precioSinIva = costoNeto * (1 + (Number(margen) || 0) / 100)
    const precioConIva = precioSinIva * (1 + (Number(ivaVenta) || 0) / 100)
    return { sumaAdic, costoNeto, costoConIva, precioSinIva, precioConIva }
  }, [adicionales, costoBase, ivaCompra, margen, ivaVenta])

  function simularEscaneo() {
    const codigo = generarCodigoBarrasSimulado()
    setValue('codigo_barras', codigo, { shouldValidate: true, shouldDirty: true })
    refCodigoBarras.current?.focus()
  }

  function agregarAdicional() {
    setAdicionales((prev) => [...prev, { descripcion: '', monto: '' }])
  }
  function cambiarAdicional(
    idx: number,
    campo: keyof AdicionalState,
    valor: string
  ) {
    setAdicionales((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, [campo]: valor } : a))
    )
  }
  function quitarAdicional(idx: number) {
    setAdicionales((prev) => prev.filter((_, i) => i !== idx))
  }

  async function onSubmit(datos: EntradaFormulario) {
    const validado = esquemaProducto.parse(datos)
    const costosAdicionales: CostoAdicional[] = adicionales
      .filter((a) => a.descripcion.trim() !== '' || Number(a.monto) > 0)
      .map((a) => ({
        descripcion: a.descripcion.trim(),
        monto: r2(Number(a.monto) || 0),
      }))

    const payload = {
      codigo_barras: validado.codigo_barras?.trim()
        ? validado.codigo_barras
        : null,
      nombre: validado.nombre,
      categoria_id: validado.categoria_id,
      proveedor_id: validado.proveedor_id,
      precio_costo: r2(calc.costoNeto),
      precio_venta: r2(calc.precioConIva),
      iva_compra: Number(ivaCompra) || 0,
      iva_venta: Number(ivaVenta) || 0,
      margen: Number(margen) || 0,
      costos_adicionales: costosAdicionales,
      stock_actual: validado.stock_actual,
      stock_minimo: validado.stock_minimo,
      dias_vencimiento_minimo: validado.dias_vencimiento_minimo,
      tipo: validado.tipo,
      unidad: validado.unidad,
      activo: validado.activo,
      venta_por_peso: validado.venta_por_peso,
    }

    try {
      if (esEdicion && producto) {
        await actualizar.mutateAsync({ id: producto.id, datos: payload })
      } else {
        await crear.mutateAsync(payload)
      }
      onCambioAbierto(false)
    } catch {
      // toast manejado en el hook
    }
  }

  const codigoBarrasReg = register('codigo_barras')

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent
        side="right"
        className="sm:max-w-lg w-full flex flex-col p-0"
      >
        <SheetHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] text-lg">
            {esEdicion ? 'Editar producto' : 'Nuevo producto'}
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a] text-sm">
            {esEdicion
              ? `Actualizá los datos de "${producto?.nombre}".`
              : 'Completá los datos. Los campos con * son obligatorios.'}
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex-1 overflow-y-auto px-6 py-5 space-y-5"
        >
          {/* Código de barras + escáner */}
          <div className="space-y-1.5">
            <Label htmlFor="codigo_barras" className="text-[#391511] font-medium">
              Código de barras
            </Label>
            <div className="flex gap-2">
              <Input
                id="codigo_barras"
                {...codigoBarrasReg}
                ref={(el) => {
                  codigoBarrasReg.ref(el)
                  refCodigoBarras.current = el
                }}
                placeholder="Escaneá o ingresá manualmente"
                disabled={guardando}
                className="font-mono border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              <Button
                type="button"
                variant="outline"
                onClick={simularEscaneo}
                disabled={guardando}
                title="Simular escaneo"
                className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1.5 shrink-0"
              >
                <ScanLine className="h-4 w-4" />
                <span className="hidden sm:inline">Escanear</span>
              </Button>
            </div>
            {errors.codigo_barras && (
              <p className="text-[#c43e2c] text-xs mt-1">
                {errors.codigo_barras.message}
              </p>
            )}
          </div>

          {/* Nombre */}
          <div className="space-y-1.5">
            <Label htmlFor="nombre" className="text-[#391511] font-medium">
              Nombre <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="nombre"
              {...register('nombre')}
              placeholder="Ej: Coca-Cola 500ml"
              disabled={guardando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            {errors.nombre && (
              <p className="text-[#c43e2c] text-xs mt-1">{errors.nombre.message}</p>
            )}
          </div>

          {/* Categoría + Proveedor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium">Categoría</Label>
              <Controller
                control={control}
                name="categoria_id"
                render={({ field }) => (
                  <Select
                    value={
                      field.value === null || field.value === undefined
                        ? SIN_VALOR
                        : String(field.value)
                    }
                    onValueChange={field.onChange}
                    disabled={guardando}
                  >
                    <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SIN_VALOR}>
                        <span className="text-[#c8a58a] italic">Sin categoría</span>
                      </SelectItem>
                      {categorias?.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium">Proveedor</Label>
              <Controller
                control={control}
                name="proveedor_id"
                render={({ field }) => (
                  <Select
                    value={
                      field.value === null || field.value === undefined
                        ? SIN_VALOR
                        : String(field.value)
                    }
                    onValueChange={field.onChange}
                    disabled={guardando}
                  >
                    <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                      <SelectValue placeholder="Seleccionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SIN_VALOR}>
                        <span className="text-[#c8a58a] italic">Sin proveedor</span>
                      </SelectItem>
                      {proveedores?.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          {/* ── Costo de compra ── */}
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-4 space-y-3">
            <h3 className="text-[#391511] font-bold text-sm">Costo de compra</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  IVA compra %
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={ivaCompra}
                  onChange={(e) => setIvaCompra(e.target.value)}
                  disabled={guardando}
                  className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Costo sin IVA <span className="text-[#c43e2c]">*</span>
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costoBase}
                  onChange={(e) => setCostoBase(e.target.value)}
                  placeholder="0.00"
                  disabled={guardando}
                  className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Costo neto (con adicionales)
                </span>
                <div className="font-bold text-[#391511] tabular-nums">
                  <MontoARS monto={calc.costoNeto} />
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Costo con IVA
                </span>
                <div className="font-bold text-[#391511] tabular-nums">
                  <MontoARS monto={calc.costoConIva} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Costos adicionales ── */}
          <div className="rounded-xl border border-[#e4c9b0]/60 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[#391511] font-bold text-sm">
                Costos adicionales
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={agregarAdicional}
                disabled={guardando}
                className="h-7 gap-1 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar
              </Button>
            </div>
            {adicionales.length === 0 ? (
              <p className="text-xs text-[#c8a58a]">
                Flete, embalaje, impuestos internos, etc. (opcional)
              </p>
            ) : (
              <ul className="space-y-2">
                {adicionales.map((a, idx) => (
                  <li key={idx} className="flex items-center gap-2">
                    <Input
                      value={a.descripcion}
                      onChange={(e) =>
                        cambiarAdicional(idx, 'descripcion', e.target.value)
                      }
                      placeholder="Descripción"
                      disabled={guardando}
                      className="flex-1 h-8 border-[#e4c9b0] text-sm"
                    />
                    <div className="relative w-28">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#c8a58a] text-xs">
                        $
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={a.monto}
                        onChange={(e) =>
                          cambiarAdicional(idx, 'monto', e.target.value)
                        }
                        placeholder="0.00"
                        disabled={guardando}
                        className="h-8 pl-5 text-right tabular-nums border-[#e4c9b0]"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => quitarAdicional(idx)}
                      disabled={guardando}
                      className="h-8 w-8 p-0 text-[#c8a58a] hover:text-[#c43e2c]"
                      aria-label="Quitar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ── Precio de venta ── */}
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-4 space-y-3">
            <h3 className="text-[#391511] font-bold text-sm">Precio de venta</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  IVA venta %
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  value={ivaVenta}
                  onChange={(e) => setIvaVenta(e.target.value)}
                  disabled={guardando}
                  className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Margen ganancia %
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={margen}
                  onChange={(e) => setMargen(e.target.value)}
                  disabled={guardando}
                  className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Precio sin IVA
                </span>
                <div className="font-bold text-[#391511] tabular-nums">
                  <MontoARS monto={calc.precioSinIva} />
                </div>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Precio con IVA (venta)
                </span>
                <div className="font-extrabold text-[#391511] text-base tabular-nums">
                  <MontoARS monto={calc.precioConIva} />
                </div>
              </div>
            </div>
          </div>

          {/* Tipo y Unidad */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tipo" className="text-[#391511] font-medium">
                Tipo
              </Label>
              <Input
                id="tipo"
                list="opciones-tipo"
                {...register('tipo')}
                placeholder="simple"
                disabled={guardando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              <datalist id="opciones-tipo">
                <option value="simple" />
                <option value="combo" />
                <option value="variante" />
              </datalist>
              {errors.tipo && (
                <p className="text-[#c43e2c] text-xs mt-1">{errors.tipo.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unidad" className="text-[#391511] font-medium">
                Unidad
              </Label>
              <Input
                id="unidad"
                list="opciones-unidad"
                {...register('unidad')}
                placeholder="unidad"
                disabled={guardando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              <datalist id="opciones-unidad">
                <option value="unidad" />
                <option value="kg" />
                <option value="g" />
                <option value="lt" />
                <option value="ml" />
                <option value="docena" />
                <option value="caja" />
              </datalist>
              {errors.unidad && (
                <p className="text-[#c43e2c] text-xs mt-1">{errors.unidad.message}</p>
              )}
            </div>
          </div>

          {/* Stock */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="stock_actual" className="text-[#391511] font-medium">
                Stock actual
              </Label>
              <Input
                id="stock_actual"
                type="number"
                min="0"
                step="1"
                {...register('stock_actual')}
                disabled={guardando}
                className="tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              {errors.stock_actual && (
                <p className="text-[#c43e2c] text-xs mt-1">
                  {errors.stock_actual.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stock_minimo" className="text-[#391511] font-medium">
                Stock mínimo
              </Label>
              <Input
                id="stock_minimo"
                type="number"
                min="0"
                step="1"
                {...register('stock_minimo')}
                disabled={guardando}
                className="tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
              {errors.stock_minimo && (
                <p className="text-[#c43e2c] text-xs mt-1">
                  {errors.stock_minimo.message}
                </p>
              )}
            </div>
          </div>

          {/* Vencimiento mínimo al recibir */}
          <div className="space-y-1.5">
            <Label
              htmlFor="dias_vencimiento_minimo"
              className="text-[#391511] font-medium"
            >
              Vencimiento mínimo al recibir (días)
            </Label>
            <Input
              id="dias_vencimiento_minimo"
              type="number"
              min="0"
              step="1"
              placeholder="Sin mínimo"
              {...register('dias_vencimiento_minimo')}
              disabled={guardando}
              className="tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
            <p className="text-[11px] text-[#c8a58a]">
              Si lo definís, al recibir el producto se alerta cuando la fecha
              de vencimiento esté por debajo de este margen. Dejalo en blanco
              para no validar.
            </p>
            {errors.dias_vencimiento_minimo && (
              <p className="text-[#c43e2c] text-xs">
                {errors.dias_vencimiento_minimo.message}
              </p>
            )}
          </div>

          {/* Toggle venta por peso */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60">
            <div>
              <Label htmlFor="venta_por_peso" className="text-[#391511] font-medium cursor-pointer">
                Venta por kg
              </Label>
              <p className="text-[#6f3a2a] text-xs mt-0.5">
                En el POS se ingresa el peso en lugar de la cantidad. El precio es por kg.
              </p>
            </div>
            <Controller
              control={control}
              name="venta_por_peso"
              render={({ field }) => (
                <Switch
                  id="venta_por_peso"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={guardando}
                  className="data-[state=checked]:bg-[#f9b44c]"
                />
              )}
            />
          </div>

          {/* Toggle activo */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60">
            <div>
              <Label htmlFor="activo" className="text-[#391511] font-medium cursor-pointer">
                Producto activo
              </Label>
              <p className="text-[#6f3a2a] text-xs mt-0.5">
                Los inactivos no aparecen en el POS.
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
                  disabled={guardando}
                  className="data-[state=checked]:bg-[#f9b44c]"
                />
              )}
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
              'Crear producto'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
