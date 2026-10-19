'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, Calendar } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { usePestanaUrl } from '@/lib/hooks/usePestanaUrl'
import { TabTableroDirectivo } from './TabTableroDirectivo'
import { TabFlujoProyectado } from './TabFlujoProyectado'
import { TabImpuestos } from './TabImpuestos'
import { TabEgresos } from './TabEgresos'
import { TabCuentas } from './TabCuentas'
import { TabMovimientos } from './TabMovimientos'
import { TabCajaFuerte } from './TabCajaFuerte'
import { TabPorCobrar } from './TabPorCobrar'
import { TabFiado } from './TabFiado'
import {
  rangoDesdeFechas,
  rangoPredefinido,
  type ClavePeriodo,
} from '@/lib/utils/periodos'

const HREF_PORTAL_FACTURAS = '/compras/facturas'

interface EnlaceGrupo {
  href: string
  label: string
  /** Dónde vive la pantalla (se muestra como ayuda al pasar el mouse). */
  donde: string
  permiso: string
}

const GRUPOS: {
  titulo: string
  tabs: { value: string; label: string }[]
  /** Pantallas de otra área que se abren desde este grupo (no son pestañas). */
  enlaces?: EnlaceGrupo[]
}[] = [
  { titulo: 'Mi negocio', tabs: [{ value: 'tablero', label: 'Tablero' }] },
  {
    titulo: 'Plata que entra y sale',
    tabs: [
      { value: 'caja_fuerte', label: 'Caja fuerte' },
      { value: 'por_cobrar', label: 'Por cobrar' },
      { value: 'fiado', label: 'Fiado' },
      { value: 'cuentas_bancarias', label: 'Cuentas' },
      { value: 'movimientos', label: 'Movimientos' },
      { value: 'egresos', label: 'Egresos' },
    ],
  },
  {
    titulo: 'Lo que debo e impuestos',
    tabs: [
      { value: 'impuestos', label: 'Impuestos' },
      { value: 'flujo', label: 'Flujo proyectado' },
    ],
    // Las facturas y las cuentas a pagar viven en el portal único de
    // Compras › Facturas de proveedores (oct-2026); desde acá se enlazan.
    // D2: los sueldos se liquidan en Operaciones; desde acá solo se enlazan.
    enlaces: [
      {
        href: HREF_PORTAL_FACTURAS,
        label: 'Facturas de proveedores',
        donde: 'Compras › Facturas de proveedores',
        permiso: 'finanzas',
      },
      {
        href: `${HREF_PORTAL_FACTURAS}?estado=a_pagar`,
        label: 'Cuentas a pagar',
        donde: 'Compras › Facturas de proveedores',
        permiso: 'finanzas',
      },
      {
        href: '/rrhh?tab=sueldos',
        label: 'Sueldos',
        donde: 'Operaciones › Turnos y equipo › Sueldos',
        permiso: 'rrhh_sueldos',
      },
    ],
  },
]

const TABS_VALIDAS = GRUPOS.flatMap((g) => g.tabs.map((t) => t.value))

/**
 * Pestañas que se mudaron al portal de facturas: un enlace viejo
 * (`?tab=comprobantes`, `?tab=cuentas_pagar`) o una tarjeta del Tablero que
 * pida esa pestaña redirige allá con el filtro equivalente.
 */
const REDIRECCION_PORTAL: Record<string, string> = {
  comprobantes: HREF_PORTAL_FACTURAS,
  cuentas_pagar: `${HREF_PORTAL_FACTURAS}?estado=a_pagar`,
}

interface Props {
  /** Permisos del usuario (los resuelve el server en page.tsx). */
  permisos: string[]
  /** Pestaña inicial (viene de ?tab= en la URL). */
  tabInicial?: string
}

