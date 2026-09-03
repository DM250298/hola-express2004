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
  formatearCantidad,
  formatearNumero,
  pareceGramosEnKg,
  redondearCantidad,
} from '@/lib/utils/formato'
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
import { TIPOS_PRODUCTO, etiquetaTipo } from '@/lib/tipos-producto'
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
    .pipe(z.number().min(0, 'No puede ser negativo')),
  stock_minimo: z
    .union([z.string(), z.number()])
    .transform((v) => (v === '' ? NaN : Number(v)))
    .pipe(z.number().min(0, 'No puede ser negativo')),
  venta_por_peso: z.boolean().default(false),
  visible_tienda: z.boolean().default(true),
  controlar_stock: z.boolean().default(true),
  no_ofrecer_ventas: z.boolean().default(false),
  es_critico: z.boolean().default(false),
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
  // El stock fraccionado solo tiene sentido si el producto se vende por kg;
  // para uno por unidad un "12,5" es un typo, no media unidad. La regla mira
  // dos campos del mismo objeto, así que va como refinement y no en el campo.
  .superRefine((d, ctx) => {
    if (d.tipo === 'combo') return // el combo no lleva stock propio
    if (d.venta_por_peso) return // kg: hasta 3 decimales
    for (const campo of ['stock_actual', 'stock_minimo'] as const) {
      if (!Number.isInteger(d[campo])) {
        ctx.addIssue({
          code: 'custom',
          path: [campo],
          message: 'Solo enteros: activá "Venta por kg" si se vende fraccionado',
        })
      }
    }
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
    | 'es_critico'
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
    campo: 'es_critico',
    etiqueta: 'Producto crítico',
    descripcion:
      'No puede faltar (independiente del ABC): Compras lo sugiere aunque no haya vendido en 30 días, usando el stock mínimo como piso.',
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
                        Stock {formatearNumero(p.stock_actual)} {p.unidad}
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
  // Modo del cálculo de precio: 'margen' (costo+margen → precio, el clásico) o
  // 'precio' (precio a mano → el motor DEDUCE el margen neto y los gastos).
  const [modoPrecio, setModoPrecio] = useState<'margen' | 'precio'>('margen')
  const [precioManual, setPrecioManual] = useState('')
  // ¿El usuario tocó el bloque de precio (costo, margen, precio, IVA,
  // adicionales, componentes)? Si NO lo tocó, al guardar se conservan el
  // precio_venta y el margen vigentes: editar nombre/stock/categoría no debe
  // repricear el producto en silencio con las tasas del día.
  const [precioTocado, setPrecioTocado] = useState(false)
  // Detección del modo inicial (una vez por apertura, cuando carga la config).
  const refModoDetectado = useRef(false)
  // ── Precio mayorista (mig 153): par coherente propio, opcional. Vacío =
  //    sin lista mayorista (el POS cae al precio minorista). ──
  const [margenMayorista, setMargenMayorista] = useState('')
  const [precioManualMayorista, setPrecioManualMayorista] = useState('')
  const [modoPrecioMayorista, setModoPrecioMayorista] = useState<
    'margen' | 'precio'
  >('margen')
  const [precioMayoristaTocado, setPrecioMayoristaTocado] = useState(false)
  const refModoMayoristaDetectado = useRef(false)
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
      es_critico: false,
      notas: '',
    },
  })

  // Tipo elegido en vivo (para mostrar/ocultar la sección de combo).
  const tipoSel = useWatch({ control, name: 'tipo' })
  const esCombo = tipoSel === 'combo'
  // "Venta por kg" en vivo: habilita los decimales en los campos de stock.
  const porPeso = useWatch({ control, name: 'venta_por_peso' }) === true
  const stockActualCrudo = String(
    useWatch({ control, name: 'stock_actual' }) ?? ''
  )

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
      es_critico: producto?.es_critico ?? false,
      notas: producto?.notas ?? '',
    })

    // Bloque de costo / precio
    setIvaCompra(String(producto?.iva_compra ?? 21))
    setIvaVenta(String(producto?.iva_venta ?? 21))
    setMargen(String(producto?.margen ?? 0))
    setModoPrecio('margen')
    setPrecioManual(String(producto?.precio_venta ?? ''))
    setPrecioTocado(false)
    refModoDetectado.current = false
    // Bloque mayorista: sin par guardado arranca vacío (= sin lista).
    setMargenMayorista(
      producto?.margen_mayorista != null ? String(producto.margen_mayorista) : ''
    )
    setPrecioManualMayorista(
      producto?.precio_mayorista != null ? String(producto.precio_mayorista) : ''
    )
    setModoPrecioMayorista('margen')
    setPrecioMayoristaTocado(false)
    refModoMayoristaDetectado.current = false
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

  // ── Modo inicial inteligente (una vez por apertura, con la config cargada) ──
  // Si el precio guardado NO es el que el motor reproduce desde el margen
  // guardado (precio fijado a mano — típico de la importación por precio), el
  // drawer abre en "Por precio" sembrado con el precio VIGENTE: lo que se ve
  // es lo que rige, y el margen mostrado es el real de ese precio. Si el par
  // es coherente con el motor, abre en "Por margen" clásico.
  useEffect(() => {
    if (!abierto || refModoDetectado.current || pricing.cargando) return
    refModoDetectado.current = true
    if (!esEdicion || !producto) return
    const precioGuardado = producto.precio_venta ?? 0
    if (precioGuardado <= 0) return
    const costoNeto = producto.precio_costo ?? 0
    const costoParaMotor =
      pricing.regimen === 'monotributista'
        ? costoNeto * (1 + (producto.iva_compra ?? 21) / 100)
        : costoNeto
    const { desglose } = pricing.calcular(
      costoParaMotor,
      producto.margen ?? 0,
      producto.iva_venta ?? 21
    )
    const recalculado = desglose?.precioRedondeado ?? 0
    if (Math.abs(recalculado - precioGuardado) > 0.5) {
      setModoPrecio('precio')
      setPrecioManual(String(precioGuardado))
    }
  }, [abierto, esEdicion, producto, pricing])

  // Modo inicial del bloque MAYORISTA: mismo algoritmo, contra su propio par.
  useEffect(() => {
    if (!abierto || refModoMayoristaDetectado.current || pricing.cargando) return
    refModoMayoristaDetectado.current = true
    if (!esEdicion || !producto) return
    const precioGuardado = producto.precio_mayorista ?? 0
    if (precioGuardado <= 0) return
    const costoNeto = producto.precio_costo ?? 0
    const costoParaMotor =
      pricing.regimen === 'monotributista'
        ? costoNeto * (1 + (producto.iva_compra ?? 21) / 100)
        : costoNeto
    const { desglose } = pricing.calcular(
      costoParaMotor,
      producto.margen_mayorista ?? 0,
      producto.iva_venta ?? 21
    )
    const recalculado = desglose?.precioRedondeado ?? 0
    if (Math.abs(recalculado - precioGuardado) > 0.5) {
      setModoPrecioMayorista('precio')
      setPrecioManualMayorista(String(precioGuardado))
    }
  }, [abierto, esEdicion, producto, pricing])

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

    if (modoPrecio === 'precio') {
      // INVERSO: el precio se fija a mano y el motor DEDUCE el margen + gastos.
      const precio = Number(precioManual) || 0
      const { desglose, error } = pricing.calcularDesdePrecio(
        precio,
        costoParaMotor,
        Number(ivaVenta) || 0
      )
      return {
        modo: 'precio' as const,
        sumaAdic,
        costoNeto,
        costoConIva,
        desglose: null,
        desglosePrecio: desglose,
        error,
        precioVenta: precio, // se guarda el precio ingresado, tal cual
        margenFinal:
          desglose && desglose.margen != null ? desglose.margen * 100 : 0,
      }
    }

    // DIRECTO: costo + margen → precio (comportamiento clásico).
    const { desglose, error } = pricing.calcular(
      costoParaMotor,
      Number(margen) || 0,
      Number(ivaVenta) || 0
    )
    return {
      modo: 'margen' as const,
      sumaAdic,
      costoNeto,
      costoConIva,
      desglose,
      desglosePrecio: null,
      error,
      // Lo que se guarda como precio_venta: el precio comercial redondeado.
      precioVenta: desglose?.precioRedondeado ?? 0,
      margenFinal: Number(margen) || 0,
    }
  }, [adicionales, costoBase, ivaCompra, ivaVenta, margen, precioManual, modoPrecio, pricing, esCombo, costoComponentes])

  // ── Cálculo del precio MAYORISTA (mig 153): mismo motor, otro margen. ──
  // Campos vacíos = el producto no tiene lista mayorista (fallback minorista).
  const calcMayorista = useMemo(() => {
    const definido =
      modoPrecioMayorista === 'precio'
        ? (Number(precioManualMayorista) || 0) > 0
        : margenMayorista.trim() !== ''
    if (!definido) {
      return {
        definido: false as const,
        modo: modoPrecioMayorista,
        precioVenta: 0,
        margenFinal: 0,
        margenNeto: null as number | null,
        error: null as string | null,
      }
    }

    const sumaAdic = adicionales.reduce((s, a) => s + (Number(a.monto) || 0), 0)
    const base = esCombo ? costoComponentes : Number(costoBase) || 0
    const costoNeto = base + sumaAdic
    const costoConIva = costoNeto * (1 + (Number(ivaCompra) || 0) / 100)
    const costoParaMotor =
      pricing.regimen === 'monotributista' ? costoConIva : costoNeto

    if (modoPrecioMayorista === 'precio') {
      const precio = Number(precioManualMayorista) || 0
      const { desglose, error } = pricing.calcularDesdePrecio(
        precio,
        costoParaMotor,
        Number(ivaVenta) || 0
      )
      return {
        definido: true as const,
        modo: 'precio' as const,
        precioVenta: precio,
        margenFinal:
          desglose && desglose.margen != null ? desglose.margen * 100 : 0,
        margenNeto: desglose?.margen ?? null,
        error,
      }
    }

    const { desglose, error } = pricing.calcular(
      costoParaMotor,
      Number(margenMayorista) || 0,
      Number(ivaVenta) || 0
    )
    return {
      definido: true as const,
      modo: 'margen' as const,
      precioVenta: desglose?.precioRedondeado ?? 0,
      margenFinal: Number(margenMayorista) || 0,
      margenNeto: (Number(margenMayorista) || 0) / 100,
      error,
    }
  }, [adicionales, costoBase, ivaCompra, ivaVenta, margenMayorista, precioManualMayorista, modoPrecioMayorista, pricing, esCombo, costoComponentes])

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
    setPrecioTocado(true)
    setAdicionales((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, [campo]: valor } : a))
    )
  }
  function quitarAdicional(idx: number) {
    setPrecioTocado(true)
    setAdicionales((prev) => prev.filter((_, i) => i !== idx))
  }

  function agregarComponente(p: ProductoConRelaciones) {
    setPrecioTocado(true)
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
    setPrecioTocado(true)
    setComponentesSel((prev) =>
      prev.map((c) => (c.componente_id === id ? { ...c, cantidad: valor } : c))
    )
  }
  function quitarComponente(id: number) {
    setPrecioTocado(true)
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
    // Si el usuario NO tocó el bloque de precio, se conservan los valores
    // vigentes tal cual: recalcular acá repricearía el producto en silencio
    // (el redondeo comercial y las tasas del día pueden mover el precio aunque
    // solo se haya editado el nombre o el stock).
    const conservarPrecio = esEdicion && producto != null && !precioTocado
    const precioAGuardar = conservarPrecio
      ? (producto.precio_venta ?? 0)
      : r2(calc.precioVenta)
    // Mayorista: si no se tocó NI el bloque mayorista NI el de costo/precio,
    // se conserva el par vigente. Tocar el costo sí lo repricea (margen
    // mayorista manda, igual que la factura v14). Campos vacíos → null/null
    // (borra la lista: vuelve al fallback minorista).
    const conservarMayorista =
      esEdicion && producto != null && !precioTocado && !precioMayoristaTocado
    const mayoristaAGuardar = conservarMayorista
      ? {
          precio_mayorista: producto.precio_mayorista ?? null,
          margen_mayorista: producto.margen_mayorista ?? null,
        }
      : calcMayorista.definido && calcMayorista.precioVenta > 0
        ? {
            precio_mayorista: r2(calcMayorista.precioVenta),
            margen_mayorista: r2(calcMayorista.margenFinal),
          }
        : { precio_mayorista: null, margen_mayorista: null }
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
      precio_costo: conservarPrecio
        ? (producto.precio_costo ?? 0)
        : r2(calc.costoNeto),
      precio_venta: precioAGuardar,
      iva_compra: Number(ivaCompra) || 0,
      iva_venta: Number(ivaVenta) || 0,
      // En modo "por precio" el margen es el DEDUCIDO del precio; en modo
      // "por margen" es el que se tipeó. calc.margenFinal unifica ambos.
      margen: conservarPrecio ? (producto.margen ?? 0) : r2(calc.margenFinal),
      ...mayoristaAGuardar,
      costos_adicionales: costosAdicionales,
      // Un combo no maneja stock propio: el stock sale de los componentes
      // (el "stock" que se ve es el virtual, calculado en las queries).
      // Por peso van hasta 3 decimales (kg); por unidad, enteros. Las columnas
      // son numeric(12,3) — stock_minimo desde la migración 150, que hay que
      // correr ANTES de deployar esto o un mínimo fraccionado da error 400.
      stock_actual: esComboFinal
        ? 0
        : redondearCantidad(validado.stock_actual, validado.venta_por_peso),
      stock_minimo: esComboFinal
        ? 0
        : redondearCantidad(validado.stock_minimo, validado.venta_por_peso),
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
      es_critico: validado.es_critico,
      // Sin precio de venta cargado → queda "pendiente de precio": visible en
      // el POS pero bloqueado para vender hasta que se complete (factura o
      // carga manual). Con precio > 0 se habilita.
      pendiente_precio: precioAGuardar <= 0,
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
                              Stock {formatearNumero(c.stock_actual)} {c.unidad}
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
                      onChange={(e) => {
                        setPrecioTocado(true)
                        setIvaCompra(e.target.value)
                      }}
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
                      onChange={(e) => {
                        setPrecioTocado(true)
                        setCostoBase(e.target.value)
                      }}
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
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                    <TrendingUp className="h-4 w-4 text-[#e4a42a]" />
                    Precio de venta
                  </h3>
                  {/* Toggle modo: por margen (→ precio) o por precio (→ margen) */}
                  <div className="flex gap-0.5 rounded-lg bg-[#f1e2d0] p-0.5 text-[11px] font-semibold">
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => {
                        // Sin ediciones, arrancá del precio GUARDADO (no del
                        // recalculado): togglear ida y vuelta no debe convertir
                        // el redondeo en un cambio de precio (trinquete).
                        if (esEdicion && !precioTocado && (producto?.precio_venta ?? 0) > 0) {
                          setPrecioManual(String(producto?.precio_venta ?? ''))
                        } else if (calc.precioVenta > 0) {
                          setPrecioManual(String(calc.precioVenta))
                        }
                        setModoPrecio('precio')
                      }}
                      className={
                        'rounded-md px-2.5 py-1 transition ' +
                        (modoPrecio === 'precio'
                          ? 'bg-white text-[#391511] shadow-sm'
                          : 'text-[#6f3a2a] hover:text-[#391511]')
                      }
                    >
                      Por precio
                    </button>
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => {
                        // Sin ediciones, arrancá del margen GUARDADO; con
                        // ediciones, del margen que deja el precio actual.
                        if (esEdicion && !precioTocado && producto) {
                          setMargen(String(producto.margen ?? 0))
                        } else if (calc.margenFinal) {
                          setMargen(String(r2(calc.margenFinal)))
                        }
                        setModoPrecio('margen')
                      }}
                      className={
                        'rounded-md px-2.5 py-1 transition ' +
                        (modoPrecio === 'margen'
                          ? 'bg-white text-[#391511] shadow-sm'
                          : 'text-[#6f3a2a] hover:text-[#391511]')
                      }
                    >
                      Por margen
                    </button>
                  </div>
                </div>
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
                      onChange={(e) => {
                        setPrecioTocado(true)
                        setIvaVenta(e.target.value)
                      }}
                      disabled={guardando}
                      className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                    />
                  </div>
                  {modoPrecio === 'margen' ? (
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                        Margen ganancia %
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={margen}
                        onChange={(e) => {
                          setPrecioTocado(true)
                          setMargen(e.target.value)
                        }}
                        disabled={guardando}
                        className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                        Precio de venta $
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={precioManual}
                        onChange={(e) => {
                          setPrecioTocado(true)
                          setPrecioManual(e.target.value)
                        }}
                        disabled={guardando}
                        className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                  )}
                </div>

                {/* Aviso cuando el recálculo difiere del precio vigente: el
                    reprice tiene que ser visible y deliberado, nunca silencioso. */}
                {esEdicion &&
                  producto &&
                  (producto.precio_venta ?? 0) > 0 &&
                  calc.precioVenta > 0 &&
                  Math.abs(r2(calc.precioVenta) - (producto.precio_venta ?? 0)) >
                    0.009 && (
                    <div className="flex items-start gap-2 rounded-lg border border-[#e4a42a]/50 bg-[#f9b44c]/10 p-2.5 text-xs text-[#391511]">
                      <AlertTriangle className="h-3.5 w-3.5 text-[#e4a42a] shrink-0 mt-0.5" />
                      <span>
                        Precio vigente:{' '}
                        <strong>
                          <MontoARS monto={producto.precio_venta ?? 0} />
                        </strong>
                        .{' '}
                        {precioTocado ? (
                          <>
                            Al guardar pasa a{' '}
                            <strong>
                              <MontoARS monto={r2(calc.precioVenta)} />
                            </strong>
                            .
                          </>
                        ) : (
                          'Se conserva al guardar: solo cambia si tocás costo, margen o precio.'
                        )}
                      </span>
                    </div>
                  )}

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
                ) : calc.modo === 'precio' ? (
                  calc.desglosePrecio && calc.precioVenta > 0 ? (
                    <>
                      <div className="flex items-end justify-between rounded-lg border border-[#e4c9b0]/60 bg-white px-3 py-2">
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                            Margen neto real
                          </span>
                          {calc.desglosePrecio.margen == null ? (
                            <div
                              className="font-extrabold text-xl tabular-nums text-[#c8a58a]"
                              title="Sin costo cargado: no se puede medir el margen"
                            >
                              —
                            </div>
                          ) : (
                            <div
                              className={
                                'font-extrabold text-xl tabular-nums ' +
                                (calc.desglosePrecio.margen >= 0
                                  ? 'text-[#2f8f4e]'
                                  : 'text-[#c43e2c]')
                              }
                            >
                              {calc.desglosePrecio.margen >= 0 ? '+' : ''}
                              {(calc.desglosePrecio.margen * 100).toFixed(1)}%
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                            Ganancia neta
                          </span>
                          <div
                            className={
                              'text-sm tabular-nums ' +
                              (calc.desglosePrecio.ganancia >= 0
                                ? 'text-[#2f8f4e]'
                                : 'text-[#c43e2c]')
                            }
                          >
                            <MontoARS monto={calc.desglosePrecio.ganancia} />
                          </div>
                        </div>
                      </div>

                      <ul className="text-xs text-[#6f3a2a] space-y-1">
                        <li className="flex justify-between">
                          <span>Precio de venta</span>
                          <MontoARS monto={calc.desglosePrecio.precioFinal} />
                        </li>
                        <li className="flex justify-between">
                          <span>Costo</span>
                          <MontoARS monto={calc.desglosePrecio.costo} />
                        </li>
                        <li className="flex justify-between">
                          <span>IIBB</span>
                          <MontoARS monto={calc.desglosePrecio.iibbMonto} />
                        </li>
                        <li className="flex justify-between">
                          <span>Imp. créd/déb</span>
                          <MontoARS monto={calc.desglosePrecio.debcredMonto} />
                        </li>
                        <li className="flex justify-between">
                          <span>Comisión MP (peor caso)</span>
                          <MontoARS monto={calc.desglosePrecio.comisionMonto} />
                        </li>
                      </ul>
                      {calc.desglosePrecio.margen != null &&
                        calc.desglosePrecio.margen < 0 && (
                          <div className="flex items-start gap-2 rounded-lg border-2 border-[#c43e2c]/40 bg-[#c43e2c]/8 p-2.5">
                            <AlertTriangle className="h-4 w-4 text-[#c43e2c] shrink-0 mt-0.5" />
                            <p className="text-xs text-[#391511]">
                              A este precio <strong>perdés plata</strong>: no cubre
                              el costo más las cargas.
                            </p>
                          </div>
                        )}
                      <p className="text-[10px] text-[#c8a58a] leading-relaxed">
                        Ponés el precio y el sistema deduce el margen NETO que te
                        queda tras IIBB, impuesto a los créditos/débitos y la
                        comisión de Mercado Pago (peor caso). Se guarda ese margen.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-[#c8a58a]">
                      Cargá el costo y el precio para ver el margen.
                    </p>
                  )
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

                    {/* Cargas sobre el precio REDONDEADO (el que se cobra): así
                        el desglose coincide con el del modo "Por precio" al
                        mismo precio final. */}
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
                        <MontoARS monto={calc.desglose.iibbMontoCobrado} />
                      </li>
                      <li className="flex justify-between">
                        <span>Imp. créd/déb</span>
                        <MontoARS monto={calc.desglose.debcredMontoCobrado} />
                      </li>
                      <li className="flex justify-between">
                        <span>Comisión MP (peor caso)</span>
                        <MontoARS monto={calc.desglose.comisionMontoCobrado} />
                      </li>
                      <li className="flex justify-between text-[#c8a58a]">
                        <span>Margen extra por redondeo</span>
                        <MontoARS monto={calc.desglose.margenExtraRedondeo} />
                      </li>
                      <li className="flex justify-between font-semibold text-[#2f8f4e]">
                        <span>Ganancia real al precio cobrado</span>
                        <MontoARS monto={calc.desglose.gananciaCobrada} />
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

              {/* ── Precio mayorista (opcional, mig 153) ── */}
              <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="flex items-center gap-2 text-[#391511] font-bold text-sm">
                    <TrendingUp className="h-4 w-4 text-[#e4a42a]" />
                    Precio mayorista
                    <span className="text-[10px] font-semibold uppercase text-[#c8a58a]">
                      opcional
                    </span>
                  </h3>
                  <div className="flex gap-0.5 rounded-lg bg-[#f1e2d0] p-0.5 text-[11px] font-semibold">
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => {
                        // Mismo trinquete que el minorista: sin ediciones se
                        // arranca del precio GUARDADO, no del recalculado.
                        if (
                          esEdicion &&
                          !precioMayoristaTocado &&
                          (producto?.precio_mayorista ?? 0) > 0
                        ) {
                          setPrecioManualMayorista(
                            String(producto?.precio_mayorista ?? '')
                          )
                        } else if (calcMayorista.precioVenta > 0) {
                          setPrecioManualMayorista(
                            String(calcMayorista.precioVenta)
                          )
                        }
                        setModoPrecioMayorista('precio')
                      }}
                      className={
                        'rounded-md px-2.5 py-1 transition ' +
                        (modoPrecioMayorista === 'precio'
                          ? 'bg-white text-[#391511] shadow-sm'
                          : 'text-[#6f3a2a] hover:text-[#391511]')
                      }
                    >
                      Por precio
                    </button>
                    <button
                      type="button"
                      disabled={guardando}
                      onClick={() => {
                        if (esEdicion && !precioMayoristaTocado && producto) {
                          setMargenMayorista(
                            producto.margen_mayorista != null
                              ? String(producto.margen_mayorista)
                              : ''
                          )
                        } else if (calcMayorista.definido) {
                          setMargenMayorista(String(r2(calcMayorista.margenFinal)))
                        }
                        setModoPrecioMayorista('margen')
                      }}
                      className={
                        'rounded-md px-2.5 py-1 transition ' +
                        (modoPrecioMayorista === 'margen'
                          ? 'bg-white text-[#391511] shadow-sm'
                          : 'text-[#6f3a2a] hover:text-[#391511]')
                      }
                    >
                      Por margen
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {modoPrecioMayorista === 'margen' ? (
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                        Margen mayorista %
                      </Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={margenMayorista}
                        onChange={(e) => {
                          setPrecioMayoristaTocado(true)
                          setMargenMayorista(e.target.value)
                        }}
                        placeholder="Vacío = sin lista"
                        disabled={guardando}
                        className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                        Precio mayorista $
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={precioManualMayorista}
                        onChange={(e) => {
                          setPrecioMayoristaTocado(true)
                          setPrecioManualMayorista(e.target.value)
                        }}
                        placeholder="Vacío = sin lista"
                        disabled={guardando}
                        className="bg-white tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                      />
                    </div>
                  )}
                  <div className="space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold block">
                      {modoPrecioMayorista === 'margen'
                        ? 'Precio resultante'
                        : 'Margen neto real'}
                    </span>
                    {!calcMayorista.definido ? (
                      <div className="h-9 flex items-center text-sm text-[#c8a58a]">
                        Sin lista mayorista
                      </div>
                    ) : calcMayorista.error ? (
                      <div className="h-9 flex items-center text-xs text-[#c43e2c]">
                        {calcMayorista.error}
                      </div>
                    ) : modoPrecioMayorista === 'margen' ? (
                      <div className="h-9 flex items-center font-extrabold text-[#391511] tabular-nums">
                        <MontoARS monto={calcMayorista.precioVenta} />
                      </div>
                    ) : (
                      <div
                        className={
                          'h-9 flex items-center font-extrabold tabular-nums ' +
                          ((calcMayorista.margenNeto ?? 0) >= 0
                            ? 'text-[#2f8f4e]'
                            : 'text-[#c43e2c]')
                        }
                      >
                        {calcMayorista.margenNeto == null
                          ? '—'
                          : `${calcMayorista.margenNeto >= 0 ? '+' : ''}${(calcMayorista.margenNeto * 100).toFixed(1)}%`}
                      </div>
                    )}
                  </div>
                </div>

                {/* Ahorro vs minorista + alerta de margen negativo */}
                {calcMayorista.definido &&
                  !calcMayorista.error &&
                  calcMayorista.precioVenta > 0 &&
                  calc.precioVenta > 0 && (
                    <p className="text-xs text-[#6f3a2a]">
                      {calcMayorista.precioVenta < calc.precioVenta ? (
                        <>
                          {(
                            (1 - calcMayorista.precioVenta / calc.precioVenta) *
                            100
                          ).toFixed(1)}
                          % más barato que el minorista (
                          <MontoARS monto={calc.precioVenta} />
                          ).
                        </>
                      ) : (
                        <span className="text-[#b5701f]">
                          Ojo: no es más barato que el minorista (
                          <MontoARS monto={calc.precioVenta} />
                          ).
                        </span>
                      )}
                    </p>
                  )}
                {calcMayorista.definido &&
                  calcMayorista.margenNeto != null &&
                  calcMayorista.margenNeto < 0 && (
                    <div className="flex items-start gap-2 rounded-lg border-2 border-[#c43e2c]/40 bg-[#c43e2c]/8 p-2.5">
                      <AlertTriangle className="h-4 w-4 text-[#c43e2c] shrink-0 mt-0.5" />
                      <p className="text-xs text-[#391511]">
                        A este precio mayorista <strong>perdés plata</strong>:
                        no cubre el costo más las cargas.
                      </p>
                    </div>
                  )}
                <p className="text-[10px] text-[#c8a58a] leading-relaxed">
                  Un producto sin precio mayorista se vende al precio minorista
                  aunque la venta sea mayorista. Al cargar una factura que
                  afecta precios, el mayorista se recalcula desde su margen.
                </p>
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
                      {TIPOS_PRODUCTO.map((t) => (
                        <option key={t.valor} value={t.valor}>
                          {t.etiqueta} ({t.ayuda})
                        </option>
                      ))}
                      {producto?.tipo &&
                        !TIPOS_PRODUCTO.some((t) => t.valor === producto.tipo) && (
                          <option value={producto.tipo}>
                            {etiquetaTipo(producto.tipo)} (actual)
                          </option>
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
                          {porPeso && <span className="text-[#9e6b15]"> (kg)</span>}
                        </Label>
                        <Input
                          id="stock_actual"
                          type="number"
                          min="0"
                          step={porPeso ? '0.001' : '1'}
                          inputMode={porPeso ? 'decimal' : 'numeric'}
                          placeholder={porPeso ? '0,000' : '0'}
                          {...register('stock_actual')}
                          disabled={guardando}
                          className="tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                        />
                        {errors.stock_actual && (
                          <p className="text-[#c43e2c] text-xs mt-1">
                            {errors.stock_actual.message}
                          </p>
                        )}
                        {/* Un entero grande en un campo de KILOS suele ser el
                            peso en gramos leído de la balanza. */}
                        {porPeso && pareceGramosEnKg(stockActualCrudo) && (
                          <button
                            type="button"
                            onClick={() =>
                              setValue(
                                'stock_actual',
                                String(Number(stockActualCrudo) / 1000),
                                { shouldValidate: true }
                              )
                            }
                            className="mt-1 w-full rounded-md border border-[#c43e2c]/50 bg-[#c43e2c]/10 px-2 py-1 text-[11px] font-bold text-[#c43e2c] transition-colors hover:bg-[#c43e2c]/20"
                          >
                            ¿{formatearNumero(Number(stockActualCrudo))} kg? Eran
                            gramos → usar{' '}
                            {formatearCantidad(
                              Number(stockActualCrudo) / 1000,
                              true
                            )}
                          </button>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="stock_minimo" className="text-[#391511] font-medium">
                          Stock mínimo
                          {porPeso && <span className="text-[#9e6b15]"> (kg)</span>}
                        </Label>
                        <Input
                          id="stock_minimo"
                          type="number"
                          min="0"
                          step={porPeso ? '0.001' : '1'}
                          inputMode={porPeso ? 'decimal' : 'numeric'}
                          placeholder={porPeso ? '0,000' : '0'}
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
