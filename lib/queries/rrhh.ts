import { createClient } from '@/lib/supabase/client'
import type {
  EmpleadoConSueldo,
  EmpleadoDocumentoRow,
  EmpleadoInsert,
  EmpleadoRow,
  EmpleadoUpdate,
  Json,
  LiquidacionLoteRow,
  LiquidacionReciboRow,
  LiquidacionRenglonRow,
  NovedadEmpleadoInsert,
  NovedadEmpleadoRow,
  TipoDocumentoEmpleado,
} from '@/types/database'

// ─── Empleados ───────────────────────────────────────────────────────────────
//
// El sueldo vive en la tabla gateada `empleado_sueldo` (permiso 'rrhh_sueldos',
// sólo admin). Se lee con el embed `empleado_sueldo(...)`: para un encargado el
// embed viene null → sueldo 0 (no ve el monto, ni por la UI ni por la API).
// Mismo patrón que `costos_producto` / `precio_costo`.

const SELECT_EMPLEADO = '*, empleado_sueldo(sueldo_basico, valor_hora)'

type SueldoEmbed =
  | { sueldo_basico: number; valor_hora: number }
  | { sueldo_basico: number; valor_hora: number }[]
  | null

type EmpleadoRaw = EmpleadoRow & { empleado_sueldo: SueldoEmbed }

/** Normaliza el embed (objeto, array o null) y devuelve el empleado con sueldo. */
function mapearSueldo(r: EmpleadoRaw): EmpleadoConSueldo {
  const { empleado_sueldo, ...resto } = r
  const fila = Array.isArray(empleado_sueldo) ? empleado_sueldo[0] : empleado_sueldo
  return {
    ...(resto as EmpleadoRow),
    sueldo_basico: Number(fila?.sueldo_basico ?? 0),
    valor_hora: Number(fila?.valor_hora ?? 0),
  }
}

/** Escribe el sueldo en la tabla gateada (valor_hora es GENERATED, no se toca). */
async function guardarSueldo(
  supabase: ReturnType<typeof createClient>,
  empleadoId: number,
  sueldoBasico: number
): Promise<void> {
  const { error } = await supabase
    .from('empleado_sueldo')
    .upsert(
      {
        empleado_id: empleadoId,
        sueldo_basico: sueldoBasico,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'empleado_id' }
    )
  if (error) throw error
}

export async function getEmpleados(): Promise<EmpleadoConSueldo[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empleados')
    .select(SELECT_EMPLEADO)
    .order('nombre', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as EmpleadoRaw[]).map(mapearSueldo)
}

export async function getEmpleado(id: number): Promise<EmpleadoConSueldo | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empleados')
    .select(SELECT_EMPLEADO)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  return mapearSueldo(data as unknown as EmpleadoRaw)
}

export async function createEmpleado(
  datos: EmpleadoInsert
): Promise<EmpleadoConSueldo> {
  const supabase = createClient()
  // El sueldo va a empleado_sueldo (tabla gateada), no a empleados.
  const { sueldo_basico, ...resto } = datos
  const { data, error } = await supabase
    .from('empleados')
    .insert(resto)
    .select('id')
    .single<{ id: number }>()

  if (error) throw error
  if (sueldo_basico != null) await guardarSueldo(supabase, data.id, sueldo_basico)

  const completo = await getEmpleado(data.id)
  if (!completo) throw new Error('No se pudo leer el empleado recién creado.')
  return completo
}

