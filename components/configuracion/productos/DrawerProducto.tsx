'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Boxes,
  Gift,
  Layers,
  Loader2,
  Package,
  Plus,
  Receipt,
  ScanLine,
  Search,
  Settings2,
  StickyNote,
  Tags,
  Trash2,
  TrendingUp,
} from 'lucide-react'
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
  useBuscarProductos,
  useComponentesCombo,
  useCreateProducto,
  useGuardarComponentesCombo,
  useUpdateProducto,
} from '@/lib/hooks/useProductos'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { usePricing } from '@/lib/hooks/usePricing'
import { SubirImagenProducto } from '@/components/productos/SubirImagenProducto'
import { stockVirtualCombo } from '@/lib/queries/productos'
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

const OPCIONES_VENTA: {
  campo:
    | 'venta_por_peso'
    | 'visible_tienda'
    | 'controlar_stock'
    | 'no_ofrecer_ventas'
    | 'activo'
  etiqueta: string
  descripcion: string
  destructivo?: boolean
}[] = [
  {
    campo: 'venta_por_peso',
    etiqueta: 'Venta por kg',
    descripcion:
      'En el POS se ingresa el peso en lugar de la cantidad. El precio es por kg.',
  },
  {
    campo: 'visible_tienda',
    etiqueta: 'Visible en la tienda online',
    descripcion: 'Si lo apagás, no aparece en la tienda web (sí en el POS).',
  },
  {
    campo: 'controlar_stock',
    etiqueta: 'Controlar stock',
    descripcion:
      'Si lo apagás, se vende sin descontar stock (servicios, granel sin control).',
  },
  {
    campo: 'no_ofrecer_ventas',
    etiqueta: 'No ofrecer en ventas',
    descripcion:
      'Lo oculta del punto de venta (no se puede vender), pero sigue en el stock.',
    destructivo: true,
  },
  {
    campo: 'activo',
    etiqueta: 'Producto activo',
    descripcion: 'Los inactivos no aparecen en el POS.',
  },
]

function generarCodigoBarrasSimulado(): string {
  let codigo = ''
  for (let i = 0; i < 13; i++) {
    codigo += Math.floor(Math.random() * 10).toString()
  }
  return codigo
}

/** Componente elegido para el combo (cantidad editable como string). */
interface ComponenteSel {
  componente_id: number
  nombre: string
  unidad: string
  cantidad: string
  precio_costo: number
  stock_actual: number
  controlar_stock: boolean | null
}

