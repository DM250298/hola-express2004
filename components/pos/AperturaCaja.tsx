'use client'

import { useState } from 'react'
import { Banknote, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { useAbrirTurno } from '@/lib/hooks/useTurno'

interface Props {
  usuarioId: string
  nombreUsuario: string
}

export function AperturaCaja({ usuarioId, nombreUsuario }: Props) {
  const abrir = useAbrirTurno()
  const [monto, setMonto] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const valor = Number(monto)
    if (!Number.isFinite(valor) || valor < 0) {
      setError('Ingresá un monto válido (puede ser 0).')
      return
    }
    abrir.mutate({ usuarioId, montoApertura: valor })
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Card className="w-full max-w-md shadow-xl border-0 rounded-2xl overflow-hidden">
        <div className="bg-[#391511] px-8 py-7 text-center">
          <div className="inline-flex p-3 rounded-full bg-[#f9b44c]/20 mb-2">
            <Banknote className="h-7 w-7 text-[#f9b44c]" />
          </div>
          <h1 className="text-[#f9b44c] text-2xl font-extrabold leading-tight">
            Abrir turno de caja
          </h1>
          <p className="text-[#f9d2a2] text-sm mt-1">
            Hola, {nombreUsuario}. Empezá ingresando el monto inicial de la caja.
          </p>
        </div>

        <CardContent className="px-8 py-7 bg-white">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="monto" className="text-[#391511] font-medium">
                Monto de apertura
              </Label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6f3a2a] text-xl font-bold">
                  $
                </span>
                <Input
                  id="monto"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="0,00"
                  autoFocus
                  disabled={abrir.isPending}
                  className="pl-10 h-14 text-2xl font-semibold tabular-nums border-[#e4c9b0] focus-visible:ring-[#f9b44c]"
                />
              </div>
              {error && (
                <p className="text-[#c43e2c] text-xs mt-1">{error}</p>
              )}
              <p className="text-[#6f3a2a] text-xs mt-1">
                Contá el efectivo de la caja al iniciar tu turno.
              </p>
            </div>

            <Button
              type="submit"
              disabled={abrir.isPending}
              className="w-full bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold h-12 text-base rounded-xl"
            >
              {abrir.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Abriendo turno…
                </>
              ) : (
                'Abrir turno'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
