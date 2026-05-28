'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { TipoMovimiento } from '@/types/database'
import type { CategoriaRow } from '@/types/database'
import type {
  FiltrosMovimientos,
  Turno,
  UsuarioMovimiento,
} from '@/lib/queries/movimientosStock'

interface Props {
  filtros: FiltrosMovimientos
  onChange: (f: FiltrosMovimientos) => void
  usuarios: UsuarioMovimiento[]
  categorias: CategoriaRow[]
}

const TIPOS: { valor: TipoMovimiento; etiqueta: string }[] = [
  { valor: 'venta', etiqueta: 'Venta' },
  { valor: 'entrada', etiqueta: 'Entrada' },
  { valor: 'salida', etiqueta: 'Salida' },
  { valor: 'ajuste', etiqueta: 'Ajuste' },
  { valor: 'merma', etiqueta: 'Merma' },
]

const TURNOS: { valor: Turno; etiqueta: string }[] = [
  { valor: 'mañana', etiqueta: 'Mañana' },
  { valor: 'tarde', etiqueta: 'Tarde' },
  { valor: 'noche', etiqueta: 'Noche' },
]

const SIN_VALOR = '__todos__'

export function FiltrosMovimientosBar({
  filtros,
  onChange,
  usuarios,
  categorias,
}: Props) {
  const tiposActivos = filtros.tipos ?? []

  function toggleTipo(tipo: TipoMovimiento) {
    const nuevos = tiposActivos.includes(tipo)
      ? tiposActivos.filter((t) => t !== tipo)
      : [...tiposActivos, tipo]
    onChange({ ...filtros, tipos: nuevos.length > 0 ? nuevos : undefined })
  }

  const hayFiltrosActivos =
    !!filtros.busqueda ||
    (filtros.tipos && filtros.tipos.length > 0) ||
    !!filtros.turno ||
    !!filtros.usuario_id ||
    !!filtros.categoria_id ||
    !!filtros.fecha_desde ||
    !!filtros.fecha_hasta

  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 space-y-3">
      {/* Fila 1: búsqueda + tipo chips */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
          <Input
            placeholder="Buscar producto…"
            value={filtros.busqueda ?? ''}
            onChange={(e) =>
              onChange({ ...filtros, busqueda: e.target.value || undefined })
            }
            className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {TIPOS.map((t) => {
            const activo = tiposActivos.includes(t.valor)
            return (
              <button
                key={t.valor}
                type="button"
                onClick={() => toggleTipo(t.valor)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-bold transition-all border',
                  activo
                    ? 'bg-[#391511] text-white border-[#391511]'
                    : 'bg-white text-[#6f3a2a] border-[#e4c9b0] hover:bg-[#fdfaf6]'
                )}
              >
                {t.etiqueta}
              </button>
            )
          })}
        </div>
      </div>

      {/* Fila 2: turno, usuario, categoría, fechas */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Turno */}
        <div className="space-y-1 min-w-[130px]">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
            Turno
          </label>
          <Select
            value={filtros.turno ?? SIN_VALOR}
            onValueChange={(v) =>
              onChange({
                ...filtros,
                turno: v === SIN_VALOR ? null : (v as Turno),
              })
            }
          >
            <SelectTrigger className="h-9 border-[#e4c9b0] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_VALOR}>Todos</SelectItem>
              {TURNOS.map((t) => (
                <SelectItem key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Usuario */}
        <div className="space-y-1 min-w-[160px]">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
            Usuario
          </label>
          <Select
            value={filtros.usuario_id ?? SIN_VALOR}
            onValueChange={(v) =>
              onChange({
                ...filtros,
                usuario_id: v === SIN_VALOR ? null : v,
              })
            }
          >
            <SelectTrigger className="h-9 border-[#e4c9b0] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_VALOR}>Todos</SelectItem>
              {usuarios.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Categoría */}
        <div className="space-y-1 min-w-[160px]">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
            Categoría
          </label>
          <Select
            value={
              filtros.categoria_id != null
                ? String(filtros.categoria_id)
                : SIN_VALOR
            }
            onValueChange={(v) =>
              onChange({
                ...filtros,
                categoria_id: v === SIN_VALOR ? null : Number(v),
              })
            }
          >
            <SelectTrigger className="h-9 border-[#e4c9b0] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_VALOR}>Todas</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Fecha desde */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
            Desde
          </label>
          <Input
            type="date"
            value={filtros.fecha_desde ?? ''}
            onChange={(e) =>
              onChange({
                ...filtros,
                fecha_desde: e.target.value || null,
              })
            }
            className="h-9 border-[#e4c9b0] text-sm w-[150px]"
          />
        </div>

        {/* Fecha hasta */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#6f3a2a]">
            Hasta
          </label>
          <Input
            type="date"
            value={filtros.fecha_hasta ?? ''}
            onChange={(e) =>
              onChange({
                ...filtros,
                fecha_hasta: e.target.value || null,
              })
            }
            className="h-9 border-[#e4c9b0] text-sm w-[150px]"
          />
        </div>

        {/* Limpiar filtros */}
        {hayFiltrosActivos && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({})}
            className="text-[#c43e2c] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] h-9 gap-1"
          >
            <X className="h-3.5 w-3.5" />
            Limpiar
          </Button>
        )}
      </div>
    </div>
  )
}
