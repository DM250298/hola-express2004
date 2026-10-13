// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de no-pérdida del menú lateral (reorganización por pilares).   ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  FOTO_MENU_OCT_2026 es copia literal de las 25 entradas que tenía      ║
// ║  components/shared/Sidebar.tsx antes del cambio (href, permiso,        ║
// ║  permisosAlt). Si alguna vez se agrega una ruta al menú, se agrega     ║
// ║  acá también: el test existe para que ninguna se pierda sin querer.    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MENU_ANTERIOR,
  MENU_SEIS_PILARES,
  esItemActivo,
  menuVisible,
  todosLosItems,
  type ItemNav,
  type MenuNav,
} from './navegacion.ts'
import { PERMISOS_POR_ROL_LEGACY, TODOS_LOS_PERMISOS } from '../permisos.ts'

type Foto = { href: string; permiso: string; permisosAlt?: string[] }

const FOTO_MENU_OCT_2026: Foto[] = [
  { href: '/rrhh/mi-panel', permiso: 'mi_panel' },
  { href: '/rrhh/mis-tareas', permiso: 'mi_panel' },
  { href: '/rrhh/pase-turno', permiso: 'mi_panel', permisosAlt: ['rrhh'] },
  { href: '/movil', permiso: 'inventario', permisosAlt: ['recepcion', 'conteo_gestion'] },
  { href: '/', permiso: 'dashboard' },
  { href: '/agenda', permiso: 'proyectos' },
  { href: '/proyectos', permiso: 'proyectos' },
  { href: '/tablero', permiso: 'tablero' },
  { href: '/alertas', permiso: 'alertas' },
  { href: '/reportes', permiso: 'reportes' },
  { href: '/pos', permiso: 'pos' },
  { href: '/ventas', permiso: 'ventas' },
  { href: '/clientes', permiso: 'clientes' },
  { href: '/inventario', permiso: 'inventario' },
  { href: '/vencimientos', permiso: 'vencimientos' },
  { href: '/inventario/conteo', permiso: 'conteo_cierre' },
  { href: '/mapa', permiso: 'inventario' },
  { href: '/produccion', permiso: 'produccion' },
  { href: '/etiquetas', permiso: 'etiquetas' },
  { href: '/compras', permiso: 'compras', permisosAlt: ['pedidos', 'recepcion'] },
  { href: '/finanzas', permiso: 'finanzas' },
  { href: '/contabilidad', permiso: 'contabilidad' },
  { href: '/rrhh', permiso: 'rrhh', permisosAlt: ['tareas_gestion', 'rrhh_sueldos'] },
  { href: '/terminales', permiso: 'terminales' },
  { href: '/configuracion', permiso: 'configuracion' },
]

/**
 * Lo único que el menú nuevo agrega: el atajo a Proveedores en Compras. Lo ve
 * quien tiene configuracion o el permiso proveedores (D9, mig 257).
 */
const AGREGADOS: Foto[] = [
  { href: '/configuracion/proveedores', permiso: 'configuracion', permisosAlt: ['proveedores'] },
]

/**
 * Excepción documentada (Bloque 2, oct-2026): Modo móvil se muestra con el
 * mismo criterio que el middleware deja abrir /movil (inventario, pedidos,
 * recepcion o mi_panel). Antes lo veía quien solo tenía conteo_gestion y
 * rebotaba, y no lo veía el empleado, que sí puede entrar. El menú anterior
 * conserva el criterio viejo (es la foto para volver atrás).
 */
const CAMBIOS: Record<string, Foto> = {
  '/movil': { href: '/movil', permiso: 'inventario', permisosAlt: ['pedidos', 'recepcion', 'mi_panel'] },
}

/** Permisos que abren `ruta` según PERMISO_RUTA de middleware.ts (leído como texto). */
function permisosQueAbren(ruta: string): string[] {
  const fuente = readFileSync(new URL('../../middleware.ts', import.meta.url), 'utf8')
  const bloque = fuente.slice(fuente.indexOf('const PERMISO_RUTA'), fuente.indexOf('export async function middleware'))
  const permisos: string[] = []
  for (const m of bloque.matchAll(/^\s*(\w+):\s*\[([^\]]*)\]/gm)) {
    const rutas = [...m[2].matchAll(/'([^']+)'/g)].map((r) => r[1])
    if (rutas.includes(ruta)) permisos.push(m[1])
  }
  return permisos.sort()
}

const PILARES = ['Resultados', 'Operaciones', 'Ventas', 'Compras', 'Stock', 'Finanzas']

function foto(i: ItemNav): Foto {
  const f: Foto = { href: i.href, permiso: i.permiso }
  if (i.permisosAlt) f.permisosAlt = [...i.permisosAlt]
  return f
}

function normalizar(f: Foto): string {
  return JSON.stringify([f.href, f.permiso, [...(f.permisosAlt ?? [])].sort()])
}

function visibles(menu: MenuNav, permisos: string[]): string[] {
  return todosLosItems(menuVisible(menu, permisos))
    .map((i) => i.href)
    .sort()
}

