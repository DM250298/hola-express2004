'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
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
import {
  useCreateSubtarea,
  useDeleteSubtarea,
  useMarcarSubtarea,
  useSubtareas,
  useUpdateSubtarea,
} from '@/lib/hooks/useSubtareas'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'
import type { SubtareaRow, TareaRow } from '@/types/database'

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
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-base font-semibold">
            {editando ? 'Editar tarea' : 'Nueva tarea'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Detalles de la tarea
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_240px] max-h-[70vh]">
          {/* ─── Columna izquierda: contenido ─── */}
          <div className="px-6 py-5 space-y-4 overflow-y-auto border-r border-[#e4c9b0]/60">
            <Input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Nombre de la tarea"
              disabled={procesando}
              className="border-0 px-0 text-lg font-semibold text-[#391511] placeholder:text-[#c8a58a] focus-visible:ring-0 shadow-none h-auto"
            />

            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Descripción…"
              disabled={procesando}
              className="border-0 px-0 text-sm text-[#6f3a2a] placeholder:text-[#c8a58a] focus-visible:ring-0 shadow-none h-auto"
            />

            {editando && tarea && (
              <SeccionSubtareas tareaId={tarea.id} usuarios={usuarios ?? []} />
            )}
            {!editando && (
              <p className="text-[11px] text-[#c8a58a] pt-2">
                Las subtareas se agregan después de crear la tarea.
              </p>
            )}
          </div>

          {/* ─── Columna derecha: metadata ─── */}
          <aside className="px-5 py-5 space-y-4 bg-[#fdfaf6] overflow-y-auto">
            <MetaCampo label="Responsable">
              <Select
                items={itemsResponsable}
                value={responsable}
                onValueChange={(v) => setResponsable(v ?? SIN_RESP)}
                disabled={procesando}
              >
                <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
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
            </MetaCampo>

            <MetaCampo label="Fecha límite">
              <Input
                type="date"
                value={fechaLimite}
                onChange={(e) => setFechaLimite(e.target.value)}
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums bg-white"
              />
            </MetaCampo>

            <MetaCampo label="Prioridad">
              <Select
                items={PRIORIDADES}
                value={prioridad}
                onValueChange={(v) => setPrioridad(v ?? 'media')}
                disabled={procesando}
              >
                <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
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
            </MetaCampo>

            {editando && (
              <MetaCampo label="Estado">
                <Select
                  items={ESTADOS_TAREA}
                  value={estado}
                  onValueChange={(v) => setEstado(v ?? 'pendiente')}
                  disabled={procesando}
                >
                  <SelectTrigger className="w-full border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
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
              </MetaCampo>
            )}
          </aside>
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function MetaCampo({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6f3a2a]">
        {label}
      </p>
      {children}
    </div>
  )
}

// ─── Subtareas (checklist con responsable por subtarea) ──────────────────────

const SIN_RESP_SUB = '__sin__'

interface SeccionSubtareasProps {
  tareaId: number
  usuarios: { id: string; nombre: string }[]
}

function SeccionSubtareas({ tareaId, usuarios }: SeccionSubtareasProps) {
  const { data: subtareas, isLoading } = useSubtareas(tareaId)
  const crear = useCreateSubtarea()
  const [nuevoTitulo, setNuevoTitulo] = useState('')
  const [agregando, setAgregando] = useState(false)

  const total = subtareas?.length ?? 0
  const hechas = (subtareas ?? []).filter((s) => s.hecha).length

  function agregar() {
    const t = nuevoTitulo.trim()
    if (!t) return
    crear.mutate(
      { tarea_id: tareaId, titulo: t, orden: total },
      {
        onSuccess: () => {
          setNuevoTitulo('')
        },
      }
    )
  }

  return (
    <div className="space-y-1 pt-3 border-t border-[#e4c9b0]/40">
      <div className="flex items-center gap-2 px-1 py-1">
        <span className="text-[#391511] font-semibold text-sm">Subtareas</span>
        {total > 0 && (
          <span className="text-[11px] text-[#c8a58a] tabular-nums">
            {hechas}/{total}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-[#c8a58a] text-xs px-1">Cargando…</p>
      ) : (
        <ul className="divide-y divide-[#e4c9b0]/40">
          {(subtareas ?? []).map((s) => (
            <FilaSubtarea key={s.id} subtarea={s} usuarios={usuarios} />
          ))}
        </ul>
      )}

      {agregando ? (
        <div className="flex items-center gap-2 pl-1 pr-1 py-1">
          <span className="h-4 w-4 rounded-full border-2 border-[#c8a58a] shrink-0" />
          <Input
            autoFocus
            value={nuevoTitulo}
            onChange={(e) => setNuevoTitulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                agregar()
              }
              if (e.key === 'Escape') {
                setNuevoTitulo('')
                setAgregando(false)
              }
            }}
            placeholder="Nueva subtarea…"
            className="h-7 flex-1 text-sm border-0 shadow-none focus-visible:ring-0 px-0"
          />
          <Button
            size="sm"
            onClick={agregar}
            disabled={!nuevoTitulo.trim() || crear.isPending}
            className="h-7 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold text-xs"
          >
            {crear.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              'Añadir'
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              setNuevoTitulo('')
              setAgregando(false)
            }}
            className="h-7 w-7 text-[#6f3a2a]"
            aria-label="Cancelar"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAgregando(true)}
          className="flex items-center gap-2 text-[#c43e2c] hover:text-[#9e2f25] text-sm font-medium px-1 py-1.5 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Añadir subtarea
        </button>
      )}
    </div>
  )
}

