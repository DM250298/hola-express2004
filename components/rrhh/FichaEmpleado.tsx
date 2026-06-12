'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Camera, KeyRound, Loader2, Pencil } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { ModalEmpleado } from './ModalEmpleado'
import { ModalPin } from './ModalPin'
import { TabDatosEmpleado } from './TabDatosEmpleado'
import { TabDocumentosEmpleado } from './TabDocumentosEmpleado'
import { CalendarioAsistencia } from './CalendarioAsistencia'
import { UNIDADES_NEGOCIO, iniciales, nombreCompleto } from './constantes'
import { useEmpleado, useSubirFoto } from '@/lib/hooks/useRrhh'
import { cn } from '@/lib/utils'

interface Props {
  empleadoId: number
  puedeVerSueldos: boolean
}

const claseTab = 'data-active:bg-[#f9b44c]/20 data-active:text-[#391511]'

export function FichaEmpleado({ empleadoId, puedeVerSueldos }: Props) {
  const { data: empleado, isLoading, isError } = useEmpleado(empleadoId)
  const subirFoto = useSubirFoto()
  const inputFoto = useRef<HTMLInputElement>(null)
  const [editar, setEditar] = useState(false)
  const [pinAbierto, setPinAbierto] = useState(false)

  function onElegirFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    if (!archivo.type.startsWith('image/')) {
      toast.error('El archivo debe ser una imagen.')
      return
    }
    if (archivo.size > 5 * 1024 * 1024) {
      toast.error('La imagen no puede superar los 5 MB.')
      return
    }
    subirFoto.mutate({ empleadoId, archivo })
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <Skeleton className="h-8 w-40 bg-[#f9d2a2]/40" />
        <Skeleton className="h-28 w-full rounded-2xl bg-[#f9d2a2]/30" />
        <Skeleton className="h-64 w-full rounded-2xl bg-[#f9d2a2]/20" />
      </div>
    )
  }

  if (isError || !empleado) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <Link
          href="/rrhh"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'text-[#6f3a2a] gap-1.5'
          )}
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
        <div className="p-10 text-center text-[#c43e2c] text-sm bg-white border border-[#e4c9b0]/60 rounded-2xl">
          No se encontró el empleado.
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <Link
        href="/rrhh"
        className={cn(
          buttonVariants({ variant: 'ghost', size: 'sm' }),
          'text-[#6f3a2a] gap-1.5 -ml-2'
        )}
      >
        <ArrowLeft className="h-4 w-4" />
        Volver a empleados
      </Link>

      {/* Cabecera */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5 flex items-center gap-5 flex-wrap">
        <div className="relative">
          <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-[#f9d2a2]/50 text-[#6f3a2a] text-2xl font-bold overflow-hidden">
            {empleado.foto_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={empleado.foto_url}
                alt={nombreCompleto(empleado)}
                className="h-full w-full object-cover"
              />
            ) : (
              iniciales(empleado)
            )}
          </span>
          <button
            type="button"
            onClick={() => inputFoto.current?.click()}
            disabled={subirFoto.isPending}
            className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] flex items-center justify-center shadow disabled:opacity-60"
            aria-label="Cambiar foto"
          >
            {subirFoto.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
          </button>
          <input
            ref={inputFoto}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onElegirFoto}
          />
        </div>

        <div className="flex-1 min-w-[200px]">
          <h1 className="text-[#391511] text-xl font-bold flex items-center gap-2 flex-wrap">
            {nombreCompleto(empleado)}
            <span
              className={cn(
                'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full',
                empleado.activo
                  ? 'bg-[#2f7d4f]/15 text-[#2f7d4f]'
                  : 'bg-[#c43e2c]/15 text-[#c43e2c]'
              )}
            >
              {empleado.activo ? 'Activo' : 'Baja'}
            </span>
          </h1>
          <p className="text-[#6f3a2a] text-sm mt-0.5">
            <span className="font-semibold tabular-nums">{empleado.legajo}</span>
            {' · '}
            {empleado.puesto || 'Sin puesto'}
            {' · '}
            {UNIDADES_NEGOCIO[empleado.unidad_negocio]}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setPinAbierto(true)}
            className="border-[#e4c9b0] text-[#6f3a2a] gap-1.5"
          >
            <KeyRound className="h-4 w-4" />
            PIN
          </Button>
          <Button
            onClick={() => setEditar(true)}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
        </div>
      </div>

      {/* Tabs de la ficha */}
      <Tabs defaultValue="datos" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger value="datos" className={claseTab}>
            Datos
          </TabsTrigger>
          <TabsTrigger value="documentos" className={claseTab}>
            Documentos
          </TabsTrigger>
          <TabsTrigger value="asistencia" className={claseTab}>
            Asistencia
          </TabsTrigger>
          <TabsTrigger value="tareas" disabled className={claseTab}>
            Tareas
          </TabsTrigger>
          {puedeVerSueldos && (
            <TabsTrigger value="liquidaciones" disabled className={claseTab}>
              Liquidaciones
            </TabsTrigger>
          )}
          <TabsTrigger value="desempeno" disabled className={claseTab}>
            Desempeño
          </TabsTrigger>
        </TabsList>

        <TabsContent value="datos">
          <TabDatosEmpleado
            empleado={empleado}
            puedeVerSueldos={puedeVerSueldos}
          />
        </TabsContent>
        <TabsContent value="documentos">
          <TabDocumentosEmpleado empleadoId={empleado.id} />
        </TabsContent>
        <TabsContent value="asistencia">
          <CalendarioAsistencia empleadoId={empleado.id} />
        </TabsContent>
      </Tabs>

      <ModalEmpleado
        abierto={editar}
        onCambioAbierto={setEditar}
        empleado={empleado}
        puedeVerSueldos={puedeVerSueldos}
      />
      <ModalPin
        abierto={pinAbierto}
        onCambioAbierto={setPinAbierto}
        empleadoId={empleado.id}
        nombre={nombreCompleto(empleado)}
      />
    </div>
  )
}
