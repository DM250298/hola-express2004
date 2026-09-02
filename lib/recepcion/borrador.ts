/**
 * Borrador de una recepción en curso.
 *
 * La recepción no toca la base hasta el Confirmar final (política de la empresa:
 * la orden se recibe COMPLETA o no se recibe), así que todo lo que el empleado
 * carga durante la descarga vive en el teléfono. Sin persistencia, un F5 o que
 * Android descarte la pestaña —muy probable, con la cámara abierta— borraba una
 * hora de trabajo. Acá está la forma serializada de ese estado y las reglas para
 * volver a cruzarlo contra la orden cuando se reabre la pantalla.
 *
 * Se guarda con `lib/utils/borradores.ts` (localStorage, expira a los 7 días).
 * Los tipos van versionados: ante un `v` distinto el borrador se descarta en vez
 * de intentar migrarlo, que para un formulario de un solo uso es más seguro.
 */

/** Lo cargado para un renglón dentro de UNA factura. */
export interface CargaRenglon {
  cantidad: string
  fecha_vencimiento: string
  /** El empleado marcó que este producto no lleva fecha (≠ todavía no la cargó). */
  sin_vencimiento?: boolean
}

/**
 * Una factura de la entrega. El `orden` es el orden del papel: define qué
 * renglones están en esta factura y en qué posición, independientemente de que
 * ya tengan cantidad. Es lo que después viaja como `items_pedido.orden_recepcion`
 * para que administración cargue los precios en el mismo orden que el papel.
 */
export interface FacturaEntrega {
  /** Key estable de la pestaña ('t1', 't2', …) — NO es el `factura_ref` final. */
  id: string
  numero: string
  cargas: Record<number, CargaRenglon>
  orden: number[]
}

export const BORRADOR_RECEPCION_V = 1

export interface BorradorRecepcion {
  v: number
  facturas: FacturaEntrega[]
  activaIdx: number
  proximaTab: number
  /**
   * Nombre de los renglones con cantidad, al momento de guardar. Solo sirve
   * para el banner: si un renglón desapareció de la orden hay que poder decir
   * CUÁL se perdió, y para eso ya no se lo puede buscar en el pedido.
   */
  nombres: Record<number, string>
  /**
   * Foto de `items_pedido.cantidad_recibida` al guardar. Si al restaurar no
   * coincide con la base, otra entrega tocó ese renglón mientras el borrador
   * dormía: lo tipeado se conserva (nunca se pisa el trabajo del empleado) pero
   * se avisa, porque confirmar a ciegas sumaría dos veces la misma mercadería.
   */
  yaRecibido: Record<number, number>
}

/**
 * Lo que NO se persiste, a propósito:
 *
 * - `excesoAutorizado` / `autorizadoPor`: es una autorización con clave de
 *   supervisor. Que sobreviva a un reload sería un agujero — el empleado
 *   recarga y el exceso queda autorizado sin que nadie lo vuelva a mirar.
 * - `aceptaPorDebajoMin`: el "acepto recibir igual" es un consentimiento
 *   explícito sobre mercadería que vence antes del mínimo. Volver a pedirlo
 *   cuesta un tap y es lo único que le da valor al control.
 * - Nombre, cantidad pedida, costo, por peso, vencimiento mínimo: son verdad
 *   del servidor. Restaurarlos del borrador es congelar un dato viejo; salen
 *   siempre de `pedido.items`.
 */

export interface ResultadoReconciliacion {
  borrador: BorradorRecepcion
  /** Renglones que estaban en el borrador y ya no están en la orden. */
  descartados: number[]
  /** Nombres de los descartados que TENÍAN cantidad cargada (para el banner). */
  nombresDescartados: string[]
  /** Renglones cuyo `ya_recibido` cambió en la base desde que se guardó. */
  recibidoCambio: number[]
}

export function claveBorradorRecepcion(pedidoId: number): string {
  return `recepcion-p${pedidoId}`
}

export function facturaVacia(id: string): FacturaEntrega {
  return { id, numero: '', cargas: {}, orden: [] }
}

export function borradorInicial(): BorradorRecepcion {
  return {
    v: BORRADOR_RECEPCION_V,
    facturas: [facturaVacia('t1')],
    activaIdx: 0,
    proximaTab: 2,
    nombres: {},
    yaRecibido: {},
  }
}

/** Un renglón tal como está HOY en la orden, para cruzar contra el borrador. */
export interface RenglonVivo {
  item_id: number
  ya_recibido: number
}

/** Total de unidades cargadas en una factura. */
export function unidadesDeCargas(cargas: Record<number, CargaRenglon>): number {
  return Object.values(cargas).reduce((acc, c) => acc + (Number(c.cantidad) || 0), 0)
}

/** `true` si la carga tiene algo que valga la pena conservar. */
function cargaTieneAlgo(c: CargaRenglon | undefined): boolean {
  if (!c) return false
  return c.cantidad !== '' || c.fecha_vencimiento !== '' || c.sin_vencimiento === true
}

/** `true` si la factura está completamente en blanco (ni N°, ni renglones). */
export function facturaEnBlanco(f: FacturaEntrega): boolean {
  return (
    f.numero.trim() === '' &&
    f.orden.length === 0 &&
    !Object.values(f.cargas).some(cargaTieneAlgo)
  )
}

