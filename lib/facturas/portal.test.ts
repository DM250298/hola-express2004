// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del estado de cada factura en el portal de proveedores          ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  Un estado mal derivado manda una factura a la bandeja equivocada:     ║
// ║  se cubren las cinco bandejas, las marcas y el orden de la lista.      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  armarFilasPortal,
  estadoFactura,
  filtrarFilas,
  marcasDe,
  nroComprobante,
  ordenarFilas,
  resumirPortal,
} from './portal.ts'
import type { CuentaAPagarConProveedor } from '../queries/finanzas.ts'
import type { ComprobanteCargado } from '../queries/facturasCompra.ts'

function cuenta(p: Partial<CuentaAPagarConProveedor> = {}): CuentaAPagarConProveedor {
  return {
    id: 1,
    pedido_id: 342,
    proveedor_id: 7,
    monto: 1000,
    monto_pagado: 0,
    monto_aplicado: 0,
    saldo_pendiente: 1000,
    fecha_vencimiento: '2026-10-24',
    fecha_pago: null,
    estado: 'pendiente',
    parcial: false,
    tiene_factura: false,
    provisoria: true,
    numero_factura: null,
    nota: null,
    created_at: '2026-10-12T15:00:00Z',
    proveedor_nombre: 'ARCOR',
    cuotas: [],
    proxima_cuota: null,
    ...p,
  }
}

function factura(p: Partial<ComprobanteCargado> = {}): ComprobanteCargado {
  return {
    id: 10,
    cuenta_id: 1,
    pedido_id: 342,
    proveedor_id: 7,
    fecha: '2026-10-15',
    created_at: '2026-10-16T12:42:00Z',
    tipo_comprobante: 'A',
    punto_venta: '3',
    numero_comprobante: '45812',
    cae: null,
    neto: 826.45,
    iva_total: 173.55,
    total: 1000,
    es_directa: false,
    controlada: false,
    validada: false,
    validada_at: null,
    diferencia_recepcion: null,
    renglones_diferentes: null,
    cuit_proveedor: '30500000000',
    usuario_nombre: 'Fernanda',
    ...p,
  }
}

test('las cinco bandejas', () => {
  assert.equal(estadoFactura(cuenta(), null), 'sin_factura')
  assert.equal(estadoFactura(cuenta({ tiene_factura: true }), factura()), 'a_validar')
  assert.equal(
    estadoFactura(cuenta({ tiene_factura: true }), factura({ validada: true })),
    'a_pagar'
  )
  assert.equal(
    estadoFactura(cuenta({ tiene_factura: true, estado: 'vencida' }), factura({ validada: true })),
    'vencida'
  )
  assert.equal(
    estadoFactura(
      cuenta({ tiene_factura: true, estado: 'pagada', saldo_pendiente: 0, monto_pagado: 1000 }),
      factura({ validada: true })
    ),
    'pagada'
  )
})

test('una deuda pagada sin factura sigue en Sin factura, marcada', () => {
  const c = cuenta({ estado: 'pagada', saldo_pendiente: 0, monto_pagado: 1000 })
  assert.equal(estadoFactura(c, null), 'sin_factura')
  assert.deepEqual(marcasDe(c, null, 'sin_factura'), ['pagada_sin_factura'])
})

test('una factura sin validar manda sobre el estado de la deuda, incluso vencida o pagada', () => {
  assert.equal(estadoFactura(cuenta({ tiene_factura: true, estado: 'vencida' }), factura()), 'a_validar')
  assert.equal(estadoFactura(cuenta({ tiene_factura: true, estado: 'pagada' }), factura()), 'a_validar')
})

test('deuda con tiene_factura pero sin comprobante (histórico): no hay nada que validar', () => {
  assert.equal(estadoFactura(cuenta({ tiene_factura: true }), null), 'a_pagar')
})

test('compra directa pagada en el acto: a validar hasta que se controla, después pagada', () => {
  const directa = factura({ cuenta_id: null, pedido_id: null, es_directa: true })
  assert.equal(estadoFactura(null, directa), 'a_validar')
  assert.equal(estadoFactura(null, { ...directa, validada: true }), 'pagada')
  assert.deepEqual(marcasDe(null, directa, 'a_validar'), ['pago_inmediato'])
})

