'use client'

import { useMemo, useState } from 'react'
import {
  Banknote,
  Calculator,
  Inbox,
  Loader2,
  ShieldCheck,
  Vault,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import { ModalArqueo } from './ModalArqueo'
import { ModalRemesa } from './ModalRemesa'
import {
  useSangriasEnBuzon,
  useSaldoCajaFuerte,
  useArqueos,
  useRemesas,
} from '@/lib/hooks/useCajaFuerte'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { formatearFechaHora } from '@/lib/utils/formato'

export function TabCajaFuerte() {
  const { data: usuario } = useUsuario()
  const { data: saldo } = useSaldoCajaFuerte()
  const { data: buzon, isLoading: cargandoBuzon } = useSangriasEnBuzon()
  const { data: arqueos } = useArqueos()
  const { data: remesas } = useRemesas()
  const { data: cuentas } = useCuentas(false)

  // Efectivo real: saldo de las cuentas tipo "caja" (Caja Efectivo). Es la
  // plata que físicamente está en la caja fuerte, aunque no se haya usado el
  // circuito formal de sangría/arqueo.
  const efectivoCajas = (cuentas ?? [])
    .filter((c) => c.activo && c.tipo === 'caja')
    .reduce((acc, c) => acc + Number(c.saldo_actual), 0)

  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [modalArqueo, setModalArqueo] = useState(false)
  const [modalRemesa, setModalRemesa] = useState(false)

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
      {/* Efectivo real (saldo de la cuenta Caja Efectivo) */}
      <div className="rounded-2xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-5 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#f9b44c]/30">
            <Vault className="h-5 w-5 text-[#6f3a2a]" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
              Efectivo en caja fuerte
              <AyudaContextual titulo="Tu efectivo">
                Es el saldo de la cuenta &quot;Caja Efectivo&quot;: todo el
                efectivo que entró por ventas. Es la plata que tenés físicamente
                en la caja fuerte. El circuito de abajo (contar y depositar) es
                opcional, para llevar el control formal de los retiros de los
                cajeros.
              </AyudaContextual>
            </div>
            <div className="text-xs text-[#6f3a2a]">
              Saldo de la cuenta Caja Efectivo
            </div>
          </div>
        </div>
        <div className="text-3xl font-extrabold text-[#391511] tabular-nums">
          <MontoARS monto={efectivoCajas} />
        </div>
      </div>

      <div className="px-1 text-[10px] uppercase tracking-wider text-[#c8a58a] font-semibold">
        Circuito de conteo y depósito (opcional)
      </div>
      {/* KPIs de la caja fuerte */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCaja
          icono={Inbox}
          etiqueta="Por contar"
          monto={saldo?.en_buzon ?? 0}
          detalle="Retiros de cajeros sin contar"
        />
        <KpiCaja
          icono={Vault}
          etiqueta="Contado sin depositar"
          monto={saldo?.saldo ?? 0}
          detalle="Listo para depositar al banco"
        />
        <KpiCaja
          icono={ShieldCheck}
          etiqueta="Ya contado"
          monto={saldo?.arqueado ?? 0}
          detalle="Total validado (histórico)"
        />
        <KpiCaja
          icono={Banknote}
          etiqueta="Depositado en el banco"
          monto={saldo?.remesado ?? 0}
          detalle="Total enviado (histórico)"
        />
      </div>

      {/* Buzón: sobres pendientes de arqueo */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-5 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-[#391511] font-semibold text-sm flex items-center gap-2">
            <Inbox className="h-4 w-4 text-[#f9b44c]" />
            Retiros por contar
            <AyudaContextual titulo="Cómo funciona la caja fuerte">
              El efectivo sigue este camino: el cajero retira plata de la caja y
              la deja en el buzón <em>(sangría)</em> → vos la contás y validás{' '}
              <em>(arqueo)</em> → queda en la caja fuerte → la depositás en el
              banco <em>(remesa)</em>.
            </AyudaContextual>
          </h3>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setModalRemesa(true)}
              className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
            >
              <Banknote className="h-3.5 w-3.5" />
              Depositar en el banco
            </Button>
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
            No hay sobres pendientes en el buzón. Las sangrías que hagan los
            cajeros desde el POS van a aparecer acá.
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

      {/* Historial: arqueos y remesas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
      </div>

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
          <ModalRemesa
            abierto={modalRemesa}
            onCambioAbierto={setModalRemesa}
            usuarioId={usuario.id}
            saldoDisponible={saldo?.saldo ?? 0}
          />
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
