'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  useCrearMovimiento,
  useCrearTransferencia,
  useCuentas,
} from '@/lib/hooks/useCuentas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  CATEGORIAS_EGRESO_MOV,
  CATEGORIAS_INGRESO,
} from '@/lib/queries/cuentas'
import { cn } from '@/lib/utils'

type Modo = 'ingreso' | 'egreso' | 'transferencia'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  modoInicial?: Modo
  cuentaIdInicial?: number | null
}

function hoyIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MODOS: Array<{
  valor: Modo
  etiqueta: string
  icono: React.ElementType
  color: string
  descripcion: string
}> = [
  {
    valor: 'ingreso',
    etiqueta: 'Ingreso',
    icono: ArrowDown,
    color: '#6f3a2a',
    descripcion: 'Entra plata',
  },
  {
    valor: 'egreso',
    etiqueta: 'Egreso',
    icono: ArrowUp,
    color: '#c43e2c',
    descripcion: 'Sale plata',
  },
  {
    valor: 'transferencia',
    etiqueta: 'Transferencia',
    icono: ArrowRightLeft,
    color: '#391511',
    descripcion: 'Entre cuentas',
  },
]

export function ModalNuevoMovimiento({
  abierto,
  onCambioAbierto,
  modoInicial = 'ingreso',
  cuentaIdInicial = null,
}: Props) {
  const { data: usuario } = useUsuario()
  const { data: cuentas } = useCuentas(true)
  const crearMov = useCrearMovimiento()
  const crearTransf = useCrearTransferencia()

  const [modo, setModo] = useState<Modo>(modoInicial)
  const [cuentaId, setCuentaId] = useState<string>('')
  const [cuentaDestinoId, setCuentaDestinoId] = useState<string>('')
  const [monto, setMonto] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [categoria, setCategoria] = useState<string>('')
  const [fecha, setFecha] = useState(hoyIso())

  useEffect(() => {
    if (abierto) {
      setModo(modoInicial)
      setCuentaId(cuentaIdInicial ? String(cuentaIdInicial) : '')
      setCuentaDestinoId('')
      setMonto('')
      setDescripcion('')
      setCategoria('')
      setFecha(hoyIso())
    }
  }, [abierto, modoInicial, cuentaIdInicial])

  const procesando = crearMov.isPending || crearTransf.isPending
  const montoNum = Number(monto) || 0

  // Categorías según modo
  const categoriasDisponibles = useMemo(() => {
    if (modo === 'ingreso') return CATEGORIAS_INGRESO
    if (modo === 'egreso') return CATEGORIAS_EGRESO_MOV
    return []
  }, [modo])

  // Saldo de la cuenta seleccionada (origen)
  const cuentaSel = cuentas?.find((c) => String(c.id) === cuentaId)
  const cuentaDestSel = cuentas?.find((c) => String(c.id) === cuentaDestinoId)
  const saldoResultante =
    cuentaSel && montoNum > 0
      ? modo === 'ingreso'
        ? Number(cuentaSel.saldo_actual) + montoNum
        : Number(cuentaSel.saldo_actual) - montoNum
      : null

  const errorSaldoNegativo =
    (modo === 'egreso' || modo === 'transferencia') &&
    saldoResultante !== null &&
    saldoResultante < 0

  const puedeConfirmar =
    !procesando &&
    !!usuario &&
    cuentaId !== '' &&
    montoNum > 0 &&
    descripcion.trim().length > 0 &&
    (modo !== 'transferencia' || (cuentaDestinoId !== '' && cuentaDestinoId !== cuentaId))

  async function confirmar() {
    if (!puedeConfirmar || errorSaldoNegativo || !usuario) return

    try {
      if (modo === 'transferencia') {
        await crearTransf.mutateAsync({
          cuenta_origen_id: Number(cuentaId),
          cuenta_destino_id: Number(cuentaDestinoId),
          monto: montoNum,
          descripcion: descripcion.trim(),
          fecha,
          usuario_id: usuario.id,
        })
      } else {
        await crearMov.mutateAsync({
          cuenta_id: Number(cuentaId),
          tipo: modo, // 'ingreso' | 'egreso'
          monto: montoNum,
          descripcion: descripcion.trim(),
          categoria: categoria || null,
          fecha,
          usuario_id: usuario.id,
        })
      }
      onCambioAbierto(false)
    } catch {
      // toast manejado en hook
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg">
            Nuevo movimiento
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Registrá un ingreso, egreso o transferencia entre cuentas.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-1 flex-col min-h-0"
          onSubmit={(e) => {
            e.preventDefault()
            confirmar()
          }}
        >
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Selector de modo */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold mb-2 block">
              Tipo de movimiento
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {MODOS.map((m) => {
                const activo = modo === m.valor
                const Icono = m.icono
                return (
                  <button
                    key={m.valor}
                    type="button"
                    onClick={() => setModo(m.valor)}
                    disabled={procesando}
                    className={cn(
                      'flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 transition-all',
                      activo
                        ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                        : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                    )}
                  >
                    <Icono
                      className="h-4 w-4"
                      style={!activo ? { color: m.color } : undefined}
                    />
                    <span className="text-xs font-bold">{m.etiqueta}</span>
                    <span className="text-[10px] leading-none opacity-70">
                      {m.descripcion}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Cuenta (origen) */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              {modo === 'transferencia' ? 'Cuenta origen' : 'Cuenta'}{' '}
              <span className="text-[#c43e2c]">*</span>
            </Label>
            <Select
              value={cuentaId}
              onValueChange={(v) => setCuentaId(v ?? '')}
              disabled={procesando}
            >
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                <SelectValue placeholder="Elegí una cuenta…" />
              </SelectTrigger>
              <SelectContent>
                {cuentas?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nombre} ·{' '}
                    <span className="font-mono tabular-nums">
                      ${Number(c.saldo_actual).toFixed(2)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Cuenta destino (solo transferencia) */}
          {modo === 'transferencia' && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                Cuenta destino <span className="text-[#c43e2c]">*</span>
              </Label>
              <Select
                value={cuentaDestinoId}
                onValueChange={(v) => setCuentaDestinoId(v ?? '')}
                disabled={procesando}
              >
                <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                  <SelectValue placeholder="Elegí cuenta destino…" />
                </SelectTrigger>
                <SelectContent>
                  {cuentas
                    ?.filter((c) => String(c.id) !== cuentaId)
                    .map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nombre} ·{' '}
                        <span className="font-mono tabular-nums">
                          ${Number(c.saldo_actual).toFixed(2)}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Monto */}
          <div className="space-y-1.5">
            <Label htmlFor="monto-mov" className="text-[#391511] font-medium text-sm">
              Monto <span className="text-[#c43e2c]">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6f3a2a] text-lg font-bold">
                $
              </span>
              <Input
                id="monto-mov"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                autoFocus
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="0,00"
                disabled={procesando}
                className="pl-7 h-12 text-xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
              />
            </div>

            {saldoResultante !== null && (
              <div
                className={cn(
                  'rounded-lg px-3 py-2 text-xs flex items-center justify-between mt-1',
                  errorSaldoNegativo
                    ? 'bg-[#c43e2c]/10 text-[#c43e2c]'
                    : 'bg-[#fdfaf6] text-[#6f3a2a]'
                )}
              >
                <span>Saldo resultante en {cuentaSel?.nombre}</span>
                <span className="font-bold tabular-nums">
                  <MontoARS monto={saldoResultante} />
                </span>
              </div>
            )}
            {errorSaldoNegativo && (
              <p className="text-[#c43e2c] text-xs">
                Esta cuenta no tiene saldo suficiente.
              </p>
            )}
          </div>

          {/* Fecha + Categoría */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="fecha-mov" className="text-[#391511] font-medium text-sm">
                Fecha
              </Label>
              <Input
                id="fecha-mov"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>

            {modo !== 'transferencia' && (
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm">
                  Categoría
                </Label>
                <Select
                  value={categoria}
                  onValueChange={(v) => setCategoria(v ?? '')}
                  disabled={procesando}
                >
                  <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriasDisponibles.map((c) => (
                      <SelectItem key={c.valor} value={c.valor}>
                        {c.etiqueta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Descripción */}
          <div className="space-y-1.5">
            <Label htmlFor="desc-mov" className="text-[#391511] font-medium text-sm">
              Descripción <span className="text-[#c43e2c]">*</span>
            </Label>
            <Input
              id="desc-mov"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder={
                modo === 'ingreso'
                  ? 'Ej: Aporte de socio'
                  : modo === 'egreso'
                  ? 'Ej: Pago de luz mes 5'
                  : 'Ej: Pase de caja a banco'
              }
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-[#e4c9b0]/60 bg-[#fdfaf6] flex-row gap-2 sm:gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={!puedeConfirmar || errorSaldoNegativo}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando…
              </>
            ) : (
              'Registrar movimiento'
            )}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
