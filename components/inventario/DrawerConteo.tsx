'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ClipboardList, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import {
  useAprobarConteo,
  useConteoDetalle,
  useGuardarConteoEmpleado,
} from '@/lib/hooks/useConteos'
import {
  cantidadesIguales,
  formatearCantidad,
  redondearCantidad,
} from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  conteoId: number | null
  onCambioAbierto: (v: boolean) => void
}

export function DrawerConteo({ conteoId, onCambioAbierto }: Props) {
  const { data: usuario } = useUsuario()
  const { data, isLoading } = useConteoDetalle(conteoId)
  const guardar = useGuardarConteoEmpleado()
  const aprobar = useAprobarConteo()

  const abierto = conteoId !== null
  // Cantidades cargadas por el empleado (string por item.id)
  const [conteos, setConteos] = useState<Record<number, string>>({})

  useEffect(() => {
    if (data) {
      const inicial: Record<number, string> = {}
      for (const it of data.items) {
        inicial[it.id] =
          it.cantidad_contada != null ? String(it.cantidad_contada) : ''
      }
      setConteos(inicial)
    }
  }, [data])

  const conteo = data?.conteo
  const items = data?.items ?? []

  const esAdmin = tienePermiso(usuario?.permisos, 'conteo_gestion')
  const esAsignado = !!usuario && usuario.id === conteo?.usuario_asignado

  const modo: 'contar' | 'aprobar' | 'ver' = useMemo(() => {
    if (!conteo) return 'ver'
    if (conteo.estado === 'pendiente' && esAsignado) return 'contar'
    if (conteo.estado === 'contado' && esAdmin) return 'aprobar'
    return 'ver'
  }, [conteo, esAsignado, esAdmin])

  function enviarConteo() {
    if (!conteo) return
    // Un producto por unidad se redondea a entero; uno por peso conserva los
    // kg (el Math.floor de antes truncaba 1,5 kg a 1 kg SIN AVISAR y generaba
    // un ajuste fantasma de −0,5 kg al aprobar el conteo).
    const payload = items.map((it) => ({
      itemId: it.id,
      cantidad: Math.max(
        0,
        redondearCantidad(Number(conteos[it.id]) || 0, it.venta_por_peso)
      ),
    }))
    guardar.mutate(
      { conteoId: conteo.id, conteos: payload },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  function aprobarConteoDoc() {
    if (!conteo || !usuario) return
    if (
      !confirm(
        'Al aprobar, el stock de cada producto se ajusta al valor contado por el empleado. ¿Continuar?'
      )
    )
      return
    aprobar.mutate(
      { conteoId: conteo.id, aprobadorId: usuario.id },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Sheet open={abierto} onOpenChange={onCambioAbierto}>
      <SheetContent
        side="right"
        className="sm:max-w-lg w-full flex flex-col p-0"
      >
        <SheetHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <SheetTitle className="text-[#391511] text-lg flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#f9b44c]" />
            {conteo ? conteo.nombre : 'Conteo'}
          </SheetTitle>
          <SheetDescription className="text-[#6f3a2a]">
            {modo === 'contar'
              ? 'Contá cada producto y cargá la cantidad que encontrás.'
              : modo === 'aprobar'
                ? 'Revisá las diferencias y aprobá el conteo.'
                : 'Detalle del conteo.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {isLoading || !data ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 rounded-lg bg-[#f9d2a2]/30" />
              ))}
            </div>
          ) : modo === 'contar' ? (
            /* ─── Empleado cuenta a ciegas ─── */
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Producto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold w-28">
                    Contado
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id} className="border-b-[#e4c9b0]/40">
                    <TableCell>
                      <div className="font-medium text-[#391511] text-sm">
                        {it.producto_nombre}
                        {it.venta_por_peso && (
                          <span className="ml-1.5 rounded-full bg-[#f9b44c]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#9e6b15]">
                            Por kg
                          </span>
                        )}
                      </div>
                      {it.producto_codigo && (
                        <div className="text-[#c8a58a] text-xs font-mono">
                          {it.producto_codigo}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step={it.venta_por_peso ? '0.001' : '1'}
                        inputMode={it.venta_por_peso ? 'decimal' : 'numeric'}
                        value={conteos[it.id] ?? ''}
                        onChange={(e) =>
                          setConteos((prev) => ({
                            ...prev,
                            [it.id]: e.target.value,
                          }))
                        }
                        placeholder={it.venta_por_peso ? '0,000' : '0'}
                        className="h-9 w-24 text-center tabular-nums border-[#e4c9b0] ml-auto"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            /* ─── Revisión / aprobación / solo lectura ─── */
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">
                    Producto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold w-20">
                    Sistema
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold w-20">
                    Contado
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold w-20">
                    Dif.
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => {
                  const contado = it.cantidad_contada
                  const dif =
                    contado != null
                      ? redondearCantidad(
                          contado - it.stock_sistema,
                          it.venta_por_peso
                        )
                      : null
                  // Con kilos la diferencia se compara con tolerancia: restar
                  // decimales arrastra ruido de float y un 1e-16 pintaría de
                  // rojo un conteo que en realidad dio exacto.
                  const sinDiferencia = dif != null && cantidadesIguales(dif, 0)
                  return (
                    <TableRow key={it.id} className="border-b-[#e4c9b0]/40">
                      <TableCell>
                        <div className="font-medium text-[#391511] text-sm">
                          {it.producto_nombre}
                          {it.venta_por_peso && (
                            <span className="ml-1.5 rounded-full bg-[#f9b44c]/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#9e6b15]">
                              Por kg
                            </span>
                          )}
                        </div>
                        {it.producto_codigo && (
                          <div className="text-[#c8a58a] text-xs font-mono">
                            {it.producto_codigo}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                        {formatearCantidad(it.stock_sistema, it.venta_por_peso)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-semibold text-[#391511]">
                        {contado == null
                          ? '—'
                          : formatearCantidad(contado, it.venta_por_peso)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums font-bold',
                          dif == null
                            ? 'text-[#c8a58a]'
                            : sinDiferencia
                              ? 'text-[#6f3a2a]'
                              : dif > 0
                                ? 'text-[#2f8f4e]'
                                : 'text-[#c43e2c]'
                        )}
                      >
                        {dif == null
                          ? '—'
                          : `${dif > 0 ? '+' : ''}${formatearCantidad(dif, it.venta_por_peso)}`}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Acciones */}
        {data && (modo === 'contar' || modo === 'aprobar') && (
          <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
            <Button
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cerrar
            </Button>
            {modo === 'contar' ? (
              <Button
                onClick={enviarConteo}
                disabled={guardar.isPending}
                className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold gap-1.5"
              >
                {guardar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Enviar conteo
              </Button>
            ) : (
              <Button
                onClick={aprobarConteoDoc}
                disabled={aprobar.isPending}
                className="flex-[2] bg-[#2f8f4e] hover:bg-[#267a42] text-white font-bold gap-1.5"
              >
                {aprobar.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Aprobar y ajustar stock
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
