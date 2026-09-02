// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests de la reconciliación del borrador de recepción                 ║
// ║                                                                        ║
// ║  Runner: node --test.  npm test                                        ║
// ║                                                                        ║
// ║  El borrador viene de localStorage: puede ser de una versión vieja,    ║
// ║  estar corrupto, o referirse a renglones que otra sesión ya borró de   ║
// ║  la orden. Reconciliar mal significa restaurar una recepción que no    ║
// ║  se corresponde con lo que hay que recibir.                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BORRADOR_RECEPCION_V,
  borradorInicial,
  claveBorradorRecepcion,
  facturaEnBlanco,
  facturaVacia,
  reconciliarBorrador,
  unidadesDeCargas,
  type BorradorRecepcion,
  type RenglonVivo,
} from './borrador.ts'

/** Los tres renglones de la orden, sin nada recibido en entregas anteriores. */
const VIVOS: RenglonVivo[] = [
  { item_id: 1, ya_recibido: 0 },
  { item_id: 2, ya_recibido: 0 },
  { item_id: 3, ya_recibido: 0 },
]

/** Los mismos, filtrando los que ya no existen en la orden. */
function vivosSalvo(...fuera: number[]): RenglonVivo[] {
  return VIVOS.filter((r) => !fuera.includes(r.item_id))
}

/** Borrador de referencia: 2 facturas, renglones 1 y 2 en la primera. */
function base(): BorradorRecepcion {
  return {
    v: BORRADOR_RECEPCION_V,
    facturas: [
      {
        id: 't1',
        numero: '0001-00012345',
        cargas: {
          1: { cantidad: '12', fecha_vencimiento: '2027-03-15' },
          2: { cantidad: '6', fecha_vencimiento: '' },
        },
        orden: [2, 1],
      },
      {
        id: 't2',
        numero: '0001-00012346',
        cargas: { 3: { cantidad: '4', fecha_vencimiento: '' } },
        orden: [3],
      },
    ],
    activaIdx: 1,
    proximaTab: 3,
    nombres: { 1: 'Coca Cola 2,25 L', 2: 'Fideos Matarazzo', 3: 'Yerba Playadito' },
    yaRecibido: {},
  }
}

test('un borrador sano vuelve entero', () => {
  const r = reconciliarBorrador(base(), VIVOS)
  assert.ok(r)
  assert.equal(r.descartados.length, 0)
  assert.equal(r.borrador.facturas.length, 2)
  assert.equal(r.borrador.activaIdx, 1)
  // El orden del papel se respeta tal cual: el 2 va antes que el 1.
  assert.deepEqual(r.borrador.facturas[0].orden, [2, 1])
  assert.equal(r.borrador.facturas[0].cargas[1].cantidad, '12')
})

test('version distinta: se descarta todo', () => {
  assert.equal(reconciliarBorrador({ ...base(), v: 0 }, VIVOS), null)
  assert.equal(reconciliarBorrador({ ...base(), v: 99 }, VIVOS), null)
})

test('entrada corrupta o vacia: se descarta sin explotar', () => {
  assert.equal(reconciliarBorrador(null, VIVOS), null)
  assert.equal(reconciliarBorrador(undefined, VIVOS), null)
  assert.equal(reconciliarBorrador('texto', VIVOS), null)
  assert.equal(reconciliarBorrador(42, VIVOS), null)
  assert.equal(reconciliarBorrador({}, VIVOS), null)
  assert.equal(reconciliarBorrador({ v: BORRADOR_RECEPCION_V }, VIVOS), null)
  assert.equal(
    reconciliarBorrador({ v: BORRADOR_RECEPCION_V, facturas: [] }, VIVOS),
    null
  )
})

test('renglon que ya no esta en la orden: se saca y se reporta', () => {
  // Otra sesión confirmó un "no vino" y borró el renglón 2.
  const r = reconciliarBorrador(base(), vivosSalvo(2))
  assert.ok(r)
  assert.deepEqual(r.descartados, [2])
  assert.deepEqual(r.borrador.facturas[0].orden, [1])
  assert.equal(r.borrador.facturas[0].cargas[2], undefined)
  // Lo que sí sigue vivo no se toca.
  assert.equal(r.borrador.facturas[0].cargas[1].cantidad, '12')
})

