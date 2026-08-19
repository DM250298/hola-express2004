'use client'

import { useMemo, useState } from 'react'
import {
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileText,
  Search,
  XOctagon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResumenVencimientos } from './ResumenVencimientos'
import { CardLote } from './CardLote'
import { ModalNuevoLote } from './ModalNuevoLote'
import { ModalBajaLote } from './ModalBajaLote'
import { ModalSincronizarStock } from './ModalSincronizarStock'
import { useLotesActivos } from '@/lib/hooks/useVencimientos'
import {
  exportarTablaExcel,
  exportarTablaPDF,
  type ColumnaExport,
} from '@/lib/utils/exportarTabla'
import {
  formatearCantidad,
  formatearFechaCorta,
  formatearNumero,
} from '@/lib/utils/formato'
import type { LoteConProducto } from '@/lib/queries/vencimientos'

const ESTADO_LOTE_LABEL: Record<string, string> = {
  vencido: 'Vencido',
  rojo: 'Próximo (<3 días)',
  amarillo: 'Atención (3-7 días)',
  verde: 'OK',
}

export function PantallaVencimientos() {
  const { data: lotes, isLoading, isError } = useLotesActivos()
  const [modalNuevoAbierto, setModalNuevoAbierto] = useState(false)
  const [modalSincAbierto, setModalSincAbierto] = useState(false)
  const [loteBaja, setLoteBaja] = useState<LoteConProducto | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const agrupados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const vencidos: LoteConProducto[] = []
    const proximos: LoteConProducto[] = []
    const atencion: LoteConProducto[] = []
    const ok: LoteConProducto[] = []
    for (const l of lotes ?? []) {
      if (q) {
        const nombre = l.producto.nombre.toLowerCase()
        const cod = (l.producto.codigo_barras ?? '').toLowerCase()
        if (!nombre.includes(q) && !cod.includes(q)) continue
      }
      if (l.clase === 'vencido') vencidos.push(l)
      else if (l.clase === 'rojo') proximos.push(l)
      else if (l.clase === 'amarillo') atencion.push(l)
      else ok.push(l)
    }
    return { vencidos, proximos, atencion, ok }
  }, [lotes, busqueda])

  // Exporta TODOS los lotes filtrados por la búsqueda, en orden de urgencia
  // (vencidos → próximos → atención → OK), con su estado como columna.
  async function exportar(tipo: 'excel' | 'pdf') {
    const todos = [
      ...agrupados.vencidos,
      ...agrupados.proximos,
      ...agrupados.atencion,
      ...agrupados.ok,
    ]
    if (todos.length === 0) return

    const columnas: ColumnaExport[] = [
      { titulo: '#', wch: 5, pdfAncho: 9, align: 'right' },
      { titulo: 'Producto', wch: 42, pdfAncho: 62 },
      { titulo: 'Código', wch: 16, pdfAncho: 26 },
      { titulo: 'Vencimiento', wch: 13, pdfAncho: 24, align: 'center' },
      { titulo: 'Días', wch: 7, pdfAncho: 14, align: 'right' },
      { titulo: 'Cantidad', wch: 10, pdfAncho: 18, align: 'right' },
      { titulo: 'Estado', wch: 18, pdfAncho: 28 },
    ]

    const filas = todos.map((l, i) => [
      i + 1,
      l.producto.nombre,
      l.producto.codigo_barras ?? '',
      l.fecha_vencimiento,
      l.dias_restantes,
      l.cantidad_actual,
      ESTADO_LOTE_LABEL[l.clase] ?? l.clase,
    ])

    const filasPdf = todos.map((l, i) => [
      i + 1,
      l.producto.nombre,
      l.producto.codigo_barras ?? '—',
      formatearFechaCorta(l.fecha_vencimiento),
      l.dias_restantes,
      formatearCantidad(l.cantidad_actual, l.producto.venta_por_peso),
      ESTADO_LOTE_LABEL[l.clase] ?? l.clase,
    ])

    const opciones = {
      titulo: 'Control de vencimientos',
      subtitulo: busqueda.trim()
        ? `Lotes activos · búsqueda: «${busqueda.trim()}»`
        : 'Lotes activos por urgencia',
      archivo: 'vencimientos',
      columnas,
      filas,
      filasPdf,
      kpis: [
        { etiqueta: 'Vencidos', valor: formatearNumero(agrupados.vencidos.length) },
        { etiqueta: 'Próximos (<3 d)', valor: formatearNumero(agrupados.proximos.length) },
        { etiqueta: 'Atención (3-7 d)', valor: formatearNumero(agrupados.atencion.length) },
        { etiqueta: 'OK', valor: formatearNumero(agrupados.ok.length) },
      ],
    }

    try {
      if (tipo === 'excel') await exportarTablaExcel(opciones)
      else await exportarTablaPDF(opciones)
    } catch {
      toast.error(`No se pudo generar el ${tipo === 'excel' ? 'Excel' : 'PDF'}.`)
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">
            Control de vencimientos
          </h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Lotes activos con sus fechas de vencimiento.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => setModalSincAbierto(true)}
            title="Crear lotes para el stock que no tiene lote asociado"
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5"
          >
            <Database className="h-4 w-4" />
            Sincronizar stock inicial
          </Button>
          <Button
            onClick={() => setModalNuevoAbierto(true)}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <CalendarPlus className="h-4 w-4" />
            Ingresar lote
          </Button>
        </div>
      </header>

      <ResumenVencimientos />

      {/* Buscador + exportación */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
          <Input
            placeholder="Buscar por nombre o código…"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportar('excel')}
          disabled={isLoading || !lotes || lotes.length === 0}
          className="h-9 border-[#e4c9b0] text-[#6f3a2a] gap-1.5 disabled:opacity-40"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportar('pdf')}
          disabled={isLoading || !lotes || lotes.length === 0}
          className="h-9 border-[#e4c9b0] text-[#6f3a2a] gap-1.5 disabled:opacity-40"
        >
          <FileText className="h-3.5 w-3.5" />
          PDF
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="proximos" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="vencidos"
            className="gap-1.5 data-active:bg-[#391511]/10 data-active:text-[#391511] data-active:shadow-sm"
          >
            <XOctagon className="h-3.5 w-3.5 text-[#391511]" />
            Vencidos
            {agrupados.vencidos.length > 0 && (
              <span className="ml-1 text-[10px] font-bold bg-[#391511]/15 text-[#391511] rounded-full px-1.5 py-0.5 tabular-nums">
                {agrupados.vencidos.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="proximos"
            className="gap-1.5 data-active:bg-[#c43e2c]/10 data-active:text-[#c43e2c] data-active:shadow-sm"
          >
            <span className="h-2 w-2 rounded-full bg-[#c43e2c]" />
            Próximos a vencer
            {agrupados.proximos.length > 0 && (
              <span className="ml-1 text-[10px] font-bold bg-[#c43e2c]/20 text-[#9e2f25] rounded-full px-1.5 py-0.5 tabular-nums">
                {agrupados.proximos.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="atencion"
            className="gap-1.5 data-active:bg-[#e4a42a]/15 data-active:text-[#6f3a2a] data-active:shadow-sm"
          >
            <span className="h-2 w-2 rounded-full bg-[#e4a42a]" />
            Atención
            {agrupados.atencion.length > 0 && (
              <span className="ml-1 text-[10px] font-bold bg-[#e4a42a]/25 text-[#6f3a2a] rounded-full px-1.5 py-0.5 tabular-nums">
                {agrupados.atencion.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="ok"
            className="gap-1.5 data-active:bg-[#f9b44c]/15 data-active:text-[#6f3a2a] data-active:shadow-sm"
          >
            <span className="h-2 w-2 rounded-full bg-[#6f3a2a]" />
            OK
            {agrupados.ok.length > 0 && (
              <span className="ml-1 text-[10px] font-bold bg-[#f9b44c]/25 text-[#6f3a2a] rounded-full px-1.5 py-0.5 tabular-nums">
                {agrupados.ok.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-40 rounded-2xl bg-[#f9d2a2]/30"
              />
            ))}
          </div>
        ) : isError ? (
          <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center text-[#c43e2c] text-sm">
            No se pudo cargar la lista de lotes.
          </div>
        ) : (
          <>
            <TabsContent value="vencidos">
              <GridLotes
                lotes={agrupados.vencidos}
                vacio={
                  <Vacio
                    icono={CheckCircle2}
                    titulo="Nada vencido"
                    descripcion="No hay lotes con fecha de vencimiento pasada."
                  />
                }
                onDarDeBaja={setLoteBaja}
              />
            </TabsContent>
            <TabsContent value="proximos">
              <GridLotes
                lotes={agrupados.proximos}
                vacio={
                  <Vacio
                    icono={CheckCircle2}
                    titulo="Sin urgencias"
                    descripcion="No hay lotes próximos a vencer en menos de 3 días."
                  />
                }
                onDarDeBaja={setLoteBaja}
              />
            </TabsContent>
            <TabsContent value="atencion">
              <GridLotes
                lotes={agrupados.atencion}
                vacio={
                  <Vacio
                    icono={CheckCircle2}
                    titulo="Todo tranquilo"
                    descripcion="Ningún lote en la franja de 3 a 7 días."
                  />
                }
                onDarDeBaja={setLoteBaja}
              />
            </TabsContent>
            <TabsContent value="ok">
              <GridLotes
                lotes={agrupados.ok}
                vacio={
                  <Vacio
                    icono={CalendarCheck}
                    titulo="Sin lotes con vencimiento lejano"
                    descripcion="Ingresá lotes para verlos acá."
                  />
                }
                onDarDeBaja={setLoteBaja}
              />
            </TabsContent>
          </>
        )}
      </Tabs>

      <ModalNuevoLote
        abierto={modalNuevoAbierto}
        onCambioAbierto={setModalNuevoAbierto}
      />
      <ModalBajaLote
        abierto={loteBaja !== null}
        onCambioAbierto={(v) => !v && setLoteBaja(null)}
        lote={loteBaja}
      />
      <ModalSincronizarStock
        abierto={modalSincAbierto}
        onCambioAbierto={setModalSincAbierto}
      />
    </div>
  )
}

function GridLotes({
  lotes,
  vacio,
  onDarDeBaja,
}: {
  lotes: LoteConProducto[]
  vacio: React.ReactNode
  onDarDeBaja: (l: LoteConProducto) => void
}) {
  if (lotes.length === 0) return <>{vacio}</>
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {lotes.map((l) => (
        <CardLote key={l.id} lote={l} onDarDeBaja={onDarDeBaja} />
      ))}
    </div>
  )
}

function Vacio({
  icono: Icono,
  titulo,
  descripcion,
}: {
  icono: React.ElementType
  titulo: string
  descripcion: string
}) {
  return (
    <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-10 text-center">
      <div className="inline-flex p-3 rounded-full bg-[#f9d2a2]/40 mb-3">
        <Icono className="h-6 w-6 text-[#6f3a2a]" />
      </div>
      <p className="text-[#391511] font-semibold">{titulo}</p>
      <p className="text-[#6f3a2a] text-sm mt-1">{descripcion}</p>
    </div>
  )
}
