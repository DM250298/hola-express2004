'use client'

import { useMemo, useState } from 'react'
import { ChevronRight, MapPin, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ArbolUbicaciones, NodoUbicacion } from '@/lib/queries/ubicaciones'

interface OpcionGondola {
  nodo: NodoUbicacion
  sector: string
}

interface OpcionEstante {
  id: number
  etiqueta: string
}

const BUSCADOR_DESDE = 8

/** Góndolas activas del árbol, con el nombre de su sector para agrupar. */
function recolectarGondolas(nodos: NodoUbicacion[], sector = ''): OpcionGondola[] {
  const salida: OpcionGondola[] = []
  for (const n of nodos) {
    if (!n.activo) continue
    if (n.tipo === 'gondola') salida.push({ nodo: n, sector })
    else salida.push(...recolectarGondolas(n.hijos, n.tipo === 'sector' ? n.nombre : sector))
  }
  return salida
}

/** Hijos activos de un nodo (módulos o estantes). */
function hijosDe(n: NodoUbicacion): OpcionEstante[] {
  return n.hijos.filter((h) => h.activo).map((h) => ({ id: h.id, etiqueta: h.nombre }))
}

/** Busca un nodo por id dentro del árbol. */
function buscarNodo(nodos: NodoUbicacion[], id: number | null): NodoUbicacion | null {
  if (id == null) return null
  for (const n of nodos) {
    if (n.id === id) return n
    const h = buscarNodo(n.hijos, id)
    if (h) return h
  }
  return null
}

/**
 * "¿Dónde estás parado?" en dos toques: primero la góndola, después el
 * estante (o toda la góndola). Reemplaza un select con todas las rutas, que
 * con muchas góndolas mareaba.
 */
