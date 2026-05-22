'use client'

import { formatearFechaHora, formatearMonto } from '@/lib/utils/formato'

export interface ProductoVendidoComprobante {
  nombre: string
  cantidad: number
  unidad: string
}

export interface DatosComprobanteCierre {
  turnoId: number
  cajeroNombre: string
  fechaApertura: string
  fechaCierre: string
  montoApertura: number
  cantidadVentas: number
  totalVentas: number
  desglose: Array<{ etiqueta: string; total: number; cantidad: number }>
  productos: ProductoVendidoComprobante[]
  gastosCaja: number
  efectivoEsperado: number
  montoContado: number
  diferencia: number
  novedades: string | null
}

interface Props {
  datos: DatosComprobanteCierre
}

/**
 * Comprobante de cierre de turno para impresora térmica de 58mm.
 * Incluye desglose por medio de pago, arqueo de caja y líneas de firma.
 */
export function ComprobanteCierre({ datos }: Props) {
  const dif = datos.diferencia
  const difTexto =
    Math.abs(dif) < 0.01
      ? 'SIN DIFERENCIA'
      : dif > 0
        ? `SOBRANTE ${formatearMonto(dif)}`
        : `FALTANTE ${formatearMonto(Math.abs(dif))}`

  return (
    <div className="comprobante-termico">
      <div className="comprobante-titulo">¡Hola! Express</div>
      <div className="comprobante-subtitulo">Informe de cierre de turno</div>

      <div className="comprobante-sep" />

      <div className="comprobante-fila">
        <span>Turno</span>
        <span>#{datos.turnoId}</span>
      </div>
      <div className="comprobante-fila">
        <span>Empleado</span>
        <span>{datos.cajeroNombre}</span>
      </div>
      <div className="comprobante-fila">
        <span>Apertura</span>
        <span>{formatearFechaHora(datos.fechaApertura)}</span>
      </div>
      <div className="comprobante-fila">
        <span>Cierre</span>
        <span>{formatearFechaHora(datos.fechaCierre)}</span>
      </div>

      <div className="comprobante-sep" />

      <div className="comprobante-seccion">VENTAS POR MEDIO DE PAGO</div>
      {datos.desglose.map((d) => (
        <div className="comprobante-fila" key={d.etiqueta}>
          <span>
            {d.etiqueta} ({d.cantidad})
          </span>
          <span>{formatearMonto(d.total)}</span>
        </div>
      ))}
      <div className="comprobante-fila">
        <span>TOTAL VENTAS ({datos.cantidadVentas})</span>
        <span>{formatearMonto(datos.totalVentas)}</span>
      </div>

      {/* Productos vendidos: se ven en pantalla pero NO se imprimen
          (clase comprobante-productos → display:none en @media print). */}
      <div className="comprobante-productos">
        <div className="comprobante-sep" />
        <div className="comprobante-seccion">
          PRODUCTOS VENDIDOS ({datos.productos.length})
        </div>
        {datos.productos.length === 0 ? (
          <div>Sin productos vendidos en el turno.</div>
        ) : (
          datos.productos.map((p) => (
            <div className="comprobante-fila" key={p.nombre}>
              <span>{p.nombre}</span>
              <span>
                {p.cantidad} {p.unidad}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="comprobante-sep" />

      <div className="comprobante-seccion">ARQUEO DE CAJA (EFECTIVO)</div>
      <div className="comprobante-fila">
        <span>Monto apertura</span>
        <span>{formatearMonto(datos.montoApertura)}</span>
      </div>
      <div className="comprobante-fila">
        <span>(+) Ventas en efectivo</span>
        <span>{formatearMonto(datos.desglose.find((d) => d.etiqueta === 'Efectivo')?.total ?? 0)}</span>
      </div>
      <div className="comprobante-fila">
        <span>(−) Gastos de caja</span>
        <span>{formatearMonto(datos.gastosCaja)}</span>
      </div>
      <div className="comprobante-fila">
        <span>Esperado en caja</span>
        <span>{formatearMonto(datos.efectivoEsperado)}</span>
      </div>
      <div className="comprobante-fila">
        <span>Contado en caja</span>
        <span>{formatearMonto(datos.montoContado)}</span>
      </div>
      <div className="comprobante-fila comprobante-total">
        <span>Diferencia</span>
        <span>{difTexto}</span>
      </div>

      {datos.novedades && (
        <>
          <div className="comprobante-sep" />
          <div className="comprobante-seccion">NOVEDADES</div>
          <div>{datos.novedades}</div>
        </>
      )}

      <div className="comprobante-firma">
        <div className="comprobante-firma-linea">
          Firma del empleado · {datos.cajeroNombre}
        </div>
        <div className="comprobante-firma-linea">
          Firma del encargado
        </div>
      </div>

      <div className="comprobante-subtitulo" style={{ marginTop: '3mm' }}>
        Impreso {formatearFechaHora(new Date().toISOString())}
      </div>
    </div>
  )
}
