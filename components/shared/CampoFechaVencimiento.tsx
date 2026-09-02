'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  aTipeo,
  describirVencimiento,
  diasHasta,
  formatearTipeo,
  parsearFechaCorta,
} from '@/lib/utils/fechaCorta'
import { hoyIso, isoMasMeses } from '@/lib/utils/periodos'
import { cn } from '@/lib/utils'

interface Props {
  /** Fecha en `yyyy-MM-dd`, o `''` si todavía no hay. */
  value: string
  /** Se dispara con una fecha completa y válida, o con `''` al vaciarse. */
  onChange: (iso: string) => void
  /**
   * Fecha del renglón anterior de la misma factura. Habilita el atajo más
   * usado: media docena de renglones del mismo lote traen la misma fecha.
   */
  fechaAnterior?: string | null
  /** `productos.dias_vencimiento_minimo`: avisa si la fecha queda corta. */
  diasMinimo?: number | null
  /** Oculta la fila de atajos (formularios de escritorio, donde no hace falta). */
  sinAtajos?: boolean
  id?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}

const ATAJOS_RELATIVOS = [
  { etiqueta: '+3 meses', meses: 3 },
  { etiqueta: '+6 meses', meses: 6 },
  { etiqueta: '+1 año', meses: 12 },
]

/**
 * Fecha de vencimiento que se ESCRIBE en vez de elegirse en un calendario.
 *
 * El `<input type="date">` nativo abre el picker del sistema: en Android son 4
 * o 5 toques por producto, y en una descarga de 30 renglones es la mayor parte
 * del tiempo de la recepción. Acá se tipean los dígitos que están impresos en
 * el envase (`150327`) con el teclado numérico y la fecha queda cargada.
 * Se aceptan `MM/AA` (4 dígitos, cae a fin de mes), `DD/MM/AA` y `DD/MM/AAAA`.
 *
 * El calendario nativo sigue disponible en el botón de la derecha, para quien
 * lo prefiera.
 *
 * El componente maneja su propio texto y le avisa al padre SOLO cuando la fecha
 * está completa: así se puede tipear "1" sin que el padre resetee el input. La
 * contra es que una fecha a medio tipear no se persiste en el borrador — son
 * seis dígitos, el riesgo real es nulo.
 */
