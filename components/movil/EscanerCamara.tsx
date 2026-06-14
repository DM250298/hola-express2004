'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraOff, Keyboard, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Props {
  /** Se llama con el código leído por la cámara o tipeado a mano. */
  onDetectado: (codigo: string) => void
  /** Texto de ayuda que se muestra bajo el visor cuando la cámara está activa. */
  ayuda?: string
  className?: string
}

// Formatos típicos de góndola (EAN/UPC) + algunos de respaldo. Se filtran
// contra los que el dispositivo realmente soporta antes de crear el detector.
const FORMATOS_DESEADOS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
  'codabar',
]

/** Evita registrar el mismo código repetidas veces mientras sigue en cámara. */
const REINTENTO_MISMO_MS = 1200

type Estado = 'iniciando' | 'activo' | 'sin-soporte' | 'sin-permiso' | 'error'

/**
 * Escáner de código de barras por cámara. Usa la API nativa `BarcodeDetector`
 * (Android/Chrome). Si no está disponible o se niega el permiso, queda la
 * carga manual (que también sirve para un lector USB/Bluetooth).
 */
export function EscanerCamara({ onDetectado, ayuda, className }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<BarcodeDetector | null>(null)
  const rafRef = useRef<number | null>(null)
  const corriendoRef = useRef(false)
  const ultimoRef = useRef<{ codigo: string; t: number }>({ codigo: '', t: 0 })
  const audioRef = useRef<AudioContext | null>(null)
  // `onDetectado` puede cambiar de identidad entre renders; lo leemos por ref
  // para no reiniciar la cámara ni el bucle de detección.
  const cbRef = useRef(onDetectado)
  cbRef.current = onDetectado

  const [estado, setEstado] = useState<Estado>('iniciando')
  const [manual, setManual] = useState('')

  const beep = useCallback(() => {
    try {
      if (!audioRef.current) {
        const Ctx = window.AudioContext
        if (!Ctx) return
        audioRef.current = new Ctx()
      }
      const ctx = audioRef.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = 880
      gain.gain.value = 0.06
      osc.connect(gain).connect(ctx.destination)
      const ahora = ctx.currentTime
      osc.start(ahora)
      osc.stop(ahora + 0.08)
    } catch {
      // sin audio disponible — se ignora
    }
    try {
      navigator.vibrate?.(60)
    } catch {
      // sin soporte de vibración — se ignora
    }
  }, [])

  const emitir = useCallback(
    (codigo: string) => {
      const cod = codigo.trim()
      if (!cod) return
      const ahora = Date.now()
      if (
        cod === ultimoRef.current.codigo &&
        ahora - ultimoRef.current.t < REINTENTO_MISMO_MS
      ) {
        return
      }
      ultimoRef.current = { codigo: cod, t: ahora }
      beep()
      cbRef.current(cod)
    },
    [beep]
  )

  useEffect(() => {
    let cancelado = false

    async function bucle() {
      if (!corriendoRef.current) return
      const video = videoRef.current
      const detector = detectorRef.current
      if (video && detector && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video)
          if (codes.length > 0) emitir(codes[0].rawValue)
        } catch {
          // frame ilegible — se ignora y se reintenta en el próximo cuadro
        }
      }
      rafRef.current = requestAnimationFrame(() => {
        void bucle()
      })
    }

    async function iniciar() {
      const Detector =
        typeof window !== 'undefined' ? window.BarcodeDetector : undefined
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setEstado('sin-soporte')
        return
      }
      try {
        const soportados = await Detector.getSupportedFormats()
        const formats = FORMATOS_DESEADOS.filter((f) => soportados.includes(f))
        detectorRef.current = new Detector(
          formats.length ? { formats } : undefined
        )
      } catch {
        setEstado('sin-soporte')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        setEstado('activo')
        corriendoRef.current = true
        void bucle()
      } catch (e) {
        if ((e as Error).name === 'NotAllowedError') setEstado('sin-permiso')
        else setEstado('error')
      }
    }

    void iniciar()

    return () => {
      cancelado = true
      corriendoRef.current = false
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [emitir])

  function enviarManual() {
    const cod = manual.trim()
    if (!cod) return
    setManual('')
    // La carga manual no pasa por el dedupe de cámara (es intencional cada vez).
    beep()
    cbRef.current(cod)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="h-full w-full object-cover"
        />
        {estado === 'activo' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-24 w-4/5 rounded-xl border-2 border-[#f9b44c] shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]" />
          </div>
        )}
        {estado !== 'activo' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center text-white/90">
            {estado === 'iniciando' && (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Abriendo la cámara…</span>
              </>
            )}
            {estado === 'sin-permiso' && (
              <>
                <CameraOff className="h-6 w-6" />
                <span className="text-sm">
                  No diste permiso a la cámara. Activala en el navegador o cargá
                  el código a mano abajo.
                </span>
              </>
            )}
            {estado === 'sin-soporte' && (
              <>
                <CameraOff className="h-6 w-6" />
                <span className="text-sm">
                  Este dispositivo no soporta el escáner por cámara. Usá un
                  lector o cargá el código a mano.
                </span>
              </>
            )}
            {estado === 'error' && (
              <>
                <CameraOff className="h-6 w-6" />
                <span className="text-sm">
                  No se pudo abrir la cámara. Cargá el código a mano.
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {ayuda && estado === 'activo' && (
        <p className="text-center text-xs text-[#6f3a2a]">{ayuda}</p>
      )}

      {/* Respaldo: carga manual o lector USB/Bluetooth (siempre disponible). */}
      <div className="flex gap-2">
        <Input
          inputMode="numeric"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              enviarManual()
            }
          }}
          placeholder="Código de barras a mano…"
          className="h-11 border-[#e4c9b0] bg-white font-mono focus-visible:ring-[#f9b44c]"
        />
        <Button
          type="button"
          onClick={enviarManual}
          disabled={!manual.trim()}
          className="h-11 shrink-0 bg-[#391511] text-white hover:bg-[#4a1d17]"
        >
          <Keyboard className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
