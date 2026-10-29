// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tests del motor de precios — casos 1..7 de la spec + invariante        ║
// ║                                                                        ║
// ║  Runner: node --test (Node 24 corre TS nativo por type-stripping).     ║
// ║    npm test                                                            ║
// ║                                                                        ║
// ║  Import con extensión .ts explícita: node --test la exige. Estos       ║
// ║  archivos *.test.ts están excluidos del `next build` (dev-only).       ║
// ║                                                                        ║
// ║  Tolerancias (de la spec): los precios de los casos toleran ±0.05 por  ║
// ║  redondeos intermedios; el invariante de ganancia se exige a ±0.01     ║
// ║  sobre el precio exacto; sobre el redondeado, ganancia ≥ objetivo.     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ErrorPricing,
  calcularDesdePrecio,
  calcularPrecio,
  desglosarTransaccionMP,
  detectarModoPrecio,
  redondearComercial,
  seleccionarPeorTasa,
} from './motor.ts'
import type { ConfigPricing, InputPrecio } from './tipos.ts'

/** Config base con los defaults de la spec. Cada test pisa lo que necesita. */
const CONFIG_BASE: ConfigPricing = {
  iva: 0.21,
  iibb: 0.03,
  debcred: 0.012,
  tasaMp: 0.008,
  redondeoMultiplo: 50,
}

const TOL_PRECIO = 0.05 // spec: ±0.05 por redondeos intermedios
const TOL_GANANCIA = 0.01 // spec: invariante a centavos

// ── Test 1 — RI, QR dinero en cuenta ─────────────────────────────────────
test('Test 1 — RI, QR dinero en cuenta (tasa 0.8%)', () => {
  const input: InputPrecio = {
    regimen: 'responsable_inscripto',
    costo: 10000,
    margen: 0.4,
  }
  const config: ConfigPricing = { ...CONFIG_BASE, tasaMp: 0.008 }
  const d = calcularPrecio(input, config)

  assert.ok(Math.abs(d.divisor - 0.937467) < 1e-5, `divisor ${d.divisor}`)
  assert.ok(
    Math.abs(d.precioNetoExacto - 14933.85) <= TOL_PRECIO,
    `neto ${d.precioNetoExacto}`
  )
  assert.ok(
    Math.abs(d.precioFinalExacto - 18069.96) <= TOL_PRECIO,
    `final ${d.precioFinalExacto}`
  )
  assert.ok(Math.abs(d.ganancia - 4000) < TOL_GANANCIA, `ganancia ${d.ganancia}`)
  assert.equal(d.precioRedondeado, 18100)
})

// ── Test 2 — RI, crédito inmediato (peor caso) ───────────────────────────
test('Test 2 — RI, crédito inmediato (tasa 6.29%) → criterio de aceptación', () => {
  const input: InputPrecio = {
    regimen: 'responsable_inscripto',
    costo: 10000,
    margen: 0.4,
  }
  const config: ConfigPricing = { ...CONFIG_BASE, tasaMp: 0.0629 }
  const d = calcularPrecio(input, config)

  assert.ok(Math.abs(d.divisor - 0.857088) < 1e-5, `divisor ${d.divisor}`)
  assert.ok(
    Math.abs(d.precioNetoExacto - 16334.37) <= TOL_PRECIO,
    `neto ${d.precioNetoExacto}`
  )
  // Criterio de aceptación: 19764.58. La fórmula da 19764.5957 (dentro de la
  // tolerancia ±0.05 que la propia spec sugiere).
  assert.ok(
    Math.abs(d.precioFinalExacto - 19764.58) <= TOL_PRECIO,
    `final ${d.precioFinalExacto}`
  )
  assert.ok(Math.abs(d.ganancia - 4000) < TOL_GANANCIA, `ganancia ${d.ganancia}`)
  // Redondeado exacto (criterio de aceptación).
  assert.equal(d.precioRedondeado, 19800)
})

