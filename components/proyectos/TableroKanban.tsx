'use client'

import { useMemo, useState } from 'react'
import {
  CalendarClock,
  CheckSquare,
  Loader2,
  MoreHorizontal,
  Plus,
  User,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ModalTarea } from './ModalTarea'
import { ModalTablero } from './ModalTablero'
import { ModalMiembrosTablero } from './ModalMiembrosTablero'
import { HeaderTableroInterno } from './PantallaProyectos'
import {
  useCreateProyecto,
  useCreateTarea,
  useDeleteProyecto,
  useProyectos,
  useTareas,
  useUpdateProyecto,
} from '@/lib/hooks/useProyectos'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type {
  RolTablero,
  TareaRow,
  VistaProyectoRow,
  VistaTableroUsuarioRow,
} from '@/types/database'

interface Props {
  tablero: VistaTableroUsuarioRow
  esAdminSistema: boolean
  onVolver: () => void
}

const COLOR_PRIORIDAD: Record<string, string> = {
  alta: 'bg-[#c43e2c]/15 text-[#c43e2c]',
  media: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
  baja: 'bg-[#e4c9b0]/40 text-[#6f3a2a]',
}

export function TableroKanban({ tablero, esAdminSistema, onVolver }: Props) {
  const { data: secciones, isLoading } = useProyectos(tablero.id)

  const [modalTablero, setModalTablero] = useState(false)
  const [modalMiembros, setModalMiembros] = useState(false)
  const [modalTareaAbierta, setModalTareaAbierta] = useState(false)
  const [tareaEditar, setTareaEditar] = useState<TareaRow | null>(null)
  const [proyectoTareaId, setProyectoTareaId] = useState<number | null>(null)

  const rol: RolTablero | null = tablero.mi_rol
  const puedeEditar = esAdminSistema || rol === 'editor' || rol === 'admin'
  const puedeAdministrar = esAdminSistema || rol === 'admin'

  function abrirNuevaTarea(proyectoId: number) {
    setTareaEditar(null)
    setProyectoTareaId(proyectoId)
    setModalTareaAbierta(true)
  }

  function abrirEdicionTarea(t: TareaRow) {
    setTareaEditar(t)
    setProyectoTareaId(t.proyecto_id)
    setModalTareaAbierta(true)
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <HeaderTableroInterno
        tablero={tablero}
        onVolver={onVolver}
        onEditar={() => setModalTablero(true)}
        onMiembros={() => setModalMiembros(true)}
        puedeAdministrar={puedeAdministrar}
      />

      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              className="h-72 w-72 shrink-0 rounded-2xl bg-[#f9d2a2]/30"
            />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 sm:-mx-6 sm:px-6 snap-x">
          {(secciones ?? []).map((s) => (
            <ColumnaSeccion
              key={s.id}
              seccion={s}
              puedeEditar={puedeEditar}
              puedeAdministrar={puedeAdministrar}
              onNuevaTarea={() => abrirNuevaTarea(s.id)}
              onEditarTarea={abrirEdicionTarea}
            />
          ))}

          {puedeEditar && (
            <AgregarLista
              tableroId={tablero.id}
              ordenSiguiente={(secciones?.length ?? 0)}
            />
          )}
        </div>
      )}

      <ModalTarea
        abierto={modalTareaAbierta}
        onCambioAbierto={setModalTareaAbierta}
        proyectoId={proyectoTareaId ?? 0}
        tarea={tareaEditar}
      />

      <ModalTablero
        abierto={modalTablero}
        onCambioAbierto={setModalTablero}
        tablero={tablero}
      />

      <ModalMiembrosTablero
        abierto={modalMiembros}
        onCambioAbierto={setModalMiembros}
        tableroId={tablero.id}
        tableroNombre={tablero.nombre}
      />
    </div>
  )
}

// ─── Columna (sección/lista) ──────────────────────────────────────────────────

