'use client'

import { MontoARS } from '@/components/shared/MontoARS'
import { TIPOS_CONTRATO, UNIDADES_NEGOCIO, fechaCortaLocal } from './constantes'
import type { EmpleadoConSueldo } from '@/types/database'

interface Props {
  empleado: EmpleadoConSueldo
  puedeVerSueldos: boolean
}

function Campo({
  etiqueta,
  children,
}: {
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[#c8a58a] text-xs font-medium uppercase tracking-wide">
        {etiqueta}
      </p>
      <p className="text-[#391511] text-sm">{children}</p>
    </div>
  )
}

export function TabDatosEmpleado({ empleado: e, puedeVerSueldos }: Props) {
  const guion = '—'
  return (
    <div className="space-y-4">
      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
        <h3 className="text-[#391511] font-bold mb-4">Datos personales</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Campo etiqueta="Legajo">
            <span className="tabular-nums">{e.legajo}</span>
          </Campo>
          <Campo etiqueta="DNI">
            <span className="tabular-nums">{e.dni || e.documento || guion}</span>
          </Campo>
          <Campo etiqueta="CUIL">
            <span className="tabular-nums">{e.cuil || guion}</span>
          </Campo>
          <Campo etiqueta="Fecha de nacimiento">
            {fechaCortaLocal(e.fecha_nacimiento)}
          </Campo>
          <Campo etiqueta="Teléfono">{e.telefono || guion}</Campo>
          <Campo etiqueta="Email">{e.email || guion}</Campo>
          <Campo etiqueta="Dirección">{e.direccion || guion}</Campo>
        </div>
      </div>

      <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
        <h3 className="text-[#391511] font-bold mb-4">Datos laborales</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Campo etiqueta="Unidad de negocio">
            {UNIDADES_NEGOCIO[e.unidad_negocio]}
          </Campo>
          <Campo etiqueta="Puesto">{e.puesto || guion}</Campo>
          <Campo etiqueta="Tipo de contrato">
            {TIPOS_CONTRATO[e.tipo_contrato]}
          </Campo>
          <Campo etiqueta="Fecha de ingreso">
            {fechaCortaLocal(e.fecha_ingreso)}
          </Campo>
          <Campo etiqueta="N° reloj biométrico">
            <span className="tabular-nums">{e.reloj_id ?? guion}</span>
          </Campo>
          <Campo etiqueta="CBU / Alias bancario">
            {e.banco_cbu_alias || guion}
          </Campo>
          <Campo etiqueta="Estado">{e.activo ? 'Activo' : 'Dado de baja'}</Campo>
        </div>
      </div>

      {puedeVerSueldos && (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
          <h3 className="text-[#391511] font-bold mb-4">Sueldo</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Campo etiqueta="Sueldo básico">
              <span className="font-bold tabular-nums">
                <MontoARS monto={e.sueldo_basico} />
              </span>
            </Campo>
            <Campo etiqueta="Valor hora">
              <span className="tabular-nums">
                <MontoARS monto={e.valor_hora} />
              </span>
            </Campo>
          </div>
        </div>
      )}

      {e.notas && (
        <div className="bg-white border border-[#e4c9b0]/60 rounded-2xl shadow-sm p-5">
          <h3 className="text-[#391511] font-bold mb-2">Notas</h3>
          <p className="text-[#6f3a2a] text-sm whitespace-pre-wrap">{e.notas}</p>
        </div>
      )}
    </div>
  )
}
