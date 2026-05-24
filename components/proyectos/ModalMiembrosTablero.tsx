'use client'

import { useMemo, useState } from 'react'
import { Loader2, Trash2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  useAgregarMiembro,
  useCambiarRolMiembro,
  useMiembrosTablero,
  useQuitarMiembro,
} from '@/lib/hooks/useTableros'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import type { RolTablero } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  tableroId: number
  tableroNombre: string
}

const ROLES: Record<RolTablero, string> = {
  lector: 'Lector',
  editor: 'Editor',
  admin: 'Admin del tablero',
}

const DESCRIPCION_ROL: Record<RolTablero, string> = {
  lector: 'Solo puede ver el contenido del tablero.',
  editor: 'Puede crear y editar proyectos y tareas.',
  admin: 'Puede todo lo anterior + gestionar miembros del tablero.',
}

export function ModalMiembrosTablero({
  abierto,
  onCambioAbierto,
  tableroId,
  tableroNombre,
}: Props) {
  const { data: miembros, isLoading } = useMiembrosTablero(
    abierto ? tableroId : null
  )
  const { data: usuarios } = useUsuariosActivos()
  const agregar = useAgregarMiembro()
  const quitar = useQuitarMiembro()
  const cambiarRol = useCambiarRolMiembro()

  const [nuevoUsuario, setNuevoUsuario] = useState<string>('')
  const [nuevoRol, setNuevoRol] = useState<RolTablero>('editor')

  const yaMiembros = useMemo(
    () => new Set((miembros ?? []).map((m) => m.usuario_id)),
    [miembros]
  )

  const candidatos = (usuarios ?? []).filter((u) => !yaMiembros.has(u.id))

  const nombrePorId = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usuarios ?? []) m.set(u.id, u.nombre)
    return m
  }, [usuarios])

  function agregarMiembro() {
    if (!nuevoUsuario) return
    agregar.mutate(
      { tableroId, usuarioId: nuevoUsuario, rol: nuevoRol },
      { onSuccess: () => setNuevoUsuario('') }
    )
  }

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            Miembros del tablero
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {tableroNombre}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Agregar miembro */}
          <div className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-xl p-3 space-y-2">
            <p className="text-[#391511] font-semibold text-sm flex items-center gap-1.5">
              <UserPlus className="h-4 w-4" />
              Agregar miembro
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select
                value={nuevoUsuario}
                onValueChange={(v) => setNuevoUsuario(v ?? '')}
                disabled={candidatos.length === 0}
              >
                <SelectTrigger className="flex-1 border-[#e4c9b0] focus:ring-[#f9b44c]">
                  <SelectValue placeholder="Empleado…" />
                </SelectTrigger>
                <SelectContent>
                  {candidatos.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={nuevoRol}
                onValueChange={(v) =>
                  setNuevoRol((v as RolTablero) ?? 'editor')
                }
              >
                <SelectTrigger className="w-full sm:w-44 border-[#e4c9b0] focus:ring-[#f9b44c]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ROLES) as RolTablero[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLES[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={agregarMiembro}
                disabled={!nuevoUsuario || agregar.isPending}
                className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
              >
                {agregar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Agregar'
                )}
              </Button>
            </div>
            <p className="text-[11px] text-[#c8a58a]">
              {DESCRIPCION_ROL[nuevoRol]}
            </p>
          </div>

          {/* Listado */}
          <div className="space-y-2">
            <p className="text-[#391511] font-semibold text-sm">
              Miembros actuales ({miembros?.length ?? 0})
            </p>

            {isLoading ? (
              <p className="text-[#c8a58a] text-sm">Cargando…</p>
            ) : !miembros || miembros.length === 0 ? (
              <p className="text-[#c8a58a] text-sm py-3 text-center">
                Sin miembros todavía.
              </p>
            ) : (
              <ul className="divide-y divide-[#e4c9b0]/50 bg-white border border-[#e4c9b0]/60 rounded-xl overflow-hidden">
                {miembros.map((m) => (
                  <li
                    key={m.usuario_id}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[#391511] text-sm font-medium truncate">
                        {nombrePorId.get(m.usuario_id) ?? m.usuario_id}
                      </p>
                    </div>
                    <Select
                      value={m.rol}
                      onValueChange={(v) =>
                        cambiarRol.mutate({
                          tableroId,
                          usuarioId: m.usuario_id,
                          rol: (v as RolTablero) ?? 'editor',
                        })
                      }
                    >
                      <SelectTrigger className="w-40 h-8 border-[#e4c9b0]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ROLES) as RolTablero[]).map((r) => (
                          <SelectItem key={r} value={r}>
                            {ROLES[r]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        quitar.mutate({
                          tableroId,
                          usuarioId: m.usuario_id,
                        })
                      }
                      className="h-8 w-8 text-[#c43e2c] hover:bg-[#c43e2c]/10"
                      aria-label="Quitar miembro"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex justify-end">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