export async function updateEmpleado(
  id: number,
  datos: EmpleadoUpdate
): Promise<EmpleadoConSueldo> {
  const supabase = createClient()
  const { sueldo_basico, ...resto } = datos
  if (sueldo_basico != null) await guardarSueldo(supabase, id, sueldo_basico)

  const { data, error } = await supabase
    .from('empleados')
    .update({ ...resto, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(SELECT_EMPLEADO)
    .single()

  if (error) throw error
  return mapearSueldo(data as unknown as EmpleadoRaw)
}

export async function toggleEmpleadoActivo(
  id: number,
  activo: boolean
): Promise<EmpleadoConSueldo> {
  return updateEmpleado(id, { activo })
}

// ─── Documentos del empleado (bucket privado rrhh-docs) ───────────────────────

const BUCKET_DOCS = 'rrhh-docs'
const BUCKET_FOTOS = 'rrhh-fotos'

export async function getDocumentos(
  empleadoId: number
): Promise<EmpleadoDocumentoRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('empleado_documentos')
    .select('*')
    .eq('empleado_id', empleadoId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as EmpleadoDocumentoRow[]
}

export interface SubirDocumentoArgs {
  empleadoId: number
  tipo: TipoDocumentoEmpleado
  archivo: File
  fechaVencimiento?: string | null
  notas?: string | null
  usuarioId?: string | null
}

export async function subirDocumento(
  args: SubirDocumentoArgs
): Promise<EmpleadoDocumentoRow> {
  const supabase = createClient()
  const ext = args.archivo.name.split('.').pop() || 'bin'
  const path = `${args.empleadoId}/${crypto.randomUUID()}.${ext}`

  const { error: errUp } = await supabase.storage
    .from(BUCKET_DOCS)
    .upload(path, args.archivo, { upsert: false })
  if (errUp) throw errUp

  const { data, error } = await supabase
    .from('empleado_documentos')
    .insert({
      empleado_id: args.empleadoId,
      tipo: args.tipo,
      archivo_url: path,
      nombre_archivo: args.archivo.name,
      fecha_vencimiento: args.fechaVencimiento ?? null,
      notas: args.notas ?? null,
      usuario_id: args.usuarioId ?? null,
    })
    .select()
    .single<EmpleadoDocumentoRow>()

  if (error) {
    // Rollback del archivo si falla el insert del registro.
    await supabase.storage.from(BUCKET_DOCS).remove([path])
    throw error
  }
  return data
}

export async function eliminarDocumento(
  doc: Pick<EmpleadoDocumentoRow, 'id' | 'archivo_url'>
): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('empleado_documentos')
    .delete()
    .eq('id', doc.id)
  if (error) throw error
  await supabase.storage.from(BUCKET_DOCS).remove([doc.archivo_url])
}

/** URL firmada temporal (5 min) para ver/descargar un documento privado. */
export async function urlFirmadaDocumento(path: string): Promise<string> {
  const supabase = createClient()
  const { data, error } = await supabase.storage
    .from(BUCKET_DOCS)
    .createSignedUrl(path, 60 * 5)
  if (error) throw error
  return data.signedUrl
}

/**
 * Sube la foto al bucket público, la persiste en empleados.foto_url y devuelve
 * la URL. Cache-bust con ?v= porque el path es estable (upsert pisa el archivo).
 */
export async function subirFotoEmpleado(
  empleadoId: number,
  archivo: File
): Promise<string> {
  const supabase = createClient()
  // Path estable (sin extensión) para que upsert SIEMPRE pise el archivo anterior
  // y no queden huérfanos al cambiar de formato. El content-type lo fija Storage
  // desde el File, no desde la extensión.
  const path = `${empleadoId}/foto`
  const { error } = await supabase.storage
    .from(BUCKET_FOTOS)
    .upload(path, archivo, { upsert: true, contentType: archivo.type || undefined })
  if (error) throw error

  const { data } = supabase.storage.from(BUCKET_FOTOS).getPublicUrl(path)
  const url = `${data.publicUrl}?v=${Date.now()}`

  const { error: errUpd } = await supabase
    .from('empleados')
    .update({ foto_url: url, updated_at: new Date().toISOString() })
    .eq('id', empleadoId)
  if (errUpd) throw errUpd

  return url
}

// ─── Config de RRHH (key-value) ───────────────────────────────────────────────

export async function getRrhhConfig(): Promise<Record<string, Json>> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('rrhh_config')
    .select('clave, valor')
  if (error) throw error
  const out: Record<string, Json> = {}
  for (const r of (data ?? []) as { clave: string; valor: Json }[]) {
    out[r.clave] = r.valor
  }
  return out
}

// ─── Novedades ───────────────────────────────────────────────────────────────

export interface NovedadConEmpleado extends NovedadEmpleadoRow {
  empleados: { nombre: string } | null
}

export async function getNovedades(
  periodo: string
): Promise<NovedadConEmpleado[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('novedades_empleado')
    .select('*, empleados(nombre)')
    .eq('periodo', periodo)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as NovedadConEmpleado[]
}

export async function createNovedad(
  datos: NovedadEmpleadoInsert
): Promise<NovedadEmpleadoRow> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('novedades_empleado')
    .insert(datos)
    .select()
    .single<NovedadEmpleadoRow>()

  if (error) throw error
  return data
}

export async function deleteNovedad(id: number): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('novedades_empleado')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ─── Liquidaciones (modelo nuevo · Sprint 4) ─────────────────────────────────
//
// Modelo por-empleado con snapshot inmutable. Una liquidación es un LOTE de un
// período (cabecera) con un RECIBO por empleado y RENGLONES de conceptos. Lee
// la asistencia real y el sueldo gateado; el cálculo vive en la RPC
// `fn_generar_liquidacion` (security definer, gateada a 'rrhh_sueldos').

