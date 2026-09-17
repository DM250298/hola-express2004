'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Package,
  Pencil,
  Plus,
  Trash2,
  Warehouse,
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
import { SelectorPeriodo } from '@/components/reportes/SelectorPeriodo'
import { cn } from '@/lib/utils'
import { formatearMontoEntero, formatearNumero } from '@/lib/utils/formato'
import {
  fechaLocal,
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'
import { tienePermiso } from '@/lib/permisos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  useActualizarUbicacion,
  useArbolUbicaciones,
  useCrearUbicacion,
  useEliminarUbicacion,
  useMapaSemaforo,
} from '@/lib/hooks/useMapa'
import { useCategorias } from '@/lib/hooks/useCategorias'
import { useMarcas } from '@/lib/hooks/useMarcas'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import {
  ETIQUETA_MUEBLE,
  ETIQUETA_TIPO,
  TIPOS_HIJO,
  heredado,
  rutaUbicacion,
  type NodoUbicacion,
} from '@/lib/queries/ubicaciones'
import type { ColorSemaforo, NodoMapa } from '@/lib/queries/mapa'
import type { TipoMueble, TipoUbicacion, UbicacionRow } from '@/types/database'
import { PanelNodoMapa } from './PanelNodoMapa'
import { ArbolUbicaciones } from './ArbolUbicaciones'
import { VistaUbicaciones, type ModoVista } from './VistaUbicaciones'
import { ModalAsignarProductos } from './ModalAsignarProductos'

