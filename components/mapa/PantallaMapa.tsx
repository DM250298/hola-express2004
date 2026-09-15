'use client'

import { useMemo, useState } from 'react'
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Map as MapIcon,
  Package,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EstadoError } from '@/components/shared/EstadoError'
import { cn } from '@/lib/utils'
import { formatearNumero } from '@/lib/utils/formato'
import { tienePermiso } from '@/lib/permisos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  useActualizarUbicacion,
  useArbolUbicaciones,
  useCrearUbicacion,
  useEliminarUbicacion,
} from '@/lib/hooks/useMapa'
import {
  ETIQUETA_TIPO,
  TIPOS_HIJO,
  type NodoUbicacion,
} from '@/lib/queries/ubicaciones'
import type { TipoUbicacion, UbicacionRow } from '@/types/database'

/** Colores por tipo de nodo (paleta del sistema). */
const COLOR_TIPO: Record<TipoUbicacion, string> = {
  sucursal: '#391511',
  sector: '#6f3a2a',
  gondola: '#e4a42a',
  modulo: '#1e5fb0',
  estante: '#c8a58a',
}

interface EdicionModal {
  modo: 'crear' | 'editar'
  /** Nodo padre (crear) o nodo a editar. */
  nodo: UbicacionRow | null
  /** Tipo por defecto al crear. */
  tipo: TipoUbicacion
}

export function PantallaMapa() {
  const { data: usuario } = useUsuario()
  const { data: arbol, isLoading, isError, refetch } = useArbolUbicaciones()
  const puedeEditar = tienePermiso(usuario?.permisos, 'configuracion')
  const [modal, setModal] = useState<EdicionModal | null>(null)

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-10 w-64 rounded-xl bg-[#f9d2a2]/30" />
        <Skeleton className="h-24 rounded-2xl bg-[#f9d2a2]/30" />
        <Skeleton className="h-80 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }
  if (isError) {
    return (
      <div className="p-4 sm:p-6">
        <EstadoError
          mensaje="No se pudo cargar el mapa del local."
          onReintentar={refetch}
        />
      </div>
    )
  }
  if (!arbol) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-2xl border-2 border-[#e4a42a]/50 bg-[#f9b44c]/10 p-6 max-w-xl">
          <h2 className="text-[#391511] font-bold mb-1">
            Falta correr la migración 170
          </h2>
          <p className="text-sm text-[#6f3a2a]">
            El mapa del local necesita las tablas de ubicaciones
            (170_ubicaciones_fisicas.sql). Corrida la migración, esta pantalla
            se habilita sola.
          </p>
        </div>
      </div>
    )
  }

  const pct =
    arbol.productos_activos > 0
      ? Math.round((arbol.productos_ubicados / arbol.productos_activos) * 100)
      : 0
  const gondolas = arbol.planas.filter((u) => u.tipo === 'gondola' && u.activo)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Mapa del local</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Dónde vive cada producto: sucursal → sector → góndola → módulo →
            estante
          </p>
        </div>
      </header>

      {/* Avance del mapeo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <TarjetaKpi
          icono={Package}
          etiqueta="SKUs con ubicación"
          valor={`${formatearNumero(arbol.productos_ubicados)} / ${formatearNumero(arbol.productos_activos)}`}
          detalle={`${pct}% del catálogo activo`}
          destacado={pct < 60}
        />
        <TarjetaKpi
          icono={Boxes}
          etiqueta="Góndolas y zonas"
          valor={formatearNumero(gondolas.length)}
          detalle="nodos tipo góndola activos"
        />
        <TarjetaKpi
          icono={MapIcon}
          etiqueta="Sin ubicar"
          valor={formatearNumero(
            Math.max(arbol.productos_activos - arbol.productos_ubicados, 0)
          )}
          detalle="se asignan desde la ficha del producto o contando por zonas"
        />
      </div>

      {/* Árbol */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 shadow-sm">
        {arbol.raices.length === 0 ? (
          <p className="text-sm text-[#6f3a2a] p-4">
            Todavía no hay ubicaciones cargadas.
          </p>
        ) : (
          <ul className="space-y-1">
            {arbol.raices.map((n) => (
              <NodoArbol
                key={n.id}
                nodo={n}
                nivel={0}
                puedeEditar={puedeEditar}
                onCrearHijo={(padre, tipo) =>
                  setModal({ modo: 'crear', nodo: padre, tipo })
                }
                onEditar={(nodo) =>
                  setModal({ modo: 'editar', nodo, tipo: nodo.tipo })
                }
              />
            ))}
          </ul>
        )}
      </div>

      {modal && (
        <ModalUbicacion edicion={modal} onCerrar={() => setModal(null)} />
      )}
    </div>
  )
}