function isoLocalAHoy(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function inicioMesIso(): string {
  const d = new Date()
  d.setDate(1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// Etiquetas del selector de período (Base UI las usa para el trigger).
const ITEMS_PERIODO_FIN: Record<string, string> = {
  mes_actual: 'Este mes',
  mes_anterior: 'Mes anterior',
  ultimos_7: 'Últimos 7 días',
  personalizado: 'Personalizado',
}

export function PantallaFinanzas({ permisos, tabInicial }: Props) {
  const [periodo, setPeriodo] = useState<ClavePeriodo>('mes_actual')
  const [desdePersonalizado, setDesdePersonalizado] =
    useState<string>(inicioMesIso())
  const [hastaPersonalizado, setHastaPersonalizado] =
    useState<string>(isoLocalAHoy())
  const [tab, setTab] = usePestanaUrl(TABS_VALIDAS, 'tablero', tabInicial)
  const router = useRouter()

  // ?tab=comprobantes / ?tab=cuentas_pagar → portal de facturas.
  useEffect(() => {
    const destino = tabInicial ? REDIRECCION_PORTAL[tabInicial] : undefined
    if (destino) router.replace(destino)
  }, [tabInicial, router])
  // Cuenta por la que se filtran los Movimientos al llegar desde una card.
  const [cuentaMovs, setCuentaMovs] = useState<number | null>(null)

  const rango = useMemo(() => {
    if (periodo === 'personalizado') {
      return rangoDesdeFechas(desdePersonalizado, hastaPersonalizado)
    }
    return rangoPredefinido(periodo)
  }, [periodo, desdePersonalizado, hastaPersonalizado])

  // Navegación normal por la barra: sin filtro de cuenta pre-aplicado.
  function irATab(value: string) {
    const destino = REDIRECCION_PORTAL[value]
    if (destino) {
      router.push(destino)
      return
    }
    setCuentaMovs(null)
    setTab(value)
  }
  // Desde una cuenta: abre Movimientos ya filtrado por esa cuenta.
  function verMovimientosDeCuenta(cuentaId: number) {
    setCuentaMovs(cuentaId)
    setTab('movimientos')
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[#391511] text-2xl font-bold">Finanzas</h1>
          <p className="text-[#6f3a2a] text-sm mt-1">
            P&L del período, cuentas a pagar y egresos operativos.
          </p>
        </div>

        {/* Selector de período */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
              Período
            </Label>
            <Select
              items={ITEMS_PERIODO_FIN}
              value={periodo}
              onValueChange={(v) =>
                setPeriodo((v ?? 'mes_actual') as ClavePeriodo)
              }
            >
              <SelectTrigger className="w-[180px] border-[#e4c9b0] focus:ring-[#f9b44c] bg-white">
                <Calendar className="h-3.5 w-3.5 text-[#c8a58a] mr-1.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mes_actual">Este mes</SelectItem>
                <SelectItem value="mes_anterior">Mes anterior</SelectItem>
                <SelectItem value="ultimos_7">Últimos 7 días</SelectItem>
                <SelectItem value="personalizado">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {periodo === 'personalizado' && (
            <>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Desde
                </Label>
                <Input
                  type="date"
                  value={desdePersonalizado}
                  max={hastaPersonalizado}
                  onChange={(e) => setDesdePersonalizado(e.target.value)}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums bg-white"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold">
                  Hasta
                </Label>
                <Input
                  type="date"
                  value={hastaPersonalizado}
                  min={desdePersonalizado}
                  max={isoLocalAHoy()}
                  onChange={(e) => setHastaPersonalizado(e.target.value)}
                  className="border-[#e4c9b0] focus-visible:ring-[#f9b44c] tabular-nums bg-white"
                />
              </div>
            </>
          )}
        </div>
      </header>

      <div className="space-y-4">
        {/* Barra de tabs agrupada (botones propios, no el TabsList de base-ui) */}
        <div className="rounded-lg border border-[#e4c9b0]/60 bg-white p-2 space-y-2">
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="space-y-1">
              <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-[#c8a58a]">
                {g.titulo}
              </div>
              <div className="flex flex-wrap gap-1">
                {g.tabs.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => irATab(t.value)}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
                      tab === t.value
                        ? 'bg-[#f9b44c]/20 text-[#391511] shadow-sm'
                        : 'text-[#6f3a2a] hover:bg-[#f9d2a2]/40 hover:text-[#391511]'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
                {g.enlaces
                  ?.filter((e) => permisos.includes(e.permiso))
                  .map((e) => (
                    <Link
                      key={e.href}
                      href={e.href}
                      title={`Se abre en ${e.donde}`}
                      className="inline-flex items-center gap-1 rounded-md border border-dashed border-[#e4c9b0] px-2.5 py-1 text-sm font-medium text-[#6f3a2a] transition-colors hover:bg-[#f9d2a2]/40 hover:text-[#391511]"
                    >
                      {e.label}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  ))}
              </div>
            </div>
          ))}
        </div>

        {/* Panel activo */}
        {tab === 'tablero' && (
          <TabTableroDirectivo
            desde={rango.desde}
            hasta={rango.hasta}
            navegar={irATab}
          />
        )}
        {tab === 'flujo' && <TabFlujoProyectado />}
        {tab === 'impuestos' && (
          <TabImpuestos desde={rango.desde} hasta={rango.hasta} />
        )}
        {tab === 'caja_fuerte' && <TabCajaFuerte />}
        {tab === 'por_cobrar' && <TabPorCobrar />}
        {tab === 'fiado' && <TabFiado />}
        {tab === 'cuentas_bancarias' && (
          <TabCuentas onVerMovimientos={verMovimientosDeCuenta} />
        )}
        {tab === 'movimientos' && (
          <TabMovimientos
            desde={rango.desde}
            hasta={rango.hasta}
            cuentaInicial={cuentaMovs}
          />
        )}
        {tab === 'egresos' && (
          <TabEgresos desde={rango.desde} hasta={rango.hasta} />
        )}
      </div>
    </div>
  )
}