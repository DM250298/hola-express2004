'use client'

import { useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MontoARS } from '@/components/shared/MontoARS'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { useUsuario } from '@/lib/hooks/useUsuario'
import {
  useDatosParaMatch,
  useAplicarConciliacion,
} from '@/lib/hooks/useConciliacion'
import {
  parsearArchivoExtracto,
  construirLineas,
  cruzarLineas,
  type ArchivoParseado,
  type MapeoExtracto,
  type LineaConciliacion,
} from '@/lib/queries/conciliacion'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

type Paso = 'archivo' | 'mapeo' | 'revision'

const SIN_CUENTA = '__sin__'
const SIN_COL = '-1'

const CAMPOS: { clave: keyof MapeoExtracto; etiqueta: string; req: boolean }[] = [
  { clave: 'fecha', etiqueta: 'Fecha', req: true },
  { clave: 'monto', etiqueta: 'Monto (neto)', req: true },
  { clave: 'descripcion', etiqueta: 'Descripción', req: false },
  { clave: 'id_externo', etiqueta: 'ID operación', req: false },
]

export function ModalImportarExtracto({ abierto, onCambioAbierto }: Props) {
  const { data: usuario } = useUsuario()
  const { data: cuentas } = useCuentas(true)
  const aplicar = useAplicarConciliacion()
  const inputRef = useRef<HTMLInputElement>(null)

  const [paso, setPaso] = useState<Paso>('archivo')
  const [cuentaId, setCuentaId] = useState<string>(SIN_CUENTA)
  const [nombreArchivo, setNombreArchivo] = useState('')
  const [archivo, setArchivo] = useState<ArchivoParseado | null>(null)
  const [mapeo, setMapeo] = useState<MapeoExtracto>({
    fecha: -1,
    monto: -1,
    descripcion: -1,
    id_externo: -1,
  })
  const [lineas, setLineas] = useState<LineaConciliacion[]>([])
  const [parseando, setParseando] = useState(false)

  const cuentaNum = cuentaId === SIN_CUENTA ? undefined : Number(cuentaId)
  const { data: datos } = useDatosParaMatch(cuentaNum)

  const cuentasDestino = (cuentas ?? []).filter(
    (c) => c.tipo === 'banco' || c.tipo === 'billetera_virtual'
  )

  function reset() {
    setPaso('archivo')
    setArchivo(null)
    setLineas([])
    setNombreArchivo('')
    setMapeo({ fecha: -1, monto: -1, descripcion: -1, id_externo: -1 })
  }

  function cerrar(v: boolean) {
    if (aplicar.isPending) return
    if (!v) reset()
    onCambioAbierto(v)
  }

  async function onArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseando(true)
    try {
      const parseado = await parsearArchivoExtracto(file)
      setArchivo(parseado)
      setMapeo(parseado.mapeoSugerido)
      setNombreArchivo(file.name)
      setPaso('mapeo')
    } catch {
      // toast manejado abajo
    } finally {
      setParseando(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function continuarARevision() {
    if (!archivo || !datos) return
    const crudas = construirLineas(archivo.filas, mapeo, archivo.filaInicio)
    const cruzadas = cruzarLineas(
      crudas,
      datos.acreditaciones,
      datos.movimientos
    )
    setLineas(cruzadas)
    setPaso('revision')
  }

  function alternarIgnorar(idx: number) {
    setLineas((prev) =>
      prev.map((l, i) =>
        i === idx
          ? {
              ...l,
              accion: l.accion === 'ignorar' ? recalcularAccion(l) : 'ignorar',
            }
          : l
      )
    )
  }

  function recalcularAccion(l: LineaConciliacion): LineaConciliacion['accion'] {
    if (l.ref_id != null) {
      return l.monto > 0 && l.match_label?.startsWith('Venta')
        ? 'acreditar'
        : 'conciliar_mov'
    }
    return 'anomalia'
  }

  const resumen = useMemo(() => {
    let conc = 0
    let anom = 0
    let ign = 0
    let montoConc = 0
    for (const l of lineas) {
      if (l.accion === 'ignorar') ign++
      else if (l.accion === 'anomalia') anom++
      else {
        conc++
        montoConc += l.monto
      }
    }
    return { conc, anom, ign, montoConc }
  }, [lineas])

  function aplicarTodo() {
    if (!usuario || cuentaNum == null) return
    aplicar.mutate(
      {
        usuario_id: usuario.id,
        cuenta_id: cuentaNum,
        nombre_archivo: nombreArchivo,
        lineas,
      },
      { onSuccess: () => cerrar(false) }
    )
  }

  const mapeoValido = mapeo.fecha >= 0 && mapeo.monto >= 0

  return (
    <Dialog open={abierto} onOpenChange={cerrar}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-[#f9b44c]" />
            Importar extracto bancario
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            Subí el reporte de liquidaciones de Mercado Pago (CSV o Excel). El
            sistema cruza cada línea contra tus ventas y movimientos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* PASO 1: archivo + cuenta */}
          {paso === 'archivo' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[#391511] font-medium text-sm flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-[#f9b44c]" />
                  Cuenta a conciliar
                </Label>
                <Select
                  value={cuentaId}
                  onValueChange={(v) => setCuentaId(v ?? SIN_CUENTA)}
                >
                  <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                    <SelectValue placeholder="Elegí la cuenta (ej: Mercado Pago)…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_CUENTA} disabled>
                      Elegí la cuenta…
                    </SelectItem>
                    {cuentasDestino.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.nombre}
                        {c.banco ? ` · ${c.banco}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <button
                type="button"
                onClick={() => cuentaNum != null && inputRef.current?.click()}
                disabled={cuentaNum == null || parseando}
                className={cn(
                  'w-full rounded-2xl border-2 border-dashed p-10 flex flex-col items-center gap-2 transition-colors',
                  cuentaNum == null
                    ? 'border-[#e4c9b0]/60 opacity-50 cursor-not-allowed'
                    : 'border-[#f9b44c]/60 hover:bg-[#f9b44c]/5 cursor-pointer'
                )}
              >
                {parseando ? (
                  <Loader2 className="h-8 w-8 text-[#f9b44c] animate-spin" />
                ) : (
                  <Upload className="h-8 w-8 text-[#f9b44c]" />
                )}
                <span className="text-[#391511] font-semibold">
                  {parseando ? 'Leyendo archivo…' : 'Subí el archivo del extracto'}
                </span>
                <span className="text-[#6f3a2a] text-xs">
                  CSV o Excel (.xlsx) · {cuentaNum == null
                    ? 'elegí primero la cuenta'
                    : 'tocá para elegir'}
                </span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={onArchivo}
                className="hidden"
              />
            </>
          )}

          {/* PASO 2: mapeo de columnas */}
          {paso === 'mapeo' && archivo && (
            <>
              <p className="text-sm text-[#6f3a2a]">
                Verificá que cada dato apunte a la columna correcta. Detectamos
                {archivo.headers.length} columnas.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CAMPOS.map(({ clave, etiqueta, req }) => (
                  <div key={clave} className="space-y-1.5">
                    <Label className="text-[#391511] font-medium text-sm">
                      {etiqueta}{' '}
                      {req && <span className="text-[#c43e2c]">*</span>}
                    </Label>
                    <Select
                      value={String(mapeo[clave])}
                      onValueChange={(v) =>
                        setMapeo((prev) => ({
                          ...prev,
                          [clave]: Number(v ?? SIN_COL),
                        }))
                      }
                    >
                      <SelectTrigger className="border-[#e4c9b0] focus:ring-[#f9b44c]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SIN_COL}>
                          <span className="text-[#c8a58a] italic">
                            (ninguna)
                          </span>
                        </SelectItem>
                        {archivo.headers.map((h, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {h || `Columna ${i + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {/* Preview de primeras filas */}
              <div className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden">
                <div className="px-3 py-1.5 bg-[#fdfaf6] text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Vista previa
                </div>
                <div className="divide-y divide-[#e4c9b0]/40 max-h-40 overflow-y-auto">
                  {archivo.filas.slice(0, 4).map((f, i) => (
                    <div
                      key={i}
                      className="px-3 py-1.5 text-xs text-[#6f3a2a] flex gap-3"
                    >
                      <span className="tabular-nums">
                        {mapeo.fecha >= 0 ? String(f[mapeo.fecha] ?? '') : '—'}
                      </span>
                      <span className="flex-1 truncate">
                        {mapeo.descripcion >= 0
                          ? String(f[mapeo.descripcion] ?? '')
                          : '—'}
                      </span>
                      <span className="tabular-nums font-semibold text-[#391511]">
                        {mapeo.monto >= 0 ? String(f[mapeo.monto] ?? '') : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* PASO 3: revisión del cruce */}
          {paso === 'revision' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <ResumenChip
                  icono={CheckCircle2}
                  label="Conciliadas"
                  valor={resumen.conc}
                  clase="text-[#2f7d4f] bg-[#2f7d4f]/10 border-[#2f7d4f]/30"
                />
                <ResumenChip
                  icono={AlertCircle}
                  label="Anomalías"
                  valor={resumen.anom}
                  clase="text-[#c43e2c] bg-[#c43e2c]/10 border-[#c43e2c]/30"
                />
                <ResumenChip
                  icono={XCircle}
                  label="Ignoradas"
                  valor={resumen.ign}
                  clase="text-[#6f3a2a] bg-[#c8a58a]/15 border-[#c8a58a]/40"
                />
              </div>

              <div className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden">
                <div className="max-h-[40vh] overflow-y-auto divide-y divide-[#e4c9b0]/40">
                  {lineas.map((l, i) => (
                    <div
                      key={i}
                      className={cn(
                        'px-3 py-2 flex items-center gap-3 text-sm',
                        l.accion === 'anomalia' && 'bg-[#c43e2c]/5',
                        l.accion === 'ignorar' && 'opacity-50'
                      )}
                    >
                      <div className="w-20 shrink-0 text-xs text-[#6f3a2a] tabular-nums">
                        {l.fecha ? formatearFechaCorta(l.fecha) : '—'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-[#391511]">
                          {l.descripcion || (
                            <span className="text-[#c8a58a] italic">
                              sin descripción
                            </span>
                          )}
                        </div>
                        {l.match_label && (
                          <div className="text-[11px] text-[#2f7d4f] truncate">
                            → {l.match_label}
                          </div>
                        )}
                        {l.accion === 'anomalia' && (
                          <div className="text-[11px] text-[#c43e2c]">
                            Sin coincidencia
                          </div>
                        )}
                      </div>
                      <div className="w-24 text-right tabular-nums font-semibold text-[#391511] shrink-0">
                        <MontoARS monto={l.monto} />
                      </div>
                      <button
                        type="button"
                        onClick={() => alternarIgnorar(i)}
                        className="text-[10px] uppercase tracking-wider text-[#c8a58a] hover:text-[#391511] shrink-0 w-16 text-right"
                      >
                        {l.accion === 'ignorar' ? 'incluir' : 'ignorar'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex items-center justify-between gap-2 shrink-0">
          <Button
            variant="outline"
            onClick={() => (paso === 'archivo' ? cerrar(false) : reset())}
            disabled={aplicar.isPending}
            className="border-[#e4c9b0] text-[#6f3a2a]"
          >
            {paso === 'archivo' ? 'Cancelar' : 'Empezar de nuevo'}
          </Button>

          {paso === 'mapeo' && (
            <Button
              onClick={continuarARevision}
              disabled={!mapeoValido || !datos}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
            >
              {!datos ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  Cruzar <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}

          {paso === 'revision' && (
            <Button
              onClick={aplicarTodo}
              disabled={aplicar.isPending || resumen.conc === 0}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
            >
              {aplicar.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Aplicando…
                </>
              ) : (
                `Conciliar ${resumen.conc} línea(s)`
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ResumenChip({
  icono: Icono,
  label,
  valor,
  clase,
}: {
  icono: React.ElementType
  label: string
  valor: number
  clase: string
}) {
  return (
    <div className={cn('rounded-xl border px-3 py-2', clase)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold">
        <Icono className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-xl font-extrabold tabular-nums mt-0.5">{valor}</div>
    </div>
  )
}
