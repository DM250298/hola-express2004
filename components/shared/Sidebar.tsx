'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  FolderKanban,
  CalendarCheck,
  ShoppingCart,
  ShoppingBag,
  FileText,
  Receipt,
  Users,
  Package,
  CalendarX,
  Tag,
  DollarSign,
  Calculator,
  BarChart3,
  Briefcase,
  CreditCard,
  Settings,
  ChefHat,
  ChevronDown,
  UserRound,
  ClipboardList,
  ListChecks,
  ArrowLeftRight,
  Smartphone,
  Map,
  TrendingUp,
  BellRing,
  Truck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MENU_ACTIVO,
  esItemActivo,
  menuVisible,
  todosLosItems,
  type IconoNav,
  type ItemNav,
} from '@/lib/config/navegacion'
import { BadgeProduccionPendiente } from '@/components/produccion/BadgeProduccionPendiente'

// Las secciones, los items y sus permisos viven en lib/config/navegacion.ts
// (MENU_PILARES elige entre el menú por pilares y el anterior).
const ICONOS: Record<IconoNav, React.ElementType> = {
  UserRound,
  ListChecks,
  ArrowLeftRight,
  Smartphone,
  LayoutDashboard,
  CalendarCheck,
  FolderKanban,
  TrendingUp,
  BellRing,
  BarChart3,
  ShoppingCart,
  Receipt,
  Users,
  Package,
  CalendarX,
  ClipboardList,
  Map,
  ChefHat,
  Tag,
  ShoppingBag,
  FileText,
  Truck,
  DollarSign,
  Calculator,
  Briefcase,
  CreditCard,
  Settings,
}

const TODOS_LOS_ITEMS = todosLosItems(MENU_ACTIVO)

const LS_SECCIONES = 'hola-sidebar-secciones-colapsadas'

interface SidebarProps {
  permisos: string[]
  /**
   * 'fija' (default): columna lateral de escritorio, oculta en mobile.
   * 'hoja': dentro del Sheet del menú hamburguesa (Header), siempre visible.
   */
  variante?: 'fija' | 'hoja'
}

export function Sidebar({ permisos, variante = 'fija' }: SidebarProps) {
  const pathname = usePathname()
  const [colapsadas, setColapsadas] = useState<Record<string, boolean>>({})

  // Recuperar qué secciones estaban colapsadas
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_SECCIONES)
      if (raw) setColapsadas(JSON.parse(raw) as Record<string, boolean>)
    } catch {
      // localStorage no disponible — se ignora
    }
  }, [])

  function alternarSeccion(titulo: string, e: React.MouseEvent) {
    // Evita que el click cierre el menú móvil (Sheet)
    e.stopPropagation()
    setColapsadas((prev) => {
      const siguiente = { ...prev, [titulo]: !prev[titulo] }
      try {
        localStorage.setItem(LS_SECCIONES, JSON.stringify(siguiente))
      } catch {
        // se ignora
      }
      return siguiente
    })
  }

  const esActivo = (href: string) => esItemActivo(pathname, href, TODOS_LOS_ITEMS)

  // Filtrar items por permiso y secciones que quedaron vacías
  const { secciones, pie } = menuVisible(MENU_ACTIVO, permisos)

  function renderItem(item: ItemNav) {
    const activo = esActivo(item.href)
    const Icono = ICONOS[item.icono]
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150',
          activo
            ? 'bg-[#f9b44c] text-[#391511] shadow-sm'
            : 'text-[#f9d2a2] hover:bg-white/10 hover:text-white'
        )}
      >
        <Icono
          className={cn('h-4.5 w-4.5 shrink-0', activo ? 'text-[#391511]' : 'text-[#c8a58a]')}
          size={18}
        />
        <span className="flex flex-col leading-tight">
          <span>{item.etiqueta}</span>
          {item.nota && (
            <span
              className={cn(
                'text-[10px] font-normal',
                activo ? 'text-[#391511]/70' : 'text-[#c8a58a]'
              )}
            >
              {item.nota}
            </span>
          )}
        </span>
        {item.href === '/produccion' && <BadgeProduccionPendiente activo={activo} />}
      </Link>
    )
  }

  return (
    <aside
      className={cn(
        'flex-col w-60 shrink-0 bg-[#391511]',
        variante === 'hoja' ? 'flex h-full' : 'hidden md:flex h-screen sticky top-0'
      )}
    >
      {/* Logo */}
      <div className="px-6 py-7 border-b border-white/10">
        <div className="flex flex-col">
          <span className="text-[#f9b44c] text-3xl font-extrabold leading-none tracking-tight">
            ¡Hola!
          </span>
          <div className="flex items-center gap-2 mt-1">
            <div className="h-px flex-1 bg-[#f9b44c]/30" />
            <span className="text-[#f9d2a2] text-[10px] font-medium tracking-[0.18em] uppercase">
              Express
            </span>
            <div className="h-px flex-1 bg-[#f9b44c]/30" />
          </div>
        </div>
      </div>

      {/* Navegación agrupada por secciones */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {secciones.map((seccion, idx) => {
          const tieneActivo = seccion.items.some((i) => esActivo(i.href))
          // Una sección con la ruta activa nunca se muestra colapsada
          const colapsada =
            !!seccion.titulo && !!colapsadas[seccion.titulo] && !tieneActivo

          return (
            <div key={seccion.titulo ?? `s-${idx}`} className="space-y-0.5">
              {seccion.titulo && (
                <button
                  type="button"
                  onClick={(e) => alternarSeccion(seccion.titulo!, e)}
                  className="w-full flex items-center justify-between px-3 pb-1 pt-0.5 group"
                >
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#c8a58a]/70 group-hover:text-[#c8a58a]">
                    {seccion.titulo}
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-[#c8a58a]/60 transition-transform duration-150',
                      colapsada && '-rotate-90'
                    )}
                  />
                </button>
              )}
              {!colapsada && seccion.items.map(renderItem)}
            </div>
          )
        })}
      </nav>

      {/* Accesos secundarios */}
      {pie.length > 0 && (
        <div className="px-3 py-3 border-t border-white/10 space-y-0.5">{pie.map(renderItem)}</div>
      )}

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-[#6f3a2a] text-[10px] text-center font-medium tracking-wide">
          24/7 · La Rioja, Argentina
        </p>
      </div>
    </aside>
  )
}
