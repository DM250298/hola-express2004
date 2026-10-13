/**
 * Configuración de la navegación (menú lateral).
 *
 * Datos puros, sin imports con alias: así `navegacion.test.ts` los puede
 * correr con `node --test`. Los íconos van como nombre (`IconoNav`) y el
 * Sidebar los resuelve contra lucide-react.
 *
 * MOSTRAR_CONTABILIDAD: muestra u oculta el item "Contabilidad" del sidebar
 * sin tocar el módulo: la ruta /contabilidad, sus permisos y los asientos
 * automáticos siguen funcionando igual. En `false` lo oculta del menú.
 *
 * MENU_PILARES: elige qué menú se muestra. `true` = menú por los seis
 * pilares (Resultados, Operaciones, Ventas, Compras, Stock, Finanzas) con
 * Modo móvil y Configuración al pie. `false` = el menú anterior, tal cual
 * estaba hasta oct-2026. Los dos usan las mismas rutas y los mismos
 * permisos (lo verifica el test), así que volver atrás es cambiar esta línea.
 */
export const MOSTRAR_CONTABILIDAD = true
export const MENU_PILARES = true

export type IconoNav =
  | 'UserRound'
  | 'ListChecks'
  | 'ArrowLeftRight'
  | 'Smartphone'
  | 'LayoutDashboard'
  | 'CalendarCheck'
  | 'FolderKanban'
  | 'TrendingUp'
  | 'BellRing'
  | 'BarChart3'
  | 'ShoppingCart'
  | 'Receipt'
  | 'Users'
  | 'Package'
  | 'CalendarX'
  | 'ClipboardList'
  | 'Map'
  | 'ChefHat'
  | 'Tag'
  | 'ShoppingBag'
  | 'Truck'
  | 'DollarSign'
  | 'Calculator'
  | 'Briefcase'
  | 'CreditCard'
  | 'Settings'

export interface ItemNav {
  href: string
  etiqueta: string
  icono: IconoNav
  permiso: string
  /** Permisos extra que también habilitan ver este item. */
  permisosAlt?: string[]
  /** Subtítulo aclaratorio opcional (ej: "Para tu contador"). */
  nota?: string
}

export interface SeccionNav {
  titulo?: string
  items: ItemNav[]
}

export interface MenuNav {
  secciones: SeccionNav[]
  /** Accesos secundarios, debajo de la navegación principal. */
  pie: ItemNav[]
}

/** Menú anterior (hasta oct-2026). No editar: es la referencia para volver atrás. */
export const MENU_ANTERIOR: MenuNav = {
  secciones: [
    {
      items: [
        { href: '/rrhh/mi-panel', etiqueta: 'Mi panel', icono: 'UserRound', permiso: 'mi_panel' },
        { href: '/rrhh/mis-tareas', etiqueta: 'Mis tareas', icono: 'ListChecks', permiso: 'mi_panel' },
        {
          href: '/rrhh/pase-turno',
          etiqueta: 'Pase de turno',
          icono: 'ArrowLeftRight',
          permiso: 'mi_panel',
          permisosAlt: ['rrhh'],
        },
        {
          href: '/movil',
          etiqueta: 'Modo móvil',
          icono: 'Smartphone',
          permiso: 'inventario',
          // Conteo de stock + recepción desde el teléfono. Lo ve quien pueda
          // operar stock o recibir mercadería (encargado y cajero).
          permisosAlt: ['recepcion', 'conteo_gestion'],
          nota: 'Contar stock y recibir',
        },
        { href: '/', etiqueta: 'Dashboard', icono: 'LayoutDashboard', permiso: 'dashboard' },
        { href: '/agenda', etiqueta: 'Mi día', icono: 'CalendarCheck', permiso: 'proyectos' },
        { href: '/proyectos', etiqueta: 'Tableros', icono: 'FolderKanban', permiso: 'proyectos' },
      ],
    },
    {
      titulo: 'Gestión',
      items: [
        {
          href: '/tablero',
          etiqueta: 'Tablero del dueño',
          icono: 'TrendingUp',
          permiso: 'tablero',
          nota: 'Márgenes, quiebres y decisiones',
        },
        {
          href: '/alertas',
          etiqueta: 'Alertas',
          icono: 'BellRing',
          permiso: 'alertas',
          nota: 'Qué resolver y quién lo hace',
        },
        {
          href: '/reportes',
          etiqueta: 'Reportes',
          icono: 'BarChart3',
          permiso: 'reportes',
          nota: 'Ventas, rotación y mermas',
        },
      ],
    },
    {
      titulo: 'Ventas',
      items: [
        { href: '/pos', etiqueta: 'Punto de Venta', icono: 'ShoppingCart', permiso: 'pos' },
        { href: '/ventas', etiqueta: 'Ventas', icono: 'Receipt', permiso: 'ventas' },
        { href: '/clientes', etiqueta: 'Clientes', icono: 'Users', permiso: 'clientes' },
      ],
    },
    {
      titulo: 'Stock',
      items: [
        { href: '/inventario', etiqueta: 'Stock', icono: 'Package', permiso: 'inventario' },
        { href: '/vencimientos', etiqueta: 'Vencimientos', icono: 'CalendarX', permiso: 'vencimientos' },
        {
          href: '/inventario/conteo',
          etiqueta: 'Conteo físico',
          icono: 'ClipboardList',
          permiso: 'conteo_cierre',
          nota: 'Inventario por zonas',
        },
        {
          href: '/mapa',
          etiqueta: 'Mapa del local',
          icono: 'Map',
          permiso: 'inventario',
          nota: 'Góndolas y ubicaciones',
        },
        { href: '/produccion', etiqueta: 'Producción', icono: 'ChefHat', permiso: 'produccion' },
        { href: '/etiquetas', etiqueta: 'Etiquetas de precio', icono: 'Tag', permiso: 'etiquetas' },
      ],
    },
    {
      titulo: 'Compras',
      items: [
        {
          href: '/compras',
          etiqueta: 'Compras',
          icono: 'ShoppingBag',
          permiso: 'compras',
          // El cajero recibe mercadería (permiso 'recepcion'); el encargado
          // arma órdenes ('pedidos'). Cualquiera de los tres ve el módulo.
          permisosAlt: ['pedidos', 'recepcion'],
        },
      ],
    },
    {
      titulo: 'Finanzas y Tesorería',
      items: [
        { href: '/finanzas', etiqueta: 'Finanzas', icono: 'DollarSign', permiso: 'finanzas' },
        {
          href: '/contabilidad',
          etiqueta: 'Contabilidad',
          icono: 'Calculator',
          permiso: 'contabilidad',
          nota: 'Para tu contador',
        },
      ],
    },
    {
      titulo: 'Administración',
      items: [
        {
          // Hub único del personal: Hoy, Equipo, Cronograma, Tareas, Sueldos.
          // Cada pestaña se gatea por su permiso adentro de PantallaPersonal.
          href: '/rrhh',
          etiqueta: 'Personal',
          icono: 'Briefcase',
          permiso: 'rrhh',
          permisosAlt: ['tareas_gestion', 'rrhh_sueldos'],
          nota: 'Equipo, turnos y tareas',
        },
      ],
    },
    {
      titulo: 'Sistema',
      items: [
        { href: '/terminales', etiqueta: 'Terminales de cobro', icono: 'CreditCard', permiso: 'terminales' },
        { href: '/configuracion', etiqueta: 'Configuración', icono: 'Settings', permiso: 'configuracion' },
      ],
    },
  ],
  pie: [],
}

