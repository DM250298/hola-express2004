'use client'

import { useState } from 'react'
import { ClipboardCheck, Vault } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { ModalArqueoBoveda } from './ModalArqueoBoveda'
import { useArqueosBoveda } from '@/lib/hooks/useCajaFuerte'
import { formatearFechaCortaISO, formatearFechaHora } from '@/lib/utils/formato'
import { hoyIso } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'

interface Props {
  usuarioId: string | null
  esAdmin: boolean
  /** Saldo real de la bóveda (cuentas.saldo_actual de la Caja Efectivo). */
  saldo: number | null
}

/**
 * Saldo de la caja fuerte + arqueo del día: el conteo físico de TODA la
 * bóveda contra el sistema, con su historial día a día (fecha, sistema,
 * contado, diferencia, quién). Complementa al arqueo de sobres del buzón.
 */
export function PanelArqueosBoveda({ usuarioId, esAdmin, saldo }: Props) {
  const { data: arqueos, isLoading } = useArqueosBoveda()
  const [modal, setModal] = useState(false)

  const faltaMigracion = arqueos === null
  const ultimo = arqueos?.[0]
  const hoy = hoyIso()
  const arqueadoHoy = ultimo?.fecha === hoy
  const conDiferencia = (arqueos ?? []).filter((a) => Math.abs(a.diferencia) >= 0.01)
  const sumaDiferencias = conDiferencia.reduce((acc, a) => acc + a.diferencia, 0)

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
      <div className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-[#f9b44c]/25">
            <Vault className="h-5 w-5 text-[#6f3a2a]" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Saldo de la caja fuerte (sistema)
            </div>
            <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
              {saldo === null ? '…' : <MontoARS monto={saldo} />}
            </div>
            <div className="text-[11px] text-[#6f3a2a]">
              {faltaMigracion
                ? 'Falta correr la migración 216 para habilitar el arqueo diario.'
                : ultimo
                  ? `Último arqueo: ${formatearFechaHora(ultimo.created_at)}${arqueadoHoy ? ' · hoy ya se contó' : ''}`
                  : 'Todavía no se hizo ningún arqueo de la bóveda.'}
            </div>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setModal(true)}
          disabled={!usuarioId || faltaMigracion || saldo === null}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <ClipboardCheck className="h-3.5 w-3.5" />
          Arqueo del día
        </Button>
      </div>

      {!faltaMigracion && (arqueos ?? []).length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[#6f3a2a] border-b border-[#e4c9b0]/60">
                <th className="px-4 py-2 text-left font-semibold">Fecha</th>
                <th className="px-4 py-2 text-right font-semibold">Sistema</th>
                <th className="px-4 py-2 text-right font-semibold">Contado</th>
                <th className="px-4 py-2 text-right font-semibold">Diferencia</th>
                <th className="px-4 py-2 text-left font-semibold">Quién · nota</th>
              </tr>
            </thead>
            <tbody>
              {(arqueos ?? []).slice(0, 15).map((a) => {
                const dif = Math.abs(a.diferencia) >= 0.01
                return (
                  <tr key={a.id} className="border-b border-[#e4c9b0]/40">
                    <td className="px-4 py-2 text-[#391511] tabular-nums whitespace-nowrap">
                      {formatearFechaCortaISO(a.fecha)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#6f3a2a]">
                      <MontoARS monto={a.saldo_sistema} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#391511] font-semibold">
                      <MontoARS monto={a.contado} />
                    </td>
                    <td
                      className={cn(
                        'px-4 py-2 text-right tabular-nums font-bold whitespace-nowrap',
                        dif ? 'text-[#c43e2c]' : 'text-[#2f7d4f]'
                      )}
                    >
                      {dif ? (
                        <>
                          {a.diferencia > 0 ? '+' : ''}
                          <MontoARS monto={a.diferencia} />
                        </>
                      ) : (
                        'Cuadra'
                      )}
                      {a.ajuste_aplicado && (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wider text-[#6f3a2a] bg-[#e4c9b0]/40 rounded-full px-1.5 py-0.5 font-semibold">
                          ajustado
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-[#6f3a2a] min-w-[180px]">
                      <span className="font-medium text-[#391511]">
                        {a.usuario_nombre ?? '—'}
                      </span>
                      {a.nota ? ` · ${a.nota}` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {conDiferencia.length > 0 && (
            <p className="px-4 py-2 text-[11px] text-[#6f3a2a] bg-[#fdfaf6]">
              {conDiferencia.length} de {(arqueos ?? []).length} arqueos con
              diferencia · suma neta{' '}
              <span className="font-semibold tabular-nums">
                {sumaDiferencias > 0 ? '+' : ''}
                <MontoARS monto={sumaDiferencias} />
              </span>
            </p>
          )}
        </div>
      )}
      {!faltaMigracion && !isLoading && (arqueos ?? []).length === 0 && (
        <p className="px-5 py-4 text-sm text-[#6f3a2a]">
          Contá la caja fuerte una vez por día: el historial muestra si el
          efectivo físico coincide con lo que dice el sistema.
        </p>
      )}

      {usuarioId && saldo !== null && (
        <ModalArqueoBoveda
          abierto={modal}
          onCambioAbierto={setModal}
          usuarioId={usuarioId}
          saldoSistema={saldo}
          esAdmin={esAdmin}
        />
      )}
    </div>
  )
}