/** Rojo = alguna alerta crítica viva · amarillo = atención · gris = sin mapear. */
const COLOR_SEMAFORO: Record<ColorSemaforo, string> = {
  rojo: 'bg-[#c43e2c]',
  amarillo: 'bg-[#e4a42a]',
  verde: 'bg-[#2f7d4f]',
  gris: 'bg-[#e4c9b0]',
}

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
  const [periodo, setPeriodo] = useState<ClavePeriodo>('mes_actual')
  const [desdeP, setDesdeP] = useState('')
  const [hastaP, setHastaP] = useState('')
  const [nodoAbierto, setNodoAbierto] = useState<number | null>(null)
  const [modo, setModo] = useState<ModoVista>('mapa')
  const [asignando, setAsignando] = useState(false)
  const eliminar = useEliminarUbicacion()
  const { data: categorias } = useCategorias()
  const { data: marcas } = useMarcas()
  const { data: usuarios } = useUsuariosActivos()

  // Todos los nodos por id (con hijos), para acciones del panel de detalle.
  const nodosPorId = useMemo(() => {
    const m = new Map<number, NodoUbicacion>()
    const recorrer = (ns: NodoUbicacion[]) =>
      ns.forEach((n) => {
        m.set(n.id, n)
        recorrer(n.hijos)
      })
    recorrer(arbol?.raices ?? [])
    return m
  }, [arbol])

  // Sin selección, arranca en la primera góndola (o la raíz).
  const seleccionId =
    nodoAbierto ??
    arbol?.planas.find((u) => u.tipo === 'gondola' && u.activo)?.id ??
    arbol?.raices[0]?.id ??
    null

  const personalizadoCompleto = periodo === 'personalizado' && !!desdeP && !!hastaP
  const rango = useMemo(() => {
    const r = personalizadoCompleto
      ? rangoDesdeFechas(desdeP, hastaP)
      : rangoPredefinido(periodo === 'personalizado' ? 'mes_actual' : periodo)
    return { desde: fechaLocal(r.desde), hasta: fechaLocal(r.hasta) }
  }, [periodo, desdeP, hastaP, personalizadoCompleto])

  const { data: mapa, isError: fallaMapa } = useMapaSemaforo(rango.desde, rango.hasta)
  const metricas = useMemo(() => {
    const m = new Map<number, NodoMapa>()
    for (const n of mapa?.nodos ?? []) m.set(n.id, n)
    return m
  }, [mapa])

  const totales = useMemo(() => {
    // Las raíces ya traen el rollup de todo lo que cuelga de ellas: sumando
    // solo esas, nada se cuenta dos veces.
    const raices = (mapa?.nodos ?? []).filter((n) => n.parent_id == null)
    const sumar = (f: (n: NodoMapa) => number | null) =>
      raices.reduce((s, n) => s + (f(n) ?? 0), 0)
    const hayCostos = !!mapa?.puede_ver_costos
    return {
      ingresos: sumar((n) => n.ingresos),
      margen: hayCostos ? sumar((n) => n.margen) : null,
      stock: hayCostos ? sumar((n) => n.stock_valorizado) : null,
      criticas: sumar((n) => n.alertas_criticas),
      atencion: sumar((n) => n.alertas_atencion),
      sinStock: sumar((n) => n.sin_stock),
      sinMovimiento: sumar((n) => n.sin_movimiento),
    }
  }, [mapa])

  // Sin números (mig 193 pendiente o consulta caída) el panel tiene que
  // abrir igual: la lista de productos viene de otra función.
  const nodoSeleccionado = useMemo<NodoMapa | null>(() => {
    if (seleccionId == null) return null
    const conNumeros = metricas.get(seleccionId)
    if (conNumeros) return conNumeros
    const plano = arbol?.planas.find((u) => u.id === seleccionId)
    if (!plano) return null
    return {
      id: plano.id,
      parent_id: plano.parent_id,
      tipo: plano.tipo,
      nombre: plano.nombre,
      codigo: plano.codigo,
      activo: plano.activo,
      skus: 0,
      skus_directos: 0,
      ingresos: 0,
      margen: null,
      margen_pct: null,
      stock_valorizado: null,
      dias_inventario: null,
      quiebres: 0,
      sin_stock: 0,
      sin_movimiento: 0,
      alertas_criticas: 0,
      alertas_atencion: 0,
      semaforo: 'gris',
    }
  }, [seleccionId, metricas, arbol])

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
            Qué vende y qué inmoviliza cada parte del local. Tocá una ubicación para ver
            sus productos.
          </p>
        </div>
        <SelectorPeriodo
          periodo={periodo}
          onCambioPeriodo={setPeriodo}
          desdePersonalizado={desdeP}
          hastaPersonalizado={hastaP}
          onCambioDesde={setDesdeP}
          onCambioHasta={setHastaP}
        />
      </header>

      {/* Avance del mapeo y qué mueve lo ubicado */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <TarjetaKpi
          icono={Package}
          etiqueta="SKUs con ubicación"
          valor={`${formatearNumero(arbol.productos_ubicados)} / ${formatearNumero(arbol.productos_activos)}`}
          detalle={`${pct}% del catálogo · ${formatearNumero(Math.max(arbol.productos_activos - arbol.productos_ubicados, 0))} sin ubicar`}
          destacado={pct < 60}
        />
        <TarjetaKpi
          icono={CircleDollarSign}
          etiqueta="Ventas de lo ubicado"
          valor={formatearMontoEntero(totales.ingresos)}
          detalle={
            mapa?.puede_ver_costos && totales.margen != null
              ? `${formatearMontoEntero(totales.margen)} de margen`
              : `${formatearNumero(gondolas.length)} góndolas activas`
          }
        />
        <TarjetaKpi
          icono={Warehouse}
          etiqueta="Stock a costo ubicado"
          valor={
            mapa?.puede_ver_costos && totales.stock != null
              ? formatearMontoEntero(totales.stock)
              : '—'
          }
          detalle={`${formatearNumero(totales.sinMovimiento)} productos sin vender en el período`}
        />
        <TarjetaKpi
          icono={AlertTriangle}
          etiqueta="Alertas en el local"
          valor={`${formatearNumero(totales.criticas)} críticas`}
          detalle={`${formatearNumero(totales.atencion)} de atención · ${formatearNumero(totales.sinStock)} sin stock`}
          destacado={totales.criticas > 0}
        />
      </div>

      {fallaMapa ? (
        <p className="flex items-center gap-2 rounded-xl border border-[#c43e2c]/40 bg-[#c43e2c]/[0.06] px-3 py-2 text-xs text-[#9e2f25]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          No pudimos calcular los números por ubicación. Los que se ven arriba están en cero
          por eso, no porque no haya ventas. Probá con un período más corto o volvé a entrar.
        </p>
      ) : (
        mapa === null && (
          <p className="rounded-xl border border-[#e4a42a]/50 bg-[#f9b44c]/10 px-3 py-2 text-xs text-[#6f3a2a]">
            Faltan correr las migraciones 193 y 194: el mapa funciona igual, pero todavía sin
            ventas, márgenes ni semáforo por ubicación.
          </p>
        )
      )}

      {pct < 20 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#e4a42a]/50 bg-[#f9b44c]/10 px-4 py-3">
          <Package className="h-5 w-5 shrink-0 text-[#9e6b15]" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[#391511]">Empezá a organizar tu local</p>
            <p className="text-sm text-[#6f3a2a]">
              Elegí una góndola y tocá “Asignar productos”, o escaneá desde el celular en
              Ubicar productos.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <ArbolUbicaciones
          arbol={arbol}
          metricas={metricas}
          seleccionado={seleccionId}
          onSeleccionar={setNodoAbierto}
          puedeEditar={puedeEditar}
          onAgregarSector={() => {
            const raiz = arbol.raices.find((r) => r.tipo === 'sucursal') ?? null
            setModal({ modo: 'crear', nodo: raiz, tipo: raiz ? 'sector' : 'sucursal' })
          }}
        />

        <VistaUbicaciones
          arbol={arbol}
          metricas={metricas}
          seleccionado={seleccionId}
          onSeleccionar={setNodoAbierto}
          puedeEditar={puedeEditar}
          onCrear={(padre, tipo) => setModal({ modo: 'crear', nodo: padre, tipo })}
          modo={modo}
          onModo={setModo}
          lista={
            arbol.raices.length === 0 ? (
              <p className="p-4 text-sm text-[#6f3a2a]">Todavía no hay ubicaciones cargadas.</p>
            ) : (
              <ul className="space-y-1">
                {arbol.raices.map((n) => (
                  <NodoArbol
                    key={n.id}
                    nodo={n}
                    nivel={0}
                    puedeEditar={puedeEditar}
                    metricas={metricas}
                    puedeVerCostos={!!mapa?.puede_ver_costos}
                    seleccionado={seleccionId}
                    onSeleccionar={setNodoAbierto}
                    onCrearHijo={(padre, tipo) => setModal({ modo: 'crear', nodo: padre, tipo })}
                    onEditar={(nodo) => setModal({ modo: 'editar', nodo, tipo: nodo.tipo })}
                  />
                ))}
              </ul>
            )
          }
        />

        <div className="xl:sticky xl:top-4">
          {nodoSeleccionado ? (
            (() => {
              const nodoArbol = nodosPorId.get(nodoSeleccionado.id)
              const tipoHijo = nodoArbol ? TIPOS_HIJO[nodoArbol.tipo][0] : undefined
              const eliminable =
                !!nodoArbol &&
                nodoArbol.hijos.length === 0 &&
                nodoArbol.productos_directos === 0 &&
                nodoArbol.tipo !== 'sucursal'
              return (
                <PanelNodoMapa
                  info={{
                    mueble: nodoArbol?.tipo_mueble
                      ? ETIQUETA_MUEBLE[nodoArbol.tipo_mueble]
                      : null,
                    categoria:
                      categorias?.find(
                        (c) =>
                          c.id === heredado(nodoSeleccionado.id, arbol.planas, 'categoria_id')
                      )?.nombre ?? null,
                    marca:
                      marcas?.find(
                        (m) =>
                          m.id ===
                          heredado(nodoSeleccionado.id, arbol.planas, 'marca_exclusiva_id')
                      )?.nombre ?? null,
                    responsable:
                      usuarios?.find(
                        (u) =>
                          u.id === heredado(nodoSeleccionado.id, arbol.planas, 'responsable_id')
                      )?.nombre ?? null,
                  }}
                  nodo={nodoSeleccionado}
                  ruta={rutaUbicacion(nodoSeleccionado.id, arbol.planas)}
                  desde={rango.desde}
                  hasta={rango.hasta}
                  puedeVerCostos={!!mapa?.puede_ver_costos}
                  puedeEditar={puedeEditar}
                  onAsignar={
                    nodoSeleccionado.tipo === 'sucursal' || nodoSeleccionado.tipo === 'sector'
                      ? undefined
                      : () => setAsignando(true)
                  }
                  onAgregarHijo={
                    nodoArbol && tipoHijo
                      ? () => setModal({ modo: 'crear', nodo: nodoArbol, tipo: tipoHijo })
                      : undefined
                  }
                  etiquetaHijo={tipoHijo ? ETIQUETA_TIPO[tipoHijo].toLowerCase() : undefined}
                  onEditar={
                    nodoArbol
                      ? () => setModal({ modo: 'editar', nodo: nodoArbol, tipo: nodoArbol.tipo })
                      : undefined
                  }
                  onEliminar={
                    eliminable
                      ? () =>
                          eliminar.mutate(nodoSeleccionado.id, {
                            onSuccess: () => setNodoAbierto(null),
                          })
                      : undefined
                  }
                />
              )
            })()
          ) : (
            <div className="rounded-2xl border border-dashed border-[#e4c9b0] bg-white p-6 text-center text-sm text-[#6f3a2a]">
              Elegí una ubicación para ver sus productos.
            </div>
          )}
        </div>
      </div>

      {asignando && nodoSeleccionado && (
        <ModalAsignarProductos
          ubicacion={{ id: nodoSeleccionado.id, nombre: nodoSeleccionado.nombre }}
          onCerrar={() => setAsignando(false)}
        />
      )}

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
  metricas,
  puedeVerCostos,
  seleccionado,
  onSeleccionar,
  onCrearHijo,
  onEditar,
}: {
  nodo: NodoUbicacion
  nivel: number
  puedeEditar: boolean
  metricas: Map<number, NodoMapa>
  puedeVerCostos: boolean
  seleccionado: number | null
  onSeleccionar: (id: number) => void
  onCrearHijo: (padre: UbicacionRow, tipo: TipoUbicacion) => void
  onEditar: (nodo: UbicacionRow) => void
}) {
  const m = metricas.get(nodo.id)
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

        {m && (
          <span
            className={cn('shrink-0 h-2.5 w-2.5 rounded-full', COLOR_SEMAFORO[m.semaforo])}
            title={
              m.semaforo === 'rojo'
                ? 'Tiene alertas críticas'
                : m.semaforo === 'amarillo'
                  ? 'Tiene alertas de atención'
                  : m.semaforo === 'verde'
                    ? 'Sin alertas'
                    : 'Todavía sin productos ubicados'
            }
          />
        )}

        <button
          type="button"
          onClick={() => onSeleccionar(nodo.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md text-white"
            style={{ backgroundColor: COLOR_TIPO[nodo.tipo] }}
          >
            {ETIQUETA_TIPO[nodo.tipo]}
          </span>

          <span
            className={cn(
              'font-medium text-[#391511] truncate',
              seleccionado === nodo.id && 'underline decoration-[#e4a42a] decoration-2'
            )}
          >
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

          <span className="ml-auto shrink-0 flex items-center gap-2 text-xs tabular-nums">
            {m && m.alertas_criticas > 0 && (
              <span className="rounded-full bg-[#c43e2c]/10 px-1.5 font-semibold text-[#9e2f25]">
                {formatearNumero(m.alertas_criticas)}
              </span>
            )}
            {m && m.alertas_atencion > 0 && (
              <span className="rounded-full bg-[#f9b44c]/25 px-1.5 font-semibold text-[#a06b00]">
                {formatearNumero(m.alertas_atencion)}
              </span>
            )}
            {m && m.ingresos > 0 && (
              <span className="text-[#391511] font-semibold">
                {formatearMontoEntero(m.ingresos)}
                {puedeVerCostos && m.margen_pct != null && (
                  <span className="font-normal text-[#6f3a2a]">
                    {' '}
                    · {m.margen_pct.toFixed(1)}%
                  </span>
                )}
              </span>
            )}
            {nodo.productos_total > 0 && (
              <span className="text-[#6f3a2a]">
                {formatearNumero(nodo.productos_total)}{' '}
                <span className="text-[#c8a58a]">prod.</span>
              </span>
            )}
          </span>
        </button>

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
              metricas={metricas}
              puedeVerCostos={puedeVerCostos}
              seleccionado={seleccionado}
              onSeleccionar={onSeleccionar}
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
  const [mueble, setMueble] = useState<string>(original?.tipo_mueble ?? '')
  const [categoriaId, setCategoriaId] = useState<string>(
    original?.categoria_id != null ? String(original.categoria_id) : ''
  )
  const [marcaId, setMarcaId] = useState<string>(
    original?.marca_exclusiva_id != null ? String(original.marca_exclusiva_id) : ''
  )
  const [responsableId, setResponsableId] = useState<string>(original?.responsable_id ?? '')
  const { data: categorias } = useCategorias()
  const { data: marcas } = useMarcas()
  const { data: usuarios } = useUsuariosActivos()

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
      ...(tipo !== 'sucursal' && {
        tipo_mueble: tipo === 'gondola' && mueble ? (mueble as TipoMueble) : null,
        categoria_id: categoriaId ? Number(categoriaId) : null,
        marca_exclusiva_id: tipo === 'gondola' && marcaId ? Number(marcaId) : null,
        responsable_id: responsableId || null,
      }),
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

          {tipo !== 'sucursal' && (
            <div className="grid grid-cols-2 gap-3">
              {tipo === 'gondola' && (
                <div className="space-y-1">
                  <Label htmlFor="ubicacion-mueble">Tipo de mueble</Label>
                  <select
                    id="ubicacion-mueble"
                    value={mueble}
                    onChange={(e) => setMueble(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">Sin especificar</option>
                    {Object.entries(ETIQUETA_MUEBLE).map(([v, e]) => (
                      <option key={v} value={v}>
                        {e}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="ubicacion-categoria">Categoría que va acá</Label>
                <select
                  id="ubicacion-categoria"
                  value={categoriaId}
                  onChange={(e) => setCategoriaId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Hereda / sin asignar</option>
                  {(categorias ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>
              {tipo === 'gondola' && (
                <div className="space-y-1">
                  <Label htmlFor="ubicacion-marca">Marca exclusiva</Label>
                  <select
                    id="ubicacion-marca"
                    value={marcaId}
                    onChange={(e) => setMarcaId(e.target.value)}
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="">Ninguna</option>
                    {(marcas ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="ubicacion-responsable">Responsable</Label>
                <select
                  id="ubicacion-responsable"
                  value={responsableId}
                  onChange={(e) => setResponsableId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Hereda / sin asignar</option>
                  {(usuarios ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

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
