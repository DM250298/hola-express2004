'use client'

import { useMemo, useState } from 'react'
import { Lock, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
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

export function ConfiguracionCobros() {
  const { data: medios, isLoading } = useMediosPago()
  const { data: cuentas } = useCuentas(true)
  const actualizar = useActualizarMedioPago()
  const eliminar = useEliminarMedioPago()

  const [modalAbierto, setModalAbierto] = useState(false)
  const [medioEditar, setMedioEditar] = useState<MedioPagoRow | null>(null)

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

  function borrar(m: MedioPagoRow) {
    if (
      !confirm(
        `¿Borrar el medio de pago "${m.nombre}"? Esta acción no se puede deshacer.`
      )
    )
      return
    eliminar.mutate(m.id)
  }

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-[#f9b44c]" />
          <h3 className="text-[#391511] font-bold">
            Medios de pago del POS
          </h3>
        </div>
        <Button
          onClick={abrirNuevo}
          size="sm"
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo medio
        </Button>
      </div>
      <p className="text-[#6f3a2a] text-xs mb-4">
        Activá los medios que ofrecés en el POS y asigná a qué cuenta entra cada
        cobro. La comisión es informativa y se descuenta como egreso al vender.
      </p>

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
                  </div>
                </div>

                <Switch
                  checked={m.activo}
                  onCheckedChange={(v) => toggleActivo(m, v)}
                  disabled={actualizar.isPending || m.protegido}
                  aria-label={`Activar ${m.nombre}`}
                />

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
                  onClick={() => borrar(m)}
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

      <ModalMedioPago
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        medio={medioEditar}
      />
    </div>
  )
}
