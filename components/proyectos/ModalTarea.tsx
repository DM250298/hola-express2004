'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
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
import {
  useCreateTarea,
  useDeleteTarea,
  useUpdateTarea,
} from '@/lib/hooks/useProyectos'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import type { TareaRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  proyectoId: number
  /** Tarea a editar; null = alta. */
  tarea?: TareaRow | null
}

const SIN_RESP = '__sin__'

export const PRIORIDADES: Record<string, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
}

export const ESTADOS_TAREA: Record<string, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  hecha: 'Hecha',
}

export function ModalTarea({
  abierto,
  onCambioAbierto,
  proyectoId,
  tarea,
}: Props) {
  const { data: usuario } = useUsuario()
  const { data: usuarios } = useUsuariosActivos()
  const crear = useCreateTarea()
  const actualizar = useUpdateTarea()
  const eliminar = useDeleteTarea()
  const editando = !!tarea

  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [prioridad, setPrioridad] = useState('media')
  const [estado, setEstado] = useState('pendiente')
  const [responsable, setResponsable] = useState(SIN_RESP)
  const [fechaLimite, setFechaLimite] = useState('')

  useEffect(() => {
    if (abierto) {
      setTitulo(tarea?.titulo ?? '')
      setDescripcion(tarea?.descripcion ?? '')
      setPrioridad(tarea?.prioridad ?? 'media')
      setEstado(tarea?.estado ?? 'pendiente')
      setResponsable(tarea?.responsable_id ?? SIN_RESP)
      setFechaLimite(tarea?.fecha_limite ?? '')
    }
  }, [abierto, tarea])

  const itemsResponsable: Record<string, string> = useMemo(() => {
    const base: Record<string, string> = { [SIN_RESP]: 'Sin asignar' }
    for (const u of usuarios ?? []) base[u.id] = u.nombre
    return base
  }, [usuarios])

  const procesando =
    crear.isPending || actualizar.isPending || eliminar.isPending
  const puedeGuardar = titulo.trim().length > 0 && !procesando

  function guardar() {
    if (!puedeGuardar) return
    const responsableId = responsable === SIN_RESP ? null : responsable
    if (editando && tarea) {
      actualizar.mutate(
        {
          id: tarea.id,
          datos: {
            titulo: titulo.trim(),
            descripcion: descripcion.trim() || null,
            prioridad,
            estado,
            responsable_id: responsableId,
            fecha_limite: fechaLimite || null,
            completada_at:
              estado === 'hecha'
                ? (tarea.completada_at ?? new Date().toISOString())
                : null,
          },
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(
        {
          proyecto_id: proyectoId,
          titulo: titulo.trim(),
          descripcion: descripcion.trim() || null,
          prioridad,
          responsable_id: responsableId,
          fecha_limite: fechaLimite || null,
          creado_por: usuario?.id ?? null,
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    }
  }

  function handleEliminar() {
    if (!tarea) return
    if (!confirm(`¿Eliminar la tarea "${tarea.titulo}"?`)) return
    eliminar.mutate(tarea.id, { onSuccess: () => onCambioAbierto(false) })
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Editar tarea' : 'Nueva tarea'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Asigná responsable, prioridad y fecha límite.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Título
            </Label>
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej: Pintar la entrada"
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
              placeholder="Detalle…"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Prioridad
              </Label>
              <Select
                items={PRIORIDADES}
                value={prioridad}
                onValueChange={(v) => setPrioridad(v ?? 'media')}
                disabled={procesando}
              >
                <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PRIORIDADES).map(([v, etq]) => (
                    <SelectItem key={v} value={v}>
                      {etq}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editando && (
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm">
                  Estado
                </Label>
                <Select
                  items={ESTADOS_TAREA}
                  value={estado}
                  onValueChange={(v) => setEstado(v ?? 'pendiente')}
                  disabled={procesando}
                >
                  <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ESTADOS_TAREA).map(([v, etq]) => (
                      <SelectItem key={v} value={v}>
                        {etq}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Responsable
            </Label>
            <Select
              items={itemsResponsable}
              value={responsable}
              onValueChange={(v) => setResponsable(v ?? SIN_RESP)}
              disabled={procesando}
            >
              <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_RESP}>Sin asignar</SelectItem>
                {(usuarios ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Fecha límite (opcional)
            </Label>
            <Input
              type="date"
              value={fechaLimite}
              onChange={(e) => setFechaLimite(e.target.value)}
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          {editando && (
            <Button
              variant="ghost"
              onClick={handleEliminar}
              disabled={procesando}
              className="text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
              aria-label="Eliminar tarea"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
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
              'Guardar'
            ) : (
              'Crear tarea'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
