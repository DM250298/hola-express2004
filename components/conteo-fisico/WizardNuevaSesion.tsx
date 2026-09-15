'use client'

import { useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAbrirSesionConteo } from '@/lib/hooks/useConteoFisico'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import { useArbolUbicaciones } from '@/lib/hooks/useMapa'
import { rutaUbicacion } from '@/lib/queries/ubicaciones'

const SIN_RESPONSABLE = '__sin__'
const SIN_UBICACION = '__sin__'

interface ZonaBorrador {
  nombre: string
  responsable: string
  /** Nodo del mapa (mig 176). SIN_UBICACION = zona sin anclar. */
  ubicacion: string
}

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

/** Wizard de sesión nueva: nombre → zonas con responsable → confirmar y abrir. */
export function WizardNuevaSesion({ abierto, onCambioAbierto }: Props) {
  const [nombre, setNombre] = useState('')
  const [umbral, setUmbral] = useState('5000')
  const [notas, setNotas] = useState('')
  const [zonas, setZonas] = useState<ZonaBorrador[]>([
    { nombre: '', responsable: SIN_RESPONSABLE, ubicacion: SIN_UBICACION },
  ])

  const { data: usuarios } = useUsuariosActivos()
  const { data: arbol } = useArbolUbicaciones()
  const abrir = useAbrirSesionConteo()

  const itemsResponsable: Record<string, string> = {
    [SIN_RESPONSABLE]: 'Sin asignar (la toma quien la inicia)',
    ...Object.fromEntries((usuarios ?? []).map((u) => [u.id, u.nombre])),
  }

  // Anclar la zona a un nodo del mapa (mig 176): opcional; con ancla, al
  // cerrar la zona los productos contados quedan asignados en el mapa.
  const hayMapa = !!arbol && arbol.planas.length > 0
  const itemsUbicacion: Record<string, string> = {
    [SIN_UBICACION]: 'Sin anclar al mapa',
    ...Object.fromEntries(
      (arbol?.planas ?? [])
        .filter((u) => u.activo && u.tipo !== 'sucursal')
        .map((u) => [String(u.id), rutaUbicacion(u.id, arbol?.planas ?? [])])
        .sort((a, b) => a[1].localeCompare(b[1], 'es-AR'))
    ),
  }

  function actualizarZona(indice: number, cambio: Partial<ZonaBorrador>) {
    setZonas((prev) =>
      prev.map((z, i) => (i === indice ? { ...z, ...cambio } : z))
    )
  }

  function confirmar() {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) {
      toast.error('Poné un nombre a la sesión (ej. "Inventario Julio 2026").')
      return
    }
    const zonasValidas = zonas
      .map((z, i) => ({
        nombre: z.nombre.trim(),
        responsable_user_id:
          z.responsable === SIN_RESPONSABLE ? null : z.responsable,
        orden: i,
        ubicacion_id:
          z.ubicacion === SIN_UBICACION
            ? null
            : Number.parseInt(z.ubicacion, 10) || null,
      }))
      .filter((z) => z.nombre !== '')
    if (zonasValidas.length === 0) {
      toast.error('Definí al menos una zona (góndolas, heladeras, depósito…).')
      return
    }
    const umbralNumero = Number(umbral)
    abrir.mutate(
      {
        nombre: nombreLimpio,
        umbral: Number.isFinite(umbralNumero) && umbralNumero > 0 ? umbralNumero : 5000,
        zonas: zonasValidas,
        notas: notas.trim() === '' ? null : notas.trim(),
      },
      {
        onSuccess: () => {
          onCambioAbierto(false)
          setNombre('')
          setNotas('')
          setZonas([
            { nombre: '', responsable: SIN_RESPONSABLE, ubicacion: SIN_UBICACION },
          ])
        },
      }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !abrir.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            Nueva sesión de conteo
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Al abrirla se toma la foto del stock teórico de todos los
            productos. Se puede contar con el local vendiendo: las ventas se
            compensan solas.
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
            <Label className="text-[#391511]">Zonas a contar</Label>
            <p className="text-xs text-[#6f3a2a]">
              Góndolas, heladeras, fiambrería, depósito, trastienda,
              exhibidores de caja… Un producto puede aparecer en varias zonas:
              el total es la suma. Si anclás la zona al mapa del local, al
              cerrarla los productos contados quedan ubicados solos.
            </p>
            <div className="space-y-2">
              {zonas.map((zona, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-xl border border-[#e4c9b0]/50 p-2 sm:flex-row sm:items-center sm:border-0 sm:p-0"
                >
                  <Input
                    value={zona.nombre}
                    onChange={(e) => actualizarZona(i, { nombre: e.target.value })}
                    placeholder={`Zona ${i + 1} (ej: Góndola ${i + 1})`}
                    className="border-[#e4c9b0] sm:flex-1"
                  />
                  <div className="flex items-center gap-2">
                    <Select
                      value={zona.responsable}
                      onValueChange={(v) =>
                        actualizarZona(i, { responsable: String(v ?? SIN_RESPONSABLE) })
                      }
                      items={itemsResponsable}
                    >
                      <SelectTrigger className="h-9 flex-1 border-[#e4c9b0] sm:w-44 sm:flex-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(itemsResponsable).map(([valor, etiqueta]) => (
                          <SelectItem key={valor} value={valor}>
                            {etiqueta}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {hayMapa && (
                      <Select
                        value={zona.ubicacion}
                        onValueChange={(v) =>
                          actualizarZona(i, { ubicacion: String(v ?? SIN_UBICACION) })
                        }
                        items={itemsUbicacion}
                      >
                        <SelectTrigger className="h-9 flex-1 border-[#e4c9b0] sm:w-44 sm:flex-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(itemsUbicacion).map(([valor, etiqueta]) => (
                            <SelectItem key={valor} value={valor}>
                              {etiqueta}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <button
                      type="button"
                      onClick={() => setZonas((prev) => prev.filter((_, j) => j !== i))}
                      disabled={zonas.length === 1}
                      className="shrink-0 rounded-lg p-2 text-[#c43e2c] transition hover:bg-[#c43e2c]/10 disabled:opacity-30"
                      aria-label="Quitar zona"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setZonas((prev) => [
                  ...prev,
                  { nombre: '', responsable: SIN_RESPONSABLE, ubicacion: SIN_UBICACION },
                ])
              }
              className="border-[#e4c9b0] text-[#6f3a2a]"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Agregar zona
            </Button>
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
            disabled={abrir.isPending}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={abrir.isPending}
            className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            {abrir.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar y abrir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