test('marcas: parcial, cuotas, con diferencias y sin datos fiscales', () => {
  const c = cuenta({
    tiene_factura: true,
    parcial: true,
    monto_pagado: 300,
    saldo_pendiente: 700,
    cuotas: [
      { id: 1, numero: 1, monto: 500, fecha_vencimiento: '2026-10-20', pagado: 300, estado: 'parcial' },
      { id: 2, numero: 2, monto: 500, fecha_vencimiento: '2026-11-20', pagado: 0, estado: 'pendiente' },
    ],
  })
  const f = factura({ validada: true, renglones_diferentes: 2, diferencia_recepcion: 254 })
  assert.deepEqual(marcasDe(c, f, 'a_pagar'), ['parcial', 'cuotas', 'con_diferencias'])
  // Pagada: "parcial" ya no tiene sentido.
  assert.deepEqual(marcasDe({ ...c, estado: 'pagada' }, f, 'pagada'), ['cuotas', 'con_diferencias'])
  // Sin datos fiscales, salvo tipo X.
  assert.deepEqual(marcasDe(cuenta({ tiene_factura: true }), factura({ cuit_proveedor: null }), 'a_validar'), ['sin_datos_fiscales'])
  assert.deepEqual(
    marcasDe(cuenta({ tiene_factura: true }), factura({ tipo_comprobante: 'X', cuit_proveedor: null, punto_venta: null, numero_comprobante: null }), 'a_validar'),
    []
  )
})

test('número de comprobante como lo imprime el papel', () => {
  assert.equal(nroComprobante(factura()), 'A 0003-00045812')
  assert.equal(nroComprobante(factura({ tipo_comprobante: null, punto_venta: null, numero_comprobante: null })), null)
  assert.equal(nroComprobante(null), null)
})

const nombres = new Map<number, string>([[7, 'ARCOR'], [8, 'ngb']])

function escenario() {
  const cuentas: CuentaAPagarConProveedor[] = [
    cuenta({ id: 1, fecha_vencimiento: '2026-10-19', monto: 471500 }), // sin factura
    cuenta({ id: 2, tiene_factura: true, fecha_vencimiento: '2026-10-24' }), // a validar
    cuenta({ id: 3, tiene_factura: true, estado: 'vencida', fecha_vencimiento: '2026-10-14', saldo_pendiente: 288285.32, monto_pagado: 300000, parcial: true, monto: 588285.32 }),
    cuenta({ id: 4, tiene_factura: true, fecha_vencimiento: '2026-10-28', monto: 62277.46, saldo_pendiente: 62277.46 }),
    cuenta({ id: 5, tiene_factura: true, estado: 'pagada', fecha_pago: '2026-10-11', saldo_pendiente: 0, monto_pagado: 29380.14, monto: 29380.14, proveedor_nombre: 'la super fiambreria', proveedor_id: 9 }),
    cuenta({ id: 6, tiene_factura: true, estado: 'pagada', fecha_pago: '2026-09-02', saldo_pendiente: 0, monto_pagado: 100, monto: 100 }),
  ]
  const facturas: ComprobanteCargado[] = [
    factura({ id: 20, cuenta_id: 2, total: 270776.72 }),
    factura({ id: 30, cuenta_id: 3, validada: true, total: 588285.32 }),
    factura({ id: 40, cuenta_id: 4, validada: true, total: 62277.46 }),
    factura({ id: 50, cuenta_id: 5, validada: true, total: 29380.14, proveedor_id: 9 }),
    factura({ id: 60, cuenta_id: 6, validada: true, total: 100 }),
    // Directa del POS, sin controlar, pagada en efectivo: a validar
    factura({ id: 70, cuenta_id: null, pedido_id: null, es_directa: true, proveedor_id: 8, total: 69339.82, cuit_proveedor: null, fecha: '2026-10-17' }),
  ]
  return armarFilasPortal(cuentas, facturas, nombres)
}

