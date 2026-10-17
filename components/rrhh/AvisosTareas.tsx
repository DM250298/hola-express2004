'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlarmClock, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAvisosTareas, useRealtimeAvisos } from '@/lib/hooks/useTareas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import { avisosNuevos, avisosParaMi, textoAviso } from './avisosLogica'
import { horaAr } from './registroLogica'

const RUTA_AGENDA = '/rrhh?tab=tareas'

/**
 * Cartel en vivo cuando llega un aviso de atraso para esta persona (Tareas v2,
 * Etapa 5). Va en el layout: funciona en cualquier pantalla de HEX. Al entrar,
 * si ya había avisos, muestra uno solo con la cantidad.
 */
export function AvisosTareasEnVivo({ usuarioId, habilitado }: { usuarioId: string; habilitado: boolean }) {
  const router = useRouter()
  const { data: avisos } = useAvisosTareas(habilitado)
  useRealtimeAvisos(habilitado)
  const vistos = useRef<Set<number> | null>(null)

  useEffect(() => {
    if (!avisos) return
    const mios = avisosParaMi(avisos, usuarioId)
    const ver = { label: 'Ver', onClick: () => router.push(RUTA_AGENDA) }
    if (vistos.current === null) {
      vistos.current = new Set(avisos.map((a) => a.id))
      if (mios.length > 0) {
        toast.warning(
          mios.length === 1 ? 'Hay una tarea atrasada' : `Hay ${mios.length} tareas atrasadas`,
          { description: mios.length === 1 ? textoAviso(mios[0]) : 'Están en Alertas y en la agenda.', action: ver, duration: 10000 }
        )
      }
      return
    }
    for (const a of avisosNuevos(mios, vistos.current)) {
      toast.warning('Tarea atrasada', { description: textoAviso(a), action: ver, duration: 15000 })
    }
    for (const a of avisos) vistos.current.add(a.id)
  }, [avisos, usuarioId, router])

  return null
}

/** Sección "Tareas atrasadas" arriba de Alertas (encargadas y administradores). */
export function TareasAtrasadas() {
  const { data: usuario } = useUsuario()
  const habilitado =
    usuario?.rol === 'admin' ||
    tienePermiso(usuario?.permisos, 'tareas_gestion') ||
    tienePermiso(usuario?.permisos, 'tareas_admin')
  const { data: avisos } = useAvisosTareas(!!habilitado)
  if (!habilitado || !avisos || avisos.length === 0) return null
  const mios = new Set(avisosParaMi(avisos, usuario?.id).map((a) => a.id))

  return (
    <section className="rounded-2xl border-2 border-[#c43e2c]/40 bg-[#fbe2df]/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-[#a3271d]">
          <AlarmClock className="h-5 w-5" />
          Tareas atrasadas ({avisos.length})
        </h2>
        <Link
          href={RUTA_AGENDA}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'border-[#e4c9b0] bg-white gap-1.5')}
        >
          Ir a la agenda <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <ul className="divide-y divide-[#e4c9b0]/60 rounded-xl bg-white border border-[#e4c9b0]/60">
        {avisos.map((a) => (
          <li key={a.id} className="px-3 py-2.5 text-sm flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-[#391511]">
                {a.titulo}
                {a.privada && (
                  <span className="ml-1.5 rounded bg-[#391511] px-1.5 py-0.5 text-[10px] font-bold text-white align-middle">
                    Privada
                  </span>
                )}
              </p>
              <p className="text-xs text-[#6f3a2a]">
                {a.duenos_nombres ?? 'Sin asignar'} · {a.minutos_atraso} min de atraso al avisar ·{' '}
                {mios.has(a.id) ? 'Te avisó a vos' : `Avisado a ${a.destinatarios_nombres ?? '—'}`} a las {horaAr(a.created_at)}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-[#6f3a2a]">
        Cada aviso se va solo cuando la tarea se hace, se marca “No se pudo” o se cancela.
      </p>
    </section>
  )
}
