'use client'

import { useEffect, useState } from 'react'
import { useArbolUbicaciones } from '@/lib/hooks/useMapa'
import { getUbicacionesProducto, heredado } from '@/lib/queries/ubicaciones'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrearTareaAlertas } from '@/lib/hooks/useAlertas'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import type { Alerta, PrioridadTarea } from '@/lib/queries/alertas'
import { hoyIso, isoMasDias } from '@/lib/utils/periodos'
import { conCantidad, descripcionTareaSugerida, tituloTareaSugerido } from './presentacion'

const CLASE_CAMPO =
  'w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-[#391511] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * La decisión "hacer algo": UNA tarea con responsable para las alertas
 * elegidas. Plazo y prioridad se sugieren por la severidad más alta.
 */
export function ModalTareaAlertas({
  alertas,
  onCerrar,
  onListo,
}: {
  alertas: Alerta[]
  onCerrar: () => void
  onListo: () => void
}) {
  const hayCritica = alertas.some((a) => a.severidad === 'critico')
  const hayAtencion = alertas.some((a) => a.severidad === 'atencion')

  const [titulo, setTitulo] = useState(() => tituloTareaSugerido(alertas))
  const [descripcion, setDescripcion] = useState(() => descripcionTareaSugerida(alertas))
  const [responsableId, setResponsableId] = useState('')
  const [fechaLimite, setFechaLimite] = useState(() =>
    isoMasDias(hoyIso(), hayCritica ? 0 : hayAtencion ? 2 : 7)
  )
  const [prioridad, setPrioridad] = useState<PrioridadTarea>(
    hayCritica ? 'alta' : hayAtencion ? 'media' : 'baja'
  )

  const { data: usuarios, isLoading: cargandoUsuarios } = useUsuariosActivos()
  const { data: arbol } = useArbolUbicaciones()

  // Responsable sugerido: el del espacio donde vive el primer producto
  // (heredado de la góndola o el sector). Se puede cambiar.
  const primerProducto = alertas.find((a) => a.producto_id != null)?.producto_id ?? null
  useEffect(() => {
    if (!arbol || primerProducto == null) return
    let cancelado = false
    getUbicacionesProducto(primerProducto)
      .then((filas) => {
        const principal = (filas ?? []).find((f) => f.es_principal)
        if (!principal || cancelado) return
        const sugerido = heredado(principal.ubicacion_id, arbol.planas, 'responsable_id')
        if (sugerido) setResponsableId((actual) => actual || sugerido)
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [arbol, primerProducto])
  const crear = useCrearTareaAlertas()

  const puedeGuardar = titulo.trim() !== '' && responsableId !== '' && !crear.isPending

  const guardar = () => {
    crear.mutate(
      {
        alertaIds: alertas.map((a) => a.id),
        titulo: titulo.trim(),
        descripcion,
        responsableId,
        fechaLimite: fechaLimite || null,
        prioridad,
      },
      { onSuccess: onListo }
    )
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear tarea</DialogTitle>
          <DialogDescription>
            Para {conCantidad(alertas.length, 'alerta', 'alertas')}. Cuando el problema
            desaparezca, las alertas se marcan resueltas solas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="tarea-titulo">Qué hay que hacer</Label>
            <Input
              id="tarea-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="tarea-responsable">Responsable</Label>
            <select
              id="tarea-responsable"
              value={responsableId}
              onChange={(e) => setResponsableId(e.target.value)}
              className={CLASE_CAMPO}
              disabled={cargandoUsuarios}
            >
              <option value="">{cargandoUsuarios ? 'Cargando…' : 'Elegí quién lo hace'}</option>
              {(usuarios ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="tarea-fecha">Para cuándo</Label>
              <Input
                id="tarea-fecha"
                type="date"
                value={fechaLimite}
                onChange={(e) => setFechaLimite(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tarea-prioridad">Prioridad</Label>
              <select
                id="tarea-prioridad"
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value as PrioridadTarea)}
                className={CLASE_CAMPO}
              >
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tarea-descripcion">Detalle</Label>
            <textarea
              id="tarea-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              rows={8}
              className={`${CLASE_CAMPO} resize-y font-mono text-xs leading-relaxed`}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onCerrar} disabled={crear.isPending}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={!puedeGuardar}>
            {crear.isPending ? 'Creando…' : 'Crear tarea'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