test('armarFilasPortal: una fila por deuda más las directas sin deuda, ordenadas por urgencia', () => {
  const filas = escenario()
  assert.deepEqual(
    filas.map((f) => [f.clave, f.estado]),
    [
      ['c-3', 'vencida'],
      ['c-1', 'sin_factura'],
      ['c-2', 'a_validar'],
      ['c-4', 'a_pagar'],
      ['f-70', 'a_validar'], // sin vencimiento: al final de lo abierto
      ['c-5', 'pagada'], // pagadas: la más reciente primero
      ['c-6', 'pagada'],
    ]
  )
  const directa = filas.find((f) => f.clave === 'f-70')!
  assert.equal(directa.proveedor_nombre, 'ngb')
  assert.deepEqual(directa.marcas, ['pago_inmediato', 'sin_datos_fiscales'])
  assert.equal(directa.accion, 'validar')
  // El total de una deuda sin factura es el estimado de la recepción.
  assert.equal(filas.find((f) => f.clave === 'c-1')!.total, 471500)
  assert.equal(filas.find((f) => f.clave === 'c-2')!.total, 270776.72)
})

test('ordenar por fecha del comprobante: emisión, o recepción si no hay factura', () => {
  const filas = escenario()
  // c-1 no tiene factura → usa la recepción (12/10); el resto la emisión (15/10),
  // salvo la directa (17/10). Empates por clave.
  assert.deepEqual(
    ordenarFilas(filas, 'fecha_asc').map((f) => f.clave),
    ['c-1', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'f-70']
  )
  assert.deepEqual(
    ordenarFilas(filas, 'fecha_desc').map((f) => f.clave),
    ['f-70', 'c-2', 'c-3', 'c-4', 'c-5', 'c-6', 'c-1']
  )
  assert.deepEqual(ordenarFilas(filas, 'vencimiento').map((f) => f.clave), filas.map((f) => f.clave))
  assert.equal(filas.find((f) => f.clave === 'c-1')!.fecha_comprobante, '2026-10-12')
})

test('filtrar: estado, proveedor, texto y período (que solo acota las pagadas)', () => {
  const filas = escenario()
  const base = { estado: 'todas' as const, texto: '', proveedorId: null, desde: '2026-10-01', hasta: '2026-10-31' }
  // La pagada de septiembre queda afuera; lo abierto se ve siempre.
  assert.deepEqual(filtrarFilas(filas, base).map((f) => f.clave), ['c-3', 'c-1', 'c-2', 'c-4', 'f-70', 'c-5'])
  assert.deepEqual(filtrarFilas(filas, { ...base, estado: 'a_validar' }).map((f) => f.clave), ['c-2', 'f-70'])
  assert.deepEqual(filtrarFilas(filas, { ...base, proveedorId: 9 }).map((f) => f.clave), ['c-5'])
  assert.deepEqual(filtrarFilas(filas, { ...base, texto: 'fiambre' }).map((f) => f.clave), ['c-5'])
  assert.deepEqual(filtrarFilas(filas, { ...base, texto: '45812' }).map((f) => f.clave), ['c-3', 'c-2', 'c-4', 'f-70', 'c-5'])
  assert.deepEqual(filtrarFilas(filas, { ...base, texto: '0003-00045812' }).map((f) => f.clave), ['c-3', 'c-2', 'c-4', 'f-70', 'c-5'])
  assert.equal(filtrarFilas(filas, { ...base, texto: '#342' }).length, 5) // la directa no tiene pedido y la de septiembre está fuera del período
  assert.deepEqual(filtrarFilas(filas, { ...base, texto: 'nada' }), [])
})

test('resumen: cuatro tarjetas y conteo por pestaña', () => {
  const r = resumirPortal(escenario(), { desde: '2026-10-01', hasta: '2026-10-31', proveedorId: null })
  assert.deepEqual(r.sin_factura, { cantidad: 1, estimado: 471500 })
  assert.deepEqual(r.a_validar, { cantidad: 2, total: 270776.72 + 69339.82, con_diferencias: 0 })
  assert.equal(r.a_pagar.cantidad, 2)
  assert.equal(Math.round(r.a_pagar.saldo * 100) / 100, 350562.78)
  assert.equal(r.a_pagar.vencidas, 1)
  assert.equal(r.a_pagar.saldo_vencido, 288285.32)
  assert.deepEqual(r.pagadas, { cantidad: 1, total: 29380.14, sin_factura: 0 })
  assert.deepEqual(r.porEstado, { todas: 6, sin_factura: 1, a_validar: 2, a_pagar: 1, vencida: 1, pagada: 1 })
})
