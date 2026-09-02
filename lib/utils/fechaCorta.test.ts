// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del parser de fechas de vencimiento tipeadas                   ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  Un error acá se traduce en lotes cargados con el vencimiento          ║
// ║  equivocado, así que el foco está en los bordes: fechas que no         ║
// ║  existen, febrero bisiesto y la trampa de zona horaria (UTC vs. AR).   ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aTipeo,
  describirVencimiento,
  diasHasta,
  fechaLocalDesdeIso,
  formatearTipeo,
  parsearFechaCorta,
} from './fechaCorta.ts'

test('formatearTipeo inserta las barras a medida que se escribe', () => {
  assert.equal(formatearTipeo(''), '')
  assert.equal(formatearTipeo('1'), '1')
  assert.equal(formatearTipeo('15'), '15')
  assert.equal(formatearTipeo('150'), '15/0')
  assert.equal(formatearTipeo('1503'), '15/03')
  assert.equal(formatearTipeo('15032'), '15/03/2')
  assert.equal(formatearTipeo('150327'), '15/03/27')
  assert.equal(formatearTipeo('15032027'), '15/03/2027')
})

test('formatearTipeo ignora lo que no sea dígito y corta en 8', () => {
  assert.equal(formatearTipeo('15/03/27'), '15/03/27')
  assert.equal(formatearTipeo('15-03-27'), '15/03/27')
  assert.equal(formatearTipeo('L 15 03 27'), '15/03/27')
  assert.equal(formatearTipeo('150320279999'), '15/03/2027')
})

test('4 dígitos (MM/AA) caen al último día del mes', () => {
  assert.equal(parsearFechaCorta('0327'), '2027-03-31')
  assert.equal(parsearFechaCorta('0227'), '2027-02-28')
  assert.equal(parsearFechaCorta('0228'), '2028-02-29') // bisiesto
  assert.equal(parsearFechaCorta('0427'), '2027-04-30')
  assert.equal(parsearFechaCorta('1227'), '2027-12-31')
})

test('6 dígitos (DD/MM/AA) y 8 dígitos (DD/MM/AAAA)', () => {
  assert.equal(parsearFechaCorta('150327'), '2027-03-15')
  assert.equal(parsearFechaCorta('15032027'), '2027-03-15')
  assert.equal(parsearFechaCorta('01012030'), '2030-01-01')
  assert.equal(parsearFechaCorta('311226'), '2026-12-31')
})

test('acepta la entrada ya formateada (el input manda con barras)', () => {
  assert.equal(parsearFechaCorta('15/03/27'), '2027-03-15')
  assert.equal(parsearFechaCorta('03/27'), '2027-03-31')
})

test('rechaza fechas que no existen', () => {
  assert.equal(parsearFechaCorta('310227'), null) // 31 de febrero
  assert.equal(parsearFechaCorta('320327'), null) // día 32
  assert.equal(parsearFechaCorta('151327'), null) // mes 13
  assert.equal(parsearFechaCorta('150027'), null) // mes 0
  assert.equal(parsearFechaCorta('000327'), null) // día 0
  assert.equal(parsearFechaCorta('310427'), null) // abril tiene 30
  assert.equal(parsearFechaCorta('1327'), null) // MM/AA con mes 13
  assert.equal(parsearFechaCorta('0027'), null) // MM/AA con mes 0
})

test('29 de febrero solo en año bisiesto', () => {
  assert.equal(parsearFechaCorta('290228'), '2028-02-29')
  assert.equal(parsearFechaCorta('290227'), null)
})

test('rechaza largos que no son 4, 6 ni 8 dígitos', () => {
  for (const malo of ['', '1', '12', '123', '12345', '1234567', '123456789']) {
    assert.equal(parsearFechaCorta(malo), null, `debería rechazar "${malo}"`)
  }
})

test('el año de 2 dígitos siempre se lee como 20AA', () => {
  assert.equal(parsearFechaCorta('150300'), '2000-03-15')
  assert.equal(parsearFechaCorta('150399'), '2099-03-15')
})

test('zona horaria: ninguna entrada devuelve el día anterior', () => {
  // La trampa clásica: new Date('2027-03-15') parsea en UTC y en AR (UTC−3)
  // cae el 14 a las 21:00. El parser arma la fecha en hora local, así que el
  // día que sale tiene que ser exactamente el que se tipeó.
  for (let mes = 1; mes <= 12; mes++) {
    const mm = String(mes).padStart(2, '0')
    const iso = parsearFechaCorta(`01${mm}27`)
    assert.equal(iso, `2027-${mm}-01`, `mes ${mm} corrido de día`)
  }
})

test('aTipeo es la vuelta de parsearFechaCorta', () => {
  for (const tipeado of ['150327', '010130', '311226']) {
    const iso = parsearFechaCorta(tipeado)
    assert.ok(iso)
    assert.equal(aTipeo(iso), formatearTipeo(tipeado))
  }
  assert.equal(aTipeo('2027-03-15'), '15/03/27')
  assert.equal(aTipeo('cualquiera'), '')
})

test('fechaLocalDesdeIso arma la fecha a las 00:00 locales', () => {
  const f = fechaLocalDesdeIso('2027-03-15')
  assert.ok(f)
  assert.equal(f.getFullYear(), 2027)
  assert.equal(f.getMonth(), 2)
  assert.equal(f.getDate(), 15)
  assert.equal(f.getHours(), 0)
  assert.equal(fechaLocalDesdeIso('15/03/2027'), null)
})

test('diasHasta cuenta desde las 00:00 de hoy', () => {
  const hoy = new Date(2026, 8, 1) // 1 de septiembre de 2026
  assert.equal(diasHasta('2026-09-01', hoy), 0)
  assert.equal(diasHasta('2026-09-02', hoy), 1)
  assert.equal(diasHasta('2026-08-31', hoy), -1)
  assert.equal(diasHasta('2026-09-11', hoy), 10)
  assert.equal(diasHasta('no-es-fecha', hoy), null)
})

test('diasHasta no se corre con el horario de verano', () => {
  // Si el rango cruza un cambio de hora, la resta en milisegundos da 179,96 o
  // 180,04 días: el redondeo tiene que dejarlo en entero exacto igual.
  const hoy = new Date(2026, 8, 1)
  assert.equal(diasHasta('2027-03-01', hoy), 181)
  assert.equal(Number.isInteger(diasHasta('2027-03-01', hoy)), true)
})

test('describirVencimiento habla en criollo', () => {
  const hoy = new Date(2026, 8, 1)
  assert.equal(describirVencimiento('2026-09-01', hoy), 'Vence hoy')
  assert.equal(describirVencimiento('2026-09-02', hoy), 'Vence mañana')
  assert.equal(describirVencimiento('2026-09-11', hoy), 'Vence en 10 días')
  assert.equal(describirVencimiento('2026-08-30', hoy), 'Vencido hace 2 días')
  assert.equal(describirVencimiento('2026-08-31', hoy), 'Vencido hace 1 día')
  assert.equal(describirVencimiento('2027-03-01', hoy), 'Vence en 6 meses')
  assert.equal(describirVencimiento('2029-09-01', hoy), 'Vence en 3 años')
})
