/**
 * Lógica pura de los avisos de atraso (Tareas v2, Etapa 5).
 * Solo imports de tipos (los tests corren con `node --test`).
 */
import type { TareaAvisoRow } from '@/types/database'

type Aviso = Pick<TareaAvisoRow, 'id' | 'titulo' | 'duenos_nombres' | 'minutos_atraso' | 'destinatarios' | 'resuelto_at'>

/** Los avisos que le llegan a esta persona (el admin también ve los de la encargada, pero no le "llegan"). */
export function avisosParaMi<T extends Aviso>(avisos: T[], usuarioId: string | null | undefined): T[] {
  if (!usuarioId) return []
  return avisos.filter((a) => !a.resuelto_at && a.destinatarios.includes(usuarioId))
}

/** Avisos que todavía no se mostraron en pantalla (para el cartel en vivo). */
export function avisosNuevos<T extends Aviso>(avisos: T[], vistos: ReadonlySet<number>): T[] {
  return avisos.filter((a) => !vistos.has(a.id))
}

/** "Control de temperaturas (Camila): 20 min de atraso". */
export function textoAviso(a: Aviso): string {
  const quien = a.duenos_nombres ? ` (${a.duenos_nombres})` : ''
  return `${a.titulo}${quien}: ${a.minutos_atraso} min de atraso`
}

/** "Avisado a Rebeca · 10:20" para el panel de la agenda. */
export function textoAvisado(
  a: Pick<TareaAvisoRow, 'destinatarios_nombres' | 'created_at' | 'para'>,
  hora: (iso: string) => string
): string {
  const a_quien = a.destinatarios_nombres ?? (a.para === 'admin' ? 'los administradores' : 'la encargada')
  return `Avisado a ${a_quien} · ${hora(a.created_at)}`
}
