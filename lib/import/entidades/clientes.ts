import {
  parsearBooleano,
  parsearDocumento,
  parsearTextoOpcional,
} from '@/lib/utils/parseo-excel'
import type { ColumnaDef, DefinicionEntidad } from '../tipos'

const columnas: ColumnaDef[] = [
  {
    campo: 'documento',
    etiqueta: 'documento',
    aliases: [/documento/i, /^dni$/i, /^cuit$/i, /^cuil$/i, /^doc$/i],
    parser: parsearDocumento,
    orden: 2,
    ayuda: 'DNI o CUIT (solo números). Es la clave: si ya existe, se actualiza el cliente.',
  },
  {
    campo: 'nombre',
    etiqueta: 'nombre',
    aliases: [/^nombre/i, /raz[oó]n.*social/i, /^cliente/i, /apellido/i],
    parser: parsearTextoOpcional,
    requerida: true,
    orden: 1,
    ayuda: 'OBLIGATORIO. Nombre o razón social del cliente.',
  },
  {
    campo: 'telefono',
    etiqueta: 'telefono',
    aliases: [/tel[eé]fono/i, /celular/i, /contacto/i, /^tel/i],
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
    campo: 'direccion',
    etiqueta: 'direccion',
    aliases: [/direcci[oó]n/i, /domicilio/i],
    parser: parsearTextoOpcional,
    orden: 5,
    ayuda: 'Domicilio. Opcional.',
  },
  {
    campo: 'notas',
    etiqueta: 'notas',
    aliases: [/notas?/i, /observaci/i, /comentario/i],
    parser: parsearTextoOpcional,
    orden: 6,
    ayuda: 'Observaciones libres. Opcional.',
  },
  {
    campo: 'activo',
    etiqueta: 'activo',
    aliases: [/^activo$/i, /habilitado/i],
    parser: (v) => (v == null || String(v).trim() === '' ? true : parsearBooleano(v)),
    exportar: (v) => (v ? 'true' : 'false'),
    orden: 7,
    ayuda: 'true o false. Vacío = true (cliente activo).',
  },
]

export const ENTIDAD_CLIENTES: DefinicionEntidad = {
  clave: 'clientes',
  etiqueta: 'Clientes',
  descripcion:
    'Cartera de clientes (CRM). Se identifican por documento (DNI/CUIT); sin documento se crean nuevos.',
  columnas,
  requeridasHeader: ['nombre'],
  claveUnica: { campo: 'documento', columna: 'documento', tabla: 'clientes' },
  escritura: { tipo: 'rpc', nombre: 'fn_importar_clientes' },
  permisoImport: 'clientes',
  permisoExport: 'clientes',
  nombreArchivo: 'clientes',
  ejemplos: [
    {
      documento: '20304050607',
      nombre: 'Juan Pérez',
      telefono: '3804123456',
      email: 'juan@mail.com',
      activo: 'true',
    },
    { documento: '27111222333', nombre: 'María Gómez', activo: 'true' },
  ],
}
