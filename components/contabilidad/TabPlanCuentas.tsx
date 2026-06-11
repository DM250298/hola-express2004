'use client'

import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { ModalCuentaContable } from './ModalCuentaContable'
import {
  useEliminarCuentaContable,
  usePlanCuentas,
} from '@/lib/hooks/useContabilidad'
import { cn } from '@/lib/utils'
import type { PlanCuentaRow, TipoCuentaContable } from '@/types/database'

const COLOR_TIPO: Record<TipoCuentaContable, string> = {
  activo: 'bg-[#2f6f8f]/15 text-[#2f6f8f]',
  pasivo: 'bg-[#c43e2c]/15 text-[#c43e2c]',
  patrimonio: 'bg-[#6f3a2a]/15 text-[#6f3a2a]',
  ingreso: 'bg-[#2f8f4e]/15 text-[#2f8f4e]',
  egreso: 'bg-[#f9b44c]/25 text-[#9e6a16]',
}

export function TabPlanCuentas() {
  const { data: cuentas, isLoading, isError } = usePlanCuentas()
  const eliminar = useEliminarCuentaContable()

  const [modalAbierto, setModalAbierto] = useState(false)
  const [cuentaEditar, setCuentaEditar] = useState<PlanCuentaRow | null>(null)
  const [cuentaBorrar, setCuentaBorrar] = useState<PlanCuentaRow | null>(null)

  function abrirNueva() {
    setCuentaEditar(null)
    setModalAbierto(true)
  }
  function abrirEdicion(c: PlanCuentaRow) {
    setCuentaEditar(c)
    setModalAbierto(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Plan de cuentas</h2>
          <p className="text-[#6f3a2a] text-sm">
            Listado de cuentas contables. Las cuentas título agrupan; las
            imputables se usan en los asientos.
          </p>
        </div>
        <Button
          onClick={abrirNueva}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nueva cuenta
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6 space-y-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-9 rounded-lg bg-[#f9d2a2]/30" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudo cargar el plan de cuentas.
          </div>
        ) : !cuentas || cuentas.length === 0 ? (
          <div className="p-10 text-center text-[#6f3a2a] text-sm">
            No hay cuentas cargadas.
          </div>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/40">
            {cuentas.map((c) => {
              const depth = c.codigo.split('.').length - 1
              const esTitulo = !c.imputable
              return (
                <li
                  key={c.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2 hover:bg-[#fdfaf6] group',
                    esTitulo && 'bg-[#fdfaf6]/70',
                    !c.activo && 'opacity-50'
                  )}
                  style={{ paddingLeft: `${depth * 22 + 16}px` }}
                >
                  <span className="font-mono text-xs text-[#6f3a2a] tabular-nums w-16 shrink-0">
                    {c.codigo}
                  </span>
                  <span
                    className={cn(
                      'flex-1 text-sm',
                      esTitulo
                        ? 'font-bold text-[#391511] uppercase tracking-wide'
                        : 'text-[#391511]'
                    )}
                  >
                    {c.nombre}
                  </span>
                  <span
                    className={cn(
                      'text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full',
                      COLOR_TIPO[c.tipo]
                    )}
                  >
                    {c.tipo}
                  </span>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => abrirEdicion(c)}
                      className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                      title="Editar"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCuentaBorrar(c)}
                      disabled={eliminar.isPending}
                      className="h-7 w-7 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ModalCuentaContable
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        cuenta={cuentaEditar}
      />

      <ConfirmacionAccion
        abierto={cuentaBorrar !== null}
        onCambioAbierto={(v) => {
          if (!v) setCuentaBorrar(null)
        }}
        titulo={
          cuentaBorrar
            ? `Eliminar la cuenta "${cuentaBorrar.codigo} ${cuentaBorrar.nombre}"`
            : ''
        }
        descripcion="La cuenta deja de estar disponible para nuevos asientos. No se puede deshacer."
        textoConfirmar="Sí, eliminar"
        destructiva
        procesando={eliminar.isPending}
        onConfirmar={() => {
          if (cuentaBorrar)
            eliminar.mutate(cuentaBorrar.id, {
              onSuccess: () => setCuentaBorrar(null),
            })
        }}
      />
    </div>
  )
}
