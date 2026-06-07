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
import { useCreateCliente, useUpdateCliente } from '@/lib/hooks/useClientes'
import type { ClienteRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Cliente a editar; null/undefined = alta de uno nuevo. */
  cliente?: ClienteRow | null
  /** Se llama con el cliente recién creado (útil para seleccionarlo al toque). */
  onCreado?: (cliente: ClienteRow) => void
}

export function ModalCliente({
  abierto,
  onCambioAbierto,
  cliente,
  onCreado,
}: Props) {
  const crear = useCreateCliente()
  const actualizar = useUpdateCliente()
  const editando = !!cliente

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [documento, setDocumento] = useState('')
  const [direccion, setDireccion] = useState('')
  const [notas, setNotas] = useState('')

  useEffect(() => {
    if (abierto) {
      setNombre(cliente?.nombre ?? '')
      setTelefono(cliente?.telefono ?? '')
      setEmail(cliente?.email ?? '')
      setDocumento(cliente?.documento ?? '')
      setDireccion(cliente?.direccion ?? '')
      setNotas(cliente?.notas ?? '')
    }
  }, [abierto, cliente])

  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar =
    nombre.trim().length > 0 && documento.trim().length > 0 && !procesando

  function guardar() {
    if (!puedeGuardar) return
    const datos = {
      nombre: nombre.trim(),
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      documento: documento.trim() || null,
      direccion: direccion.trim() || null,
      notas: notas.trim() || null,
    }
    if (editando && cliente) {
      actualizar.mutate(
        { id: cliente.id, datos },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(datos, {
        onSuccess: (nuevo) => {
          onCreado?.(nuevo)
          onCambioAbierto(false)
        },
      })
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
            {editando ? 'Editar cliente' : 'Nuevo cliente'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Datos de contacto para el historial de compras.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nombre y apellido <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: María González"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Teléfono
              </Label>
              <Input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="380 1234567"
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                DNI / CUIT <span className="text-[#c43e2c]">*</span>
              </Label>
              <Input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="Obligatorio"
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Email
            </Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Opcional"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Dirección
            </Label>
            <Input
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Opcional"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Notas
            </Label>
            <Input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Preferencias, observaciones…"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
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
              'Crear cliente'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
