'use client'

import { Keyboard } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

interface GrupoAtajo {
  titulo: string
  items: Array<{ teclas: string[]; descripcion: string }>
}

const GRUPOS: GrupoAtajo[] = [
  {
    titulo: 'En el buscador',
    items: [
      { teclas: ['F2'], descripcion: 'Volver al buscador desde cualquier lado' },
      { teclas: ['↑', '↓'], descripcion: 'Navegar resultados' },
      { teclas: ['Enter'], descripcion: 'Agregar producto seleccionado' },
      { teclas: ['Esc'], descripcion: 'Limpiar búsqueda' },
      {
        teclas: ['Código + Enter'],
        descripcion: 'Escanear barcode (6-14 dígitos)',
      },
    ],
  },
  {
    titulo: 'Acciones de venta',
    items: [
      { teclas: ['F3'], descripcion: 'Ver ventas del turno' },
      { teclas: ['F4'], descripcion: 'Abrir cobro' },
      { teclas: ['F5'], descripcion: 'Elegir cliente de la venta' },
      { teclas: ['F8'], descripcion: 'Vaciar carrito (orden activa)' },
      { teclas: ['F9'], descripcion: 'Cerrar turno' },
    ],
  },
  {
    titulo: 'En el selector de cliente',
    items: [
      { teclas: ['↑', '↓'], descripcion: 'Navegar clientes' },
      { teclas: ['Enter'], descripcion: 'Elegir cliente resaltado' },
      { teclas: ['Esc'], descripcion: 'Limpiar búsqueda / cerrar' },
    ],
  },
  {
    titulo: 'Órdenes múltiples (hasta 5)',
    items: [
      { teclas: ['Ctrl', '1'], descripcion: 'Cambiar a la orden 1' },
      { teclas: ['Ctrl', '2'], descripcion: 'Cambiar a la orden 2' },
      { teclas: ['Ctrl', '3'], descripcion: 'Cambiar a la orden 3' },
      { teclas: ['Ctrl', '4'], descripcion: 'Cambiar a la orden 4' },
      { teclas: ['Ctrl', '5'], descripcion: 'Cambiar a la orden 5' },
      { teclas: ['F6'], descripcion: 'Crear nueva orden' },
      { teclas: ['F7'], descripcion: 'Cerrar orden activa' },
    ],
  },
  {
    titulo: 'En el modal de cobro (split payment)',
    items: [
      { teclas: ['F1', '–', 'F4'], descripcion: 'Elegir medio de pago (según orden)' },
      { teclas: ['F5'], descripcion: 'Completar restante con pago activo' },
      { teclas: ['F6'], descripcion: 'Agregar otro pago (hasta 4)' },
      { teclas: ['Números'], descripcion: 'Tipear monto del pago activo' },
      { teclas: ['Backspace'], descripcion: 'Borrar último dígito' },
      { teclas: ['Enter'], descripcion: 'Confirmar venta' },
      { teclas: ['Esc'], descripcion: 'Cancelar cobro' },
    ],
  },
  {
    titulo: 'Otros',
    items: [
      { teclas: ['F1'], descripcion: 'Mostrar esta ayuda' },
    ],
  },
]

export function OverlayAtajos({ abierto, onCambioAbierto }: Props) {
  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-[#f9b44c]" />
            Atajos de teclado
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Hacé clic afuera o tocá Esc para cerrar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {GRUPOS.map((g) => (
            <div key={g.titulo}>
              <h3 className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2">
                {g.titulo}
              </h3>
              <ul className="space-y-1">
                {g.items.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-3 py-1.5 px-3 rounded-lg hover:bg-[#fdfaf6]"
                  >
                    <span className="text-[#391511] text-sm">
                      {item.descripcion}
                    </span>
                    <div className="flex gap-1 shrink-0">
                      {item.teclas.map((t, j) => (
                        <kbd
                          key={j}
                          className="px-2 py-0.5 bg-white border border-[#e4c9b0] rounded text-xs font-mono text-[#391511] shadow-sm"
                        >
                          {t}
                        </kbd>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
