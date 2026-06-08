'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
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
import { leerArchivo } from '@/lib/import/motor'
import { useEjecutarImport, useResumenImport } from '@/lib/hooks/useImportador'
import type {
  DefinicionEntidad,
  FilaProcesadaGen,
  ResultadoImport,
  ResumenImport,
} from '@/lib/import/tipos'
import { cn } from '@/lib/utils'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
  def: DefinicionEntidad
}

type Etapa = 'subir' | 'preview' | 'completado'

export function ModalImportar({ abierto, onCambioAbierto, def }: Props) {
  const [etapa, setEtapa] = useState<Etapa>('subir')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [filas, setFilas] = useState<FilaProcesadaGen[]>([])
  const [errorParseo, setErrorParseo] = useState<string | null>(null)
  const [resumen, setResumen] = useState<ResumenImport | null>(null)
  const [resultado, setResultado] = useState<ResultadoImport | null>(null)
  const [arrastrando, setArrastrando] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const refInput = useRef<HTMLInputElement | null>(null)

  const calcular = useResumenImport()
  const ejecutar = useEjecutarImport()

  const campoClave = def.claveUnica.campo
  const campoNombre = def.requeridasHeader[0]

  useEffect(() => {
    if (!abierto) {
      setEtapa('subir')
      setArchivo(null)
      setFilas([])
      setErrorParseo(null)
      setResumen(null)
      setResultado(null)
      setArrastrando(false)
      setLeyendo(false)
    }
  }, [abierto])

  async function procesarArchivo(file: File) {
    setArchivo(file)
    setErrorParseo(null)
    setLeyendo(true)
    try {
      const { filas: procesadas, error } = await leerArchivo(file, def)
      if (error) {
        setErrorParseo(error)
        return
      }
      if (procesadas.length === 0) {
        setErrorParseo('No se encontraron filas con datos.')
        return
      }
      setFilas(procesadas)
      const r = await calcular.mutateAsync({ filas: procesadas, def })
      setResumen(r)
      setEtapa('preview')
    } catch (e) {
      setErrorParseo(e instanceof Error ? e.message : 'Error al leer el archivo.')
    } finally {
      setLeyendo(false)
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

  async function confirmar() {
    const res = await ejecutar.mutateAsync({ filas, def })
    setResultado(res)
    setEtapa('completado')
  }

  const procesando = ejecutar.isPending

  return (
    <Dialog open={abierto} onOpenChange={(v) => !procesando && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6] shrink-0">
          <DialogTitle className="text-[#391511] text-lg flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-[#f9b44c]" />
            Importar {def.etiqueta.toLowerCase()} desde Excel
          </DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {def.descripcion}
          </DialogDescription>
        </DialogHeader>

        {/* SUBIR */}
        {etapa === 'subir' && (
          <div className="px-6 py-6 flex-1 overflow-y-auto">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setArrastrando(true)
              }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => {
                e.preventDefault()
                setArrastrando(false)
                handleArchivo(e.dataTransfer.files[0] ?? null)
              }}
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
              {leyendo ? (
                <>
                  <Loader2 className="h-10 w-10 mx-auto mb-3 text-[#f9b44c] animate-spin" />
                  <p className="text-[#391511] font-semibold">Procesando {archivo?.name}…</p>
                </>
              ) : (
                <>
                  <div className="inline-flex p-3 rounded-full bg-[#f9b44c]/15 mb-3">
                    <Upload className="h-6 w-6 text-[#f9b44c]" />
                  </div>
                  <p className="text-[#391511] font-semibold">Arrastrá un archivo Excel acá</p>
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
              <p className="text-[#391511] font-semibold text-sm mb-2">💡 Cómo funciona</p>
              <ul className="text-[#6f3a2a] text-xs space-y-1 list-disc pl-4">
                <li>
                  Se lee el <strong>encabezado</strong> y se detectan las columnas
                  automáticamente (tolera mayúsculas, acentos y nombres alternativos).
                </li>
                <li>
                  Cada fila se identifica por <span className="font-mono">{campoClave}</span>:
                  si ya existe se <strong>actualiza</strong>, si no se <strong>crea</strong>.
                </li>
                <li>Las columnas que no vengan conservan el valor que ya tenían.</li>
              </ul>
            </div>
          </div>
        )}

        {/* PREVIEW */}
        {etapa === 'preview' && resumen && (
          <>
            <div className="px-6 py-4 border-b border-[#e4c9b0]/60 bg-white shrink-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Stat etiqueta="A crear" valor={resumen.a_crear} color="#f9b44c" />
                <Stat etiqueta="A actualizar" valor={resumen.a_actualizar} color="#6f3a2a" />
                <Stat
                  etiqueta="Duplicados"
                  valor={resumen.duplicados_archivo.length}
                  color={resumen.duplicados_archivo.length > 0 ? '#e4a42a' : '#6f3a2a'}
                />
                <Stat
                  etiqueta="Con errores"
                  valor={resumen.con_errores}
                  color={resumen.con_errores > 0 ? '#c43e2c' : '#6f3a2a'}
                />
              </div>
              {resumen.duplicados_archivo.length > 0 && (
                <p className="mt-3 text-xs text-[#9e2f25] bg-[#c43e2c]/5 rounded-lg px-3 py-2">
                  Hay {resumen.duplicados_archivo.length} {campoClave} repetidos en el
                  archivo (gana la última fila): {resumen.duplicados_archivo.slice(0, 8).join(', ')}
                  {resumen.duplicados_archivo.length > 8 ? '…' : ''}
                </p>
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
                      <TableHead className="text-[#391511] font-semibold text-xs">#</TableHead>
                      <TableHead className="text-[#391511] font-semibold text-xs">
                        {campoClave}
                      </TableHead>
                      <TableHead className="text-[#391511] font-semibold text-xs">
                        {campoNombre}
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
                          f.errores.length > 0 && 'bg-[#c43e2c]/5'
                        )}
                      >
                        <TableCell className="text-[#c8a58a] font-mono">{f.fila_origen}</TableCell>
                        <TableCell className="text-[#391511] font-mono">
                          {String(f.datos[campoClave] ?? '—')}
                        </TableCell>
                        <TableCell className="text-[#391511]">
                          {String(f.datos[campoNombre] ?? '—')}
                        </TableCell>
                        <TableCell className="text-center">
                          {f.errores.length > 0 ? (
                            <span className="text-[#c43e2c]" title={f.errores.join('; ')}>
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
                    Importando {resumen.validas}…
                  </>
                ) : (
                  `Confirmar e importar ${resumen.validas}`
                )}
              </Button>
            </div>
          </>
        )}

        {/* COMPLETADO */}
        {etapa === 'completado' && resultado && (
          <div className="px-6 py-6 flex-1 overflow-y-auto">
            <div className="text-center mb-5">
              <div className="inline-flex p-3 rounded-full bg-[#f9b44c]/20 mb-2">
                <CheckCircle2 className="h-7 w-7 text-[#6f3a2a]" />
              </div>
              <h3 className="text-[#391511] text-xl font-bold">Importación completada</h3>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-4">
              <Stat etiqueta="Creados" valor={resultado.creados} color="#f9b44c" />
              <Stat etiqueta="Actualizados" valor={resultado.actualizados} color="#6f3a2a" />
              <Stat
                etiqueta="Errores"
                valor={resultado.errores.length}
                color={resultado.errores.length > 0 ? '#c43e2c' : '#6f3a2a'}
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
                      Fila {e.fila} ({e.codigo}): {e.mensaje}
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

function Stat({ etiqueta, valor, color }: { etiqueta: string; valor: number; color: string }) {
  return (
    <div className="rounded-xl border-2 p-3 bg-white" style={{ borderColor: `${color}55` }}>
      <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
        {etiqueta}
      </div>
      <div className="text-2xl font-extrabold tabular-nums mt-1" style={{ color }}>
        {valor}
      </div>
    </div>
  )
}
