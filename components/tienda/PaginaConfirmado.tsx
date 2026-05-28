'use client'

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, MapPin, Phone } from 'lucide-react'
import { formatearMonto } from '@/lib/utils/formato'

export function PaginaConfirmado() {
  const params = useSearchParams()
  const codigo = params.get('codigo') ?? '—'
  const total = Number(params.get('total')) || 0

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="p-4 rounded-full bg-[#2f8f4e]/10 mb-4">
        <CheckCircle2 className="h-16 w-16 text-[#2f8f4e]" />
      </div>

      <h1 className="text-[#391511] text-2xl font-extrabold">
        ¡Pedido recibido!
      </h1>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-5 mt-6 w-full max-w-sm space-y-3">
        <div>
          <span className="text-[#c8a58a] text-xs font-bold uppercase tracking-wider">
            Código de pedido
          </span>
          <p className="text-[#391511] text-3xl font-extrabold tracking-tight">
            {codigo}
          </p>
        </div>

        <div className="border-t border-[#e4c9b0]/60 pt-3">
          <span className="text-[#c8a58a] text-xs font-bold uppercase tracking-wider">
            Total
          </span>
          <p className="text-[#391511] text-2xl font-extrabold tabular-nums">
            {formatearMonto(total)}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-2 text-sm text-[#6f3a2a] max-w-sm">
        <p className="font-medium">¿Qué sigue?</p>
        <div className="flex items-start gap-2 text-left">
          <Phone className="h-4 w-4 mt-0.5 text-[#c8a58a] shrink-0" />
          <p>
            Te vamos a contactar por{' '}
            <span className="font-bold text-[#391511]">WhatsApp</span>{' '}
            para confirmar tu pedido y coordinar el pago.
          </p>
        </div>
        <div className="flex items-start gap-2 text-left">
          <MapPin className="h-4 w-4 mt-0.5 text-[#c8a58a] shrink-0" />
          <p>
            Guardá el código{' '}
            <span className="font-bold text-[#391511]">{codigo}</span>{' '}
            para seguimiento.
          </p>
        </div>
      </div>

      <Link
        href="/tienda"
        className="mt-8 px-8 py-3.5 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl transition-colors text-base"
      >
        Seguir comprando
      </Link>

      <p className="mt-6 text-[#c8a58a] text-xs">
        ¡Hola! Express · Autoservicio 24hs · La Rioja, Argentina
      </p>
    </div>
  )
}
