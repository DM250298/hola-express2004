'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Printer, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MontoARS } from '@/components/shared/MontoARS'
import { BuscadorInsumo } from './BuscadorInsumo'
import { InputNumero } from './InputNumero'
import { EtiquetaElaboracion } from './EtiquetaElaboracion'
import {
  useGuardarReceta,
  useProductosProduccion,
  useRecetaDeProducto,
} from '@/lib/hooks/useProduccion'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  CONSERVACION_POR_DEFECTO,
  type DatosEtiquetaElaboracion,
  type ProductoProduccion,
} from '@/lib/queries/produccion'
import {
  convertir,
  DIMENSION_POR_UNIDAD,
  esUnidadCanonica,
  UNIDADES,
  type UnidadCanonica,
} from '@/lib/utils/unidades'
import { formatearNumero } from '@/lib/utils/formato'
import { hoyIso, isoMasDias } from '@/lib/utils/periodos'
import { etiquetaTipo } from '@/lib/tipos-producto'
import { cn } from '@/lib/utils'

interface IngEdit {
  insumo_id: number
  nombre: string
  unidad_stock: string
  dimension: string
  cantidad: number
  unidad: string
  merma_pct: number
  precio_costo: number
}

/** Los alérgenos que declara el Código Alimentario Argentino. */
const ALERGENOS_FRECUENTES = [
  'Gluten',
  'Leche',
  'Huevo',
  'Soja',
  'Maní',
  'Frutos secos',
  'Pescado',
  'Crustáceos',
  'Sésamo',
  'Sulfitos',
]

/** Unidades canónicas que comparten dimensión con la unidad dada. */
function unidadesCompatibles(unidad: string): UnidadCanonica[] {
  const dim = DIMENSION_POR_UNIDAD[unidad as UnidadCanonica]
  if (!dim) return UNIDADES.filter((u) => u === unidad) as UnidadCanonica[]
  return UNIDADES.filter((u) => DIMENSION_POR_UNIDAD[u] === dim)
}

/** Cantidad de la receta llevada a la unidad de stock del insumo. */
function aUnidadStock(cantidad: number, desde: string, hacia: string): number {
  if (desde === hacia) return cantidad
  if (esUnidadCanonica(desde) && esUnidadCanonica(hacia)) {
    try {
      return convertir(cantidad, desde as UnidadCanonica, hacia as UnidadCanonica)
    } catch {
      return cantidad
    }
  }
  return cantidad
}

interface Props {
  /** Producto de la receta a editar. Undefined = receta nueva. */
  productoIdInicial?: number
  onGuardada: (productoId: number) => void
  onCancelar: () => void
  /** Avisa al padre si hay cambios sin guardar, para poder interceptar. */
  onSucioChange: (sucio: boolean) => void
}

/**
 * Ficha completa de una receta en un panel ancho: qué se elabora, con qué, qué
 * cuesta cada ingrediente, cómo se prepara y qué va impreso en la etiqueta.
 *
 * Reemplaza el diálogo apretado que había antes. El montaje es por receta
 * (el padre usa `key`), así que el prefill corre una sola vez por instancia.
 */
