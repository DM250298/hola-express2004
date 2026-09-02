/**
 * Fechas de vencimiento tipeadas con el teclado numérico.
 *
 * El `<input type="date">` nativo abre el calendario del sistema: en Android son
 * 4 o 5 toques por producto, y en una descarga de 30 renglones eso es la mayor
 * parte del tiempo de la recepción. Acá la fecha se ESCRIBE: se tipean 6 dígitos
 * (`150327`) y quedan formateados como `15/03/27`, sin abrir nada.
 *
 * Se aceptan los tres largos que aparecen impresos en los envases argentinos:
 *
 *   4 dígitos  MM/AA      `0327`     → 31/03/2027 (último día del mes)
 *   6 dígitos  DD/MM/AA   `150327`   → 15/03/2027
 *   8 dígitos  DD/MM/AAAA `15032027` → 15/03/2027
 *
 * El caso de 4 dígitos es la convención de lácteos y enlatados: el envase dice
 * solo mes y año, y el producto se considera bueno hasta el final de ese mes.
 *
 * ⚠️ Nada acá construye fechas con `new Date('yyyy-MM-dd')`: ese formato se
 * parsea en UTC y en Argentina (UTC−3) devuelve el día ANTERIOR. Se arma siempre
 * con `new Date(anio, mes - 1, dia)`, que es hora local, y se serializa a mano.
 */

/** `Date` local → `yyyy-MM-dd` (sin pasar por UTC). */
function aIsoLocal(f: Date): string {
  const mes = String(f.getMonth() + 1).padStart(2, '0')
  const dia = String(f.getDate()).padStart(2, '0')
  return `${f.getFullYear()}-${mes}-${dia}`
}

/**
 * Formatea lo que se va tipeando a `DD/MM/AA`, insertando las barras solas.
 * Ignora todo lo que no sea dígito y corta en 8 (DD/MM/AAAA).
 */
export function formatearTipeo(crudo: string): string {
  const d = crudo.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 2) return d
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
}

/**
 * Interpreta lo tipeado como fecha de vencimiento y devuelve `yyyy-MM-dd`.
 * Devuelve `null` si el largo no es 4, 6 u 8 dígitos, o si la fecha no existe
 * (31 de febrero, mes 13, 29/02 de un año no bisiesto).
 *
 * El año de 2 dígitos siempre se lee como 20AA: nadie recibe mercadería que
 * venció en 1927.
 */
export function parsearFechaCorta(crudo: string): string | null {
  const d = crudo.replace(/\D/g, '')

  let dia: number
  let mes: number
  let anio: number

  if (d.length === 4) {
    // MM/AA → el último día de ese mes.
    mes = Number(d.slice(0, 2))
    anio = 2000 + Number(d.slice(2, 4))
    if (mes < 1 || mes > 12) return null
    // Día 0 del mes SIGUIENTE (mes ya es 1-based) = último día de `mes`.
    return aIsoLocal(new Date(anio, mes, 0))
  }

  if (d.length === 6) {
    dia = Number(d.slice(0, 2))
    mes = Number(d.slice(2, 4))
    anio = 2000 + Number(d.slice(4, 6))
  } else if (d.length === 8) {
    dia = Number(d.slice(0, 2))
    mes = Number(d.slice(2, 4))
    anio = Number(d.slice(4, 8))
  } else {
    return null
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null

  const f = new Date(anio, mes - 1, dia)
  // Si la fecha no existía, el Date "desborda" al mes siguiente (31/02 → 03/03).
  if (f.getFullYear() !== anio || f.getMonth() !== mes - 1 || f.getDate() !== dia) {
    return null
  }
  return aIsoLocal(f)
}

/** `yyyy-MM-dd` → `DD/MM/AA`, para mostrar dentro del input. */
export function aTipeo(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1].slice(2)}`
}

/** `yyyy-MM-dd` → `Date` a las 00:00 LOCAL (nunca UTC). */
export function fechaLocalDesdeIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * Días entre hoy y la fecha (negativo = ya vencido). Compara a las 00:00 locales
 * de los dos lados, así que un producto que vence hoy da 0 y no −1.
 */
export function diasHasta(iso: string, desde: Date = new Date()): number | null {
  const venc = fechaLocalDesdeIso(iso)
  if (!venc) return null
  const hoy = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate())
  return Math.round((venc.getTime() - hoy.getTime()) / 86_400_000)
}

/**
 * Texto corto para mostrar debajo del input: confirma en palabras lo que se
 * acaba de tipear, que es la única forma de que alguien note que puso 2026 en
 * vez de 2027.
 */
export function describirVencimiento(iso: string, desde: Date = new Date()): string {
  const dias = diasHasta(iso, desde)
  if (dias == null) return ''
  if (dias < 0) return `Vencido hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`
  if (dias === 0) return 'Vence hoy'
  if (dias === 1) return 'Vence mañana'
  if (dias < 45) return `Vence en ${dias} días`
  const meses = Math.round(dias / 30)
  if (meses < 24) return `Vence en ${meses} meses`
  return `Vence en ${Math.floor(meses / 12)} años`
}
