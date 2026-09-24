'use client'

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  abrirTurno,
  cerrarTurno,
  getResumenTurno,
  getTurnoActivo,
} from '@/lib/queries/turnos'
import { manejarErrorIdentidad } from '@/lib/auth/erroresIdentidad'
import { createClient } from '@/lib/supabase/client'

export const TURNO_KEY = ['turno-activo'] as const
export const RESUMEN_TURNO_KEY = ['resumen-turno'] as const

export function useTurnoActivo(usuarioId: string | undefined) {
  return useQuery({
    queryKey: [...TURNO_KEY, usuarioId],
    queryFn: () => {
      if (!usuarioId) return null
      return getTurnoActivo(usuarioId)
    },
    enabled: !!usuarioId,
    staleTime: 30 * 1000,
  })
}

/**
 * Si el turno cambia en la base (lo cerró el dueño o Finanzas desde el
 * Dashboard, o el cierre vino de otra pestaña), el POS se entera al instante
 * en vez de esperar al próximo refetch. `caja_turnos` está en la publicación
 * Realtime desde el schema inicial.
 */
export function useTurnoEnVivo(turnoId: number | undefined) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!turnoId) return
    const supabase = createClient()
    const canal = supabase
      .channel(`turno-${turnoId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'caja_turnos',
          filter: `id=eq.${turnoId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: TURNO_KEY })
          qc.invalidateQueries({ queryKey: RESUMEN_TURNO_KEY })
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(canal)
    }
  }, [turnoId, qc])
}

/** Vista previa del cierre (y comprobante): resumen calculado en el servidor. */
export function useResumenTurno(turnoId: number | undefined, habilitado = true) {
  return useQuery({
    queryKey: [...RESUMEN_TURNO_KEY, turnoId],
    queryFn: () => getResumenTurno(turnoId as number),
    enabled: habilitado && !!turnoId,
    staleTime: 0,
  })
}

const UN_MINUTO_MS = 60 * 1000

export function useAbrirTurno() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ montoApertura }: { montoApertura: number }) =>
      abrirTurno(montoApertura),
    onSuccess: (turno) => {
      queryClient.invalidateQueries({ queryKey: TURNO_KEY })
      // fn_abrir_turno es idempotente: si ya había uno abierto (por ejemplo
      // desde otra pestaña), devuelve ese. Avisar para que no crea que abrió
      // con el monto que acaba de tipear.
      const abiertoHace = Date.now() - new Date(turno.fecha_apertura).getTime()
      if (abiertoHace > UN_MINUTO_MS) {
        toast.info(`Ya tenías el turno #${turno.id} abierto: seguís en ese.`)
      } else {
        toast.success('Turno abierto')
      }
    },
    onError: (error: Error) => {
      if (manejarErrorIdentidad(error, queryClient)) return
      toast.error(`No se pudo abrir el turno: ${error.message}`)
    },
  })
}

export function useCerrarTurno() {
  const queryClient = useQueryClient()
  // Nota: NO se invalida TURNO_KEY acá. Si se invalidara, el turno pasaría a
  // null al instante y la pantalla saltaría a "Abrir caja", desmontando el
  // modal del informe de cierre antes de que el cajero lo vea/imprima.
  // La invalidación (o el cierre de sesión) se hace al cerrar ese modal
  // (ver CierreCaja).
  return useMutation({
    mutationFn: ({
      turnoId,
      montoCierreReal,
      novedades,
    }: {
      turnoId: number
      montoCierreReal: number
      novedades: string | null
    }) => cerrarTurno(turnoId, montoCierreReal, novedades),
    onSuccess: () => {
      // La sangría automática la crea el RPC: refrescar el buzón.
      queryClient.invalidateQueries({ queryKey: ['caja-fuerte'] })
      toast.success('Turno cerrado')
    },
    onError: (error: Error) => {
      if (manejarErrorIdentidad(error, queryClient)) return
      toast.error(`No se pudo cerrar el turno: ${error.message}`)
    },
  })
}
