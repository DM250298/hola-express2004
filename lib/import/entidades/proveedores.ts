import { parsearTextoOpcional } from '@/lib/utils/parseo-excel'
import type { ColumnaDef, DefinicionEntidad } from '../tipos'

const columnas: ColumnaDef[] = [
  {
    campo: 'nombre',
    etiqueta: 'nombre',
    aliases: [/^nombre/i, /^proveedor/i],
    parser: parsearTextoOpcional,
    requerida: true,
    orden: 1,
    ayuda: 'OBLIGATORIO. Nombre del proveedor. Es la clave (no distingue mayúsculas).',
  },
  {
    campo: 'cuit',
    etiqueta: 'cuit',
    aliases: [/cuit/i],
    parser: parsearTextoOpcional,
    orden: 2,
    ayuda: 'CUIT del proveedor. Opcional.',
  },
  {
    campo: 'telefono',
    etiqueta: 'telefono',
    aliases: [/tel[eé]fono/i, /celular/i, /^tel/i],
    parser: parsearTextoOpcional,
    orden: 3,
    ayuda: 'Teléfono de contacto. Opcional.',
  },
  {
    campo: 'email',
    etiqueta: 'email',
    aliases: [/e-?mail/i, /correo/i],
    parser: parsearTextoOpcional,
    orden: 4,
    ayuda: 'Correo electrónico. Opcional.',
  },
  {
    campo: 'razon_social',
    etiqueta: 'razon_social',
    aliases: [/raz[oó]n.*social/i],
    parser: parsearTextoOpcional,
    orden: 5,
    ayuda: 'Razón social (si difiere del nombre). Opcional.',
  },
  {
    campo: 'condicion_iva',
    etiqueta: 'condicion_iva',
    aliases: [/condici[oó]n.*iva/i, /cond.*iva/i],
    parser: parsearTextoOpcional,
    orden: 6,
    ayuda: 'responsable_inscripto, monotributo, exento o consumidor_final. Opcional.',
  },
  {
    campo: 'domicilio',
    etiqueta: 'domicilio',
    aliases: [/domicilio/i, /direcci[oó]n/i],
    parser: parsearTextoOpcional,
    orden: 7,
    ayuda: 'Domicilio comercial. Opcional.',
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
