import Link from 'next/link'
import {
  Boxes,
  CalendarCheck,
  ChevronRight,
  ClipboardList,
  MapPin,
  Truck,
} from 'lucide-react'
import { tienePermiso } from '@/lib/permisos'

interface ZonaConteoMovil {
  id: number
  nombre: string
  estado: string
}

interface Props {
  nombre: string
  permisos: string[]
  /** Pedidos en estado enviado / recepción parcial, para el badge. */
  pedidosPendientes: number
  /** Si el usuario tiene legajo de empleado (para mostrar "Mi panel"). */
  tienePanel: boolean
  /** Sesión de conteo físico en curso con las zonas del usuario (o null). */
  conteoFisico?: {
    nombre: string
    zonas: ZonaConteoMovil[]
  } | null
}

const ESTADO_ZONA: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-[#e4c9b0]/50 text-[#6f3a2a]' },
  en_curso: { texto: 'En curso', clase: 'bg-[#f9b44c]/25 text-[#a3641c]' },
  cerrada: { texto: 'Cerrada', clase: 'bg-[#2f7d4f]/15 text-[#2f7d4f]' },
}

/**
 * Pantalla de inicio del modo móvil de la encargada: saludo + accesos grandes
 * a las dos acciones críticas (contar stock y recibir pedido) según permisos,
 * más un acceso a su panel de asistencia.
 */
export function HubMovil({
  nombre,
  permisos,
  pedidosPendientes,
  tienePanel,
  conteoFisico,
}: Props) {
  const puedeContar =
    tienePermiso(permisos, 'inventario_ajustes') ||
    tienePermiso(permisos, 'conteo_gestion')
  const puedeRecibir =
    tienePermiso(permisos, 'recepcion') || tienePermiso(permisos, 'pedidos')
  const primerNombre = nombre.split(' ')[0]

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-[#391511]">
          Hola, {primerNombre} 👋
        </h1>
        <p className="text-sm text-[#6f3a2a]">¿Qué querés hacer hoy?</p>
      </div>

      {conteoFisico && conteoFisico.zonas.length > 0 && (
        <div className="rounded-2xl border border-[#f9b44c] bg-[#f9b44c]/10 p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f9b44c]/25 text-[#a3641c]">
              <ClipboardList className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-bold text-[#391511]">Conteo físico en curso</p>
              <p className="truncate text-xs text-[#6f3a2a]">
                {conteoFisico.nombre} · tocá tu zona para contar
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {conteoFisico.zonas.map((zona) => {
              const est = ESTADO_ZONA[zona.estado] ?? ESTADO_ZONA.pendiente
              return (
                <Link
                  key={zona.id}
                  href={`/inventario/conteo/zona/${zona.id}`}
                  className="flex items-center gap-3 rounded-xl border border-[#e4c9b0]/70 bg-white px-3 py-3 transition active:scale-[0.99]"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-[#a3641c]" />
                  <span className="min-w-0 flex-1 truncate font-medium text-[#391511]">
                    {zona.nombre}
                  </span>
                  <span
                    className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-semibold ${est.clase}`}
                  >
                    {est.texto}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#c8a58a]" />
                </Link>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {puedeContar && (
          <Link
            href="/movil/conteo"
            className="group flex items-center gap-4 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm transition active:scale-[0.99]"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#f9b44c]/20 text-[#9e6b15]">
              <Boxes className="h-7 w-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold text-[#391511]">
                Contar stock
              </span>
              <span className="block text-xs text-[#6f3a2a]">
                Escaneá con la cámara y ajustá el stock
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-[#c8a58a]" />
          </Link>
        )}

        {puedeRecibir && (
          <Link
            href="/movil/recepcion"
            className="group flex items-center gap-4 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm transition active:scale-[0.99]"
          >
            <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#2f7d4f]/15 text-[#2f7d4f]">
              <Truck className="h-7 w-7" />
              {pedidosPendientes > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#c43e2c] px-1.5 text-xs font-bold text-white">
                  {pedidosPendientes}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold text-[#391511]">
                Recibir pedido
              </span>
              <span className="block text-xs text-[#6f3a2a]">
                {pedidosPendientes > 0
                  ? `${pedidosPendientes} pedido${
                      pedidosPendientes === 1 ? '' : 's'
                    } esperando recepción`
                  : 'Escaneá la mercadería que llega'}
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-[#c8a58a]" />
          </Link>
        )}

        {tienePanel && (
          <Link
            href="/movil/panel"
            className="group flex items-center gap-4 rounded-2xl border border-[#e4c9b0]/70 bg-white p-4 shadow-sm transition active:scale-[0.99]"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#391511]/10 text-[#391511]">
              <CalendarCheck className="h-7 w-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-lg font-bold text-[#391511]">
                Mi panel
              </span>
              <span className="block text-xs text-[#6f3a2a]">
                Asistencia, tareas y desempeño del mes
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-[#c8a58a]" />
          </Link>
        )}
      </div>
    </section>
  )
}
