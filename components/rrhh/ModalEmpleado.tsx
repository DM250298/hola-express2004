'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateEmpleado, useUpdateEmpleado } from '@/lib/hooks/useRrhh'
import { TIPOS_CONTRATO, UNIDADES_NEGOCIO } from './constantes'
import type {
  EmpleadoConSueldo,
  EmpleadoInsert,
  TipoContrato,
  UnidadNegocio,
} from '@/types/database'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Empleado a editar; null = alta. */
  empleado?: EmpleadoConSueldo | null
  /** Si false, el campo de sueldo no se muestra ni se envía (encargado). */
  puedeVerSueldos: boolean
}

const claseInput = 'border-[#e4c9b0] focus-visible:ring-[#f9b44c]'

export function ModalEmpleado({
  abierto,
  onCambioAbierto,
  empleado,
  puedeVerSueldos,
}: Props) {
  const crear = useCreateEmpleado()
  const actualizar = useUpdateEmpleado()
  const editando = !!empleado

  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [dni, setDni] = useState('')
  const [cuil, setCuil] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [unidad, setUnidad] = useState<UnidadNegocio>('hola_express')
  const [puesto, setPuesto] = useState('')
  const [tipoContrato, setTipoContrato] = useState<TipoContrato>(
    'informal_a_regularizar'
  )
  const [fechaIngreso, setFechaIngreso] = useState('')
  const [sueldo, setSueldo] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [direccion, setDireccion] = useState('')
  const [cbu, setCbu] = useState('')
  const [notas, setNotas] = useState('')

  useEffect(() => {
    if (abierto) {
      setNombre(empleado?.nombre ?? '')
      setApellido(empleado?.apellido ?? '')
      setDni(empleado?.dni ?? empleado?.documento ?? '')
      setCuil(empleado?.cuil ?? '')
      setFechaNacimiento(empleado?.fecha_nacimiento ?? '')
      setUnidad(empleado?.unidad_negocio ?? 'hola_express')
      setPuesto(empleado?.puesto ?? '')
      setTipoContrato(empleado?.tipo_contrato ?? 'informal_a_regularizar')
      setFechaIngreso(empleado?.fecha_ingreso ?? '')
      setSueldo(empleado ? String(empleado.sueldo_basico) : '')
      setTelefono(empleado?.telefono ?? '')
      setEmail(empleado?.email ?? '')
      setDireccion(empleado?.direccion ?? '')
      setCbu(empleado?.banco_cbu_alias ?? '')
      setNotas(empleado?.notas ?? '')
    }
  }, [abierto, empleado])

  const procesando = crear.isPending || actualizar.isPending
  const puedeGuardar = nombre.trim().length > 0 && !procesando

  function guardar() {
    if (!puedeGuardar) return
    const datos: EmpleadoInsert = {
      nombre: nombre.trim(),
      apellido: apellido.trim() || null,
      dni: dni.trim() || null,
      cuil: cuil.trim() || null,
      fecha_nacimiento: fechaNacimiento || null,
      unidad_negocio: unidad,
      puesto: puesto.trim() || null,
      tipo_contrato: tipoContrato,
      fecha_ingreso: fechaIngreso || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      direccion: direccion.trim() || null,
      banco_cbu_alias: cbu.trim() || null,
      notas: notas.trim() || null,
    }
    // Sólo quien ve sueldos lo envía (la RLS igual lo bloquearía para otros).
    if (puedeVerSueldos) datos.sueldo_basico = Number(sueldo) || 0

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
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {editando ? 'Editar empleado' : 'Nuevo empleado'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {editando
              ? `Legajo ${empleado?.legajo}`
              : 'El legajo (EMP-001) se asigna automáticamente.'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[64vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Nombre</Label>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: Juan"
                disabled={procesando}
                className={claseInput}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Apellido</Label>
              <Input
                value={apellido}
                onChange={(e) => setApellido(e.target.value)}
                placeholder="Ej: Pérez"
                disabled={procesando}
                className={claseInput}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">DNI</Label>
              <Input
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                placeholder="Opcional"
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">CUIL</Label>
              <Input
                value={cuil}
                onChange={(e) => setCuil(e.target.value)}
                placeholder="Opcional"
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Unidad de negocio
              </Label>
              <Select
                items={UNIDADES_NEGOCIO}
                value={unidad}
                onValueChange={(v) => v && setUnidad(v as UnidadNegocio)}
                disabled={procesando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(UNIDADES_NEGOCIO).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Puesto</Label>
              <Input
                value={puesto}
                onChange={(e) => setPuesto(e.target.value)}
                placeholder="Cajero, Repositor…"
                disabled={procesando}
                className={claseInput}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Tipo de contrato
              </Label>
              <Select
                items={TIPOS_CONTRATO}
                value={tipoContrato}
                onValueChange={(v) => v && setTipoContrato(v as TipoContrato)}
                disabled={procesando}
              >
                <SelectTrigger className={`w-full ${claseInput}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPOS_CONTRATO).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {puedeVerSueldos && (
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
                    className={`pl-7 tabular-nums ${claseInput}`}
                  />
                </div>
              </div>
            )}
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
                className={`${claseInput} tabular-nums`}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Fecha de nacimiento
              </Label>
              <Input
                type="date"
                value={fechaNacimiento}
                onChange={(e) => setFechaNacimiento(e.target.value)}
                disabled={procesando}
                className={`${claseInput} tabular-nums`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Teléfono</Label>
              <Input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="Opcional"
                disabled={procesando}
                className={claseInput}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Opcional"
                disabled={procesando}
                className={claseInput}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Dirección</Label>
            <Input
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Opcional"
              disabled={procesando}
              className={claseInput}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              CBU / Alias bancario
            </Label>
            <Input
              value={cbu}
              onChange={(e) => setCbu(e.target.value)}
              placeholder="Opcional"
              disabled={procesando}
              className={claseInput}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">Notas</Label>
            <Input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones…"
              disabled={procesando}
              className={claseInput}
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
