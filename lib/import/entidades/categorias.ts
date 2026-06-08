import { parsearTextoOpcional } from '@/lib/utils/parseo-excel'
import type { ColumnaDef, DefinicionEntidad } from '../tipos'

const columnas: ColumnaDef[] = [
  {
    campo: 'nombre',
    etiqueta: 'nombre',
    aliases: [/^nombre/i, /categor[ií]a/i, /rubro/i],
    parser: parsearTextoOpcional,
    requerida: true,
    orden: 1,
    ayuda: 'OBLIGATORIO. Nombre del rubro. Es la clave (no distingue mayúsculas).',
  },
  {
    campo: 'descripcion',
    etiqueta: 'descripcion',
    aliases: [/descripci[oó]n/i, /detalle/i],
    parser: parsearTextoOpcional,
    orden: 2,
    ayuda: 'Detalle del rubro. Opcional.',
  },
]

export const ENTIDAD_CATEGORIAS: DefinicionEntidad = {
  clave: 'categorias',
  etiqueta: 'Categorías',
  descripcion: 'Rubros del catálogo. Se identifican por nombre (sin distinguir mayúsculas).',
  columnas,
  requeridasHeader: ['nombre'],
  claveUnica: { campo: 'nombre', columna: 'nombre', tabla: 'categorias' },
  escritura: { tipo: 'rpc', nombre: 'fn_importar_categorias' },
  permisoImport: 'configuracion',
  permisoExport: 'configuracion',
  nombreArchivo: 'categorias',
  ejemplos: [
    { nombre: 'Bebidas sin alcohol', descripcion: 'Gaseosas, aguas, jugos' },
    { nombre: 'Fiambrería' },
    { nombre: 'Limpieza' },
  ],
}
