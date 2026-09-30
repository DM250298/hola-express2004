'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BellRing,
  ChartColumn,
  ListChecks,
  Loader2,
  MapPin,
  MapPinOff,
  Plus,
  ScanLine,
  Tag,
  Tags,
  Trash2,
  Truck,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { formatearFechaCortaISO, formatearNumero } from '@/lib/utils/formato'
import { useArbolUbicaciones } from '@/lib/hooks/useMapa'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { useMarcas } from '@/lib/hooks/useMarcas'
import { useProveedores } from '@/lib/hooks/useProveedores'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import { useVistaPreviaTareas } from '@/lib/hooks/useConteoFisico'
import { heredado, rutaUbicacion } from '@/lib/queries/ubicaciones'
import type { TareaNueva } from '@/lib/queries/conteoFisico'
import {
  AYUDA_TIPO_TAREA,
  CLASES_CONTEO,
  ETIQUETA_TIPO_TAREA,
  REGLAS_ALERTA_STOCK,
  aTareasNuevas,
  criteriosVacios,
  etiquetasCriterios,
  limpiarCriterios,
  nombreSugerido,
  nuevaClave,
  tipoDeCriterios,
  type NombresCriterios,
  type TareaBorrador,
} from '@/lib/conteo/tareas'
import type {
  ClaseConteo,
  ConteoTareaResultado,
  CriteriosConteo,
} from '@/types/database'
import { SelectorAreas } from './SelectorAreas'
import { SelectorLista } from './SelectorLista'
import { SelectorPersonas } from './SelectorPersonas'

type Criterio =
  | 'area'
  | 'proveedor'
  | 'clase'
  | 'categoria'
  | 'marca'
  | 'alerta'
  | 'sin_ubicar'

const CRITERIOS: { clave: Criterio; etiqueta: string; icono: LucideIcon }[] = [
  { clave: 'area', etiqueta: 'Área del local', icono: MapPin },
  { clave: 'proveedor', etiqueta: 'Proveedor', icono: Truck },
  { clave: 'clase', etiqueta: 'Clase ABC', icono: ChartColumn },
  { clave: 'categoria', etiqueta: 'Categoría', icono: Tags },
  { clave: 'marca', etiqueta: 'Marca', icono: Tag },
  { clave: 'alerta', etiqueta: 'Con alerta', icono: BellRing },
  { clave: 'sin_ubicar', etiqueta: 'Sin ubicar', icono: MapPinOff },
]

/** Días a partir de los cuales la clase ABC se considera vieja. */
const DIAS_ABC_VIEJA = 3

interface Props {
  borradores: TareaBorrador[]
  onCambio: (borradores: TareaBorrador[]) => void
  /**
   * true = la lista se puede confirmar: hay tareas, la base ya contó cuántos
   * productos le tocan a cada una y ninguna quedó vacía.
   */
  onValidez: (valido: boolean) => void
}

/** Devuelve el valor recién cuando dejó de cambiar por `ms`. */
function useRetardo(valor: string, ms: number): string {
  const [quieto, setQuieto] = useState(valor)
  useEffect(() => {
    const timer = setTimeout(() => setQuieto(valor), ms)
    return () => clearTimeout(timer)
  }, [valor, ms])
  return quieto
}

function plural(n: number, uno: string, varios: string): string {
  return `${formatearNumero(n)} ${n === 1 ? uno : varios}`
}

/** Lo que la base contó para una tarea, en palabras. */
function ResumenTarea({
  resultado,
  personas,
}: {
  resultado: ConteoTareaResultado | undefined
  personas: number
}) {
  if (!resultado) {
    return <p className="text-xs text-[#c8a58a]">Calculando…</p>
  }
  if (resultado.libre) {
    return (
      <p className="text-xs text-[#6f3a2a]">{AYUDA_TIPO_TAREA.libre}</p>
    )
  }
  if (resultado.productos === 0) {
    return (
      <p className="flex items-start gap-1 text-xs font-semibold text-[#c43e2c]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {resultado.en_criterio === 0
          ? 'Ningún producto cumple este criterio.'
          : `Sus ${plural(resultado.en_criterio, 'producto ya es', 'productos ya son')} de otra tarea: quitala o cambiá el criterio.`}
      </p>
    )
  }
  return (
    <div className="space-y-0.5 text-xs text-[#6f3a2a]">
      <p>
        <strong className="text-[#391511]">
          {plural(resultado.productos, 'producto', 'productos')}
        </strong>
        {resultado.partes > 1 &&
          ` · en ${resultado.partes} partes: ${resultado.por_parte.join(' · ')}`}
        {resultado.ya_asignados > 0 &&
          ` · ${plural(resultado.ya_asignados, 'ya es', 'ya son')} de otra tarea`}
      </p>
      {personas > resultado.partes && resultado.partes > 0 && (
        <p>
          Alcanza para {plural(resultado.partes, 'persona', 'personas')}: al
          resto no le toca nada.
        </p>
      )}
      {resultado.tipo === 'area' && resultado.con_otros_lugares > 0 && (
        <p className="flex items-start gap-1 text-[#a3641c]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {plural(
            resultado.con_otros_lugares,
            'vive también en otro lugar',
            'viven también en otro lugar'
          )}
          . Si ese lugar no se cuenta, quedan contados a medias.
        </p>
      )}
    </div>
  )
}

