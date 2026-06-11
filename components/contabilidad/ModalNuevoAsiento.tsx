'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { useCrearAsiento, usePlanCuentas } from '@/lib/hooks/useContabilidad'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

interface LineaState {
  cuenta_id: string
  debe: string
  haber: string
}

const LINEA_VACIA: LineaState = { cuenta_id: '', debe: '', haber: '' }

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const r2 = (n: number) => Math.round(n * 100) / 100

export function ModalNuevoAsiento({ abierto, onCambioAbierto }: Props) {
  const { data: usuario } = useUsuario()
  const { data: cuentas } = usePlanCuentas()
  const crear = useCrearAsiento()

  const [fecha, setFecha] = useState(hoyIso())
  const [descripcion, setDescripcion] = useState('')
  const [lineas, setLineas] = useState<LineaState[]>([
    { ...LINEA_VACIA },
    { ...LINEA_VACIA },
  ])

  useEffect(() => {
    if (abierto) {
      setFecha(hoyIso())
      setDescripcion('')
      setLineas([{ ...LINEA_VACIA }, { ...LINEA_VACIA }])
    }
  }, [abierto])

  // Solo cuentas imputables y activas se pueden usar en un asiento
  const cuentasImputables = useMemo(
    () => (cuentas ?? []).filter((c) => c.imputable && c.activo),
    [cuentas]
  )
  const itemsCuenta = useMemo(() => {
    const r: Record<string, string> = {}
    for (const c of cuentasImputables) {
      r[String(c.id)] = `${c.codigo} · ${c.nombre}`
    }
    return r
  }, [cuentasImputables])

  const totalDebe = lineas.reduce((s, l) => s + (Number(l.debe) || 0), 0)
  const totalHaber = lineas.reduce((s, l) => s + (Number(l.haber) || 0), 0)
  const diferencia = r2(totalDebe - totalHaber)
  const balanceado = diferencia === 0 && r2(totalDebe) > 0
  const lineasValidas = lineas.filter(
    (l) => l.cuenta_id && (Number(l.debe) > 0 || Number(l.haber) > 0)
  )
  const puedeGuardar =
    descripcion.trim().length > 0 &&
    lineasValidas.length >= 2 &&
    balanceado &&
    !crear.isPending

  function setLinea(idx: number, campo: keyof LineaState, valor: string) {
    setLineas((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [campo]: valor } : l))
    )
  }
  function agregarLinea() {
    setLineas((prev) => [...prev, { ...LINEA_VACIA }])
  }
  function quitarLinea(idx: number) {
    setLineas((prev) =>
      prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx)
    )
  }

  function guardar() {
    if (!puedeGuardar || !usuario) return
    crear.mutate(
      {
        fecha,
        descripcion: descripcion.trim(),
        usuario_id: usuario.id,
        lineas: lineasValidas.map((l) => ({
          cuenta_id: Number(l.cuenta_id),
          debe: r2(Number(l.debe) || 0),
          haber: r2(Number(l.haber) || 0),
        })),
      },
      { onSuccess: () => onCambioAbierto(false) }
    )
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !crear.isPending && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg">
            Nuevo asiento manual
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            El total del Debe debe ser igual al total del Haber.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-1 flex-col min-h-0"
          onSubmit={(e) => {
            e.preventDefault()
            guardar()
          }}
        >
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-[160px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Fecha
              </Label>
              <Input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={crear.isPending}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Descripción
              </Label>
              <Input
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Ej: Ajuste de caja"
                autoFocus
                disabled={crear.isPending}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_110px_110px_32px] gap-2 px-1 text-[10px] uppercase tracking-wider text-[#c8a58a] font-semibold">
              <span>Cuenta</span>
              <span className="text-right">Debe</span>
              <span className="text-right">Haber</span>
              <span />
            </div>
            {lineas.map((l, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_110px_110px_32px] gap-2 items-center"
              >
                <Select
                  items={itemsCuenta}
                  value={l.cuenta_id || undefined}
                  onValueChange={(v) => setLinea(idx, 'cuenta_id', v ?? '')}
                  disabled={crear.isPending}
                >
                  <SelectTrigger className="h-9 border-[#e4c9b0] focus:ring-[#f9b44c] bg-white text-xs">
                    <SelectValue placeholder="Elegí una cuenta…" />
                  </SelectTrigger>
                  <SelectContent>
                    {cuentasImputables.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.codigo} · {c.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.debe}
                  onChange={(e) => setLinea(idx, 'debe', e.target.value)}
                  placeholder="0,00"
                  disabled={crear.isPending}
                  className="h-9 text-right tabular-nums border-[#e4c9b0]"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.haber}
                  onChange={(e) => setLinea(idx, 'haber', e.target.value)}
                  placeholder="0,00"
                  disabled={crear.isPending}
                  className="h-9 text-right tabular-nums border-[#e4c9b0]"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => quitarLinea(idx)}
                  disabled={crear.isPending || lineas.length <= 2}
                  className="h-9 w-8 p-0 text-[#c8a58a] hover:text-[#c43e2c] disabled:opacity-30"
                  aria-label="Quitar línea"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={agregarLinea}
              disabled={crear.isPending}
              className="text-[#6f3a2a] hover:bg-[#f9d2a2]/40 gap-1 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar línea
            </Button>
          </div>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 shrink-0">
          <div className="flex items-center justify-between mb-3 text-sm">
            <span className="text-[#6f3a2a]">
              Debe:{' '}
              <span className="font-bold text-[#391511] tabular-nums">
                <MontoARS monto={totalDebe} />
              </span>
              <span className="mx-2 text-[#c8a58a]">·</span>
              Haber:{' '}
              <span className="font-bold text-[#391511] tabular-nums">
                <MontoARS monto={totalHaber} />
              </span>
            </span>
            <span
              className={cn(
                'text-xs font-semibold px-2 py-1 rounded-full',
                balanceado
                  ? 'bg-[#2f8f4e]/15 text-[#2f8f4e]'
                  : 'bg-[#c43e2c]/15 text-[#c43e2c]'
              )}
            >
              {balanceado
                ? 'Balanceado'
                : `Diferencia ${diferencia.toFixed(2)}`}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onCambioAbierto(false)}
              disabled={crear.isPending}
              className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!puedeGuardar}
              className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
            >
              {crear.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                'Registrar asiento'
              )}
            </Button>
          </div>
        </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