export function SelectorUbicacionMovil({
  arbol,
  valor,
  onCambio,
}: {
  arbol: ArbolUbicaciones
  valor: number | null
  onCambio: (id: number | null) => void
}) {
  const gondolas = useMemo(() => recolectarGondolas(arbol.raices), [arbol])
  const [gondolaId, setGondolaId] = useState<number | null>(null)
  const [filtro, setFiltro] = useState('')

  const [moduloId, setModuloId] = useState<number | null>(null)
  const gondola = gondolas.find((g) => g.nodo.id === gondolaId) ?? null
  const modulo = gondola ? buscarNodo(gondola.nodo.hijos, moduloId) : null
  const elegido = gondola ? buscarNodo([gondola.nodo], valor) : null
  const migas = [
    gondola?.nodo.nombre,
    modulo && modulo.id !== valor ? modulo.nombre : null,
    elegido && elegido.id !== gondola?.nodo.id ? elegido.nombre : 'Toda la góndola',
  ].filter(Boolean)

  if (gondolas.length === 0) {
    return (
      <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 text-sm text-[#6f3a2a] shadow-sm">
        Todavía no hay góndolas. Creálas en el Mapa del local (escritorio).
      </div>
    )
  }

  // ── Paso 3: ya elegido → migas con "Cambiar" ──
  if (gondola && valor != null) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border-2 border-[#f9b44c]/60 bg-white px-4 py-3 shadow-sm">
        <MapPin className="h-4 w-4 shrink-0 text-[#9e6b15]" />
        <p className="min-w-0 flex-1 truncate font-semibold text-[#391511]">
          {migas.join(' › ')}
        </p>
        <button
          type="button"
          onClick={() => {
            setModuloId(null)
            onCambio(null)
          }}
          className="shrink-0 text-sm font-semibold text-[#9e6b15] underline underline-offset-2"
        >
          Cambiar
        </button>
      </div>
    )
  }

  // ── Paso 2b: estante dentro de un módulo ──
  if (gondola && modulo) {
    const estantes = hijosDe(modulo)
    return (
      <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
            {modulo.nombre} · ¿qué estante?
          </p>
          <button
            type="button"
            onClick={() => setModuloId(null)}
            className="text-xs font-semibold text-[#9e6b15] underline underline-offset-2"
          >
            Otro módulo
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {estantes.map((e) => (
            <BotonOpcion key={e.id} onClick={() => onCambio(e.id)}>
              {e.etiqueta}
            </BotonOpcion>
          ))}
          <BotonOpcion onClick={() => onCambio(modulo.id)} className="col-span-3" secundario>
            Todo el módulo
          </BotonOpcion>
        </div>
      </div>
    )
  }

  // ── Paso 2: módulo o estante de la góndola ──
  if (gondola) {
    const hijos = gondola.nodo.hijos.filter((h) => h.activo)
    return (
      <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
            {gondola.nodo.nombre} ·{' '}
            {hijos.some((h) => h.tipo === 'modulo') ? '¿qué módulo?' : '¿qué estante?'}
          </p>
          <button
            type="button"
            onClick={() => setGondolaId(null)}
            className="text-xs font-semibold text-[#9e6b15] underline underline-offset-2"
          >
            Otra góndola
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {hijos.map((h) => (
            <BotonOpcion
              key={h.id}
              onClick={() => {
                const tieneEstantes = h.hijos.some((e) => e.activo)
                if (h.tipo === 'modulo' && tieneEstantes) setModuloId(h.id)
                else onCambio(h.id)
              }}
              conFlecha={h.tipo === 'modulo' && h.hijos.some((e) => e.activo)}
            >
              {h.nombre}
            </BotonOpcion>
          ))}
          <BotonOpcion
            onClick={() => onCambio(gondola.nodo.id)}
            className={cn(hijos.length % 2 === 0 && 'col-span-2')}
            secundario
          >
            Toda la góndola
          </BotonOpcion>
        </div>
      </div>
    )
  }

  // ── Paso 1: góndola ──
  const texto = filtro.trim().toLowerCase()
  const visibles = texto
    ? gondolas.filter((g) => g.nodo.nombre.toLowerCase().includes(texto))
    : gondolas
  const sectores = [...new Set(visibles.map((g) => g.sector))]

  return (
    <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm">
      <p className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6f3a2a]">
        <MapPin className="h-3.5 w-3.5" />
        ¿En qué góndola estás?
      </p>
      {gondolas.length > BUSCADOR_DESDE && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#c8a58a]" />
          <input
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Buscar góndola…"
            className="h-11 w-full rounded-xl border border-[#e4c9b0] bg-white pl-9 pr-3 text-base text-[#391511] focus:outline-none focus:ring-2 focus:ring-[#f9b44c]/50"
          />
        </div>
      )}
      {visibles.length === 0 && (
        <p className="text-sm text-[#c8a58a]">Ninguna góndola coincide.</p>
      )}
      <div className="space-y-3">
        {sectores.map((sector) => (
          <div key={sector || 'sin-sector'}>
            {sectores.length > 1 && sector && (
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#c8a58a]">
                {sector}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {visibles
                .filter((g) => g.sector === sector)
                .map((g) => (
                  <BotonOpcion
                    key={g.nodo.id}
                    onClick={() => {
                      // Sin estantes no hay segundo paso: queda toda la góndola.
                      if (hijosDe(g.nodo).length === 0) {
                        setGondolaId(g.nodo.id)
                        onCambio(g.nodo.id)
                      } else {
                        setGondolaId(g.nodo.id)
                      }
                    }}
                    conFlecha={hijosDe(g.nodo).length > 0}
                  >
                    {g.nodo.nombre}
                  </BotonOpcion>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BotonOpcion({
  children,
  onClick,
  className,
  secundario,
  conFlecha,
}: {
  children: React.ReactNode
  onClick: () => void
  className?: string
  secundario?: boolean
  conFlecha?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-12 items-center justify-between gap-1 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition active:scale-[0.98]',
        secundario
          ? 'border-dashed border-[#c8a58a] bg-[#fdfaf6] text-[#6f3a2a]'
          : 'border-[#e4c9b0] bg-white text-[#391511] hover:border-[#e4a42a]',
        className
      )}
    >
      <span className="min-w-0 break-words">{children}</span>
      {conFlecha && <ChevronRight className="h-4 w-4 shrink-0 text-[#c8a58a]" />}
    </button>
  )
}
