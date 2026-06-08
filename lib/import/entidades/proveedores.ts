import { parsearTextoOpcional } from '@/lib/utils/parseo-excel'
import type { ColumnaDef, DefinicionEntidad } from '../tipos'

const columnas: ColumnaDef[] = [
  {
    campo: 'nombre',
    etiqueta: 'nombre',
    aliases: [/^nombre/i, /^proveedor/i],
    parser: parsearTextoOpcional,
    requerida: true,
  },
  {
    campo: 'cuit',
    etiqueta: 'cuit',
    aliases: [/cuit/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'telefono',
    etiqueta: 'telefono',
    aliases: [/tel[eé]fono/i, /celular/i, /^tel/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'email',
    etiqueta: 'email',
    aliases: [/e-?mail/i, /correo/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'razon_social',
    etiqueta: 'razon_social',
    aliases: [/raz[oó]n.*social/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'condicion_iva',
    etiqueta: 'condicion_iva',
    aliases: [/condici[oó]n.*iva/i, /cond.*iva/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'domicilio',
    etiqueta: 'domicilio',
    aliases: [/domicilio/i, /direcci[oó]n/i],
    parser: parsearTextoOpcional,
  },
]

export const ENTIDAD_PROVEEDORES: DefinicionEntidad = {
  clave: 'proveedores',
  etiqueta: 'Proveedores',
  descripcion: 'Proveedores. Se identifican por nombre (sin distinguir mayúsculas).',
  columnas,
  requeridasHeader: ['nombre'],
  claveUnica: { campo: 'nombre', columna: 'nombre', tabla: 'proveedores' },
  escritura: { tipo: 'rpc', nombre: 'fn_importar_proveedores' },
  permisoImport: 'configuracion',
  permisoExport: 'configuracion',
  nombreArchivo: 'proveedores',
  ejemplos: [
    {
      nombre: 'Distribuidora La Rioja',
      cuit: '30711842884',
      telefono: '3804111222',
      condicion_iva: 'responsable_inscripto',
    },
    { nombre: 'Lácteos del Valle', condicion_iva: 'monotributo' },
  ],
}