/**
 * Menú por pilares (oct-2026). Mismas rutas y permisos que MENU_ANTERIOR,
 * más el atajo a Proveedores dentro de Compras (con el mismo permiso que su
 * pantalla, `configuracion`). Arriba quedan solo las entradas personales.
 */
export const MENU_SEIS_PILARES: MenuNav = {
  secciones: [
    {
      items: [
        {
          href: '/',
          etiqueta: 'Inicio',
          icono: 'LayoutDashboard',
          permiso: 'dashboard',
          nota: 'Resumen del día',
        },
        { href: '/rrhh/mi-panel', etiqueta: 'Mi panel', icono: 'UserRound', permiso: 'mi_panel' },
        { href: '/rrhh/mis-tareas', etiqueta: 'Mis tareas', icono: 'ListChecks', permiso: 'mi_panel' },
        {
          href: '/rrhh/pase-turno',
          etiqueta: 'Mi pase de turno',
          icono: 'ArrowLeftRight',
          permiso: 'mi_panel',
          permisosAlt: ['rrhh'],
        },
        {
          href: '/agenda',
          etiqueta: 'Mi agenda',
          icono: 'CalendarCheck',
          permiso: 'proyectos',
          nota: 'Tareas de tableros y alertas',
        },
      ],
    },
    {
      titulo: 'Resultados',
      items: [
        {
          href: '/tablero',
          etiqueta: 'Tablero del dueño',
          icono: 'TrendingUp',
          permiso: 'tablero',
          nota: 'Márgenes, quiebres y decisiones',
        },
        {
          href: '/reportes',
          etiqueta: 'Reportes',
          icono: 'BarChart3',
          permiso: 'reportes',
          nota: 'Ventas, rotación y mermas',
        },
      ],
    },
    {
      titulo: 'Operaciones',
      items: [
        {
          // Hub único del personal (ex "Personal"). Cada pestaña se gatea por
          // su permiso adentro de PantallaPersonal.
          href: '/rrhh',
          etiqueta: 'Turnos y equipo',
          icono: 'Briefcase',
          permiso: 'rrhh',
          permisosAlt: ['tareas_gestion', 'rrhh_sueldos'],
          nota: 'Hoy, cronograma, tareas y pases',
        },
        {
          href: '/alertas',
          etiqueta: 'Alertas',
          icono: 'BellRing',
          permiso: 'alertas',
          nota: 'Qué resolver y quién lo hace',
        },
        { href: '/produccion', etiqueta: 'Producción', icono: 'ChefHat', permiso: 'produccion' },
        { href: '/proyectos', etiqueta: 'Tableros de tareas', icono: 'FolderKanban', permiso: 'proyectos' },
      ],
    },
    {
      titulo: 'Ventas',
      items: [
        { href: '/pos', etiqueta: 'Punto de venta', icono: 'ShoppingCart', permiso: 'pos' },
        { href: '/ventas', etiqueta: 'Historial de ventas', icono: 'Receipt', permiso: 'ventas' },
        { href: '/clientes', etiqueta: 'Clientes y fiado', icono: 'Users', permiso: 'clientes' },
      ],
    },
    {
      titulo: 'Compras',
      items: [
        {
          href: '/compras',
          etiqueta: 'Compras',
          icono: 'ShoppingBag',
          permiso: 'compras',
          // El cajero recibe mercadería (permiso 'recepcion'); el encargado
          // arma órdenes ('pedidos'). Cualquiera de los tres ve el módulo.
          permisosAlt: ['pedidos', 'recepcion'],
        },
        {
          // Atajo: la pantalla sigue en Configuración y pide el mismo permiso.
          href: '/configuracion/proveedores',
          etiqueta: 'Proveedores',
          icono: 'Truck',
          permiso: 'configuracion',
          nota: 'Catálogo y reposición',
        },
      ],
    },
    {
      titulo: 'Stock',
      items: [
        { href: '/inventario', etiqueta: 'Stock', icono: 'Package', permiso: 'inventario' },
        {
          href: '/inventario/conteo',
          etiqueta: 'Conteo físico',
          icono: 'ClipboardList',
          permiso: 'conteo_cierre',
          nota: 'Inventario por zonas',
        },
        { href: '/vencimientos', etiqueta: 'Vencimientos', icono: 'CalendarX', permiso: 'vencimientos' },
        {
          href: '/mapa',
          etiqueta: 'Mapa del local',
          icono: 'Map',
          permiso: 'inventario',
          nota: 'Góndolas y ubicaciones',
        },
        { href: '/etiquetas', etiqueta: 'Etiquetas de precio', icono: 'Tag', permiso: 'etiquetas' },
      ],
    },
    {
      titulo: 'Finanzas',
      items: [
        { href: '/finanzas', etiqueta: 'Finanzas y tesorería', icono: 'DollarSign', permiso: 'finanzas' },
        {
          href: '/terminales',
          etiqueta: 'Cobros con posnet',
          icono: 'CreditCard',
          permiso: 'terminales',
          nota: 'Terminales y conciliación',
        },
        {
          href: '/contabilidad',
          etiqueta: 'Contabilidad',
          icono: 'Calculator',
          permiso: 'contabilidad',
          nota: 'Para tu contador',
        },
      ],
    },
  ],
  pie: [
    {
      href: '/movil',
      etiqueta: 'Modo móvil',
      icono: 'Smartphone',
      permiso: 'inventario',
      permisosAlt: ['recepcion', 'conteo_gestion'],
      nota: 'Contar stock y recibir',
    },
    { href: '/configuracion', etiqueta: 'Configuración', icono: 'Settings', permiso: 'configuracion' },
  ],
}

