'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Check,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  ShieldCheck,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { GaleriaComprobantes } from '@/components/compras/GaleriaComprobantes'
import { CuerpoCuentaPagar } from '@/components/finanzas/DrawerCuentaPagar'
import {
  formatearFechaCorta,
  formatearFechaCortaISO,
  formatearFechaHora,
} from '@/lib/utils/formato'
import {
  useAnularCompraDirecta,
  useAnularFacturaCompra,
  useItemsFacturaCompra,
  useValidarFactura,
} from '@/lib/hooks/useFacturasCompra'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'
import { nroComprobante, type FilaPortal } from '@/lib/facturas/portal'
import { ChipEstadoFactura, marcaEsAlerta, textoMarca } from './ChipEstadoFactura'

interface Props {
  fila: FilaPortal | null
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Abre el editor de factura (cargar o editar) para la deuda de la fila. */
  onEditarFactura: (fila: FilaPortal) => void
  /** Abre la revisión de datos fiscales de una compra directa. */
  onRevisarDirecta: (fila: FilaPortal) => void
  /** Abre el modal de pago. */
  onPagar: (fila: FilaPortal) => void
}

/**
 * Panel de detalle del portal: toda la información de una factura en un solo
 * lugar — cabecera fiscal, línea de pasos, importes, cruce con la recepción,
 * pago, renglones, fotos del remito, y las acciones del estado.
 */