/** Empleado embebido (objeto, array o null) → normalizado a objeto o null. */
function empleadoDesdeEmbed<T>(embed: T | T[] | null): T | null {
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

export async function getLiquidacionLotes(): Promise<LiquidacionLoteRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('liquidacion_lote')
    .select('*')
    .order('periodo', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw error
  return (data ?? []) as LiquidacionLoteRow[]
}

export interface ReciboConEmpleado extends LiquidacionReciboRow {
  empleados: {
    nombre: string
    apellido: string | null
    legajo: string
    puesto: string | null
  } | null
}

export interface LiquidacionLoteDetalle {
  lote: LiquidacionLoteRow
  recibos: ReciboConEmpleado[]
}

export async function getLiquidacionLoteDetalle(
  id: number
): Promise<LiquidacionLoteDetalle | null> {
  const supabase = createClient()
  const [resLote, resRecibos] = await Promise.all([
    supabase.from('liquidacion_lote').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('liquidacion_recibo')
      .select('*, empleados(nombre, apellido, legajo, puesto)')
      .eq('lote_id', id)
      .order('id', { ascending: true }),
  ])

  if (resLote.error) throw resLote.error
  if (resRecibos.error) throw resRecibos.error
  if (!resLote.data) return null

  type ReciboRaw = LiquidacionReciboRow & {
    empleados: ReciboConEmpleado['empleados'] | ReciboConEmpleado['empleados'][]
  }
  const recibos = ((resRecibos.data ?? []) as unknown as ReciboRaw[]).map((r) => {
    const { empleados, ...resto } = r
    return { ...(resto as LiquidacionReciboRow), empleados: empleadoDesdeEmbed(empleados) }
  })

  return { lote: resLote.data as LiquidacionLoteRow, recibos }
}

export interface ReciboCompleto {
  recibo: LiquidacionReciboRow
  renglones: LiquidacionRenglonRow[]
  empleado: Pick<
    EmpleadoRow,
    'nombre' | 'apellido' | 'legajo' | 'cuil' | 'dni' | 'puesto'
  > | null
  lote: Pick<LiquidacionLoteRow, 'periodo' | 'estado' | 'fecha_pago'> | null
}

/** Recibo + renglones + datos del empleado y del lote, para el PDF. */
export async function getReciboCompleto(
  reciboId: number
): Promise<ReciboCompleto | null> {
  const supabase = createClient()
  const [resRecibo, resRenglones] = await Promise.all([
    supabase
      .from('liquidacion_recibo')
      .select(
        '*, empleados(nombre, apellido, legajo, cuil, dni, puesto), liquidacion_lote(periodo, estado, fecha_pago)'
      )
      .eq('id', reciboId)
      .maybeSingle(),
    supabase
      .from('liquidacion_renglon')
      .select('*')
      .eq('recibo_id', reciboId)
      .order('orden', { ascending: true }),
  ])

  if (resRecibo.error) throw resRecibo.error
  if (resRenglones.error) throw resRenglones.error
  if (!resRecibo.data) return null

  type ReciboRaw = LiquidacionReciboRow & {
    empleados: ReciboCompleto['empleado'] | ReciboCompleto['empleado'][]
    liquidacion_lote: ReciboCompleto['lote'] | ReciboCompleto['lote'][]
  }
  const { empleados, liquidacion_lote, ...recibo } =
    resRecibo.data as unknown as ReciboRaw

  return {
    recibo: recibo as LiquidacionReciboRow,
    renglones: (resRenglones.data ?? []) as LiquidacionRenglonRow[],
    empleado: empleadoDesdeEmbed(empleados),
    lote: empleadoDesdeEmbed(liquidacion_lote),
  }
}

/** Arma (o re-arma) el borrador del período leyendo asistencia + sueldo. */
export async function generarLiquidacion(
  periodo: string,
  usuarioId: string
): Promise<LiquidacionLoteRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_generar_liquidacion', {
    p_periodo: periodo,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
  return data as LiquidacionLoteRow
}

/** Confirma el borrador y genera el asiento de devengamiento (balanceado). */
export async function confirmarLiquidacion(
  loteId: number,
  usuarioId: string
): Promise<LiquidacionLoteRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_confirmar_liquidacion', {
    p_lote_id: loteId,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
  return data as LiquidacionLoteRow
}

/** Paga el neto total desde una cuenta de tesorería. */
export async function pagarLiquidacion(
  loteId: number,
  cuentaId: number,
  usuarioId: string
): Promise<LiquidacionLoteRow> {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('fn_pagar_liquidacion', {
    p_lote_id: loteId,
    p_cuenta_id: cuentaId,
    p_usuario_id: usuarioId,
  })
  if (error) throw error
  return data as LiquidacionLoteRow
}
