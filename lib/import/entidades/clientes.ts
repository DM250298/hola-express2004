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
  },
  {
    campo: 'nombre',
    etiqueta: 'nombre',
    aliases: [/^nombre/i, /raz[oó]n.*social/i, /^cliente/i, /apellido/i],
    parser: parsearTextoOpcional,
    requerida: true,
  },
  {
    campo: 'telefono',
    etiqueta: 'telefono',
    aliases: [/tel[eé]fono/i, /celular/i, /contacto/i, /^tel/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'email',
    etiqueta: 'email',
    aliases: [/e-?mail/i, /correo/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'direccion',
    etiqueta: 'direccion',
    aliases: [/direcci[oó]n/i, /domicilio/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'notas',
    etiqueta: 'notas',
    aliases: [/notas?/i, /observaci/i, /comentario/i],
    parser: parsearTextoOpcional,
  },
  {
    campo: 'activo',
    etiqueta: 'activo',
    aliases: [/^activo$/i, /habilitado/i],
    parser: (v) => (v == null || String(v).trim() === '' ? true : parsearBooleano(v)),
    exportar: (v) => (v ? 'true' : 'false'),
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
}