export function DrawerFactura({
  fila,
  abierto,
  onCambioAbierto,
  onEditarFactura,
  onRevisarDirecta,
  onPagar,
}: Props) {
  const { data: usuario } = useUsuario()
  const validar = useValidarFactura()
  const anularFactura = useAnularFacturaCompra()
  const anularDirecta = useAnularCompraDirecta()
  const [verRenglones, setVerRenglones] = useState(false)
  const { data: items, isLoading: cargandoItems } = useItemsFacturaCompra(
    abierto && verRenglones ? (fila?.factura?.id ?? null) : null
  )

  if (!fila) return null
  const { cuenta, factura, estado } = fila
  const nro = nroComprobante(factura)
  const ocupado = validar.isPending || anularFactura.isPending || anularDirecta.isPending

  // Pasos de la línea: hecho / actual / pendiente.
  const pasos: { etiqueta: string; detalle?: string; hecho: boolean; omitido?: boolean }[] = [
    {
      etiqueta: fila.pedido_id != null ? 'Recibida' : 'Compra directa',
      detalle:
        fila.pedido_id != null
          ? `orden #${fila.pedido_id}`
          : factura
            ? formatearFechaCortaISO(factura.fecha)
            : undefined,
      hecho: true,
    },
    {
      etiqueta: 'Factura cargada',
      detalle: factura ? formatearFechaCorta(factura.created_at) : undefined,
      hecho: !!factura || (cuenta?.tiene_factura ?? false),
    },
    {
      etiqueta: 'Validada',
      detalle: factura?.validada_at ? formatearFechaCorta(factura.validada_at) : undefined,
      hecho: !!factura?.validada || (!factura && (cuenta?.tiene_factura ?? false)),
    },
    {
      etiqueta: 'Pagada',
      detalle:
        estado === 'pagada'
          ? fila.fecha_pago
            ? formatearFechaCortaISO(fila.fecha_pago)
            : undefined
          : fila.vence
            ? `vence ${formatearFechaCortaISO(fila.vence)}`
            : undefined,
      hecho: estado === 'pagada',
    },
  ]
  const indiceActual = pasos.findIndex((p) => !p.hecho)

  function handleValidar(valor: boolean) {
    if (!factura) return
    validar.mutate({ facturaId: factura.id, validar: valor })
  }

  function handleAnular() {
    if (!usuario || !factura) return
    if (factura.es_directa) {
      const ok = window.confirm(
        'Anular esta compra directa: repone el stock, revierte el pago y borra el comprobante. ¿Seguir?'
      )
      if (!ok) return
      anularDirecta.mutate(
        { facturaId: factura.id, usuarioId: usuario.id },
        { onSuccess: () => onCambioAbierto(false) }
      )
      return
    }
    if (!cuenta) return
    const ok = window.confirm(
      'Anular la factura: la deuda vuelve al estimado de la recepción y se revierte el stock que ajustó la factura. ¿Seguir?'
    )
    if (!ok) return
    anularFactura.mutate(
      { cuentaId: cuenta.id, usuarioId: usuario.id },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent className="overflow-y-auto p-0 data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] flex items-start justify-between gap-2">
            <span>
              {fila.proveedor_nombre}
              {nro && <span className="font-mono text-sm font-normal text-[#6f3a2a]"> · {nro}</span>}
            </span>
            <ChipEstadoFactura estado={estado} size="md" />
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a] text-xs space-x-1">
            {factura?.cuit_proveedor && <span>CUIT {factura.cuit_proveedor} ·</span>}
            {factura?.cae && <span>CAE {factura.cae} ·</span>}
            {fila.pedido_id != null ? (
              <Link
                href={`/pedidos/${fila.pedido_id}`}
                className="inline-flex items-center gap-1 text-[#c43e2c] hover:underline font-mono"
              >
                Orden #{fila.pedido_id}
                <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <span>Compra directa · sin orden</span>
            )}
            {factura && (
              <span>
                · cargada
                {factura.usuario_nombre ? ` por ${factura.usuario_nombre}` : ''} el{' '}
                {formatearFechaHora(factura.created_at)}
              </span>
            )}
          </SheetDescription>
          {fila.marcas.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {fila.marcas.map((m) => (
                <span
                  key={m}
                  className={cn(
                    'rounded-full px-2 py-px text-[10px] font-semibold',
                    marcaEsAlerta(m)
                      ? 'bg-[#c43e2c]/10 text-[#9e2f25]'
                      : 'bg-[#e4c9b0]/40 text-[#6f3a2a]'
                  )}
                >
                  {textoMarca(m, fila)}
                </span>
              ))}
            </div>
          )}
        </SheetHeader>

        <div className="px-5 py-4 space-y-5">
          {/* Línea de pasos */}
          <ol className="flex flex-wrap gap-x-4 gap-y-2 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 px-3 py-2.5">
            {pasos.map((p, i) => {
              const actual = i === indiceActual
              return (
                <li key={p.etiqueta} className="flex items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                      p.hecho
                        ? 'bg-[#2f8f4e] text-white'
                        : actual
                          ? 'bg-[#7f77dd] text-white'
                          : 'border border-[#e4c9b0] text-[#c8a58a]'
                    )}
                  >
                    {p.hecho ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      actual ? 'font-semibold text-[#391511]' : p.hecho ? 'text-[#391511]' : 'text-[#c8a58a]'
                    )}
                  >
                    {p.etiqueta}
                    {p.detalle && <span className="text-[#6f3a2a] font-normal"> · {p.detalle}</span>}
                  </span>
                </li>
              )
            })}
          </ol>

          {/* Tres tarjetas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <Tarjeta titulo="Importes">
              {factura ? (
                <>
                  <Linea etiqueta="Neto" valor={<MontoARS monto={factura.neto} />} />
                  <Linea etiqueta="IVA" valor={<MontoARS monto={factura.iva_total} />} />
                  <Linea etiqueta="Total" valor={<MontoARS monto={factura.total} />} fuerte />
                </>
              ) : (
                <>
                  <Linea
                    etiqueta={cuenta?.provisoria ? 'Estimado' : 'Monto'}
                    valor={<MontoARS monto={fila.total} />}
                    fuerte
                  />
                  <p className="text-[11px] text-[#6f3a2a] pt-1">
                    {fila.total <= 0.009
                      ? 'Se recibió sin costo: el importe lo define la factura.'
                      : 'Es el valor de la recepción; la factura lo ajusta.'}
                  </p>
                </>
              )}
            </Tarjeta>

            <Tarjeta
              titulo="Recibido vs. facturado"
              alerta={(factura?.renglones_diferentes ?? 0) > 0}
            >
              {!factura ? (
                <p className="text-[11px] text-[#6f3a2a]">
                  Se compara al cargar la factura, renglón por renglón.
                </p>
              ) : fila.pedido_id == null ? (
                <p className="text-[11px] text-[#6f3a2a]">
                  Compra directa: no hay orden ni recepción contra la cual cruzar.
                </p>
              ) : !factura.validada ? (
                <p className="text-[11px] text-[#6f3a2a]">
                  El cruce se guarda al validar. Abrí la factura para ver cada renglón
                  (recibido / facturado).
                </p>
              ) : (
                <>
                  <Linea
                    etiqueta="Renglones"
                    valor={
                      (factura.renglones_diferentes ?? 0) === 0
                        ? 'todos coinciden'
                        : `${factura.renglones_diferentes} difieren`
                    }
                  />
                  <Linea
                    etiqueta="Diferencia (neto)"
                    valor={
                      <>
                        {(factura.diferencia_recepcion ?? 0) > 0 ? '+ ' : ''}
                        <MontoARS monto={factura.diferencia_recepcion ?? 0} />
                      </>
                    }
                    fuerte
                    rojo={(factura.renglones_diferentes ?? 0) > 0}
                  />
                </>
              )}
            </Tarjeta>

            <Tarjeta titulo="Pago">
              {cuenta ? (
                <>
                  <Linea
                    etiqueta="Vence"
                    valor={
                      estado === 'pagada'
                        ? 'pagada'
                        : formatearFechaCortaISO(cuenta.fecha_vencimiento)
                    }
                    rojo={estado === 'vencida'}
                  />
                  <Linea etiqueta="Pagado" valor={<MontoARS monto={cuenta.monto_pagado} />} />
                  <Linea
                    etiqueta={estado === 'pagada' ? 'Pagada el' : 'Saldo'}
                    valor={
                      estado === 'pagada' ? (
                        cuenta.fecha_pago ? formatearFechaCortaISO(cuenta.fecha_pago) : '—'
                      ) : (
                        <MontoARS monto={cuenta.saldo_pendiente} />
                      )
                    }
                    fuerte
                  />
                </>
              ) : (
                <>
                  <Linea etiqueta="Condición" valor="pagada en el acto" />
                  <Linea etiqueta="Pagado" valor={<MontoARS monto={fila.total} />} fuerte />
                </>
              )}
            </Tarjeta>
          </div>

          {/* Acciones del estado */}
          <div className="flex flex-wrap gap-2">
            {estado === 'sin_factura' && cuenta && (
              <Button
                onClick={() => onEditarFactura(fila)}
                className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
              >
                <FileText className="mr-1.5 h-4 w-4" />
                Cargar factura
              </Button>
            )}
            {estado === 'a_validar' && factura && (
              <Button
                onClick={() => handleValidar(true)}
                disabled={ocupado}
                className="bg-[#7f77dd] hover:bg-[#6a62c9] text-white font-bold"
              >
                {validar.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                )}
                {cuenta ? 'Validar y pasar a pagar' : 'Validar'}
              </Button>
            )}
            {(estado === 'a_pagar' || estado === 'vencida') && cuenta && (
              <Button
                onClick={() => onPagar(fila)}
                className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
              >
                <Wallet className="mr-1.5 h-4 w-4" />
                Pagar · <MontoARS monto={cuenta.saldo_pendiente} />
              </Button>
            )}
            {factura && cuenta && (
              <Button
                variant="outline"
                onClick={() => onEditarFactura(fila)}
                className="border-[#e4c9b0] text-[#6f3a2a]"
              >
                <FileText className="mr-1.5 h-4 w-4" />
                {estado === 'a_validar' ? 'Abrir factura' : 'Editar factura'}
              </Button>
            )}
            {factura?.es_directa && (
              <Button
                variant="outline"
                onClick={() => onRevisarDirecta(fila)}
                className="border-[#e4c9b0] text-[#6f3a2a]"
              >
                <FileText className="mr-1.5 h-4 w-4" />
                Datos del comprobante
              </Button>
            )}
            {factura?.validada && estado !== 'pagada' && (
              <Button
                variant="ghost"
                onClick={() => handleValidar(false)}
                disabled={ocupado}
                className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
              >
                Reabrir validación
              </Button>
            )}
            {factura && (
              <Button
                variant="ghost"
                onClick={handleAnular}
                disabled={ocupado || !usuario}
                className="ml-auto text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#9e2f25]"
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Anular
              </Button>
            )}
          </div>

          {/* Renglones de la factura */}
          {factura && (
            <div className="rounded-xl border border-[#e4c9b0]/60">
              <button
                type="button"
                onClick={() => setVerRenglones((v) => !v)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-semibold text-[#391511] hover:bg-[#fdfaf6] rounded-xl"
              >
                <span className="inline-flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-[#6f3a2a]" />
                  Renglones y costos
                </span>
                <span className="text-xs font-normal text-[#6f3a2a]">
                  {verRenglones ? 'ocultar' : 'ver'}
                </span>
              </button>
              {verRenglones && (
                <div className="border-t border-[#e4c9b0]/60 px-3 py-2">
                  {cargandoItems ? (
                    <Skeleton className="h-16 rounded-lg bg-[#f9d2a2]/30" />
                  ) : (items ?? []).length === 0 ? (
                    <p className="text-xs text-[#6f3a2a] py-1">Sin renglones cargados.</p>
                  ) : (
                    <ul className="divide-y divide-[#e4c9b0]/40 text-xs">
                      {(items ?? []).map((it, i) => (
                        <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="min-w-0 truncate text-[#391511]">
                            {it.producto_nombre ?? it.descripcion ?? 'Renglón'}
                          </span>
                          <span className="shrink-0 tabular-nums text-[#6f3a2a]">
                            {it.cantidad} × <MontoARS monto={it.costo_sin_iva} />
                            <span className="text-[#c8a58a]"> + IVA {it.iva_compra_porcentaje}%</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Fotos del remito / factura */}
          {fila.pedido_id != null && (
            <GaleriaComprobantes
              pedidoId={fila.pedido_id}
              usuarioId={usuario?.id ?? null}
              soloLectura
            />
          )}

          {/* Deuda: edición, cuotas, historial de pagos */}
          {cuenta && (
            <div className="-mx-5 border-t border-[#e4c9b0]/60">
              <div className="px-5 pt-3 text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Deuda, cuotas y pagos
              </div>
              <CuerpoCuentaPagar
                cuenta={cuenta}
                abierto={abierto}
                onPagar={() => onPagar(fila)}
                sinSaldos
              />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Tarjeta({
  titulo,
  alerta,
  children,
}: {
  titulo: string
  alerta?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3 space-y-1',
        alerta ? 'border-[#c43e2c]/50 bg-[#c43e2c]/[0.03]' : 'border-[#e4c9b0]/60 bg-white'
      )}
    >
      <div
        className={cn(
          'text-[10px] uppercase tracking-wider font-semibold',
          alerta ? 'text-[#9e2f25]' : 'text-[#6f3a2a]'
        )}
      >
        {titulo}
      </div>
      {children}
    </div>
  )
}

function Linea({
  etiqueta,
  valor,
  fuerte,
  rojo,
}: {
  etiqueta: string
  valor: React.ReactNode
  fuerte?: boolean
  rojo?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 text-xs',
        fuerte && 'border-t border-[#e4c9b0]/50 pt-1 mt-1 font-semibold'
      )}
    >
      <span className="text-[#6f3a2a] font-normal">{etiqueta}</span>
      <span className={cn('tabular-nums', rojo ? 'text-[#c43e2c]' : 'text-[#391511]')}>{valor}</span>
    </div>
  )
}
