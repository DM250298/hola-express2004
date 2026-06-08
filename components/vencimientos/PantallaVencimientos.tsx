'use client'

import { useMemo, useState } from 'react'
import {
  CalendarCheck,
  CalendarPlus,
  CheckCircle2,
  Database,
  Search,
  XOctagon,
} from 'lucide-react'
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
import type { LoteConProducto } from '@/lib/queries/vencimientos'

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

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
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

      {/* Buscador */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#c8a58a]" />
        <Input
          placeholder="Buscar por nombre o código…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="pl-9 border-[#e4c9b0] focus-visible:ring-[#f9b44c] bg-white"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="proximos" className="space-y-4">
        <TabsList className="bg-white border border-[#e4c9b0]/60 p-1 h-auto flex-wrap">
          <TabsTrigger
            value="vencidos"
            className="gap-1.5 data-[state=active]:bg-[#391511]/10 data-[state=active]:text-[#391511] data-[state=active]:shadow-sm"
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
            className="gap-1.5 data-[state=active]:bg-[#c43e2c]/10 data-[state=active]:text-[#c43e2c] data-[state=active]:shadow-sm"
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
            className="gap-1.5 data-[state=active]:bg-[#e4a42a]/15 data-[state=active]:text-[#6f3a2a] data-[state=active]:shadow-sm"
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
            className="gap-1.5 data-[state=active]:bg-[#f9b44c]/15 data-[state=active]:text-[#6f3a2a] data-[state=active]:shadow-sm"
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
