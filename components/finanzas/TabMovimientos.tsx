'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Plus,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { MontoARS } from '@/components/shared/MontoARS'
import {
  PaginadorTabla,
  paginarArreglo,
  type PorPagina,
} from '@/components/shared/PaginadorTabla'
import { ModalNuevoMovimiento } from './ModalNuevoMovimiento'
import { useCuentas, useMovimientos } from '@/lib/hooks/useCuentas'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { TipoMovimientoCuenta } from '@/types/database'

const TODOS = '__todos__'

const ITEMS_TIPO: Record<string, string> = {
  [TODOS]: 'Todos los tipos',
  ingreso: 'Ingresos',
  egreso: 'Egresos',
  transferencia_entrada: 'Transf. entrada',
  transferencia_salida: 'Transf. salida',
  ajuste: 'Ajustes',
}

interface Props {
  desde: string
  hasta: string
  /** Si se pasa, la tabla arranca filtrada por esta cuenta (al llegar desde una card). */
  cuentaInicial?: number | null
}

const CONFIG_TIPO: Record<
  TipoMovimientoCuenta,
  { etiqueta: string; icono: React.ElementType; clase: string; signo: '+' | '-' | '↔' }
> = {
  ingreso: {
    etiqueta: 'Ingreso',
    icono: ArrowDown,
    clase: 'bg-[#f9b44c]/15 text-[#6f3a2a]',
    signo: '+',
  },
  egreso: {
    etiqueta: 'Egreso',
    icono: ArrowUp,
    clase: 'bg-[#c43e2c]/10 text-[#c43e2c]',
    signo: '-',
  },
  transferencia_entrada: {
    etiqueta: 'Transf. entrada',
    icono: ArrowRightLeft,
    clase: 'bg-[#6f3a2a]/10 text-[#391511]',
    signo: '+',
  },
  transferencia_salida: {
    etiqueta: 'Transf. salida',
    icono: ArrowRightLeft,
    clase: 'bg-[#6f3a2a]/10 text-[#391511]',
    signo: '-',
  },
  ajuste: {
    etiqueta: 'Ajuste',
    icono: ArrowRightLeft,
    clase: 'bg-[#c8a58a]/20 text-[#6f3a2a]',
    signo: '+',
  },
}

