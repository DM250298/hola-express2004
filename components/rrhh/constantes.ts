import { formatearFechaCorta } from '@/lib/utils/formato'
import type {
  RolOperativo,
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

/** Etiquetas legibles de los roles operativos (cadena de mando, Manual §3). */
export const ROLES_OPERATIVOS: Record<RolOperativo, string> = {
  direccion: 'Dirección',
  responsable_general: 'Encargada de Sucursal',
  encargado: 'Encargado/a de Turno',
  pivote: 'Pivot',
  compras: 'Compras',
  cajero: 'Cajero/a',
  fiambreria: 'Fiambrero/Producción',
  otro: 'Otro',
}

/** Nivel, autoridad y límites de cada rol (planilla "Organigrama y cadena de mando", Manual §3–4). */
export const DETALLE_ROL_OPERATIVO: Record<
  RolOperativo,
  { nivel: number; autoridad: string; noPuede: string }
> = {
  direccion: {
    nivel: 1,
    autoridad:
      'Personal, remuneraciones, cambios estructurales, sanciones graves, expulsiones.',
    noPuede: '—',
  },
  responsable_general: {
    nivel: 2,
    autoridad:
      'Responsable de la sucursal: supervisa al encargado/a de turno y al equipo, corrige, media, controla checklists y exige cumplimiento. Reporte semanal lunes AM.',
    noPuede: 'Sueldos; expulsiones y sanciones graves; compras directas; cancelar tareas críticas.',
  },
  encargado: {
    nivel: 3,
    autoridad: 'Coordinar el turno y exigir las tareas definidas.',
    noPuede: 'Cambios importantes; reasignaciones salvo fuerza mayor.',
  },
  pivote: {
    nivel: 3,
    autoridad: 'Cubre francos y ausencias según el cronograma; reporta a la Encargada de Sucursal.',
    noPuede: 'Cambiar procesos o prioridades.',
  },
  compras: {
    nivel: 3,
    autoridad: 'Abastecimiento, proveedores y reclamos dentro de parámetros. Reporta a Dirección.',
    noPuede: 'Compras extraordinarias sin Dirección.',
  },
  cajero: {
    nivel: 4,
    autoridad: 'Caja, orden, limpieza, aviso de faltantes e incidencias.',
    noPuede: 'Ajustes de stock; decisiones disciplinarias; resolver inventario o compras.',
  },
  fiambreria: {
    nivel: 4,
    autoridad: 'Producción planificada, control de insumos, reposición y orden.',
    noPuede: 'Cambiar el plan sin autorización; cambiar prioridades estructurales.',
  },
  otro: { nivel: 4, autoridad: '—', noPuede: '—' },
}

/** Orden jerárquico para listar el organigrama (de arriba hacia abajo). */
export const ORDEN_ROL_OPERATIVO: RolOperativo[] = [
  'direccion',
  'responsable_general',
  'encargado',
  'pivote',
  'compras',
  'cajero',
  'fiambreria',
  'otro',
]

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
