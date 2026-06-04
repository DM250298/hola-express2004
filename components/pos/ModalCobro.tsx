'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Ticket, Trash2, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import { useShortcuts } from '@/lib/hooks/useShortcuts'
import { useMediosPagoActivos } from '@/lib/hooks/useMediosPago'
import { getNotaCredito } from '@/lib/queries/devoluciones'
import { resolverIconoMedio } from '@/lib/utils/iconosMedioPago'
import { formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { MedioPago } from '@/types/database'
import type { PagoPayload } from '@/lib/queries/ventas'

/** Código "sintético" que representa el cobro por maquinita Point. */
export const MEDIO_MAQUINITA = '__maquinita'
/** Código "sintético" para pagar con una nota de crédito (vale). */
export const MEDIO_NOTA_CREDITO = '__nc'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  total: number
  procesando: boolean
  onConfirmar: (pagos: PagoPayload[], vueltoEfectivo: number) => void
  /**
   * Si está presente y el cobro incluye una línea de maquinita, se llama
   * con los demás pagos y el monto a cobrar por la terminal. El parent
   * abre el modal de la maquinita y registra la venta al aprobarse.
   */
  onCobrarConMaquinita?: (
    pagosNoMaq: PagoPayload[],
    montoMaquinita: number
  ) => void
  /** ¿Hay alguna terminal Point activa configurada en el sistema? */
  hayTerminalActiva?: boolean
}

interface PagoLinea {
  id: string
  medio: MedioPago
  monto: string // editable como string
  /** Solo para nota de crédito. */
  ncCodigo?: string
  ncSaldo?: number
}

function nuevoId() {
  return Math.random().toString(36).slice(2, 9)
}

