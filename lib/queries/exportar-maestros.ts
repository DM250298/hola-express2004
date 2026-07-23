// Queries que traen los maestros listos para exportar a Excel. Cada función
// devuelve filas con las MISMAS keys que los `campo` de la entidad, para que
// el export sea round-trip con el import.

import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginacion'
import { costoDesdeEmbed, type CostoEmbed } from '@/lib/queries/productos'

export type FilaExport = Record<string, string | number | boolean | null>

type ProductoExportRaw = {
  codigo_barras: string | null
  codigo_barras_2: string | null
  codigo_interno: string | null
  nombre: string
  marca: string | null
  subcategoria: string | null
  unidad: string
  venta_por_peso: boolean
  iva_venta: number
  precio_venta: number
  stock_actual: number
  stock_minimo: number
  ubicacion: string | null
  dias_vencimiento_minimo: number | null
  activo: boolean
  margen: number | null
  categorias: { nombre: string } | null
  proveedores: { nombre: string } | null
  costos_producto: CostoEmbed
  proveedor_producto: { codigo_proveedor: string | null; es_principal: boolean }[] | null
}

const SELECT_EXPORT =
  'codigo_barras, codigo_barras_2, codigo_interno, nombre, marca, subcategoria, unidad, venta_por_peso, iva_venta, precio_venta, margen, stock_actual, stock_minimo, ubicacion, dias_vencimiento_minimo, activo, categorias(nombre), proveedores(nombre), costos_producto(precio_costo), proveedor_producto(codigo_proveedor, es_principal)'

export async function getProductosExport(incluirCosto: boolean): Promise<FilaExport[]> {
  const supabase = createClient()
  const filas = await traerTodo<ProductoExportRaw>(() =>
    supabase.from('productos').select(SELECT_EXPORT).order('nombre', { ascending: true })
  )
  return filas.map((f) => {
    const cp =
      f.proveedor_producto?.find((p) => p.es_principal) ?? f.proveedor_producto?.[0]
    return {
      codigo_barras: f.codigo_barras,
      codigo_barras_2: f.codigo_barras_2,
      codigo_interno: f.codigo_interno,
      nombre: f.nombre,
      marca: f.marca,
      categoria: f.categorias?.nombre ?? '',
      subcategoria: f.subcategoria,
      proveedor: f.proveedores?.nombre ?? '',
      codigo_proveedor: cp?.codigo_proveedor ?? '',
      unidad: f.unidad,
      venta_por_peso: f.venta_por_peso,
      precio_costo: incluirCosto ? costoDesdeEmbed(f.costos_producto) : '',
      iva: f.iva_venta,
      precio_venta: f.precio_venta,
      margen: f.margen,
      stock_actual: f.stock_actual,
      stock_minimo: f.stock_minimo,
      ubicacion: f.ubicacion,
      es_perecedero: f.dias_vencimiento_minimo != null,
      dias_vencimiento_minimo: f.dias_vencimiento_minimo,
      activo: f.activo,
    }
  })
}

export async function getClientesExport(): Promise<FilaExport[]> {
  const supabase = createClient()
  const filas = await traerTodo<{
    documento: string | null
    nombre: string
    telefono: string | null
    email: string | null
    direccion: string | null
    notas: string | null
    activo: boolean
  }>(() =>
    supabase
      .from('clientes')
      .select('documento, nombre, telefono, email, direccion, notas, activo')
      .order('nombre', { ascending: true })
  )
  return filas.map((f) => ({ ...f }))
}

export async function getCategoriasExport(): Promise<FilaExport[]> {
  const supabase = createClient()
  const filas = await traerTodo<{ nombre: string; descripcion: string | null }>(() =>
    supabase.from('categorias').select('nombre, descripcion').order('nombre', { ascending: true })
  )
  return filas.map((f) => ({ ...f }))
}

export async function getProveedoresExport(): Promise<FilaExport[]> {
  const supabase = createClient()
  const filas = await traerTodo<{
    nombre: string
    cuit: string | null
    telefono: string | null
    email: string | null
    razon_social: string | null
    condicion_iva: string | null
    domicilio: string | null
  }>(() =>
    supabase
      .from('proveedores')
      .select('nombre, cuit, telefono, email, razon_social, condicion_iva, domicilio')
      .order('nombre', { ascending: true })
  )
  return filas.map((f) => ({ ...f }))
}
