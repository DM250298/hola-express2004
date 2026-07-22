'use client'

import { useState } from 'react'
import {
  ArrowRight,
  Banknote,
  Building2,
  Pencil,
  Plus,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MontoARS } from '@/components/shared/MontoARS'
import { AyudaContextual } from '@/components/shared/AyudaContextual'
import { DrawerCuenta } from './DrawerCuenta'
import { ModalNuevoMovimiento } from './ModalNuevoMovimiento'
import { ConfiguracionCobros } from './ConfiguracionCobros'
import { useCuentas } from '@/lib/hooks/useCuentas'
import { cn } from '@/lib/utils'
import type { CuentaRow, TipoCuenta } from '@/types/database'

const ICONOS_TIPO: Record<TipoCuenta, React.ElementType> = {
  caja: Banknote,
  banco: Building2,
  billetera_virtual: Smartphone,
}

const ETIQUETAS_TIPO: Record<TipoCuenta, string> = {
  caja: 'Caja',
  banco: 'Banco',
  billetera_virtual: 'Billetera virtual',
}

interface Props {
  /** Abre la pestaña Movimientos filtrada por esta cuenta. */
  onVerMovimientos?: (cuentaId: number) => void
}

export function TabCuentas({ onVerMovimientos }: Props) {
  const { data: cuentas, isLoading, isError } = useCuentas(false)
  const [drawerAbierto, setDrawerAbierto] = useState(false)
  const [cuentaEditar, setCuentaEditar] = useState<CuentaRow | null>(null)

  const [modalMovAbierto, setModalMovAbierto] = useState(false)
  const [modoMov, setModoMov] = useState<'ingreso' | 'egreso' | 'transferencia'>(
    'ingreso'
  )
  const [cuentaParaMov, setCuentaParaMov] = useState<number | null>(null)

  function abrirNueva() {
    setCuentaEditar(null)
    setDrawerAbierto(true)
  }

  function abrirEdicion(c: CuentaRow) {
    setCuentaEditar(c)
    setDrawerAbierto(true)
  }

  function nuevoMovimiento(
    cuenta: CuentaRow,
    modo: 'ingreso' | 'egreso' | 'transferencia'
  ) {
    setCuentaParaMov(cuenta.id)
    setModoMov(modo)
    setModalMovAbierto(true)
  }

  const cuentasActivas = (cuentas ?? []).filter((c) => c.activo)
  const cuentasInactivas = (cuentas ?? []).filter((c) => !c.activo)

  // Desde el candado (mig 118) "Caja Efectivo" es la caja fuerte con saldo
  // real (se llena solo con el arqueo validado) → el total es la suma directa.
  const saldoTotal = cuentasActivas.reduce(
    (acc, c) => acc + Number(c.saldo_actual),
    0
  )

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-[#391511] font-bold text-lg">Cuentas</h2>
          <p className="text-[#6f3a2a] text-sm">
            Caja, bancos y billeteras donde se mueve la plata del negocio.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setCuentaParaMov(null)
              setModoMov('transferencia')
              setModalMovAbierto(true)
            }}
            className="border-[#e4c9b0] text-[#6f3a2a] hover:bg-[#fdfaf6] gap-1.5"
          >
            <Wallet className="h-4 w-4" />
            Nuevo movimiento
          </Button>
          <Button
            onClick={abrirNueva}
            className="bg-[#f9b44c] hover:bg-[#e4a42a] text-[#391511] font-semibold gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Nueva cuenta
          </Button>
        </div>
      </div>

      {/* Total general — suma directa: los saldos ya son reales */}
      {!isLoading && cuentasActivas.length > 0 && (
        <div className="rounded-2xl border-2 border-[#f9b44c]/40 bg-[#f9b44c]/10 p-5 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#6f3a2a] font-semibold flex items-center gap-1">
              Saldo total del negocio
            </div>
            <div className="text-xs text-[#6f3a2a]">
              Suma de {cuentasActivas.length} cuentas activas
            </div>
          </div>
          <div
            className={cn(
              'text-3xl font-extrabold tabular-nums',
              saldoTotal >= 0 ? 'text-[#391511]' : 'text-[#c43e2c]'
            )}
          >
            <MontoARS monto={saldoTotal} />
          </div>
        </div>
      )}

      {/* Grid de cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl bg-[#f9d2a2]/30" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-10 text-center text-[#c43e2c] text-sm">
          No se pudieron cargar las cuentas.
        </div>
      ) : cuentasActivas.length === 0 ? (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl p-12 text-center">
          <Wallet className="h-6 w-6 text-[#c8a58a] mx-auto mb-2" />
          <p className="text-[#391511] font-semibold">
            No hay cuentas activas todavía
          </p>
          <p className="text-[#6f3a2a] text-sm mt-1">
            Creá tu primera cuenta para empezar a registrar movimientos.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cuentasActivas.map((c) => {
            const Icono = ICONOS_TIPO[c.tipo]
            const saldo = Number(c.saldo_actual)
            const enRojo = saldo < 0
            return (
              <div
                key={c.id}
                onClick={() => onVerMovimientos?.(c.id)}
                role={onVerMovimientos ? 'button' : undefined}
                tabIndex={onVerMovimientos ? 0 : undefined}
                onKeyDown={
                  onVerMovimientos
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onVerMovimientos(c.id)
                        }
                      }
                    : undefined
                }
                title={
                  onVerMovimientos
                    ? 'Ver movimientos de esta cuenta'
                    : undefined
                }
                className={cn(
                  'bg-white border-2 rounded-2xl p-5 shadow-sm transition-all hover:shadow-md',
                  onVerMovimientos && 'cursor-pointer hover:border-[#f9b44c]/60',
                  enRojo ? 'border-[#c43e2c]/30' : 'border-[#e4c9b0]/60'
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-[#f9b44c]/15">
                      <Icono className="h-4 w-4 text-[#391511]" />
                    </div>
                    <div>
                      <h3 className="font-bold text-[#391511] leading-tight flex items-center gap-1">
                        {c.nombre}
                        {c.es_caja_fuerte && (
                          <span onClick={(e) => e.stopPropagation()}>
                            <AyudaContextual titulo="Esta cuenta es la caja fuerte">
                              Es el efectivo verificado del negocio. La plata
                              entra acá SOLO cuando validás un arqueo en la
                              pestaña Caja fuerte (el control administrativo),
                              nunca directo desde la venta. El efectivo del día
                              sin contar está en las cajas y el buzón, aparte.
                              Es el mismo número que ves en el Tablero y en
                              Caja fuerte.
                            </AyudaContextual>
                          </span>
                        )}
                      </h3>
                      <p className="text-[10px] uppercase tracking-wider text-[#6f3a2a]">
                        {ETIQUETAS_TIPO[c.tipo]}
                        {c.banco && ` · ${c.banco}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      abrirEdicion(c)
                    }}
                    className="h-7 w-7 p-0 text-[#6f3a2a] hover:bg-[#f9d2a2]/40"
                    title="Editar cuenta"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div
                  className={cn(
                    'text-2xl font-extrabold tabular-nums mb-3',
                    enRojo ? 'text-[#c43e2c]' : 'text-[#391511]'
                  )}
                >
                  <MontoARS monto={saldo} />
                </div>

                {c.alias_cbu && (
                  <div className="text-[10px] text-[#c8a58a] font-mono mb-3 truncate">
                    {c.alias_cbu}
                  </div>
                )}

                {onVerMovimientos && (
                  <div className="flex items-center gap-1 text-[10px] font-semibold text-[#9e6b15] mb-2">
                    Ver movimientos
                    <ArrowRight className="h-3 w-3" />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-[#e4c9b0]/40">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      nuevoMovimiento(c, 'ingreso')
                    }}
                    className="text-[#6f3a2a] hover:bg-[#f9b44c]/15 hover:text-[#391511] gap-1 text-xs h-8"
                    title="Registrar ingreso"
                  >
                    <TrendingUp className="h-3 w-3" />
                    Ingreso
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      nuevoMovimiento(c, 'egreso')
                    }}
                    className="text-[#6f3a2a] hover:bg-[#c43e2c]/10 hover:text-[#c43e2c] gap-1 text-xs h-8"
                    title="Registrar egreso"
                  >
                    <TrendingDown className="h-3 w-3" />
                    Egreso
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Inactivas — colapsadas al pie */}
      {cuentasInactivas.length > 0 && (
        <details className="bg-white border border-[#e4c9b0]/60 rounded-xl px-3 py-2">
          <summary className="cursor-pointer text-sm text-[#6f3a2a]">
            {cuentasInactivas.length} cuentas inactivas
          </summary>
          <ul className="mt-2 space-y-1">
            {cuentasInactivas.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between text-sm px-2 py-1.5 rounded-lg hover:bg-[#fdfaf6]"
              >
                <span className="text-[#6f3a2a]">{c.nombre}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => abrirEdicion(c)}
                  className="h-6 text-xs text-[#6f3a2a]"
                >
                  Editar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Configuración de cobros automáticos */}
      {cuentasActivas.length > 0 && <ConfiguracionCobros />}

      <DrawerCuenta
        abierto={drawerAbierto}
        onCambioAbierto={setDrawerAbierto}
        cuenta={cuentaEditar}
      />

      <ModalNuevoMovimiento
        abierto={modalMovAbierto}
        onCambioAbierto={setModalMovAbierto}
        modoInicial={modoMov}
        cuentaIdInicial={cuentaParaMov}
      />
    </div>
  )
}
