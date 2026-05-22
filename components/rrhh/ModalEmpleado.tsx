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
import { useCreateEmpleado, useUpdateEmpleado } from '@/lib/hooks/useRrhh'
import type { EmpleadoRow } from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Empleado a editar; null = alta. */
  empleado?: EmpleadoRow | null
}

export function ModalEmpleado({ abierto, onCambioAbierto, empleado }: Props) {
  const crear = useCreateEmpleado()
  const actualizar = useUpdateEmpleado()
  const editando = !!empleado

  const [nombre, setNombre] = useState('')
  const [documento, setDocumento] = useState('')
  const [cuil, setCuil] = useState('')
  const [puesto, setPuesto] = useState('')
  const [fechaIngreso, setFechaIngreso] = useState('')
  const [sueldo, setSueldo] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [direccion, setDireccion] = useState('')
  const [notas, setNotas] = useState('')

  useEffect(() => {
    if (abierto) {
      setNombre(empleado?.nombre ?? '')
      setDocumento(empleado?.documento ?? '')
      setCuil(empleado?.cuil ?? '')
      setPuesto(empleado?.puesto ?? '')
      setFechaIngreso(empleado?.fecha_ingreso ?? '')
      setSueldo(empleado ? String(empleado.sueldo_basico) : '')
      setTelefono(empleado?.telefono ?? '')
      setEmail(empleado?.email ?? '')
      setDireccion(empleado?.direccion ?? '')
      setNotas(empleado?.notas ?? '')
    }
  }, [abierto, empleado])

  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar = nombre.trim().length > 0 && !procesando

  function guardar() {
    if (!puedeGuardar) return
    const datos = {
      nombre: nombre.trim(),
      documento: documento.trim() || null,
      cuil: cuil.trim() || null,
      puesto: puesto.trim() || null,
      fecha_ingreso: fechaIngreso || null,
      sueldo_basico: Number(sueldo) || 0,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      direccion: direccion.trim() || null,
      notas: notas.trim() || null,
    }
    if (editando && empleado) {
      actualizar.mutate(
        { id: empleado.id, datos },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(datos, { onSuccess: () => onCambioAbierto(false) })
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Editar empleado' : 'Nuevo empleado'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Legajo y sueldo básico mensual.
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nombre y apellido
            </Label>
            <Input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Juan Pérez"
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Puesto
              </Label>
              <Input
                value={puesto}
                onChange={(e) => setPuesto(e.target.value)}
                placeholder="Cajero, Repositor…"
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Sueldo básico
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#c8a58a] text-sm">
                  $
                </span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={sueldo}
                  onChange={(e) => setSueldo(e.target.value)}
                  placeholder="0,00"
                  disabled={procesando}
                  className="pl-7 tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                DNI
              </Label>
              <Input
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                placeholder="Opcional"
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                CUIL
              </Label>
              <Input
                value={cuil}
                onChange={(e) => setCuil(e.target.value)}
                placeholder="Opcional"
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Fecha de ingreso
              </Label>
              <Input
                type="date"
                value={fechaIngreso}
                onChange={(e) => setFechaIngreso(e.target.value)}
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Teléfono
              </Label>
              <Input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="Opcional"
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Email</Label>
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
            <Label className="text-[#391511] font-medium text-sm">Notas</Label>
            <Input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones…"
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
              'Crear empleado'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
