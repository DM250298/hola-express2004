'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { AlertTriangle, Loader2, Plus, ScanLine, Trash2 } from 'lucide-react'
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
import { usePricing } from '@/lib/hooks/usePricing'
import { SubirImagenProducto } from '@/components/productos/SubirImagenProducto'
import type { ProductoConRelaciones } from '@/lib/queries/productos'
import type { CostoAdicional, ProductoRow } from '@/types/database'

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
  codigo_barras_2: z.string().trim().max(50).optional().or(z.literal('')),
  codigo_interno: z.string().trim().max(50).optional().or(z.literal('')),
  marca: z.string().trim().max(100).optional().or(z.literal('')),
  subcategoria: z.string().trim().max(100).optional().or(z.literal('')),
  ubicacion: z.string().trim().max(100).optional().or(z.literal('')),
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
  visible_tienda: z.boolean().default(true),
  controlar_stock: z.boolean().default(true),
  no_ofrecer_ventas: z.boolean().default(false),
  notas: z.string().trim().max(500).optional().or(z.literal('')),
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
  /** Prefill del nombre para alta desde una sugerencia (solo si producto es null). */
  nombreInicial?: string
  /** Prefill del proveedor para alta desde una sugerencia (solo si producto es null). */
  proveedorIdInicial?: number | null
  /** Se llama con el producto recién creado (para vincularlo a la sugerencia). */
  onCreado?: (producto: ProductoRow) => void
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

