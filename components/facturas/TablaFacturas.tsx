'use client'

import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { EstadoError } from '@/components/shared/EstadoError'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearFechaCortaISO } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import { nroComprobante, type AccionFactura, type FilaPortal } from '@/lib/facturas/portal'
import { ChipEstadoFactura, marcaEsAlerta, textoMarca } from './ChipEstadoFactura'

const ETIQUETA_ACCION: Record<AccionFactura, string> = {
  cargar_factura: 'Cargar factura',
  validar: 'Validar',
  pagar: 'Pagar',
  ver: 'Ver',
}

interface Props {
  filas: FilaPortal[]
  cargando: boolean
  error: boolean
  onReintentar: () => void
  /** Click en la fila: abre el panel de detalle. */
  onVer: (fila: FilaPortal) => void
  /** Click en el botón de la fila: la acción que corresponde al estado. */
  onAccion: (fila: FilaPortal) => void
  /** Mensaje del estado vacío (depende del filtro). */
  vacio: string
}

/**
 * Lista única del portal: una fila por factura o deuda, con el origen, el
 * vencimiento, el total con su saldo, el estado y UN botón contextual.
 */
export function TablaFacturas({
  filas,
  cargando,
  error,
  onReintentar,
  onVer,
  onAccion,
  vacio,
}: Props) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      {cargando ? (
        <div className="p-6">
          <SkeletonTabla filas={6} columnas={6} />
        </div>
      ) : error ? (
        <div className="p-6">
          <EstadoError
            mensaje="No pudimos cargar las facturas. Revisá tu conexión e intentá de nuevo."
            onReintentar={onReintentar}
          />
        </div>
      ) : filas.length === 0 ? (
        <div className="p-12 text-center">
          <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
            <CheckCircle2 className="h-6 w-6 text-[#6f3a2a]" />
          </div>
          <p className="text-[#391511] font-semibold">Nada por acá</p>
          <p className="text-[#6f3a2a] text-sm mt-1">{vacio}</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
              <TableHead className="text-[#391511] font-semibold">
                Proveedor · comprobante
              </TableHead>
              <TableHead className="text-[#391511] font-semibold">Origen</TableHead>
              <TableHead className="text-[#391511] font-semibold">Vence</TableHead>
              <TableHead className="text-right text-[#391511] font-semibold">
                Total
              </TableHead>
              <TableHead className="text-[#391511] font-semibold">Estado</TableHead>
              <TableHead className="text-right w-40 text-[#391511] font-semibold">
                Acción
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((f) => {
              const nro = nroComprobante(f.factura)
              const alerta = f.marcas.find(marcaEsAlerta)
              const marcaInfo = f.marcas.find((m) => !marcaEsAlerta(m))
              return (
                <TableRow
                  key={f.clave}
                  onClick={() => onVer(f)}
                  className={cn(
                    'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6] cursor-pointer align-top',
                    f.estado === 'vencida' &&
                      'bg-[#c43e2c]/[0.04] hover:bg-[#c43e2c]/[0.07]'
                  )}
                >
                  <TableCell>
                    <div className="font-semibold text-[#391511]">{f.proveedor_nombre}</div>
                    <div className="text-[11px] text-[#6f3a2a] font-mono">
                      {nro ? (
                        <>
                          {nro}
                          {f.factura?.fecha && (
                            <span className="font-sans">
                              {' '}· emitida {formatearFechaCortaISO(f.factura.fecha)}
                            </span>
                          )}
                        </>
                      ) : f.factura ? (
                        <span className="font-sans italic">sin datos del comprobante</span>
                      ) : (
                        <span className="font-sans italic">
                          sin comprobante todavía
                          {f.cuenta?.numero_factura ? ` · ref. ${f.cuenta.numero_factura}` : ''}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {f.pedido_id != null ? (
                      <>
                        <div className="text-[#391511]">Orden #{f.pedido_id}</div>
                        {f.cuenta?.provisoria && !f.factura && (
                          <div className="text-[11px] text-[#6f3a2a]">recibida, a la espera del papel</div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-[#391511]">Compra directa</div>
                        {f.factura?.usuario_nombre && (
                          <div className="text-[11px] text-[#6f3a2a]">
                            cargó {f.factura.usuario_nombre}
                          </div>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-sm tabular-nums',
                      f.estado === 'vencida'
                        ? 'text-[#c43e2c] font-semibold'
                        : 'text-[#6f3a2a]'
                    )}
                  >
                    {f.estado === 'pagada' || f.cuenta?.estado === 'pagada' || !f.vence
                      ? '—'
                      : formatearFechaCortaISO(f.vence)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className="font-bold text-[#391511]">
                      <MontoARS monto={f.total} />
                    </div>
                    <div className="text-[11px] text-[#6f3a2a]">
                      {f.estado === 'sin_factura' ? (
                        f.total <= 0.009 ? 'sin importe · lo define la factura' : 'estimado de la recepción'
                      ) : f.estado === 'pagada' ? (
                        <>pagada{f.fecha_pago ? ` ${formatearFechaCortaISO(f.fecha_pago)}` : ''}</>
                      ) : f.pagado > 0.009 ? (
                        <>
                          pagado <MontoARS monto={f.pagado} /> · saldo <MontoARS monto={f.saldo} />
                        </>
                      ) : f.cuenta ? (
                        <>saldo <MontoARS monto={f.saldo} /></>
                      ) : (
                        'pagada en el acto'
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ChipEstadoFactura estado={f.estado} />
                    {(alerta || marcaInfo) && (
                      <div
                        className={cn(
                          'text-[11px] mt-1',
                          alerta ? 'text-[#c43e2c]' : 'text-[#6f3a2a]'
                        )}
                      >
                        {textoMarca(alerta ?? marcaInfo!, f)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant={f.accion === 'ver' ? 'ghost' : 'default'}
                      onClick={(e) => {
                        e.stopPropagation()
                        onAccion(f)
                      }}
                      className={cn(
                        'h-8 text-xs',
                        f.accion === 'ver'
                          ? 'text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]'
                          : f.accion === 'validar'
                            ? 'bg-[#7f77dd] hover:bg-[#6a62c9] text-white font-semibold'
                            : 'bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold'
                      )}
                    >
                      {ETIQUETA_ACCION[f.accion]}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
