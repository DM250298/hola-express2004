'use client'

import { useMemo, useState } from 'react'
import { LayoutGrid, List, Plus, Snowflake, Warehouse } from 'lucide-react'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { ETIQUETA_MUEBLE, esFrio } from '@/lib/queries/ubicaciones'
import { cn } from '@/lib/utils'
import { formatearMontoEntero, formatearNumero } from '@/lib/utils/formato'
import type { ArbolUbicaciones, NodoUbicacion } from '@/lib/queries/ubicaciones'
import type { ColorSemaforo, NodoMapa } from '@/lib/queries/mapa'

export type ModoVista = 'mapa' | 'lista'

const BORDE: Record<ColorSemaforo, string> = {
  rojo: 'border-[#c43e2c]/60',
  amarillo: 'border-[#e4a42a]/70',
  verde: 'border-[#2f7d4f]/40',
  gris: 'border-[#e4c9b0]',
}

function recolectar(nodos: NodoUbicacion[], tipo: NodoUbicacion['tipo']): NodoUbicacion[] {
  const salida: NodoUbicacion[] = []
  for (const n of nodos) {
    if (n.tipo === tipo) salida.push(n)
    else salida.push(...recolectar(n.hijos, tipo))
  }
  return salida
}

/** Una fila de chips con los hijos de un nodo (módulos o estantes). */
function HijosDe({
  padre,
  titulo,
  tipoNuevo,
  metricas,
  seleccionado,
  marcado,
  onSeleccionar,
  puedeEditar,
  onCrear,
}: {
  padre: NodoUbicacion
  titulo: string
  tipoNuevo: NodoUbicacion['tipo']
  metricas: Map<number, NodoMapa>
  seleccionado: number | null
  marcado: number | null
  onSeleccionar: (id: number) => void
  puedeEditar: boolean
  onCrear: (padre: NodoUbicacion, tipo: NodoUbicacion['tipo']) => void
}) {
  const hijos = padre.hijos.filter((h) => h.activo)
  return (
    <div className="mt-4 border-t border-[#e4c9b0]/60 pt-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
        {titulo}
      </p>
      <div className="flex flex-wrap gap-2">
        {hijos.map((e) => {
          const m = metricas.get(e.id)
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onSeleccionar(e.id)}
              className={cn(
                'rounded-lg border-2 bg-white px-3 py-2 text-left text-sm',
                BORDE[m?.semaforo ?? 'gris'],
                (seleccionado === e.id || marcado === e.id) && 'ring-2 ring-[#f9b44c]'
              )}
            >
              <span className="font-semibold text-[#391511]">{e.nombre}</span>
              <span className="ml-1.5 text-xs text-[#6f3a2a]">
                {formatearNumero(e.productos_total)}
              </span>
            </button>
          )
        })}
        {hijos.length === 0 && <span className="text-sm text-[#c8a58a]">Todavía vacío.</span>}
        {puedeEditar && (
          <button
            type="button"
            onClick={() => onCrear(padre, tipoNuevo)}
            className="flex items-center gap-1 rounded-lg border-2 border-dashed border-[#e4c9b0] px-3 py-2 text-sm text-[#6f3a2a] hover:border-[#e4a42a]"
          >
            <Plus className="h-4 w-4" /> Agregar {tipoNuevo === 'modulo' ? 'módulo' : 'estante'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Panel central del mapa. "Mapa": un bloque por sector con sus góndolas en
 * tarjetas (borde con el color del semáforo) y, al elegir una góndola, sus
 * estantes. "Lista": el árbol clásico con números.
 */
export function VistaUbicaciones({
  arbol,
  metricas,
  seleccionado,
  onSeleccionar,
  puedeEditar,
  onCrear,
  modo,
  onModo,
  lista,
}: {
  arbol: ArbolUbicaciones
  metricas: Map<number, NodoMapa>
  seleccionado: number | null
  onSeleccionar: (id: number) => void
  puedeEditar: boolean
  onCrear: (padre: NodoUbicacion, tipo: NodoUbicacion['tipo']) => void
  modo: ModoVista
  onModo: (m: ModoVista) => void
  lista: React.ReactNode
}) {
  const [filtro, setFiltro] = useState<'todo' | 'seco' | 'frio'>('todo')
  const { data: categorias } = useCategorias()
  const nombreCategoria = (id: number | null) =>
    id == null ? null : (categorias?.find((c) => c.id === id)?.nombre ?? null)
  const sectores = useMemo(
    () => recolectar(arbol.raices, 'sector').filter((s) => s.activo),
    [arbol]
  )
  const pasaFiltro = (g: NodoUbicacion) =>
    filtro === 'todo' || (filtro === 'frio' ? esFrio(g.tipo_mueble) : !esFrio(g.tipo_mueble))
  const raiz = arbol.raices[0]

  // Módulo activo: el seleccionado, o el que contiene al estante seleccionado.
  const moduloActivo = useMemo(() => {
    const porId = new Map(arbol.planas.map((u) => [u.id, u]))
    const sel = seleccionado != null ? porId.get(seleccionado) : undefined
    if (sel?.tipo === 'modulo') return sel.id
    if (sel?.tipo === 'estante' && sel.parent_id != null) {
      return porId.get(sel.parent_id)?.tipo === 'modulo' ? sel.parent_id : null
    }
    return null
  }, [arbol, seleccionado])
  const moduloNodo = useMemo(() => {
    const buscar = (ns: NodoUbicacion[]): NodoUbicacion | null => {
      for (const n of ns) {
        if (n.id === moduloActivo) return n
        const h = buscar(n.hijos)
        if (h) return h
      }
      return null
    }
    return moduloActivo == null ? null : buscar(arbol.raices)
  }, [arbol, moduloActivo])

  // Góndola activa: la seleccionada o la que contiene al nodo seleccionado.
  const gondolaActiva = useMemo(() => {
    const porId = new Map(arbol.planas.map((u) => [u.id, u]))
    let actual = seleccionado != null ? porId.get(seleccionado) : undefined
    while (actual && actual.tipo !== 'gondola') {
      actual = actual.parent_id != null ? porId.get(actual.parent_id) : undefined
    }
    return actual?.id ?? null
  }, [arbol, seleccionado])

  return (
    <section className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-[#391511]">{raiz?.nombre ?? 'Local'}</h2>
          <p className="text-xs text-[#6f3a2a]">
            {modo === 'mapa' ? 'Góndolas por sector' : 'Todas las ubicaciones'}
          </p>
        </div>
        {modo === 'mapa' && (
          <div className="flex rounded-xl border border-[#e4c9b0] bg-white p-0.5 text-xs">
            {(['todo', 'seco', 'frio'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFiltro(f)}
                className={cn(
                  'rounded-lg px-2.5 py-1 font-semibold',
                  filtro === f ? 'bg-[#391511] text-white' : 'text-[#6f3a2a]'
                )}
              >
                {f === 'todo' ? 'Todo' : f === 'seco' ? 'Seco' : 'Frío'}
              </button>
            ))}
          </div>
        )}
        <div className="flex rounded-xl border border-[#e4c9b0] bg-[#fdfaf6] p-0.5">
          {(['mapa', 'lista'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModo(m)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold',
                modo === m ? 'bg-[#f9b44c] text-[#391511]' : 'text-[#6f3a2a]'
              )}
            >
              {m === 'mapa' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
              {m === 'mapa' ? 'Mapa' : 'Lista'}
            </button>
          ))}
        </div>
      </div>

      {modo === 'lista' ? (
        lista
      ) : sectores.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e4c9b0] p-8 text-center text-sm text-[#6f3a2a]">
          Todavía no hay sectores. Creá uno desde el panel de ubicaciones.
        </div>
      ) : (
        <div className="space-y-4">
          {sectores.map((sector) => {
            const gondolas = recolectar(sector.hijos, 'gondola').filter(
              (g) => g.activo && pasaFiltro(g)
            )
            if (gondolas.length === 0 && filtro !== 'todo') return null
            const activa = gondolas.find((g) => g.id === gondolaActiva)
            return (
              <div
                key={sector.id}
                className={cn(
                  'rounded-2xl border p-4',
                  seleccionado === sector.id
                    ? 'border-[#e4a42a] bg-[#f9b44c]/10'
                    : 'border-[#e4c9b0]/60 bg-[#fdfaf6]'
                )}
              >
                <button
                  type="button"
                  onClick={() => onSeleccionar(sector.id)}
                  className="mb-3 flex items-center gap-2 text-left"
                >
                  <Warehouse className="h-5 w-5 text-[#6f3a2a]" />
                  <span className="font-semibold text-[#391511]">{sector.nombre}</span>
                  <span className="text-xs text-[#6f3a2a]">
                    {formatearNumero(gondolas.length)} {gondolas.length === 1 ? 'góndola' : 'góndolas'}
                  </span>
                </button>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {gondolas.map((g) => {
                    const m = metricas.get(g.id)
                    const elegida = g.id === gondolaActiva
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => onSeleccionar(g.id)}
                        className={cn(
                          'rounded-xl border-2 bg-white p-3 text-left transition hover:shadow-sm',
                          BORDE[m?.semaforo ?? 'gris'],
                          elegida && 'ring-2 ring-[#f9b44c] ring-offset-1',
                          !g.activo && 'opacity-50'
                        )}
                      >
                        <p className="flex items-center gap-1.5 font-semibold text-[#391511]">
                          {esFrio(g.tipo_mueble) && (
                            <Snowflake className="h-3.5 w-3.5 shrink-0 text-[#1e5fb0]" />
                          )}
                          <span className="truncate">{g.nombre}</span>
                        </p>
                        {(g.tipo_mueble || g.categoria_id != null) && (
                          <p className="truncate text-[11px] text-[#9e6b15]">
                            {[
                              g.tipo_mueble ? ETIQUETA_MUEBLE[g.tipo_mueble] : null,
                              nombreCategoria(g.categoria_id),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        <p className="mt-0.5 text-xs text-[#6f3a2a]">
                          {g.productos_total > 0
                            ? `${formatearNumero(g.productos_total)} productos`
                            : 'Sin productos'}
                          {g.hijos.some((h) => h.activo) &&
                            ` · ${formatearNumero(g.hijos.filter((h) => h.activo).length)} ${
                              g.hijos.some((h) => h.tipo === 'modulo') ? 'módulos' : 'estantes'
                            }`}
                        </p>
                        {m && m.ingresos > 0 && (
                          <p className="mt-1 text-sm font-semibold tabular-nums text-[#391511]">
                            {formatearMontoEntero(m.ingresos)}
                          </p>
                        )}
                        {m && (m.alertas_criticas > 0 || m.alertas_atencion > 0) && (
                          <p className="mt-0.5 text-[11px] font-semibold text-[#9e2f25]">
                            {formatearNumero(m.alertas_criticas + m.alertas_atencion)} alertas
                          </p>
                        )}
                      </button>
                    )
                  })}
                  {puedeEditar && (
                    <button
                      type="button"
                      onClick={() => onCrear(sector, 'gondola')}
                      className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-[#e4c9b0] text-sm text-[#6f3a2a] hover:border-[#e4a42a]"
                    >
                      <Plus className="h-5 w-5" /> Agregar góndola
                    </button>
                  )}
                </div>

                {activa && (
                  <HijosDe
                    padre={activa}
                    titulo={`${activa.hijos.some((h) => h.tipo === 'modulo') ? 'Módulos' : 'Estantes'} de ${activa.nombre}`}
                    tipoNuevo={activa.hijos.some((h) => h.tipo === 'modulo') ? 'modulo' : 'estante'}
                    metricas={metricas}
                    seleccionado={seleccionado}
                    marcado={moduloActivo}
                    onSeleccionar={onSeleccionar}
                    puedeEditar={puedeEditar}
                    onCrear={onCrear}
                  />
                )}
                {activa && moduloNodo && moduloNodo.parent_id === activa.id && (
                  <HijosDe
                    padre={moduloNodo}
                    titulo={`Estantes de ${moduloNodo.nombre}`}
                    tipoNuevo="estante"
                    metricas={metricas}
                    seleccionado={seleccionado}
                    marcado={null}
                    onSeleccionar={onSeleccionar}
                    puedeEditar={puedeEditar}
                    onCrear={onCrear}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