/**
 * Armado de tareas de conteo. Se tildan uno o más criterios (combinados
 * filtran a la vez), se elige quién cuenta y la tarea pasa a la lista. Las
 * cantidades las calcula la base con las reglas reales de la creación.
 */
export function ConstructorTareas({ borradores, onCambio, onValidez }: Props) {
  const { data: arbol } = useArbolUbicaciones()
  const { data: proveedores } = useProveedores()
  const { data: categorias } = useCategorias()
  const { data: marcas } = useMarcas()
  const { data: usuarios } = useUsuariosActivos()

  // Formulario de la tarea nueva.
  const [activos, setActivos] = useState<Set<Criterio>>(new Set())
  const [areas, setAreas] = useState<number[]>([])
  const [unaPorArea, setUnaPorArea] = useState(true)
  const [provs, setProvs] = useState<number[]>([])
  const [cats, setCats] = useState<number[]>([])
  const [marcasSel, setMarcasSel] = useState<number[]>([])
  const [clases, setClases] = useState<ClaseConteo[]>([])
  const [reglas, setReglas] = useState<string[]>([])
  const [personas, setPersonas] = useState<string[]>([])
  const [nombre, setNombre] = useState('')

  // Zona libre (sin lista).
  const [libreAbierta, setLibreAbierta] = useState(false)
  const [libreNombre, setLibreNombre] = useState('')
  const [librePersona, setLibrePersona] = useState<string[]>([])

  const hayMapa = !!arbol && arbol.planas.some((u) => u.activo && u.tipo !== 'sucursal')

  const nombres: NombresCriterios = useMemo(() => {
    const planas = arbol?.planas ?? []
    const porId = new Map(planas.map((u) => [u.id, u]))
    const ubicaciones = new Map<number, string>()
    for (const u of planas) {
      // Un estante se entiende con su góndola delante; un sector o una
      // góndola, con su nombre solo.
      const padre = u.parent_id != null ? porId.get(u.parent_id) : undefined
      const corto =
        (u.tipo === 'estante' || u.tipo === 'modulo') && padre
          ? rutaUbicacion(u.id, planas)
              .split(' › ')
              .slice(u.tipo === 'estante' && padre.tipo === 'modulo' ? -3 : -2)
              .join(' › ')
          : u.nombre
      ubicaciones.set(u.id, corto)
    }
    return {
      ubicaciones,
      proveedores: new Map((proveedores ?? []).map((p) => [p.id, p.nombre])),
      categorias: new Map((categorias ?? []).map((c) => [c.id, c.nombre])),
      marcas: new Map((marcas ?? []).map((m) => [m.id, m.nombre])),
    }
  }, [arbol, proveedores, categorias, marcas])

  const nombrePersona = useMemo(
    () => new Map((usuarios ?? []).map((u) => [u.id, u.nombre])),
    [usuarios]
  )

  function alternarCriterio(c: Criterio) {
    setActivos((prev) => {
      const n = new Set(prev)
      if (n.has(c)) {
        n.delete(c)
      } else {
        n.add(c)
        // Un producto sin ubicar no está en ningún área: no se combinan.
        if (c === 'area') n.delete('sin_ubicar')
        if (c === 'sin_ubicar') n.delete('area')
      }
      return n
    })
  }

  // Lo que el formulario filtra sin contar el área.
  const base: CriteriosConteo = useMemo(
    () =>
      limpiarCriterios({
        proveedor_ids: activos.has('proveedor') ? provs : [],
        categoria_ids: activos.has('categoria') ? cats : [],
        marca_ids: activos.has('marca') ? marcasSel : [],
        clases_abc: activos.has('clase') ? clases : [],
        reglas_alerta: activos.has('alerta') ? reglas : [],
        sin_ubicar: activos.has('sin_ubicar'),
      }),
    [activos, provs, cats, marcasSel, clases, reglas]
  )
  const areasActivas = useMemo(
    () => (activos.has('area') ? areas : []),
    [activos, areas]
  )
  const separadas = unaPorArea && areasActivas.length > 1

  // Las tareas que saldrían del formulario tal como está.
  const delFormulario: TareaBorrador[] = useMemo(() => {
    /** Sin nadie elegido, cada área va para su responsable del mapa. */
    const responsablesDe = (ids: number[]): string[] => {
      if (personas.length > 0) return personas
      if (ids.length !== 1 || !arbol) return []
      const resp = heredado(ids[0], arbol.planas, 'responsable_id')
      return resp && nombrePersona.has(resp) ? [resp] : []
    }
    const grupos = separadas
      ? areasActivas.map((id) => [id])
      : areasActivas.length > 0
        ? [areasActivas]
        : [[] as number[]]
    return grupos
      .map((ids) => {
        const criterios = limpiarCriterios({ ...base, ubicacion_ids: ids })
        return {
          clave: `form-${ids.join('-')}`,
          nombre:
            !separadas && nombre.trim() !== ''
              ? nombre.trim()
              : nombreSugerido(criterios, nombres),
          responsables: responsablesDe(ids),
          criterios,
        }
      })
      .filter((t) => !criteriosVacios(t.criterios))
  }, [areasActivas, separadas, base, nombre, nombres, personas, arbol, nombrePersona])

  // Una sola consulta para todo: lo armado primero, el formulario después.
  // Así el formulario ya sabe qué le dejaron las tareas de arriba.
  const pedido: TareaNueva[] = useMemo(
    () =>
      aTareasNuevas([...borradores, ...delFormulario]).map((t) => ({
        ...t,
        nombre: t.nombre === '' ? 'Tarea' : t.nombre,
      })),
    [borradores, delFormulario]
  )
  const clavePedido = JSON.stringify(pedido)
  const claveQuieta = useRetardo(clavePedido, 350)
  const pedidoQuieto: TareaNueva[] = useMemo(
    () => JSON.parse(claveQuieta) as TareaNueva[],
    [claveQuieta]
  )
  const vista = useVistaPreviaTareas(pedidoQuieto)

  const faltanMigraciones = vista.data === null
  const alDia =
    claveQuieta === clavePedido && !vista.isPlaceholderData && !vista.isFetching
  const resultados = vista.data?.tareas ?? []
  const resultadoDe = (indice: number) =>
    alDia ? resultados.find((r) => r.indice === indice) : undefined

  const hayVacia =
    alDia &&
    borradores.some((_, i) => {
      const r = resultadoDe(i)
      return !!r && !r.libre && r.productos === 0
    })
  const valido =
    borradores.length > 0 &&
    borradores.every((b) => b.nombre.trim() !== '') &&
    (faltanMigraciones || (alDia && !vista.isError && !hayVacia))

  useEffect(() => {
    onValidez(valido)
  }, [valido, onValidez])

  function limpiarFormulario() {
    setActivos(new Set())
    setAreas([])
    setProvs([])
    setCats([])
    setMarcasSel([])
    setClases([])
    setReglas([])
    setPersonas([])
    setNombre('')
  }

  function agregarDelFormulario() {
    if (delFormulario.length === 0) return
    onCambio([
      ...borradores,
      ...delFormulario.map((t) => ({ ...t, clave: nuevaClave() })),
    ])
    limpiarFormulario()
  }

  function agregarLibre() {
    const limpio = libreNombre.trim()
    if (!limpio) return
    onCambio([
      ...borradores,
      {
        clave: nuevaClave(),
        nombre: limpio,
        responsables: librePersona,
        criterios: null,
      },
    ])
    setLibreNombre('')
    setLibrePersona([])
    setLibreAbierta(false)
  }

  function actualizar(clave: string, cambio: Partial<TareaBorrador>) {
    onCambio(borradores.map((b) => (b.clave === clave ? { ...b, ...cambio } : b)))
  }

  function mover(indice: number, delta: number) {
    const destino = indice + delta
    if (destino < 0 || destino >= borradores.length) return
    const copia = [...borradores]
    const [tarea] = copia.splice(indice, 1)
    copia.splice(destino, 0, tarea)
    onCambio(copia)
  }

  const formularioVacio = delFormulario.every((_, i) => {
    const r = resultadoDe(borradores.length + i)
    return !!r && r.productos === 0
  })
  const tipoFormulario = tipoDeCriterios(
    limpiarCriterios({ ...base, ubicacion_ids: areasActivas })
  )

  const fechaAbc = vista.data?.fecha_abc ?? null
  const diasAbc = fechaAbc
    ? Math.floor(
        (Date.now() - new Date(`${fechaAbc}T12:00:00`).getTime()) / 86_400_000
      )
    : null

  return (
    <div className="space-y-3">
      {faltanMigraciones && (
        <p className="flex items-start gap-2 rounded-xl border border-[#f9b44c] bg-[#f9b44c]/10 p-3 text-xs text-[#391511]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#a3641c]" />
          <span>
            <strong>Faltan correr las migraciones 222 a 228.</strong> Hasta
            entonces solo se pueden armar zonas libres (sin lista), como antes.
          </span>
        </p>
      )}

      {vista.isError && (
        <p className="flex items-start gap-2 rounded-xl border border-[#c43e2c]/40 bg-[#c43e2c]/10 p-3 text-xs text-[#c43e2c]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {vista.error instanceof Error
            ? vista.error.message
            : 'No se pudo calcular la vista previa.'}
        </p>
      )}

      {/* Tareas ya armadas */}
      {borradores.length > 0 && (
        <ol className="space-y-2">
          {borradores.map((b, i) => {
            const tipo = tipoDeCriterios(b.criterios)
            const etiquetas = etiquetasCriterios(b.criterios, nombres)
            return (
              <li
                key={b.clave}
                className="rounded-xl border border-[#e4c9b0]/70 bg-white p-2.5"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#391511] text-[11px] font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Input
                      value={b.nombre}
                      onChange={(e) => actualizar(b.clave, { nombre: e.target.value })}
                      aria-label={`Nombre de la tarea ${i + 1}`}
                      className="h-8 border-[#e4c9b0] font-semibold text-[#391511]"
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      <span
                        title={AYUDA_TIPO_TAREA[tipo]}
                        className="rounded-md bg-[#391511]/8 px-1.5 py-0.5 text-[11px] font-semibold text-[#391511]"
                      >
                        {ETIQUETA_TIPO_TAREA[tipo]}
                      </span>
                      {etiquetas.map((e) => (
                        <span
                          key={e}
                          className="rounded-md bg-[#f9b44c]/20 px-1.5 py-0.5 text-[11px] text-[#6f3a2a]"
                        >
                          {e}
                        </span>
                      ))}
                      <span className="text-[11px] text-[#6f3a2a]">
                        ·{' '}
                        {b.responsables.length === 0
                          ? 'la toma quien la inicie'
                          : b.responsables
                              .map((r) => nombrePersona.get(r) ?? 'Asignada')
                              .join(', ')}
                      </span>
                    </div>
                    {!faltanMigraciones && (
                      <ResumenTarea
                        resultado={resultadoDe(i)}
                        personas={b.responsables.length}
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      className="rounded p-1 text-[#6f3a2a] hover:bg-[#fdfaf6] disabled:opacity-25"
                      aria-label="Subir: que elija antes"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === borradores.length - 1}
                      className="rounded p-1 text-[#6f3a2a] hover:bg-[#fdfaf6] disabled:opacity-25"
                      aria-label="Bajar: que elija después"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCambio(borradores.filter((x) => x.clave !== b.clave))}
                    className="shrink-0 rounded-lg p-2 text-[#c43e2c] transition hover:bg-[#c43e2c]/10"
                    aria-label={`Quitar ${b.nombre}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {borradores.length > 1 && !faltanMigraciones && (
        <p className="text-[11px] text-[#6f3a2a]">
          El orden importa: si dos tareas piden el mismo producto, se lo queda
          la de más arriba.
        </p>
      )}

      {/* Tarea nueva */}
      {!faltanMigraciones && (
        <section className="space-y-3 rounded-2xl border border-[#e4c9b0]/70 bg-[#fdfaf6] p-3">
          <div>
            <p className="text-sm font-semibold text-[#391511]">
              {borradores.length === 0 ? '¿Qué se cuenta?' : 'Otra tarea: ¿qué se cuenta?'}
            </p>
            <p className="text-xs text-[#6f3a2a]">
              Tildá uno o varios. Combinados filtran a la vez: “Proveedor +
              Clase ABC” son los productos de ese proveedor que además son de
              esa clase.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {CRITERIOS.map(({ clave, etiqueta, icono: Icono }) => {
              const activo = activos.has(clave)
              const sinMapa = clave === 'area' && !hayMapa
              return (
                <button
                  key={clave}
                  type="button"
                  onClick={() => alternarCriterio(clave)}
                  disabled={sinMapa}
                  aria-pressed={activo}
                  title={sinMapa ? 'Todavía no hay áreas cargadas en el mapa del local' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-sm transition-colors disabled:opacity-40',
                    activo
                      ? 'border-[#391511] bg-[#391511] font-semibold text-white'
                      : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#f9b44c]'
                  )}
                >
                  <Icono className="h-3.5 w-3.5" />
                  {etiqueta}
                </button>
              )
            })}
          </div>

          {activos.has('area') && arbol && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[#391511]">
                Área del local
              </p>
              <SelectorAreas arbol={arbol} seleccionadas={areas} onCambio={setAreas} />
              {areas.length > 1 && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[#6f3a2a]">
                  <Switch checked={unaPorArea} onCheckedChange={setUnaPorArea} size="sm" />
                  Una tarea por cada área ({areas.length})
                </label>
              )}
            </div>
          )}

          {activos.has('proveedor') && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[#391511]">Proveedor</p>
              <SelectorLista
                opciones={proveedores ?? []}
                seleccionados={provs}
                onCambio={setProvs}
                placeholder="Buscar proveedor…"
                vacio="No hay proveedores cargados."
              />
            </div>
          )}

          {activos.has('clase') && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[#391511]">Clase ABC</p>
              <div className="flex flex-wrap gap-1.5">
                {CLASES_CONTEO.map((k) => {
                  const activo = clases.includes(k.clave)
                  return (
                    <button
                      key={k.clave}
                      type="button"
                      title={k.ayuda}
                      aria-pressed={activo}
                      onClick={() =>
                        setClases((prev) =>
                          activo ? prev.filter((c) => c !== k.clave) : [...prev, k.clave]
                        )
                      }
                      className={cn(
                        'rounded-xl border px-3 py-1.5 text-sm font-semibold transition-colors',
                        activo
                          ? 'border-[#f9b44c] bg-[#f9b44c]/25 text-[#391511]'
                          : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#f9b44c]'
                      )}
                    >
                      {k.etiqueta}
                    </button>
                  )
                })}
              </div>
              {alDia && fechaAbc === null && (
                <p className="flex items-start gap-1 text-xs text-[#a3641c]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Todavía no hay clasificación ABC calculada: todos los
                  productos figuran como “Sin ventas”.
                </p>
              )}
              {fechaAbc !== null && diasAbc !== null && diasAbc > DIAS_ABC_VIEJA && (
                <p className="flex items-start gap-1 text-xs text-[#a3641c]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  La clasificación es del {formatearFechaCortaISO(fechaAbc)}:
                  hace {diasAbc} días que no se actualiza.
                </p>
              )}
            </div>
          )}

          {activos.has('categoria') && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[#391511]">Categoría</p>
              <SelectorLista
                opciones={categorias ?? []}
                seleccionados={cats}
                onCambio={setCats}
                placeholder="Buscar categoría…"
                vacio="No hay categorías cargadas."
              />
            </div>
          )}

          {activos.has('marca') && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[#391511]">Marca</p>
              <SelectorLista
                opciones={marcas ?? []}
                seleccionados={marcasSel}
                onCambio={setMarcasSel}
                placeholder="Buscar marca…"
                vacio="No hay marcas cargadas."
              />
            </div>
          )}

          {activos.has('alerta') && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-[#391511]">
                Productos con una alerta abierta de…
              </p>
              <div className="flex flex-wrap gap-1.5">
                {REGLAS_ALERTA_STOCK.map((r) => {
                  const activo = reglas.includes(r.codigo)
                  return (
                    <button
                      key={r.codigo}
                      type="button"
                      aria-pressed={activo}
                      onClick={() =>
                        setReglas((prev) =>
                          activo ? prev.filter((c) => c !== r.codigo) : [...prev, r.codigo]
                        )
                      }
                      className={cn(
                        'rounded-xl border px-2.5 py-1.5 text-sm transition-colors',
                        activo
                          ? 'border-[#f9b44c] bg-[#f9b44c]/25 font-medium text-[#391511]'
                          : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#f9b44c]'
                      )}
                    >
                      {r.etiqueta}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {activos.has('sin_ubicar') && (
            <p className="rounded-xl bg-white px-3 py-2 text-xs text-[#6f3a2a]">
              Productos que el mapa del local todavía no tiene ubicados. Si no
              se mandan a contar aparte, un conteo por áreas los deja afuera.
            </p>
          )}

          {delFormulario.length > 0 && (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-[#391511]">
                  ¿Quién cuenta?
                </p>
                <SelectorPersonas
                  personas={usuarios ?? []}
                  seleccionadas={personas}
                  onCambio={setPersonas}
                />
                <p className="text-[11px] text-[#6f3a2a]">
                  {personas.length > 1
                    ? separadas
                      ? 'Cada área se reparte entre las personas elegidas, por tramos seguidos del recorrido.'
                      : 'La lista se reparte en partes iguales por tramos seguidos del recorrido, sin partir un estante.'
                    : personas.length === 1
                      ? 'Todo para una sola persona.'
                      : tipoFormulario === 'area'
                        ? 'Sin elegir a nadie, cada área va para su responsable del mapa; si no tiene, la toma quien la inicie.'
                        : 'Sin elegir a nadie, la toma quien la inicie.'}
                </p>
              </div>

              {!separadas && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-[#391511]">Nombre</p>
                  <Input
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder={delFormulario[0]?.nombre ?? 'Nombre de la tarea'}
                    className="h-9 border-[#e4c9b0] bg-white"
                  />
                </div>
              )}

              <div className="space-y-1.5 rounded-xl bg-white p-2.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[#391511]">
                  <ListChecks className="h-3.5 w-3.5" />
                  {ETIQUETA_TIPO_TAREA[tipoFormulario]} ·{' '}
                  <span className="font-normal text-[#6f3a2a]">
                    {AYUDA_TIPO_TAREA[tipoFormulario]}
                  </span>
                </p>
                {delFormulario.map((t, i) => (
                  <div key={t.clave} className="space-y-0.5">
                    {delFormulario.length > 1 && (
                      <p className="text-xs font-medium text-[#391511]">
                        {t.nombre}
                        <span className="font-normal text-[#6f3a2a]">
                          {' '}
                          ·{' '}
                          {t.responsables.length === 0
                            ? 'sin asignar'
                            : t.responsables
                                .map((r) => nombrePersona.get(r) ?? 'Asignada')
                                .join(', ')}
                        </span>
                      </p>
                    )}
                    <ResumenTarea
                      resultado={resultadoDe(borradores.length + i)}
                      personas={t.responsables.length}
                    />
                  </div>
                ))}
              </div>

              <Button
                type="button"
                onClick={agregarDelFormulario}
                disabled={!alDia || vista.isError || formularioVacio}
                className="w-full bg-[#391511] font-semibold text-white hover:bg-[#502019]"
              >
                {!alDia ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" />
                )}
                {delFormulario.length > 1
                  ? `Agregar ${delFormulario.length} tareas`
                  : 'Agregar tarea'}
              </Button>
            </>
          )}
        </section>
      )}

      {/* Zona libre */}
      {libreAbierta || faltanMigraciones ? (
        <section className="space-y-2 rounded-2xl border border-dashed border-[#e4c9b0] p-3">
          <p className="text-sm font-semibold text-[#391511]">Zona libre</p>
          <p className="text-xs text-[#6f3a2a]">
            Sin lista: quien cuenta escanea lo que encuentre. Sirve para un
            lugar que todavía no está en el mapa.
          </p>
          <Input
            value={libreNombre}
            onChange={(e) => setLibreNombre(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && agregarLibre()}
            placeholder="Ej: Exhibidor de la caja"
            className="h-9 border-[#e4c9b0] bg-white"
          />
          <SelectorPersonas
            personas={usuarios ?? []}
            seleccionadas={librePersona}
            onCambio={setLibrePersona}
            unica
          />
          <div className="flex gap-2">
            {!faltanMigraciones && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLibreAbierta(false)}
                className="border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cancelar
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={agregarLibre}
              disabled={libreNombre.trim() === ''}
              className="bg-[#391511] text-white hover:bg-[#502019]"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Agregar zona libre
            </Button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setLibreAbierta(true)}
          className="flex items-center gap-1.5 text-xs font-medium text-[#6f3a2a] underline-offset-2 hover:underline"
        >
          <ScanLine className="h-3.5 w-3.5" />
          Agregar una zona libre (sin lista)
        </button>
      )}
    </div>
  )
}
