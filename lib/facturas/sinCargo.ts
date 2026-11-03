// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Unidades SIN CARGO de un renglón de factura (mig 325) — lógica pura  ║
// ║                                                                        ║
// ║  "Compro 6 y me dan 1 gratis": las sin cargo entran al stock junto    ║
// ║  con las pagadas, pero NO son un descuento: no suman al neto, al IVA  ║
// ║  ni al costo del producto (que sigue siendo el unitario pagado,        ║
// ║  decisión del dueño 2026-11-03). Este módulo no importa Supabase para ║
// ║  que `node --test` lo corra; `ModalEditarFactura` lo consume.          ║
// ╚══════════════════════════════════════════════════════════════════════╝

const r2 = (n: number) => Math.round(n * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Valor numérico del input "Sin cargo": vacío, inválido o negativo → 0.
 * Tres decimales = `numeric(12,3)` de la base (productos por peso).
 */
export function parseSinCargo(s: string): number {
  const n = Number(s)
  if (!Number.isFinite(n) || n <= 0) return 0
  return r3(n)
}

/**
 * Mensaje de bloqueo (sin el nombre del producto) si lo tipeado no sirve.
 * Vacío = "ninguna", válido. null = OK.
 */
export function errorSinCargo(s: string): string | null {
  if (s.trim() === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return 'las unidades sin cargo tienen que ser un número.'
  if (n < 0) return 'las unidades sin cargo no pueden ser negativas.'
  return null
}

/** Unidades que el stock tiene que reflejar del renglón: pagadas + sin cargo. */
export function unidadesRenglon(cantidad: number, sinCargo: number): number {
  return r3((cantidad || 0) + (sinCargo || 0))
}

/**
 * Promedio INFORMATIVO: neto pagado ÷ (pagadas + sin cargo). Se muestra en
 * el renglón para que se vea cuánto sale cada unidad "de verdad", pero NO se
 * guarda: el costo del producto es el unitario pagado. null si no hay sin
 * cargo (no hay nada que informar) o no hay unidades.
 */
export function promedioConSinCargo(
  costoNeto: number,
  cantidad: number,
  sinCargo: number
): number | null {
  if (!(sinCargo > 0)) return null
  const total = (cantidad || 0) + sinCargo
  if (!(total > 0)) return null
  return r2((costoNeto * (cantidad || 0)) / total)
}

/**
 * ¿Lo que entra a stock (pagadas + sin cargo) difiere de lo recibido? Con
 * tolerancia: las cantidades por peso vienen de inputs decimales y un `!==`
 * pelado marcaba "ajusta stock" por un 0,0000001.
 */
export function difiereDeRecibido(
  unidades: number,
  recibida: number | null
): boolean {
  if (recibida == null) return false
  return Math.abs(unidades - recibida) > 1e-6
}

export interface LineaUnidades {
  cantidad: number
  sinCargo: number
  /** Lo recibido en el depósito. null = renglón extra (nadie lo recibió). */
  recibida: number | null
  /** Producto por peso: la cantidad es en kg y no se mezcla con unidades. */
  porPeso: boolean
}

export interface TotalesUnidades {
  /** Pagadas, en unidades y en kg. */
  facU: number
  facKg: number
  /** Sin cargo, en unidades y en kg. */
  scU: number
  scKg: number
  /** Recibidas (solo renglones de la orden), en unidades y en kg. */
  recU: number
  recKg: number
}

/** Σ del comprobante (pagadas y sin cargo) vs. lo recibido, separando kg. */
export function totalesUnidades(lineas: LineaUnidades[]): TotalesUnidades {
  const acc: TotalesUnidades = { facU: 0, facKg: 0, scU: 0, scKg: 0, recU: 0, recKg: 0 }
  for (const l of lineas) {
    if (l.porPeso) {
      acc.facKg += l.cantidad
      acc.scKg += l.sinCargo
      if (l.recibida != null) acc.recKg += l.recibida
    } else {
      acc.facU += l.cantidad
      acc.scU += l.sinCargo
      if (l.recibida != null) acc.recU += l.recibida
    }
  }
  return acc
}

/** ¿El total que entra a stock (pagadas + sin cargo) cierra con lo recibido? */
export function totalesDifieren(t: TotalesUnidades): boolean {
  return (
    Math.abs(t.facU + t.scU - t.recU) > 1e-6 ||
    Math.abs(t.facKg + t.scKg - t.recKg) > 1e-6
  )
}
