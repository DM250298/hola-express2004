// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Carga de la rutina de los 3 turnos (docs/carga-rutina-3-turnos.md)    ║
// ║                                                                        ║
// ║  Lee docs/rutina-3-turnos.json, valida todo, lo convierte al formato   ║
// ║  de HEX y llama a fn_rutina_cargar_lote (migs 301–302), que hace la    ║
// ║  carga en UNA transacción.                                             ║
// ║                                                                        ║
// ║  Uso:                                                                  ║
// ║    node scripts/cargar-rutina-3-turnos.ts --validar     (sin base)     ║
// ║    node scripts/cargar-rutina-3-turnos.ts --dry-run     (no escribe)   ║
// ║    node scripts/cargar-rutina-3-turnos.ts --aplicar --proyecto <ref>   ║
// ║  Opciones: --env <archivo> (por defecto .env.local = base de prueba),  ║
// ║  --vigencia AAAA-MM-DD (por defecto 2026-10-19), --desactivar M01,…    ║
// ║  y, con --validar, --guardar-lote <archivo> (el lote ya convertido).   ║
// ║  Las claves salen del archivo de entorno o de las variables            ║
// ║  NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Nunca del repo.  ║
// ║                                                                        ║
// ║  Decisiones del dueño (2026-10-18): en la TARDE no hay cajero, así     ║
// ║  que "Cajero/a" va a la encargada de turno (Rebeca); aviso de atraso   ║
// ║  y foto obligatoria se cargan tal como vienen en el JSON.              ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

type Paso = { orden: number; texto: string; se_marca: string }
type TareaJson = {
  codigo: string; turno: string; titulo: string; detalle: string | null
  area_clave: string; puestos: string[]; modo: string; prioridad: string
  sin_hora_fija: boolean; hora_inicio: string | null; inicio_offset_min: number | null
  duracion_min: number | null; dias_semana: number[]; aviso_atraso_min: number | null
  pide_foto: boolean; pasos: Paso[]
}
type Lote = {
  total_tareas: number; tareas: TareaJson[]
  esperado_en_la_agenda: Record<string, Record<string, number>>
}
type TareaHex = {
  codigo: string; turno: string; titulo: string; descripcion: string | null
  minutos_desde_inicio: number | null; duracion_min: number | null; dias_semana: number[]
  roles_puesto: string[]; modo: string; prioridad: string; area: string
  avisar_atraso_min: number | null; requiere_evidencia: boolean; checklist: string[]
}
type FilaSemana = {
  fecha: string; turno: string; codigo: string; titulo: string; modo: string; todo_el_turno: boolean
  inicio: string; fin: string; pasos: number | null; foto: boolean; aviso: number | null
  notas: string | null; quien: string[]
}
type Resultado = {
  modo: string; hoy: string; vigencia: string; creadas: number; actualizadas: number; iguales: number
  desactivadas: number; advertencias: string[]; activas_por_turno: Record<string, number>
  agenda_vigencia_generada: number; agenda_previa_sin_cambios: boolean; semana: FilaSemana[]
}

const TURNOS: Record<string, { clave: string; inicio: number }> = {
  'Mañana': { clave: 'manana', inicio: 7 * 60 },
  'Tarde': { clave: 'tarde', inicio: 15 * 60 },
  'Noche': { clave: 'noche', inicio: 23 * 60 },
}
const PUESTOS: Record<string, string> = {
  'Encargada de Sucursal': 'responsable_general',
  'Encargada de turno': 'encargado',
  'Cajero/a': 'cajero',
  'Fiambrero/Producción': 'fiambreria',
  'Vendedor de turno': 'cajero',
}
// Excepción por turno (decisión 2026-10-18): la tarde es Rebeca + fiambrero, sin cajero.
const PUESTOS_TURNO: Record<string, Record<string, string>> = { 'Tarde': { 'Cajero/a': 'encargado' } }
const MODOS: Record<string, string> = { cada_uno: 'individual', grupal: 'grupal' }
const AREAS = ['atencion_caja', 'produccion_fiambreria', 'reposicion_limpieza', 'control_seguridad']
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