// ── Test 3 — Monotributista, QR dinero en cuenta ─────────────────────────
test('Test 3 — Monotributista, QR dinero en cuenta (tasa 0.8%)', () => {
  const input: InputPrecio = {
    regimen: 'monotributista',
    costo: 12100, // con IVA
    margen: 0.4,
  }
  const config: ConfigPricing = { ...CONFIG_BASE, tasaMp: 0.008 }
  const d = calcularPrecio(input, config)

  assert.ok(Math.abs(d.divisor - 0.94832) < 1e-5, `divisor ${d.divisor}`)
  // La spec imprime 17863.22, pero 16940 / 0.948320 = 17863.17: el valor
  // publicado es un desliz de ~5¢ respecto de su propio divisor y ganancia
  // (ambos correctos). Por la decisión "la fórmula manda", asertamos el valor
  // aritméticamente exacto de la fórmula del Monotributo.
  assert.ok(
    Math.abs(d.precioFinalExacto - 17863.17) <= TOL_PRECIO,
    `final ${d.precioFinalExacto}`
  )
  assert.ok(Math.abs(d.ganancia - 4840) < TOL_GANANCIA, `ganancia ${d.ganancia}`)
})

// ── Test 4 — Divisor inválido ────────────────────────────────────────────
test('Test 4 — Divisor inválido → error explícito, nunca un precio', () => {
  const input: InputPrecio = {
    regimen: 'responsable_inscripto',
    costo: 10000,
    margen: 0.4,
  }
  const config: ConfigPricing = {
    ...CONFIG_BASE,
    iibb: 0.5,
    debcred: 0.3,
    tasaMp: 0.2,
  }
  assert.throws(() => calcularPrecio(input, config), ErrorPricing)

  // También en Monotributo (cargas > 100% sin el gross-up de IVA).
  assert.throws(
    () => calcularPrecio({ ...input, regimen: 'monotributista' }, config),
    ErrorPricing
  )
})

// ── Test 5 — Redondeo comercial a $50 hacia arriba ───────────────────────
test('Test 5 — Redondeo comercial a $50 SIEMPRE hacia arriba', () => {
  assert.equal(redondearComercial(19764.58, 50), 19800)
  assert.equal(redondearComercial(18069.96, 50), 18100)
  assert.equal(redondearComercial(17950.0, 50), 17950) // múltiplo exacto, no sube
  assert.equal(redondearComercial(17950.01, 50), 18000)
  // Ejemplos de la sección 3 de la spec.
  assert.equal(redondearComercial(19620.38, 50), 19650)
  assert.equal(redondearComercial(17949.33, 50), 17950)

  // Sobre el precio redondeado la ganancia debe ser ≥ la objetivo, nunca menor.
  const d = calcularPrecio(
    { regimen: 'responsable_inscripto', costo: 10000, margen: 0.4 },
    { ...CONFIG_BASE, tasaMp: 0.0629 }
  )
  assert.ok(
    d.margenExtraRedondeo >= -TOL_GANANCIA,
    `margen extra ${d.margenExtraRedondeo} no puede ser negativo`
  )
  assert.ok(d.precioRedondeado >= d.precioFinalExacto)
})

