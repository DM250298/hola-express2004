'use client'

import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { nombreCompleto } from './constantes'
import { useEmpleados } from '@/lib/hooks/useRrhh'
import { useConfirmarImportReloj, useVincularReloj } from '@/lib/hooks/useAsistencia'
import { previsualizarReloj } from '@/lib/queries/asistencia'
import { cn } from '@/lib/utils'
import type { PreviewReloj, ResumenImportReloj } from '@/lib/queries/asistencia'

interface Props {
  abierto: boolean
  onCambioAbierto: (v: boolean) => void
}

type Etapa = 'subir' | 'preview' | 'completado'

export function ModalImportarReloj({ abierto, onCambioAbierto }: Props) {
  const [etapa, setEtapa] = useState<Etapa>('subir')
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PreviewReloj | null>(null)
  const [resumen, setResumen] = useState<ResumenImportReloj | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: empleados } = useEmpleados()
  const confirmar = useConfirmarImportReloj()
  const vincular = useVincularReloj()

  useEffect(() => {
    if (abierto) {
      setEtapa('subir')
      setLeyendo(false)
      setError(null)
      setPreview(null)
      setResumen(null)
    }
  }, [abierto])

  async function procesar(file: File) {
    setLeyendo(true)
    setError(null)
    try {
      const p = await previsualizarReloj(file)
      setPreview(p)
      setEtapa('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    } finally {
      setLeyendo(false)
    }
  }

  function onElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) procesar(f)
  }

  function vincularFila(relojId: number, empleadoId: number) {
    const emp = (empleados ?? []).find((x) => x.id === empleadoId)
    vincular.mutate(
      { empleadoId, relojId },
      {
        onSuccess: () => {
          setPreview((prev) =>
            prev
              ? {
                  ...prev,
                  filas: prev.filas.map((f) =>
                    f.reloj_id === relojId
                      ? {
                          ...f,
                          empleado_id: empleadoId,
                          nombre_empleado: emp ? nombreCompleto(emp) : 'Vinculado',
                        }
                      : f
                  ),
                  resumen: { ...prev.resumen, sin_match: Math.max(0, prev.resumen.sin_match - 1) },
                }
              : prev
          )
        },
      }
    )
  }

  function onConfirmar() {
    if (!preview) return
    confirmar.mutate(preview, {
      onSuccess: (r) => {
        setResumen(r)
        setEtapa('completado')
      },
    })
  }

  const itemsEmpleado: Record<string, string> = Object.fromEntries(
    (empleados ?? [])
      .filter((e) => e.activo)
      .map((e) => [String(e.id), `${nombreCompleto(e)} (${e.legajo})`])
  )
  const totalImpares = (preview?.filas ?? []).reduce((s, f) => s + f.dias_impares, 0)

  return (
    <Dialog open={abierto} onOpenChange={(v) => !leyendo && !confirmar.isPending && onCambioAbierto(v)}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-[#e4c9b0]/60 bg-[#fdfaf6]">
          <DialogTitle className="text-[#391511] text-lg">Importar reloj biométrico</DialogTitle>
          <DialogDescription className="text-[#6f3a2a]">
            {etapa === 'subir' && 'Subí el archivo .xls que exporta el reloj.'}
            {etapa === 'preview' && 'Revisá las marcaciones detectadas antes de confirmar.'}
            {etapa === 'completado' && 'Resultado de la importación.'}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 max-h-[66vh] overflow-y-auto">
          {/* PASO 1 — SUBIR */}
          {etapa === 'subir' && (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={leyendo}
                className="w-full border-2 border-dashed border-[#e4c9b0] rounded-2xl p-10 flex flex-col items-center gap-3 hover:bg-[#fdfaf6] transition-colors"
              >
                {leyendo ? (
                  <Loader2 className="h-10 w-10 text-[#f9b44c] animate-spin" />
                ) : (
                  <UploadCloud className="h-10 w-10 text-[#c8a58a]" />
                )}
                <span className="text-[#391511] font-semibold">
                  {leyendo ? 'Leyendo el archivo…' : 'Elegí el archivo del reloj'}
                </span>
                <span className="text-[#c8a58a] text-sm">Formato .xls o .xlsx (hoja “Entr”)</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept=".xls,.xlsx"
                className="hidden"
                onChange={onElegir}
              />
              {error && (
                <p className="text-[#c43e2c] text-sm flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}
            </div>
          )}

          {/* PASO 2 — PREVIEW */}
          {etapa === 'preview' && preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="px-2.5 py-1 rounded-lg bg-[#fdfaf6] border border-[#e4c9b0]/60 text-[#6f3a2a]">
                  Período:{' '}
                  <b className="text-[#391511]">
                    {format(parseISO(preview.periodo_desde), 'd/MM', { locale: es })} –{' '}
                    {format(parseISO(preview.periodo_hasta), 'd/MM/yyyy', { locale: es })}
                  </b>
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#fdfaf6] border border-[#e4c9b0]/60 text-[#6f3a2a]">
                  Marcaciones: <b className="text-[#391511]">{preview.resumen.total_marcaciones}</b>
                </span>
                {preview.resumen.sin_match > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-[#c43e2c]/10 text-[#c43e2c] font-medium">
                    {preview.resumen.sin_match} sin vincular
                  </span>
                )}
                {totalImpares > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-[#e0a100]/15 text-[#a06b00] font-medium">
                    {totalImpares} día(s) con marcación impar
                  </span>
                )}
              </div>

              <div className="overflow-x-auto border border-[#e4c9b0]/60 rounded-xl">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#fdfaf6] border-b border-[#e4c9b0]/60">
                      <th className="sticky left-0 bg-[#fdfaf6] text-left px-3 py-2 text-[#391511] font-semibold min-w-[200px] z-10">
                        Empleado (reloj)
                      </th>
                      {preview.dias.map((d) => (
                        <th key={d} className="px-2 py-2 text-center text-[#6f3a2a] font-medium tabular-nums min-w-[64px]">
                          {format(parseISO(d), 'd/MM')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.filas.map((f) => (
                      <tr key={f.reloj_id} className="border-b border-[#e4c9b0]/30 align-top">
                        <td className="sticky left-0 bg-white px-3 py-2 min-w-[200px] z-10">
                          {f.empleado_id ? (
                            <div>
                              <div className="text-[#391511] font-medium">{f.nombre_empleado}</div>
                              <div className="text-[#c8a58a]">
                                reloj #{f.reloj_id} · {f.nombre_reloj}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="text-[#c43e2c] font-medium flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                reloj #{f.reloj_id} · {f.nombre_reloj}
                              </div>
                              <Select
                                items={itemsEmpleado}
                                value=""
                                onValueChange={(v) => v && vincularFila(f.reloj_id, Number(v))}
                                disabled={vincular.isPending}
                              >
                                <SelectTrigger className="h-7 text-xs border-[#e4c9b0]">
                                  <SelectValue placeholder="Vincular a…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {Object.entries(itemsEmpleado).map(([v, l]) => (
                                    <SelectItem key={v} value={v}>
                                      {l}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </td>
                        {preview.dias.map((d) => {
                          const horas = f.por_dia[d]
                          const impar = horas && horas.length % 2 === 1
                          return (
                            <td
                              key={d}
                              className={cn(
                                'px-1.5 py-1.5 text-center tabular-nums',
                                impar && 'bg-[#e0a100]/10'
                              )}
                            >
                              {horas ? (
                                <span className={cn('inline-flex flex-col', impar && 'text-[#a06b00] font-semibold')}>
                                  {horas.map((h, i) => (
                                    <span key={i}>{h}</span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-[#e4c9b0]">·</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[#c8a58a] text-xs">
                Las marcaciones repetidas (si re-subís un archivo) se ignoran solas. Los
                relojes sin vincular no se importan hasta que los asocies a un empleado.
              </p>
            </div>
          )}

          {/* PASO 3 — COMPLETADO */}
          {etapa === 'completado' && resumen && (
            <div className="py-6 text-center space-y-4">
              <div className="inline-flex p-3 rounded-full bg-[#2f7d4f]/15">
                <CheckCircle2 className="h-10 w-10 text-[#2f7d4f]" />
              </div>
              <div>
                <p className="text-[#391511] font-bold text-lg">Importación lista</p>
                <p className="text-[#6f3a2a] text-sm mt-1">
                  {resumen.nuevas} marcaciones nuevas · {resumen.duplicadas} duplicadas ignoradas
                </p>
                <p className="text-[#6f3a2a] text-sm">
                  {resumen.dias_recalculados} día(s) de asistencia recalculados
                  {resumen.sin_match > 0 ? ` · ${resumen.sin_match} reloj(es) sin vincular omitidos` : ''}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-[#e4c9b0]/60 bg-[#fdfaf6] px-6 py-4 flex justify-end gap-2">
          {etapa === 'preview' && (
            <>
              <Button
                variant="outline"
                onClick={() => setEtapa('subir')}
                disabled={confirmar.isPending}
                className="border-[#e4c9b0] text-[#6f3a2a]"
              >
                Volver
              </Button>
              <Button
                onClick={onConfirmar}
                disabled={confirmar.isPending || (preview?.marcaciones.length ?? 0) === 0}
                className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-bold disabled:opacity-50 gap-1.5"
              >
                {confirmar.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importando…
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="h-4 w-4" />
                    Confirmar importación
                  </>
                )}
              </Button>
            </>
          )}
          {etapa !== 'preview' && (
            <Button
              onClick={() => onCambioAbierto(false)}
              className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
            >
              {etapa === 'completado' ? 'Listo' : 'Cerrar'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
