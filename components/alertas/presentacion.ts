import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import type { Alerta, ParametrosRegla, SeveridadAlerta } from '@/lib/queries/alertas'
import {
  formatearCantidad,
  formatearFechaCortaISO,
  formatearMontoEntero,
  formatearNumero,
} from '@/lib/utils/formato'

/**
 * Cómo se presenta cada regla (los códigos son los de la mig 183). Si se
 * agrega una regla en SQL, sumarla acá: acción, sugerencia y parámetros.
 */

export const COLOR_SEVERIDAD: Record<
  SeveridadAlerta,
  { punto: string; texto: string; fondo: string; borde: string }
> = {
  critico: {
    punto: 'bg-[#c43e2c]',
    texto: 'text-[#9e2f25]',
    fondo: 'bg-[#c43e2c]/[0.06]',
    borde: 'border-[#c43e2c]/30',
  },
  atencion: {
    punto: 'bg-[#e4a42a]',
    texto: 'text-[#a06b00]',
    fondo: 'bg-[#f9b44c]/10',
    borde: 'border-[#e4a42a]/40',
  },
  oportunidad: {
    punto: 'bg-[#1e5fb0]',
    texto: 'text-[#1e5fb0]',
    fondo: 'bg-[#1e5fb0]/[0.04]',
    borde: 'border-[#1e5fb0]/25',
  },
  informativo: {
    punto: 'bg-[#c8a58a]',
    texto: 'text-[#6f3a2a]',
    fondo: 'bg-[#fdfaf6]',
    borde: 'border-[#e4c9b0]/60',
  },
}

export interface AccionRegla {
  /** Texto del link al lugar donde se actúa. */
  etiqueta: string
  href: string
  /** Arranque del título sugerido para la tarea. */
  verbo: string
}

export const ACCION_REGLA: Record<string, AccionRegla> = {
  quiebre_clave: { etiqueta: 'Ir a compras', href: '/compras', verbo: 'Reponer' },
  stock_desfasado: {
    etiqueta: 'Ir a control de stock',
    href: '/inventario/control',
    verbo: 'Contar y ajustar',
  },
  lote_vencido: {
    etiqueta: 'Ir a vencimientos',
    href: '/vencimientos',
    verbo: 'Dar de baja',
  },
  marca_ajena: { etiqueta: 'Ir al mapa', href: '/mapa', verbo: 'Sacar de la heladera de marca' },
  fuera_de_lugar: { etiqueta: 'Ir al mapa', href: '/mapa', verbo: 'Reubicar' },
  por_quebrar: { etiqueta: 'Ir a compras', href: '/compras', verbo: 'Pedir' },
  vencimiento_proximo: {
    etiqueta: 'Ir a vencimientos',
    href: '/vencimientos',
    verbo: 'Resolver vencimientos de',
  },
  margen_bajo: {
    etiqueta: 'Revisar precios',
    href: '/configuracion/productos',
    verbo: 'Revisar precio o costo de',
  },
  inmovilizado: {
    etiqueta: 'Ver en análisis',
    href: '/inventario?tab=analisis&vista=sin_venta&orden=sin_venta',
    verbo: 'Mover',
  },
  sobrestock: {
    etiqueta: 'Ver en análisis',
    href: '/inventario?tab=analisis&orden=cobertura',
    verbo: 'Frenar compras de',
  },
  sin_costo: {
    etiqueta: 'Cargar costos',
    href: '/configuracion/productos',
    verbo: 'Cargar el costo de',
  },
  sin_categoria: {
    etiqueta: 'Categorizar',
    href: '/configuracion/productos',
    verbo: 'Categorizar',
  },
  sin_ubicacion: { etiqueta: 'Ir al mapa', href: '/mapa', verbo: 'Ubicar en góndola' },
}

/** HEX sugiere: qué haría con esta situación (la persona decide). */
export const SUGERENCIA_REGLA: Record<string, string> = {
  quiebre_clave:
    'Pedir al proveedor o traer del depósito. Si el proveedor no entrega, buscar una alternativa.',
  stock_desfasado:
    'Contar el producto y ajustar el stock: el sistema dice cero o negativo, pero se sigue vendiendo.',
  lote_vencido: 'Retirarlos de la góndola y darlos de baja como merma.',
  marca_ajena:
    'Pasarlos a otra heladera: la marca exige exclusividad en su equipo y puede quitar bonificaciones.',
  fuera_de_lugar:
    'Llevarlos a su espacio o, si están bien ahí, corregir la categoría del espacio en el mapa.',
  por_quebrar: 'Sumarlos al próximo pedido antes de que se terminen.',
  vencimiento_proximo:
    'Pasarlos adelante en la góndola o hacer una promo; si ya vencieron, darlos de baja.',
  margen_bajo:
    'Revisar el precio de venta o el costo cargado (a veces es un costo mal cargado).',
  inmovilizado:
    'Mejorar la exhibición, hacer una promo o no volver a comprar hasta que roten.',
  sobrestock: 'No volver a pedir hasta que el stock baje a la cobertura normal.',
  sin_costo: 'Cargar el costo en la ficha del producto o con la próxima factura.',
  sin_categoria: 'Asignarles la categoría en la ficha del producto.',
  sin_ubicacion: 'Asignarles una góndola desde el mapa o escaneando desde el celular.',
}

