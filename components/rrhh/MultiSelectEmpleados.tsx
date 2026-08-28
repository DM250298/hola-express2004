'use client'

import { Check, Users } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface Opcion {
  id: number
  nombre: string
}

interface Props {
  /** Empleados elegibles (activos; puede incluir inactivos ya asignados). */
  opciones: Opcion[]
  seleccionados: number[]
  onCambio: (ids: number[]) => void
  /** true = "Todos los empleados" (alcance dinámico, la lista se deshabilita). */
  todos: boolean
  onCambioTodos: (v: boolean) => void
  disabled?: boolean
}

/**
 * Selector múltiple de empleados con toggle "Todos". Con "Todos" activo la
 * asignación es dinámica (empleados activos al momento de generar la tarea),
 * así las altas y bajas de personal no requieren tocar la plantilla.
 */
export function MultiSelectEmpleados({
  opciones,
  seleccionados,
  onCambio,
  todos,
  onCambioTodos,
  disabled,
}: Props) {
  function toggle(id: number) {
    onCambio(
      seleccionados.includes(id)
        ? seleccionados.filter((s) => s !== id)
        : [...seleccionados, id]
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[#391511] font-medium text-sm">Asignada a</Label>
        <label className="flex items-center gap-2 text-sm text-[#6f3a2a] cursor-pointer">
          <Users className="h-3.5 w-3.5" />
          Todos los empleados
          <Switch checked={todos} onCheckedChange={onCambioTodos} disabled={disabled} />
        </label>
      </div>

      {todos ? (
        <p className="text-xs text-[#c8a58a] rounded-xl border border-dashed border-[#e4c9b0] px-3 py-2.5">
          Va para todo el personal activo. Si entra o sale alguien, se ajusta solo.
        </p>
      ) : (
        <div className="rounded-xl border border-[#e4c9b0]/60 max-h-44 overflow-y-auto divide-y divide-[#e4c9b0]/40">
          {opciones.length === 0 ? (
            <p className="text-[#c8a58a] text-xs text-center py-4">Sin empleados activos.</p>
          ) : (
            opciones.map((e) => {
              const activo = seleccionados.includes(e.id)
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e.id)}
                  disabled={disabled}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    activo ? 'bg-[#f9b44c]/15 text-[#391511] font-medium' : 'text-[#6f3a2a] hover:bg-[#fdfaf6]'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      activo ? 'bg-[#f9b44c] border-[#f9b44c]' : 'border-[#c8a58a]'
                    )}
                  >
                    {activo && <Check className="h-3 w-3 text-[#391511]" />}
                  </span>
                  <span className="truncate">{e.nombre}</span>
                </button>
              )
            })
          )}
        </div>
      )}
      {!todos && seleccionados.length > 0 && (
        <p className="text-[11px] text-[#c8a58a]">
          {seleccionados.length} empleado{seleccionados.length === 1 ? '' : 's'} seleccionado
          {seleccionados.length === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}
