'use client'

import { useState } from 'react'
import { ClipboardCheck, ClipboardList, Eye, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ModalNuevoConteo } from './ModalNuevoConteo'
import { DrawerConteo } from './DrawerConteo'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { useConteos } from '@/lib/hooks/useConteos'
import { formatearFechaHora } from '@/lib/utils/formato'
import { tienePermiso } from '@/lib/permisos'
import { cn } from '@/lib/utils'
import type { EstadoConteo } from '@/types/database'

const ESTADO_INFO: Record<
  EstadoConteo,
  { etiqueta: string; clase: string }
> = {
  pendiente: {
    etiqueta: 'Pendiente de contar',
    clase: 'bg-[#f9b44c]/20 text-[#6f3a2a]',
  },
  contado: {
    etiqueta: 'Contado — falta aprobar',
    clase: 'bg-[#3b82f6]/15 text-[#1e5fb0]',
  },
  aprobado: {
    etiqueta: 'Aprobado',
    clase: 'bg-[#2f8f4e]/15 text-[#2f8f4e]',
  },
}

export function TabConteo() {
  const { data: usuario } = useUsuario()
  const { data: conteos, isLoading } = useConteos()
  const [modalNuevo, setModalNuevo] = useState(false)
  const [conteoAbierto, setConteoAbierto] = useState<number | null>(null)

  const esAdmin = tienePermiso(usuario?.permisos, 'conteo_gestion')

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold text-lg">
            Conteos de mercadería
          </h2>
          <p className="text-[#6f3a2a] text-sm">
            Asigná conteos a los empleados; al aprobarlos se ajusta el stock.
          </p>
        </div>
        {esAdmin && (
          <Button
            onClick={() => setModalNuevo(true)}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nuevo conteo
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : !conteos || conteos.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
          <ClipboardList className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
          <p className="text-[#391511] font-semibold">
            No hay conteos todavía
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            {esAdmin
              ? 'Creá un conteo y asignáselo a un empleado.'
              : 'Cuando te asignen un conteo va a aparecer acá.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {conteos.map((c) => {
            const info = ESTADO_INFO[c.estado]
            const esAsignado = usuario?.id === c.usuario_asignado
            const puedeContar = c.estado === 'pendiente' && esAsignado
            const puedeAprobar = c.estado === 'contado' && esAdmin
            return (
              <li
                key={c.id}
                className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 flex items-center gap-3 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[#391511]">
                      {c.nombre}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded',
                        info.clase
                      )}
                    >
                      {info.etiqueta}
                    </span>
                  </div>
                  <div className="text-xs text-[#6f3a2a] mt-0.5">
                    {c.total_items} productos · Asignado a{' '}
                    <span className="font-medium">
                      {c.asignado_nombre ?? '—'}
                    </span>{' '}
                    · {formatearFechaHora(c.fecha_creacion)}
                  </div>
                </div>

                <Button
                  variant={puedeContar || puedeAprobar ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setConteoAbierto(c.id)}
                  className={cn(
                    'gap-1.5',
                    puedeContar &&
                      'bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold',
                    puedeAprobar &&
                      'bg-[#2f8f4e] hover:bg-[#267a42] text-white font-semibold',
                    !puedeContar &&
                      !puedeAprobar &&
                      'border-[#e4c9b0] text-[#6f3a2a]'
                  )}
                >
                  {puedeContar ? (
                    <>
                      <ClipboardList className="h-3.5 w-3.5" />
                      Contar
                    </>
                  ) : puedeAprobar ? (
                    <>
                      <ClipboardCheck className="h-3.5 w-3.5" />
                      Revisar y aprobar
                    </>
                  ) : (
                    <>
                      <Eye className="h-3.5 w-3.5" />
                      Ver
                    </>
                  )}
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <ModalNuevoConteo abierto={modalNuevo} onCambioAbierto={setModalNuevo} />
      <DrawerConteo
        conteoId={conteoAbierto}
        onCambioAbierto={(v) => !v && setConteoAbierto(null)}
      />
    </div>
  )
}
