'use client'

import { useEffect, useRef, useState } from 'react'
import { Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MontoARS } from '@/components/shared/MontoARS'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  nombre: string
  precioPorKg: number
  /** Si el producto ya está en carrito, muestra el peso actual para editarlo. */
  pesoActualKg?: number
  onConfirmar: (kg: number) => void
}

const TECLAS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '⌫', '0', '00']

export function ModalIngresoPeso({
  abierto,
  onCambioAbierto,
  nombre,
  precioPorKg,
  pesoActualKg,
  onConfirmar,
}: Props) {
  // Almacenamos los gramos como string para el teclado numérico
  const [gramos, setGramos] = useState('')
  // Ref espejo para leer el valor actual desde el listener de teclado.
  const gramosRef = useRef('')
  useEffect(() => {
    gramosRef.current = gramos
  }, [gramos])

  useEffect(() => {
    if (abierto) {
      // Si ya hay un peso en carrito, pre-cargarlo en gramos
      setGramos(
        pesoActualKg ? String(Math.round(pesoActualKg * 1000)) : ''
      )
    }
  }, [abierto, pesoActualKg])

  /** Agrega dígitos (uno o "00") respetando el máximo de 50 kg. */
  function agregarDigitos(d: string) {
    setGramos((prev) => {
      const nuevo = prev + d
      if (Number(nuevo) > 50000) return prev // máx 50 000 g = 50 kg
      return nuevo
    })
  }

  function presionar(tecla: string) {
    if (tecla === '⌫') {
      setGramos((prev) => prev.slice(0, -1))
      return
    }
    agregarDigitos(tecla)
  }

  const gramosNum = Number(gramos) || 0
  const kg = gramosNum / 1000
  const subtotal = kg * precioPorKg
  const puedeConfirmar = gramosNum > 0

  function confirmar() {
    if (!puedeConfirmar) return
    onConfirmar(kg)
    onCambioAbierto(false)
  }

  // Teclado físico: dígitos escriben gramos, Backspace borra, Enter confirma.
  useEffect(() => {
    if (!abierto) return
    function onKey(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        agregarDigitos(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        setGramos((prev) => prev.slice(0, -1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const g = Number(gramosRef.current) || 0
        if (g > 0) {
          onConfirmar(g / 1000)
          onCambioAbierto(false)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abierto, onConfirmar, onCambioAbierto])

  return (
    <Dialog open={abierto} onOpenChange={onCambioAbierto}>
      <DialogContent className="sm:max-w-xs p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-base flex items-center gap-2">
            <Scale className="h-4 w-4 text-[#f9b44c]" />
            Ingresar peso
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a] text-sm truncate">
            {nombre}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          {/* Display del peso y precio */}
          <div className="bg-[#fdfaf6] border border-[#e4c9b0]/60 rounded-xl px-4 py-3 text-center space-y-1">
            <div className="text-3xl font-extrabold text-[#391511] tabular-nums tracking-tight">
              {gramosNum > 0 ? (
                <>
                  {gramosNum >= 1000
                    ? `${(gramosNum / 1000).toFixed(3).replace('.', ',')} kg`
                    : `${gramosNum} g`}
                </>
              ) : (
                <span className="text-[#c8a58a]">0 g</span>
              )}
            </div>
            <div className="text-xs text-[#6f3a2a]">
              <MontoARS monto={precioPorKg} />
              {' '}/ kg
            </div>
            {gramosNum > 0 && (
              <div className="text-lg font-bold text-[#f9b44c] tabular-nums">
                = <MontoARS monto={subtotal} />
              </div>
            )}
          </div>

          {/* Teclado numérico */}
          <div className="grid grid-cols-3 gap-2">
            {TECLAS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => presionar(t)}
                className={
                  t === '⌫'
                    ? 'h-12 rounded-xl border border-[#e4c9b0] bg-white text-[#c43e2c] font-bold text-xl hover:bg-[#c43e2c]/10 active:scale-95 transition-all'
                    : 'h-12 rounded-xl border border-[#e4c9b0] bg-white text-[#391511] font-bold text-lg hover:bg-[#f9d2a2]/40 active:scale-95 transition-all tabular-nums'
                }
              >
                {t}
              </button>
            ))}
          </div>

          <p className="text-[10px] text-[#c8a58a] text-center">
            También podés escribir el peso (en gramos) con el teclado · Enter
            para agregar
          </p>
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-5 py-3 flex gap-2">
          <Button
            variant="outline"
            onClick={() => onCambioAbierto(false)}
            className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={!puedeConfirmar}
            className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50"
          >
            Agregar al carrito
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
