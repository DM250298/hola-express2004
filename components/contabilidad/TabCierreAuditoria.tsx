'use client'

import { useState } from 'react'
import { Lock, LockOpen, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import {
  usePeriodos,
  useAuditoria,
  useCerrarPeriodo,
  useReabrirPeriodo,
} from '@/lib/hooks/useCierrePeriodo'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { nombreMes } from '@/lib/queries/cierrePeriodo'
import { formatearFechaHora } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

const ETIQUETA_ACCION: Record<string, string> = {
  anular_venta: 'Anulación de venta',
  arqueo: 'Arqueo de tesorería',
  remesa: 'Remesa / depósito',
  cerrar_periodo: 'Cierre de período',
  reabrir_periodo: 'Reapertura de período',
}

export function TabCierreAuditoria() {
  const { data: usuario } = useUsuario()
  const { data: periodos, isLoading } = usePeriodos()
  const { data: auditoria } = useAuditoria(100)
  const cerrar = useCerrarPeriodo()
  const reabrir = useReabrirPeriodo()

  const esAdmin = usuario?.rol === 'admin'

  // Acción de cierre/reapertura pendiente de confirmar (operación irreversible).
  const [accionPendiente, setAccionPendiente] = useState<{
    tipo: 'cerrar' | 'reabrir'
    anio: number
    mes: number
  } | null>(null)

  function confirmarAccion() {
    if (!accionPendiente || !usuario) return
    const { tipo, anio, mes } = accionPendiente
    const opciones = { onSuccess: () => setAccionPendiente(null) }
    if (tipo === 'cerrar') {
      cerrar.mutate({ usuarioId: usuario.id, anio, mes }, opciones)
    } else {
      reabrir.mutate({ usuarioId: usuario.id, anio, mes }, opciones)
    }
  }

  return (
    <div className="space-y-5">
      {/* Cierre de períodos */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <h3 className="text-[#391511] font-semibold text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#f9b44c]" />
            Cierre de períodos
          </h3>
          <p className="text-[#6f3a2a] text-xs mt-0.5">
            Al cerrar un mes, nadie puede anular ventas ni reeditar facturas de
            ese período. {esAdmin ? '' : 'Solo el administrador puede cerrarlo.'}
          </p>
        </div>
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={4} columnas={3} />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-4">
            {(periodos ?? []).map((p) => {
              const cerrado = p.estado === 'cerrado'
              return (
                <div
                  key={`${p.anio}-${p.mes}`}
                  className={cn(
                    'rounded-xl border p-3 flex flex-col gap-1.5',
                    cerrado
                      ? 'border-[#c43e2c]/40 bg-[#c43e2c]/5'
                      : 'border-[#e4c9b0]/60 bg-white'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#391511] text-sm">
                      {nombreMes(p.mes)} {p.anio}
                    </span>
                    {cerrado ? (
                      <Lock className="h-3.5 w-3.5 text-[#c43e2c]" />
                    ) : (
                      <LockOpen className="h-3.5 w-3.5 text-[#2f7d4f]" />
                    )}
                  </div>
                  {esAdmin &&
                    (cerrado ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setAccionPendiente({
                            tipo: 'reabrir',
                            anio: p.anio,
                            mes: p.mes,
                          })
                        }
                        disabled={reabrir.isPending}
                        className="h-7 text-xs border-[#e4c9b0] text-[#6f3a2a] gap-1"
                      >
                        <LockOpen className="h-3 w-3" />
                        Reabrir
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() =>
                          setAccionPendiente({
                            tipo: 'cerrar',
                            anio: p.anio,
                            mes: p.mes,
                          })
                        }
                        disabled={cerrar.isPending}
                        className="h-7 text-xs bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1"
                      >
                        <Lock className="h-3 w-3" />
                        Cerrar
                      </Button>
                    ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Log de auditoría */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <h3 className="text-[#391511] font-semibold text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#f9b44c]" />
            Auditoría — anulaciones, caja fuerte y cierres
          </h3>
        </div>
        {!auditoria || auditoria.length === 0 ? (
          <div className="p-10 text-center text-[#6f3a2a] text-sm">
            Todavía no hay registros de auditoría.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">Fecha</TableHead>
                  <TableHead className="text-[#391511] font-semibold">Usuario</TableHead>
                  <TableHead className="text-[#391511] font-semibold">Acción</TableHead>
                  <TableHead className="text-[#391511] font-semibold">Detalle</TableHead>
                  <TableHead className="text-[#391511] font-semibold">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditoria.map((a) => (
                  <TableRow key={a.id} className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]">
                    <TableCell className="text-xs text-[#6f3a2a] tabular-nums whitespace-nowrap">
                      {formatearFechaHora(a.created_at)}
                    </TableCell>
                    <TableCell className="text-sm text-[#391511]">
                      {a.usuario_nombre ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-[#391511]">
                      {ETIQUETA_ACCION[a.accion] ?? a.accion}
                      {a.entidad_id ? (
                        <span className="text-[#c8a58a] font-mono text-xs">
                          {' '}
                          #{a.entidad_id}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-[#6f3a2a] font-mono max-w-xs truncate">
                      {a.detalle ? JSON.stringify(a.detalle) : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-[#c8a58a] font-mono">
                      {a.ip ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ConfirmacionAccion
        abierto={accionPendiente !== null}
        onCambioAbierto={(v) => {
          if (!v) setAccionPendiente(null)
        }}
        titulo={
          accionPendiente
            ? `${accionPendiente.tipo === 'cerrar' ? 'Cerrar' : 'Reabrir'} ${nombreMes(accionPendiente.mes)} ${accionPendiente.anio}`
            : ''
        }
        descripcion={
          accionPendiente?.tipo === 'cerrar'
            ? 'Después de cerrar el mes, nadie va a poder anular ventas ni reeditar facturas de ese período. Lo podés reabrir más adelante si hace falta.'
            : 'Vas a reabrir el mes: se van a poder volver a anular ventas y editar facturas de ese período.'
        }
        textoConfirmar={
          accionPendiente?.tipo === 'cerrar'
            ? 'Sí, cerrar el mes'
            : 'Sí, reabrir el mes'
        }
        destructiva={accionPendiente?.tipo === 'cerrar'}
        procesando={cerrar.isPending || reabrir.isPending}
        onConfirmar={confirmarAccion}
      />
    </div>
  )
}
