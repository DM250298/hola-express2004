'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { EstadoError } from '@/components/shared/EstadoError'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { formatearMonto, formatearNumero } from '@/lib/utils/formato'
import { tienePermiso } from '@/lib/permisos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import {
  useCerrarSesionConteo,
  useDiferenciasConteo,
  usePasarARevision,
  useSesionConteo,
  useSolicitarReconteo,
} from '@/lib/hooks/useConteoFisico'
import type { ConteoDiferenciaRow } from '@/types/database'

const SIN_RECONTADOR = '__sin__'

type Filtro = 'relevantes' | 'todas' | 'observadas' | 'sin_contar'

const FILTROS: { clave: Filtro; etiqueta: string }[] = [
  { clave: 'relevantes', etiqueta: 'Solo relevantes' },
  { clave: 'todas', etiqueta: 'Todas' },
  { clave: 'observadas', etiqueta: 'Con observaciones' },
  { clave: 'sin_contar', etiqueta: 'Sin contar' },
]

interface Props {
  sesionId: number
}

/**
 * Revisión de diferencias de una sesión de conteo: tabla ordenada por plata,
 * reconteo selectivo y cierre con ajuste de stock. Solo `conteo_cierre`.
 */
export function PantallaRevision({ sesionId }: Props) {
  const router = useRouter()
  const { data: usuario, isLoading: cargandoUsuario } = useUsuario()
  const esGestor = tienePermiso(usuario?.permisos, 'conteo_cierre')

  const { data: sesion } = useSesionConteo(sesionId)
  const {
    data: diferencias,
    isLoading,
    isError,
    refetch,
  } = useDiferenciasConteo(sesionId, esGestor)
  const { data: usuarios } = useUsuariosActivos()

  const pasar = usePasarARevision()
  const reconteo = useSolicitarReconteo()
  const cierre = useCerrarSesionConteo()

  const [filtro, setFiltro] = useState<Filtro>('relevantes')
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [recontador, setRecontador] = useState(SIN_RECONTADOR)
  const [modalCierre, setModalCierre] = useState(false)
  const [syncConfirmado, setSyncConfirmado] = useState(false)

  const filas = useMemo(() => {
    const todas = [...(diferencias ?? [])]
    // Orden: diferencia en $ (absoluta) descendente; las no contadas al final.
    todas.sort((a, b) => {
      const da = a.diferencia_pesos === null ? -1 : Math.abs(a.diferencia_pesos)
      const db = b.diferencia_pesos === null ? -1 : Math.abs(b.diferencia_pesos)
      if (db !== da) return db - da
      const ua = a.diferencia === null ? -1 : Math.abs(a.diferencia)
      const ub = b.diferencia === null ? -1 : Math.abs(b.diferencia)
      return ub - ua
    })
    switch (filtro) {
      case 'relevantes':
        return todas.filter((d) => d.relevante || d.reconteo_pendiente)
      case 'observadas':
        return todas.filter((d) => d.observaciones.length > 0)
      case 'sin_contar':
        return todas.filter((d) => d.total_contado === null)
      default:
        return todas
    }
  }, [diferencias, filtro])

  const resumen = useMemo(() => {
    const conDiferencia = (diferencias ?? []).filter(
      (d) => d.diferencia !== null && d.diferencia !== 0
    )
    const faltantePesos = conDiferencia
      .filter((d) => (d.diferencia_pesos ?? 0) < 0)
      .reduce((suma, d) => suma + Math.abs(d.diferencia_pesos ?? 0), 0)
    const sobrantePesos = conDiferencia
      .filter((d) => (d.diferencia_pesos ?? 0) > 0)
      .reduce((suma, d) => suma + (d.diferencia_pesos ?? 0), 0)
    return {
      total: (diferencias ?? []).length,
      contados: (diferencias ?? []).filter((d) => d.total_contado !== null).length,
      conDiferencia: conDiferencia.length,
      pendientesReconteo: (diferencias ?? []).filter((d) => d.reconteo_pendiente).length,
      faltantePesos,
      sobrantePesos,
    }
  }, [diferencias])

  if (cargandoUsuario) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <SkeletonTabla filas={6} columnas={6} />
      </div>
    )
  }

  if (!esGestor) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <EstadoError mensaje="Esta pantalla es solo para quienes gestionan el conteo (permiso de cierre)." />
      </div>
    )
  }

  function alternarSeleccion(productoId: number) {
    setSeleccion((prev) => {
      const nueva = new Set(prev)
      if (nueva.has(productoId)) nueva.delete(productoId)
      else nueva.add(productoId)
      return nueva
    })
  }

  function pedirReconteo() {
    if (seleccion.size === 0) return
    reconteo.mutate(
      {
        sesion_id: sesionId,
        producto_ids: [...seleccion],
        reconteo_user_id: recontador === SIN_RECONTADOR ? null : recontador,
      },
      { onSuccess: () => setSeleccion(new Set()) }
    )
  }

  function confirmarCierre() {
    if (!syncConfirmado) {
      toast.error(
        'Antes de cerrar, confirmá que todas las cajas están online y sincronizadas (tildá la casilla).'
      )
      return
    }
    cierre.mutate(
      { sesion_id: sesionId, confirmo_sync: true },
      {
        onSuccess: (res) => {
          setModalCierre(false)
          toast.success(
            `Stock ajustado: ${res.productos_ajustados} producto/s · faltante ${formatearMonto(res.faltante_pesos)} · sobrante ${formatearMonto(res.sobrante_pesos)}`
          )
          router.push('/inventario/conteo')
        },
      }
    )
  }

  const itemsRecontador: Record<string, string> = {
    [SIN_RECONTADOR]: 'Quien pueda (otra persona)',
    ...Object.fromEntries((usuarios ?? []).map((u) => [u.id, u.nombre])),
  }

  const sesionCerrada = sesion?.estado === 'cerrada'

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/inventario/conteo"
            className="rounded-xl border border-[#e4c9b0] bg-white p-2 text-[#391511]"
            aria-label="Volver al conteo"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-[#391511]">
              Revisión de diferencias
            </h1>
            <p className="text-sm text-[#6f3a2a]">
              {sesion?.nombre ?? `Sesión #${sesionId}`}
              {sesionCerrada && ' · cerrada (solo lectura)'}
            </p>
          </div>
        </div>
        {sesion?.estado === 'abierta' && (
          <Button
            onClick={() => pasar.mutate(sesionId)}
            disabled={pasar.isPending}
            className="bg-[#391511] text-white hover:bg-[#502019]"
          >
            {pasar.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Pasar a revisión
          </Button>
        )}
        {sesion?.estado === 'en_revision' && (
          <Button
            onClick={() => {
              setSyncConfirmado(false)
              setModalCierre(true)
            }}
            disabled={resumen.pendientesReconteo > 0}
            title={
              resumen.pendientesReconteo > 0
                ? `Hay ${resumen.pendientesReconteo} reconteo/s pendiente/s`
                : undefined
            }
            className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            Cerrar sesión y ajustar stock
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-3">
          <p className="text-xs text-[#6f3a2a]">Productos contados</p>
          <p className="text-lg font-bold tabular-nums text-[#391511]">
            {formatearNumero(resumen.contados)}
            <span className="text-xs font-normal text-[#6f3a2a]">
              {' '}
              / {formatearNumero(resumen.total)}
            </span>
          </p>
        </div>
        <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-3">
          <p className="text-xs text-[#6f3a2a]">Con diferencia</p>
          <p className="text-lg font-bold tabular-nums text-[#391511]">
            {formatearNumero(resumen.conDiferencia)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-3">
          <p className="text-xs text-[#6f3a2a]">Faltante (a costo)</p>
          <p className="text-lg font-bold tabular-nums text-[#c43e2c]">
            {formatearMonto(resumen.faltantePesos)}
          </p>
        </div>
        <div className="rounded-2xl border border-[#e4c9b0]/70 bg-white p-3">
          <p className="text-xs text-[#6f3a2a]">Sobrante (a costo)</p>
          <p className="text-lg font-bold tabular-nums text-[#2f7d4f]">
            {formatearMonto(resumen.sobrantePesos)}
          </p>
        </div>
      </div>

      {/* Filtros + acciones de reconteo */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {FILTROS.map((f) => (
            <button
              key={f.clave}
              type="button"
              onClick={() => setFiltro(f.clave)}
              className={
                filtro === f.clave
                  ? 'rounded-xl bg-[#391511] px-3 py-1.5 text-sm font-semibold text-white'
                  : 'rounded-xl border border-[#e4c9b0] bg-white px-3 py-1.5 text-sm text-[#6f3a2a]'
              }
            >
              {f.etiqueta}
            </button>
          ))}
        </div>
        {!sesionCerrada && seleccion.size > 0 && (
          <div className="flex items-center gap-2">
            <Select
              value={recontador}
              onValueChange={(v) => setRecontador(String(v ?? SIN_RECONTADOR))}
              items={itemsRecontador}
            >
              <SelectTrigger className="h-9 w-52 border-[#e4c9b0] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(itemsRecontador).map(([valor, etiqueta]) => (
                  <SelectItem key={valor} value={valor}>
                    {etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={pedirReconteo}
              disabled={reconteo.isPending || sesion?.estado !== 'en_revision'}
              className="bg-[#391511] text-white hover:bg-[#502019]"
            >
              {reconteo.isPending ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              )}
              Solicitar reconteo ({seleccion.size})
            </Button>
          </div>
        )}
      </div>

      {/* Tabla */}
      {isLoading && <SkeletonTabla filas={8} columnas={7} />}
      {isError && <EstadoError onReintentar={() => refetch()} />}
      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-2xl border border-[#e4c9b0]/70 bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-[#e4c9b0]/60 text-left text-xs uppercase text-[#6f3a2a]">
                {!sesionCerrada && <th className="w-8 px-3 py-2.5" />}
                <th className="px-3 py-2.5">Producto</th>
                <th className="px-3 py-2.5 text-right">Teórico esperado</th>
                <th className="px-3 py-2.5 text-right">Contado</th>
                <th className="px-3 py-2.5 text-right">Dif. unidades</th>
                <th className="px-3 py-2.5 text-right">Dif. $ costo</th>
                <th className="px-3 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr>
                  <td
                    colSpan={sesionCerrada ? 6 : 7}
                    className="px-3 py-8 text-center text-[#6f3a2a]"
                  >
                    No hay productos en este filtro.
                  </td>
                </tr>
              )}
              {filas.map((d: ConteoDiferenciaRow) => {
                const seleccionable =
                  !sesionCerrada && d.total_contado !== null
                return (
                  <tr
                    key={d.producto_id}
                    className="border-b border-[#e4c9b0]/30 last:border-0 hover:bg-[#fdfaf6]"
                  >
                    {!sesionCerrada && (
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={seleccion.has(d.producto_id)}
                          onChange={() => alternarSeleccion(d.producto_id)}
                          disabled={!seleccionable}
                          className="h-4 w-4 accent-[#391511]"
                          aria-label={`Seleccionar ${d.nombre}`}
                        />
                      </td>
                    )}
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-[#391511]">{d.nombre}</p>
                      {d.observaciones.length > 0 && (
                        <p className="text-xs text-[#c43e2c]">
                          {d.observaciones.join(' · ')}
                        </p>
                      )}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums text-[#6f3a2a]"
                      title={`Snapshot ${formatearNumero(d.stock_teorico)} − ventas ${formatearNumero(d.ventas_rango)} + ingresos ${formatearNumero(d.ingresos_rango)} ± otros ${formatearNumero(d.otros_rango)}`}
                    >
                      {formatearNumero(d.teorico_esperado)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-[#391511]">
                      {d.total_contado === null
                        ? '—'
                        : formatearNumero(d.total_contado)}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-bold tabular-nums ${
                        d.diferencia === null || d.diferencia === 0
                          ? 'text-[#6f3a2a]'
                          : d.diferencia > 0
                            ? 'text-[#2f7d4f]'
                            : 'text-[#c43e2c]'
                      }`}
                    >
                      {d.diferencia === null
                        ? '—'
                        : `${d.diferencia > 0 ? '+' : ''}${formatearNumero(d.diferencia)}`}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {d.diferencia_pesos === null ? (
                        <span className="text-[#6f3a2a]">—</span>
                      ) : (
                        <MontoARS
                          monto={d.diferencia_pesos}
                          className={
                            d.diferencia_pesos === 0
                              ? 'text-[#6f3a2a]'
                              : d.diferencia_pesos > 0
                                ? 'text-[#2f7d4f]'
                                : 'text-[#c43e2c]'
                          }
                        />
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {d.total_contado === null && (
                          <span className="rounded-lg bg-[#e4c9b0]/40 px-2 py-0.5 text-xs font-semibold text-[#6f3a2a]">
                            Sin contar
                          </span>
                        )}
                        {d.reconteo_pendiente && (
                          <span className="rounded-lg bg-[#f9b44c]/25 px-2 py-0.5 text-xs font-semibold text-[#a3641c]">
                            Reconteo pendiente
                          </span>
                        )}
                        {d.relevante && !d.reconteo_pendiente && (
                          <span className="rounded-lg bg-[#c43e2c]/12 px-2 py-0.5 text-xs font-semibold text-[#c43e2c]">
                            Revisar
                          </span>
                        )}
                        {d.total_contado !== null &&
                          d.diferencia === 0 &&
                          !d.reconteo_pendiente && (
                            <span className="rounded-lg bg-[#2f7d4f]/12 px-2 py-0.5 text-xs font-semibold text-[#2f7d4f]">
                              OK
                            </span>
                          )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-[#6f3a2a]">
        Los productos <strong>sin contar</strong> no se ajustan al cerrar: si
        corresponde contarlos, reabrí su zona desde el conteo. Los que no
        superan el umbral se aceptan en bloque con el cierre.
      </p>

      <ConfirmacionAccion
        abierto={modalCierre}
        onCambioAbierto={setModalCierre}
        titulo="¿Cerrar la sesión y ajustar el stock?"
        descripcion="Se aplican los ajustes producto por producto (movimientos de tipo ajuste_conteo) y la sesión queda cerrada. Esta acción no se puede deshacer."
        textoConfirmar="Ajustar stock"
        destructiva
        procesando={cierre.isPending}
        onConfirmar={confirmarCierre}
      >
        <div className="space-y-3">
          <ul className="space-y-1 rounded-xl bg-[#fdfaf6] p-3">
            <li>
              Productos a ajustar:{' '}
              <strong>{formatearNumero(resumen.conDiferencia)}</strong>
            </li>
            <li>
              Faltante total:{' '}
              <strong className="text-[#c43e2c]">
                {formatearMonto(resumen.faltantePesos)}
              </strong>
            </li>
            <li>
              Sobrante total:{' '}
              <strong className="text-[#2f7d4f]">
                {formatearMonto(resumen.sobrantePesos)}
              </strong>
            </li>
          </ul>
          {/* El POS opera offline: no hay forma de validar server-side que
              todas las cajas sincronizaron. La confirmación es del operador. */}
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-[#f9b44c] bg-[#f9b44c]/10 p-3">
            <input
              type="checkbox"
              checked={syncConfirmado}
              onChange={(e) => setSyncConfirmado(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#391511]"
            />
            <span className="text-xs text-[#391511]">
              <strong>
                Verifiqué que todas las cajas están online y sincronizadas.
              </strong>{' '}
              Una venta offline sin sincronizar aparecería como faltante en el
              ajuste.
            </span>
          </label>
        </div>
      </ConfirmacionAccion>
    </div>
  )
}