export function CampoFechaVencimiento({
  value,
  onChange,
  fechaAnterior,
  diasMinimo,
  sinAtajos,
  id,
  disabled,
  autoFocus,
  className,
}: Props) {
  const [texto, setTexto] = useState(() => (value ? aTipeo(value) : ''))
  const nativoRef = useRef<HTMLInputElement | null>(null)

  // Resincroniza cuando el valor cambia desde afuera (cambio de pestaña de
  // factura, atajo, calendario nativo). El guard evita pisar lo que se está
  // tipeando: si el texto actual ya representa ese ISO, no se toca.
  useEffect(() => {
    if (parsearFechaCorta(texto) === (value || null)) return
    setTexto(value ? aTipeo(value) : '')
    // `texto` a propósito fuera de las deps: si entrara, cada tecla recalcularía
    // y el input pelearía contra sí mismo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const iso = parsearFechaCorta(texto)
  const digitos = texto.replace(/\D/g, '').length
  // "A medias" no es error: mientras se tipea no se le grita al usuario.
  const invalida = iso == null && digitos > 0 && [4, 6, 8].includes(digitos)
  const finDeMes = iso != null && digitos === 4

  const dias = iso ? diasHasta(iso) : null
  const corta = iso != null && diasMinimo != null && dias != null && dias < diasMinimo
  const vencida = dias != null && dias < 0
  const tono = invalida || vencida || corta ? 'malo' : dias != null && dias <= 30 ? 'aviso' : 'ok'

  function aplicarTexto(crudo: string) {
    const formateado = formatearTipeo(crudo)
    setTexto(formateado)
    const nuevo = parsearFechaCorta(formateado)
    // Vaciar el campo limpia la fecha; una fecha a medias no toca al padre.
    if (formateado === '') onChange('')
    else if (nuevo) onChange(nuevo)
  }

  function aplicarIso(nuevo: string) {
    setTexto(aTipeo(nuevo))
    onChange(nuevo)
  }

  function abrirCalendario() {
    const el = nativoRef.current
    if (!el) return
    try {
      // Necesita gesto de usuario (lo es, venimos de un click) y en algunos
      // navegadores tira NotAllowedError igual → queda el click de respaldo.
      el.showPicker()
    } catch {
      el.click()
    }
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="relative flex gap-1.5">
        <Input
          id={id}
          value={texto}
          onChange={(e) => aplicarTexto(e.target.value)}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode="numeric"
          autoComplete="off"
          maxLength={10}
          placeholder="DD/MM/AA"
          aria-label="Fecha de vencimiento"
          aria-invalid={invalida || undefined}
          className={cn(
            'h-12 flex-1 tabular-nums focus-visible:ring-[#f9b44c]',
            invalida ? 'border-[#c43e2c]' : 'border-[#e4c9b0]'
          )}
        />
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={abrirCalendario}
            disabled={disabled}
            aria-label="Elegir en el calendario"
            className="flex h-12 w-11 items-center justify-center rounded-md border border-[#e4c9b0] bg-[#fdfaf6] text-[#9e6b15] active:scale-95 disabled:opacity-40"
          >
            <CalendarDays className="h-4 w-4" />
          </button>
          {/* El input nativo NO puede ir con display:none: varios navegadores se
              niegan a abrir el picker de un input que no está renderizado. Va
              superpuesto, invisible y sin capturar toques. */}
          <input
            ref={nativoRef}
            type="date"
            value={value}
            onChange={(e) => aplicarIso(e.target.value)}
            disabled={disabled}
            tabIndex={-1}
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </div>
      </div>

      {(invalida || iso) && (
        <p
          className={cn(
            'flex items-center gap-1 text-[11px] leading-snug',
            tono === 'malo'
              ? 'font-semibold text-[#c43e2c]'
              : tono === 'aviso'
                ? 'text-[#9e6b15]'
                : 'text-[#6f3a2a]'
          )}
        >
          {tono === 'malo' && <AlertTriangle className="h-3 w-3 shrink-0" />}
          {invalida ? (
            'Esa fecha no existe — poné DD/MM/AA o MM/AA'
          ) : (
            <>
              {describirVencimiento(iso as string)}
              {finDeMes && <span className="opacity-70">· fin de mes</span>}
              {corta && <span>· menos de los {diasMinimo} días mínimos</span>}
            </>
          )}
        </p>
      )}

      {!sinAtajos && !disabled && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {fechaAnterior && (
            <ChipAtajo
              destacado
              onClick={() => aplicarIso(fechaAnterior)}
              etiqueta={`Igual: ${aTipeo(fechaAnterior)}`}
            />
          )}
          {ATAJOS_RELATIVOS.map((a) => (
            <ChipAtajo
              key={a.meses}
              etiqueta={a.etiqueta}
              onClick={() => aplicarIso(isoMasMeses(hoyIso(), a.meses))}
            />
          ))}
          {texto !== '' && (
            <ChipAtajo etiqueta="Borrar" onClick={() => aplicarTexto('')} />
          )}
        </div>
      )}
    </div>
  )
}

function ChipAtajo({
  etiqueta,
  onClick,
  destacado,
}: {
  etiqueta: string
  onClick: () => void
  destacado?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-9 shrink-0 rounded-lg border px-2.5 text-xs font-semibold tabular-nums transition active:scale-95',
        destacado
          ? 'border-[#e4a42a] bg-[#f9b44c]/25 text-[#391511]'
          : 'border-[#e4c9b0] bg-white text-[#6f3a2a]'
      )}
    >
      {etiqueta}
    </button>
  )
}
