'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  CheckCircle2,
  Cloud,
  CloudOff,
  Delete,
  Loader2,
  X,
} from 'lucide-react'
import { iniciales, nombreCompleto } from './constantes'
import { useFichajeOffline } from '@/lib/hooks/useFichajeOffline'
import {
  getEmpleadosParaKiosco,
  registrarFichajeKiosco,
  type ResultadoFichaje,
} from '@/lib/queries/asistencia'
import { leerEmpleadosKiosco, type EmpleadoKiosco } from '@/lib/offline/empleadosKiosco'
import { horaAr } from './asistenciaConstantes'
import { cn } from '@/lib/utils'

type Paso = 'empleados' | 'pin' | 'resultado'

export function Kiosco() {
  const { online, pendientes, sincronizando } = useFichajeOffline()
  const [empleados, setEmpleados] = useState<EmpleadoKiosco[]>([])
  const [paso, setPaso] = useState<Paso>('empleados')
  const [sel, setSel] = useState<EmpleadoKiosco | null>(null)
  const [pin, setPin] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<ResultadoFichaje | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cargar empleados (online cachea; offline lee del cache).
  useEffect(() => {
    ;(async () => {
      try {
        setEmpleados(await getEmpleadosParaKiosco())
      } catch {
        setEmpleados(await leerEmpleadosKiosco())
      }
    })()
  }, [])

  useEffect(() => () => {
    if (timeout.current) clearTimeout(timeout.current)
  }, [])

  function cancelarTimeout() {
    if (timeout.current) {
      clearTimeout(timeout.current)
      timeout.current = null
    }
  }

  function reiniciar() {
    cancelarTimeout()
    setPaso('empleados')
    setSel(null)
    setPin('')
    setResultado(null)
    setError(null)
  }

  function elegir(emp: EmpleadoKiosco) {
    cancelarTimeout()
    setSel(emp)
    setPin('')
    setError(null)
    setPaso('pin')
  }

  async function enviar(pinCompleto: string) {
    if (!sel) return
    setEnviando(true)
    setError(null)
    try {
      const r = await registrarFichajeKiosco(
        { id: sel.id, nombre: nombreCompleto(sel) },
        pinCompleto
      )
      setResultado(r)
      setPaso('resultado')
      timeout.current = setTimeout(reiniciar, 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo fichar.')
      setPin('')
    } finally {
      setEnviando(false)
    }
  }

  function tecla(d: string) {
    if (enviando) return
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) enviar(next)
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#391511] text-white flex flex-col">
      {/* Barra superior */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-[#f9b44c] text-2xl font-extrabold">¡Hola!</span>
          <span className="text-[#f9d2a2] text-xs tracking-[0.2em] uppercase">Fichaje</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full',
              online ? 'bg-[#2f7d4f]/20 text-[#8fd9a8]' : 'bg-[#c43e2c]/20 text-[#f3a99c]'
            )}
          >
            {online ? <Cloud className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
            {online ? 'En línea' : 'Sin conexión'}
            {pendientes > 0 && (
              <span className="ml-1 bg-white/20 rounded-full px-1.5">{pendientes}</span>
            )}
            {sincronizando && <Loader2 className="h-3 w-3 animate-spin" />}
          </span>
          <Link
            href="/rrhh/asistencia"
            className="text-[#c8a58a] hover:text-white text-xs flex items-center gap-1"
          >
            <X className="h-4 w-4" /> Salir
          </Link>
        </div>
      </div>

      {/* Contenido */}
      <div className="flex-1 overflow-y-auto p-6">
        {paso === 'empleados' && (
          <div className="max-w-4xl mx-auto">
            <h1 className="text-center text-2xl font-bold mb-6">Tocá tu nombre para fichar</h1>
            {empleados.length === 0 ? (
              <p className="text-center text-[#c8a58a]">Cargando empleados…</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {empleados.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => elegir(e)}
                    className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/5 hover:bg-[#f9b44c]/20 border border-white/10 transition-colors"
                  >
                    <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#f9b44c]/20 text-[#f9d2a2] text-xl font-bold overflow-hidden">
                      {e.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={e.foto_url} alt={nombreCompleto(e)} className="h-full w-full object-cover" />
                      ) : (
                        iniciales(e)
                      )}
                    </span>
                    <span className="text-sm font-semibold text-center leading-tight">
                      {nombreCompleto(e)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {paso === 'pin' && sel && (
          <div className="max-w-xs mx-auto text-center">
            <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-[#f9b44c]/20 text-[#f9d2a2] text-2xl font-bold overflow-hidden mb-3">
              {sel.foto_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sel.foto_url} alt={nombreCompleto(sel)} className="h-full w-full object-cover" />
              ) : (
                iniciales(sel)
              )}
            </span>
            <h2 className="text-xl font-bold">{nombreCompleto(sel)}</h2>
            <p className="text-[#c8a58a] text-sm mb-4">Ingresá tu PIN de 4 dígitos</p>

            <div className="flex justify-center gap-3 mb-5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={cn(
                    'h-4 w-4 rounded-full border-2',
                    i < pin.length ? 'bg-[#f9b44c] border-[#f9b44c]' : 'border-white/30'
                  )}
                />
              ))}
            </div>

            {error && <p className="text-[#f3a99c] text-sm mb-3">{error}</p>}
            {enviando && (
              <p className="text-[#f9d2a2] text-sm mb-3 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Registrando…
              </p>
            )}

            <div className="grid grid-cols-3 gap-2.5">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  onClick={() => tecla(d)}
                  disabled={enviando}
                  className="h-16 rounded-2xl bg-white/10 hover:bg-white/20 text-2xl font-bold disabled:opacity-50"
                >
                  {d}
                </button>
              ))}
              <button
                onClick={reiniciar}
                className="h-16 rounded-2xl bg-white/5 hover:bg-white/10 text-sm font-medium text-[#c8a58a]"
              >
                Cancelar
              </button>
              <button
                onClick={() => tecla('0')}
                disabled={enviando}
                className="h-16 rounded-2xl bg-white/10 hover:bg-white/20 text-2xl font-bold disabled:opacity-50"
              >
                0
              </button>
              <button
                onClick={() => setPin((p) => p.slice(0, -1))}
                disabled={enviando}
                className="h-16 rounded-2xl bg-white/5 hover:bg-white/10 flex items-center justify-center disabled:opacity-50"
                aria-label="Borrar"
              >
                <Delete className="h-6 w-6" />
              </button>
            </div>
          </div>
        )}

        {paso === 'resultado' && resultado && (
          <button onClick={reiniciar} className="w-full h-full flex flex-col items-center justify-center gap-4">
            <div className="inline-flex p-4 rounded-full bg-[#2f7d4f]/20">
              <CheckCircle2 className="h-16 w-16 text-[#8fd9a8]" />
            </div>
            <span className="inline-flex h-24 w-24 items-center justify-center rounded-full bg-[#f9b44c]/20 text-[#f9d2a2] text-3xl font-bold overflow-hidden">
              {resultado.foto_url ?? sel?.foto_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={(resultado.foto_url ?? sel?.foto_url) as string}
                  alt={resultado.nombre}
                  className="h-full w-full object-cover"
                />
              ) : (
                iniciales({ nombre: resultado.nombre, apellido: resultado.apellido })
              )}
            </span>
            <div className="text-center">
              <p className="text-2xl font-bold">
                {[resultado.nombre, resultado.apellido].filter(Boolean).join(' ')}
              </p>
              <p className="text-[#f9d2a2] text-lg mt-1">
                {resultado.pendiente
                  ? 'Fichaje guardado (se sincroniza al volver internet)'
                  : `${resultado.tipo === 'salida' ? 'Salida' : 'Entrada'} registrada · ${horaAr(
                      resultado.momento ?? new Date().toISOString()
                    )}`}
              </p>
            </div>
            <p className="text-[#c8a58a] text-sm">Tocá para volver</p>
          </button>
        )}
      </div>
    </div>
  )
}
