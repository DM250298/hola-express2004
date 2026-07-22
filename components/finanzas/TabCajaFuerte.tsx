'use client'

import { useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Calculator,
  Inbox,
  Loader2,
  Plus,
  ShieldCheck,
  Vault,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import { ModalArqueo } from './ModalArqueo'
import { ModalRemesa } from './ModalRemesa'
import { ModalMovimientoCajaFuerte } from './ModalMovimientoCajaFuerte'
import { PanelControlDiferencias } from './PanelControlDiferencias'
import {
  useSangriasEnBuzon,
  useSaldoCajaFuerte,
  useArqueos,
  useRemesas,
  useMovimientosCajaFuerte,
} from '@/lib/hooks/useCajaFuerte'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { MOSTRAR_REMESAS } from '@/lib/config/tesoreria'
import { formatearFechaHora } from '@/lib/utils/formato'

export function TabCajaFuerte() {
  const { data: usuario } = useUsuario()
  const {
    data: saldo,
    isPending: cargandoSaldo,
    isError: errorSaldo,
  } = useSaldoCajaFuerte()
  const { data: buzon, isLoading: cargandoBuzon } = useSangriasEnBuzon()
  const { data: arqueos } = useArqueos()
  const { data: remesas } = useRemesas()
  const { data: movimientos } = useMovimientosCajaFuerte()

  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [modalArqueo, setModalArqueo] = useState(false)
  const [modalRemesa, setModalRemesa] = useState(false)
  const [modalMovimiento, setModalMovimiento] = useState(false)

  const idsSeleccionados = useMemo(() => Array.from(seleccion), [seleccion])
  const montoSeleccionado = useMemo(
    () =>
      (buzon ?? [])
        .filter((s) => seleccion.has(s.id))
        .reduce((acc, s) => acc + Number(s.monto), 0),
    [buzon, seleccion]
  )

  function toggle(id: number) {
    setSeleccion((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleTodos() {
    if (!buzon) return
    setSeleccion((prev) =>
      prev.size === buzon.length ? new Set() : new Set(buzon.map((s) => s.id))
    )
  }

  return (
    <div className="space-y-5">
      {/* Caja fuerte = cuenta "Caja Efectivo" (saldo real, candado mig 118) */}
      <div className="rounded-2xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#f9b44c]/30">
            <Vault className="h-5 w-5 text-[#6f3a2a]" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
              Caja fuerte · cuenta Caja Efectivo
              <AyudaContextual titulo="Cómo entra la plata acá">
                El efectivo sigue esta secuencia: venta en la caja del POS →{' '}
                <em>cierre de caja</em> (el cajero controla) → sobre al{' '}
                <em>buzón</em> → <em>control administrativo</em> (contar y
                validar) → recién ahí el monto verificado entra a la cuenta
                Caja Efectivo. Nada entra directo desde la venta. El fondo de
                cambio de los cajeros es plata aparte. Es el mismo número que
                ves en el Tablero y en Cuentas.
              </AyudaContextual>
            </div>
            <div className="text-xs text-[#6f3a2a]">
              Efectivo verificado · entra solo con arqueo validado
            </div>
          </div>
        </div>
        <div className="text-3xl font-extrabold text-[#391511] tabular-nums">
          {cargandoSaldo ? (
            <Loader2 className="h-7 w-7 animate-spin text-[#6f3a2a]" />
          ) : errorSaldo ? (
            <span className="text-sm font-medium text-[#c43e2c]">
              No se pudo calcular el saldo — recargá la página
            </span>
          ) : (
            <MontoARS monto={saldo?.saldo ?? 0} />
          )}
        </div>
      </div>

      {/* Semáforo de descuadre: la cuenta vs. el circuito de conteo */}
      {saldo && Math.abs(saldo.descuadre) >= 0.01 && (
        <div className="rounded-xl border border-[#c43e2c]/40 bg-[#c43e2c]/5 px-4 py-2.5 text-sm text-[#c43e2c] flex items-center justify-between gap-2 flex-wrap">
          <span>
            La cuenta no cuadra con el circuito de conteo (arqueos + manuales −
            depósitos). Puede ser una edición manual del saldo o una anulación
            vieja — revisá los movimientos de la cuenta.
          </span>
          <span className="font-bold tabular-nums">
            {saldo.descuadre > 0 ? '+' : '−'}
            <MontoARS monto={Math.abs(saldo.descuadre)} />
          </span>
        </div>
      )}

      {/* Acción: movimiento manual */}
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={() => setModalMovimiento(true)}
          disabled={!usuario}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Ingreso / Egreso manual
        </Button>
      </div>

      <div className="px-1 text-[10px] uppercase tracking-wider text-[#c8a58a] font-semibold">
        De qué se compone
      </div>
      {/* KPIs: composición del saldo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCaja
          icono={Inbox}
          etiqueta="Por contar"
          monto={saldo?.en_buzon ?? 0}
          detalle="Sobres en el buzón sin validar"
        />
        <KpiCaja
          icono={ShieldCheck}
          etiqueta="Contado y validado"
          monto={saldo?.arqueado ?? 0}
          detalle="Arqueos (histórico)"
        />
        <KpiCaja
          icono={ArrowDownToLine}
          etiqueta="Ingresos manuales"
          monto={saldo?.ingresos_manuales ?? 0}
          detalle="Cargados a mano"
        />
        <KpiCaja
          icono={ArrowUpFromLine}
          etiqueta="Egresos manuales"
          monto={saldo?.egresos_manuales ?? 0}
          detalle="Sacados a mano"
        />
        {MOSTRAR_REMESAS && (
          <KpiCaja
            icono={Banknote}
            etiqueta="Depositado en el banco"
            monto={saldo?.remesado ?? 0}
            detalle="Total enviado (histórico)"
          />
        )}
      </div>

      {/* Buzón: sobres pendientes de arqueo */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-[#391511] font-semibold text-sm flex items-center gap-2">
            <Inbox className="h-4 w-4 text-[#f9b44c]" />
            Retiros por contar
            <AyudaContextual titulo="El control administrativo">
              El cajero cierra la caja y el efectivo va al buzón{' '}
              <em>(sobre)</em> → vos lo contás y validás <em>(arqueo)</em> →
              recién ahí el monto verificado entra a la cuenta Caja Efectivo.
            </AyudaContextual>
          </h3>
          <div className="flex items-center gap-2">
            {MOSTRAR_REMESAS && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setModalRemesa(true)}
                className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
              >
                <Banknote className="h-3.5 w-3.5" />
                Depositar en el banco
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setModalArqueo(true)}
              disabled={idsSeleccionados.length === 0}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5 disabled:opacity-40"
            >
              <Calculator className="h-3.5 w-3.5" />
              Contar y validar ({idsSeleccionados.length})
            </Button>
          </div>
        </div>

        {cargandoBuzon ? (
          <div className="flex items-center justify-center py-10 text-[#6f3a2a]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !buzon || buzon.length === 0 ? (
          <div className="p-10 text-center text-[#6f3a2a] text-sm">
            No hay sobres pendientes en el buzón. Los cierres de caja de los
            cajeros van a aparecer acá para que los cuentes.
          </div>
        ) : (
          <div className="divide-y divide-[#e4c9b0]/40">
            <label className="flex items-center gap-3 px-5 py-2 bg-[#fdfaf6]/60 cursor-pointer text-xs font-semibold text-[#6f3a2a] uppercase tracking-wider">
              <input
                type="checkbox"
                checked={seleccion.size === buzon.length && buzon.length > 0}
                onChange={toggleTodos}
                className="accent-[#f9b44c] h-4 w-4"
              />
              Seleccionar todos
              {montoSeleccionado > 0 && (
                <span className="ml-auto text-[#391511] tabular-nums">
                  <MontoARS monto={montoSeleccionado} />
                </span>
              )}
            </label>
            {buzon.map((s) => (
              <label
                key={s.id}
                className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[#fdfaf6]"
              >
                <input
                  type="checkbox"
                  checked={seleccion.has(s.id)}
                  onChange={() => toggle(s.id)}
                  className="accent-[#f9b44c] h-4 w-4"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[#391511] text-sm">
                    {s.usuario_nombre ?? 'Cajero'}
                    {s.nota ? ` · ${s.nota}` : ''}
                  </div>
                  <div className="text-xs text-[#6f3a2a]">
                    {formatearFechaHora(s.created_at)}
                    {s.turno_id ? ` · Turno #${s.turno_id}` : ''}
                  </div>
                </div>
                <div className="font-bold text-[#391511] tabular-nums">
                  <MontoARS monto={s.monto} />
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Historial: movimientos manuales + arqueos (+ remesas si están activas) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HistorialCard titulo="Movimientos manuales recientes" icono={Plus}>
          {!movimientos || movimientos.length === 0 ? (
            <Vacio texto="Sin movimientos manuales todavía." />
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {movimientos.map((m) => {
                const ingreso = m.tipo === 'ingreso'
                return (
                  <li
                    key={m.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#391511] truncate">
                        {m.nota}
                      </div>
                      <div className="text-xs text-[#6f3a2a]">
                        {formatearFechaHora(m.created_at)}
                        {m.usuario_nombre ? ` · ${m.usuario_nombre}` : ''}
                      </div>
                    </div>
                    <span
                      className={
                        ingreso
                          ? 'text-sm font-bold text-[#2f7d4f] tabular-nums shrink-0'
                          : 'text-sm font-bold text-[#c43e2c] tabular-nums shrink-0'
                      }
                    >
                      {ingreso ? '+' : '−'}
                      <MontoARS monto={m.monto} />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </HistorialCard>

        <HistorialCard titulo="Arqueos recientes" icono={Calculator}>
          {!arqueos || arqueos.length === 0 ? (
            <Vacio texto="Sin arqueos todavía." />
          ) : (
            <ul className="divide-y divide-[#e4c9b0]/40">
              {arqueos.map((a) => (
                <li
                  key={a.id}
                  className="px-4 py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#391511]">
                      {formatearFechaHora(a.created_at)}
                    </div>
                    <div className="text-xs text-[#6f3a2a]">
                      Esperado <MontoARS monto={a.monto_esperado} /> · contado{' '}
                      <MontoARS monto={a.monto_fisico} />
                    </div>
                  </div>
                  <span
                    className={
                      a.estado === 'con_diferencia'
                        ? 'text-xs font-bold text-[#c43e2c] tabular-nums shrink-0'
                        : 'text-xs font-bold text-[#2f7d4f] tabular-nums shrink-0'
                    }
                  >
                    {a.diferencia > 0 ? '+' : ''}
                    <MontoARS monto={a.diferencia} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </HistorialCard>

        {MOSTRAR_REMESAS && (
          <HistorialCard titulo="Remesas recientes" icono={Banknote}>
            {!remesas || remesas.length === 0 ? (
              <Vacio texto="Sin remesas todavía." />
            ) : (
              <ul className="divide-y divide-[#e4c9b0]/40">
                {remesas.map((r) => (
                  <li
                    key={r.id}
                    className="px-4 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[#391511]">
                        {r.cuenta_nombre ?? 'Banco'}
                        {r.comprobante ? ` · ${r.comprobante}` : ''}
                      </div>
                      <div className="text-xs text-[#6f3a2a]">
                        {formatearFechaHora(r.created_at)}
                      </div>
                    </div>
                    <span className="text-sm font-bold text-[#391511] tabular-nums shrink-0">
                      <MontoARS monto={r.monto} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </HistorialCard>
        )}
      </div>

      {/* Control de diferencias por empleado + buzón */}
      <PanelControlDiferencias />

      {usuario && (
        <>
          <ModalArqueo
            abierto={modalArqueo}
            onCambioAbierto={(v) => {
              setModalArqueo(v)
              if (!v) setSeleccion(new Set())
            }}
            usuarioId={usuario.id}
            sangriaIds={idsSeleccionados}
            montoEsperado={montoSeleccionado}
          />
          <ModalMovimientoCajaFuerte
            abierto={modalMovimiento}
            onCambioAbierto={setModalMovimiento}
            usuarioId={usuario.id}
            saldoActual={saldo?.saldo ?? 0}
          />
          {MOSTRAR_REMESAS && (
            <ModalRemesa
              abierto={modalRemesa}
              onCambioAbierto={setModalRemesa}
              usuarioId={usuario.id}
              saldoDisponible={saldo?.saldo ?? 0}
            />
          )}
        </>
      )}
    </div>
  )
}

function KpiCaja({
  icono: Icono,
  etiqueta,
  monto,
  detalle,
  destacado,
}: {
  icono: React.ElementType
  etiqueta: string
  monto: number
  detalle: string
  destacado?: boolean
}) {
  return (
    <div
      className={
        destacado
          ? 'rounded-2xl border-2 border-[#f9b44c]/50 bg-[#f9b44c]/10 p-4'
          : 'rounded-2xl border border-[#e4c9b0]/60 bg-white p-4 shadow-sm'
      }
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        <Icono className="h-3.5 w-3.5 text-[#f9b44c]" />
        {etiqueta}
      </div>
      <div className="text-xl font-extrabold text-[#391511] tabular-nums mt-1">
        <MontoARS monto={monto} />
      </div>
      <div className="text-[11px] text-[#6f3a2a] mt-0.5">{detalle}</div>
    </div>
  )
}

function HistorialCard({
  titulo,
  icono: Icono,
  children,
}: {
  titulo: string
  icono: React.ElementType
  children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-4 py-2.5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
        <h3 className="text-[#391511] font-semibold text-sm flex items-center gap-2">
          <Icono className="h-4 w-4 text-[#f9b44c]" />
          {titulo}
        </h3>
      </div>
      {children}
    </div>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <div className="px-4 py-8 text-center text-[#6f3a2a] text-sm">{texto}</div>
}
