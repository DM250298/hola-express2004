'use client'

import type { ReactNode } from 'react'
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

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  titulo: string
  /** Explicación de la consecuencia, en lenguaje llano. */
  descripcion?: ReactNode
  textoConfirmar?: string
  textoCancelar?: string
  /** Si la acción es irreversible/peligrosa, el botón va en rojo. */
  destructiva?: boolean
  procesando?: boolean
  onConfirmar: () => void
  /** Contenido extra: resumen del monto afectado, checklist, etc. */
  children?: ReactNode
}

/**
 * Diálogo de confirmación con el estilo de la app (reemplaza los confirm()
 * nativos del navegador). Para toda operación de plata irreversible:
 * cerrar período, acreditar en lote, anular asiento, dar de baja activo, etc.
 */
export function ConfirmacionAccion({
  abierto,
  onCambioAbierto,
  titulo,
  descripcion,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  destructiva = false,
  procesando = false,
  onConfirmar,
  children,
}: Props) {
  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!procesando}>
        <DialogHeader>
          <DialogTitle className="text-[#391511]">{titulo}</DialogTitle>
          {descripcion && (
            <DialogDescription className="text-[#6f3a2a]">
              {descripcion}
            </DialogDescription>
          )}
        </DialogHeader>

        {children && <div className="text-sm text-[#6f3a2a]">{children}</div>}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            {textoCancelar}
          </Button>
          <Button
            type="button"
            variant={destructiva ? 'destructive' : 'default'}
            onClick={onConfirmar}
            disabled={procesando}
            className={
              destructiva
                ? undefined
                : 'bg-[#f9b44c] font-semibold text-[#391511] hover:bg-[#e4a42a]'
            }
          >
            {procesando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
