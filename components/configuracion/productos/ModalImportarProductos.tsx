'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Plus,
  Upload,
  X,
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MontoARS } from '@/components/shared/MontoARS'
import {
  detectarColumnas,
  procesarFilas,
  type FilaProcesada,
} from '@/lib/utils/parseo-excel'
import {
  useEjecutarImportacion,
  useResumenImportacion,
  type ResumenImportacion,
  type ResultadoImportacion,
} from '@/lib/hooks/useImportarProductos'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

type Etapa = 'subir' | 'preview' | 'completado'

export function ModalImportarProductos({ abierto, onCambioAbierto }: Props) {
  const [etapa, setEtapa] = useState<Etapa>('subir')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [filas, setFilas] = useState<FilaProcesada[]>([])
  const [errorParseo, setErrorParseo] = useState<string | null>(null)
  const [resumen, setResumen] = useState<ResumenImportacion | null>(null)
  const [resultado, setResultado] = useState<ResultadoImportacion | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const refInput = useRef<HTMLInputElement | null>(null)

  const calcularResumen = useResumenImportacion()
  const ejecutar = useEjecutarImportacion()

  useEffect(() => {
    if (!abierto) {
      setEtapa('subir')
      setArchivo(null)
      setFilas([])
      setErrorParseo(null)
      setResumen(null)
      setResultado(null)
      setArrastrando(false)
    }
  }, [abierto])

  async function procesarArchivo(file: File) {
    setArchivo(file)
    setErrorParseo(null)
    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      if (!ws) {
        setErrorParseo('El archivo no tiene hojas.')
        return
      }
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: false,
        blankrows: false,
      })

      // Detectar fila de encabezados: probamos fila 1 y 2 (la 1 a veces es título)
      let mapeo = null
      let filaInicio = 2
      for (let i = 0; i < Math.min(3, aoa.length); i++) {
        const candidato = detectarColumnas(aoa[i] ?? [])
        if (candidato) {
          mapeo = candidato
          filaInicio = i + 2 // +1 para humano + 1 para saltar header
          break
        }
      }

      if (!mapeo) {
        setErrorParseo(
          'No se encontraron las columnas esperadas. Asegurate de que el archivo tenga "Producto" y "Precio de venta".'
        )
        return
      }

      const procesadas = procesarFilas(
        aoa.slice(filaInicio - 2),
        mapeo,
        filaInicio
      )
      setFilas(procesadas)

      if (procesadas.length === 0) {
        setErrorParseo('No se encontraron filas con datos.')
        return
      }

      // Calcular resumen
      const r = await calcularResumen.mutateAsync(procesadas)
      setResumen(r)
      setEtapa('preview')
    } catch (e) {
      setErrorParseo(
        e instanceof Error ? e.message : 'Error desconocido al leer el archivo.'
      )
    }
  }

  function handleArchivo(file: File | null) {
    if (!file) return
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setErrorParseo('Formato no soportado. Usá .xlsx, .xls o .csv')
      return
    }
    procesarArchivo(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setArrastrando(false)
    handleArchivo(e.dataTransfer.files[0] ?? null)
  }

  async function confirmar() {
    const res = await ejecutar.mutateAsync(filas)
    setResultado(res)
    setEtapa('completado')
  }

  const cargando = calcularResumen.isPending
  const procesando = ejecutar.isPending

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => !procesando && onCambioAbierto(v)}
    >
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-[#f9b44c]" />
            Importar productos desde Excel
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {etapa === 'subir' &&
              'Subí un .xlsx con columnas Producto, Precio costo, Precio venta, Stock, Categoría, Código y Proveedor.'}
            {etapa === 'preview' &&
              'Revisá el resumen y confirmá la importación.'}
            {etapa === 'completado' && 'Resumen de la importación.'}
          </DialogDescription>
        </DialogHeader>

        {/* ─── Etapa SUBIR ─── */}
        {etapa === 'subir' && (
          <div className="px-6 py-6 flex-1 overflow-y-auto">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setArrastrando(true)
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={handleDrop}
              onClick={() => refInput.current?.click()}
              className={cn(
                'rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-all',
                arrastrando
                  ? 'border-[#f9b44c] bg-[#f9b44c]/10'
                  : 'border-[#e4c9b0] bg-[#fdfaf6] hover:border-[#c8a58a]'
              )}
            >
              <input
                ref={refInput}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => handleArchivo(e.target.files?.[0] ?? null)}
              />
              {cargando ? (
                <>
                  <Loader2 className="h-10 w-10 mx-auto mb-3 text-[#f9b44c] animate-spin" />
                  <p className="text-[#391511] font-semibold">
                    Procesando {archivo?.name}…
                  </p>
                </>
              ) : (
                <>
                  <div className="inline-flex p-3 rounded-full bg-[#f9b44c]/15 mb-3">
                    <Upload className="h-6 w-6 text-[#f9b44c]" />
                  </div>
                  <p className="text-[#391511] font-semibold">
                    Arrastrá un archivo Excel acá
                  </p>
                  <p className="text-[#6f3a2a] text-sm mt-1">
                    o hacé click para elegirlo. Acepta .xlsx, .xls, .csv
                  </p>
                </>
              )}
            </div>

            {errorParseo && (
              <div className="mt-4 rounded-xl bg-[#c43e2c]/10 border border-[#c43e2c]/30 p-3 flex items-start gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-[#c43e2c] mt-0.5 shrink-0" />
                <span className="text-[#9e2f25]">{errorParseo}</span>
              </div>
            )}

            <div className="mt-5 rounded-xl bg-[#fdfaf6] border border-[#e4c9b0]/60 p-4">
              <p className="text-[#391511] font-semibold text-sm mb-2">
                💡 Cómo funciona el matching
              </p>
              <ul className="text-[#6f3a2a] text-xs space-y-1 list-disc pl-4">
                <li>
                  Productos con <span className="font-mono">código de barras</span>{' '}
                  existente se <strong>actualizan</strong>.
                </li>
                <li>Productos sin código o con código nuevo se <strong>crean</strong>.</li>
                <li>Categorías y proveedores nuevos se crean automáticamente.</li>
                <li>
                  Columnas <span className="font-mono">Tipo</span> y{' '}
                  <span className="font-mono">Unidad</span> se guardan tal cual
                  vienen (default <span className="font-mono">simple</span>
                  /<span className="font-mono">unidad</span>).
                </li>
              </ul>
            </div>
          </div>
        )}

        {/* ─── Etapa PREVIEW ─── */}
        {etapa === 'preview' && resumen && (
          <>
            <div className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-white shrink-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat
                  etiqueta="A crear"
                  valor={resumen.productos_a_crear}
                  color="#f9b44c"
                />
                <Stat
                  etiqueta="A actualizar"
                  valor={resumen.productos_a_actualizar}
                  color="#6f3a2a"
                />
                <Stat
                  etiqueta="Saltadas (Combo)"
                  valor={resumen.saltadas_combo}
                  color="#c8a58a"
                />
                <Stat
                  etiqueta="Con errores"
                  valor={resumen.con_errores}
                  color={resumen.con_errores > 0 ? '#c43e2c' : '#6f3a2a'}
                />
              </div>
              {(resumen.categorias_nuevas.length > 0 ||
                resumen.proveedores_nuevos.length > 0) && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  {resumen.categorias_nuevas.length > 0 && (
                    <div className="rounded-lg bg-[#f9b44c]/10 px-3 py-2">
                      <div className="text-[#6f3a2a] font-semibold uppercase tracking-wider text-[10px]">
                        Categorías nuevas ({resumen.categorias_nuevas.length})
                      </div>
                      <div className="text-[#391511] mt-1">
                        {resumen.categorias_nuevas.slice(0, 6).join(', ')}
                        {resumen.categorias_nuevas.length > 6 &&
                          ` y ${resumen.categorias_nuevas.length - 6} más`}
                      </div>
                    </div>
                  )}
                  {resumen.proveedores_nuevos.length > 0 && (
                    <div className="rounded-lg bg-[#f9b44c]/10 px-3 py-2">
                      <div className="text-[#6f3a2a] font-semibold uppercase tracking-wider text-[10px]">
                        Proveedores nuevos ({resumen.proveedores_nuevos.length})
                      </div>
                      <div className="text-[#391511] mt-1">
                        {resumen.proveedores_nuevos.slice(0, 6).join(', ')}
                        {resumen.proveedores_nuevos.length > 6 &&
                          ` y ${resumen.proveedores_nuevos.length - 6} más`}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <h3 className="text-[#391511] font-semibold text-sm mb-2">
                Vista previa (primeras 15 filas)
              </h3>
              <div className="rounded-xl border border-[#e4c9b0]/60 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b-[#e4c9b0]/60 bg-[#fdfaf6] hover:bg-[#fdfaf6]">
                      <TableHead className="text-[#391511] font-semibold text-xs">
                        #
                      </TableHead>
                      <TableHead className="text-[#391511] font-semibold text-xs">
                        Producto
                      </TableHead>
                      <TableHead className="text-[#391511] font-semibold text-xs">
                        Cat.
                      </TableHead>
                      <TableHead className="text-right text-[#391511] font-semibold text-xs">
                        Venta
                      </TableHead>
                      <TableHead className="text-right text-[#391511] font-semibold text-xs">
                        Stock
                      </TableHead>
                      <TableHead className="text-center text-[#391511] font-semibold text-xs">
                        Estado
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filas.slice(0, 15).map((f) => (
                      <TableRow
                        key={f.fila_origen}
                        className={cn(
                          'border-b-[#e4c9b0]/40 text-xs',
                          f.saltada && 'opacity-50',
                          f.errores.length > 0 && 'bg-[#c43e2c]/5'
                        )}
                      >
                        <TableCell className="text-[#c8a58a] font-mono">
                          {f.fila_origen}
                        </TableCell>
                        <TableCell className="text-[#391511]">
                          {f.producto}
                        </TableCell>
                        <TableCell className="text-[#6f3a2a]">
                          {f.categoria ?? '—'}
                        </TableCell>
                        <TableCell className="text-right text-[#391511] tabular-nums">
                          <MontoARS monto={f.precio_venta} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[#6f3a2a]">
                          {f.stock_actual}
                        </TableCell>
                        <TableCell className="text-center">
                          {f.saltada ? (
                            <span className="text-[#c8a58a]">Combo</span>
                          ) : f.errores.length > 0 ? (
                            <span
                              className="text-[#c43e2c]"
                              title={f.errores.join('; ')}
                            >
                              Error
                            </span>
                          ) : (
                            <span className="text-[#6f3a2a]">OK</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {filas.length > 15 && (
                <p className="text-[#6f3a2a] text-xs mt-2 text-center">
                  + {filas.length - 15} filas más
                </p>
              )}
            </div>

            <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex gap-2 shrink-0">
              <Button
                variant="outline"
                onClick={() => {
                  setEtapa('subir')
                  setArchivo(null)
                  setFilas([])
                  setResumen(null)
                }}
                disabled={procesando}
                className="flex-1 border-[#e4c9b0] text-[#6f3a2a]"
              >
                Volver
              </Button>
              <Button
                onClick={confirmar}
                disabled={procesando || resumen.validas === 0}
                className="flex-[2] bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
              >
                {procesando ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Importando {resumen.validas} productos…
                  </>
                ) : (
                  `Confirmar e importar ${resumen.validas} productos`
                )}
              </Button>
            </div>
          </>
        )}

        {/* ─── Etapa COMPLETADO ─── */}
        {etapa === 'completado' && resultado && (
          <div className="px-6 py-6 flex-1 overflow-y-auto">
            <div className="text-center mb-5">
              <div className="inline-flex p-3 rounded-full bg-[#f9b44c]/20 mb-2">
                <CheckCircle2 className="h-7 w-7 text-[#6f3a2a]" />
              </div>
              <h3 className="text-[#391511] text-xl font-bold">
                Importación completada
              </h3>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              <Stat
                etiqueta="Creados"
                valor={resultado.productos_creados}
                color="#f9b44c"
                icono={<Plus className="h-3 w-3" />}
              />
              <Stat
                etiqueta="Actualizados"
                valor={resultado.productos_actualizados}
                color="#6f3a2a"
              />
              <Stat
                etiqueta="Categorías"
                valor={resultado.categorias_creadas}
                color="#6f3a2a"
              />
              <Stat
                etiqueta="Proveedores"
                valor={resultado.proveedores_creados}
                color="#6f3a2a"
              />
            </div>

            {resultado.errores.length > 0 && (
              <div className="rounded-xl bg-[#c43e2c]/5 border border-[#c43e2c]/30 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <X className="h-4 w-4 text-[#c43e2c]" />
                  <span className="text-[#9e2f25] font-semibold text-sm">
                    {resultado.errores.length} filas con errores
                  </span>
                </div>
                <ul className="text-xs text-[#6f3a2a] space-y-1 max-h-40 overflow-y-auto">
                  {resultado.errores.slice(0, 10).map((e, i) => (
                    <li key={i}>
                      Fila {e.fila} ({e.producto}): {e.mensaje}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              onClick={() => onCambioAbierto(false)}
              className="mt-5 w-full bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
            >
              Listo
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Stat({
  etiqueta,
  valor,
  color,
  icono,
}: {
  etiqueta: string
  valor: number
  color: string
  icono?: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl border-2 p-3 bg-white"
      style={{ borderColor: `${color}55` }}
    >
      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
        {icono}
        {etiqueta}
      </div>
      <div
        className="text-2xl font-extrabold tabular-nums mt-1"
        style={{ color }}
      >
        {valor}
      </div>
    </div>
  )
}
