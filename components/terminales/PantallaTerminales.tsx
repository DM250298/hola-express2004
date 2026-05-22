'use client'

import { useState } from 'react'
import { CreditCard, Info, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { ModalTerminal } from './ModalTerminal'
import { useTerminales, useDeleteTerminal } from '@/lib/hooks/useTerminales'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { cn } from '@/lib/utils'
import type { TerminalRow } from '@/types/database'

export function PantallaTerminales() {
  const { data: terminales, isLoading, isError } = useTerminales()
  const { data: cuentas } = useCuentas(false)
  const eliminar = useDeleteTerminal()
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editar, setEditar] = useState<TerminalRow | null>(null)

  function nombreCuenta(id: number | null): string {
    if (id == null) return '—'
    return (cuentas ?? []).find((c) => c.id === id)?.nombre ?? `#${id}`
  }

  function abrirNuevo() {
    setEditar(null)
    setModalAbierto(true)
  }

  function abrirEdicion(t: TerminalRow) {
    setEditar(t)
    setModalAbierto(true)
  }

  function handleEliminar(t: TerminalRow) {
    if (!confirm(`¿Eliminar la terminal "${t.nombre}"?`)) return
    eliminar.mutate(t.id)
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">
            Terminales de cobro
          </h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Terminales Mercado Pago Point conectadas al sistema.
          </p>
        </div>
        <Button
          onClick={abrirNuevo}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Conectar terminal
        </Button>
      </header>

      {/* Aviso de configuración */}
      <div className="rounded-2xl border border-[#e4c9b0]/60 bg-[#f9b44c]/10 p-4 flex gap-3">
        <Info className="h-4 w-4 text-[#6f3a2a] shrink-0 mt-0.5" />
        <div className="text-xs text-[#6f3a2a] space-y-1">
          <p className="font-semibold text-[#391511]">
            Para que las terminales funcionen en vivo
          </p>
          <p>
            El servidor necesita el <strong>Access Token</strong> de tu cuenta
            de Mercado Pago, cargado como <code>MP_ACCESS_TOKEN</code> en el
            archivo <code>.env.local</code>. Además, cada dispositivo Point
            debe estar en <strong>modo integrado (PDV)</strong>.
          </p>
        </div>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={3} columnas={4} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar las terminales.
          </div>
        ) : !terminales || terminales.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <CreditCard className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              Sin terminales conectadas
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Conectá tu primera terminal de Mercado Pago Point.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Terminal
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Dispositivo
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Cuenta
                  </TableHead>
                  <TableHead className="text-right w-24 text-[#391511] font-semibold" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {terminales.map((t) => (
                  <TableRow
                    key={t.id}
                    className={cn(
                      'border-b-[#e4c9b0]/40',
                      !t.activo && 'opacity-50'
                    )}
                  >
                    <TableCell>
                      <div className="font-medium text-[#391511] text-sm">
                        {t.nombre}
                      </div>
                      <div className="text-[#c8a58a] text-xs">
                        Mercado Pago Point
                      </div>
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-xs font-mono">
                      {t.device_id || '— sin vincular —'}
                    </TableCell>
                    <TableCell className="text-[#6f3a2a] text-sm">
                      {nombreCuenta(t.cuenta_id)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => abrirEdicion(t)}
                          className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                          aria-label="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEliminar(t)}
                          disabled={eliminar.isPending}
                          className="h-7 w-7 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                          aria-label="Eliminar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ModalTerminal
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        terminal={editar}
      />
    </div>
  )
}
