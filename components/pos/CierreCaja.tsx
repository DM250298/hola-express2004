'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Printer,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'
import { ComprobanteCierre, type DatosComprobanteCierre } from './ComprobanteCierre'
import { ContadorBilletes } from './ContadorBilletes'
import {
  RESUMEN_TURNO_KEY,
  TURNO_KEY,
  useCerrarTurno,
  useResumenTurno,
} from '@/lib/hooks/useTurno'
import { useMediosPago } from '@/lib/hooks/useMediosPago'
import {
  EVENTO_COLA_CAMBIADA,
  leerVentasPendientes,
  reintentarVenta,
  type VentaPendiente,
} from '@/lib/offline/cola'
import { sincronizarVentasPendientes } from '@/lib/offline/sync'
import { purgarShellSW } from '@/lib/offline/shell'
import { cancelarSalida, iniciarSalida } from '@/lib/auth/sesionActual'
import { textoErrorIdentidad } from '@/lib/auth/erroresIdentidad'
import { createClient } from '@/lib/supabase/client'
import { formatearFechaHora, formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  turnoId: number
  montoApertura: number
  fechaApertura: string
  nombreCajero: string
  /**
   * 'pos': lo cierra el cajero en el mostrador. Al cerrar el informe se
   *        CIERRA LA SESIÓN de esta PC, para que el próximo cajero entre con
   *        su usuario y no venda a nombre del anterior.
   * 'admin': cierre administrativo desde el Dashboard (Finanzas) de un turno
   *        que otro empleado dejó abierto. Solo refresca las listas.
   */
  contexto?: 'pos' | 'admin'
}

const COLA_TURNO_KEY = ['cola-offline-turno'] as const

/** Ventas cobradas sin conexión en ESTA PC que pertenecen al turno. */
async function leerColaDelTurno(turnoId: number): Promise<VentaPendiente[]> {
  const todas = await leerVentasPendientes()
  return todas.filter((v) => v.turno_id === turnoId)
}