function ColumnaSeccion({
  seccion,
  puedeEditar,
  puedeAdministrar,
  onNuevaTarea,
  onEditarTarea,
}: {
  seccion: VistaProyectoRow
  puedeEditar: boolean
  puedeAdministrar: boolean
  onNuevaTarea: () => void
  onEditarTarea: (t: TareaRow) => void
}) {
  const { data: tareas, isLoading } = useTareas(seccion.id)
  const { data: usuarios } = useUsuariosActivos()
  const actualizar = useUpdateProyecto()
  const eliminar = useDeleteProyecto()

  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usuarios ?? []) m.set(u.id, u.nombre)
    return m
  }, [usuarios])

  const [menuAbierto, setMenuAbierto] = useState(false)
  const [editandoNombre, setEditandoNombre] = useState(false)
  const [nombre, setNombre] = useState(seccion.nombre)

  const hoy = new Date().toISOString().slice(0, 10)

  function guardarNombre() {
    const nuevo = nombre.trim()
    if (!nuevo || nuevo === seccion.nombre) {
      setNombre(seccion.nombre)
      setEditandoNombre(false)
      return
    }
    actualizar.mutate(
      { id: seccion.id, datos: { nombre: nuevo } },
      { onSettled: () => setEditandoNombre(false) }
    )
  }

  function handleEliminar() {
    if (
      !confirm(
        `¿Eliminar la lista "${seccion.nombre}" y todas sus tareas?`
      )
    )
      return
    eliminar.mutate(seccion.id)
  }

  return (
    <div className="w-72 shrink-0 bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-2xl p-2 space-y-2 snap-start">
      {/* Header de la lista */}
      <div className="flex items-center gap-1 px-1 pt-1">
        {editandoNombre ? (
          <Input
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            onBlur={guardarNombre}
            onKeyDown={(e) => {
              if (e.key === 'Enter') guardarNombre()
              if (e.key === 'Escape') {
                setNombre(seccion.nombre)
                setEditandoNombre(false)
              }
            }}
            className="h-7 text-sm font-bold border-[#f9b44c] focus-visible:ring-[#f9b44c] px-2 py-0.5"
          />
        ) : (
          <button
            type="button"
            onClick={() => puedeEditar && setEditandoNombre(true)}
            className="flex-1 text-left text-[#391511] font-bold text-sm px-1 py-0.5 rounded hover:bg-white"
            disabled={!puedeEditar}
          >
            {seccion.nombre}
          </button>
        )}
        <span className="text-[11px] text-[#6f3a2a] tabular-nums bg-white border border-[#e4c9b0]/60 rounded-full px-1.5">
          {seccion.total_tareas}
        </span>
        {puedeAdministrar && (
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMenuAbierto((v) => !v)}
              className="h-7 w-7 text-[#6f3a2a] hover:bg-white"
              aria-label="Más opciones"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {menuAbierto && (
              <div
                className="absolute right-0 top-8 z-10 w-40 bg-white border border-[#e4c9b0] rounded-lg shadow-lg py-1 text-sm"
                onMouseLeave={() => setMenuAbierto(false)}
              >
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-[#fdfaf6] text-[#391511]"
                  onClick={() => {
                    setMenuAbierto(false)
                    setEditandoNombre(true)
                  }}
                >
                  Renombrar
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-[#c43e2c]/10 text-[#c43e2c]"
                  onClick={() => {
                    setMenuAbierto(false)
                    handleEliminar()
                  }}
                >
                  Eliminar lista
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tarjetas */}
      <div className="space-y-2 max-h-[calc(100vh-280px)] overflow-y-auto px-0.5">
        {isLoading ? (
          <Skeleton className="h-16 rounded-lg bg-[#f9d2a2]/30" />
        ) : (tareas ?? []).length === 0 ? (
          <p className="text-[#c8a58a] text-xs text-center py-3">Sin tareas</p>
        ) : (
          (tareas ?? []).map((t) => {
            const vencida =
              t.fecha_limite != null &&
              t.fecha_limite < hoy &&
              t.estado !== 'hecha'
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onEditarTarea(t)}
                className="w-full text-left bg-white border border-[#e4c9b0]/60 rounded-lg p-2.5 shadow-sm hover:border-[#f9b44c] transition-colors space-y-1.5"
              >
                <div className="text-[#391511] text-sm font-medium leading-snug">
                  {t.titulo}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className={cn(
                      'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded',
                      COLOR_PRIORIDAD[t.prioridad] ?? COLOR_PRIORIDAD.media
                    )}
                  >
                    {t.prioridad}
                  </span>
                  {t.estado === 'hecha' && (
                    <span className="text-[10px] uppercase tracking-wider font-bold bg-[#2f8f4e]/15 text-[#2f8f4e] px-1.5 py-0.5 rounded">
                      hecha
                    </span>
                  )}
                  {t.fecha_limite && (
                    <span
                      className={cn(
                        'flex items-center gap-0.5 text-[10px] tabular-nums',
                        vencida
                          ? 'text-[#c43e2c] font-bold'
                          : 'text-[#6f3a2a]'
                      )}
                    >
                      <CalendarClock className="h-3 w-3" />
                      {formatearFechaCorta(t.fecha_limite)}
                    </span>
                  )}
                  {t.responsable_id && (
                    <span className="ml-auto flex items-center gap-0.5 text-[10px] text-[#6f3a2a]">
                      <User className="h-3 w-3" />
                      {nombrePorId.get(t.responsable_id) ?? '—'}
                    </span>
                  )}
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Agregar tarjeta */}
      {puedeEditar && (
        <AgregarTarjeta seccionId={seccion.id} onSugerirAvanzada={onNuevaTarea} />
      )}
    </div>
  )
}

// ─── Agregar tarjeta inline ───────────────────────────────────────────────────

function AgregarTarjeta({
  seccionId,
  onSugerirAvanzada,
}: {
  seccionId: number
  onSugerirAvanzada: () => void
}) {
  const { data: usuario } = useUsuario()
  const crear = useCreateTarea()
  const [abierto, setAbierto] = useState(false)
  const [titulo, setTitulo] = useState('')

  function guardar() {
    const t = titulo.trim()
    if (!t) return
    crear.mutate(
      {
        proyecto_id: seccionId,
        titulo: t,
        creado_por: usuario?.id ?? null,
      },
      {
        onSuccess: () => {
          setTitulo('')
        },
      }
    )
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-full flex items-center gap-1.5 text-[#6f3a2a] hover:bg-white rounded-lg px-2 py-1.5 text-sm font-medium"
      >
        <Plus className="h-4 w-4" />
        Añade una tarjeta
      </button>
    )
  }

  return (
    <div className="space-y-2 bg-white border border-[#e4c9b0] rounded-lg p-2">
      <Input
        autoFocus
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            guardar()
          }
          if (e.key === 'Escape') {
            setTitulo('')
            setAbierto(false)
          }
        }}
        placeholder="Título de la tarea"
        className="h-8 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
      />
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          onClick={guardar}
          disabled={!titulo.trim() || crear.isPending}
          className="h-7 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
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
            setTitulo('')
            setAbierto(false)
          }}
          className="h-7 w-7 text-[#6f3a2a]"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </Button>
        <button
          type="button"
          onClick={() => {
            setTitulo('')
            setAbierto(false)
            onSugerirAvanzada()
          }}
          className="ml-auto text-[11px] text-[#6f3a2a] hover:text-[#391511] underline"
        >
          Opciones avanzadas
        </button>
      </div>
    </div>
  )
}