/** Normaliza una carga venida de localStorage (puede estar corrupta o a mano). */
function sanearCarga(crudo: unknown): CargaRenglon | null {
  if (typeof crudo !== 'object' || crudo === null) return null
  const c = crudo as Partial<CargaRenglon>
  const carga: CargaRenglon = {
    cantidad: typeof c.cantidad === 'string' ? c.cantidad : '',
    fecha_vencimiento:
      typeof c.fecha_vencimiento === 'string' ? c.fecha_vencimiento : '',
  }
  if (c.sin_vencimiento === true) carga.sin_vencimiento = true
  return cargaTieneAlgo(carga) ? carga : null
}

/**
 * Cruza el borrador guardado contra los renglones que HOY tiene la orden.
 *
 * Entre que se guardó y se volvió a abrir, la orden pudo cambiar: otra sesión
 * confirmó un "no vino" que borró renglones, o se editó la orden de compra. Las
 * reglas son:
 *
 * - Versión distinta → se descarta todo (no se migra un borrador de un solo uso).
 * - Renglón que ya no existe → se saca de `cargas` y de `orden`, y se reporta en
 *   `descartados` para avisarle al usuario qué se perdió.
 * - Renglón nuevo en la orden → no entra a ninguna factura: queda en "falta
 *   controlar", que es donde el empleado lo va a buscar.
 * - Lo ya recibido en entregas anteriores NO se toma del borrador: se lee siempre
 *   de la orden fresca, porque es lo único autoritativo.
 * - Si después de limpiar no quedó nada, devuelve `null` (arranca de cero).
 */
export function reconciliarBorrador(
  crudo: unknown,
  vivos: RenglonVivo[]
): ResultadoReconciliacion | null {
  if (typeof crudo !== 'object' || crudo === null) return null
  const bor = crudo as Partial<BorradorRecepcion>
  if (bor.v !== BORRADOR_RECEPCION_V) return null
  if (!Array.isArray(bor.facturas) || bor.facturas.length === 0) return null

  const idsVivos = new Set(vivos.map((r) => r.item_id))
  const descartados = new Set<number>()

  const facturas: FacturaEntrega[] = bor.facturas.map((cruda, i) => {
    const f = (cruda ?? {}) as Partial<FacturaEntrega>

    const cargas: Record<number, CargaRenglon> = {}
    for (const [clave, valor] of Object.entries(f.cargas ?? {})) {
      const id = Number(clave)
      if (!Number.isInteger(id)) continue
      const carga = sanearCarga(valor)
      if (!carga) continue
      if (!idsVivos.has(id)) {
        descartados.add(id)
        continue
      }
      cargas[id] = carga
    }

    // El orden manda sobre qué renglones están en la factura, pero una carga
    // sin lugar en `orden` (borrador escrito a mitad de camino) no se tira: se
    // le da lugar al final.
    const orden: number[] = []
    const vistos = new Set<number>()
    for (const id of Array.isArray(f.orden) ? f.orden : []) {
      if (!Number.isInteger(id) || vistos.has(id)) continue
      if (!idsVivos.has(id)) {
        descartados.add(id)
        continue
      }
      vistos.add(id)
      orden.push(id)
    }
    for (const id of Object.keys(cargas).map(Number)) {
      if (!vistos.has(id)) {
        vistos.add(id)
        orden.push(id)
      }
    }

    return {
      id: typeof f.id === 'string' && f.id ? f.id : `t${i + 1}`,
      numero: typeof f.numero === 'string' ? f.numero : '',
      cargas,
      orden,
    }
  })

  if (facturas.every(facturaEnBlanco)) return null

  // Una pestaña vacía en el medio se conserva (el usuario la abrió a propósito);
  // solo se recortan las vacías del final, que son ruido de una sesión anterior.
  while (facturas.length > 1 && facturaEnBlanco(facturas[facturas.length - 1])) {
    facturas.pop()
  }

  const activaIdx = Math.min(
    Math.max(Number.isInteger(bor.activaIdx) ? (bor.activaIdx as number) : 0, 0),
    facturas.length - 1
  )

  const proximaTab = Math.max(
    Number.isInteger(bor.proximaTab) ? (bor.proximaTab as number) : 0,
    facturas.length + 1
  )

  const nombres: Record<number, string> = {}
  for (const [clave, valor] of Object.entries(bor.nombres ?? {})) {
    const id = Number(clave)
    if (Number.isInteger(id) && typeof valor === 'string') nombres[id] = valor
  }

  // Solo se nombran los descartados que TENÍAN cantidad: perder un renglón que
  // nadie tocó no es noticia para el que está descargando el camión.
  const nombresDescartados = [...descartados]
    .map((id) => nombres[id])
    .filter((n): n is string => typeof n === 'string' && n !== '')

  // Lo ya recibido lo manda siempre la base. Acá solo se detecta que cambió,
  // para avisar: si otra entrega ya cargó estas unidades, confirmar lo tipeado
  // las sumaría de nuevo.
  const yaRecibido: Record<number, number> = {}
  const recibidoCambio: number[] = []
  for (const r of vivos) {
    const foto = Number(bor.yaRecibido?.[r.item_id] ?? 0)
    yaRecibido[r.item_id] = r.ya_recibido
    // Nunca con === : el stock por peso son decimales (regla del proyecto).
    if (Math.abs(foto - r.ya_recibido) > 0.001) recibidoCambio.push(r.item_id)
  }

  return {
    borrador: {
      v: BORRADOR_RECEPCION_V,
      facturas,
      activaIdx,
      proximaTab,
      nombres,
      yaRecibido,
    },
    descartados: [...descartados],
    nombresDescartados,
    recibidoCambio,
  }
}
