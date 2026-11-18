'use client'

import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, Play } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  useAbrirSesionConteo,
  useProgramarSesionConteo,
} from '@/lib/hooks/useConteoFisico'
import { aTareasNuevas, type TareaBorrador } from '@/lib/conteo/tareas'
import {
  ESPERA_MAX_MIN,
  fechaHoraPorDefecto,
  partesAr,
  validarProgramacion,
} from '@/lib/conteo/programacion'
import { ConstructorTareas } from './ConstructorTareas'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** Con una sesión en curso solo se puede dejar programada la próxima. */
  haySesionActiva: boolean
}

type Cuando = 'ahora' | 'programada'

/**
 * Sesión nueva: nombre → tareas (por área, proveedor, clase ABC, categoría,
 * marca, alertas o combinadas) con quién cuenta cada una → abrir ahora o
 * dejarla programada con fecha y hora (migs 330 a 333): a esa hora el sistema
 * toma la foto del stock, arma las listas y la abre solo.
 */
export function WizardNuevaSesion({ abierto, onCambioAbierto, haySesionActiva }: Props) {
  const [nombre, setNombre] = useState('')
  const [umbral, setUmbral] = useState('5000')
  const [notas, setNotas] = useState('')
  const [tareas, setTareas] = useState<TareaBorrador[]>([])
  const [tareasValidas, setTareasValidas] = useState(false)
  const [cuando, setCuando] = useState<Cuando>('ahora')
  const [fecha, setFecha] = useState('')
  const [hora, setHora] = useState('')

  const abrir = useAbrirSesionConteo()
  const programar = useProgramarSesionConteo()
  const enviando = abrir.isPending || programar.isPending

  // Al abrir el diálogo: con sesión en curso solo queda programar, y la fecha
  // propuesta es mañana a las 07:00 (arranque del turno mañana).
  useEffect(() => {
    if (!abierto) return
    setCuando(haySesionActiva ? 'programada' : 'ahora')
    const sugerida = fechaHoraPorDefecto(Date.now())
    setFecha(sugerida.fecha)
    setHora(sugerida.hora)
  }, [abierto, haySesionActiva])

  const programada = cuando === 'programada'
  const validacion = validarProgramacion(fecha, hora, Date.now())
  const hoyAr = partesAr(Date.now()).fecha

  function limpiar() {
    onCambioAbierto(false)
    setNombre('')
    setNotas('')
    setTareas([])
  }

  function confirmar() {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) {
      toast.error('Poné un nombre a la sesión (ej. "Inventario Julio 2026").')
      return
    }
    if (tareas.length === 0) {
      toast.error('Armá al menos una tarea: qué se cuenta y quién lo cuenta.')
      return
    }
    const umbralNumero = Number(umbral)
    const base = {
      nombre: nombreLimpio,
      umbral: Number.isFinite(umbralNumero) && umbralNumero > 0 ? umbralNumero : 5000,
      zonas: aTareasNuevas(tareas),
      notas: notas.trim() === '' ? null : notas.trim(),
    }
    if (programada) {
      if (!validacion.ok) {
        toast.error(validacion.motivo)
        return
      }
      programar.mutate({ ...base, programada_para: validacion.iso }, { onSuccess: limpiar })
      return
    }
    abrir.mutate(base, { onSuccess: limpiar })
  }

  const etiquetaBoton = programada
    ? validacion.ok
      ? `Programar para el ${format(new Date(validacion.iso), "EEE d/M 'a las' HH:mm", { locale: es })}`
      : 'Programar'
    : 'Confirmar y abrir'

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !enviando && onCambioAbierto(v)}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            Nueva sesión de conteo
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Al abrirla se toma la foto del stock teórico de todos los
            productos. Se puede contar con el local vendiendo: las ventas se
            compensan solas. Lo que no entre en ninguna tarea no se toca.
            También se puede dejar programada con fecha y hora: se abre sola.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="conteo-nombre" className="text-[#391511]">
              Nombre de la sesión
            </Label>
            <Input
              id="conteo-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder='Ej: "Inventario Julio 2026"'
              className="border-[#e4c9b0]"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511]">Tareas de conteo</Label>
            {/* Se monta recién con el diálogo abierto: la vista previa
                consulta la base y no tiene sentido pedirla con esto cerrado. */}
            {abierto && (
              <ConstructorTareas
                borradores={tareas}
                onCambio={setTareas}
                onValidez={setTareasValidas}
                simularSesionNueva={programada || haySesionActiva}
              />
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-[#391511]">¿Cuándo se abre?</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={!programada}
                disabled={haySesionActiva}
                onClick={() => setCuando('ahora')}
                className={cn(
                  'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold',
                  !programada
                    ? 'border-[#f9b44c] bg-[#f9b44c] text-[#391511]'
                    : 'border-[#e4c9b0] bg-[#fdfaf6] text-[#6f3a2a]',
                  haySesionActiva && 'cursor-not-allowed opacity-50'
                )}
              >
                <Play className="h-4 w-4" />
                Abrir ahora
              </button>
              <button
                type="button"
                aria-pressed={programada}
                onClick={() => setCuando('programada')}
                className={cn(
                  'flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold',
                  programada
                    ? 'border-[#f9b44c] bg-[#f9b44c] text-[#391511]'
                    : 'border-[#e4c9b0] bg-[#fdfaf6] text-[#6f3a2a]'
                )}
              >
                <CalendarClock className="h-4 w-4" />
                Programar
              </button>
            </div>
            {haySesionActiva && (
              <p className="text-xs text-[#6f3a2a]">
                Hay una sesión en curso: esta queda programada y se abre sola a
                la hora elegida.
              </p>
            )}
            {programada && (
              <div className="space-y-2 rounded-xl border border-[#e4c9b0]/70 bg-[#fdfaf6] p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="conteo-fecha" className="text-xs text-[#6f3a2a]">
                      Día
                    </Label>
                    <Input
                      id="conteo-fecha"
                      type="date"
                      min={hoyAr}
                      value={fecha}
                      onChange={(e) => setFecha(e.target.value)}
                      className="border-[#e4c9b0] bg-white tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="conteo-hora" className="text-xs text-[#6f3a2a]">
                      Hora
                    </Label>
                    <Input
                      id="conteo-hora"
                      type="time"
                      value={hora}
                      onChange={(e) => setHora(e.target.value)}
                      className="border-[#e4c9b0] bg-white tabular-nums"
                    />
                  </div>
                </div>
                {!validacion.ok && (
                  <p className="text-xs font-semibold text-[#c43e2c]">{validacion.motivo}</p>
                )}
                <p className="text-xs text-[#6f3a2a]">
                  A esa hora se toma la foto del stock y se arman las listas con
                  lo que haya en ese momento; los números de arriba son de hoy.
                  Si a esa hora hay otra sesión en curso, espera hasta{' '}
                  {ESPERA_MAX_MIN} minutos y, si no se libera, queda marcada
                  para abrirla a mano.
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="conteo-umbral" className="text-[#391511]">
                Umbral de diferencia relevante ($)
              </Label>
              <Input
                id="conteo-umbral"
                type="number"
                min="0"
                inputMode="numeric"
                value={umbral}
                onChange={(e) => setUmbral(e.target.value)}
                className="border-[#e4c9b0]"
              />
              <p className="text-xs text-[#6f3a2a]">
                Se marca para revisar si la diferencia supera el 5% del teórico
                o este monto a costo.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conteo-notas" className="text-[#391511]">
                Notas (opcional)
              </Label>
              <Input
                id="conteo-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                placeholder="Visible para el equipo"
                className="border-[#e4c9b0]"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={enviando}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={enviando || !tareasValidas || (programada && !validacion.ok)}
            className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {etiquetaBoton}
            {tareas.length > 0 && ` (${tareas.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
