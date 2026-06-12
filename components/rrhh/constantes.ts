import { formatearFechaCorta } from '@/lib/utils/formato'
import type {
  TipoContrato,
  TipoDocumentoEmpleado,
  UnidadNegocio,
} from '@/types/database'

/**
 * Formatea una columna `date` (sin hora) en hora local. `new Date('2026-07-01')`
 * se parsea como medianoche UTC → en AR (UTC-3) muestra el día anterior. Anclar
 * 'T00:00:00' fuerza medianoche local y evita ese corrimiento de 1 día.
 */
export function fechaCortaLocal(d: string | null | undefined): string {
  if (!d) return '—'
  return formatearFechaCorta(`${d}T00:00:00`)
}

/** Etiquetas legibles de las unidades de negocio. */
export const UNIDADES_NEGOCIO: Record<UnidadNegocio, string> = {
  hola_express: 'Hola Express',
  nor_construcciones: 'NOR Construcciones',
  otra: 'Otra',
}

/** Etiquetas legibles de los tipos de contrato. */
export const TIPOS_CONTRATO: Record<TipoContrato, string> = {
  relacion_dependencia: 'Relación de dependencia',
  monotributista: 'Monotributista',
  informal_a_regularizar: 'Informal (a regularizar)',
}

/** Etiquetas legibles de los tipos de documento. */
export const TIPOS_DOCUMENTO: Record<TipoDocumentoEmpleado, string> = {
  dni: 'DNI',
  cuil: 'CUIL',
  contrato: 'Contrato',
  apto_medico: 'Apto médico',
  certificado: 'Certificado',
  otro: 'Otro',
}

/** Nombre + apellido para mostrar (apellido puede venir null en legacy). */
export function nombreCompleto(e: {
  nombre: string
  apellido?: string | null
}): string {
  return [e.nombre, e.apellido].filter(Boolean).join(' ').trim()
}

/** Iniciales para el avatar. */
export function iniciales(e: { nombre: string; apellido?: string | null }): string {
  const a = e.nombre?.[0] ?? ''
  const b = e.apellido?.[0] ?? e.nombre?.[1] ?? ''
  return (a + b).toUpperCase()
}