export function hace(iso: string): string {
  return formatDistanceToNow(new Date(iso), { locale: es, addSuffix: true })
}

export function conCantidad(n: number, uno: string, varios: string): string {
  return `${formatearNumero(n)} ${n === 1 ? uno : varios}`
}

const formatoUnDecimal = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

/** La línea de datos debajo del nombre: por qué HEX la levantó. */
export function describirAlerta(a: Alerta): string {
  const d = a.detalle
  const porPeso = d.venta_por_peso ?? false
  const cant = (n: number) => formatearCantidad(n, porPeso)
  const partes: string[] = []

  switch (a.regla_codigo) {
    case 'quiebre_clave':
      partes.push(d.sin_stock_desde ? `sin stock ${hace(d.sin_stock_desde)}` : 'sin stock')
      if (d.venta_diaria) partes.push(`vendía ${cant(d.venta_diaria)} por día`)
      if (d.es_critico) partes.push('marcado como crítico')
      else if (d.clase_abc) partes.push(`clase ${d.clase_abc}`)
      if (d.proveedor) partes.push(d.proveedor)
      break
    case 'stock_desfasado':
      partes.push(
        d.stock != null && d.stock < 0
          ? `stock negativo: ${cant(d.stock)}`
          : 'el sistema dice cero'
      )
      if (d.ultima_venta) partes.push(`se vendió ${hace(d.ultima_venta)}`)
      if (d.venta_diaria) partes.push(`vende ${cant(d.venta_diaria)} por día`)
      if (d.clase_abc) partes.push(`clase ${d.clase_abc}`)
      break
    case 'por_quebrar':
      if (d.stock != null) partes.push(`quedan ${cant(d.stock)}`)
      if (d.dias_cobertura != null)
        partes.push(`alcanza para ${formatoUnDecimal.format(d.dias_cobertura)} días`)
      if (d.proveedor) partes.push(d.proveedor)
      break
    case 'marca_ajena':
      if (d.ubicacion) partes.push(`en ${d.ubicacion}`)
      if (d.marca_espacio) partes.push(`heladera de ${d.marca_espacio}`)
      if (d.marca_producto) partes.push(`producto de ${d.marca_producto}`)
      break
    case 'fuera_de_lugar':
      if (d.ubicacion) partes.push(`en ${d.ubicacion}`)
      if (d.categoria_espacio) partes.push(`ahí va ${d.categoria_espacio}`)
      if (d.categoria_producto) partes.push(`es de ${d.categoria_producto}`)
      break
    case 'lote_vencido':
    case 'vencimiento_proximo': {
      const dias = d.dias_para_vencer ?? 0
      if (dias < 0) partes.push(`venció hace ${conCantidad(-dias, 'día', 'días')}`)
      else if (dias === 0) partes.push('vence hoy')
      else partes.push(`vence en ${conCantidad(dias, 'día', 'días')}`)
      if (d.fecha_vencimiento) partes.push(formatearFechaCortaISO(d.fecha_vencimiento))
      if (d.cantidad != null) partes.push(`${cant(d.cantidad)} en el lote`)
      if (d.valor) partes.push(`${formatearMontoEntero(d.valor)} a costo`)
      break
    }
    case 'margen_bajo':
      if (d.precio_venta != null) partes.push(`precio ${formatearMontoEntero(d.precio_venta)}`)
      if (d.costo_actual != null) partes.push(`costo ${formatearMontoEntero(d.costo_actual)}`)
      if (d.margen_pct != null) partes.push(`margen ${formatoUnDecimal.format(d.margen_pct)}%`)
      if (d.unidades_30d) partes.push(`${cant(d.unidades_30d)} vendidos en 30 días`)
      break
    case 'inmovilizado':
      if (d.stock != null) partes.push(`${cant(d.stock)} en stock`)
      partes.push(
        d.dias_sin_venta != null
          ? `sin vender hace ${conCantidad(d.dias_sin_venta, 'día', 'días')}`
          : 'sin ventas registradas'
      )
      if (d.valor) partes.push(`${formatearMontoEntero(d.valor)} a costo`)
      break
    case 'sobrestock':
      if (d.stock != null) partes.push(`${cant(d.stock)} en stock`)
      if (d.dias_cobertura != null) partes.push(`cubre ${formatearNumero(d.dias_cobertura)} días`)
      if (d.exceso_valor) partes.push(`sobran ~${formatearMontoEntero(d.exceso_valor)} a costo`)
      break
    case 'sin_ubicacion':
      if (d.clase_abc) partes.push(`clase ${d.clase_abc}`)
      if (d.ingresos) partes.push(`vendió ${formatearMontoEntero(d.ingresos)} en 30 días`)
      break
    default:
      if (d.ingresos) partes.push(`vendió ${formatearMontoEntero(d.ingresos)} en 30 días`)
  }
  return partes.join(' · ')
}

