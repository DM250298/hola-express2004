/**
 * Catálogo de permisos del sistema. Cada rol tiene un subconjunto de estas
 * claves. Los permisos controlan qué módulos ve y usa cada usuario.
 */
export interface PermisoDef {
  clave: string
  etiqueta: string
  grupo: string
}

export const PERMISOS: PermisoDef[] = [
  { clave: 'dashboard', etiqueta: 'Ver Dashboard', grupo: 'General' },
  { clave: 'proyectos', etiqueta: 'Proyectos y tareas', grupo: 'General' },
  { clave: 'pos', etiqueta: 'Punto de venta', grupo: 'Ventas' },
  { clave: 'pos_gasto', etiqueta: 'Registrar gastos de caja en el POS', grupo: 'Ventas' },
  { clave: 'ventas', etiqueta: 'Ver listado de ventas', grupo: 'Ventas' },
  { clave: 'ventas_anular', etiqueta: 'Anular ventas', grupo: 'Ventas' },
  { clave: 'clientes', etiqueta: 'Clientes (CRM)', grupo: 'Ventas' },
  { clave: 'inventario', etiqueta: 'Ver inventario', grupo: 'Stock' },
  { clave: 'inventario_ajustes', etiqueta: 'Hacer ajustes de stock', grupo: 'Stock' },
  { clave: 'conteo_gestion', etiqueta: 'Crear y aprobar conteos', grupo: 'Stock' },
  { clave: 'vencimientos', etiqueta: 'Ver vencimientos', grupo: 'Stock' },
  { clave: 'compras', etiqueta: 'Compras y cotizaciones', grupo: 'Stock' },
  { clave: 'etiquetas', etiqueta: 'Etiquetas de precio', grupo: 'Stock' },
  { clave: 'pedidos', etiqueta: 'Pedidos a proveedores', grupo: 'Stock' },
  { clave: 'recepcion', etiqueta: 'Recepción de mercadería', grupo: 'Stock' },
  { clave: 'finanzas', etiqueta: 'Finanzas', grupo: 'Análisis' },
  { clave: 'contabilidad', etiqueta: 'Contabilidad', grupo: 'Análisis' },
  { clave: 'reportes', etiqueta: 'Reportes', grupo: 'Análisis' },
  { clave: 'rrhh', etiqueta: 'Recursos Humanos / Sueldos', grupo: 'Análisis' },
  { clave: 'terminales', etiqueta: 'Terminales de cobro', grupo: 'Sistema' },
  { clave: 'configuracion', etiqueta: 'Configuración del sistema', grupo: 'Sistema' },
]

export const TODOS_LOS_PERMISOS: string[] = PERMISOS.map((p) => p.clave)

/** Grupos en orden, para renderizar la matriz de permisos. */
export const GRUPOS_PERMISOS: string[] = [
  ...new Set(PERMISOS.map((p) => p.grupo)),
]

/**
 * Permisos por defecto de los 3 roles base. Sirve de fallback si la tabla
 * `roles` todavía no existe (antes de correr la migración 009).
 */
export const PERMISOS_POR_ROL_LEGACY: Record<string, string[]> = {
  admin: TODOS_LOS_PERMISOS,
  encargado: [
    'dashboard',
    'proyectos',
    'pos',
    'pos_gasto',
    'ventas',
    'ventas_anular',
    'clientes',
    'inventario',
    'inventario_ajustes',
    'conteo_gestion',
    'vencimientos',
    'compras',
    'etiquetas',
    'pedidos',
    'recepcion',
    'reportes',
  ],
  cajero: [
    'proyectos',
    'pos',
    'ventas',
    'inventario',
    'recepcion',
  ],
}

/** Permiso → ruta del módulo. Para resolver la pantalla de inicio. */
const RUTA_POR_PERMISO: Record<string, string> = {
  dashboard: '/',
  pos: '/pos',
  ventas: '/ventas',
  clientes: '/clientes',
  inventario: '/inventario',
  vencimientos: '/vencimientos',
  compras: '/compras',
  etiquetas: '/etiquetas',
  pedidos: '/pedidos',
  recepcion: '/recepcion',
  finanzas: '/finanzas',
  contabilidad: '/contabilidad',
  rrhh: '/rrhh',
  terminales: '/terminales',
  proyectos: '/proyectos',
  reportes: '/reportes',
  configuracion: '/configuracion',
}

/** Orden de prioridad para elegir la pantalla de inicio según el rol. */
const PRIORIDAD_INICIO: string[] = [
  'dashboard',
  'pos',
  'ventas',
  'inventario',
  'vencimientos',
  'pedidos',
  'recepcion',
  'compras',
  'etiquetas',
  'clientes',
  'finanzas',
  'contabilidad',
  'rrhh',
  'proyectos',
  'terminales',
  'reportes',
  'configuracion',
]

/**
 * Ruta a la que debe entrar un usuario al iniciar sesión, según sus permisos.
 * El admin/encargado (con permiso `dashboard`) entra al dashboard; el cajero,
 * que no lo tiene, entra directo a su área de trabajo (el POS).
 */
export function rutaInicial(permisos: string[] | undefined | null): string {
  const lista = permisos ?? []
  for (const clave of PRIORIDAD_INICIO) {
    if (lista.includes(clave)) return RUTA_POR_PERMISO[clave]
  }
  return '/'
}

/** ¿El usuario (sus permisos) incluye la clave dada? */
export function tienePermiso(
  permisos: string[] | undefined | null,
  clave: string
): boolean {
  return !!permisos && permisos.includes(clave)
}

export function etiquetaPermiso(clave: string): string {
  return PERMISOS.find((p) => p.clave === clave)?.etiqueta ?? clave
}
