'use client'

import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Pencil,
  Plus,
  Users as UsersIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ModalTablero } from './ModalTablero'
import { ModalMiembrosTablero } from './ModalMiembrosTablero'
import { TableroKanban } from './TableroKanban'
import { useTableros } from '@/lib/hooks/useTableros'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import type { VistaTableroUsuarioRow } from '@/types/database'

export function PantallaProyectos() {
  const { data: usuario } = useUsuario()
  const esAdminSistema = tienePermiso(usuario?.permisos, 'configuracion')

  const { data: tableros, isLoading } = useTableros()

  const [tableroSel, setTableroSel] = useState<VistaTableroUsuarioRow | null>(
    null
  )
  const [modalNuevoTablero, setModalNuevoTablero] = useState(false)

  if (tableroSel) {
    return (
      <TableroKanban
        tablero={tableroSel}
        esAdminSistema={esAdminSistema}
        onVolver={() => setTableroSel(null)}
      />
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Tus tableros</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Espacios de trabajo del equipo. Cada tablero agrupa secciones y
            tareas, y tiene sus propios miembros.
          </p>
        </div>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {(tableros ?? []).map((tb) => (
            <TarjetaTablero
              key={tb.id}
              tablero={tb}
              onClick={() => setTableroSel(tb)}
            />
          ))}

          {/* Crear nuevo */}
          <button
            type="button"
            onClick={() => setModalNuevoTablero(true)}
            className="h-24 rounded-xl border-2 border-dashed border-[#e4c9b0] bg-[#fdfaf6] hover:bg-white hover:border-[#f9b44c] transition-colors flex items-center justify-center text-[#6f3a2a] font-medium text-sm gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Crear un tablero nuevo
          </button>
        </div>
      )}

      <ModalTablero
        abierto={modalNuevoTablero}
        onCambioAbierto={setModalNuevoTablero}
      />
    </div>
  )
}

// ─── Tarjeta del tablero (estilo Trello workspace) ─────────────────────────────

function TarjetaTablero({
  tablero,
  onClick,
}: {
  tablero: VistaTableroUsuarioRow
  onClick: () => void
}) {
  const conImagen = !!tablero.imagen_url
  const estilo: React.CSSProperties = conImagen
    ? {
        backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.55)), url(${tablero.imagen_url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : {
        background: `linear-gradient(135deg, ${tablero.color} 0%, ${oscurecer(tablero.color)} 100%)`,
      }

  return (
    <button
      type="button"
      onClick={onClick}
      style={estilo}
      className="relative h-24 rounded-xl overflow-hidden text-left p-3 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow group"
    >
      <span className="text-white font-bold text-sm drop-shadow leading-tight line-clamp-2">
        {tablero.nombre}
      </span>
      <div className="flex items-center justify-between text-[10px] text-white/90">
        <span className="bg-black/30 backdrop-blur px-1.5 py-0.5 rounded">
          {tablero.proyectos_activos}/{tablero.total_proyectos} listas
        </span>
        {tablero.mi_rol && (
          <span className="bg-black/30 backdrop-blur px-1.5 py-0.5 rounded uppercase tracking-wider font-bold">
            {tablero.mi_rol}
          </span>
        )}
      </div>
    </button>
  )
}

/** Devuelve una versión un 20 % más oscura del color hex. */
function oscurecer(hex: string): string {
  const c = hex.replace('#', '')
  if (c.length !== 6) return hex
  const r = Math.max(0, parseInt(c.slice(0, 2), 16) - 40)
  const g = Math.max(0, parseInt(c.slice(2, 4), 16) - 40)
  const b = Math.max(0, parseInt(c.slice(4, 6), 16) - 40)
  return `#${r.toString(16).padStart(2, '0')}${g
    .toString(16)
    .padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

// ─── Header reutilizable que vamos a usar dentro del tablero ───────────────────

export function HeaderTableroInterno({
  tablero,
  onVolver,
  onEditar,
  onMiembros,
  puedeAdministrar,
}: {
  tablero: VistaTableroUsuarioRow
  onVolver: () => void
  onEditar: () => void
  onMiembros: () => void
  puedeAdministrar: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onVolver}
          className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 mt-0.5"
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-[#391511] text-2xl font-bold flex items-center gap-2">
            <span
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: tablero.color }}
            />
            {tablero.nombre}
            {puedeAdministrar && (
              <button
                type="button"
                onClick={onEditar}
                className="text-[#c8a58a] hover:text-[#391511]"
                aria-label="Editar tablero"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </h1>
          {tablero.descripcion && (
            <p className="text-[#6f3a2a] text-sm mt-0.5">
              {tablero.descripcion}
            </p>
          )}
        </div>
      </div>
      {puedeAdministrar && (
        <Button
          variant="outline"
          onClick={onMiembros}
          className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
        >
          <UsersIcon className="h-4 w-4" />
          Miembros ({tablero.total_miembros})
        </Button>
      )}
    </div>
  )
}

// Re-export útil en este archivo para no romper imports anteriores.
export { ModalMiembrosTablero, ModalTablero }
