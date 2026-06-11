'use client'

import { useState } from 'react'
import { Boxes, Plus } from 'lucide-react'
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
import { MontoARS } from '@/components/shared/MontoARS'
import { ConfirmacionAccion } from '@/components/shared/ConfirmacionAccion'
import { ModalNuevoActivo } from './ModalNuevoActivo'
import { useActivos, useDarDeBajaActivo } from '@/lib/hooks/useContabilidad'
import { calcularDepreciacion } from '@/lib/queries/contabilidad'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

export function TabActivos() {
  const { data: activos, isLoading, isError } = useActivos()
  const darBaja = useDarDeBajaActivo()
  const [modalAbierto, setModalAbierto] = useState(false)
  const [bajaActivo, setBajaActivo] = useState<{
    id: number
    nombre: string
  } | null>(null)

  const valorLibrosTotal = (activos ?? [])
    .filter((a) => a.estado !== 'baja')
    .reduce((s, a) => s + calcularDepreciacion(a).valorLibros, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Activos fijos</h2>
          <p className="text-[#6f3a2a] text-sm">
            Bienes de uso del negocio con su amortización lineal.
          </p>
        </div>
        <Button
          onClick={() => setModalAbierto(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nuevo activo
        </Button>
      </div>

      {(activos ?? []).length > 0 && (
        <div className="rounded-2xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-4 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Valor en libros (activos vigentes)
          </div>
          <div className="text-2xl font-extrabold text-[#391511] tabular-nums">
            <MontoARS monto={valorLibrosTotal} />
          </div>
        </div>
      )}

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={6} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los activos.
          </div>
        ) : !activos || activos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Boxes className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">Sin activos cargados</p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Registrá heladeras, muebles, equipos, etc.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Activo
                  </TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Compra
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Valor origen
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Amort. mensual
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Amort. acumulada
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Valor en libros
                  </TableHead>
                  <TableHead className="text-right w-20 text-[#391511] font-semibold" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {activos.map((a) => {
                  const dep = calcularDepreciacion(a)
                  const baja = a.estado === 'baja'
                  return (
                    <TableRow
                      key={a.id}
                      className={cn(
                        'border-b-[#e4c9b0]/40',
                        baja && 'opacity-50'
                      )}
                    >
                      <TableCell>
                        <div className="font-medium text-[#391511] text-sm">
                          {a.nombre}
                          {baja && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-[#c43e2c]">
                              Baja
                            </span>
                          )}
                        </div>
                        {a.descripcion && (
                          <div className="text-[#c8a58a] text-xs">
                            {a.descripcion}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-[#6f3a2a] text-sm tabular-nums">
                        {formatearFechaCorta(a.fecha_adquisicion)}
                        <span className="text-[#c8a58a] block text-[10px]">
                          {a.vida_util_meses} meses
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#391511]">
                        <MontoARS monto={a.valor_origen} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        <MontoARS monto={dep.mensual} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#c43e2c]">
                        <MontoARS monto={dep.amortAcumulada} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                        <MontoARS monto={dep.valorLibros} />
                      </TableCell>
                      <TableCell className="text-right">
                        {!baja && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setBajaActivo({ id: a.id, nombre: a.nombre })
                            }
                            disabled={darBaja.isPending}
                            className="h-7 text-xs text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                          >
                            Dar de baja
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ModalNuevoActivo abierto={modalAbierto} onCambioAbierto={setModalAbierto} />

      <ConfirmacionAccion
        abierto={bajaActivo !== null}
        onCambioAbierto={(v) => {
          if (!v) setBajaActivo(null)
        }}
        titulo={bajaActivo ? `Dar de baja "${bajaActivo.nombre}"` : ''}
        descripcion="El activo deja de amortizar a partir de hoy y sale del valor en libros. Usalo cuando vendés, tirás o dejás de usar el bien."
        textoConfirmar="Sí, dar de baja"
        destructiva
        procesando={darBaja.isPending}
        onConfirmar={() => {
          if (bajaActivo)
            darBaja.mutate(bajaActivo.id, {
              onSuccess: () => setBajaActivo(null),
            })
        }}
      />
    </div>
  )
}