export function PanelReceta({
  productoIdInicial,
  onGuardada,
  onCancelar,
  onSucioChange,
}: Props) {
  const esNueva = !productoIdInicial
  const guardar = useGuardarReceta()
  const { data: usuario } = useUsuario()

  const { data: recetaExistente, isLoading } = useRecetaDeProducto(productoIdInicial)
  const { data: elaborables } = useProductosProduccion([
    'semi_elaborado',
    'elaborado',
  ])

  const [productoId, setProductoId] = useState<number | undefined>(productoIdInicial)
  const [unidadProducto, setUnidadProducto] = useState('unidad')
  const [nombreProducto, setNombreProducto] = useState('')
  const [precioVenta, setPrecioVenta] = useState(0)
  const [rendimiento, setRendimiento] = useState(1)
  const [vidaUtil, setVidaUtil] = useState(2)
  const [ingredientes, setIngredientes] = useState<IngEdit[]>([])
  const [pasos, setPasos] = useState('')
  const [conservacion, setConservacion] = useState('')
  const [alergenos, setAlergenos] = useState('')
  const [ingredientesEtiqueta, setIngredientesEtiqueta] = useState('')
  const prefilled = useRef(false)
  const snapshot = useRef<string>('')
  /** El formulario ya tiene sus valores definitivos: recién ahí se fotografía. */
  const [listo, setListo] = useState(esNueva)

  // Prefill al cargar la receta existente (una sola vez por montaje).
  useEffect(() => {
    if (esNueva || prefilled.current || !recetaExistente) return
    prefilled.current = true
    setProductoId(recetaExistente.producto_id)
    setUnidadProducto(recetaExistente.producto?.unidad ?? 'unidad')
    setNombreProducto(recetaExistente.producto?.nombre ?? '')
    setPrecioVenta(recetaExistente.producto?.precio_venta ?? 0)
    setRendimiento(recetaExistente.rendimiento)
    setVidaUtil(recetaExistente.vida_util_dias)
    setPasos(recetaExistente.pasos ?? '')
    setConservacion(recetaExistente.conservacion ?? '')
    setAlergenos(recetaExistente.alergenos ?? '')
    setIngredientesEtiqueta(recetaExistente.ingredientes_etiqueta ?? '')
    setIngredientes(
      recetaExistente.ingredientes.map((ing) => ({
        insumo_id: ing.insumo_id,
        nombre: ing.insumo?.nombre ?? 'Insumo',
        unidad_stock: ing.insumo?.unidad ?? ing.unidad,
        dimension:
          DIMENSION_POR_UNIDAD[
            (ing.insumo?.unidad ?? ing.unidad) as UnidadCanonica
          ] ?? 'conteo',
        cantidad: ing.cantidad,
        unidad: ing.unidad,
        merma_pct: ing.merma_pct,
        precio_costo: ing.insumo?.precio_costo ?? 0,
      }))
    )
    setListo(true)
  }, [recetaExistente, esNueva])

  // Costo por línea y total, en vivo mientras se edita (el costo guardado, que
  // es recursivo, lo sigue calculando fn_costo_receta al guardar).
  const lineas = useMemo(
    () =>
      ingredientes.map((ing) => {
        const enStock = aUnidadStock(ing.cantidad, ing.unidad, ing.unidad_stock)
        const costo = enStock * (1 + ing.merma_pct / 100) * ing.precio_costo
        return { insumo_id: ing.insumo_id, costo }
      }),
    [ingredientes]
  )
  const costoTanda = lineas.reduce((acc, l) => acc + l.costo, 0)
  const costoUnitario = rendimiento > 0 ? costoTanda / rendimiento : 0
  const margen =
    precioVenta > 0 ? ((precioVenta - costoUnitario) / precioVenta) * 100 : 0

  // Texto de ingredientes que se imprime si no hay override cargado.
  const ingredientesAuto = useMemo(
    () =>
      ingredientes
        .map((i) => i.nombre.trim().toLowerCase())
        .filter(Boolean)
        .join(', '),
    [ingredientes]
  )

  const payload = useMemo(
    () => ({
      producto_id: productoId,
      rendimiento,
      vida_util_dias: vidaUtil,
      pasos: pasos.trim(),
      conservacion: conservacion.trim(),
      alergenos: alergenos.trim(),
      ingredientes_etiqueta: ingredientesEtiqueta.trim(),
      ingredientes: ingredientes.map((i) => ({
        insumo_id: i.insumo_id,
        cantidad: i.cantidad,
        unidad: i.unidad,
        merma_pct: i.merma_pct,
      })),
    }),
    [
      productoId,
      rendimiento,
      vidaUtil,
      pasos,
      conservacion,
      alergenos,
      ingredientesEtiqueta,
      ingredientes,
    ]
  )

  // Snapshot para el dirty-tracking. Se toma en el primer render en el que el
  // formulario ya está cargado — nunca mientras carga, o compararíamos contra
  // un formulario vacío y el panel abriría diciendo que tiene cambios.
  useEffect(() => {
    if (!listo) return
    if (!snapshot.current) {
      snapshot.current = JSON.stringify(payload)
      return
    }
    onSucioChange(JSON.stringify(payload) !== snapshot.current)
  }, [payload, listo, onSucioChange])

  function elegirProducto(p: ProductoProduccion) {
    setProductoId(p.id)
    setUnidadProducto(p.unidad)
    setNombreProducto(p.nombre)
    setPrecioVenta(p.precio_venta)
  }

  function agregarIngrediente(p: ProductoProduccion) {
    if (ingredientes.some((i) => i.insumo_id === p.id)) return
    setIngredientes((prev) => [
      ...prev,
      {
        insumo_id: p.id,
        nombre: p.nombre,
        unidad_stock: p.unidad,
        dimension: p.dimension,
        cantidad: 1,
        unidad: p.unidad,
        merma_pct: 0,
        precio_costo: p.precio_costo,
      },
    ])
  }

  function actualizarIng(idx: number, patch: Partial<IngEdit>) {
    setIngredientes((prev) =>
      prev.map((ing, i) => (i === idx ? { ...ing, ...patch } : ing))
    )
  }

  function quitarIng(idx: number) {
    setIngredientes((prev) => prev.filter((_, i) => i !== idx))
  }

  function alternarAlergeno(nombre: string) {
    const actuales = alergenos
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
    const ya = actuales.some((a) => a.toLowerCase() === nombre.toLowerCase())
    const nuevos = ya
      ? actuales.filter((a) => a.toLowerCase() !== nombre.toLowerCase())
      : [...actuales, nombre]
    setAlergenos(nuevos.join(', '))
  }

  function handleGuardar() {
    if (!productoId) return
    guardar.mutate(
      {
        producto_id: productoId,
        rendimiento,
        unidad_rendimiento: unidadProducto,
        vida_util_dias: vidaUtil,
        pasos: pasos.trim() || null,
        conservacion: conservacion.trim() || null,
        alergenos: alergenos.trim() || null,
        ingredientes_etiqueta: ingredientesEtiqueta.trim() || null,
        ingredientes: ingredientes.map((ing) => ({
          insumo_id: ing.insumo_id,
          cantidad: ing.cantidad,
          unidad: ing.unidad,
          merma_pct: ing.merma_pct,
        })),
      },
      {
        onSuccess: () => {
          snapshot.current = JSON.stringify(payload)
          onSucioChange(false)
          onGuardada(productoId)
        },
      }
    )
  }

  // Etiqueta de muestra: lo que se va a imprimir con estos datos.
  const previewEtiqueta: DatosEtiquetaElaboracion = {
    orden_id: 0,
    producto_id: productoId ?? 0,
    producto_nombre: nombreProducto || 'Producto a elaborar',
    unidad: unidadProducto,
    cantidad: 12,
    elaborado_en: new Date().toISOString(),
    vence_el: vidaUtil > 0 ? isoMasDias(hoyIso(), vidaUtil) : null,
    lote_id: null,
    vida_util_dias: vidaUtil,
    ingredientes: ingredientesEtiqueta.trim() || ingredientesAuto,
    alergenos: alergenos.trim() || null,
    conservacion: conservacion.trim() || CONSERVACION_POR_DEFECTO,
    elaborado_por: usuario?.nombre ?? null,
  }

  const puedeGuardar =
    !!productoId && rendimiento > 0 && ingredientes.length > 0 && !guardar.isPending

  if (!esNueva && isLoading) {
    return (
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-10 text-center text-[#6f3a2a] text-sm">
        Cargando la receta…
      </div>
    )
  }

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e4c9b0]/40 bg-[#fdfaf6]">
        <h2 className="text-[#391511] font-bold text-lg">
          {esNueva ? 'Nueva receta' : nombreProducto}
        </h2>
        <p className="text-xs text-[#6f3a2a] mt-0.5">
          Lo que se elabora, con qué, cuánto cuesta y qué dice la etiqueta.
        </p>
      </div>

      <div className="p-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        {/* ── Columna principal ── */}
        <div className="space-y-5 min-w-0">
          {/* Qué se elabora */}
          <section className="space-y-3">
            <h3 className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Qué se elabora
            </h3>
            {esNueva ? (
              <select
                value={productoId ?? ''}
                onChange={(e) => {
                  const p = elaborables?.find(
                    (x) => x.id === Number(e.target.value)
                  )
                  if (p) elegirProducto(p)
                }}
                className="w-full h-10 rounded-lg border border-[#e4c9b0] bg-white px-3 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
              >
                <option value="">
                  Elegí una preparación intermedia o elaboración propia…
                </option>
                {(elaborables ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} ({etiquetaTipo(p.tipo)} · {p.unidad})
                  </option>
                ))}
              </select>
            ) : (
              <div className="h-10 flex items-center px-3 rounded-lg bg-[#fdfaf6] border border-[#e4c9b0]/60 text-sm text-[#391511]">
                {nombreProducto}
              </div>
            )}
            {esNueva && (elaborables?.length ?? 0) === 0 && (
              <p className="text-xs text-[#c45e14] leading-snug">
                No tenés productos marcados como “Elaboración propia” o
                “Preparación intermedia”. Marcá el producto que vas a hacer en
                Configuración › Productos (campo{' '}
                <span className="font-medium">Tipo</span>) y volvé acá.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[#6f3a2a] text-xs">
                  Rinde ({unidadProducto})
                </Label>
                <InputNumero
                  min={0}
                  step="0.001"
                  value={rendimiento}
                  onChange={setRendimiento}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[#6f3a2a] text-xs">Vida útil (días)</Label>
                <InputNumero min={0} value={vidaUtil} onChange={setVidaUtil} />
              </div>
            </div>
            {vidaUtil === 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-[#c43e2c]/40 bg-[#c43e2c]/10 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-[#c43e2c] shrink-0 mt-0.5" />
                <p className="text-xs text-[#9e2f25] leading-snug">
                  Con vida útil 0 el lote vence el mismo día que se elabora y la
                  etiqueta sale sin fecha útil. Cargá al menos 1 día.
                </p>
              </div>
            )}
          </section>

          {/* Ingredientes */}
          <section className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Ingredientes
            </h3>
            {ingredientes.length > 0 && (
              <div className="space-y-2">
                {ingredientes.map((ing, idx) => {
                  const costo = lineas[idx]?.costo ?? 0
                  const pct = costoTanda > 0 ? (costo / costoTanda) * 100 : 0
                  return (
                    <div
                      key={ing.insumo_id}
                      className="rounded-lg border border-[#e4c9b0]/60 bg-white p-2 space-y-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-[#391511] truncate">
                            {ing.nombre}
                          </div>
                          <div className="text-[10px] text-[#c8a58a]">
                            stock en {ing.unidad_stock}
                          </div>
                        </div>
                        <InputNumero
                          min={0}
                          step="0.0001"
                          value={ing.cantidad}
                          onChange={(n) => actualizarIng(idx, { cantidad: n })}
                          className="w-24"
                        />
                        <select
                          value={ing.unidad}
                          onChange={(e) =>
                            actualizarIng(idx, { unidad: e.target.value })
                          }
                          className="h-9 rounded-lg border border-[#e4c9b0] bg-white px-2 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
                        >
                          {unidadesCompatibles(ing.unidad_stock).map((u) => (
                            <option key={u} value={u}>
                              {u}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1">
                          <InputNumero
                            min={0}
                            max={99}
                            value={ing.merma_pct}
                            onChange={(n) => actualizarIng(idx, { merma_pct: n })}
                            className="w-16"
                            title="Merma %"
                          />
                          <span className="text-xs text-[#c8a58a]">%</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => quitarIng(idx)}
                          className="text-[#c43e2c] hover:bg-[#c43e2c]/10 h-8 w-8 shrink-0"
                          aria-label="Quitar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* Cuánto pesa este ingrediente en el costo de la tanda */}
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-[#fdfaf6] overflow-hidden">
                          <div
                            className="h-full bg-[#f9b44c]"
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="text-[11px] tabular-nums text-[#6f3a2a] w-28 text-right">
                          <MontoARS monto={costo} /> · {pct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <BuscadorInsumo
              tipos={['insumo', 'semi_elaborado']}
              excluidos={[
                ...ingredientes.map((i) => i.insumo_id),
                ...(productoId ? [productoId] : []),
              ]}
              onSeleccionar={agregarIngrediente}
            />
          </section>

          {/* Preparación */}
          <section className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Cómo se prepara
            </h3>
            <textarea
              value={pasos}
              onChange={(e) => setPasos(e.target.value)}
              rows={5}
              placeholder={'Un paso por línea.\nEj: Tostar el pan de miga.\nUntar mayonesa en las dos tapas.'}
              className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
            />
            {pasos.trim() && (
              <ol className="list-decimal list-inside space-y-0.5 text-sm text-[#6f3a2a] bg-[#fdfaf6] rounded-lg p-3">
                {pasos
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((linea, i) => (
                    <li key={i}>{linea}</li>
                  ))}
              </ol>
            )}
          </section>
        </div>

        {/* ── Columna lateral: números y etiqueta ── */}
        <div className="space-y-4">
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-[#fdfaf6] p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Números
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[#6f3a2a]">Costo de la tanda</span>
              <MontoARS monto={costoTanda} className="font-semibold text-[#391511]" />
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[#6f3a2a]">Costo por {unidadProducto}</span>
              <MontoARS
                monto={costoUnitario}
                className="text-lg font-bold text-[#391511]"
              />
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[#6f3a2a]">Precio de venta</span>
              <MontoARS monto={precioVenta} className="text-[#391511]" />
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-[#6f3a2a]">Margen</span>
              <span
                className={cn(
                  'font-bold tabular-nums',
                  precioVenta <= 0
                    ? 'text-[#c8a58a]'
                    : margen >= 50
                      ? 'text-[#2f8f4e]'
                      : margen >= 30
                        ? 'text-[#c45e14]'
                        : 'text-[#c43e2c]'
                )}
              >
                {precioVenta > 0 ? `${formatearNumero(margen)}%` : '—'}
              </span>
            </div>
            <p className="text-[10px] text-[#c8a58a] leading-snug pt-1 border-t border-[#e4c9b0]/40">
              Costo calculado con el precio de costo de cada insumo. Al guardar,
              el sistema lo recalcula en cascada incluyendo las preparaciones
              intermedias.
            </p>
          </div>

          {/* Datos de la etiqueta */}
          <div className="rounded-xl border border-[#e4c9b0]/60 bg-white p-3 space-y-3">
            <div className="flex items-center gap-1.5">
              <Printer className="h-3.5 w-3.5 text-[#f9b44c]" />
              <span className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Qué dice la etiqueta
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[#6f3a2a] text-xs">Conservación</Label>
              <Input
                value={conservacion}
                onChange={(e) => setConservacion(e.target.value)}
                placeholder={CONSERVACION_POR_DEFECTO}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] text-sm"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[#6f3a2a] text-xs">Alérgenos</Label>
              <Input
                value={alergenos}
                onChange={(e) => setAlergenos(e.target.value)}
                placeholder="Gluten, leche, huevo…"
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] text-sm"
              />
              <div className="flex flex-wrap gap-1">
                {ALERGENOS_FRECUENTES.map((a) => {
                  const activo = alergenos
                    .toLowerCase()
                    .split(',')
                    .map((x) => x.trim())
                    .includes(a.toLowerCase())
                  return (
                    <button
                      key={a}
                      type="button"
                      onClick={() => alternarAlergeno(a)}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                        activo
                          ? 'border-[#c43e2c]/40 bg-[#c43e2c]/10 text-[#9e2f25] font-semibold'
                          : 'border-[#e4c9b0] text-[#6f3a2a] hover:border-[#f9b44c]'
                      )}
                    >
                      {a}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[#6f3a2a] text-xs">
                Texto de ingredientes
              </Label>
              <textarea
                value={ingredientesEtiqueta}
                onChange={(e) => setIngredientesEtiqueta(e.target.value)}
                rows={3}
                placeholder={ingredientesAuto || 'Se arma solo con los ingredientes'}
                className="w-full rounded-lg border border-[#e4c9b0] bg-white px-3 py-2 text-sm text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]"
              />
              <p className="text-[10px] text-[#c8a58a] leading-snug">
                Vacío = se arma con los ingredientes de arriba. Escribilo a mano
                si querés otro orden o desglosar una preparación intermedia.
              </p>
            </div>
          </div>

          {/* Vista previa real de la etiqueta */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Vista previa · bandeja
            </div>
            <div className="overflow-x-auto">
              <div className="w-max">
                <EtiquetaElaboracion
                  datos={previewEtiqueta}
                  variante="bandeja"
                  opciones={{
                    ingredientes: true,
                    alergenos: true,
                    conservacion: true,
                    elaborador: true,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 px-5 py-3 border-t border-[#e4c9b0]/40 bg-[#fdfaf6] flex items-center justify-between gap-3">
        <p className="text-xs text-[#c45e14]">
          {!productoId
            ? 'Elegí el producto a elaborar para poder guardar.'
            : ingredientes.length === 0
              ? 'Agregá al menos un ingrediente.'
              : rendimiento <= 0
                ? 'Completá el rinde (debe ser mayor a 0).'
                : ''}
        </p>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={onCancelar}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleGuardar}
            disabled={!puedeGuardar}
            className="bg-[#391511] hover:bg-[#4a1d16] text-white"
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar receta'}
          </Button>
        </div>
      </div>
    </div>
  )
}