test('renglon nuevo en la orden: no entra a ninguna factura', () => {
  const r = reconciliarBorrador(base(), [...VIVOS, { item_id: 99, ya_recibido: 0 }])
  assert.ok(r)
  const enFacturas = r.borrador.facturas.flatMap((f) => f.orden)
  assert.equal(enFacturas.includes(99), false)
})

test('una carga sin lugar en el orden se acomoda al final', () => {
  const bor = base()
  bor.facturas[0].orden = [1] // el 2 tiene carga pero quedó fuera del orden
  const r = reconciliarBorrador(bor, VIVOS)
  assert.ok(r)
  assert.deepEqual(r.borrador.facturas[0].orden, [1, 2])
})

test('el orden se deduplica', () => {
  const bor = base()
  bor.facturas[0].orden = [1, 1, 2, 1]
  const r = reconciliarBorrador(bor, VIVOS)
  assert.ok(r)
  assert.deepEqual(r.borrador.facturas[0].orden, [1, 2])
})

test('activaIdx fuera de rango se clampea', () => {
  const r1 = reconciliarBorrador({ ...base(), activaIdx: 47 }, VIVOS)
  assert.ok(r1)
  assert.equal(r1.borrador.activaIdx, 1) // hay 2 facturas → máximo 1

  const r2 = reconciliarBorrador({ ...base(), activaIdx: -3 }, VIVOS)
  assert.ok(r2)
  assert.equal(r2.borrador.activaIdx, 0)

  const r3 = reconciliarBorrador({ ...base(), activaIdx: 'dos' }, VIVOS)
  assert.ok(r3)
  assert.equal(r3.borrador.activaIdx, 0)
})

test('si no quedo nada, se descarta el borrador', () => {
  // Todos los renglones del borrador desaparecieron y no había N° tipeado.
  const bor = base()
  bor.facturas[0].numero = ''
  bor.facturas[1].numero = ''
  assert.equal(reconciliarBorrador(bor, [{ item_id: 77, ya_recibido: 0 }]), null)
})

test('una factura con numero tipeado y sin renglones igual se conserva', () => {
  const bor: BorradorRecepcion = {
    ...borradorInicial(),
    facturas: [{ id: 't1', numero: '0001-9', cargas: {}, orden: [] }],
  }
  const r = reconciliarBorrador(bor, VIVOS)
  assert.ok(r)
  assert.equal(r.borrador.facturas[0].numero, '0001-9')
})

test('las pestanas vacias del final se recortan, las del medio no', () => {
  const bor = base()
  bor.facturas.push(facturaVacia('t3'))
  bor.facturas.push(facturaVacia('t4'))
  const r = reconciliarBorrador(bor, VIVOS)
  assert.ok(r)
  assert.equal(r.borrador.facturas.length, 2)

  const conHueco = base()
  conHueco.facturas.splice(1, 0, facturaVacia('tX'))
  const r2 = reconciliarBorrador(conHueco, VIVOS)
  assert.ok(r2)
  assert.equal(r2.borrador.facturas.length, 3)
})

test('proximaTab nunca colisiona con las pestanas existentes', () => {
  const r = reconciliarBorrador({ ...base(), proximaTab: 1 }, VIVOS)
  assert.ok(r)
  assert.ok(r.borrador.proximaTab > r.borrador.facturas.length)
})

test('cargas vacias no se conservan', () => {
  const bor = base()
  bor.facturas[0].cargas[3] = { cantidad: '', fecha_vencimiento: '' }
  const r = reconciliarBorrador(bor, VIVOS)
  assert.ok(r)
  assert.equal(r.borrador.facturas[0].cargas[3], undefined)
})

