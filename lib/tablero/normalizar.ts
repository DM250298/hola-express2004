// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Tablero del dueño — normalización del JSON de fn_tablero_gerencial    ║
// ║                                                                        ║
// ║  La mig 318 (v3) suma al JSON las claves del margen neto de IVA:      ║
// ║  margen.{ingresos_netos, iva, devoluciones, anterior_ingresos_netos,  ║
// ║  regimen}, serie[].{ingresos_netos, devoluciones} y                   ║
// ║  top_skus[]/gondolas[].ingresos_netos. Si la 318 todavía no corrió,   ║
// ║  el JSON viejo no las trae y llegarían `undefined`.                   ║
// ║                                                                        ║
// ║  Este módulo garantiza que existan: `null` significa "la migración    ║
// ║  318 no corrió" (nunca se inventa un valor) y `regimen` cae a         ║
// ║  responsable inscripto. Módulo puro, sin imports en runtime, para     ║
// ║  que `node --test` lo corra sin alias.                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import type {
  GondolaTablero,
  PuntoSerieTablero,
  RegimenIva,
  SkuTopTablero,
  TableroGerencial,
} from '../queries/tablero'

type Diccionario = Record<string, unknown>

const REGIMENES: readonly RegimenIva[] = ['responsable_inscripto', 'monotributista', 'exento']

function esDiccionario(valor: unknown): valor is Diccionario {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

/** Número tal cual llega, o `null` si falta o no es un número válido. */
function numeroONull(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) ? valor : null
}

function regimenValido(valor: unknown): RegimenIva {
  return typeof valor === 'string' && (REGIMENES as readonly string[]).includes(valor)
    ? (valor as RegimenIva)
    : 'responsable_inscripto'
}

function normalizarMargen(margen: unknown): TableroGerencial['margen'] {
  const m: Diccionario = esDiccionario(margen) ? margen : {}
  return {
    ...(m as unknown as TableroGerencial['margen']),
    ingresos_netos: numeroONull(m.ingresos_netos),
    iva: numeroONull(m.iva),
    devoluciones: numeroONull(m.devoluciones),
    anterior_ingresos_netos: numeroONull(m.anterior_ingresos_netos),
    regimen: regimenValido(m.regimen),
  }
}

function normalizarSerie(serie: unknown): PuntoSerieTablero[] {
  if (!Array.isArray(serie)) return []
  return serie.map((punto) => {
    const p: Diccionario = esDiccionario(punto) ? punto : {}
    return {
      ...(p as unknown as PuntoSerieTablero),
      ingresos_netos: numeroONull(p.ingresos_netos),
      devoluciones: numeroONull(p.devoluciones),
    }
  })
}

function normalizarTopSkus(lista: unknown): SkuTopTablero[] {
  if (!Array.isArray(lista)) return []
  return lista.map((item) => {
    const s: Diccionario = esDiccionario(item) ? item : {}
    return {
      ...(s as unknown as SkuTopTablero),
      ingresos_netos: numeroONull(s.ingresos_netos),
    }
  })
}

function normalizarGondolas(lista: unknown): GondolaTablero[] {
  if (!Array.isArray(lista)) return []
  return lista.map((item) => {
    const g: Diccionario = esDiccionario(item) ? item : {}
    return {
      ...(g as unknown as GondolaTablero),
      ingresos_netos: numeroONull(g.ingresos_netos),
    }
  })
}

/**
 * Toma el JSON de fn_tablero_gerencial tal cual llega (v2 o v3) y devuelve
 * un TableroGerencial con el contrato v3 completo: las claves del margen
 * neto existen siempre (`null` = la mig 318 no corrió) y `regimen` es uno
 * de los tres valores conocidos (si falta o es inválido, responsable
 * inscripto). Todo lo demás se respeta sin tocar.
 */
export function normalizarTablero(crudo: unknown): TableroGerencial {
  const t: Diccionario = esDiccionario(crudo) ? crudo : {}
  return {
    ...(t as unknown as TableroGerencial),
    margen: normalizarMargen(t.margen),
    serie: normalizarSerie(t.serie),
    top_skus: normalizarTopSkus(t.top_skus),
    gondolas: normalizarGondolas(t.gondolas),
  }
}
