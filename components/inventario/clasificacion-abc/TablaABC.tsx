'use client'

import { useState, useMemo } from 'react'
import { ArrowUpDown, FileSpreadsheet, FileText, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MontoARS } from '@/components/shared/MontoARS'
import { formatearNumero } from '@/lib/utils/formato'
import { generarAbcExcel, generarAbcPDF } from '@/lib/utils/exportarAbc'
import { cn } from '@/lib/utils'
import type { ClaseABC, ProductoABC } from '@/lib/queries/clasificacionAbc'

interface Props {
  productos: ProductoABC[]
  /** Ventana del ranking en días (30/60/90); figura en el archivo exportado. */
  dias?: number
}

type OrdenCol =
  | 'nombre'
  | 'ingresos'
  | 'unidades'
  | 'porcentaje'
  | 'acumulado'
  | 'stock'

const BADGE_CLASE: Record<
  ClaseABC,
  { label: string; className: string }
> = {
  A: {
    label: 'A',
    className:
      'bg-[#2f8f4e]/15 text-[#2f8f4e] border-[#2f8f4e]/30 font-extrabold',
  },
  B: {
    label: 'B',
    className:
      'bg-[#f9b44c]/15 text-[#b07d1e] border-[#f9b44c]/40 font-extrabold',
  },
  C: {
    label: 'C',
    className:
      'bg-[#c43e2c]/10 text-[#c43e2c] border-[#c43e2c]/30 font-extrabold',
  },
}

