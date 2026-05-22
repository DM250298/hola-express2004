'use client'

import { Calendar } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ClavePeriodo } from '@/lib/utils/periodos'

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Props {
  periodo: ClavePeriodo
  onCambioPeriodo: (p: ClavePeriodo) => void
  desdePersonalizado: string
  hastaPersonalizado: string
  onCambioDesde: (v: string) => void
  onCambioHasta: (v: string) => void
}

export function SelectorPeriodo({
  periodo,
  onCambioPeriodo,
  desdePersonalizado,
  hastaPersonalizado,
  onCambioDesde,
  onCambioHasta,
}: Props) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
          Período
        </Label>
        <Select
          value={periodo}
          onValueChange={(v) =>
            onCambioPeriodo((v ?? 'mes_actual') as ClavePeriodo)
          }
        >
          <SelectTrigger className="w-[200px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
            <Calendar className="h-3.5 w-3.5 text-[#c8a58a] mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ultimos_7">Última semana</SelectItem>
            <SelectItem value="mes_actual">Este mes</SelectItem>
            <SelectItem value="mes_anterior">Mes anterior</SelectItem>
            <SelectItem value="personalizado">Personalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {periodo === 'personalizado' && (
        <>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Desde
            </Label>
            <Input
              type="date"
              value={desdePersonalizado}
              max={hastaPersonalizado}
              onChange={(e) => onCambioDesde(e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums bg-white"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Hasta
            </Label>
            <Input
              type="date"
              value={hastaPersonalizado}
              min={desdePersonalizado}
              max={hoyIso()}
              onChange={(e) => onCambioHasta(e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums bg-white"
            />
          </div>
        </>
      )}
    </div>
  )
}
