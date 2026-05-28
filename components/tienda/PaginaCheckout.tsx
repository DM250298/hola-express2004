'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Store,
  Truck,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { formatearMonto } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import { useCarritoTienda } from './CarritoContext'

type MetodoEntrega = 'retiro' | 'delivery'

export function PaginaCheckout() {
  const router = useRouter()
  const { items, total, cantidadTotal, vaciar } = useCarritoTienda()

  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState('')
  const [email, setEmail] = useState('')
  const [metodoEntrega, setMetodoEntrega] =
    useState<MetodoEntrega>('retiro')
  const [direccion, setDireccion] = useState('')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-[#391511] font-bold text-lg">
          No hay productos en tu carrito.
        </p>
        <Link
          href="/tienda"
          className="mt-4 px-6 py-3 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-extrabold rounded-xl transition-colors"
        >
          Ver productos
        </Link>
      </div>
    )
  }

  async function enviarPedido() {
    if (!nombre.trim()) {
      setError('Ingresá tu nombre.')
      return
    }
    if (!telefono.trim()) {
      setError('Ingresá tu teléfono para que te contactemos.')
      return
    }
    if (metodoEntrega === 'delivery' && !direccion.trim()) {
      setError('Ingresá tu dirección para el envío.')
      return
    }

    setEnviando(true)
    setError(null)

    try {
      const res = await fetch('/api/tienda/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_nombre: nombre.trim(),
          cliente_telefono: telefono.trim(),
          cliente_email: email.trim() || undefined,
          cliente_direccion:
            metodoEntrega === 'delivery'
              ? direccion.trim()
              : undefined,
          cliente_notas: notas.trim() || undefined,
          metodo_entrega: metodoEntrega,
          items: items.map((i) => ({
            producto_id: i.producto_id,
            nombre: i.nombre,
            precio_unitario: i.precio_unitario,
            cantidad: i.cantidad,
          })),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Error al crear el pedido.')
        setEnviando(false)
        return
      }

      // Limpiar carrito y redirigir a confirmación
      vaciar()
      router.push(
        `/tienda/confirmado?codigo=${data.pedido.codigo}&total=${data.pedido.total}`
      )
    } catch {
      setError('Error de conexión. Intentá de nuevo.')
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <Link
          href="/tienda/carrito"
          className="p-2 rounded-xl hover:bg-[#f9d2a2]/40 text-[#6f3a2a] transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-[#391511] text-xl font-extrabold">
          Completá tu pedido
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
        {/* Resumen del pedido */}
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4">
          <h2 className="text-[#391511] font-bold text-sm mb-2">
            Resumen · {cantidadTotal}{' '}
            {cantidadTotal === 1 ? 'producto' : 'productos'}
          </h2>
          <div className="space-y-1.5">
            {items.map((i) => (
              <div
                key={i.producto_id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-[#6f3a2a] truncate flex-1 mr-2">
                  {i.cantidad}× {i.nombre}
                </span>
                <span className="text-[#391511] font-bold tabular-nums shrink-0">
                  {formatearMonto(i.precio_unitario * i.cantidad)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-[#e4c9b0]/60 mt-3 pt-3 flex items-baseline justify-between">
            <span className="text-[#6f3a2a] font-medium text-sm uppercase tracking-wider">
              Total
            </span>
            <span className="text-[#391511] text-xl font-extrabold tabular-nums">
              {formatearMonto(total)}
            </span>
          </div>
        </div>

        {/* Método de entrega */}
        <div className="space-y-2">
          <h2 className="text-[#391511] font-bold text-sm">
            ¿Cómo lo querés?
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMetodoEntrega('retiro')}
              className={cn(
                'p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all',
                metodoEntrega === 'retiro'
                  ? 'border-[#f9b44c] bg-[#f9b44c]/10'
                  : 'border-[#e4c9b0] bg-white'
              )}
            >
              <Store
                className={cn(
                  'h-6 w-6',
                  metodoEntrega === 'retiro'
                    ? 'text-[#391511]'
                    : 'text-[#c8a58a]'
                )}
              />
              <span
                className={cn(
                  'text-sm font-bold',
                  metodoEntrega === 'retiro'
                    ? 'text-[#391511]'
                    : 'text-[#6f3a2a]'
                )}
              >
                Retiro en local
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMetodoEntrega('delivery')}
              className={cn(
                'p-4 rounded-2xl border-2 flex flex-col items-center gap-2 transition-all',
                metodoEntrega === 'delivery'
                  ? 'border-[#f9b44c] bg-[#f9b44c]/10'
                  : 'border-[#e4c9b0] bg-white'
              )}
            >
              <Truck
                className={cn(
                  'h-6 w-6',
                  metodoEntrega === 'delivery'
                    ? 'text-[#391511]'
                    : 'text-[#c8a58a]'
                )}
              />
              <span
                className={cn(
                  'text-sm font-bold',
                  metodoEntrega === 'delivery'
                    ? 'text-[#391511]'
                    : 'text-[#6f3a2a]'
                )}
              >
                Envío a domicilio
              </span>
            </button>
          </div>
        </div>

        {/* Datos del cliente */}
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-4 space-y-3">
          <h2 className="text-[#391511] font-bold text-sm">Tus datos</h2>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Nombre *
            </Label>
            <Input
              placeholder="Ej: Juan Pérez"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="h-11 rounded-xl border-[#e4c9b0] text-base"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Teléfono / WhatsApp *
            </Label>
            <Input
              type="tel"
              placeholder="Ej: 380 4123456"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              className="h-11 rounded-xl border-[#e4c9b0] text-base"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Email (opcional)
            </Label>
            <Input
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl border-[#e4c9b0] text-base"
            />
          </div>

          {metodoEntrega === 'delivery' && (
            <div className="space-y-1.5">
              <Label className="text-[#391511] font-medium text-sm">
                <MapPin className="h-3.5 w-3.5 inline mr-1" />
                Dirección de envío *
              </Label>
              <Input
                placeholder="Calle, número, barrio"
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                className="h-11 rounded-xl border-[#e4c9b0] text-base"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-[#391511] font-medium text-sm">
              Notas del pedido (opcional)
            </Label>
            <Input
              placeholder="Instrucciones especiales, aclaraciones…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="h-11 rounded-xl border-[#e4c9b0] text-base"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-[#c43e2c]/10 border border-[#c43e2c]/30 rounded-xl px-4 py-3">
            <p className="text-[#c43e2c] text-sm font-medium">{error}</p>
          </div>
        )}
      </div>

      {/* Botón enviar */}
      <div className="sticky bottom-0 bg-white border-t border-[#e4c9b0]/60 px-4 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <button
          type="button"
          onClick={enviarPedido}
          disabled={enviando}
          className="w-full h-14 bg-[#2f8f4e] hover:bg-[#267a40] disabled:opacity-60 text-white font-extrabold rounded-xl text-base flex items-center justify-center gap-2 transition-colors shadow-md"
        >
          {enviando ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Enviando pedido…
            </>
          ) : (
            <>Confirmar pedido · {formatearMonto(total)}</>
          )}
        </button>
        <p className="text-[#c8a58a] text-[10px] text-center mt-2">
          Te contactaremos por WhatsApp para confirmar y coordinar el pago.
        </p>
      </div>
    </div>
  )
}
