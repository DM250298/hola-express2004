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
  Receipt,
  Users,
  Package,
  ArrowDownWideNarrow,
  ArrowLeftRight,
  CalendarX,
  Tag,
  DollarSign,
  Calculator,
  BarChart3,
  Briefcase,
  CreditCard,
  Settings,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ItemNav {
  href: string
  etiqueta: string
  icono: React.ElementType
  permiso: string
  /** Permisos extra que también habilitan ver este item. */
  permisosAlt?: string[]
}

interface Seccion {
  titulo?: string
  items: ItemNav[]
}

const SECCIONES: Seccion[] = [
  {
    items: [
      {
        href: '/',
        etiqueta: 'Dashboard',
        icono: LayoutDashboard,
        permiso: 'dashboard',
      },
      {
        href: '/agenda',
        etiqueta: 'Mi día',
        icono: CalendarCheck,
        permiso: 'proyectos',
      },
      {
        href: '/proyectos',
        etiqueta: 'Tableros',
        icono: FolderKanban,
        permiso: 'proyectos',
      },
    ],
  },
  {
    titulo: 'Ventas',
    items: [
      {
        href: '/pos',
        etiqueta: 'Punto de Venta',
        icono: ShoppingCart,
        permiso: 'pos',
      },
      {
        href: '/ventas',
        etiqueta: 'Ventas',
        icono: Receipt,
        permiso: 'ventas',
      },
      {
        href: '/clientes',
        etiqueta: 'Clientes',
        icono: Users,
        permiso: 'clientes',
      },
    ],
  },
  {
    titulo: 'Stock',
    items: [
      {
        href: '/inventario',
        etiqueta: 'Stock',
        icono: Package,
        permiso: 'inventario',
      },
      {
        href: '/inventario/movimientos',
        etiqueta: 'Movimientos',
        icono: ArrowLeftRight,
        permiso: 'inventario',
      },
      {
        href: '/inventario/clasificacion-abc',
        etiqueta: 'Clasificación ABC',
        icono: ArrowDownWideNarrow,
        permiso: 'inventario',
      },
      {
        href: '/vencimientos',
        etiqueta: 'Vencimientos',
        icono: CalendarX,
        permiso: 'vencimientos',
      },
      {
        href: '/etiquetas',
        etiqueta: 'Etiquetas de precio',
        icono: Tag,
        permiso: 'etiquetas',
      },
    ],
  },
  {
    titulo: 'Compras',
    items: [
      {
        href: '/compras',
        etiqueta: 'Compras',
        icono: ShoppingBag,
        permiso: 'compras',
        // El cajero recibe mercadería (permiso 'recepcion'); el encargado
        // arma órdenes ('pedidos'). Cualquiera de los tres ve el módulo.
        permisosAlt: ['pedidos', 'recepcion'],
      },
    ],
  },
  {
    titulo: 'Administración',
    items: [
      {
        href: '/finanzas',
        etiqueta: 'Finanzas',
        icono: DollarSign,
        permiso: 'finanzas',
      },
      {
        href: '/contabilidad',
        etiqueta: 'Contabilidad',
        icono: Calculator,
        permiso: 'contabilidad',
      },
      {
        href: '/rrhh',
        etiqueta: 'Recursos Humanos',
        icono: Briefcase,
        permiso: 'rrhh',
      },
      {
        href: '/reportes',
        etiqueta: 'Reportes',
        icono: BarChart3,
        permiso: 'reportes',
      },
    ],
  },
  {
    titulo: 'Sistema',
    items: [
      {
        href: '/terminales',
        etiqueta: 'Terminales de cobro',
        icono: CreditCard,
        permiso: 'terminales',
      },
      {
        href: '/configuracion',
        etiqueta: 'Configuración',
        icono: Settings,
        permiso: 'configuracion',
      },
    ],
  },
]

const LS_SECCIONES = 'hola-sidebar-secciones-colapsadas'

interface SidebarProps {
  permisos: string[]
}

export function Sidebar({ permisos }: SidebarProps) {
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

  function esActivo(href: string): boolean {
    if (href === '/') return pathname === '/'
    // Coincidencia exacta o sub-ruta directa, pero no si hay un item
    // más específico registrado que también coincida con la ruta actual.
    if (!pathname.startsWith(href)) return false
    // Evitar que "/inventario" se marque activo en "/inventario/movimientos"
    // si existe un item con ese href más largo.
    const todosLosItems = SECCIONES.flatMap((s) => s.items)
    const hayMasEspecifico = todosLosItems.some(
      (i) =>
        i.href !== href &&
        i.href.startsWith(href) &&
        pathname.startsWith(i.href)
    )
    return !hayMasEspecifico
  }

  // Filtrar items por permiso y secciones que quedaron vacías
  const seccionesFiltradas = SECCIONES.map((s) => ({
    ...s,
    items: s.items.filter(
      (i) =>
        permisos.includes(i.permiso) ||
        (i.permisosAlt?.some((p) => permisos.includes(p)) ?? false)
    ),
  })).filter((s) => s.items.length > 0)

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 bg-[#391511] h-screen sticky top-0">
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
        {seccionesFiltradas.map((seccion, idx) => {
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
              {!colapsada &&
                seccion.items.map((item) => {
                  const activo = esActivo(item.href)
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
                      <item.icono
                        className={cn(
                          'h-4.5 w-4.5 shrink-0',
                          activo ? 'text-[#391511]' : 'text-[#c8a58a]'
                        )}
                        size={18}
                      />
                      {item.etiqueta}
                    </Link>
                  )
                })}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <p className="text-[#6f3a2a] text-[10px] text-center font-medium tracking-wide">
          24/7 · La Rioja, Argentina
        </p>
      </div>
    </aside>
  )
}