function FilaSubtarea({
  subtarea,
  usuarios,
}: {
  subtarea: SubtareaRow
  usuarios: { id: string; nombre: string }[]
}) {
  const marcar = useMarcarSubtarea()
  const actualizar = useUpdateSubtarea()
  const eliminar = useDeleteSubtarea()

  const [editando, setEditando] = useState(false)
  const [titulo, setTitulo] = useState(subtarea.titulo)

  // Items para el Select de responsable (sin esto el SelectValue muestra el UUID crudo).
  const itemsResp: Record<string, string> = useMemo(() => {
    const base: Record<string, string> = { [SIN_RESP_SUB]: 'Sin asignar' }
    for (const u of usuarios) base[u.id] = u.nombre
    return base
  }, [usuarios])

  function guardarTitulo() {
    const t = titulo.trim()
    if (!t || t === subtarea.titulo) {
      setTitulo(subtarea.titulo)
      setEditando(false)
      return
    }
    actualizar.mutate(
      { id: subtarea.id, datos: { titulo: t } },
      { onSettled: () => setEditando(false) }
    )
  }

  return (
    <li className="group flex items-center gap-2 px-1 py-1.5 hover:bg-[#fdfaf6] rounded">
      <button
        type="button"
        onClick={() =>
          marcar.mutate({ id: subtarea.id, hecha: !subtarea.hecha })
        }
        className={cn(
          'h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors',
          subtarea.hecha
            ? 'bg-[#f9b44c] border-[#f9b44c]'
            : 'border-[#c8a58a] hover:border-[#f9b44c]'
        )}
        aria-label={subtarea.hecha ? 'Desmarcar' : 'Marcar como hecha'}
      >
        {subtarea.hecha && (
          <svg
            className="h-2.5 w-2.5 text-white"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M2 6l3 3 5-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {editando ? (
        <Input
          autoFocus
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={guardarTitulo}
          onKeyDown={(e) => {
            if (e.key === 'Enter') guardarTitulo()
            if (e.key === 'Escape') {
              setTitulo(subtarea.titulo)
              setEditando(false)
            }
          }}
          className="h-7 flex-1 text-sm border-0 shadow-none focus-visible:ring-0 px-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className={cn(
            'flex-1 text-left text-sm truncate',
            subtarea.hecha
              ? 'line-through text-[#c8a58a]'
              : 'text-[#391511]'
          )}
        >
          {subtarea.titulo}
        </button>
      )}

      <Select
        items={itemsResp}
        value={subtarea.responsable_id ?? SIN_RESP_SUB}
        onValueChange={(v) =>
          actualizar.mutate({
            id: subtarea.id,
            datos: {
              responsable_id:
                !v || v === SIN_RESP_SUB ? null : v,
            },
          })
        }
      >
        <SelectTrigger className="h-7 w-32 border-[#e4c9b0] text-xs bg-white">
          <SelectValue placeholder="Sin asignar" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SIN_RESP_SUB}>Sin asignar</SelectItem>
          {usuarios.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="icon"
        variant="ghost"
        onClick={() => eliminar.mutate(subtarea.id)}
        className="h-6 w-6 text-[#c43e2c] hover:bg-[#c43e2c]/10 opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Eliminar subtarea"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  )
}
