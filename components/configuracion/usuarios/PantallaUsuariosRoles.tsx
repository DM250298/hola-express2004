'use client'

import { useMemo, useState } from 'react'
import {
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ModalRol } from './ModalRol'
import { ModalNuevoUsuario } from './ModalNuevoUsuario'
import {
  useActualizarUsuario,
  useEliminarRol,
  useEliminarUsuario,
  useRoles,
  useUsuariosAdmin,
} from '@/lib/hooks/useRoles'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'
import type { RolRow } from '@/types/database'

export function PantallaUsuariosRoles() {
  const { data: roles, isLoading: cargandoRoles } = useRoles()
  const { data: usuarios, isLoading: cargandoUsuarios } = useUsuariosAdmin()
  const actualizarUsuario = useActualizarUsuario()
  const eliminarRol = useEliminarRol()
  const eliminarUsuario = useEliminarUsuario()

  const { data: usuarioActual } = useUsuario()
  const esAdmin = usuarioActual?.rol === 'admin'

  const [modalRolAbierto, setModalRolAbierto] = useState(false)
  const [rolEditar, setRolEditar] = useState<RolRow | null>(null)
  const [modalUsuarioAbierto, setModalUsuarioAbierto] = useState(false)

  const itemsRol = useMemo(() => {
    const r: Record<string, string> = {}
    for (const rol of roles ?? []) r[rol.codigo] = rol.nombre
    return r
  }, [roles])

  function abrirNuevoRol() {
    setRolEditar(null)
    setModalRolAbierto(true)
  }
  function abrirEdicionRol(rol: RolRow) {
    setRolEditar(rol)
    setModalRolAbierto(true)
  }
  function borrarRol(rol: RolRow) {
    if (!confirm(`¿Borrar el rol "${rol.nombre}"?`)) return
    eliminarRol.mutate(rol.id)
  }
  function borrarUsuario(u: { id: string; nombre: string }) {
    if (u.id === usuarioActual?.id) return
    if (
      !confirm(
        `¿Borrar al usuario "${u.nombre}"? Esta acción no se puede deshacer.\n\nSi ya tiene ventas o turnos registrados no se podrá borrar; en ese caso desactivá su acceso.`
      )
    )
      return
    eliminarUsuario.mutate(u.id)
  }

  return (
    <Tabs defaultValue="usuarios" className="space-y-4">
      <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto">
        <TabsTrigger
          value="usuarios"
          className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511] gap-1.5"
        >
          <Users className="h-3.5 w-3.5" />
          Usuarios
        </TabsTrigger>
        <TabsTrigger
          value="roles"
          className="data-active:bg-[#f9b44c]/20 data-active:text-[#391511] gap-1.5"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Roles y permisos
        </TabsTrigger>
      </TabsList>

      {/* ─── Usuarios ─── */}
      <TabsContent value="usuarios" className="space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-[#6f3a2a] text-sm max-w-xl">
            Asigná el rol de cada empleado y activá o desactivá su acceso.
          </p>
          {esAdmin && (
            <Button
              onClick={() => setModalUsuarioAbierto(true)}
              size="sm"
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Agregar usuario
            </Button>
          )}
        </div>
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
          {cargandoUsuarios ? (
            <div className="p-6 space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg bg-[#f9d2a2]/30" />
              ))}
            </div>
          ) : !usuarios || usuarios.length === 0 ? (
            <div className="p-10 text-center text-[#6f3a2a] text-sm">
              No hay usuarios cargados.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Nombre
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Email
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold w-44">
                    Rol
                  </TableHead>
                  <TableHead className="text-center text-[#391511] font-semibold w-24">
                    Activo
                  </TableHead>
                  {esAdmin && (
                    <TableHead className="text-center text-[#391511] font-semibold w-16">
                      <span className="sr-only">Acciones</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {usuarios.map((u) => (
                  <TableRow key={u.id} className="border-b-[#e4c9b0]/40">
                    <TableCell className="font-medium text-[#391511]">
                      {u.nombre}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <Select
                        items={itemsRol}
                        value={u.rol}
                        onValueChange={(v) =>
                          v &&
                          actualizarUsuario.mutate({
                            id: u.id,
                            patch: { rol: v },
                          })
                        }
                        disabled={actualizarUsuario.isPending}
                      >
                        <SelectTrigger className="h-8 border-[#e4c9b0] focus:ring-[#f9b44c] bg-white text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(roles ?? []).map((r) => (
                            <SelectItem key={r.codigo} value={r.codigo}>
                              {r.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={u.activo}
                        onCheckedChange={(v) =>
                          actualizarUsuario.mutate({
                            id: u.id,
                            patch: { activo: v },
                          })
                        }
                        disabled={actualizarUsuario.isPending}
                        aria-label={`Activar ${u.nombre}`}
                      />
                    </TableCell>
                    {esAdmin && (
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => borrarUsuario(u)}
                          disabled={
                            u.id === usuarioActual?.id ||
                            eliminarUsuario.isPending
                          }
                          className={cn(
                            'h-8 w-8 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]',
                            u.id === usuarioActual?.id && 'opacity-30'
                          )}
                          title={
                            u.id === usuarioActual?.id
                              ? 'No podés borrar tu propia cuenta'
                              : `Borrar a ${u.nombre}`
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </TabsContent>

      {/* ─── Roles ─── */}
      <TabsContent value="roles" className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[#6f3a2a] text-sm">
            Creá roles a medida y definí qué módulos puede usar cada uno.
          </p>
          <Button
            onClick={abrirNuevoRol}
            size="sm"
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo rol
          </Button>
        </div>

        {cargandoRoles ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 rounded-2xl bg-[#f9d2a2]/30" />
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
            {(roles ?? []).map((rol) => (
              <li
                key={rol.id}
                className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 flex items-center gap-3"
              >
                <div className="shrink-0 p-2 rounded-lg bg-[#f9b44c]/15">
                  <ShieldCheck className="h-4 w-4 text-[#391511]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-[#391511]">
                      {rol.nombre}
                    </span>
                    {rol.es_sistema && (
                      <Lock
                        className="h-3 w-3 text-[#c8a58a]"
                        aria-label="Rol base"
                      />
                    )}
                  </div>
                  <div className="text-xs text-[#6f3a2a]">
                    {rol.codigo === 'admin'
                      ? 'Acceso total'
                      : `${rol.permisos.length} permisos`}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => abrirEdicionRol(rol)}
                  className="h-8 w-8 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                  title="Editar rol"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => borrarRol(rol)}
                  disabled={rol.es_sistema || eliminarRol.isPending}
                  className={cn(
                    'h-8 w-8 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]',
                    rol.es_sistema && 'opacity-30'
                  )}
                  title={
                    rol.es_sistema
                      ? 'Rol base — no se puede borrar'
                      : 'Borrar rol'
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </TabsContent>

      <ModalRol
        abierto={modalRolAbierto}
        onCambioAbierto={setModalRolAbierto}
        rol={rolEditar}
      />
      <ModalNuevoUsuario
        abierto={modalUsuarioAbierto}
        onCambioAbierto={setModalUsuarioAbierto}
      />
    </Tabs>
  )
}