/** Buscador de productos para armar el combo (excluye combos y ya agregados). */
function BuscadorComponente({
  excluidos,
  productoId,
  disabled,
  onSeleccionar,
}: {
  excluidos: number[]
  productoId: number | null
  disabled: boolean
  onSeleccionar: (p: ProductoConRelaciones) => void
}) {
  const [input, setInput] = useState('')
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(input.trim()), 250)
    return () => clearTimeout(t)
  }, [input])

  const { data: productos, isLoading } = useBuscarProductos(busqueda)

  const resultados = (busqueda.length >= 2 ? (productos ?? []) : [])
    .filter(
      (p) =>
        p.tipo !== 'combo' && // un combo no puede contener otro combo
        p.id !== productoId &&
        !excluidos.includes(p.id)
    )
    .slice(0, 8)

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a] pointer-events-none" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Buscar producto por nombre o código…"
          disabled={disabled}
          className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
          autoComplete="off"
        />
      </div>

      {busqueda.length >= 2 && (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-xl overflow-hidden shadow-sm max-h-[220px] overflow-y-auto">
          {isLoading ? (
            <div className="p-3 flex items-center justify-center gap-2 text-[#6f3a2a] text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Buscando…
            </div>
          ) : resultados.length === 0 ? (
            <div className="p-3 text-center text-[#6f3a2a] text-sm">
              Sin resultados.
            </div>
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {resultados.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSeleccionar(p)
                      setInput('')
                    }}
                    className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left transition-colors hover:bg-[#fdfaf6]"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[#391511] truncate text-sm">
                        {p.nombre}
                      </div>
                      <div className="text-xs text-[#c8a58a] mt-0.5">
                        Stock {p.stock_actual} {p.unidad}
                        {p.precio_costo > 0 && (
                          <>
                            {' · costo '}
                            <MontoARS monto={p.precio_costo} />
                          </>
                        )}
                      </div>
                    </div>
                    <Plus className="h-4 w-4 text-[#e4a42a] shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
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
  const guardarComponentes = useGuardarComponentesCombo()
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

  // ── Combo: componentes elegidos ──
  const [componentesSel, setComponentesSel] = useState<ComponenteSel[]>([])
  // Evita que un refetch pise lo que el usuario editó con el drawer abierto.
  const refComponentesCargados = useRef(false)

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

  // Tipo elegido en vivo (para mostrar/ocultar la sección de combo).
  const tipoSel = useWatch({ control, name: 'tipo' })
  const esCombo = tipoSel === 'combo'

  // Componentes guardados del combo (solo al editar un combo existente).
  const { data: componentesGuardados } = useComponentesCombo(
    producto?.id ?? null,
    abierto && esEdicion && producto?.tipo === 'combo'
  )

  useEffect(() => {
    if (abierto) refComponentesCargados.current = false
  }, [abierto, producto])

  useEffect(() => {
    if (!abierto || refComponentesCargados.current) return
    // Alta nueva o producto que no es combo: arranca sin componentes.
    if (!esEdicion || producto?.tipo !== 'combo') {
      setComponentesSel([])
      refComponentesCargados.current = true
      return
    }
    if (componentesGuardados) {
      setComponentesSel(
        componentesGuardados.map((c) => ({
          componente_id: c.componente_id,
          nombre: c.nombre,
          unidad: c.unidad,
          cantidad: String(c.cantidad),
          precio_costo: c.precio_costo,
          stock_actual: c.stock_actual,
          controlar_stock: c.controlar_stock,
        }))
      )
      refComponentesCargados.current = true
    }
  }, [abierto, esEdicion, producto, componentesGuardados])

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

  const guardando =
    crear.isPending || actualizar.isPending || guardarComponentes.isPending

  // ── Combo: costo y stock derivados de los componentes ──
  const costoComponentes = useMemo(
    () =>
      componentesSel.reduce(
        (s, c) => s + (Number(c.cantidad) || 0) * c.precio_costo,
        0
      ),
    [componentesSel]
  )
  const stockArmable = useMemo(
    () =>
      stockVirtualCombo(
        componentesSel.map((c) => ({
          componente_id: c.componente_id,
          cantidad: Number(c.cantidad) || 0,
          nombre: c.nombre,
          unidad: c.unidad,
          stock_actual: c.stock_actual,
          controlar_stock: c.controlar_stock,
          precio_costo: c.precio_costo,
        }))
      ),
    [componentesSel]
  )

  // ── Cálculos en vivo (motor de precios con margen asegurado) ──
  // El precio ya NO se calcula multiplicando (costo × (1+margen) × (1+iva)):
  // eso dejaba las cargas (IIBB, imp. créd/déb, comisión MP) fuera del precio,
  // erosionando el margen. El motor DIVIDE por (1 − cargas) para asegurar la
  // ganancia después de impuestos y comisiones. Ver lib/pricing.
  // Para un combo, el costo base es la suma de los componentes.
  const calc = useMemo(() => {
    const sumaAdic = adicionales.reduce((s, a) => s + (Number(a.monto) || 0), 0)
    const base = esCombo ? costoComponentes : Number(costoBase) || 0
    const costoNeto = base + sumaAdic
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
  }, [adicionales, costoBase, ivaCompra, ivaVenta, margen, pricing, esCombo, costoComponentes])

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

  function agregarComponente(p: ProductoConRelaciones) {
    setComponentesSel((prev) => [
      ...prev,
      {
        componente_id: p.id,
        nombre: p.nombre,
        unidad: p.unidad,
        cantidad: '1',
        precio_costo: p.precio_costo ?? 0,
        stock_actual: p.stock_actual,
        controlar_stock: p.controlar_stock,
      },
    ])
  }
  function cambiarCantidadComponente(id: number, valor: string) {
    setComponentesSel((prev) =>
      prev.map((c) => (c.componente_id === id ? { ...c, cantidad: valor } : c))
    )
  }
  function quitarComponente(id: number) {
    setComponentesSel((prev) => prev.filter((c) => c.componente_id !== id))
  }

  async function onSubmit(datos: EntradaFormulario) {
    const validado = esquemaProducto.parse(datos)
    const esComboFinal = validado.tipo === 'combo'
    const componentesLimpios = componentesSel
      .map((c) => ({
        componente_id: c.componente_id,
        cantidad: Number(c.cantidad) || 0,
      }))
      .filter((c) => c.cantidad > 0)
    if (esComboFinal && componentesLimpios.length === 0) {
      toast.error(
        'Un combo necesita al menos un componente con cantidad mayor a 0.'
      )
      return
    }

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
      // Un combo no maneja stock propio: el stock sale de los componentes
      // (el "stock" que se ve es el virtual, calculado en las queries).
      stock_actual: esComboFinal ? 0 : validado.stock_actual,
      stock_minimo: esComboFinal ? 0 : validado.stock_minimo,
      dias_vencimiento_minimo: esComboFinal
        ? null
        : validado.dias_vencimiento_minimo,
      tipo: validado.tipo,
      unidad: validado.unidad,
      activo: validado.activo,
      venta_por_peso: esComboFinal ? false : validado.venta_por_peso,
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
        // Guarda la composición si es combo, o la limpia si dejó de serlo.
        if (esComboFinal || producto.tipo === 'combo') {
          await guardarComponentes.mutateAsync({
            productoId: producto.id,
            componentes: esComboFinal ? componentesLimpios : [],
          })
        }
      } else {
        const creado = await crear.mutateAsync(payload)
        if (esComboFinal) {
          await guardarComponentes.mutateAsync({
            productoId: creado.id,
            componentes: componentesLimpios,
          })
        }
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
      {/* En desktop el drawer ocupa casi toda la pantalla (97vw) y el
          formulario se reparte en 3 columnas temáticas; en mobile sigue
          siendo full-width de una columna. El max-w se declara con la misma
          cadena de variantes que el default del Sheet (data-[side=right]:sm:)
          para pisarlo. */}
      <SheetContent
        side="right"
        className="w-full data-[side=right]:w-full data-[side=right]:sm:max-w-[min(1800px,97vw)] flex flex-col gap-0 p-0"
      >
        <SheetHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
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

          {/* ── Componentes del combo (ancho completo, estilo planilla) ── */}
          {esCombo && (
            <div className="rounded-xl border-2 border-[#f9b44c]/50 bg-[#fdfaf6] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                    <Gift className="h-4 w-4 text-[#e4a42a]" />
                    Componentes del combo
                    {componentesSel.length > 0 && (
                      <span className="text-xs font-semibold text-[#6f3a2a]">
                        ({componentesSel.length})
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-[#6f3a2a] mt-0.5">
                    Al vender el combo, el stock se descuenta de estos
                    productos (no del combo).
                  </p>
                </div>
                {componentesSel.length > 0 && (
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="block text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                        Stock armable
                      </span>
                      <span className="font-extrabold text-[#391511] tabular-nums">
                        {stockArmable}
                      </span>
                    </div>
                    <div className="h-8 w-px bg-[#e4c9b0]/60" />
                    <div className="text-right">
                      <span className="block text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                        Costo componentes
                      </span>
                      <span className="font-extrabold text-[#391511] tabular-nums">
                        <MontoARS monto={costoComponentes} />
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="max-w-2xl">
                <BuscadorComponente
                  excluidos={componentesSel.map((c) => c.componente_id)}
                  productoId={producto?.id ?? null}
                  disabled={guardando}
                  onSeleccionar={agregarComponente}
                />
              </div>

              {componentesSel.length === 0 ? (
                <p className="text-xs text-[#c8a58a]">
                  Buscá y agregá los productos que van adentro del combo.
                </p>
              ) : (
                <div className="rounded-lg border border-[#e4c9b0]/60 bg-white overflow-hidden">
                  <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_110px_130px_130px_44px] gap-2 px-3 py-2 bg-[#fdfaf6] border-b border-[#e4c9b0]/60 text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    <span>Producto</span>
                    <span className="text-right">Cantidad</span>
                    <span className="text-right">Costo unit.</span>
                    <span className="text-right">Subtotal</span>
                    <span />
                  </div>
                  <ul className="divide-y divide-[#e4c9b0]/40">
                    {componentesSel.map((c) => {
                      const cant = Number(c.cantidad) || 0
                      return (
                        <li
                          key={c.componente_id}
                          className="px-3 py-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_130px_130px_44px] sm:items-center"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-[#391511] truncate">
                              {c.nombre}
                            </div>
                            <div className="text-[11px] text-[#c8a58a]">
                              Stock {c.stock_actual} {c.unidad}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 sm:contents">
                            <Input
                              type="number"
                              min="0.01"
                              step="any"
                              value={c.cantidad}
                              onChange={(e) =>
                                cambiarCantidadComponente(
                                  c.componente_id,
                                  e.target.value
                                )
                              }
                              disabled={guardando}
                              aria-label={`Cantidad de ${c.nombre}`}
                              className="w-24 sm:w-full h-8 text-right tabular-nums bg-white border-[#e4c9b0]"
                            />
                            <div className="text-right text-sm text-[#6f3a2a] tabular-nums">
                              {c.precio_costo > 0 ? (
                                <MontoARS monto={c.precio_costo} />
                              ) : (
                                '—'
                              )}
                            </div>
                            <div className="text-right text-sm font-semibold text-[#391511] tabular-nums">
                              {c.precio_costo > 0 ? (
                                <MontoARS monto={cant * c.precio_costo} />
                              ) : (
                                '—'
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => quitarComponente(c.componente_id)}
                              disabled={guardando}
                              className="h-8 w-8 p-0 text-[#c8a58a] hover:text-[#c43e2c] justify-self-end"
                              aria-label="Quitar componente"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 items-start">
            {/* ══ Columna 1: identificación y catálogo ══ */}
            <section className="space-y-5">
              <div className="rounded-xl border border-[#e4c9b0]/60 p-4 space-y-4">
                <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                  <Package className="h-4 w-4 text-[#e4a42a]" />
                  Datos principales
                </h3>

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

                {/* Categoría (ancho completo: los nombres largos se leen enteros) */}
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
                        <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
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

                {/* Proveedor */}
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
                        <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
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

                {/* Imagen */}
                <div className="space-y-1.5">
                  <Label className="text-[#391511] font-medium">Imagen del producto</Label>
                  <SubirImagenProducto
                    value={imagenUrl}
                    onChange={setImagenUrl}
                    disabled={guardando}
                  />
                </div>
              </div>

              {/* ── Datos de catálogo ── */}
              <div className="rounded-xl border border-[#e4c9b0]/60 p-4 space-y-3">
                <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                  <Tags className="h-4 w-4 text-[#e4a42a]" />
                  Datos de catálogo
                </h3>
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
            </section>

            {/* ══ Columna 2: costos y precio de venta ══ */}
            <section className="space-y-5">
              {/* ── Costo de compra ── */}
              <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-4 space-y-3">
                <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                  <Receipt className="h-4 w-4 text-[#e4a42a]" />
                  Costo de compra
                </h3>
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
                      value={esCombo ? String(r2(costoComponentes)) : costoBase}
                      onChange={(e) => setCostoBase(e.target.value)}
                      placeholder="0.00"
                      disabled={guardando || esCombo}
                      className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                    />
                    {esCombo && (
                      <p className="text-[10px] text-[#c8a58a]">
                        Se calcula solo, sumando los componentes.
                      </p>
                    )}
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
                  <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                    <Layers className="h-4 w-4 text-[#e4a42a]" />
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
                <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                  <TrendingUp className="h-4 w-4 text-[#e4a42a]" />
                  Precio de venta
                </h3>
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
            </section>

            {/* ══ Columna 3: inventario, opciones y notas ══ */}
            <section className="md:col-span-2 xl:col-span-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-5 items-start">
              {/* ── Inventario y stock ── */}
              <div className="rounded-xl border border-[#e4c9b0]/60 p-4 space-y-4">
                <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                  <Boxes className="h-4 w-4 text-[#e4a42a]" />
                  Inventario y stock
                </h3>

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
                      <option value="combo">Combo / Pack (agrupa productos)</option>
                      <option value="insumo">Insumo (ingrediente)</option>
                      <option value="semi_elaborado">Semi-elaborado</option>
                      <option value="elaborado">Elaborado (se vende hecho)</option>
                      {producto?.tipo &&
                        ![
                          'reventa',
                          'combo',
                          'insumo',
                          'semi_elaborado',
                          'elaborado',
                        ].includes(producto.tipo) && (
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

                {esCombo ? (
                  /* Un combo no maneja stock propio: muestra cuántos se
                     pueden armar con el stock actual de los componentes. */
                  <div className="rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                        Stock armable hoy
                      </span>
                      <span className="font-extrabold text-[#391511] tabular-nums">
                        {componentesSel.length > 0 ? stockArmable : '—'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#c8a58a]">
                      El combo no tiene stock propio: se calcula desde los
                      componentes y al vender se descuentan ellos.
                    </p>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              {/* ── Opciones de venta (toggles compactos) ── */}
              <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-4">
                <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm mb-1">
                  <Settings2 className="h-4 w-4 text-[#e4a42a]" />
                  Opciones de venta
                </h3>
                <div className="divide-y divide-[#e4c9b0]/40">
                  {OPCIONES_VENTA.filter(
                    (op) => !esCombo || op.campo !== 'venta_por_peso'
                  ).map((op) => (
                    <div
                      key={op.campo}
                      className="flex items-center justify-between gap-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <Label
                          htmlFor={op.campo}
                          className="text-[#391511] font-medium cursor-pointer"
                        >
                          {op.etiqueta}
                        </Label>
                        <p className="text-[#6f3a2a] text-xs mt-0.5">
                          {op.descripcion}
                        </p>
                      </div>
                      <Controller
                        control={control}
                        name={op.campo}
                        render={({ field }) => (
                          <Switch
                            id={op.campo}
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={guardando}
                            className={
                              op.destructivo
                                ? 'data-[state=checked]:bg-[#c43e2c]'
                                : 'data-[state=checked]:bg-[#f9b44c]'
                            }
                          />
                        )}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Notas ── */}
              <div className="rounded-xl border border-[#e4c9b0]/60 p-4 space-y-2 md:col-span-2 xl:col-span-1">
                <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                  <StickyNote className="h-4 w-4 text-[#e4a42a]" />
                  Notas
                </h3>
                <textarea
                  id="notas"
                  rows={3}
                  {...register('notas')}
                  disabled={guardando}
                  placeholder="Observaciones internas (opcional)"
                  className="w-full rounded-md border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c] disabled:opacity-50"
                />
              </div>
            </section>
          </div>
        </form>

        <SheetFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row items-center gap-2 sm:gap-3">
          {/* Resumen en vivo: siempre visible aunque el bloque de precio quede
              fuera de pantalla al scrollear (solo desktop) */}
          <div className="hidden lg:flex items-center gap-4 mr-auto">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Costo neto
              </span>
              <span className="font-bold text-[#391511] text-sm tabular-nums">
                <MontoARS monto={calc.costoNeto} />
              </span>
            </div>
            <div className="h-8 w-px bg-[#e4c9b0]/60" />
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Precio de venta
              </span>
              <span className="font-extrabold text-[#391511] tabular-nums">
                {calc.precioVenta > 0 ? (
                  <MontoARS monto={calc.precioVenta} />
                ) : (
                  <span className="text-[#c8a58a] font-medium">Sin precio</span>
                )}
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={guardando}
            className="flex-1 lg:flex-none lg:min-w-32 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit(onSubmit)}
            disabled={guardando}
            className="flex-1 lg:flex-none lg:min-w-44 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
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