export function CierreCaja({
  abierto,
  onCambioAbierto,
  turnoId,
  montoApertura,
  fechaApertura,
  nombreCajero,
  contexto = 'pos',
}: Props) {
  const cerrar = useCerrarTurno()
  const qc = useQueryClient()
  const { data: medios } = useMediosPago()
  const [montoCierre, setMontoCierre] = useState('')
  const [novedades, setNovedades] = useState('')
  const [mostrarContador, setMostrarContador] = useState(false)
  const [cantidadesBilletes, setCantidadesBilletes] = useState<Record<number, number>>({})
  const [sincronizandoCola, setSincronizandoCola] = useState(false)
  const [saliendo, setSaliendo] = useState(false)
  /** El informe ya se mandó a imprimir al menos una vez. */
  const [impreso, setImpreso] = useState(false)

  // Calcula el total del contador y actualiza el campo de monto automáticamente
  function handleCantidadesBilletes(nuevas: Record<number, number>) {
    setCantidadesBilletes(nuevas)
    const total = Object.entries(nuevas).reduce(
      (acc, [denom, cant]) => acc + Number(denom) * (cant || 0),
      0
    )
    if (total > 0) setMontoCierre(String(total))
  }
  // Datos del comprobante una vez cerrado el turno
  const [comprobante, setComprobante] = useState<DatosComprobanteCierre | null>(
    null
  )

  // Resumen calculado en el servidor (fn_resumen_turno): mismo cálculo que
  // usa el cierre, sin tope de filas ni ceros por RLS.
  const {
    data: resumen,
    isLoading,
    isError: errorResumen,
    error: errResumen,
  } = useResumenTurno(turnoId, abierto)

  // Ventas offline de este turno que todavía no llegaron al servidor: el
  // arqueo no las cuenta, así que el cierre se bloquea hasta sincronizarlas.
  const { data: cola = [], refetch: refrescarCola } = useQuery({
    queryKey: [...COLA_TURNO_KEY, turnoId],
    queryFn: () => leerColaDelTurno(turnoId),
    enabled: abierto,
    staleTime: 0,
    refetchInterval: abierto ? 5000 : false,
  })
  const hayCola = cola.length > 0

  useEffect(() => {
    if (!abierto) return
    const alCambiar = () => void refrescarCola()
    window.addEventListener(EVENTO_COLA_CAMBIADA, alCambiar)
    return () => window.removeEventListener(EVENTO_COLA_CAMBIADA, alCambiar)
  }, [abierto, refrescarCola])

  useEffect(() => {
    if (abierto) {
      setMontoCierre('')
      setNovedades('')
      setComprobante(null)
      setMostrarContador(false)
      setCantidadesBilletes({})
      setImpreso(false)
    }
  }, [abierto])

  function imprimir() {
    window.print()
    // En Chrome window.print() bloquea hasta que se cierra el diálogo.
    setImpreso(true)
  }

  // Red de seguridad: el navegador avisa cuando termina la impresión.
  useEffect(() => {
    if (!comprobante) return
    const alImprimir = () => setImpreso(true)
    window.addEventListener('afterprint', alImprimir)
    return () => window.removeEventListener('afterprint', alImprimir)
  }, [comprobante])

  // Apenas se cierra el turno se abre solo el diálogo de impresión: el
  // informe se imprime siempre, antes de salir. Una sola vez por cierre.
  const autoImpresoRef = useRef<number | null>(null)
  useEffect(() => {
    if (!comprobante || autoImpresoRef.current === comprobante.turnoId) return
    autoImpresoRef.current = comprobante.turnoId
    // Esperar a que el comprobante térmico esté en el DOM.
    const t = setTimeout(imprimir, 400)
    return () => clearTimeout(t)
  }, [comprobante])

  async function sincronizarCola() {
    if (sincronizandoCola) return
    setSincronizandoCola(true)
    try {
      const r = await sincronizarVentasPendientes()
      if (r.sincronizadas > 0) {
        toast.success(
          `${r.sincronizadas} venta${r.sincronizadas === 1 ? '' : 's'} sincronizada${r.sincronizadas === 1 ? '' : 's'}`
        )
        qc.invalidateQueries({ queryKey: RESUMEN_TURNO_KEY })
      } else if (r.cortadoPorRed) {
        toast.error('Sin conexión: no se pudo sincronizar.')
      } else if (r.conError > 0) {
        toast.error('El servidor rechazó ventas de la cola. Revisá el detalle.')
      }
    } finally {
      setSincronizandoCola(false)
      void refrescarCola()
    }
  }

  async function reintentar(uuid: string) {
    await reintentarVenta(uuid)
    await sincronizarCola()
  }

  // codigo → nombre legible
  const nombreMedio = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const m of medios ?? []) mapa.set(m.codigo, m.nombre)
    return mapa
  }, [medios])

  // Orden de presentación según la tabla de medios
  const ordenMedio = useMemo(() => {
    const mapa = new Map<string, number>()
    ;(medios ?? []).forEach((m) => mapa.set(m.codigo, m.orden))
    return mapa
  }, [medios])

  const desglose = useMemo(() => {
    const ordenDe = (codigo: string) => ordenMedio.get(codigo) ?? 999
    return [...(resumen?.por_medio ?? [])]
      .sort((a, b) => ordenDe(a.codigo) - ordenDe(b.codigo))
      .map((m) => ({
        etiqueta: nombreMedio.get(m.codigo) ?? m.codigo,
        total: m.total,
        cantidad: m.cantidad,
      }))
  }, [resumen, nombreMedio, ordenMedio])

  const montoEsperado = resumen ? resumen.monto_esperado : null

  const cierreNumero = Number(montoCierre)
  const cierreValido =
    montoCierre !== '' && Number.isFinite(cierreNumero) && cierreNumero >= 0
  const diferencia =
    cierreValido && montoEsperado !== null ? cierreNumero - montoEsperado : null

  function handleCerrar() {
    if (!cierreValido || !resumen || hayCola) return
    const nov = novedades.trim() ? novedades.trim() : null
    cerrar.mutate(
      { turnoId, montoCierreReal: cierreNumero, novedades: nov },
      {
        onSuccess: (resultado) => {
          // La sangría automática del efectivo contado la creó el RPC en la
          // misma transacción (antes era un insert aparte del cliente).
          setComprobante({
            turnoId,
            cajeroNombre: resultado.cajero_nombre ?? nombreCajero,
            fechaApertura,
            fechaCierre:
              resultado.turno.fecha_cierre ?? new Date().toISOString(),
            montoApertura: Number(montoApertura),
            cantidadVentas: resumen.cantidad_ventas,
            totalVentas: resumen.total_ventas,
            desglose,
            productos: resumen.productos,
            gastosCaja: resultado.gastos,
            ventasEfectivo: resultado.total_ventas_efectivo,
            cobrosFiado: resultado.total_cobros_fiado,
            sangrias: resultado.sangrias,
            efectivoEsperado: resultado.monto_esperado,
            montoContado: cierreNumero,
            diferencia: resultado.diferencia,
            novedades: nov,
          })
        },
      }
    )
  }

  const cerrado = comprobante !== null

  /**
   * Cierre de turno en el POS = fin de la sesión en esta PC: el próximo
   * cajero entra con SU usuario y abre SU caja. Es la garantía de que cada
   * venta queda a nombre de quien está en el mostrador.
   */
  async function salirTrasCierre() {
    if (saliendo) return
    setSaliendo(true)
    try {
      const supabase = createClient()
      iniciarSalida()
      await purgarShellSW()
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
      window.location.assign('/login?motivo=turno_cerrado')
    } catch {
      cancelarSalida()
      setSaliendo(false)
      toast.error(
        'No se pudo cerrar la sesión. Salí desde el menú cuando tengas conexión.'
      )
      qc.invalidateQueries({ queryKey: TURNO_KEY })
      onCambioAbierto(false)
    }
  }

  /**
   * Cierra el modal. Si el turno ya quedó cerrado (fase informe), recién acá
   * se actúa: en el POS se cierra la sesión; en el Dashboard se refrescan las
   * listas (el modal no se desmonta antes de que se vea/imprima el informe).
   */
  async function cerrarModal() {
    if (cerrado) {
      if (contexto === 'pos') {
        await salirTrasCierre()
        return
      }
      qc.invalidateQueries({ queryKey: TURNO_KEY })
      qc.invalidateQueries({ queryKey: ['dashboard-turnos-dia'] })
      qc.invalidateQueries({ queryKey: ['dashboard-kpis-dia'] })
      qc.invalidateQueries({ queryKey: ['caja-fuerte'] })
    }
    onCambioAbierto(false)
  }

  const esAdmin = contexto === 'admin'

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        if (cerrar.isPending || saliendo) return
        // Con el turno ya cerrado, el informe solo se cierra con el botón
        // (Escape o un clic afuera no lo descartan sin imprimir).
        if (cerrado) return
        if (!v) void cerrarModal()
        else onCambioAbierto(true)
      }}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        {cerrado && comprobante ? (
          /* ─── FASE: turno cerrado — informe imprimible ─── */
          <>
            <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
              <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-[#2f8f4e]" />
                Turno #{turnoId} cerrado
              </DialogTitle>
              <DialogDescription className="text-[#6f3a2a]">
                {esAdmin
                  ? 'Cierre administrativo registrado a tu nombre. Imprimí el informe para que el empleado lo firme.'
                  : impreso
                    ? 'Informe impreso. Si no salió bien, reimprimilo. Al tocar "Listo y salir" se cierra la sesión: el próximo cajero entra con su usuario.'
                    : 'Imprimí el informe para que el empleado lo firme. Es obligatorio antes de salir.'}
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-5 max-h-[60vh] overflow-y-auto">
              {/* Vista previa del comprobante */}
              <div className="flex justify-center bg-[#fdfaf6] rounded-xl p-3 border border-[#e4c9b0]/60">
                <ComprobanteCierre datos={comprobante} />
              </div>
            </div>

            <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => void cerrarModal()}
                disabled={saliendo || (!esAdmin && !impreso)}
                title={
                  !esAdmin && !impreso
                    ? 'Primero imprimí el informe de cierre'
                    : undefined
                }
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                {saliendo ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cerrando sesión…
                  </>
                ) : esAdmin ? (
                  'Listo'
                ) : (
                  'Listo y salir'
                )}
              </Button>
              <Button
                onClick={imprimir}
                disabled={saliendo}
                className="flex-1 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
              >
                <Printer className="h-4 w-4" />
                {impreso ? 'Reimprimir' : 'Imprimir informe'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ─── FASE: arqueo previo al cierre ─── */
          <>
            <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
              <DialogTitle className="text-[#391511] text-lg">
                {esAdmin
                  ? `Cerrar turno #${turnoId} de ${resumen?.cajero_nombre ?? nombreCajero}`
                  : 'Cerrar turno de caja'}
              </DialogTitle>
              <DialogDescription className="text-[#6f3a2a]">
                {esAdmin
                  ? `Abierto ${formatearFechaHora(fechaApertura)}. Contá el efectivo de esa caja y registralo abajo; el cierre queda a tu nombre.`
                  : 'Contá el efectivo en caja y registralo abajo.'}
              </DialogDescription>
            </DialogHeader>

            <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
              {errorResumen && (
                <div className="rounded-xl border border-[#c43e2c]/40 bg-[#c43e2c]/10 px-3 py-2.5 text-sm text-[#9e2f25]">
                  No se pudo calcular el resumen del turno:{' '}
                  {textoErrorIdentidad(errResumen)}
                </div>
              )}

              {/* Ventas offline sin sincronizar: bloquean el cierre. */}
              {hayCola && (
                <div className="rounded-xl border border-[#f9b44c]/60 bg-[#f9b44c]/10 px-3 py-3 space-y-2">
                  <div className="flex items-start gap-2 text-sm text-[#6f3a2a]">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-[#c43e2c]" />
                    <span>
                      Hay <b>{cola.length}</b>{' '}
                      {cola.length === 1 ? 'venta cobrada' : 'ventas cobradas'} sin
                      conexión que todavía no llegaron al servidor. El arqueo no las
                      cuenta: conectate a internet y sincronizá antes de cerrar.
                    </span>
                  </div>
                  <ul className="divide-y divide-[#e4c9b0]/40 rounded-lg bg-white border border-[#e4c9b0]/60">
                    {cola.map((v) => (
                      <li
                        key={v.cliente_uuid}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                      >
                        <span className="text-[#6f3a2a]">
                          {formatearFechaHora(v.creada_en)} ·{' '}
                          <b className="text-[#391511]">{formatearMonto(v.total)}</b>
                          {v.estado === 'error' && (
                            <span className="block text-[#c43e2c]">
                              Rechazada: {v.error ?? 'error desconocido'}
                            </span>
                          )}
                        </span>
                        {v.estado === 'error' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={sincronizandoCola}
                            onClick={() => void reintentar(v.cliente_uuid)}
                            className="h-7 px-2 text-[11px] text-[#6f3a2a]"
                          >
                            Reintentar
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={sincronizandoCola}
                    onClick={() => void sincronizarCola()}
                    className="w-full border-[#e4c9b0] text-[#391511] gap-1.5"
                  >
                    {sincronizandoCola ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Sincronizar ahora
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <ResumenItem
                  etiqueta="Apertura"
                  valor={formatearMonto(montoApertura)}
                />
                <ResumenItem
                  etiqueta="Cantidad de ventas"
                  valor={isLoading ? '…' : `${resumen?.cantidad_ventas ?? 0}`}
                />
              </div>

              {/* Desglose por medio de pago */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
                  Ventas por medio de pago
                </div>
                <div className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden bg-white">
                  <ul className="divide-y divide-[#e4c9b0]/40">
                    {isLoading ? (
                      <li className="px-3 py-2 text-sm text-[#6f3a2a]">
                        Cargando…
                      </li>
                    ) : desglose.length === 0 ? (
                      <li className="px-3 py-2 text-sm text-[#6f3a2a] italic">
                        Sin ventas en el turno.
                      </li>
                    ) : (
                      desglose.map((m) => (
                        <li
                          key={m.etiqueta}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                        >
                          <span className="text-[#391511] font-medium">
                            {m.etiqueta}
                          </span>
                          <div className="text-right">
                            <span className="font-bold text-[#391511] tabular-nums">
                              {formatearMonto(m.total)}
                            </span>
                            <span className="text-[#c8a58a] text-xs ml-2 tabular-nums">
                              {m.cantidad} {m.cantidad === 1 ? 'pago' : 'pagos'}
                            </span>
                          </div>
                        </li>
                      ))
                    )}
                    <li className="flex items-center justify-between px-3 py-2.5 text-sm bg-[#fdfaf6]">
                      <span className="text-[#391511] font-bold uppercase tracking-wide text-xs">
                        Total ventas
                      </span>
                      <span className="font-extrabold text-[#391511] tabular-nums">
                        {isLoading
                          ? '…'
                          : formatearMonto(resumen?.total_ventas ?? 0)}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Cobros de fiado en efectivo: plata que entró al cajón sin
                  ser una venta del turno — suma al esperado. */}
              {(resumen?.cobros_fiado ?? 0) > 0.009 && (
                <div className="rounded-xl border border-[#f9b44c]/40 bg-[#f9b44c]/10 px-3 py-2 flex items-center justify-between text-sm">
                  <span className="text-[#6f3a2a] font-medium">
                    Cobros de fiado (efectivo)
                  </span>
                  <span className="font-bold text-[#391511] tabular-nums">
                    +{formatearMonto(resumen?.cobros_fiado ?? 0)}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <ResumenItem
                  etiqueta="Gastos de caja"
                  valor={
                    isLoading ? '…' : formatearMonto(resumen?.gastos ?? 0)
                  }
                />
                <ResumenItem
                  etiqueta="Sangrías (a caja fuerte)"
                  valor={
                    isLoading ? '…' : formatearMonto(resumen?.sangrias ?? 0)
                  }
                />
                <ResumenItem
                  etiqueta="Esperado en caja"
                  valor={
                    montoEsperado != null
                      ? formatearMonto(montoEsperado)
                      : '…'
                  }
                  destacado
                />
              </div>

              {/* Contador de billetes (opcional) */}
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setMostrarContador((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl border border-[#e4c9b0]/60 bg-white text-sm font-medium text-[#391511] hover:bg-[#f9d2a2]/30 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    🪙 Contar billetes
                    <span className="text-[11px] text-[#c8a58a] font-normal">
                      — calcula el total automáticamente
                    </span>
                  </span>
                  <span className="text-[#6f3a2a] text-xs">
                    {mostrarContador ? '▲ ocultar' : '▼ mostrar'}
                  </span>
                </button>

                {mostrarContador && (
                  <ContadorBilletes
                    cantidades={cantidadesBilletes}
                    onChange={handleCantidadesBilletes}
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="monto-cierre"
                  className="text-[#391511] font-medium"
                >
                  Monto contado en caja
                </Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6f3a2a] text-xl font-bold">
                    $
                  </span>
                  <Input
                    id="monto-cierre"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={montoCierre}
                    onChange={(e) => setMontoCierre(e.target.value)}
                    placeholder="0,00"
                    autoFocus
                    disabled={cerrar.isPending}
                    className="pl-10 h-14 text-2xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                  />
                </div>
              </div>

              {diferencia !== null && (
                <div
                  className={cn(
                    'rounded-xl p-3 text-center',
                    Math.abs(diferencia) < 0.01
                      ? 'bg-[#f9b44c]/15 text-[#6f3a2a]'
                      : diferencia > 0
                        ? 'bg-[#ebd5a1]/40 text-[#6f3a2a]'
                        : 'bg-[#c43e2c]/15 text-[#9e2f25]'
                  )}
                >
                  <span className="text-xs font-medium uppercase tracking-wide">
                    Diferencia
                  </span>
                  <div className="text-xl font-bold tabular-nums">
                    {diferencia >= 0 ? '+' : '-'}
                    <MontoARS monto={Math.abs(diferencia)} />
                  </div>
                  {Math.abs(diferencia) >= 0.01 && (
                    <p className="text-xs mt-1">
                      {diferencia > 0
                        ? 'Sobra dinero en caja.'
                        : 'Faltó dinero en caja.'}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label
                  htmlFor="novedades"
                  className="text-[#391511] font-medium"
                >
                  Novedades (opcional)
                </Label>
                <Input
                  id="novedades"
                  value={novedades}
                  onChange={(e) => setNovedades(e.target.value)}
                  placeholder="Ej: cliente devolvió producto"
                  disabled={cerrar.isPending}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>

            <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => onCambioAbierto(false)}
                disabled={cerrar.isPending}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleCerrar}
                disabled={
                  !cierreValido ||
                  cerrar.isPending ||
                  isLoading ||
                  errorResumen ||
                  hayCola
                }
                title={
                  hayCola
                    ? 'Sincronizá las ventas pendientes antes de cerrar'
                    : undefined
                }
                className="flex-1 bg-[#c43e2c] hover:bg-[#9e2f25] text-white font-semibold"
              >
                {cerrar.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cerrando…
                  </>
                ) : (
                  'Cerrar turno'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      {/* Render off-screen para impresión térmica */}
      {cerrado && comprobante && (
        <div className="imprimir-termico" aria-hidden>
          <ComprobanteCierre datos={comprobante} />
        </div>
      )}
    </Dialog>
  )
}

function ResumenItem({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string
  valor: string
  destacado?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl px-3 py-2 border',
        destacado
          ? 'bg-[#f9b44c]/15 border-[#f9b44c]/40'
          : 'bg-white border-[#e4c9b0]/60'
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-[#6f3a2a] font-medium">
        {etiqueta}
      </div>
      <div className="text-[#391511] font-bold tabular-nums">{valor}</div>
    </div>
  )
}
