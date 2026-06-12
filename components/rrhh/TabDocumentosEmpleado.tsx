'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Download, FileText, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkeletonTabla } from '@/components/shared/SkeletonTabla'
import { ModalDocumento } from './ModalDocumento'
import { TIPOS_DOCUMENTO, fechaCortaLocal } from './constantes'
import { useDocumentos, useEliminarDocumento } from '@/lib/hooks/useRrhh'
import { urlFirmadaDocumento } from '@/lib/queries/rrhh'
import { formatearFechaCorta } from '@/lib/utils/formato'
import { cn } from '@/lib/utils'
import type { EmpleadoDocumentoRow } from '@/types/database'

interface Props {
  empleadoId: number
}

/** Estado de vencimiento de un documento (verde/amarillo/rojo). */
function estadoVencimiento(fecha: string | null): {
  texto: string
  clase: string
} | null {
  if (!fecha) return null
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const venc = new Date(`${fecha}T00:00:00`)
  const dias = Math.round((venc.getTime() - hoy.getTime()) / 86_400_000)
  if (dias < 0) return { texto: 'Vencido', clase: 'bg-[#c43e2c]/15 text-[#c43e2c]' }
  if (dias <= 30)
    return { texto: `Vence en ${dias}d`, clase: 'bg-[#e0a100]/15 text-[#a06b00]' }
  return { texto: 'Vigente', clase: 'bg-[#2f7d4f]/15 text-[#2f7d4f]' }
}

export function TabDocumentosEmpleado({ empleadoId }: Props) {
  const { data: docs, isLoading, isError } = useDocumentos(empleadoId)
  const eliminar = useEliminarDocumento(empleadoId)
  const [modalAbierto, setModalAbierto] = useState(false)

  async function verDocumento(path: string) {
    try {
      const url = await urlFirmadaDocumento(path)
      window.open(url, '_blank', 'noopener')
    } catch {
      toast.error('No se pudo abrir el documento.')
    }
  }

  function handleEliminar(doc: EmpleadoDocumentoRow) {
    if (!confirm(`¿Eliminar el documento "${doc.nombre_archivo ?? doc.tipo}"?`))
      return
    eliminar.mutate({ id: doc.id, archivo_url: doc.archivo_url })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[#6f3a2a] text-sm">
          DNI, CUIL, contrato, apto médico y certificados. Archivos privados.
        </p>
        <Button
          onClick={() => setModalAbierto(true)}
          className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Subir documento
        </Button>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="p-6">
            <SkeletonTabla filas={3} columnas={4} />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-[#c43e2c] text-sm">
            No se pudieron cargar los documentos.
          </div>
        ) : !docs || docs.length === 0 ? (
          <div className="p-12 text-center">
            <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
              <FileText className="h-6 w-6 text-[#6f3a2a]" />
            </div>
            <p className="text-[#391511] font-semibold">Sin documentos cargados</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#e4c9b0]/40">
            {docs.map((doc) => {
              const venc = estadoVencimiento(doc.fecha_vencimiento)
              return (
                <li
                  key={doc.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[#fdfaf6]"
                >
                  <div className="inline-flex p-2 rounded-lg bg-[#f9d2a2]/30 shrink-0">
                    <FileText className="h-4 w-4 text-[#6f3a2a]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[#391511] text-sm font-medium truncate">
                      <span className="font-semibold">
                        {TIPOS_DOCUMENTO[doc.tipo]}
                      </span>
                      {doc.nombre_archivo ? ` · ${doc.nombre_archivo}` : ''}
                    </p>
                    <p className="text-[#c8a58a] text-xs">
                      Subido el {formatearFechaCorta(doc.created_at)}
                      {doc.fecha_vencimiento
                        ? ` · vence ${fechaCortaLocal(doc.fecha_vencimiento)}`
                        : ''}
                    </p>
                  </div>
                  {venc && (
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full shrink-0',
                        venc.clase
                      )}
                    >
                      {venc.texto}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => verDocumento(doc.archivo_url)}
                    className="h-8 w-8 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                    aria-label="Ver / descargar"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEliminar(doc)}
                    disabled={eliminar.isPending}
                    className="h-8 w-8 p-0 text-[#c8a58a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c]"
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ModalDocumento
        abierto={modalAbierto}
        onCambioAbierto={setModalAbierto}
        empleadoId={empleadoId}
      />
    </div>
  )
}
