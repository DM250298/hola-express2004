import type { CargaRenglon, FacturaEntrega } from '@/lib/recepcion/borrador'

/**
 * Un renglón de la orden, tal como viene de la base.
 *
 * Es SOLO lectura: lo que el empleado carga (cantidad, fecha) no vive acá sino
 * en `facturas[i].cargas`, que es la única fuente de verdad de lo tipeado. Antes
 * la factura activa vivía en los inputs de la lista y las otras en `cargas`, y
 * había que sincronizarlas a mano en cada cambio de pestaña; con la carga en una
 * hoja modal ese doble estado desapareció.
 */
export interface ItemEstado {
  item_id: number
  producto_id: number
  nombre: string
  codigo_barras: string | null
  cantidad_pedida: number
  /** Lo ya recibido en entregas anteriores (acumulado en la base). */
  ya_recibido: number
  /** Costo de la línea. No se muestra (el mostrador no ve costos) pero viaja. */
  precio_costo: number
  /** Se recibe por peso: la cantidad es un decimal en kg, no unidades. */
  venta_por_peso: boolean
  dias_vencimiento_minimo: number | null
}

/** Datos mínimos de un producto para sumarlo a la recepción. */
export interface ProdParaAgregar {
  id: number
  nombre: string
  codigo_barras: string | null
  activo: boolean
  dias_vencimiento_minimo: number | null
  venta_por_peso: boolean
}

/** Reduce un producto del catálogo a lo que necesita la recepción. */
export function aProdParaAgregar(p: {
  id: number
  nombre: string
  codigo_barras: string | null
  activo: boolean
  dias_vencimiento_minimo: number | null
  venta_por_peso?: boolean
}): ProdParaAgregar {
  return {
    id: p.id,
    nombre: p.nombre,
    codigo_barras: p.codigo_barras,
    activo: p.activo,
    dias_vencimiento_minimo: p.dias_vencimiento_minimo,
    venta_por_peso: p.venta_por_peso ?? false,
  }
}

/** Cantidad cargada para un renglón en una factura (0 si no tiene carga). */
export function cantidadDe(f: FacturaEntrega, item_id: number): number {
  return Number(f.cargas[item_id]?.cantidad) || 0
}

/** Carga vacía, para abrir la hoja de un renglón que todavía no se tocó. */
export function cargaVacia(): CargaRenglon {
  return { cantidad: '', fecha_vencimiento: '' }
}

/**
 * Mete un renglón en el papel de la factura, al final. Si ya estaba, no lo
 * mueve: su lugar en la factura ya está definido y moverlo sería perder el
 * orden que el empleado ya controló.
 */
export function conRenglonEnFactura(
  f: FacturaEntrega,
  item_id: number
): FacturaEntrega {
  if (f.orden.includes(item_id)) return f
  return { ...f, orden: [...f.orden, item_id] }
}

/** Saca un renglón de la factura, con su carga. */
export function sinRenglonEnFactura(
  f: FacturaEntrega,
  item_id: number
): FacturaEntrega {
  const cargas = { ...f.cargas }
  delete cargas[item_id]
  return { ...f, cargas, orden: f.orden.filter((id) => id !== item_id) }
}

/**
 * Intercambia un renglón con su vecino en el papel. Un swap simple: como el
 * `orden` contiene exactamente los renglones de esta factura, no hay huecos que
 * saltear (que es lo que antes obligaba a recorrer buscando "el próximo
 * cargado" y hacía que un renglón sin cantidad no se pudiera mover).
 */
export function conRenglonMovido(
  f: FacturaEntrega,
  item_id: number,
  direccion: -1 | 1
): FacturaEntrega {
  const i = f.orden.indexOf(item_id)
  const j = i + direccion
  if (i < 0 || j < 0 || j >= f.orden.length) return f
  const orden = [...f.orden]
  ;[orden[i], orden[j]] = [orden[j], orden[i]]
  return { ...f, orden }
}

/**
 * Un problema detectado al revisar la entrega antes de grabarla. Las
 * `bloqueante` impiden confirmar; el resto solo avisa.
 */
export interface Advertencia {
  clave:
    | 'sin_numero'
    | 'numero_repetido'
    | 'sin_cantidad'
    | 'sin_fecha'
    | 'vencimiento_corto'
    | 'faltantes'
    | 'excesos'
  bloqueante: boolean
  texto: string
  /** Pestaña a la que saltar para resolverlo. */
  facturaIdx?: number
}