export function TabMovimientos({
  desde,
  hasta,
  cuentaInicial = null,
}: Props) {
  const [cuentaFiltro, setCuentaFiltro] = useState<string>(
    cuentaInicial != null ? String(cuentaInicial) : TODOS
  )
  const [tipoFiltro, setTipoFiltro] = useState<string>(TODOS)
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState<PorPagina>(25)
  const [modalAbierto, setModalAbierto] = useState(false)

  const { data: cuentas } = useCuentas(false)
  const { data: movimientos, isLoading, isError } = useMovimientos({
    desde,
    hasta,
    cuenta_id: cuentaFiltro === TODOS ? null : Number(cuentaFiltro),
    tipo: tipoFiltro === TODOS ? null : (tipoFiltro as TipoMovimientoCuenta),
  })

  useEffect(() => {
    setPagina(0)
  }, [desde, hasta, cuentaFiltro, tipoFiltro])

  const itemsCuenta = useMemo(() => {
    const r: Record<string, string> = { [TODOS]: 'Todas las cuentas' }
    for (const c of cuentas ?? []) r[String(c.id)] = c.nombre
    return r
  }, [cuentas])

  const totales = useMemo(() => {
    const lista = movimientos ?? []
    let ingresos = 0
    let egresos = 0
    for (const m of lista) {
      const monto = Number(m.monto)
      if (m.tipo === 'ingreso' || m.tipo === 'transferencia_entrada') {
        ingresos += monto
      } else if (m.tipo === 'egreso' || m.tipo === 'transferencia_salida') {
        egresos += monto
      }
    }
    return { ingresos, egresos, neto: ingresos - egresos }
  }, [movimientos])

  const movimientosPagina = useMemo(
    () => paginarArreglo(movimientos ?? [], pagina, porPagina),
    [movimientos, pagina, porPagina]
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold text-lg">Movimientos</h2>
          <p className="text-[#6f3a2a] text-sm">
            Libro de movimientos de todas las cuentas.
          </p>
        </div>
        <Button
          onClick={() => setModalAbierto(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Nuevo movimiento
        </Button>
      </div>

      {/* Totales del período */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
            <ArrowDown className="h-3 w-3" />
            Ingresos
          </div>
          <div className="text-xl font-extrabold text-[#391511] tabular-nums">
            <MontoARS monto={totales.ingresos} />
          </div>
        </div>
        <div className="rounded-xl border-2 border-[#c43e2c]/30 bg-[#c43e2c]/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
            <ArrowUp className="h-3 w-3" />
            Egresos
          </div>
          <div className="text-xl font-extrabold text-[#c43e2c] tabular-nums">
            <MontoARS monto={totales.egresos} />
          </div>
        </div>
        <div
          className={cn(
            'rounded-xl border-2 p-3',
            totales.neto >= 0
              ? 'border-[#6f3a2a]/30 bg-[#6f3a2a]/5'
              : 'border-[#c43e2c]/30 bg-[#c43e2c]/5'
          )}
        >
          <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
            Neto
          </div>
          <div
            className={cn(
              'text-xl font-extrabold tabular-nums',
              totales.neto >= 0 ? 'text-[#391511]' : 'text-[#c43e2c]'
            )}
          >
            <MontoARS monto={totales.neto} />
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-3 flex flex-wrap gap-2">
        <Select
          items={itemsCuenta}
          value={cuentaFiltro}
          onValueChange={(v) => setCuentaFiltro(v ?? TODOS)}
        >
          <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
            <SelectValue placeholder="Cuenta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas las cuentas</SelectItem>
            {cuentas?.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={ITEMS_TIPO}
          value={tipoFiltro}
          onValueChange={(v) => setTipoFiltro(v ?? TODOS)}
        >
          <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los tipos</SelectItem>
            <SelectItem value="ingreso">Ingresos</SelectItem>
            <SelectItem value="egreso">Egresos</SelectItem>
            <SelectItem value="transferencia_entrada">Transf. entrada</SelectItem>
            <SelectItem value="transferencia_salida">Transf. salida</SelectItem>
            <SelectItem value="ajuste">Ajustes</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={8} columnas={6} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los movimientos.
          </div>
        ) : !movimientos || movimientos.length === 0 ? (
          <div className="p-12 text-center">
            <Wallet className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
            <p className="text-[#391511] font-semibold">
              Sin movimientos en el período
            </p>
            <p className="text-[#6f3a2a] text-sm mt-1">
              Tocá "Nuevo movimiento" para registrar el primero.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                  <TableHead className="text-[#391511] font-semibold">Fecha</TableHead>
                  <TableHead className="text-[#391511] font-semibold">Cuenta</TableHead>
                  <TableHead className="text-[#391511] font-semibold">Tipo</TableHead>
                  <TableHead className="text-[#391511] font-semibold">
                    Descripción
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Monto
                  </TableHead>
                  <TableHead className="text-right text-[#391511] font-semibold">
                    Saldo después
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movimientosPagina.map((m) => {
                  const config = CONFIG_TIPO[m.tipo]
                  const Icono = config.icono
                  return (
                    <TableRow
                      key={m.id}
                      className="border-b-[#e4c9b0]/40 hover:bg-[#fdfaf6]"
                    >
                      <TableCell className="text-[#6f3a2a] text-xs tabular-nums whitespace-nowrap">
                        {formatearFechaCorta(m.fecha)}
                      </TableCell>
                      <TableCell className="text-[#391511] text-sm font-medium">
                        {m.cuenta_nombre ?? '—'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
                            config.clase
                          )}
                        >
                          <Icono className="h-3 w-3" />
                          {config.etiqueta}
                        </span>
                      </TableCell>
                      <TableCell className="text-[#391511] text-sm">
                        <div>{m.descripcion}</div>
                        {m.contraparte_nombre && (
                          <div className="text-[10px] text-[#c8a58a]">
                            ↔ {m.contraparte_nombre}
                          </div>
                        )}
                        {m.categoria && (
                          <div className="text-[10px] text-[#6f3a2a] capitalize">
                            {m.categoria.replace(/_/g, ' ')}
                          </div>
                        )}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right tabular-nums font-bold whitespace-nowrap',
                          config.signo === '+' ? 'text-[#6f3a2a]' : 'text-[#c43e2c]'
                        )}
                      >
                        {config.signo}
                        <MontoARS monto={Number(m.monto)} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#391511] whitespace-nowrap">
                        <MontoARS monto={Number(m.saldo_nuevo)} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {movimientos && movimientos.length > 0 && (
        <PaginadorTabla
          total={movimientos.length}
          porPagina={porPagina}
          pagina={pagina}
          onCambioPorPagina={setPorPagina}
          onCambioPagina={setPagina}
        />
      )}

      <ModalNuevoMovimiento
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
      />
    </div>
  )
}