export function DrawerProducto({
  abierto,
  onCambioAbierto,
  producto,
  nombreInicial,
  proveedorIdInicial,
  onCreado,
}: Props) {
  const esEdicion = producto !== null
  const crear = useCreateProducto()
  const actualizar = useUpdateProducto()
  const { data: categorias } = useCategorias()
  const { data: proveedores } = useProveedores()
  const pricing = usePricing()
  const refCodigoBarras = useRef<HTMLInputElement | null>(null)

  // ── Bloque de costo / precio (estado propio, fuera de react-hook-form) ──
  const [ivaCompra, setIvaCompra] = useState('21')
  const [costoBase, setCostoBase] = useState('')
  const [adicionales, setAdicionales] = useState<AdicionalState[]>([])
  const [ivaVenta, setIvaVenta] = useState('21')
  const [margen, setMargen] = useState('0')
  const [imagenUrl, setImagenUrl] = useState<string | null>(null)

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
      codigo_barras_2: '',
      codigo_interno: '',
      marca: '',
      subcategoria: '',
      ubicacion: '',
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
      visible_tienda: true,
      controlar_stock: true,
      no_ofrecer_ventas: false,
      notas: '',
    },
  })

  useEffect(() => {
    if (!abierto) return
    reset({
      codigo_barras: producto?.codigo_barras ?? '',
      codigo_barras_2: producto?.codigo_barras_2 ?? '',
      codigo_interno: producto?.codigo_interno ?? '',
      marca: producto?.marca ?? '',
      subcategoria: producto?.subcategoria ?? '',
      ubicacion: producto?.ubicacion ?? '',
      nombre: producto?.nombre ?? nombreInicial ?? '',
      categoria_id:
        producto?.categoria_id != null
          ? String(producto.categoria_id)
          : SIN_VALOR,
      proveedor_id:
        producto?.proveedor_id != null
          ? String(producto.proveedor_id)
          : proveedorIdInicial != null
            ? String(proveedorIdInicial)
            : SIN_VALOR,
      stock_actual: String(producto?.stock_actual ?? 0),
      stock_minimo: String(producto?.stock_minimo ?? 5),
      dias_vencimiento_minimo:
        producto?.dias_vencimiento_minimo != null
          ? String(producto.dias_vencimiento_minimo)
          : '',
      tipo: producto?.tipo ?? 'reventa',
      unidad: producto?.unidad ?? 'unidad',
      activo: producto?.activo ?? true,
      venta_por_peso: producto?.venta_por_peso ?? false,
      visible_tienda: producto?.visible_tienda ?? true,
      controlar_stock: producto?.controlar_stock ?? true,
      no_ofrecer_ventas: producto?.no_ofrecer_ventas ?? false,
      notas: producto?.notas ?? '',
    })

    // Bloque de costo / precio
    setIvaCompra(String(producto?.iva_compra ?? 21))
    setIvaVenta(String(producto?.iva_venta ?? 21))
    setMargen(String(producto?.margen ?? 0))
    setImagenUrl(producto?.imagen_url ?? null)
    const adic = (producto?.costos_adicionales ?? []) as CostoAdicional[]
    setAdicionales(
      adic.map((a) => ({ descripcion: a.descripcion, monto: String(a.monto) }))
    )
    // El costo base = precio_costo guardado menos los adicionales
    const sumaAdic = adic.reduce((s, a) => s + (Number(a.monto) || 0), 0)
    const base = (producto?.precio_costo ?? 0) - sumaAdic
    setCostoBase(producto ? String(r2(base)) : '')
  }, [abierto, producto, reset, nombreInicial, proveedorIdInicial])

  const guardando = crear.isPending || actualizar.isPending

  // ── Cálculos en vivo (motor de precios con margen asegurado) ──
  // El precio ya NO se calcula multiplicando (costo × (1+margen) × (1+iva)):
  // eso dejaba las cargas (IIBB, imp. créd/déb, comisión MP) fuera del precio,
  // erosionando el margen. El motor DIVIDE por (1 − cargas) para asegurar la
  // ganancia después de impuestos y comisiones. Ver lib/pricing.
  const calc = useMemo(() => {
    const sumaAdic = adicionales.reduce((s, a) => s + (Number(a.monto) || 0), 0)
    const costoNeto = (Number(costoBase) || 0) + sumaAdic
    const costoConIva = costoNeto * (1 + (Number(ivaCompra) || 0) / 100)
    // El Monotributista pricea sobre el costo CON IVA (no recupera crédito fiscal).
    const costoParaMotor =
      pricing.regimen === 'monotributista' ? costoConIva : costoNeto
    const { desglose, error } = pricing.calcular(
      costoParaMotor,
      Number(margen) || 0,
      Number(ivaVenta) || 0
    )
    return {
      sumaAdic,
      costoNeto,
      costoConIva,
      desglose,
      error,
      // Lo que se guarda como precio_venta: el precio comercial redondeado.
      precioVenta: desglose?.precioRedondeado ?? 0,
    }
  }, [adicionales, costoBase, ivaCompra, ivaVenta, margen, pricing])

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

    const limpiar = (v: string | undefined) => (v?.trim() ? v.trim() : null)
    const payload = {
      codigo_barras: limpiar(validado.codigo_barras),
      codigo_barras_2: limpiar(validado.codigo_barras_2),
      codigo_interno: limpiar(validado.codigo_interno),
      marca: limpiar(validado.marca),
      subcategoria: limpiar(validado.subcategoria),
      ubicacion: limpiar(validado.ubicacion),
      nombre: validado.nombre,
      categoria_id: validado.categoria_id,
      proveedor_id: validado.proveedor_id,
      precio_costo: r2(calc.costoNeto),
      precio_venta: r2(calc.precioVenta),
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
      visible_tienda: validado.visible_tienda,
      controlar_stock: validado.controlar_stock,
      no_ofrecer_ventas: validado.no_ofrecer_ventas,
      // Sin precio de venta cargado → queda "pendiente de precio": visible en
      // el POS pero bloqueado para vender hasta que se complete (factura o
      // carga manual). Con precio > 0 se habilita.
      pendiente_precio: r2(calc.precioVenta) <= 0,
      notas: validado.notas?.trim() ? validado.notas.trim() : null,
      imagen_url: imagenUrl,
    }

    try {
      if (esEdicion && producto) {
        await actualizar.mutateAsync({ id: producto.id, datos: payload })
      } else {
        const creado = await crear.mutateAsync(payload)
        onCreado?.(creado)
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
          {/* Aviso: producto pendiente de precio (alta al vuelo sin completar) */}
          {producto?.pendiente_precio && (
            <div className="flex items-start gap-2 rounded-xl border-2 border-[#c43e2c]/40 bg-[#c43e2c]/8 p-3">
              <AlertTriangle className="h-5 w-5 text-[#c43e2c] shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-[#c43e2c]">Pendiente de precio</p>
                <p className="text-[#391511] mt-0.5">
                  Este producto se creó sin precio y{' '}
                  <strong>no se puede vender</strong> todavía. Cargá el costo y
                  el precio de venta acá (o al cargar la factura) para
                  habilitarlo en el punto de venta.
                </p>
              </div>
            </div>
          )}

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

          {/* Imagen */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">Imagen del producto</Label>
            <SubirImagenProducto
              value={imagenUrl}
              onChange={setImagenUrl}
              disabled={guardando}
            />
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

          {/* ── Datos de catálogo ── */}
          <div className="rounded-xl border border-[#e4c9b0]/60 p-4 space-y-3">
            <h3 className="text-[#391511] font-bold text-sm">Datos de catálogo</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="marca" className="text-[#391511] font-medium">
                  Marca
                </Label>
                <Input
                  id="marca"
                  {...register('marca')}
                  placeholder="Ej: Coca-Cola"
                  disabled={guardando}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ubicacion" className="text-[#391511] font-medium">
                  Ubicación
                </Label>
                <Input
                  id="ubicacion"
                  {...register('ubicacion')}
                  placeholder="Ej: Góndola 3 / Heladera 2"
                  disabled={guardando}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subcategoria" className="text-[#391511] font-medium">
                  Subcategoría
                </Label>
                <Input
                  id="subcategoria"
                  {...register('subcategoria')}
                  placeholder="Opcional"
                  disabled={guardando}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="codigo_interno" className="text-[#391511] font-medium">
                  Código interno
                </Label>
                <Input
                  id="codigo_interno"
                  {...register('codigo_interno')}
                  placeholder="Opcional"
                  disabled={guardando}
                  className="font-mono border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="codigo_barras_2" className="text-[#391511] font-medium">
                  Código de barras secundario
                </Label>
                <Input
                  id="codigo_barras_2"
                  {...register('codigo_barras_2')}
                  placeholder="EAN del fabricante, si difiere del código principal"
                  disabled={guardando}
                  className="font-mono border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
                <p className="text-[11px] text-[#c8a58a]">
                  También se reconoce al escanear en el POS.
                </p>
              </div>
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

          {/* ── Precio de venta (motor con margen asegurado) ── */}
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

            {/* Resultado del motor: precio que asegura el margen tras las cargas */}
            {pricing.cargando ? (
              <p className="text-xs text-[#c8a58a]">
                Cargando configuración de precios…
              </p>
            ) : calc.error ? (
              <div className="flex items-start gap-2 rounded-lg border-2 border-[#c43e2c]/40 bg-[#c43e2c]/8 p-3">
                <AlertTriangle className="h-4 w-4 text-[#c43e2c] shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-bold text-[#c43e2c]">
                    No se puede calcular el precio
                  </p>
                  <p className="text-[#391511] mt-0.5">{calc.error}</p>
                </div>
              </div>
            ) : calc.desglose && calc.precioVenta > 0 ? (
              <>
                <div className="flex items-end justify-between rounded-lg border border-[#e4c9b0]/60 bg-white px-3 py-2">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      Precio de venta (redondeado)
                    </span>
                    <div className="font-extrabold text-[#391511] text-xl tabular-nums">
                      <MontoARS monto={calc.desglose.precioRedondeado} />
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                      Exacto
                    </span>
                    <div className="text-sm text-[#6f3a2a] tabular-nums">
                      <MontoARS monto={calc.desglose.precioFinalExacto} />
                    </div>
                  </div>
                </div>

                <ul className="text-xs text-[#6f3a2a] space-y-1">
                  <li className="flex justify-between">
                    <span>Costo</span>
                    <MontoARS monto={calc.desglose.costo} />
                  </li>
                  <li className="flex justify-between">
                    <span>Ganancia asegurada</span>
                    <MontoARS monto={calc.desglose.ganancia} />
                  </li>
                  <li className="flex justify-between">
                    <span>IIBB</span>
                    <MontoARS monto={calc.desglose.iibbMonto} />
                  </li>
                  <li className="flex justify-between">
                    <span>Imp. créd/déb</span>
                    <MontoARS monto={calc.desglose.debcredMonto} />
                  </li>
                  <li className="flex justify-between">
                    <span>Comisión MP (peor caso)</span>
                    <MontoARS monto={calc.desglose.comisionMonto} />
                  </li>
                  <li className="flex justify-between text-[#c8a58a]">
                    <span>Margen extra por redondeo</span>
                    <MontoARS monto={calc.desglose.margenExtraRedondeo} />
                  </li>
                </ul>
                <p className="text-[10px] text-[#c8a58a] leading-relaxed">
                  El precio incluye IIBB, impuesto a los créditos/débitos y la
                  comisión de Mercado Pago del peor caso, tomados de la config
                  fiscal y de los medios de pago. Cambiá esas tasas y el precio
                  se recalcula solo.
                </p>
              </>
            ) : (
              <p className="text-xs text-[#c8a58a]">
                Cargá el costo y el margen para ver el precio de venta.
              </p>
            )}
          </div>

          {/* Tipo y Unidad */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tipo" className="text-[#391511] font-medium">
                Tipo
              </Label>
              <select
                id="tipo"
                {...register('tipo')}
                disabled={guardando}
                className="w-full h-9 rounded-lg border border-[#e4c9b0] bg-white px-3 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c] disabled:opacity-50"
              >
                <option value="reventa">Reventa (compra-venta)</option>
                <option value="insumo">Insumo (ingrediente)</option>
                <option value="semi_elaborado">Semi-elaborado</option>
                <option value="elaborado">Elaborado (se vende hecho)</option>
                {producto?.tipo &&
                  !['reventa', 'insumo', 'semi_elaborado', 'elaborado'].includes(
                    producto.tipo
                  ) && (
                    <option value={producto.tipo}>{producto.tipo} (actual)</option>
                  )}
              </select>
              {errors.tipo && (
                <p className="text-[#c43e2c] text-xs mt-1">{errors.tipo.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unidad" className="text-[#391511] font-medium">
                Unidad
              </Label>
              <select
                id="unidad"
                {...register('unidad')}
                disabled={guardando}
                className="w-full h-9 rounded-lg border border-[#e4c9b0] bg-white px-3 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c] disabled:opacity-50"
              >
                <option value="unidad">Unidad (por pieza)</option>
                <option value="kg">Kilogramo (kg)</option>
                <option value="g">Gramo (g)</option>
                <option value="lt">Litro (lt)</option>
                <option value="ml">Mililitro (ml)</option>
                {producto?.unidad &&
                  !['unidad', 'kg', 'g', 'lt', 'ml'].includes(producto.unidad) && (
                    <option value={producto.unidad}>{producto.unidad} (actual)</option>
                  )}
              </select>
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

          {/* Notas */}
          <div className="space-y-1.5">
            <Label htmlFor="notas" className="text-[#391511] font-medium">
              Notas
            </Label>
            <textarea
              id="notas"
              rows={2}
              {...register('notas')}
              disabled={guardando}
              placeholder="Observaciones internas (opcional)"
              className="w-full rounded-md border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] disabled:opacity-50"
            />
          </div>

          {/* Toggle visible en tienda */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60">
            <div>
              <Label htmlFor="visible_tienda" className="text-[#391511] font-medium cursor-pointer">
                Visible en la tienda online
              </Label>
              <p className="text-[#6f3a2a] text-xs mt-0.5">
                Si lo apagás, no aparece en la tienda web (sí en el POS).
              </p>
            </div>
            <Controller
              control={control}
              name="visible_tienda"
              render={({ field }) => (
                <Switch
                  id="visible_tienda"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={guardando}
                  className="data-[state=checked]:bg-[#f9b44c]"
                />
              )}
            />
          </div>

          {/* Toggle controlar stock */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60">
            <div>
              <Label htmlFor="controlar_stock" className="text-[#391511] font-medium cursor-pointer">
                Controlar stock
              </Label>
              <p className="text-[#6f3a2a] text-xs mt-0.5">
                Si lo apagás, se vende sin descontar stock (servicios, granel sin control).
              </p>
            </div>
            <Controller
              control={control}
              name="controlar_stock"
              render={({ field }) => (
                <Switch
                  id="controlar_stock"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={guardando}
                  className="data-[state=checked]:bg-[#f9b44c]"
                />
              )}
            />
          </div>

          {/* Toggle no ofrecer en ventas */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60">
            <div>
              <Label htmlFor="no_ofrecer_ventas" className="text-[#391511] font-medium cursor-pointer">
                No ofrecer en ventas
              </Label>
              <p className="text-[#6f3a2a] text-xs mt-0.5">
                Lo oculta del punto de venta (no se puede vender), pero sigue en el stock.
              </p>
            </div>
            <Controller
              control={control}
              name="no_ofrecer_ventas"
              render={({ field }) => (
                <Switch
                  id="no_ofrecer_ventas"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={guardando}
                  className="data-[state=checked]:bg-[#c43e2c]"
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