// ─── Argumentos y entorno ────────────────────────────────────────────────
const args = process.argv.slice(2)
const flag = (n: string) => args.includes(n)
const valor = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const modo = flag('--aplicar') ? 'aplicar' : flag('--dry-run') ? 'prueba' : flag('--validar') ? 'validar' : null
if (!modo) {
  console.error('Elegí un modo: --validar (sin base), --dry-run (no escribe) o --aplicar --proyecto <ref>.')
  process.exit(1)
}
const vigencia = valor('--vigencia') ?? '2026-10-19'
const desactivar = (valor('--desactivar') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

function cargarEnv(ruta: string): Record<string, string> {
  const out: Record<string, string> = {}
  let contenido: string
  try { contenido = readFileSync(ruta, 'utf8') } catch { return out }
  for (const linea of contenido.split(/\r?\n/)) {
    const s = linea.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i === -1) continue
    let v = s.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[s.slice(0, i).trim()] = v
  }
  return out
}

// ─── Validación y conversión (si algo no cierra, no se escribe nada) ─────
function convertir(lote: Lote): { tareas: TareaHex[]; errores: string[] } {
  const errores: string[] = []
  const vistos = new Set<string>()
  if (lote.tareas.length !== 51 || lote.total_tareas !== 51) {
    errores.push(`Tienen que ser 51 tareas: el JSON trae ${lote.tareas.length} (total_tareas = ${lote.total_tareas}).`)
  }
  const tareas = lote.tareas.map((t): TareaHex => {
    const e = (m: string) => errores.push(`${t.codigo}: ${m}`)
    if (!/^T\d{3}$/.test(t.codigo)) e('código con formato inválido')
    if (vistos.has(t.codigo)) e('código repetido')
    vistos.add(t.codigo)
    const turno = TURNOS[t.turno]
    if (!turno) e(`turno desconocido "${t.turno}"`)
    if (!t.titulo?.trim() || t.titulo.trim().length > 200) e('título vacío o de más de 200 caracteres')
    if (!t.dias_semana?.length || t.dias_semana.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
        || new Set(t.dias_semana).size !== t.dias_semana.length) e('días de la semana fuera de 1–7 o repetidos')
    if (t.sin_hora_fija) {
      if (t.inicio_offset_min != null || t.duracion_min != null) e('sin hora fija pero trae inicio o duración')
    } else {
      const ini = t.inicio_offset_min, dur = t.duracion_min
      if (ini == null || dur == null || ini < 0 || dur <= 0) e('falta el inicio o la duración')
      else if (ini + dur > 480) e(`inicio + duración = ${ini + dur} min, pasa de las 8 horas del turno`)
      if (turno && ini != null && t.hora_inicio) {
        const m = (turno.inicio + ini) % 1440
        const hh = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        if (hh !== t.hora_inicio) e(`la hora ${t.hora_inicio} no coincide con el inicio (${hh})`)
      }
    }
    const roles = [...new Set(t.puestos.map((p) => PUESTOS_TURNO[t.turno]?.[p] ?? PUESTOS[p]))]
    t.puestos.forEach((p) => { if (!PUESTOS[p]) e(`puesto sin mapear "${p}"`) })
    if (!MODOS[t.modo]) e(`modo desconocido "${t.modo}"`)
    if (!['alta', 'media', 'baja'].includes(t.prioridad)) e(`prioridad desconocida "${t.prioridad}"`)
    if (!AREAS.includes(t.area_clave)) e(`área desconocida "${t.area_clave}"`)
    if (t.aviso_atraso_min != null && (t.aviso_atraso_min < 1 || t.aviso_atraso_min > 480)) e('aviso fuera de 1–480 min')
    const pasos = [...(t.pasos ?? [])].sort((a, b) => a.orden - b.orden)
    if (pasos.some((p, i) => p.orden !== i + 1 || !p.texto?.trim())) e('pasos sin orden 1..n o vacíos')
    return {
      codigo: t.codigo,
      turno: turno?.clave ?? t.turno,
      titulo: t.titulo?.trim() ?? '',
      descripcion: t.detalle?.trim() || null,
      minutos_desde_inicio: t.sin_hora_fija ? null : t.inicio_offset_min,
      duracion_min: t.sin_hora_fija ? null : t.duracion_min,
      // JSON: 1 = lunes … 7 = domingo. HEX (extract dow): 0 = domingo … 6 = sábado.
      dias_semana: [...new Set(t.dias_semana.map((d) => d % 7))].sort((a, b) => a - b),
      roles_puesto: roles.filter(Boolean).sort(),
      modo: MODOS[t.modo] ?? t.modo,
      prioridad: t.prioridad,
      area: t.area_clave,
      avisar_atraso_min: t.aviso_atraso_min ?? null,
      requiere_evidencia: t.pide_foto === true,
      checklist: pasos.map((p) => p.texto.trim()),
    }
  })
  return { tareas, errores }
}