export function TablaABC({ productos, dias = 30 }: Props) {
  const [busqueda, setBusqueda] = useState('')
  // Clases COMBINABLES: vacío = todas; con clases activas se pueden sumar
  // (ej: A + B para armar un pedido con ambas).
  const [clasesSel, setClasesSel] = useState<Set<ClaseABC>>(new Set())
  const [ordenCol, setOrdenCol] = useState<OrdenCol>('ingresos')
  const [ordenAsc, setOrdenAsc] = useState(false)

  function toggleClase(clase: ClaseABC) {
    setClasesSel((prev) => {
      const s = new Set(prev)
      if (s.has(clase)) s.delete(clase)
      else s.add(clase)
      return s
    })
  }

  const filtrados = useMemo(() => {
    let lista = [...productos]

    // Filtro por clase (combinable)
    if (clasesSel.size > 0) {
      lista = lista.filter((p) => clasesSel.has(p.clase))
    }

    // Filtro por búsqueda
    const q = busqueda.trim().toLowerCase()
    if (q) {
      lista = lista.filter(
        (p) =>
          p.nombre.toLowerCase().includes(q) ||
          (p.codigo_barras && p.codigo_barras.includes(q)) ||
          (p.categoria_nombre &&
            p.categoria_nombre.toLowerCase().includes(q))
      )
    }

    // Ordenamiento
    lista.sort((a, b) => {
      let cmp = 0
      switch (ordenCol) {
        case 'nombre':
          cmp = a.nombre.localeCompare(b.nombre, 'es')
          break
        case 'ingresos':
          cmp = a.ingresos - b.ingresos
          break
        case 'unidades':
          cmp = a.unidades_vendidas - b.unidades_vendidas
          break
        case 'porcentaje':
          cmp = a.porcentaje_ingreso - b.porcentaje_ingreso
          break
        case 'acumulado':
          cmp = a.porcentaje_acumulado - b.porcentaje_acumulado
          break
        case 'stock':
          cmp = a.stock_actual - b.stock_actual
          break
      }
      return ordenAsc ? cmp : -cmp
    })

    return lista
  }, [productos, clasesSel, busqueda, ordenCol, ordenAsc])

  function alternarOrden(col: OrdenCol) {
    if (ordenCol === col) {
      setOrdenAsc(!ordenAsc)
    } else {
      setOrdenCol(col)
      setOrdenAsc(false)
    }
  }

  // Exporta EXACTAMENTE lo que la tabla muestra: filtro de clase, búsqueda
  // y orden actual incluidos.
  async function exportar(tipo: 'excel' | 'pdf') {
    if (filtrados.length === 0) return
    const filas = filtrados.map((p) => ({
      clase: p.clase,
      nombre: p.nombre,
      codigo_barras: p.codigo_barras,
      categoria_nombre: p.categoria_nombre,
      ingresos: p.ingresos,
      unidades_vendidas: p.unidades_vendidas,
      porcentaje_ingreso: p.porcentaje_ingreso,
      porcentaje_acumulado: p.porcentaje_acumulado,
      stock_actual: p.stock_actual,
    }))
    const clases = [...clasesSel].sort()
    try {
      if (tipo === 'excel') await generarAbcExcel(filas, clases, dias)
      else await generarAbcPDF(filas, clases, dias)
    } catch {
      toast.error(
        `No se pudo generar el ${tipo === 'excel' ? 'Excel' : 'PDF'}.`
      )
    }
  }

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden">
      {/* Filtros */}
      <div className="px-4 py-3 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
          <Input
            placeholder="Buscar producto…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant={clasesSel.size === 0 ? 'default' : 'outline'}
            size="sm"
            onClick={() => setClasesSel(new Set())}
            className={cn(
              'h-8 text-xs font-bold',
              clasesSel.size === 0
                ? 'bg-[#391511] text-white hover:bg-[#391511]/90'
                : 'border-[#e4c9b0] text-[#6f3a2a]'
            )}
          >
            Todas
          </Button>
          {(['A', 'B', 'C'] as const).map((opcion) => {
            const activo = clasesSel.has(opcion)
            return (
              <Button
                key={opcion}
                variant={activo ? 'default' : 'outline'}
                size="sm"
                onClick={() => toggleClase(opcion)}
                title="Combinable: podés activar más de una clase a la vez"
                className={cn(
                  'h-8 text-xs font-bold',
                  activo
                    ? 'bg-[#391511] text-white hover:bg-[#391511]/90'
                    : 'border-[#e4c9b0] text-[#6f3a2a]'
                )}
              >
                Clase {opcion}
              </Button>
            )
          })}
        </div>

        <span className="text-xs text-[#6f3a2a]">
          {formatearNumero(filtrados.length)} productos
        </span>

        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportar('excel')}
            disabled={filtrados.length === 0}
            className="h-8 border-[#e4c9b0] text-[#6f3a2a] gap-1.5 disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportar('pdf')}
            disabled={filtrados.length === 0}
            className="h-8 border-[#e4c9b0] text-[#6f3a2a] gap-1.5 disabled:opacity-40"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </Button>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                #
              </th>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Clase
              </th>
              <ThOrdenable
                col="nombre"
                actual={ordenCol}
                asc={ordenAsc}
                onClick={alternarOrden}
              >
                Producto
              </ThOrdenable>
              <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
                Categoría
              </th>
              <ThOrdenable
                col="ingresos"
                actual={ordenCol}
                asc={ordenAsc}
                onClick={alternarOrden}
                className="text-right"
              >
                Ingresos
              </ThOrdenable>
              <ThOrdenable
                col="unidades"
                actual={ordenCol}
                asc={ordenAsc}
                onClick={alternarOrden}
                className="text-right"
              >
                Uds. vendidas
              </ThOrdenable>
              <ThOrdenable
                col="porcentaje"
                actual={ordenCol}
                asc={ordenAsc}
                onClick={alternarOrden}
                className="text-right"
              >
                % Ingreso
              </ThOrdenable>
              <ThOrdenable
                col="acumulado"
                actual={ordenCol}
                asc={ordenAsc}
                onClick={alternarOrden}
                className="text-right"
              >
                % Acum.
              </ThOrdenable>
              <ThOrdenable
                col="stock"
                actual={ordenCol}
                asc={ordenAsc}
                onClick={alternarOrden}
                className="text-right"
              >
                Stock
              </ThOrdenable>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4c9b0]/40">
            {filtrados.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-10 text-center text-[#6f3a2a]"
                >
                  No se encontraron productos.
                </td>
              </tr>
            ) : (
              filtrados.map((p, idx) => {
                const badge = BADGE_CLASE[p.clase]
                return (
                  <tr
                    key={p.producto_id}
                    className="hover:bg-[#fdfaf6] transition-colors"
                  >
                    <td className="px-4 py-2.5 text-[#c8a58a] tabular-nums text-xs">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs px-2 py-0.5',
                          badge.className
                        )}
                      >
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#391511] leading-tight">
                        {p.nombre}
                      </div>
                      {p.codigo_barras && (
                        <div className="text-[10px] text-[#c8a58a] tabular-nums">
                          {p.codigo_barras}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[#6f3a2a] text-xs">
                      {p.categoria_nombre ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-[#391511]">
                      <MontoARS monto={p.ingresos} />
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#391511]">
                      {formatearNumero(p.unidades_vendidas)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#6f3a2a]">
                      {p.porcentaje_ingreso.toFixed(2)} %
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#6f3a2a]">
                      {p.porcentaje_acumulado.toFixed(1)} %
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#391511]">
                      {formatearNumero(p.stock_actual)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Header ordenable ───────────────────────────────────────────────────────

interface ThOrdenableProps {
  col: OrdenCol
  actual: OrdenCol
  asc: boolean
  onClick: (col: OrdenCol) => void
  children: React.ReactNode
  className?: string
}

function ThOrdenable({
  col,
  actual,
  asc,
  onClick,
  children,
  className,
}: ThOrdenableProps) {
  const activo = actual === col
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a] cursor-pointer select-none hover:text-[#391511]',
        className
      )}
      onClick={() => onClick(col)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown
          className={cn(
            'h-3 w-3',
            activo ? 'text-[#391511]' : 'text-[#c8a58a]'
          )}
        />
        {activo && (
          <span className="text-[9px]">{asc ? '↑' : '↓'}</span>
        )}
      </span>
    </th>
  )
}