test('sin_vencimiento sobrevive aunque no haya cantidad', () => {
  const bor = base()
  bor.facturas[0].cargas[3] = {
    cantidad: '',
    fecha_vencimiento: '',
    sin_vencimiento: true,
  }
  const r = reconciliarBorrador(bor, VIVOS)
  assert.ok(r)
  assert.equal(r.borrador.facturas[0].cargas[3]?.sin_vencimiento, true)
})

test('unidadesDeCargas suma lo cargado e ignora lo vacio', () => {
  assert.equal(unidadesDeCargas({}), 0)
  assert.equal(
    unidadesDeCargas({
      1: { cantidad: '12', fecha_vencimiento: '' },
      2: { cantidad: '', fecha_vencimiento: '2027-01-01' },
      3: { cantidad: '2.5', fecha_vencimiento: '' },
    }),
    14.5
  )
})

test('facturaEnBlanco distingue lo abierto por error de lo cargado', () => {
  assert.equal(facturaEnBlanco(facturaVacia('t1')), true)
  assert.equal(
    facturaEnBlanco({ id: 't1', numero: '9', cargas: {}, orden: [] }),
    false
  )
  assert.equal(
    facturaEnBlanco({ id: 't1', numero: '', cargas: {}, orden: [5] }),
    false
  )
})

test('la clave del borrador es por pedido', () => {
  assert.equal(claveBorradorRecepcion(155), 'recepcion-p155')
  assert.notEqual(claveBorradorRecepcion(155), claveBorradorRecepcion(156))
})

test('el banner puede nombrar los renglones que se perdieron', () => {
  const r = reconciliarBorrador(base(), vivosSalvo(2))
  assert.ok(r)
  assert.deepEqual(r.nombresDescartados, ['Fideos Matarazzo'])
})

test('un renglon sin cantidad que desaparece no se nombra', () => {
  // El 3 está en la factura 2 con cantidad; el que no tiene carga es otro.
  const bor = base()
  delete bor.facturas[1].cargas[3]
  bor.facturas[1].orden = []
  const r = reconciliarBorrador(bor, vivosSalvo(3))
  assert.ok(r)
  assert.deepEqual(r.descartados, [])
  assert.deepEqual(r.nombresDescartados, [])
})

test('avisa cuando otra entrega ya recibio un renglon', () => {
  const bor = base()
  bor.yaRecibido = { 1: 0, 2: 0, 3: 0 }
  // En la base el renglón 1 ya tiene 12 recibidas que el borrador no conocía.
  const r = reconciliarBorrador(bor, [
    { item_id: 1, ya_recibido: 12 },
    { item_id: 2, ya_recibido: 0 },
    { item_id: 3, ya_recibido: 0 },
  ])
  assert.ok(r)
  assert.deepEqual(r.recibidoCambio, [1])
  // Lo tipeado NO se pisa: el empleado decide, con el aviso a la vista.
  assert.equal(r.borrador.facturas[0].cargas[1].cantidad, '12')
  // Y la foto queda actualizada con lo que dice la base.
  assert.equal(r.borrador.yaRecibido[1], 12)
})

test('los kilos no disparan un aviso falso por decimales', () => {
  const bor = base()
  bor.yaRecibido = { 1: 2.5, 2: 0, 3: 0 }
  const r = reconciliarBorrador(bor, [
    { item_id: 1, ya_recibido: 2.5001 }, // menos de 1 gramo de diferencia
    { item_id: 2, ya_recibido: 0 },
    { item_id: 3, ya_recibido: 0 },
  ])
  assert.ok(r)
  assert.deepEqual(r.recibidoCambio, [])
})

test('la autorizacion de supervisor nunca se persiste', () => {
  // Aunque un borrador manipulado a mano la traiga, no hay forma de que entre:
  // el tipo no la tiene y la reconciliación no la copia.
  const conTrampa = { ...base(), excesoAutorizado: true, autorizadoPor: 'nadie' }
  const r = reconciliarBorrador(conTrampa, VIVOS)
  assert.ok(r)
  assert.equal('excesoAutorizado' in r.borrador, false)
  assert.equal('autorizadoPor' in r.borrador, false)
})
