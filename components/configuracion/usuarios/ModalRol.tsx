'use client'

import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
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
import { useActualizarRol, useCrearRol } from '@/lib/hooks/useRoles'
import {
  GRUPOS_PERMISOS,
  PERMISOS,
  TODOS_LOS_PERMISOS,
} from '@/lib/permisos'
import { cn } from '@/lib/utils'
import type { RolRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** null = crear rol nuevo; row = editar */
  rol: RolRow | null
}

export function ModalRol({ abierto, onCambioAbierto, rol }: Props) {
  const crear = useCrearRol()
  const actualizar = useActualizarRol()

  const [nombre, setNombre] = useState('')
  const [permisos, setPermisos] = useState<string[]>([])

  const esEdicion = rol !== null
  const esAdminRole = rol?.codigo === 'admin'
  const procesando = crear.isPending || actualizar.isPending

  useEffect(() => {
    if (!abierto) return
    setNombre(rol?.nombre ?? '')
    setPermisos(rol ? [...rol.permisos] : ['dashboard'])
  }, [abierto, rol])

  function togglePermiso(clave: string) {
    setPermisos((prev) =>
      prev.includes(clave)
        ? prev.filter((p) => p !== clave)
        : [...prev, clave]
    )
  }

  function guardar() {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio || procesando) return
    // El rol admin siempre conserva todos los permisos.
    const permisosFinales = esAdminRole ? TODOS_LOS_PERMISOS : permisos

    if (esEdicion && rol) {
      actualizar.mutate(
        { id: rol.id, patch: { nombre: nombreLimpio, permisos: permisosFinales } },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(
        { nombre: nombreLimpio, permisos: permisosFinales },
        { onSuccess: () => onCambioAbierto(false) }
      )
    }
  }

  const puedeGuardar = nombre.trim().length > 0 && !procesando

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#f9b44c]" />
            {esEdicion ? 'Editar rol' : 'Nuevo rol'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Elegí qué módulos puede ver y usar este rol.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">Nombre del rol</Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Repositor, Supervisor de turno"
              maxLength={40}
              autoFocus
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          {esAdminRole && (
            <p className="text-xs text-[#6f3a2a] bg-[#f9b44c]/15 rounded-lg px-3 py-2">
              El rol Administrador siempre tiene todos los permisos y no se
              puede limitar.
            </p>
          )}

          <div className="space-y-3">
            <Label className="text-[#391511] font-medium">Permisos</Label>
            {GRUPOS_PERMISOS.map((grupo) => (
              <div key={grupo}>
                <div className="text-[10px] uppercase tracking-wider text-[#c8a58a] font-bold mb-1">
                  {grupo}
                </div>
                <div className="space-y-1">
                  {PERMISOS.filter((p) => p.grupo === grupo).map((p) => {
                    const marcado = esAdminRole || permisos.includes(p.clave)
                    return (
                      <label
                        key={p.clave}
                        className={cn(
                          'flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors',
                          marcado
                            ? 'border-[#f9b44c] bg-[#f9b44c]/10'
                            : 'border-[#e4c9b0] bg-white hover:border-[#c8a58a]',
                          (esAdminRole || procesando) &&
                            'cursor-default opacity-90'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={marcado}
                          onChange={() => togglePermiso(p.clave)}
                          disabled={esAdminRole || procesando}
                          className="accent-[#f9b44c] h-4 w-4"
                        />
                        <span className="text-sm text-[#391511]">
                          {p.etiqueta}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2 shrink-0">
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
            ) : esEdicion ? (
              'Guardar cambios'
            ) : (
              'Crear rol'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
