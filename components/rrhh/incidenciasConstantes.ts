import type { GravedadIncidencia, TipoSancion } from '@/types/database'

/** Escala operativa de 30 días (Manual Maestro §8). */
export const INSTANCIA_INCIDENCIA: Record<number, { corta: string; larga: string; clase: string }> = {
  1: {
    corta: '1ª',
    larga: 'Registro + corrección inmediata',
    clase: 'bg-[#e4c9b0]/50 text-[#6f3a2a]',
  },
  2: {
    corta: '2ª',
    larga: 'Observación formal interna',
    clase: 'bg-[#f9b44c]/30 text-[#391511]',
  },
  3: {
    corta: '3ª+',
    larga: 'Escalada a Resp. General y Dirección',
    clase: 'bg-[#c43e2c]/15 text-[#c43e2c]',
  },
}

export const GRAVEDAD_INCIDENCIA: Record<GravedadIncidencia, { label: string; clase: string }> = {
  leve: { label: 'Leve', clase: 'bg-[#f3ece4] text-[#6f3a2a]' },
  grave: { label: 'Grave', clase: 'bg-[#c43e2c] text-white' },
}

/** Sanciones formales del estatuto (art. 13). */
export const TIPOS_SANCION: Record<TipoSancion, { label: string; clase: string; ayuda: string }> = {
  llamado_atencion: {
    label: 'Llamado de atención',
    clase: 'bg-[#e4c9b0]/50 text-[#6f3a2a]',
    ayuda: 'No se asienta en el legajo (art. 18).',
  },
  apercibimiento: {
    label: 'Apercibimiento',
    clase: 'bg-[#f9b44c]/30 text-[#391511]',
    ayuda: 'Queda en el legajo.',
  },
  suspension: {
    label: 'Suspensión',
    clase: 'bg-[#c43e2c]/15 text-[#c43e2c]',
    ayuda: 'Hasta 30 días. Requiere sumario y acta (art. 14).',
  },
  exclusion: {
    label: 'Exclusión',
    clase: 'bg-[#391511] text-[#f9d2a2]',
    ayuda: 'Requiere sumario, acta y debido proceso (arts. 14–17).',
  },
}

export const ORDEN_TIPOS_SANCION: TipoSancion[] = [
  'llamado_atencion',
  'apercibimiento',
  'suspension',
  'exclusion',
]
