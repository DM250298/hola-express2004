'use client'

import { useEffect, useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
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
import { useCrearUsuario, useRoles } from '@/lib/hooks/useRoles'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

export function ModalNuevoUsuario({ abierto, onCambioAbierto }: Props) {
  const { data: roles } = useRoles()
  const crear = useCrearUsuario()

  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rol, setRol] = useState('cajero')

  useEffect(() => {
    if (abierto) {
      setNombre('')
      setEmail('')
      setPassword('')
      setRol('cajero')
    }
  }, [abierto])

  const itemsRol: Record<string, string> = Object.fromEntries(
    (roles ?? []).map((r) => [r.codigo, r.nombre])
  )

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const puedeCrear =
    nombre.trim().length >= 2 &&
    emailValido &&
    password.length >= 6 &&
    !!rol &&
    !crear.isPending

  function guardar() {
    if (!puedeCrear) return
    crear.mutate(
      {
        nombre: nombre.trim(),
        email: email.trim(),
        password,
        rol,
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !crear.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#f9b44c]" />
            Agregar usuario
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            El usuario podrá iniciar sesión con este email y contraseña.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nombre y apellido
            </Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Juan Pérez"
              maxLength={60}
              autoFocus
              disabled={crear.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Email</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="empleado@holaexpress.com"
              disabled={crear.isPending}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Contraseña
              </Label>
              <Input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                disabled={crear.isPending}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Rol</Label>
              <Select
                items={itemsRol}
                value={rol}
                onValueChange={(v) => setRol(v ?? 'cajero')}
                disabled={crear.isPending}
              >
                <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
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
            </div>
          </div>

          {email.length > 0 && !emailValido && (
            <p className="text-xs text-[#c43e2c]">
              Ingresá un email válido.
            </p>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={crear.isPending}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeCrear}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {crear.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creando…
              </>
            ) : (
              'Crear usuario'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
