'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import { useCuentas } from '@/lib/hooks/useCuentas'
import {
  useActualizarMedioPago,
  useCrearMedioPago,
} from '@/lib/hooks/useMediosPago'
import {
  OPCIONES_ICONO_MEDIO,
  resolverIconoMedio,
} from '@/lib/utils/iconosMedioPago'
import { cn } from '@/lib/utils'
import type { MedioPagoRow } from '@/types/database'

const SIN_CUENTA = '__sin_cuenta__'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  /** null = crear nuevo; row = editar */
  medio: MedioPagoRow | null
}

export function ModalMedioPago({ abierto, onCambioAbierto, medio }: Props) {
  const { data: cuentas } = useCuentas(true)
  const crear = useCrearMedioPago()
  const actualizar = useActualizarMedioPago()

  const [nombre, setNombre] = useState('')
  const [icono, setIcono] = useState('wallet')
  const [comision, setComision] = useState('0')
  const [diasAcred, setDiasAcred] = useState('0')
  const [cuentaId, setCuentaId] = useState<string>(SIN_CUENTA)
  const [disponibleTerminal, setDisponibleTerminal] = useState(false)
  const [mpPaymentType, setMpPaymentType] = useState<string>('')
  const [mpPaymentMethodId, setMpPaymentMethodId] = useState<string>('')

  const esEdicion = medio !== null
  const procesando = crear.isPending || actualizar.isPending

  useEffect(() => {
    if (!abierto) return
    setNombre(medio?.nombre ?? '')
    setIcono(medio?.icono ?? 'wallet')
    setComision(String(medio?.comision_porcentaje ?? 0))
    setDiasAcred(String(medio?.dias_acreditacion ?? 0))
    setCuentaId(medio?.cuenta_id ? String(medio.cuenta_id) : SIN_CUENTA)
    setDisponibleTerminal(medio?.disponible_terminal ?? false)
    setMpPaymentType(medio?.mp_payment_type ?? '')
    setMpPaymentMethodId(medio?.mp_payment_method_id ?? '')
  }, [abierto, medio])

  function guardar() {
    const nombreLimpio = nombre.trim()
    if (!nombreLimpio) return
    const comisionNum = Number(comision.replace(',', '.')) || 0
    if (comisionNum < 0 || comisionNum > 100) return
    const diasNum = Math.max(0, Math.floor(Number(diasAcred) || 0))
    const cuenta_id = cuentaId === SIN_CUENTA ? null : Number(cuentaId)

    const mpType = mpPaymentType.trim() || null
    const mpMethod = mpPaymentMethodId.trim() || null

    if (esEdicion && medio) {
      actualizar.mutate(
        {
          id: medio.id,
          patch: {
            nombre: nombreLimpio,
            icono,
            comision_porcentaje: comisionNum,
            dias_acreditacion: diasNum,
            cuenta_id,
            disponible_terminal: disponibleTerminal,
            mp_payment_type: mpType,
            mp_payment_method_id: mpMethod,
          },
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    } else {
      crear.mutate(
        {
          nombre: nombreLimpio,
          icono,
          comision_porcentaje: comisionNum,
          dias_acreditacion: diasNum,
          cuenta_id,
          disponible_terminal: disponibleTerminal,
          mp_payment_type: mpType,
          mp_payment_method_id: mpMethod,
        },
        { onSuccess: () => onCambioAbierto(false) }
      )
    }
  }

  const comisionNum = Number(comision.replace(',', '.'))
  const comisionValida =
    !Number.isNaN(comisionNum) && comisionNum >= 0 && comisionNum <= 100
  const puedeGuardar = nombre.trim().length > 0 && comisionValida && !procesando

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">
            {esEdicion ? 'Editar medio de pago' : 'Nuevo medio de pago'}
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {esEdicion
              ? 'Cambiá el nombre, icono, comisión o cuenta destino.'
              : 'Creá un medio nuevo (ej: Cuenta DNI, MODO, Naranja X).'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {/* Nombre */}
          <div className="space-y-1.5">
            <Label htmlFor="medio-nombre" className="text-[#391511] font-medium">
              Nombre
            </Label>
            <Input
              id="medio-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Cuenta DNI"
              maxLength={40}
              autoFocus
              disabled={procesando}
              className="border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
            />
          </div>

          {/* Icono */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">Icono</Label>
            <div className="grid grid-cols-6 gap-1.5">
              {OPCIONES_ICONO_MEDIO.map((op) => {
                const Icono = resolverIconoMedio(op.valor)
                const sel = icono === op.valor
                return (
                  <button
                    key={op.valor}
                    type="button"
                    onClick={() => setIcono(op.valor)}
                    title={op.etiqueta}
                    disabled={procesando}
                    className={cn(
                      'flex items-center justify-center h-10 rounded-lg border-2 transition-all',
                      sel
                        ? 'border-[#f9b44c] bg-[#f9b44c]/15 text-[#391511]'
                        : 'border-[#e4c9b0] bg-white text-[#6f3a2a] hover:border-[#c8a58a]'
                    )}
                  >
                    <Icono className="h-4 w-4" />
                  </button>
                )
              })}
            </div>
          </div>

          {/* Comisión + Plazo de acreditación */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="medio-comision" className="text-[#391511] font-medium">
                Comisión (%)
              </Label>
              <Input
                id="medio-comision"
                type="number"
                min={0}
                max={100}
                step="0.1"
                inputMode="decimal"
                value={comision}
                onChange={(e) => setComision(e.target.value)}
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="medio-dias" className="text-[#391511] font-medium">
                Plazo acreditación (días)
              </Label>
              <Input
                id="medio-dias"
                type="number"
                min={0}
                max={90}
                step="1"
                inputMode="numeric"
                value={diasAcred}
                onChange={(e) => setDiasAcred(e.target.value)}
                disabled={procesando}
                className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums"
              />
            </div>
          </div>
          <p className="text-[10px] text-[#c8a58a] -mt-2">
            <span className="font-semibold">0 días</span> = ingresa al banco al
            instante. Si es mayor a 0, las ventas con este medio quedan en
            &quot;Por cobrar&quot; hasta acreditarse.
          </p>

          {/* Cuenta destino */}
          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium">Cuenta destino</Label>
            <Select
              value={cuentaId}
              onValueChange={(v) => setCuentaId(v ?? SIN_CUENTA)}
              disabled={procesando}
            >
              <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <SelectValue placeholder="Sin cuenta asignada" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CUENTA}>
                  <span className="text-[#c8a58a] italic">
                    Sin cuenta — no reflejar
                  </span>
                </SelectItem>
                {cuentas?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Disponible en terminal */}
          <div className="flex items-start gap-3 rounded-lg border border-[#e4c9b0]/60 bg-[#fdfaf6] px-3 py-2.5">
            <Switch
              checked={disponibleTerminal}
              onCheckedChange={setDisponibleTerminal}
              disabled={procesando}
              aria-label="Disponible en terminal"
              className="mt-0.5"
            />
            <div className="flex-1 min-w-0">
              <Label className="text-[#391511] font-medium text-sm cursor-pointer">
                Disponible en terminal
              </Label>
              <p className="text-[11px] text-[#6f3a2a] mt-0.5">
                Aparece como forma de pago al cobrar con el posnet.
              </p>
            </div>
          </div>

          {/* Auto-detección desde MP (solo si está disponible en terminal) */}
          {disponibleTerminal && (
            <div className="rounded-lg border border-[#e4c9b0]/60 bg-white px-3 py-3 space-y-3">
              <div>
                <Label className="text-[#391511] font-medium text-sm">
                  Auto-detección desde Mercado Pago
                </Label>
                <p className="text-[11px] text-[#6f3a2a] mt-0.5">
                  Cuando MP Point apruebe un cobro, si los datos abajo coinciden
                  con lo que devuelve la API, este medio se selecciona solo (con
                  su comisión exacta) en lugar del que eligió el cajero.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mp-type" className="text-[#391511] text-xs font-medium">
                    payment_method.type
                  </Label>
                  <Input
                    id="mp-type"
                    value={mpPaymentType}
                    onChange={(e) => setMpPaymentType(e.target.value)}
                    placeholder="credit_card"
                    disabled={procesando}
                    list="mp-type-options"
                    className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] text-sm h-8"
                  />
                  <datalist id="mp-type-options">
                    <option value="credit_card" />
                    <option value="debit_card" />
                    <option value="prepaid_card" />
                    <option value="account_money" />
                    <option value="digital_currency" />
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mp-method" className="text-[#391511] text-xs font-medium">
                    payment_method.id
                  </Label>
                  <Input
                    id="mp-method"
                    value={mpPaymentMethodId}
                    onChange={(e) => setMpPaymentMethodId(e.target.value)}
                    placeholder="visa (vacío = cualquiera)"
                    disabled={procesando}
                    list="mp-method-options"
                    className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] text-sm h-8"
                  />
                  <datalist id="mp-method-options">
                    <option value="visa" />
                    <option value="master" />
                    <option value="amex" />
                    <option value="naranja" />
                    <option value="cabal" />
                    <option value="maestro" />
                    <option value="mercadopago_cc" />
                  </datalist>
                </div>
              </div>

              <p className="text-[10px] text-[#c8a58a] leading-relaxed">
                Dejá vacío el <strong>method.id</strong> para matchear cualquier
                tarjeta del mismo tipo (ej: solo &quot;debit_card&quot; aplica a
                cualquier tarjeta de débito). Dejá ambos vacíos si no querés
                auto-detección para este medio.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            disabled={procesando}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={guardar}
            disabled={!puedeGuardar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            {procesando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : esEdicion ? (
              'Guardar cambios'
            ) : (
              'Crear medio'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
