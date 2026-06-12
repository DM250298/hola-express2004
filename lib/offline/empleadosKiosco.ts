/**
 * Caché local de empleados para el kiosco offline. Guarda SÓLO datos públicos
 * (id, nombre, foto) para que el empleado pueda seleccionarse sin conexión.
 * NUNCA se guarda el PIN ni su hash: la validación es siempre server-side.
 */

import {
  STORE_EMPLEADOS_KIOSCO,
  idbGuardarLote,
  idbObtenerTodo,
  idbVaciar,
  metaGuardar,
  metaObtener,
} from './db'

export interface EmpleadoKiosco {
  id: number
  nombre: string
  apellido: string | null
  foto_url: string | null
  legajo: string
}

const META_FECHA = 'empleados_kiosco_actualizado_en'

export async function guardarEmpleadosKiosco(
  empleados: EmpleadoKiosco[]
): Promise<void> {
  await idbVaciar(STORE_EMPLEADOS_KIOSCO)
  await idbGuardarLote(STORE_EMPLEADOS_KIOSCO, empleados)
  await metaGuardar(META_FECHA, new Date().toISOString())
}

export async function leerEmpleadosKiosco(): Promise<EmpleadoKiosco[]> {
  return idbObtenerTodo<EmpleadoKiosco>(STORE_EMPLEADOS_KIOSCO)
}

export async function fechaEmpleadosKiosco(): Promise<string | null> {
  return metaObtener<string>(META_FECHA)
}
