// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Régimen fiscal del comercio a partir de config_fiscal.condicion_iva   ║
// ║                                                                        ║
// ║  Un solo lugar para la traducción: la mig 311 unificó el valor         ║
// ║  guardado en 'monotributista', pero el histórico y el formulario       ║
// ║  pueden traer 'monotributo'. El monotributista y el exento no          ║
// ║  discriminan IVA, así que para el motor de precios son el mismo        ║
// ║  régimen. Módulo puro, sin imports en runtime (node --test).           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import type { RegimenFiscal } from './tipos'

const SIN_IVA_DISCRIMINADO: ReadonlySet<string> = new Set([
  'monotributo',
  'monotributista',
  'exento',
])

/**
 * Mapea la condición frente al IVA guardada en config_fiscal al régimen del
 * motor de precios. Tolera mayúsculas y espacios; cualquier valor vacío o
 * desconocido se trata como responsable inscripto (el caso del comercio).
 */
export function regimenDesdeCondicionIva(
  condicionIva: string | null | undefined
): RegimenFiscal {
  const clave = (condicionIva ?? '').trim().toLowerCase()
  return SIN_IVA_DISCRIMINADO.has(clave) ? 'monotributista' : 'responsable_inscripto'
}
