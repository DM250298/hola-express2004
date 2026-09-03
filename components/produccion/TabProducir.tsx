'use client'

import { useMemo, useState } from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { ColumnaOrdenes } from './ColumnaOrdenes'
import { PanelOrden } from './PanelOrden'
import { PanelElaborarAhora } from './PanelElaborarAhora'
import { AsistenteNuevaOrden } from './AsistenteNuevaOrden'
import { ModalCierreOrden } from './ModalCierreOrden'
import { ModalEtiquetasElaboracion } from './ModalEtiquetasElaboracion'
import {
  useCancelarOrden,
  useGenerarReposicion,
  useIniciarOrden,
  useOrdenes,
} from '@/lib/hooks/useProduccion'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { fechaLocal, hoyIso } from '@/lib/utils/periodos'
import type { OrdenConProducto } from '@/lib/queries/produccion'

/** Cuántas tandas cerradas viejas se muestran al abrir el historial. */
const HISTORIAL_MAX = 40

export function TabProducir() {
  const { data: usuario } = useUsuario()
  const { data: ordenes, isLoading } = useOrdenes()
  const iniciar = useIniciarOrden()
  const cancelar = useCancelarOrden()
  const reponer = useGenerarReposicion()

  const [asistente, setAsistente] = useState(false)
  const [cierre, setCierre] = useState<OrdenConProducto | null>(null)
  const [aCancelar, setACancelar] = useState<OrdenConProducto | null>(null)
  const [seleccionId, setSeleccionId] = useState<number | undefined>()
  const [etiquetasOrdenId, setEtiquetasOrdenId] = useState<number | undefined>()
  const [verTodasCerradas, setVerTodasCerradas] = useState(false)

  // El tablero muestra el flujo vivo. Las cerradas se acotan al día porque en
  // un local 24h el histórico completo son cientos de tandas.
  const { borradores, enCurso, cerradas } = useMemo(() => {
    const lista = ordenes ?? []
    const hoy = hoyIso()
    const cerradasTodas = lista.filter((o) => o.estado === 'cerrada')
    const cerradasHoy = cerradasTodas.filter(
      (o) => o.fecha_cierre && fechaLocal(o.fecha_cierre) === hoy
    )
    return {
      borradores: lista.filter((o) => o.estado === 'borrador'),
      enCurso: lista.filter((o) => o.estado === 'iniciada'),
      cerradas: verTodasCerradas
        ? cerradasTodas.slice(0, HISTORIAL_MAX)
        : cerradasHoy,
    }
  }, [ordenes, verTodasCerradas])

  const seleccionada =
    (ordenes ?? []).find((o) => o.id === seleccionId) ?? null

  function handleIniciar(orden: OrdenConProducto) {
    if (!usuario) return
    iniciar.mutate({ orden_id: orden.id, usuario_id: usuario.id })
  }

  function confirmarCancelacion() {
    if (!usuario || !aCancelar) return
    cancelar.mutate(
      { orden_id: aCancelar.id, usuario_id: usuario.id },
      { onSuccess: () => setACancelar(null) }
    )
  }

  /** Recién elaborada o recién cerrada: se selecciona y se ofrecen etiquetas. */
  function tandaTerminada(ordenId: number) {
    setSeleccionId(ordenId)
    setEtiquetasOrdenId(ordenId)
  }

  return (
    <div className="space-y-4">
      <PanelElaborarAhora
        onElaborado={tandaTerminada}
        onNuevaOrden={() => setAsistente(true)}
      />

      {isLoading ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-6 shadow-sm">
          <SkeletonTabla filas={5} columnas={4} />
        </div>
      ) : (ordenes ?? []).length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center shadow-sm">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
            <ClipboardList className="h-6 w-6 text-[#6f3a2a]" />
          </div>
          <p className="text-[#391511] font-semibold">Todavía no produjiste nada</p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Elegí una receta arriba y tocá “Elaborar ahora”, o planificá una
            orden para más tarde.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ColumnaOrdenes
              titulo="Para hacer"
              vacio="No hay nada pendiente de elaborar."
              ordenes={borradores}
              seleccionadaId={seleccionId}
              onSeleccionar={(o) => setSeleccionId(o.id)}
              accion={
                <button
                  type="button"
                  onClick={() => reponer.mutate()}
                  disabled={reponer.isPending}
                  title="Crear órdenes para los elaborados bajo el mínimo"
                  className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#6f3a2a] hover:text-[#391511] disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3 w-3 ${reponer.isPending ? 'animate-spin' : ''}`}
                  />
                  Reponer
                </button>
              }
            />
            <ColumnaOrdenes
              titulo="En elaboración"
              vacio="Nada en el mesón ahora mismo."
              ordenes={enCurso}
              seleccionadaId={seleccionId}
              onSeleccionar={(o) => setSeleccionId(o.id)}
            />
            <ColumnaOrdenes
              titulo={verTodasCerradas ? 'Cerradas' : 'Terminadas hoy'}
              vacio={
                verTodasCerradas
                  ? 'No hay tandas cerradas.'
                  : 'Todavía no terminaste ninguna tanda hoy.'
              }
              ordenes={cerradas}
              seleccionadaId={seleccionId}
              onSeleccionar={(o) => setSeleccionId(o.id)}
              accion={
                <button
                  type="button"
                  onClick={() => setVerTodasCerradas((v) => !v)}
                  className="text-[10px] font-semibold uppercase tracking-wide text-[#6f3a2a] hover:text-[#391511]"
                >
                  {verTodasCerradas ? 'Ver hoy' : 'Ver todas'}
                </button>
              }
            />
          </div>

          <div className="xl:sticky xl:top-4">
            <PanelOrden
              orden={seleccionada}
              onIniciar={handleIniciar}
              onCerrar={setCierre}
              onCancelar={setACancelar}
              onImprimirEtiquetas={setEtiquetasOrdenId}
              procesando={iniciar.isPending || cancelar.isPending}
            />
          </div>
        </div>
      )}

      <AsistenteNuevaOrden open={asistente} onOpenChange={setAsistente} />

      {cierre && (
        <ModalCierreOrden
          orden={cierre}
          open={!!cierre}
          onOpenChange={(v) => !v && setCierre(null)}
          onCerrada={tandaTerminada}
        />
      )}

      <ModalEtiquetasElaboracion
        ordenId={etiquetasOrdenId}
        abierto={!!etiquetasOrdenId}
        onCambioAbierto={(v) => !v && setEtiquetasOrdenId(undefined)}
      />

      <ConfirmacionAccion
        abierto={!!aCancelar}
        onCambioAbierto={(v) => !v && setACancelar(null)}
        titulo={`¿Cancelar la tanda de ${aCancelar?.producto?.nombre ?? 'producto'}?`}
        descripcion={
          aCancelar?.estado === 'iniciada'
            ? 'Los insumos que ya se descontaron vuelven al stock.'
            : 'La orden queda cancelada. No se movió stock todavía.'
        }
        textoConfirmar="Cancelar la tanda"
        textoCancelar="Volver"
        destructiva
        procesando={cancelar.isPending}
        onConfirmar={confirmarCancelacion}
      />
    </div>
  )
}
