import Link from 'next/link'
import { Boxes, ChevronRight, Truck } from 'lucide-react'
import { tienePermiso } from '@/lib/permisos'

interface Props {
  nombre: string
  permisos: string[]
  /** Pedidos en estado enviado / recepción parcial, para el badge. */
  pedidosPendientes: number
}

/**
 * Pantalla de inicio del modo móvil de la encargada: saludo + accesos grandes
 * a las dos acciones críticas (contar stock y recibir pedido) según permisos.
 */
export function HubMovil({ nombre, permisos, pedidosPendientes }: Props) {
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
      </div>
    </section>
  )
}