// ── Test 6 — Selección automática del peor caso ──────────────────────────
test('Test 6 — el pricing usa siempre max() de las tasas configuradas', () => {
  assert.equal(seleccionarPeorTasa([0.008, 0.0325, 0.0439, 0.0629]), 0.0629)
  // Se actualiza la config: pasa a usar la nueva peor tasa sin tocar código.
  assert.equal(seleccionarPeorTasa([0.008, 0.0325, 0.0439, 0.0699]), 0.0699)
  assert.throws(() => seleccionarPeorTasa([]), ErrorPricing)

  // El precio sigue a la peor tasa: subirla encarece el precio.
  const input: InputPrecio = {
    regimen: 'responsable_inscripto',
    costo: 10000,
    margen: 0.4,
  }
  const precioA = calcularPrecio(input, {
    ...CONFIG_BASE,
    tasaMp: seleccionarPeorTasa([0.008, 0.0325, 0.0439, 0.0629]),
  }).precioFinalExacto
  const precioB = calcularPrecio(input, {
    ...CONFIG_BASE,
    tasaMp: seleccionarPeorTasa([0.008, 0.0325, 0.0439, 0.0699]),
  }).precioFinalExacto
  assert.ok(precioB > precioA, `subir la peor tasa debe encarecer (${precioA} → ${precioB})`)
})

// ── Test 7 — Verificación contra transacción real (regresión) ────────────
test('Test 7 — reproduce los descuentos de una venta real por QR', () => {
  const d = desglosarTransaccionMP(6599.98, {
    iibb: 0.03,
    debcredEntrada: 0.006, // solo la pata de entrada aparece en la liquidación MP
    tasaMp: 0.008,
    iva: 0.21,
  })
  assert.ok(Math.abs(d.debcredMonto - 39.6) <= TOL_PRECIO, `débcréd ${d.debcredMonto}`)
  assert.ok(Math.abs(d.iibbMonto - 198.0) <= TOL_PRECIO, `iibb ${d.iibbMonto}`)
  assert.ok(Math.abs(d.comisionMonto - 63.89) <= TOL_PRECIO, `comisión ${d.comisionMonto}`)
  assert.ok(Math.abs(d.netoRecibido - 6298.49) <= TOL_PRECIO, `neto ${d.netoRecibido}`)
})

// ── IVA de venta por producto (ej: pan al 10.5%) ─────────────────────────
test('IVA venta por producto — gross-up con IVA propio, comisión MP con IVA general', () => {
  const config: ConfigPricing = { ...CONFIG_BASE, tasaMp: 0.0629 }
  const input: InputPrecio = {
    regimen: 'responsable_inscripto',
    costo: 10000,
    margen: 0.4,
    ivaVenta: 0.105,
  }
  const d = calcularPrecio(input, config)

  // Cálculo de referencia a mano: comEf usa el IVA GENERAL (21%, servicio de
  // MP); el gross-up y neto→total usan el IVA del producto (10.5%).
  const comEf = 0.0629 * 1.21
  const cargas = 0.03 + 0.012 + comEf
  const divisor = 1 - cargas * 1.105
  const neto = 14000 / divisor
  const final = neto * 1.105
  assert.ok(Math.abs(d.divisor - divisor) < 1e-12, `divisor ${d.divisor}`)
  assert.ok(Math.abs(d.precioFinalExacto - final) < 1e-9, `final ${d.precioFinalExacto}`)

  // Invariante con IVA propio: la ganancia se reconstruye igual.
  assert.ok(
    Math.abs(d.gananciaReal - 4000) < TOL_GANANCIA,
    `ganancia ${d.gananciaReal}`
  )
  // Sin ivaVenta explícito cae al IVA general (comportamiento anterior intacto).
  const d21 = calcularPrecio({ ...input, ivaVenta: undefined }, config)
  assert.ok(Math.abs(d21.precioFinalExacto - 19764.58) <= TOL_PRECIO)
})

// ── Invariante (property test) ───────────────────────────────────────────
// Para cualquier input válido, el desglose debe reconstruir la ganancia
// objetivo con tolerancia de $0.01 sobre el precio pre-redondeo; y sobre el
// precio redondeado la ganancia real nunca puede quedar por debajo de la
// objetivo.

/** PRNG determinístico (LCG) para que el property test sea reproducible. */
function prng(semilla: number): () => number {
  let estado = semilla >>> 0
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0
    return estado / 0xffffffff
  }
}