export function ModalCobro({
  abierto,
  onCambioAbierto,
  total,
  procesando,
  onConfirmar,
  onCobrarConMaquinita,
  hayTerminalActiva = false,
}: Props) {
  const { data: mediosActivos } = useMediosPagoActivos()
  const [pagos, setPagos] = useState<PagoLinea[]>([])
  const [indiceActivo, setIndiceActivo] = useState(0)
  const [ncInput, setNcInput] = useState('')
  const [validandoNc, setValidandoNc] = useState(false)

  // Medios disponibles (dinámicos). Los primeros 4 reciben atajo F1-F4.
  // Si hay terminal activa, agregamos "Maquinita" como un medio extra al final.
  const medios = useMemo(() => {
    const base = (mediosActivos ?? []).map((m, i) => ({
      valor: m.codigo,
      etiqueta: m.nombre,
      Icono: resolverIconoMedio(m.icono),
      tecla: i < 4 ? `F${i + 1}` : null,
      comision: m.comision_porcentaje,
    }))
    if (hayTerminalActiva && onCobrarConMaquinita) {
      base.push({
        valor: MEDIO_MAQUINITA,
        etiqueta: 'Posnet',
        Icono: Wifi,
        tecla: null,
        comision: 0,
      })
    }
    base.push({
      valor: MEDIO_NOTA_CREDITO,
      etiqueta: 'Nota de crédito',
      Icono: Ticket,
      tecla: null,
      comision: 0,
    })
    return base
  }, [mediosActivos, hayTerminalActiva, onCobrarConMaquinita])

  const medioInicial: MedioPago = medios[0]?.valor ?? 'efectivo'

  useEffect(() => {
    if (abierto) {
      setPagos([{ id: nuevoId(), medio: medioInicial, monto: '' }])
      setIndiceActivo(0)
      setNcInput('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto])

  const pagoActivo = pagos[indiceActivo] ?? null

  // Totales
  const sumaPagos = pagos.reduce((acc, p) => acc + (Number(p.monto) || 0), 0)
  const restante = Math.max(0, total - sumaPagos)
  const cubierto = sumaPagos >= total

  // Vuelto: total efectivo - lo que el efectivo necesita cubrir
  const totalEfectivo = pagos
    .filter((p) => p.medio === 'efectivo')
    .reduce((acc, p) => acc + (Number(p.monto) || 0), 0)
  const totalNoEfectivo = sumaPagos - totalEfectivo
  const vuelto = Math.max(0, totalEfectivo - Math.max(0, total - totalNoEfectivo))

  const sinMedios = (mediosActivos ?? []).length === 0
  // Las líneas de nota de crédito deben tener código y no superar su saldo
  const ncOk = pagos.every(
    (p) =>
      p.medio !== MEDIO_NOTA_CREDITO ||
      (!!p.ncCodigo && Number(p.monto) <= (p.ncSaldo ?? 0) + 0.01)
  )
  const puedeConfirmar =
    !procesando &&
    !sinMedios &&
    cubierto &&
    ncOk &&
    pagos.length > 0 &&
    pagos.every((p) => Number(p.monto) > 0)
  const pagoActivoEsEfectivo = pagoActivo?.medio === 'efectivo'
  const pagoActivoEsNc = pagoActivo?.medio === MEDIO_NOTA_CREDITO
  // Mientras se tipea el código del vale, se apaga el teclado del cobro para
  // que las teclas vayan al input y no al keypad de montos.
  const ingresandoCodigoNc = pagoActivoEsNc && !pagoActivo?.ncCodigo

  function cambiarMedio(medio: MedioPago) {
    if (!pagoActivo) return
    setPagos((prev) =>
      prev.map((p, i) =>
        i === indiceActivo
          ? {
              ...p,
              medio,
              // al salir de nota de crédito, limpiar sus datos
              ncCodigo: medio === MEDIO_NOTA_CREDITO ? p.ncCodigo : undefined,
              ncSaldo: medio === MEDIO_NOTA_CREDITO ? p.ncSaldo : undefined,
            }
          : p
      )
    )
  }

  async function validarNc() {
    if (!pagoActivo) return
    const cod = ncInput.trim()
    if (!cod) return
    setValidandoNc(true)
    try {
      const nc = await getNotaCredito(cod)
      if (!nc || nc.estado !== 'activa' || nc.saldo_disponible <= 0) {
        toast.error('Nota de crédito no válida o sin saldo.')
        return
      }
      const otros = pagos.reduce(
        (acc, p, i) => (i === indiceActivo ? acc : acc + (Number(p.monto) || 0)),
        0
      )
      const necesario = Math.max(0, total - otros)
      const aplicar = Math.min(nc.saldo_disponible, necesario || nc.saldo_disponible)
      setPagos((prev) =>
        prev.map((p, i) =>
          i === indiceActivo
            ? {
                ...p,
                ncCodigo: nc.codigo,
                ncSaldo: nc.saldo_disponible,
                monto: aplicar.toFixed(2),
              }
            : p
        )
      )
      setNcInput('')
      toast.success(`Vale ${nc.codigo} aplicado`)
    } catch {
      toast.error('No se pudo validar la nota de crédito.')
    } finally {
      setValidandoNc(false)
    }
  }

  function setearMontoActivo(monto: string) {
    setPagos((prev) =>
      prev.map((p, i) => (i === indiceActivo ? { ...p, monto } : p))
    )
  }

  function exactoActivo() {
    if (!pagoActivo) return
    const otrosPagos = pagos.reduce(
      (acc, p, i) => (i === indiceActivo ? acc : acc + (Number(p.monto) || 0)),
      0
    )
    const necesario = Math.max(0, total - otrosPagos)
    setearMontoActivo(necesario.toFixed(2))
  }

  function agregarPago() {
    if (pagos.length >= 4 || medios.length === 0) return
    const ultimo = pagos[pagos.length - 1]?.medio
    const candidato =
      medios.find((m) => m.valor !== ultimo)?.valor ?? medios[0].valor
    setPagos((prev) => [...prev, { id: nuevoId(), medio: candidato, monto: '' }])
    setIndiceActivo(pagos.length)
  }

  function quitarPago(idx: number) {
    if (pagos.length <= 1) return
    setPagos((prev) => prev.filter((_, i) => i !== idx))
    setIndiceActivo((curr) => Math.max(0, Math.min(curr, pagos.length - 2)))
  }

  function mapPago(p: PagoLinea): PagoPayload {
    if (p.medio === MEDIO_NOTA_CREDITO) {
      return {
        medio_pago: 'nota_credito',
        monto: Number(p.monto),
        nc_codigo: p.ncCodigo ?? null,
      }
    }
    return { medio_pago: p.medio, monto: Number(p.monto) }
  }

  function confirmar() {
    if (!puedeConfirmar) return
    // Si hay una línea de maquinita y el parent sabe manejarla, desviamos
    // a ese flujo: el parent abre la maquinita con el monto parcial y
    // registra la venta al aprobarse.
    const lineaMaq = pagos.find((p) => p.medio === MEDIO_MAQUINITA)
    if (lineaMaq && onCobrarConMaquinita) {
      const otros: PagoPayload[] = pagos
        .filter((p) => p.medio !== MEDIO_MAQUINITA)
        .map(mapPago)
      onCobrarConMaquinita(otros, Number(lineaMaq.monto))
      return
    }
    onConfirmar(pagos.map(mapPago), vuelto)
  }

  const shortcuts = useMemo(
    () => [
      // F1-F4 cambian el medio del pago activo (según orden de los medios)
      ...medios
        .filter((m) => m.tecla)
        .map((m) => ({
          tecla: m.tecla as string,
          accion: () => cambiarMedio(m.valor),
          cuandoEscribe: true,
        })),
      { tecla: 'F5', accion: exactoActivo, cuandoEscribe: true },
      { tecla: 'F6', accion: agregarPago, cuandoEscribe: true },
      {
        tecla: 'Enter',
        accion: confirmar,
        cuandoEscribe: true,
        preventDefault: false,
      },
      {
        tecla: 'Backspace',
        accion: () => {
          if (!pagoActivo) return
          setearMontoActivo(pagoActivo.monto.slice(0, -1))
        },
        cuandoEscribe: true,
      },
      ...'0123456789'.split('').map((d) => ({
        tecla: d,
        accion: () => {
          if (!pagoActivo) return
          if (pagoActivo.monto.length >= 11) return
          setearMontoActivo(pagoActivo.monto + d)
        },
        cuandoEscribe: true,
      })),
      {
        tecla: '.',
        accion: () => {
          if (!pagoActivo) return
          if (pagoActivo.monto.includes('.')) return
          setearMontoActivo(pagoActivo.monto + '.')
        },
        cuandoEscribe: true,
      },
      {
        tecla: ',',
        accion: () => {
          if (!pagoActivo) return
          if (pagoActivo.monto.includes('.')) return
          setearMontoActivo(pagoActivo.monto + '.')
        },
        cuandoEscribe: true,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagoActivo, pagos, indiceActivo, total, puedeConfirmar, medios]
  )

  useShortcuts(shortcuts, abierto && !procesando && !ingresandoCodigoNc)

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center justify-between">
            <span>Cobrar venta</span>
            <span className="text-2xl font-extrabold tabular-nums">
              <MontoARS monto={total} />
            </span>
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Podés combinar varios medios de pago.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {sinMedios ? (
            <div className="text-center py-8 text-[#c43e2c] text-sm">
              No hay medios de pago activos. Activá al menos uno en
              <br />
              Finanzas → Cuentas → Medios de pago del POS.
            </div>
          ) : (
            <>
              {/* Selector de medio para el pago ACTIVO */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Medio del pago seleccionado
                  </span>
                  {pagos.length < 4 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={agregarPago}
                      disabled={procesando}
                      className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] gap-1 text-xs"
                    >
                      <Plus className="h-3 w-3" />
                      Agregar pago
                      <kbd className="ml-1 px-1 py-0 bg-[#fdfaf6] border border-[#e4c9b0] rounded text-[9px] font-mono">
                        F6
                      </kbd>
                    </Button>
                  )}
                </div>
                <div
                  className={cn(
                    'grid gap-2',
                    medios.length <= 2 && 'grid-cols-2',
                    medios.length === 3 && 'grid-cols-3',
                    medios.length >= 4 && 'grid-cols-4'
                  )}
                >
                  {medios.map((m) => {
                    const Icono = m.Icono
                    const activo = pagoActivo?.medio === m.valor
                    return (
                      <button
                        key={m.valor}
                        type="button"
                        onClick={() => cambiarMedio(m.valor)}
                        disabled={procesando}
                        title={`${m.etiqueta}${m.tecla ? ` (${m.tecla})` : ''}${
                          m.comision > 0 ? ` · ${m.comision}% comisión` : ''
                        }`}
                        className={cn(
                          'relative flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl border-2 transition-all',
                          activo
                            ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                            : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                        )}
                      >
                        {m.tecla && (
                          <kbd
                            className={cn(
                              'absolute top-1 right-1 px-1 py-0 rounded text-[9px] font-mono font-bold',
                              activo
                                ? 'bg-[#391511]/15 text-[#391511]'
                                : 'bg-[#fdfaf6] text-[#c8a58a] border border-[#e4c9b0]'
                            )}
                          >
                            {m.tecla}
                          </kbd>
                        )}
                        <Icono className="h-5 w-5" />
                        <span className="text-xs font-semibold text-center leading-tight">
                          {m.etiqueta}
                        </span>
                        {m.comision > 0 && (
                          <span className="text-[9px] text-[#c8a58a] font-mono leading-none">
                            {m.comision}% com.
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Nota de crédito: ingresar código del vale */}
              {pagoActivoEsNc && (
                <div className="rounded-xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/8 p-3 space-y-2">
                  {pagoActivo?.ncCodigo ? (
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-[#391511] font-semibold">
                        Vale {pagoActivo.ncCodigo}
                      </span>
                      <span className="text-[#6f3a2a]">
                        saldo <MontoARS monto={pagoActivo.ncSaldo ?? 0} />
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                          Código de la nota de crédito
                        </label>
                        <Input
                          value={ncInput}
                          autoFocus
                          onChange={(e) => setNcInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              validarNc()
                            }
                          }}
                          placeholder="Ej: NC-260604-3271"
                          className="h-10 border-[#e4c9b0] focus-visible:ring-[#f9b44c] font-mono"
                        />
                      </div>
                      <Button
                        type="button"
                        onClick={validarNc}
                        disabled={validandoNc || !ncInput.trim()}
                        className="h-10 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
                      >
                        {validandoNc ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Aplicar'
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Lista de pagos */}
              <div>
                <div className="text-xs uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
                  Pagos
                </div>
                <ul className="space-y-2">
                  {pagos.map((p, idx) => {
                    const activo = idx === indiceActivo
                    const medioConfig =
                      medios.find((m) => m.valor === p.medio) ?? medios[0]
                    const Icono = medioConfig
                      ? medioConfig.Icono
                      : resolverIconoMedio(null)
                    return (
                      <li key={p.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setIndiceActivo(idx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setIndiceActivo(idx)
                            }
                          }}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-all text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#f9b44c]',
                            activo
                              ? 'border-[#f9b44c] bg-[#f9b44c]/10'
                              : 'border-[#e4c9b0] bg-white hover:border-[#c8a58a]'
                          )}
                        >
                          <Icono className="h-4 w-4 text-[#6f3a2a] shrink-0" />
                          <span className="text-xs font-semibold text-[#391511] w-24 truncate">
                            {medioConfig ? medioConfig.etiqueta : p.medio}
                          </span>
                          <div className="flex-1 flex items-center">
                            <span className="text-[#6f3a2a] mr-1">$</span>
                            <span className="text-[#391511] text-lg font-extrabold tabular-nums">
                              {p.monto || '0'}
                            </span>
                          </div>
                          {pagos.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                quitarPago(idx)
                              }}
                              className="text-[#c8a58a] hover:text-[#c43e2c] p-1"
                              aria-label="Quitar pago"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* Totalizador */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl px-3 py-2 bg-[#fdfaf6] border border-[#e4c9b0]/60">
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    {cubierto ? 'Cubierto' : 'Falta'}
                  </div>
                  <div
                    className={cn(
                      'text-xl font-extrabold tabular-nums',
                      cubierto ? 'text-[#391511]' : 'text-[#c43e2c]'
                    )}
                  >
                    {cubierto
                      ? formatearMonto(sumaPagos)
                      : formatearMonto(restante)}
                  </div>
                </div>
                <div
                  className={cn(
                    'rounded-xl px-3 py-2 border',
                    vuelto > 0
                      ? 'bg-[#f9b44c]/15 border-[#f9b44c]/40'
                      : 'bg-[#fdfaf6] border-[#e4c9b0]/60'
                  )}
                >
                  <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                    Vuelto (efectivo)
                  </div>
                  <div className="text-xl font-extrabold tabular-nums text-[#391511]">
                    {formatearMonto(vuelto)}
                  </div>
                </div>
              </div>

              {pagoActivoEsEfectivo && (
                <div className="text-[10px] text-[#6f3a2a] text-center">
                  Tip:{' '}
                  <kbd className="px-1 py-0 bg-white border border-[#e4c9b0] rounded text-[9px] font-mono">
                    F5
                  </kbd>{' '}
                  completa el monto restante con el pago activo.
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 h-12 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={!puedeConfirmar}
            className="flex-[2] h-12 text-base bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl disabled:opacity-50 gap-2"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Procesando…
              </>
            ) : (
              <>
                Confirmar venta
                <kbd className="px-1.5 py-0.5 bg-[#391511]/15 border border-[#391511]/20 rounded text-xs font-mono">
                  ↵
                </kbd>
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
