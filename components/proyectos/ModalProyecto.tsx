'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCreateProyecto, useUpdateProyecto } from '@/lib/hooks/useProyectos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { ProyectoRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Proyecto a editar; null = alta. */
  proyecto?: ProyectoRow | null
}

const ESTADOS: Record<string, string> = {
  activo: 'Activo',
  completado: 'Completado',
  archivado: 'Archivado',
}

export function ModalProyecto({ abierto, onCambioAbierto, proyecto }: Props) {
  const { data: usuario } = useUsuario()
  const crear = useCreateProyecto()
  const actualizar = useUpdateProyecto()
  const editando = !!proyecto

  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [fechaLimite, setFechaLimite] = useState('')
  const [estado, setEstado] = useState('activo')

  useEffect(() => {
    if (abierto) {
      setNombre(proyecto?.nombre ?? '')
      setDescripcion(proyecto?.descripcion ?? '')
      setFechaLimite(proyecto?.fecha_limite ?? '')
      setEstado(proyecto?.estado ?? 'activo')
    }
  }, [abierto, proyecto])

  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar = nombre.trim().length > 0 && !procesando

  function guardar() {
    if (!puedeGuardar) return
    if (editando && proyecto) {
      actualizar.mutate(
        {
          id: proyecto.id,
          datos: {
            nombre: nombre.trim(),
            descripcion: descripcion.trim() || null,
            fecha_limite: fechaLimite || null,
            estado,
          },
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(
        {
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || null,
          fecha_limite: fechaLimite || null,
          usuario_id: usuario?.id ?? null,
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Editar proyecto' : 'Nuevo proyecto'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Un proyecto agrupa tareas del equipo.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nombre
            </Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Refacción del depósito"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Descripción (opcional)
            </Label>
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Detalle del proyecto…"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Fecha límite
              </Label>
              <Input
                type="date"
                value={fechaLimite}
                onChange={(e) => setFechaLimite(e.target.value)}
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
            {editando && (
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm">
                  Estado
                </Label>
                <Select
                  items={ESTADOS}
                  value={estado}
                  onValueChange={(v) => setEstado(v ?? 'activo')}
                  disabled={procesando}
                >
                  <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ESTADOS).map(([v, etq]) => (
                      <SelectItem key={v} value={v}>
                        {etq}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : editando ? (
              'Guardar cambios'
            ) : (
              'Crear proyecto'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
