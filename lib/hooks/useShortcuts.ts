'use client'

import { useEffect } from 'react'

export interface DefinicionShortcut {
  /** Tecla principal — ej: 'F2', 'Escape', 'Enter', 'a' */
  tecla: string
  /** Si true, requiere Ctrl/Cmd */
  ctrl?: boolean
  /** Si true, requiere Shift */
  shift?: boolean
  /** Si true, requiere Alt */
  alt?: boolean
  /** Función a ejecutar */
  accion: (e: KeyboardEvent) => void
  /** Si true, sigue funcionando aunque el foco esté en input/textarea */
  cuandoEscribe?: boolean
  /** Si false, no se llama preventDefault (útil para Enter en input) */
  preventDefault?: boolean
}

/**
 * Registra listeners globales de teclado. Cuando se monta, escucha keydown
 * en window. Cuando se desmonta, los limpia.
 *
 * Por defecto los shortcuts NO disparan si el foco está en un input editable
 * (excepto que se ponga `cuandoEscribe: true`). Esto evita que F2 robe la
 * tecla cuando el cajero está tipeando.
 */
export function useShortcuts(
  shortcuts: DefinicionShortcut[],
  habilitado = true
) {
  useEffect(() => {
    if (!habilitado) return

    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const escribiendo =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true

      for (const s of shortcuts) {
        if (e.key !== s.tecla) continue
        if (!!s.ctrl !== (e.ctrlKey || e.metaKey)) continue
        if (!!s.shift !== e.shiftKey) continue
        if (!!s.alt !== e.altKey) continue
        if (escribiendo && !s.cuandoEscribe) continue

        if (s.preventDefault !== false) {
          e.preventDefault()
          e.stopPropagation()
        }
        s.accion(e)
        return
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts, habilitado])
}