test('Invariante — la ganancia se reconstruye para todo input válido', () => {
  const rnd = prng(20260713)
  const regimenes: InputPrecio['regimen'][] = [
    'responsable_inscripto',
    'monotributista',
  ]
  let casos = 0

  for (let i = 0; i < 5000; i++) {
    const config: ConfigPricing = {
      iva: 0.105 + rnd() * 0.16, // 10.5%..26.5%
      iibb: rnd() * 0.05, // 0..5%
      debcred: rnd() * 0.02, // 0..2%
      tasaMp: rnd() * 0.08, // 0..8%
      redondeoMultiplo: [10, 50, 100][Math.floor(rnd() * 3)],
    }
    const input: InputPrecio = {
      regimen: regimenes[Math.floor(rnd() * regimenes.length)],
      costo: 1 + rnd() * 100000,
      margen: rnd() * 2, // 0..200%
      // La mitad de los casos con IVA de venta propio (0%, 10.5%, 21%, 27%).
      ivaVenta:
        rnd() < 0.5 ? [0, 0.105, 0.21, 0.27][Math.floor(rnd() * 4)] : undefined,
    }

    let d
    try {
      d = calcularPrecio(input, config)
    } catch (e) {
      // Un divisor ≤ 0 debe abortar con ErrorPricing, nunca dar un precio.
      assert.ok(e instanceof ErrorPricing)
      continue
    }
    casos++

    // El divisor válido nunca produce precios inválidos.
    assert.ok(
      Number.isFinite(d.precioFinalExacto) && d.precioFinalExacto > 0,
      `precio inválido: ${d.precioFinalExacto}`
    )

    // Invariante principal: ganancia reconstruida = objetivo (±$0.01).
    assert.ok(
      Math.abs(d.gananciaReal - d.ganancia) < TOL_GANANCIA,
      `ganancia ${d.gananciaReal} ≠ objetivo ${d.ganancia} (Δ ${d.gananciaReal - d.ganancia})`
    )

    // Sobre el redondeado, la ganancia real nunca queda por debajo de la objetivo.
    assert.ok(
      d.margenExtraRedondeo >= -TOL_GANANCIA,
      `redondeo erosiona margen: extra ${d.margenExtraRedondeo}`
    )
    assert.ok(d.precioRedondeado >= d.precioFinalExacto)
  }

  assert.ok(casos > 4000, `deberían pasar casi todos los casos válidos (${casos}/5000)`)
})

// ── Inverso: round-trip margen → precio → margen ─────────────────────────
// calcularDesdePrecio es el espejo de calcularPrecio: sobre el precio EXACTO
// devuelve el mismo margen; sobre el REDONDEADO devuelve uno ≥ (el techo nunca
// baja el margen) y el par inverso (ese margen → precio) cierra sobre el
// redondeado. Es la base de "el margen guardado es siempre el real del par"
// (migs 322–324).
test('Inverso — round-trip margen → precio → margen cierra, y el redondeo solo suma', () => {
  const config: ConfigPricing = { ...CONFIG_BASE, tasaMp: 0.0629 }
  const regimenes: InputPrecio['regimen'][] = [
    'responsable_inscripto',
    'monotributista',
  ]
  const costos = [100, 3262.24, 10000]
  const margenes = [0, 0.1697, 0.4, 1.2]
  const ivas: (number | undefined)[] = [undefined, 0, 0.105, 0.21]
  let casos = 0
  for (const regimen of regimenes) {
    for (const costo of costos) {
      for (const margen of margenes) {
        for (const ivaVenta of ivas) {
          const input: InputPrecio = { regimen, costo, margen, ivaVenta }
          const d = calcularPrecio(input, config)
          const etiqueta = `${regimen} costo ${costo} margen ${margen} iva ${ivaVenta}`

          const inv = calcularDesdePrecio(d.precioFinalExacto, input, config)
          assert.ok(
            inv.margen != null && Math.abs(inv.margen - margen) < 1e-9,
            `round-trip exacto (${etiqueta}): ${inv.margen}`
          )

          const invR = calcularDesdePrecio(d.precioRedondeado, input, config)
          assert.ok(
            invR.margen != null && invR.margen >= margen - 1e-9,
            `el techo nunca baja el margen (${etiqueta}): ${invR.margen}`
          )
          const vuelta = calcularPrecio({ ...input, margen: invR.margen ?? 0 }, config)
          assert.ok(
            Math.abs(vuelta.precioFinalExacto - d.precioRedondeado) < 1e-6,
            `par inverso cierra (${etiqueta}): ${vuelta.precioFinalExacto} vs ${d.precioRedondeado}`
          )
          casos++
        }
      }
    }
  }
  assert.equal(casos, 96)
})