export const MENU_ACTIVO: MenuNav = MENU_PILARES ? MENU_SEIS_PILARES : MENU_ANTERIOR

/** Todos los items del menú (secciones y pie), en orden. */
export function todosLosItems(menu: MenuNav): ItemNav[] {
  return [...menu.secciones.flatMap((s) => s.items), ...menu.pie]
}

export function puedeVerItem(item: ItemNav, permisos: readonly string[]): boolean {
  if (item.href === '/contabilidad' && !MOSTRAR_CONTABILIDAD) return false
  return (
    permisos.includes(item.permiso) ||
    (item.permisosAlt?.some((p) => permisos.includes(p)) ?? false)
  )
}

/** El menú filtrado por permisos, sin las secciones que quedan vacías. */
export function menuVisible(menu: MenuNav, permisos: readonly string[]): MenuNav {
  return {
    secciones: menu.secciones
      .map((s) => ({ ...s, items: s.items.filter((i) => puedeVerItem(i, permisos)) }))
      .filter((s) => s.items.length > 0),
    pie: menu.pie.filter((i) => puedeVerItem(i, permisos)),
  }
}

/**
 * ¿Se marca activo este href para la ruta actual? Coincidencia exacta o
 * sub-ruta, salvo que haya un item más específico que también coincida
 * (así "/inventario" no se marca en "/inventario/conteo" y "Configuración"
 * no se marca en "/configuracion/proveedores"). `items` son todos los del
 * menú, sin filtrar por permiso.
 */
export function esItemActivo(pathname: string, href: string, items: readonly ItemNav[]): boolean {
  if (href === '/') return pathname === '/'
  if (!pathname.startsWith(href)) return false
  const hayMasEspecifico = items.some(
    (i) => i.href !== href && i.href.startsWith(href) && pathname.startsWith(i.href)
  )
  return !hayMasEspecifico
}
