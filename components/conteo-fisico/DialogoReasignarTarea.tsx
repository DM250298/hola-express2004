'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useUsuariosActivos } from '@/lib/hooks/useConteos'
import { useReasignarTareaConteo } from '@/lib/hooks/useConteoFisico'
import type { ConteoZonaRow } from '@/types/database'
import { SelectorPersonas } from './SelectorPersonas'

interface Props {
  /** Tarea a reasignar; null = diálogo cerrado. */
  zona: ConteoZonaRow | null
  onCerrar: () => void
}

/** Cambiar quién cuenta una tarea. Lo que ya se cargó no se toca. */
export function DialogoReasignarTarea({ zona, onCerrar }: Props) {
  const { data: usuarios } = useUsuariosActivos()
  const reasignar = useReasignarTareaConteo()
  const [elegida, setElegida] = useState<string[]>([])

  useEffect(() => {
    setElegida(zona?.responsable_user_id ? [zona.responsable_user_id] : [])
  }, [zona])

  const enCurso = zona?.estado === 'en_curso'
  const sinCambios = (elegida[0] ?? null) === (zona?.responsable_user_id ?? null)

  function confirmar() {
    if (!zona) return
    reasignar.mutate(
      { zona_id: zona.id, responsable: elegida[0] ?? null },
      { onSuccess: onCerrar }
    )
  }

  return (
    <Dialog
      open={zona !== null}
      onOpenChange={(v) => !v && !reasignar.isPending && onCerrar()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#391511]">
            ¿Quién cuenta “{zona?.nombre}”?
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {enCurso
              ? 'La tarea ya está en curso: lo que se cargó queda como está y la sigue la persona que elijas.'
              : 'Si no elegís a nadie, la toma quien la inicie.'}
          </DialogDescription>
        </DialogHeader>

        <SelectorPersonas
          personas={usuarios ?? []}
          seleccionadas={elegida}
          onCambio={setElegida}
          unica
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCerrar}
            disabled={reasignar.isPending}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={confirmar}
            disabled={
              reasignar.isPending || sinCambios || (enCurso && elegida.length === 0)
            }
            className="bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]"
          >
            {reasignar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reasignar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