/** Título sugerido para una tarea sobre estas alertas (editable). */
export function tituloTareaSugerido(alertas: Alerta[]): string {
  if (alertas.length === 0) return ''
  const reglas = new Set(alertas.map((a) => a.regla_codigo))
  const grupos = new Set(alertas.map((a) => a.grupo ?? ''))
  if (alertas.length === 1) {
    const a = alertas[0]
    return `${ACCION_REGLA[a.regla_codigo]?.verbo ?? 'Revisar'} ${a.titulo}`
  }
  if (reglas.size > 1) return `Resolver ${alertas.length} alertas`
  const codigo = alertas[0].regla_codigo
  const cosa =
    codigo === 'vencimiento_proximo' || codigo === 'lote_vencido'
      ? conCantidad(alertas.length, 'lote', 'lotes')
      : conCantidad(alertas.length, 'producto', 'productos')
  const enGrupo = grupos.size === 1 && alertas[0].grupo ? ` (${alertas[0].grupo})` : ''
  return `${ACCION_REGLA[codigo]?.verbo ?? 'Revisar'} ${cosa}${enGrupo}`
}

/** Descripción sugerida: la sugerencia de HEX + el detalle de cada ítem. */
export function descripcionTareaSugerida(alertas: Alerta[]): string {
  const MAXIMO = 40
  const lineas: string[] = []
  const porRegla = new Map<string, Alerta[]>()
  for (const a of alertas) {
    const lista = porRegla.get(a.regla_codigo)
    if (lista) lista.push(a)
    else porRegla.set(a.regla_codigo, [a])
  }
  let escritas = 0
  for (const [codigo, lista] of porRegla) {
    lineas.push(`${lista[0].regla_nombre}. Sugerencia: ${SUGERENCIA_REGLA[codigo] ?? ''}`.trim())
    for (const a of lista) {
      if (escritas >= MAXIMO) break
      const detalle = describirAlerta(a)
      lineas.push(`• ${a.titulo}${detalle ? ` — ${detalle}` : ''}`)
      escritas++
    }
    lineas.push('')
  }
  if (alertas.length > MAXIMO) lineas.push(`…y ${alertas.length - MAXIMO} más (ver en Alertas).`)
  lineas.push('Creada desde Alertas de HEX: se resuelve sola cuando el problema desaparece.')
  return lineas.join('\n')
}

export interface CampoParametro {
  clave: keyof ParametrosRegla
  etiqueta: string
  tipo: 'numero' | 'clases' | 'booleano'
  sufijo?: string
}

/** Parámetros editables por regla (las mismas claves que siembra la mig 183). */
export const CAMPOS_REGLA: Record<string, CampoParametro[]> = {
  quiebre_clave: [
    { clave: 'clases', etiqueta: 'Clases ABC que cuentan como clave', tipo: 'clases' },
    { clave: 'incluir_criticos', etiqueta: 'Incluir los marcados como críticos', tipo: 'booleano' },
  ],
  por_quebrar: [
    {
      clave: 'dias_cobertura',
      etiqueta: 'Avisar si el stock alcanza para menos de',
      tipo: 'numero',
      sufijo: 'días',
    },
    { clave: 'clases', etiqueta: 'Solo clases ABC', tipo: 'clases' },
  ],
  stock_desfasado: [
    {
      clave: 'dias_venta_reciente',
      etiqueta: 'Se considera que sigue vendiéndose si vendió en los últimos',
      tipo: 'numero',
      sufijo: 'días',
    },
    { clave: 'clases', etiqueta: 'Solo clases ABC', tipo: 'clases' },
    {
      clave: 'solo_con_ventas',
      etiqueta: 'Solo los que vendieron en 30 días',
      tipo: 'booleano',
    },
  ],
  vencimiento_proximo: [
    { clave: 'dias', etiqueta: 'Avisar con', tipo: 'numero', sufijo: 'días de anticipación' },
  ],
  lote_vencido: [],
  marca_ajena: [],
  fuera_de_lugar: [],
  margen_bajo: [
    {
      clave: 'margen_minimo_pct',
      etiqueta: 'Margen mínimo sobre el precio',
      tipo: 'numero',
      sufijo: '%',
    },
  ],
  inmovilizado: [
    { clave: 'dias_sin_venta', etiqueta: 'Sin vender hace más de', tipo: 'numero', sufijo: 'días' },
    {
      clave: 'valor_minimo',
      etiqueta: 'Solo si el stock a costo supera',
      tipo: 'numero',
      sufijo: 'pesos',
    },
  ],
  sobrestock: [
    { clave: 'dias_cobertura', etiqueta: 'Stock que cubre más de', tipo: 'numero', sufijo: 'días' },
    {
      clave: 'valor_minimo',
      etiqueta: 'Solo si el stock a costo supera',
      tipo: 'numero',
      sufijo: 'pesos',
    },
  ],
  sin_costo: [],
  sin_categoria: [],
  sin_ubicacion: [{ clave: 'clases', etiqueta: 'Clases ABC', tipo: 'clases' }],
}