// Tareas que tocan por día de la semana y turno, según el JSON (sin base).
function esperadoLocal(tareas: TareaHex[]) {
  const out: Record<string, Record<string, number>> = {}
  for (let d = 0; d < 7; d++) {
    out[DIAS[d]] = { manana: 0, tarde: 0, noche: 0 }
    for (const t of tareas) if (t.dias_semana.includes(d)) out[DIAS[d]][t.turno]++
  }
  return out
}

// ─── Informe ────────────────────────────────────────────────────────────
function informe(res: Resultado, esperado: Lote['esperado_en_la_agenda']) {
  console.log(`\n${res.modo.toUpperCase()} · hoy ${res.hoy} · rige desde ${res.vigencia}`)
  console.log(`Crea ${res.creadas} · actualiza ${res.actualizadas} · desactiva ${res.desactivadas} · iguales ${res.iguales}`)
  console.log(`Activas del lote por turno: ${JSON.stringify(res.activas_por_turno)}`)
  console.log(`Agenda del ${res.vigencia} generada: ${res.agenda_vigencia_generada} tareas · agenda de antes sin cambios: ${res.agenda_previa_sin_cambios ? 'sí' : 'NO'}`)
  if (res.advertencias.length) console.log('Advertencias:\n  · ' + res.advertencias.join('\n  · '))
  else console.log('Advertencias: ninguna')

  const porDia = new Map<string, Map<string, Set<string>>>()
  const sinPersona: string[] = []
  for (const f of res.semana) {
    if (!porDia.has(f.fecha)) porDia.set(f.fecha, new Map())
    const d = porDia.get(f.fecha)!
    if (!d.has(f.turno)) d.set(f.turno, new Set())
    d.get(f.turno)!.add(f.codigo)
    if (!f.quien.length) sinPersona.push(`${f.fecha} ${f.turno} ${f.codigo}`)
  }
  console.log('\nAgenda simulada (tareas distintas; entre paréntesis lo esperado del Paso 3):')
  console.log('Día              Mañana     Tarde      Noche      Total')
  let todoOk = true
  for (const [fecha, d] of porDia) {
    const dia = DIAS[new Date(fecha + 'T12:00:00Z').getUTCDay()]
    const esp = esperado[dia] ?? {}
    const celdas = (['manana', 'tarde', 'noche'] as const).map((tu) => {
      const n = d.get(tu)?.size ?? 0
      const e = esp[{ manana: 'Mañana', tarde: 'Tarde', noche: 'Noche' }[tu]]
      if (n !== e) todoOk = false
      return `${n} (${e})${n === e ? ' ' : '✖'}`.padEnd(11)
    })
    const total = [...d.values()].reduce((a, s) => a + s.size, 0)
    console.log(`${dia} ${fecha}   ${celdas.join('')}${total}`)
  }
  console.log(todoOk ? '✔ Coincide con la tabla del Paso 3.' : '✖ Hay días que no coinciden.')
  console.log(sinPersona.length ? `✖ Sin persona asignada: ${sinPersona.join(', ')}` : '✔ Todas las tareas tienen persona.')

  const busca = (c: string) => res.semana.filter((f) => f.codigo === c)
  const linea = (f: FilaSemana) =>
    `${f.fecha} ${f.turno}: ${f.todo_el_turno ? 'todo el turno' : `${f.inicio} → ${f.fin}`}, ${f.pasos ?? 0} pasos${f.foto ? ', con foto' : ''} · ${f.quien.join(' + ')}`
  console.log('\nControles puntuales:')
  for (const c of ['T008', 'T034', 'T037', 'T043']) { const f = busca(c)[0]; console.log(`  ${c} ${f ? linea(f) : 'NO APARECE'}`) }
  const t010 = busca('T010').map((f) => DIAS[new Date(f.fecha + 'T12:00:00Z').getUTCDay()])
  console.log(`  T010 aparece: ${t010.join(', ')}${t010.includes('Dom') ? ' ✖ (no va el domingo)' : ' ✔'}`)
  const t151 = busca('T151')
  console.log(`  T151 aparece: ${t151.map(linea).join(' | ') || 'NO APARECE'}`)
  console.log(`  Con foto: ${[...new Set(res.semana.filter((f) => f.foto).map((f) => f.codigo))].join(', ')}`)

  console.log('\nQuién hace qué (cantidad de tareas por persona):')
  for (const [fecha, d] of porDia) {
    const dia = DIAS[new Date(fecha + 'T12:00:00Z').getUTCDay()]
    const partes = [...d.keys()].map((tu) => {
      const cuenta = new Map<string, number>()
      res.semana.filter((f) => f.fecha === fecha && f.turno === tu)
        .forEach((f) => f.quien.forEach((q) => cuenta.set(q, (cuenta.get(q) ?? 0) + 1)))
      return `${tu}: ${[...cuenta].map(([q, n]) => `${q} ${n}`).join(', ')}`
    })
    console.log(`  ${dia} ${fecha} · ${partes.join(' · ')}`)
  }
  const cubre = res.semana.filter((f) => f.notas)
  if (cubre.length) {
    console.log('\nNotas de cobertura:')
    const vistas = new Set<string>()
    for (const f of cubre) {
      const k = `${f.fecha} ${f.turno} ${f.quien.join('+')}: ${f.notas}`
      if (!vistas.has(k)) { vistas.add(k); console.log('  ' + k) }
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  const lote = JSON.parse(readFileSync('docs/rutina-3-turnos.json', 'utf8')) as Lote
  const { tareas, errores } = convertir(lote)
  if (errores.length) {
    console.error('No se escribe nada. Errores en el JSON:\n  · ' + errores.join('\n  · '))
    process.exit(1)
  }
  const pasos = tareas.reduce((a, t) => a + t.checklist.length, 0)
  const porTurno = tareas.reduce<Record<string, number>>((a, t) => ({ ...a, [t.turno]: (a[t.turno] ?? 0) + 1 }), {})
  console.log(`JSON válido: ${tareas.length} tareas ${JSON.stringify(porTurno)}, ${pasos} pasos, ` +
    `${tareas.filter((t) => t.requiere_evidencia).length} con foto, ${tareas.filter((t) => t.avisar_atraso_min).length} con aviso.`)
  const local = esperadoLocal(tareas)
  const difiere = Object.entries(lote.esperado_en_la_agenda).filter(([dia, e]) =>
    local[dia]?.manana !== e['Mañana'] || local[dia]?.tarde !== e['Tarde'] || local[dia]?.noche !== e['Noche'])
  console.log(difiere.length ? `✖ Por días, no coincide con esperado_en_la_agenda: ${difiere.map(([d]) => d).join(', ')}`
    : '✔ Por días de la semana coincide con esperado_en_la_agenda.')
  if (modo === 'validar') {
    const salida = valor('--guardar-lote')
    if (salida) { writeFileSync(salida, JSON.stringify(tareas, null, 1)); console.log(`Lote convertido guardado en ${salida}`) }
    console.log('\nPuestos por tarea:')
    for (const t of tareas) console.log(`  ${t.codigo} ${t.turno.padEnd(6)} ${t.modo.padEnd(10)} ${t.roles_puesto.join(' + ')}`)
    return
  }

  const env = { ...cargarEnv(valor('--env') ?? '.env.local'), ...process.env }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) { console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1) }
  const ref = new URL(url).hostname.split('.')[0]
  console.log(`Base: ${ref}`)
  if (modo === 'aplicar' && valor('--proyecto') !== ref) {
    console.error(`Para escribir, confirmá la base con --proyecto ${ref}. No se escribió nada.`)
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await supabase.rpc('fn_rutina_cargar_lote', {
    p_tareas: tareas, p_vigencia: vigencia, p_desactivar: desactivar, p_aplicar: modo === 'aplicar',
  })
  if (error) { console.error(`La base rechazó la carga (no se guardó nada): ${error.message}`); process.exit(1) }
  informe(data as Resultado, lote.esperado_en_la_agenda)
}

main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