function TarjetaKpi({
  icono: Icono,
  etiqueta,
  valor,
  detalle,
  destacado,
}: {
  icono: React.ElementType
  etiqueta: string
  valor: string
  detalle?: string
  destacado?: boolean
}) {
  return (
    <div
      className={cn(
        'bg-white border-2 rounded-2xl p-4 flex items-center gap-3',
        destacado
          ? 'border-[#f9b44c]/60 ring-2 ring-offset-1 ring-[#f9b44c]/30'
          : 'border-[#e4c9b0]/60'
      )}
    >
      <div className="shrink-0 p-2.5 rounded-xl bg-[#f9b44c]/20">
        <Icono className="h-5 w-5 text-[#6f3a2a]" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
          {etiqueta}
        </div>
        <div className="text-2xl font-extrabold text-[#391511] tabular-nums leading-tight">
          {valor}
        </div>
        {detalle && <div className="text-[11px] text-[#c8a58a]">{detalle}</div>}
      </div>
    </div>
  )
}

function NodoArbol({
  nodo,
  nivel,
  puedeEditar,
  onCrearHijo,
  onEditar,
}: {
  nodo: NodoUbicacion
  nivel: number
  puedeEditar: boolean
  onCrearHijo: (padre: UbicacionRow, tipo: TipoUbicacion) => void
  onEditar: (nodo: UbicacionRow) => void
}) {
  // Sucursal y sectores arrancan abiertos; góndolas cerradas.
  const [abierto, setAbierto] = useState(nivel < 2)
  const [confirmando, setConfirmando] = useState(false)
  const eliminar = useEliminarUbicacion()
  const tiposHijo = TIPOS_HIJO[nodo.tipo]
  const tieneHijos = nodo.hijos.length > 0
  const eliminable =
    !tieneHijos && nodo.productos_directos === 0 && nodo.tipo !== 'sucursal'

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[#fdfaf6]',
          !nodo.activo && 'opacity-50'
        )}
        style={{ paddingLeft: `${nivel * 22 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => setAbierto((a) => !a)}
          className={cn(
            'shrink-0 text-[#6f3a2a]',
            !tieneHijos && 'invisible'
          )}
          aria-label={abierto ? 'Colapsar' : 'Expandir'}
        >
          {abierto ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        <span
          className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md text-white"
          style={{ backgroundColor: COLOR_TIPO[nodo.tipo] }}
        >
          {ETIQUETA_TIPO[nodo.tipo]}
        </span>

        <span className="font-medium text-[#391511] truncate">
          {nodo.nombre}
        </span>
        {nodo.codigo && (
          <span className="text-[10px] text-[#c8a58a] font-mono shrink-0">
            {nodo.codigo}
          </span>
        )}
        {!nodo.activo && (
          <span className="text-[10px] text-[#9e2f25] shrink-0">inactiva</span>
        )}

        <span className="ml-auto shrink-0 text-xs text-[#6f3a2a] tabular-nums">
          {nodo.productos_total > 0 && (
            <>
              {formatearNumero(nodo.productos_total)}{' '}
              <span className="text-[#c8a58a]">prod.</span>
            </>
          )}
        </span>

        {puedeEditar && (
          <span className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {tiposHijo.length > 0 && (
              <button
                type="button"
                title={`Agregar ${ETIQUETA_TIPO[tiposHijo[0]].toLowerCase()}`}
                onClick={() => onCrearHijo(nodo, tiposHijo[0])}
                className="p-1 rounded-md hover:bg-[#f9b44c]/30 text-[#6f3a2a]"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              title="Editar"
              onClick={() => onEditar(nodo)}
              className="p-1 rounded-md hover:bg-[#f9b44c]/30 text-[#6f3a2a]"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {eliminable &&
              (confirmando ? (
                <button
                  type="button"
                  onClick={() => {
                    eliminar.mutate(nodo.id)
                    setConfirmando(false)
                  }}
                  onBlur={() => setConfirmando(false)}
                  className="px-1.5 py-0.5 rounded-md bg-[#c43e2c] text-white text-[10px] font-semibold"
                >
                  ¿Eliminar?
                </button>
              ) : (
                <button
                  type="button"
                  title="Eliminar"
                  onClick={() => setConfirmando(true)}
                  className="p-1 rounded-md hover:bg-[#c43e2c]/15 text-[#9e2f25]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ))}
          </span>
        )}
      </div>

      {abierto && tieneHijos && (
        <ul className="space-y-0.5">
          {nodo.hijos.map((h) => (
            <NodoArbol
              key={h.id}
              nodo={h}
              nivel={nivel + 1}
              puedeEditar={puedeEditar}
              onCrearHijo={onCrearHijo}
              onEditar={onEditar}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function ModalUbicacion({
  edicion,
  onCerrar,
}: {
  edicion: EdicionModal
  onCerrar: () => void
}) {
  const crear = useCrearUbicacion()
  const actualizar = useActualizarUbicacion()
  const esEdicion = edicion.modo === 'editar'
  const original = esEdicion ? edicion.nodo : null

  const [nombre, setNombre] = useState(original?.nombre ?? '')
  const [codigo, setCodigo] = useState(original?.codigo ?? '')
  const [orden, setOrden] = useState(String(original?.orden ?? 0))
  const [tipo, setTipo] = useState<TipoUbicacion>(edicion.tipo)
  const [activo, setActivo] = useState(original?.activo ?? true)

  const tiposPosibles = useMemo<TipoUbicacion[]>(() => {
    if (esEdicion) return [edicion.tipo]
    return edicion.nodo ? TIPOS_HIJO[edicion.nodo.tipo] : ['sucursal']
  }, [esEdicion, edicion])

  const guardando = crear.isPending || actualizar.isPending
  const puedeGuardar = nombre.trim().length > 0 && !guardando

  const guardar = () => {
    const datos = {
      nombre: nombre.trim(),
      codigo: codigo.trim() || null,
      orden: Number.parseInt(orden, 10) || 0,
    }
    if (esEdicion && original) {
      actualizar.mutate(
        { id: original.id, datos: { ...datos, activo } },
        { onSuccess: onCerrar }
      )
    } else {
      crear.mutate(
        { ...datos, tipo, parent_id: edicion.nodo?.id ?? null },
        { onSuccess: onCerrar }
      )
    }
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {esEdicion
              ? `Editar ${ETIQUETA_TIPO[edicion.tipo].toLowerCase()}`
              : `Nueva ubicación${edicion.nodo ? ` en ${edicion.nodo.nombre}` : ''}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {!esEdicion && tiposPosibles.length > 1 && (
            <div className="space-y-1">
              <Label>Tipo</Label>
              <div className="flex gap-2">
                {tiposPosibles.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTipo(t)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg border text-sm font-medium',
                      tipo === t
                        ? 'bg-[#f9b44c]/25 border-[#e4a42a] text-[#391511]'
                        : 'border-[#e4c9b0] text-[#6f3a2a] hover:border-[#c8a58a]'
                    )}
                  >
                    {ETIQUETA_TIPO[t]}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="ubicacion-nombre">Nombre</Label>
            <Input
              id="ubicacion-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Góndola 4 · Heladera de lácteos · Depósito"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ubicacion-codigo">Código (opcional)</Label>
              <Input
                id="ubicacion-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="G04-M2-E1"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ubicacion-orden">Orden</Label>
              <Input
                id="ubicacion-orden"
                type="number"
                value={orden}
                onChange={(e) => setOrden(e.target.value)}
              />
            </div>
          </div>

          {esEdicion && (
            <label className="flex items-center gap-2 text-sm text-[#391511]">
              <input
                type="checkbox"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                className="accent-[#e4a42a]"
              />
              Ubicación activa
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={!puedeGuardar}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
