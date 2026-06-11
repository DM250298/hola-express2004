'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Lock, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { ModalMedioPago } from './ModalMedioPago'
import { useCuentas } from '@/lib/hooks/useCuentas'
import {
  useActualizarMedioPago,
  useEliminarMedioPago,
  useMediosPago,
} from '@/lib/hooks/useMediosPago'
import { resolverIconoMedio } from '@/lib/utils/iconosMedioPago'
import { cn } from '@/lib/utils'
import type { MedioPagoRow } from '@/types/database'

/** Traduce los códigos crudos de la API de Mercado Pago a lenguaje del dueño. */
const ETIQUETA_MP_TIPO: Record<string, string> = {
  credit_card: 'Crédito',
  debit_card: 'Débito',
  account_money: 'Saldo MP',
  prepaid_card: 'Prepaga',
}

export function ConfiguracionCobros() {
  const { data: medios, isLoading } = useMediosPago()
  const { data: cuentas } = useCuentas(true)
  const actualizar = useActualizarMedioPago()
  const eliminar = useEliminarMedioPago()

  const [modalAbierto, setModalAbierto] = useState(false)
  const [medioEditar, setMedioEditar] = useState<MedioPagoRow | null>(null)
  const [medioBorrar, setMedioBorrar] = useState<MedioPagoRow | null>(null)

  const cuentaNombre = useMemo(() => {
    const mapa = new Map<number, string>()
    for (const c of cuentas ?? []) mapa.set(c.id, c.nombre)
    return mapa
  }, [cuentas])

  function abrirNuevo() {
    setMedioEditar(null)
    setModalAbierto(true)
  }

  function abrirEdicion(m: MedioPagoRow) {
    setMedioEditar(m)
    setModalAbierto(true)
  }

  function toggleActivo(m: MedioPagoRow, activo: boolean) {
    actualizar.mutate({ id: m.id, patch: { activo } })
  }

  function toggleTerminal(m: MedioPagoRow, disponible_terminal: boolean) {
    actualizar.mutate({ id: m.id, patch: { disponible_terminal } })
  }

  return (
    <details className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3">
        <Settings2 className="h-4 w-4 text-[#c8a58a]" />
        <h3 className="text-[#391511] font-bold text-sm">
          Medios de pago del POS
        </h3>
        <span className="ml-auto flex items-center gap-1 text-[11px] font-medium text-[#c8a58a]">
          Configurar
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="px-5 pb-5">
        <p className="text-[#6f3a2a] text-xs mb-3">
          Activá los medios que ofrecés en el POS y asigná a qué cuenta entra
          cada cobro. La comisión es informativa y se descuenta como egreso al
          vender. El switch <strong>Terminal</strong> controla qué formas de
          pago aparecen al cobrar con el posnet.
        </p>
        <div className="flex justify-end mb-3">
          <Button
            onClick={abrirNuevo}
            size="sm"
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo medio
          </Button>
        </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {(medios ?? []).map((m) => {
            const Icono = resolverIconoMedio(m.icono)
            return (
              <li
                key={m.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border',
                  m.activo
                    ? 'bg-[#fdfaf6] border-[#e4c9b0]/60'
                    : 'bg-[#f5f0e8]/60 border-[#e4c9b0]/40 opacity-70'
                )}
              >
                <div className="shrink-0 p-2 rounded-lg bg-[#f9b44c]/15">
                  <Icono className="h-4 w-4 text-[#391511]" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[#391511] text-sm truncate">
                      {m.nombre}
                    </span>
                    {m.protegido && (
                      <Lock
                        className="h-3 w-3 text-[#c8a58a] shrink-0"
                        aria-label="Medio base"
                      />
                    )}
                  </div>
                  <div className="text-[11px] text-[#6f3a2a] flex items-center gap-2 flex-wrap">
                    <span>
                      {m.cuenta_id && cuentaNombre.get(m.cuenta_id)
                        ? cuentaNombre.get(m.cuenta_id)
                        : 'Sin cuenta asignada'}
                    </span>
                    {m.comision_porcentaje > 0 && (
                      <span className="text-[#c8a58a]">
                        · {m.comision_porcentaje}% comisión
                      </span>
                    )}
                    {m.disponible_terminal && m.mp_payment_type && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#f9b44c]/15 text-[#6f3a2a] text-[10px]">
                        MP: {ETIQUETA_MP_TIPO[m.mp_payment_type] ?? m.mp_payment_type}
                        {m.mp_payment_method_id ? ` / ${m.mp_payment_method_id}` : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-center gap-0.5">
                  <Switch
                    checked={m.activo}
                    onCheckedChange={(v) => toggleActivo(m, v)}
                    disabled={actualizar.isPending || m.protegido}
                    aria-label={`Activar ${m.nombre} en POS`}
                  />
                  <span className="text-[9px] text-[#6f3a2a] uppercase tracking-wide font-semibold">
                    POS
                  </span>
                </div>

                <div className="flex flex-col items-center gap-0.5">
                  <Switch
                    checked={m.disponible_terminal}
                    onCheckedChange={(v) => toggleTerminal(m, v)}
                    disabled={actualizar.isPending || m.protegido}
                    aria-label={`Disponible en terminal: ${m.nombre}`}
                  />
                  <span className="text-[9px] text-[#6f3a2a] uppercase tracking-wide font-semibold">
                    Terminal
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => abrirEdicion(m)}
                  className="h-8 w-8 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                  title="Editar"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMedioBorrar(m)}
                  disabled={m.protegido || eliminar.isPending}
                  className="h-8 w-8 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] disabled:opacity-30"
                  title={m.protegido ? 'Medio base — no se puede borrar' : 'Borrar'}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      </div>

      <ModalMedioPago
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        medio={medioEditar}
      />

      <ConfirmacionAccion
        abierto={medioBorrar !== null}
        onCambioAbierto={(v) => {
          if (!v) setMedioBorrar(null)
        }}
        titulo={
          medioBorrar ? `Borrar el medio de pago "${medioBorrar.nombre}"` : ''
        }
        descripcion="Deja de aparecer en el POS y en el cobro con terminal. No se puede deshacer."
        textoConfirmar="Sí, borrar"
        destructiva
        procesando={eliminar.isPending}
        onConfirmar={() => {
          if (medioBorrar)
            eliminar.mutate(medioBorrar.id, {
              onSuccess: () => setMedioBorrar(null),
            })
        }}
      />
    </details>
  )
}
