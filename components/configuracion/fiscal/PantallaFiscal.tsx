'use client'

import { useEffect, useState } from 'react'
import { Loader2, Save, Landmark } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useConfigFiscal,
  useActualizarConfigFiscal,
} from '@/lib/hooks/useFiscal'
import type { ConfigFiscalUpdate } from '@/types/database'

interface FormState {
  cuit: string
  razon_social: string
  condicion_iva: string
  iibb_jurisdiccion: string
  iibb_alicuota: string
  iva_alicuota_general: string
  iva_dia_vencimiento: string
  iibb_dia_vencimiento: string
  actividad: string
}

const CONDICIONES_IVA = [
  { valor: 'responsable_inscripto', etiqueta: 'Responsable Inscripto' },
  { valor: 'monotributo', etiqueta: 'Monotributo' },
  { valor: 'exento', etiqueta: 'Exento' },
]

export function PantallaFiscal() {
  const { data, isLoading } = useConfigFiscal()
  const guardar = useActualizarConfigFiscal()
  const [form, setForm] = useState<FormState | null>(null)

  useEffect(() => {
    if (!data) return
    setForm({
      cuit: data.cuit,
      razon_social: data.razon_social,
      condicion_iva: data.condicion_iva,
      iibb_jurisdiccion: data.iibb_jurisdiccion,
      iibb_alicuota: String(data.iibb_alicuota),
      iva_alicuota_general: String(data.iva_alicuota_general),
      iva_dia_vencimiento: String(data.iva_dia_vencimiento),
      iibb_dia_vencimiento: String(data.iibb_dia_vencimiento),
      actividad: data.actividad,
    })
  }, [data])

  function set(campo: keyof FormState, valor: string) {
    setForm((prev) => (prev ? { ...prev, [campo]: valor } : prev))
  }

  function handleGuardar() {
    if (!form || guardar.isPending) return
    const patch: ConfigFiscalUpdate = {
      cuit: form.cuit.trim(),
      razon_social: form.razon_social.trim(),
      condicion_iva: form.condicion_iva,
      iibb_jurisdiccion: form.iibb_jurisdiccion.trim(),
      iibb_alicuota: Number(form.iibb_alicuota) || 0,
      iva_alicuota_general: Number(form.iva_alicuota_general) || 0,
      iva_dia_vencimiento: Number(form.iva_dia_vencimiento) || 1,
      iibb_dia_vencimiento: Number(form.iibb_dia_vencimiento) || 1,
      actividad: form.actividad.trim(),
    }
    guardar.mutate(patch)
  }

  if (isLoading || !form) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
        <Skeleton className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Identificación */}
      <section className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-[#f9b44c]" />
          <h2 className="text-[#391511] font-bold">Identificación fiscal</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo label="Razón social">
            <Input
              value={form.razon_social}
              onChange={(e) => set('razon_social', e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </Campo>
          <Campo label="CUIT">
            <Input
              inputMode="numeric"
              placeholder="30-xxxxxxxx-x"
              value={form.cuit}
              onChange={(e) => set('cuit', e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </Campo>
          <Campo label="Condición frente al IVA">
            <Select
              value={form.condicion_iva}
              onValueChange={(v) =>
                set('condicion_iva', v ?? 'responsable_inscripto')
              }
            >
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDICIONES_IVA.map((c) => (
                  <SelectItem key={c.valor} value={c.valor}>
                    {c.etiqueta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
          <Campo label="Actividad (AFIP)">
            <Input
              value={form.actividad}
              onChange={(e) => set('actividad', e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </Campo>
        </div>
      </section>

      {/* Alícuotas y vencimientos */}
      <section className="rounded-2xl border border-[#e4c9b0]/60 bg-white p-5 space-y-4">
        <h2 className="text-[#391511] font-bold">Alícuotas y vencimientos</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Campo label="IVA general (%)">
            <Input
              type="number"
              step="0.5"
              value={form.iva_alicuota_general}
              onChange={(e) => set('iva_alicuota_general', e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </Campo>
          <Campo label="IIBB jurisdicción">
            <Input
              value={form.iibb_jurisdiccion}
              onChange={(e) => set('iibb_jurisdiccion', e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </Campo>
          <Campo label="IIBB alícuota (%)">
            <Input
              type="number"
              step="0.1"
              value={form.iibb_alicuota}
              onChange={(e) => set('iibb_alicuota', e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </Campo>
          <Campo label="Día venc. IVA">
            <Input
              type="number"
              min="1"
              max="28"
              value={form.iva_dia_vencimiento}
              onChange={(e) => set('iva_dia_vencimiento', e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </Campo>
          <Campo label="Día venc. IIBB">
            <Input
              type="number"
              min="1"
              max="28"
              value={form.iibb_dia_vencimiento}
              onChange={(e) => set('iibb_dia_vencimiento', e.target.value)}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
            />
          </Campo>
        </div>
        <p className="text-[11px] text-[#c8a58a]">
          La alícuota de IIBB se usa para estimar el impuesto del período en el
          tab Impuestos. El día de vencimiento alimenta el calendario de
          próximos vencimientos. Confirmá los valores con tu contador.
        </p>
      </section>

      <div className="flex justify-end">
        <Button
          onClick={handleGuardar}
          disabled={guardar.isPending}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold"
        >
          {guardar.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Guardando…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Guardar configuración
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

function Campo({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        {label}
      </Label>
      {children}
    </div>
  )
}