// El caso que disparó las migs 322–324: Trix, precio vigente $7.400,27. Con el
// costo nuevo ($3.262,24) deja ≈ 60,7 % neto; con el costo viejo ($4.481) el
// mismo precio dejaba ≈ 17 %, que es el margen que había quedado guardado.
test('Inverso — Trix: el mismo precio deja 60,7 % con el costo nuevo y 17 % con el viejo', () => {
  // Tasas del comercio: IIBB 3 %, créd/déb 1,2 %, MP 7,61 % con IVA (6,29 % sin).
  const config: ConfigPricing = { ...CONFIG_BASE, tasaMp: 0.0629 }
  const base = { regimen: 'responsable_inscripto' as const, ivaVenta: 0.21 }
  const nuevo = calcularDesdePrecio(7400.27, { ...base, costo: 3262.24 }, config)
  assert.ok(
    nuevo.margen != null && Math.abs(nuevo.margen - 0.607) < 0.002,
    `margen con costo nuevo: ${nuevo.margen}`
  )
  const viejo = calcularDesdePrecio(7400.27, { ...base, costo: 4481 }, config)
  assert.ok(
    viejo.margen != null && Math.abs(viejo.margen - 0.17) < 0.002,
    `margen con costo viejo: ${viejo.margen}`
  )
})

// ── Modo inicial de la ficha ─────────────────────────────────────────────
test('detectarModoPrecio — por margen si el margen reproduce el precio; por precio si no', () => {
  const config: ConfigPricing = { ...CONFIG_BASE, tasaMp: 0.0629 }
  const ri = { regimen: 'responsable_inscripto' as const, ivaVentaPct: 21 }
  const precioPorMargen = calcularPrecio(
    { regimen: 'responsable_inscripto', costo: 1000, margen: 0.3, ivaVenta: 0.21 },
    config
  ).precioRedondeado

  // Puesto por margen: el motor reproduce el precio → "por margen".
  assert.equal(
    detectarModoPrecio({ ...ri, precio: precioPorMargen, costo: 1000, margenPct: 30 }, config),
    'margen'
  )
  // El costo bajó a 800 y nadie tocó el margen: ya no lo reproduce → "por precio".
  assert.equal(
    detectarModoPrecio({ ...ri, precio: precioPorMargen, costo: 800, margenPct: 30 }, config),
    'precio'
  )
  // Precio a mano (no múltiplo de $50 que salga de 16,97 %) → "por precio".
  assert.equal(
    detectarModoPrecio({ ...ri, precio: 7400.27, costo: 3262.24, margenPct: 16.97 }, config),
    'precio'
  )
  // Sin precio no hay nada que conservar → "por margen".
  assert.equal(
    detectarModoPrecio({ ...ri, precio: 0, costo: 1000, margenPct: 30 }, config),
    'margen'
  )
  // Config rota (cargas > 100 %): no revienta, abre con el vigente.
  assert.equal(
    detectarModoPrecio(
      { ...ri, precio: 1500, costo: 1000, margenPct: 30 },
      { ...config, iibb: 0.9 }
    ),
    'precio'
  )
})