/** Juegos de permisos a probar: los roles por defecto y los que hay en la base de prueba. */
const JUEGOS: Record<string, string[]> = {
  ...PERMISOS_POR_ROL_LEGACY,
  todos: TODOS_LOS_PERMISOS,
  // Cajero antes de la mig 256 (D8): con rrhh y sin mi_panel
  cajero_con_rrhh: [
    ...PERMISOS_POR_ROL_LEGACY.cajero.filter((p) => p !== 'mi_panel'),
    'rrhh',
  ],
  // Quien compra sin configuracion (D9)
  compras_con_proveedores: ['compras', 'pedidos', 'recepcion', 'proveedores'],
  solo_proveedores: ['proveedores'],
  solo_conteo: ['conteo_gestion'],
  solo_sueldos: ['rrhh_sueldos'],
  solo_tareas: ['tareas_gestion'],
  ninguno: [],
}

test('el menú anterior es idéntico a la foto de oct-2026 (mismo orden)', () => {
  assert.deepEqual(todosLosItems(MENU_ANTERIOR).map(foto), FOTO_MENU_OCT_2026)
})

test('el menú por pilares tiene las mismas rutas con los mismos permisos, más el atajo a Proveedores', () => {
  const esperado = [...FOTO_MENU_OCT_2026.map((f) => CAMBIOS[f.href] ?? f), ...AGREGADOS]
    .map(normalizar)
    .sort()
  const real = todosLosItems(MENU_SEIS_PILARES).map(foto).map(normalizar).sort()
  assert.deepEqual(real, esperado)
})

test('todo permiso que usa el menú existe en el catálogo de permisos', () => {
  for (const menu of [MENU_ANTERIOR, MENU_SEIS_PILARES]) {
    for (const i of todosLosItems(menu)) {
      for (const p of [i.permiso, ...(i.permisosAlt ?? [])]) {
        assert.ok(TODOS_LOS_PERMISOS.includes(p), `${i.href}: permiso "${p}" no existe`)
      }
    }
  }
})

test('ningún menú repite una ruta', () => {
  for (const menu of [MENU_ANTERIOR, MENU_SEIS_PILARES]) {
    const hrefs = todosLosItems(menu).map((i) => i.href)
    assert.equal(new Set(hrefs).size, hrefs.length)
  }
})

test('las secciones con título del menú nuevo son exactamente los seis pilares, en orden', () => {
  const titulos = MENU_SEIS_PILARES.secciones.filter((s) => s.titulo).map((s) => s.titulo)
  assert.deepEqual(titulos, PILARES)
  assert.deepEqual(
    MENU_SEIS_PILARES.pie.map((i) => i.href),
    ['/movil', '/configuracion']
  )
})

test('cada juego de permisos ve lo mismo antes y después (más Proveedores con configuracion o proveedores; Modo móvil según el middleware)', () => {
  const abrenMovil = permisosQueAbren('/movil')
  for (const [nombre, permisos] of Object.entries(JUEGOS)) {
    const antes = visibles(MENU_ANTERIOR, permisos).filter((h) => h !== '/movil')
    const despues = visibles(MENU_SEIS_PILARES, permisos)
    const esperado = [...antes]
    if (permisos.includes('configuracion') || permisos.includes('proveedores')) {
      esperado.push('/configuracion/proveedores')
    }
    if (permisos.some((p) => abrenMovil.includes(p))) esperado.push('/movil')
    assert.deepEqual(despues, esperado.sort(), `juego "${nombre}"`)
  }
})

test('Modo móvil se muestra con los mismos permisos con que el middleware abre /movil', () => {
  const movil = MENU_SEIS_PILARES.pie.find((i) => i.href === '/movil')
  assert.ok(movil)
  const delMenu = [movil.permiso, ...(movil.permisosAlt ?? [])].sort()
  assert.deepEqual(delMenu, permisosQueAbren('/movil'))
  assert.deepEqual(delMenu, ['inventario', 'mi_panel', 'pedidos', 'recepcion'])
  // Los dos casos que motivaron el cambio:
  assert.ok(!visibles(MENU_SEIS_PILARES, ['conteo_gestion']).includes('/movil'))
  assert.ok(visibles(MENU_SEIS_PILARES, PERMISOS_POR_ROL_LEGACY.empleado).includes('/movil'))
})

test('las entradas personales quedan arriba, sin título', () => {
  const arriba = MENU_SEIS_PILARES.secciones[0]
  assert.equal(arriba.titulo, undefined)
  assert.deepEqual(
    arriba.items.map((i) => i.href),
    ['/', '/rrhh/mi-panel', '/rrhh/mis-tareas', '/rrhh/pase-turno', '/agenda']
  )
})

test('ítem activo: gana el más específico', () => {
  const items = todosLosItems(MENU_SEIS_PILARES)
  const activos = (ruta: string) =>
    items.filter((i) => esItemActivo(ruta, i.href, items)).map((i) => i.href)

  assert.deepEqual(activos('/'), ['/'])
  assert.deepEqual(activos('/configuracion/proveedores'), ['/configuracion/proveedores'])
  assert.deepEqual(activos('/configuracion/productos'), ['/configuracion'])
  assert.deepEqual(activos('/inventario/conteo/zona/5'), ['/inventario/conteo'])
  assert.deepEqual(activos('/inventario/control'), ['/inventario'])
  assert.deepEqual(activos('/rrhh/mi-panel'), ['/rrhh/mi-panel'])
  assert.deepEqual(activos('/rrhh/empleados/3'), ['/rrhh'])
  assert.deepEqual(activos('/pedidos/nuevo'), [])
})