// ─── Agregar lista (sección) inline ───────────────────────────────────────────

function AgregarLista({
  tableroId,
  ordenSiguiente,
}: {
  tableroId: number
  ordenSiguiente: number
}) {
  const { data: usuario } = useUsuario()
  const crear = useCreateProyecto()
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')

  function guardar() {
    const n = nombre.trim()
    if (!n) return
    crear.mutate(
      {
        nombre: n,
        tablero_id: tableroId,
        orden: ordenSiguiente,
        usuario_id: usuario?.id ?? null,
      },
      {
        onSuccess: () => {
          setNombre('')
          setAbierto(false)
        },
      }
    )
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="w-72 shrink-0 h-12 rounded-2xl bg-[#fdfaf6]/70 hover:bg-[#fdfaf6] border-2 border-dashed border-[#e4c9b0] text-[#6f3a2a] text-sm font-medium flex items-center justify-center gap-1.5 snap-start"
      >
        <Plus className="h-4 w-4" />
        Añade otra lista
      </button>
    )
  }

  return (
    <div className="w-72 shrink-0 bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-2xl p-2 space-y-2 snap-start">
      <Input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            guardar()
          }
          if (e.key === 'Escape') {
            setNombre('')
            setAbierto(false)
          }
        }}
        placeholder="Nombre de la lista"
        className="h-8 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
      />
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          onClick={guardar}
          disabled={!nombre.trim() || crear.isPending}
          className="h-7 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
        >
          {crear.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            'Añadir lista'
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            setNombre('')
            setAbierto(false)
          }}
          className="h-7 w-7 text-[#6f3a2a]"
          aria-label="Cancelar"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// Mantener el ícono unused fuera del bundle final.
void CheckSquare
