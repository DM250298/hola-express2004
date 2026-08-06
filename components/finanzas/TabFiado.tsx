'use client'

import { useEffect, useMemo, useState } from 'react'
import { HandCoins, Search, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { EstadoError } from '@/components/shared/EstadoError'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  BadgeSaldoCtaCte,
  estadoSaldoCtaCte,
} from '@/components/shared/BadgeSaldoCtaCte'
import { useCarteraFiado } from '@/lib/hooks/useCtaCte'
import { ModalLimiteCredito } from './ModalLimiteCredito'
import { ModalCobrarCtaCte } from './ModalCobrarCtaCte'
import { DrawerDeudorCtaCte } from './DrawerDeudorCtaCte'
import { cn } from '@/lib/utils'
import type { DeudorCartera } from '@/lib/queries/ctaCte'

const TODOS = '__todos__'

const ITEMS_TIPO: Record<string, string> = {
  [TODOS]: 'Clientes y empleados',
  cliente: 'Solo clientes',
  empleado: 'Solo empleados',
}

export function TabFiado() {
  const [busquedaInput, setBusquedaInput] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState<string>(TODOS)
  const [soloConDeuda, setSoloConDeuda] = useState(true)
  const [deudorTope, setDeudorTope] = useState<DeudorCartera | null>(null)
  const [deudorCobro, setDeudorCobro] = useState<DeudorCartera | null>(null)
  const [deudorDrawer, setDeudorDrawer] = useState<DeudorCartera | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setBusqueda(busquedaInput), 250)
    return () => clearTimeout(t)
  }, [busquedaInput])

  const { data: cartera, isLoading, isError, refetch } =
    useCarteraFiado(busqueda || undefined)

  const filas = useMemo(() => {
    let lista = cartera ?? []
    if (tipoFiltro !== TODOS) {
      lista = lista.filter((d) => d.deudor_tipo === tipoFiltro)
    }
    if (soloConDeuda) lista = lista.filter((d) => d.saldo > 0.009)
    // Los que más deben, primero.
    return [...lista].sort((a, b) => b.saldo - a.saldo)
  }, [cartera, tipoFiltro, soloConDeuda])

  const totalFiado = filas
    .filter((d) => d.saldo > 0)
    .reduce((acc, d) => acc + d.saldo, 0)
  const deudores = filas.filter((d) => d.saldo > 0.009).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold">Fiado (cuenta corriente)</h2>
          <p className="text-[#6f3a2a] text-sm">
            Lo que te deben clientes y empleados. Tocá “Tope” para habilitar o
            limitar el fiado de cada uno.
          </p>
          <p className="text-[10px] text-[#c8a58a] mt-0.5">
            Muestra la deuda de hoy — no depende del período de arriba.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a] pointer-events-none" />
            <Input
              value={busquedaInput}
              onChange={(e) => setBusquedaInput(e.target.value)}
              placeholder="Buscar deudor…"
              className="pl-9 pr-8 w-[200px] border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
            />
            {busquedaInput && (
              <button
                type="button"
                onClick={() => setBusquedaInput('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#c8a58a] hover:text-[#391511]"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select
            items={ITEMS_TIPO}
            value={tipoFiltro}
            onValueChange={(v) => setTipoFiltro(v ?? TODOS)}
          >
            <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
              <SelectValue placeholder="Tipo de deudor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Clientes y empleados</SelectItem>
              <SelectItem value="cliente">Solo clientes</SelectItem>
              <SelectItem value="empleado">Solo empleados</SelectItem>
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant={soloConDeuda ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSoloConDeuda((v) => !v)}
            className={cn(
              'h-9',
              soloConDeuda
                ? 'bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold'
                : 'border-[#e4c9b0] text-[#6f3a2a]'
            )}
          >
            Solo con deuda
          </Button>
        </div>
      </div>

      {/* KPI total fiado */}
      {totalFiado > 0 && (
        <div className="rounded-2xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#f9b44c]/30">
              <HandCoins className="h-5 w-5 text-[#6f3a2a]" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                Total fiado por cobrar
              </div>
              <div className="text-xs text-[#6f3a2a]">
                {deudores} deudor{deudores === 1 ? '' : 'es'} con saldo
              </div>
            </div>
          </div>
          <div className="text-3xl font-extrabold text-[#391511] tabular-nums">
            <MontoARS monto={totalFiado} />
          </div>
        </div>
      )}

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={5} columnas={5} />
          </div>
        ) : isError ? (
          <div className="p-6">
            <EstadoError
              mensaje="No pudimos cargar la cartera de fiado. Revisá tu conexión e intentá de nuevo."
              onReintentar={() => refetch()}
            />
          </div>
        ) : filas.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <Users className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">
              {soloConDeuda ? 'Nadie debe nada' : 'Sin resultados'}
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              {soloConDeuda
                ? 'Cuando fíes desde el POS, la deuda aparece acá.'
                : 'Probá con otra búsqueda o filtro.'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                <TableHead className="text-[#391511] font-semibold">
                  Deudor
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Debe
                </TableHead>
                <TableHead className="text-right text-[#391511] font-semibold">
                  Disponible
                </TableHead>
                <TableHead className="text-center text-[#391511] font-semibold">
                  Estado
                </TableHead>
                <TableHead className="text-right w-44 text-[#391511] font-semibold">
                  Acción
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((d) => {
                const estado = estadoSaldoCtaCte(d.saldo, d.tiene_cupo)
                return (
                  <TableRow
                    key={`${d.deudor_tipo}-${d.deudor_id}`}
                    onClick={() => setDeudorDrawer(d)}
                    className={cn(
                      'border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6] cursor-pointer',
                      estado === 'sin_cupo' &&
                        d.saldo > 0.009 &&
                        'bg-[#c43e2c]/[0.04] hover:bg-[#c43e2c]/[0.07]'
                    )}
                  >
                    <TableCell className="font-medium text-[#391511]">
                      {d.nombre}
                      <span
                        className={cn(
                          'ml-2 text-[9px] uppercase tracking-wider rounded-full px-1.5 py-0.5',
                          d.deudor_tipo === 'empleado'
                            ? 'bg-[#f9d2a2]/60 text-[#6f3a2a]'
                            : 'bg-[#6f3a2a]/10 text-[#6f3a2a]'
                        )}
                      >
                        {d.deudor_tipo === 'empleado' ? 'Empleado' : 'Cliente'}
                      </span>
                      {d.documento && (
                        <div className="text-[10px] text-[#c8a58a]">
                          {d.documento}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-bold text-[#391511]">
                      <MontoARS monto={d.saldo} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                      {d.disponible !== null ? (
                        <MontoARS monto={d.disponible} />
                      ) : (
                        <span
                          className="text-[#c8a58a]"
                          title="El cupo del empleado se ve en el tope"
                        >
                          —
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <BadgeSaldoCtaCte estado={estado} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeudorTope(d)
                          }}
                          className="h-8 text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511] text-xs"
                        >
                          Tope
                        </Button>
                        {d.saldo > 0.009 && (
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeudorCobro(d)
                            }}
                            className="h-8 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
                          >
                            Cobrar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <ModalLimiteCredito
        abierto={deudorTope !== null}
        onCambioAbierto={(v) => !v && setDeudorTope(null)}
        deudorTipo={deudorTope?.deudor_tipo ?? null}
        deudorId={deudorTope?.deudor_id ?? null}
        deudorNombre={deudorTope?.nombre ?? ''}
        saldoActual={deudorTope?.saldo ?? 0}
      />

      <ModalCobrarCtaCte
        abierto={deudorCobro !== null}
        onCambioAbierto={(v) => !v && setDeudorCobro(null)}
        deudorTipo={deudorCobro?.deudor_tipo ?? null}
        deudorId={deudorCobro?.deudor_id ?? null}
        deudorNombre={deudorCobro?.nombre ?? ''}
        saldo={deudorCobro?.saldo ?? 0}
        contexto="finanzas"
      />

      <DrawerDeudorCtaCte
        deudor={deudorDrawer}
        abierto={deudorDrawer !== null}
        onCambioAbierto={(v) => !v && setDeudorDrawer(null)}
        onCobrar={(d) => {
          setDeudorDrawer(null)
          setDeudorCobro(d)
        }}
        onTope={(d) => {
          setDeudorDrawer(null)
          setDeudorTope(d)
        }}
      />
    </div>
  )
}
