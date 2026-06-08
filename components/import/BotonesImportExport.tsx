'use client'

import { useState } from 'react'
import { Download, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ModalImportar } from './ModalImportar'
import { exportarEntidadSimple, exportarProductos } from '@/lib/import/exportar'
import { useUsuario } from '@/lib/hooks/useUsuario'
import { tienePermiso } from '@/lib/permisos'
import type { DefinicionEntidad } from '@/lib/import/tipos'

interface Props {
  def: DefinicionEntidad
  /** Tamaño de los botones (default sm para headers compactos). */
  size?: 'sm' | 'default'
}

export function BotonesImportExport({ def, size = 'sm' }: Props) {
  const { data: usuario } = useUsuario()
  const [modal, setModal] = useState(false)
  const [exportando, setExportando] = useState(false)

  const puedeImportar = tienePermiso(usuario?.permisos, def.permisoImport)
  const puedeExportar = tienePermiso(usuario?.permisos, def.permisoExport)
  const puedeCosto = tienePermiso(usuario?.permisos, 'costos')

  if (!puedeImportar && !puedeExportar) return null

  async function exportar() {
    setExportando(true)
    try {
      if (def.clave === 'productos') await exportarProductos(puedeCosto)
      else await exportarEntidadSimple(def)
    } catch (e) {
      toast.error(
        `No se pudo exportar: ${e instanceof Error ? e.message : 'error desconocido'}`
      )
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <div className="flex gap-2">
        {puedeExportar && (
          <Button
            variant="outline"
            size={size}
            onClick={exportar}
            disabled={exportando}
            className="gap-1.5 border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
          >
            {exportando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Exportar
          </Button>
        )}
        {puedeImportar && (
          <Button
            size={size}
            onClick={() => setModal(true)}
            className="gap-1.5 bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold"
          >
            <Upload className="h-3.5 w-3.5" />
            Importar
          </Button>
        )}
      </div>
      {puedeImportar && (
        <ModalImportar abierto={modal} onCambioAbierto={setModal} def={def} />
      )}
    </>
  )
}
