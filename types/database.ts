/**
 * Código de rol. Desde la migración 009 los roles son dinámicos (tabla
 * `roles`), por eso es `string` libre. Los 3 base: admin, encargado, cajero.
 */
export type Rol = string
export type EstadoTurno = 'abierto' | 'cerrado'
/**
 * Código de un medio de pago. Desde la migración 007 los medios son
 * dinámicos (tabla `medios_pago`), por eso es `string` libre y no un enum.
 * Los 4 base son: efectivo, debito, credito, transferencia.
 */
export type MedioPago = string
export type EstadoVenta = 'completada' | 'anulada'
export type EstadoLote = 'activo' | 'agotado' | 'vencido' | 'dado_de_baja'
export type TipoMovimiento = 'entrada' | 'salida' | 'ajuste' | 'merma' | 'venta'
export type EstadoPedido = 'borrador' | 'enviado' | 'recibido' | 'cancelado'
export type EstadoCuentaPagar = 'pendiente' | 'pagada' | 'vencida'

/** Valor JSON genérico (para argumentos jsonb de funciones RPC). */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ─── usuarios ────────────────────────────────────────────────────────────────

export type UsuarioRow = {
  id: string
  email: string
  nombre: string
  rol: Rol
  activo: boolean
  created_at: string
}

export type UsuarioInsert = {
  id?: string
  email: string
  nombre: string
  rol: Rol
  activo?: boolean
  created_at?: string
}

export type UsuarioUpdate = {
  email?: string
  nombre?: string
  rol?: Rol
  activo?: boolean
}

// ─── categorias ──────────────────────────────────────────────────────────────

export type CategoriaRow = {
  id: number
  nombre: string
  descripcion: string | null
  created_at: string
}

export type CategoriaInsert = {
  id?: number
  nombre: string
  descripcion?: string | null
  created_at?: string
}

export type CategoriaUpdate = {
  nombre?: string
  descripcion?: string | null
}

// ─── proveedores ─────────────────────────────────────────────────────────────

export type ProveedorRow = {
  id: number
  nombre: string
  telefono: string | null
  email: string | null
  dias_entrega: number | null
  condicion_pago: string | null
  created_at: string
}

export type ProveedorInsert = {
  id?: number
  nombre: string
  telefono?: string | null
  email?: string | null
  dias_entrega?: number | null
  condicion_pago?: string | null
  created_at?: string
}

export type ProveedorUpdate = {
  nombre?: string
  telefono?: string | null
  email?: string | null
  dias_entrega?: number | null
  condicion_pago?: string | null
}

// ─── clientes (FASE 3 — CRM) ─────────────────────────────────────────────────

export type ClienteRow = {
  id: number
  nombre: string
  telefono: string | null
  email: string | null
  documento: string | null
  direccion: string | null
  notas: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export type ClienteInsert = {
  id?: number
  nombre: string
  telefono?: string | null
  email?: string | null
  documento?: string | null
  direccion?: string | null
  notas?: string | null
  activo?: boolean
  created_at?: string
  updated_at?: string
}

export type ClienteUpdate = {
  nombre?: string
  telefono?: string | null
  email?: string | null
  documento?: string | null
  direccion?: string | null
  notas?: string | null
  activo?: boolean
  updated_at?: string
}

/** Fila de la vista `vista_clientes`: cliente + métricas de compra. */
export type VistaClienteRow = ClienteRow & {
  cantidad_compras: number
  total_gastado: number
  ultima_compra: string | null
}

// ─── empleados (FASE 4 — RR.HH.) ─────────────────────────────────────────────

export type EmpleadoRow = {
  id: number
  nombre: string
  documento: string | null
  cuil: string | null
  puesto: string | null
  fecha_ingreso: string | null
  fecha_egreso: string | null
  sueldo_basico: number
  telefono: string | null
  email: string | null
  direccion: string | null
  usuario_id: string | null
  notas: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export type EmpleadoInsert = {
  id?: number
  nombre: string
  documento?: string | null
  cuil?: string | null
  puesto?: string | null
  fecha_ingreso?: string | null
  fecha_egreso?: string | null
  sueldo_basico?: number
  telefono?: string | null
  email?: string | null
  direccion?: string | null
  usuario_id?: string | null
  notas?: string | null
  activo?: boolean
}

export type EmpleadoUpdate = Partial<EmpleadoInsert> & {
  updated_at?: string
}

// ─── novedades_empleado ──────────────────────────────────────────────────────

export type NovedadEmpleadoRow = {
  id: number
  empleado_id: number
  periodo: string
  tipo: string
  concepto: string | null
  monto: number
  usuario_id: string | null
  created_at: string
}

export type NovedadEmpleadoInsert = {
  empleado_id: number
  periodo: string
  tipo: string
  concepto?: string | null
  monto: number
  usuario_id?: string | null
}

// ─── liquidaciones / recibos de sueldo ───────────────────────────────────────

export type LiquidacionRow = {
  id: number
  periodo: string
  estado: string
  aportes_porcentaje: number
  total_bruto: number
  total_aportes: number
  total_neto: number
  asiento_id: number | null
  cuenta_id: number | null
  fecha_pago: string | null
  usuario_id: string | null
  created_at: string
  confirmada_at: string | null
}

export type ReciboSueldoRow = {
  id: number
  liquidacion_id: number
  empleado_id: number
  sueldo_basico: number
  haberes_extra: number
  bruto: number
  aportes: number
  adelantos: number
  otros_descuentos: number
  neto: number
  pagado: boolean
  fecha_pago: string | null
  created_at: string
}

// ─── proyectos y tareas (FASE 5) ─────────────────────────────────────────────

export type ProyectoRow = {
  id: number
  nombre: string
  descripcion: string | null
  estado: string
  fecha_limite: string | null
  usuario_id: string | null
  tablero_id: number
  orden: number
  created_at: string
  updated_at: string
}

export type ProyectoInsert = {
  id?: number
  nombre: string
  descripcion?: string | null
  estado?: string
  fecha_limite?: string | null
  usuario_id?: string | null
  tablero_id: number
  orden?: number
}

export type ProyectoUpdate = Partial<ProyectoInsert> & {
  updated_at?: string
}

/** Fila de `vista_proyectos`: proyecto + avance. */
export type VistaProyectoRow = ProyectoRow & {
  total_tareas: number
  tareas_hechas: number
}

export type Recurrencia = 'none' | 'diaria' | 'semanal' | 'mensual' | 'anual'

export type TareaRow = {
  id: number
  proyecto_id: number
  titulo: string
  descripcion: string | null
  estado: string
  prioridad: string
  responsable_id: string | null
  fecha_limite: string | null
  creado_por: string | null
  completada_at: string | null
  recurrencia: Recurrencia
  created_at: string
  updated_at: string
}

export type TareaInsert = {
  id?: number
  proyecto_id: number
  titulo: string
  descripcion?: string | null
  estado?: string
  prioridad?: string
  responsable_id?: string | null
  fecha_limite?: string | null
  creado_por?: string | null
  completada_at?: string | null
  recurrencia?: Recurrencia
}

export type TareaUpdate = Partial<Omit<TareaInsert, 'proyecto_id'>> & {
  updated_at?: string
}

export type VistaTareaRow = TareaRow & {
  total_subtareas: number
  subtareas_hechas: number
}

// ─── subtareas (checklist dentro de una tarea) ────────────────────────────────

export type SubtareaRow = {
  id: number
  tarea_id: number
  titulo: string
  hecha: boolean
  responsable_id: string | null
  orden: number
  completada_at: string | null
  created_at: string
  updated_at: string
}

export type SubtareaInsert = {
  id?: number
  tarea_id: number
  titulo: string
  hecha?: boolean
  responsable_id?: string | null
  orden?: number
  completada_at?: string | null
}

export type SubtareaUpdate = Partial<Omit<SubtareaInsert, 'tarea_id'>> & {
  updated_at?: string
}

// ─── tableros (agrupan proyectos + miembros con rol) ──────────────────────────

export type RolTablero = 'lector' | 'editor' | 'admin'

export type TableroRow = {
  id: number
  nombre: string
  descripcion: string | null
  color: string
  imagen_url: string | null
  archivado: boolean
  creado_por: string | null
  created_at: string
  updated_at: string
}

export type TableroInsert = {
  id?: number
  nombre: string
  descripcion?: string | null
  color?: string
  imagen_url?: string | null
  archivado?: boolean
  creado_por?: string | null
}

export type TableroUpdate = Partial<TableroInsert> & {
  updated_at?: string
}

export type TableroMiembroRow = {
  tablero_id: number
  usuario_id: string
  rol: RolTablero
  agregado_at: string
}

export type TableroMiembroInsert = {
  tablero_id: number
  usuario_id: string
  rol?: RolTablero
}

export type VistaTableroRow = TableroRow & {
  total_proyectos: number
  proyectos_activos: number
  total_miembros: number
}

export type VistaTableroUsuarioRow = VistaTableroRow & {
  mi_rol: RolTablero | null
}

// ─── terminales de cobro (FASE 6) ────────────────────────────────────────────

export type TerminalRow = {
  id: number
  nombre: string
  proveedor: string
  device_id: string | null
  cuenta_id: number | null
  activo: boolean
  created_at: string
  updated_at: string
}

export type TerminalInsert = {
  id?: number
  nombre: string
  proveedor?: string
  device_id?: string | null
  cuenta_id?: number | null
  activo?: boolean
}

export type TerminalUpdate = Partial<TerminalInsert> & {
  updated_at?: string
}

// ─── productos ───────────────────────────────────────────────────────────────

/** Costo adicional de un producto (flete, embalaje, etc.). */
export type CostoAdicional = {
  descripcion: string
  monto: number
}

export type ProductoRow = {
  id: number
  codigo_barras: string | null
  nombre: string
  categoria_id: number | null
  proveedor_id: number | null
  precio_venta: number
  precio_costo: number
  stock_actual: number
  stock_minimo: number
  activo: boolean
  tipo: string
  unidad: string
  iva_compra: number
  iva_venta: number
  margen: number
  costos_adicionales: CostoAdicional[]
  dias_vencimiento_minimo: number | null
  created_at: string
  updated_at: string
}

export type ProductoInsert = {
  id?: number
  codigo_barras?: string | null
  nombre: string
  categoria_id?: number | null
  proveedor_id?: number | null
  precio_venta: number
  precio_costo: number
  stock_actual?: number
  stock_minimo?: number
  activo?: boolean
  tipo?: string
  unidad?: string
  iva_compra?: number
  iva_venta?: number
  margen?: number
  costos_adicionales?: CostoAdicional[]
  dias_vencimiento_minimo?: number | null
  created_at?: string
  updated_at?: string
}

export type ProductoUpdate = {
  codigo_barras?: string | null
  nombre?: string
  categoria_id?: number | null
  proveedor_id?: number | null
  precio_venta?: number
  precio_costo?: number
  stock_actual?: number
  stock_minimo?: number
  activo?: boolean
  tipo?: string
  unidad?: string
  iva_compra?: number
  iva_venta?: number
  margen?: number
  costos_adicionales?: CostoAdicional[]
  dias_vencimiento_minimo?: number | null
  updated_at?: string
}

// ─── caja_turnos ─────────────────────────────────────────────────────────────

export type CajaTurnoRow = {
  id: number
  usuario_id: string
  fecha_apertura: string
  fecha_cierre: string | null
  monto_apertura: number
  monto_cierre_real: number | null
  monto_cierre_esperado: number | null
  diferencia: number | null
  estado: EstadoTurno
  novedades: string | null
  created_at: string
}

export type CajaTurnoInsert = {
  id?: number
  usuario_id: string
  fecha_apertura?: string
  fecha_cierre?: string | null
  monto_apertura: number
  monto_cierre_real?: number | null
  monto_cierre_esperado?: number | null
  diferencia?: number | null
  estado?: EstadoTurno
  novedades?: string | null
  created_at?: string
}

export type CajaTurnoUpdate = {
  fecha_cierre?: string | null
  monto_cierre_real?: number | null
  monto_cierre_esperado?: number | null
  diferencia?: number | null
  estado?: EstadoTurno
  novedades?: string | null
}

// ─── ventas ──────────────────────────────────────────────────────────────────

export type VentaRow = {
  id: number
  turno_id: number
  usuario_id: string
  fecha: string
  total: number
  medio_pago: MedioPago
  estado: EstadoVenta
  created_at: string
  /** UUID generado en el cliente para idempotencia (ventas offline). */
  cliente_uuid: string | null
  /** Cliente asociado a la venta (FASE 3 — CRM). Null = venta al mostrador. */
  cliente_id: number | null
}

export type VentaInsert = {
  id?: number
  turno_id: number
  usuario_id: string
  fecha?: string
  total: number
  medio_pago: MedioPago
  estado?: EstadoVenta
  created_at?: string
  cliente_uuid?: string | null
  cliente_id?: number | null
}

export type VentaUpdate = {
  estado?: EstadoVenta
  total?: number
  medio_pago?: MedioPago
  cliente_id?: number | null
}

// ─── items_venta ─────────────────────────────────────────────────────────────

export type ItemVentaRow = {
  id: number
  venta_id: number
  producto_id: number
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export type ItemVentaInsert = {
  id?: number
  venta_id: number
  producto_id: number
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export type ItemVentaUpdate = {
  cantidad?: number
  precio_unitario?: number
  subtotal?: number
}

// ─── pagos_venta (split payment) ─────────────────────────────────────────────

export type PagoVentaRow = {
  id: number
  venta_id: number
  medio_pago: MedioPago
  monto: number
  created_at: string
}

export type PagoVentaInsert = {
  id?: number
  venta_id: number
  medio_pago: MedioPago
  monto: number
  created_at?: string
}

export type PagoVentaUpdate = {
  medio_pago?: MedioPago
  monto?: number
}

// ─── lotes ───────────────────────────────────────────────────────────────────

export type LoteRow = {
  id: number
  producto_id: number
  fecha_vencimiento: string
  cantidad_inicial: number
  cantidad_actual: number
  fecha_ingreso: string
  estado: EstadoLote
  pedido_origen_id: number | null
  created_at: string
}

export type LoteInsert = {
  id?: number
  producto_id: number
  fecha_vencimiento: string
  cantidad_inicial: number
  cantidad_actual?: number
  fecha_ingreso?: string
  estado?: EstadoLote
  pedido_origen_id?: number | null
  created_at?: string
}

export type LoteUpdate = {
  fecha_vencimiento?: string
  cantidad_actual?: number
  estado?: EstadoLote
  pedido_origen_id?: number | null
}

// ─── movimientos_stock ───────────────────────────────────────────────────────

export type MovimientoStockRow = {
  id: number
  producto_id: number
  tipo: TipoMovimiento
  cantidad: number
  stock_anterior: number
  stock_nuevo: number
  referencia_id: number | null
  usuario_id: string
  nota: string | null
  created_at: string
}

export type MovimientoStockInsert = {
  id?: number
  producto_id: number
  tipo: TipoMovimiento
  cantidad: number
  stock_anterior: number
  stock_nuevo: number
  referencia_id?: number | null
  usuario_id: string
  nota?: string | null
  created_at?: string
}

export type MovimientoStockUpdate = {
  nota?: string | null
}

// ─── pedidos ─────────────────────────────────────────────────────────────────

export type PedidoRow = {
  id: number
  proveedor_id: number
  usuario_id: string
  fecha_pedido: string
  fecha_entrega_esperada: string | null
  estado: EstadoPedido
  total: number
  created_at: string
  updated_at: string
}

export type PedidoInsert = {
  id?: number
  proveedor_id: number
  usuario_id: string
  fecha_pedido?: string
  fecha_entrega_esperada?: string | null
  estado?: EstadoPedido
  total?: number
  created_at?: string
  updated_at?: string
}

export type PedidoUpdate = {
  fecha_entrega_esperada?: string | null
  estado?: EstadoPedido
  total?: number
  updated_at?: string
}

// ─── items_pedido ─────────────────────────────────────────────────────────────

export type ItemPedidoRow = {
  id: number
  pedido_id: number
  producto_id: number
  cantidad_pedida: number
  cantidad_recibida: number | null
  precio_costo: number
  subtotal: number
}

export type ItemPedidoInsert = {
  id?: number
  pedido_id: number
  producto_id: number
  cantidad_pedida: number
  cantidad_recibida?: number | null
  precio_costo: number
  subtotal: number
}

export type ItemPedidoUpdate = {
  cantidad_pedida?: number
  cantidad_recibida?: number | null
  precio_costo?: number
  subtotal?: number
}

// ─── egresos ─────────────────────────────────────────────────────────────────

export type EgresoRow = {
  id: number
  descripcion: string
  monto: number
  categoria: string
  fecha: string
  usuario_id: string
  cuenta_id: number | null
  turno_id: number | null
  created_at: string
}

export type EgresoInsert = {
  id?: number
  descripcion: string
  monto: number
  categoria: string
  fecha?: string
  usuario_id: string
  cuenta_id?: number | null
  turno_id?: number | null
  created_at?: string
}

export type EgresoUpdate = {
  descripcion?: string
  monto?: number
  categoria?: string
  fecha?: string
  cuenta_id?: number | null
  turno_id?: number | null
}

// ─── tipo_cuenta / tipo_movimiento_cuenta enums ──────────────────────────────

export type TipoCuenta = 'caja' | 'banco' | 'billetera_virtual'

export type TipoMovimientoCuenta =
  | 'ingreso'
  | 'egreso'
  | 'transferencia_entrada'
  | 'transferencia_salida'
  | 'ajuste'

// ─── cuentas ─────────────────────────────────────────────────────────────────

export type CuentaRow = {
  id: number
  nombre: string
  tipo: TipoCuenta
  saldo_actual: number
  moneda: string
  banco: string | null
  numero_cuenta: string | null
  alias_cbu: string | null
  notas: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export type CuentaInsert = {
  id?: number
  nombre: string
  tipo?: TipoCuenta
  saldo_actual?: number
  moneda?: string
  banco?: string | null
  numero_cuenta?: string | null
  alias_cbu?: string | null
  notas?: string | null
  activo?: boolean
  created_at?: string
  updated_at?: string
}

export type CuentaUpdate = {
  nombre?: string
  tipo?: TipoCuenta
  saldo_actual?: number
  moneda?: string
  banco?: string | null
  numero_cuenta?: string | null
  alias_cbu?: string | null
  notas?: string | null
  activo?: boolean
  updated_at?: string
}

// ─── movimientos_cuenta ──────────────────────────────────────────────────────

export type MovimientoCuentaRow = {
  id: number
  cuenta_id: number
  tipo: TipoMovimientoCuenta
  monto: number
  saldo_anterior: number
  saldo_nuevo: number
  descripcion: string
  categoria: string | null
  contraparte_cuenta_id: number | null
  referencia_tipo: string | null
  referencia_id: number | null
  transferencia_id: string | null
  usuario_id: string
  fecha: string
  conciliado: boolean
  fecha_conciliacion: string | null
  created_at: string
}

export type MovimientoCuentaInsert = {
  id?: number
  cuenta_id: number
  tipo: TipoMovimientoCuenta
  monto: number
  saldo_anterior: number
  saldo_nuevo: number
  descripcion: string
  categoria?: string | null
  contraparte_cuenta_id?: number | null
  referencia_tipo?: string | null
  referencia_id?: number | null
  transferencia_id?: string | null
  usuario_id: string
  fecha?: string
  created_at?: string
}

export type MovimientoCuentaUpdate = {
  descripcion?: string
  categoria?: string | null
  conciliado?: boolean
  fecha_conciliacion?: string | null
}

// ─── cuentas_a_pagar ─────────────────────────────────────────────────────────

export type CuentaAPagarRow = {
  id: number
  pedido_id: number
  proveedor_id: number
  monto: number
  fecha_vencimiento: string
  fecha_pago: string | null
  estado: EstadoCuentaPagar
  created_at: string
}

export type CuentaAPagarInsert = {
  id?: number
  pedido_id: number
  proveedor_id: number
  monto: number
  fecha_vencimiento: string
  fecha_pago?: string | null
  estado?: EstadoCuentaPagar
  created_at?: string
}

export type CuentaAPagarUpdate = {
  monto?: number
  fecha_vencimiento?: string
  fecha_pago?: string | null
  estado?: EstadoCuentaPagar
}

// ─── medios_pago (dinámicos) ─────────────────────────────────────────────────

export type MedioPagoRow = {
  id: number
  codigo: string
  nombre: string
  icono: string
  activo: boolean
  orden: number
  comision_porcentaje: number
  cuenta_id: number | null
  protegido: boolean
  created_at: string
  updated_at: string
}

export type MedioPagoInsert = {
  id?: number
  codigo: string
  nombre: string
  icono?: string
  activo?: boolean
  orden?: number
  comision_porcentaje?: number
  cuenta_id?: number | null
  protegido?: boolean
  created_at?: string
  updated_at?: string
}

export type MedioPagoUpdate = {
  codigo?: string
  nombre?: string
  icono?: string
  activo?: boolean
  orden?: number
  comision_porcentaje?: number
  cuenta_id?: number | null
  protegido?: boolean
  updated_at?: string
}

// ─── ajustes_stock ───────────────────────────────────────────────────────────

export type AjusteStockRow = {
  id: number
  usuario_id: string | null
  fecha: string
  razon: string
  razon_detalle: string | null
  total_costo: number
  cantidad_items: number
  created_at: string
}

export type AjusteStockInsert = {
  id?: number
  usuario_id?: string | null
  fecha?: string
  razon?: string
  razon_detalle?: string | null
  total_costo?: number
  cantidad_items?: number
  created_at?: string
}

export type AjusteStockUpdate = {
  razon?: string
  razon_detalle?: string | null
  total_costo?: number
  cantidad_items?: number
}

export type ItemAjusteStockRow = {
  id: number
  ajuste_id: number
  producto_id: number
  tipo: string
  cantidad: number
  stock_anterior: number
  stock_final: number
  costo_unitario: number
  subtotal: number
}

export type ItemAjusteStockInsert = {
  id?: number
  ajuste_id: number
  producto_id: number
  tipo: string
  cantidad: number
  stock_anterior: number
  stock_final: number
  costo_unitario?: number
  subtotal?: number
}

export type ItemAjusteStockUpdate = {
  cantidad?: number
  stock_final?: number
  subtotal?: number
}

// ─── conteos ─────────────────────────────────────────────────────────────────

export type EstadoConteo = 'pendiente' | 'contado' | 'aprobado'

export type ConteoRow = {
  id: number
  nombre: string
  usuario_asignado: string | null
  usuario_creador: string | null
  usuario_aprobador: string | null
  estado: EstadoConteo
  fecha_creacion: string
  fecha_conteo: string | null
  fecha_aprobacion: string | null
  created_at: string
}

export type ConteoInsert = {
  id?: number
  nombre: string
  usuario_asignado?: string | null
  usuario_creador?: string | null
  usuario_aprobador?: string | null
  estado?: EstadoConteo
  fecha_creacion?: string
  fecha_conteo?: string | null
  fecha_aprobacion?: string | null
  created_at?: string
}

export type ConteoUpdate = {
  nombre?: string
  usuario_asignado?: string | null
  usuario_aprobador?: string | null
  estado?: EstadoConteo
  fecha_conteo?: string | null
  fecha_aprobacion?: string | null
}

export type ConteoItemRow = {
  id: number
  conteo_id: number
  producto_id: number
  stock_sistema: number
  cantidad_contada: number | null
  contado: boolean
}

export type ConteoItemInsert = {
  id?: number
  conteo_id: number
  producto_id: number
  stock_sistema?: number
  cantidad_contada?: number | null
  contado?: boolean
}

export type ConteoItemUpdate = {
  cantidad_contada?: number | null
  contado?: boolean
}

// ─── roles ───────────────────────────────────────────────────────────────────

export type RolRow = {
  id: number
  codigo: string
  nombre: string
  permisos: string[]
  es_sistema: boolean
  created_at: string
  updated_at: string
}

export type RolInsert = {
  id?: number
  codigo: string
  nombre: string
  permisos?: string[]
  es_sistema?: boolean
  created_at?: string
  updated_at?: string
}

export type RolUpdate = {
  codigo?: string
  nombre?: string
  permisos?: string[]
  updated_at?: string
}

// ─── etiquetas_pendientes ────────────────────────────────────────────────────

export type EtiquetaPendienteRow = {
  id: number
  producto_id: number
  precio: number
  precio_anterior: number | null
  fecha: string
}

export type EtiquetaPendienteInsert = {
  id?: number
  producto_id: number
  precio: number
  precio_anterior?: number | null
  fecha?: string
}

export type EtiquetaPendienteUpdate = {
  precio?: number
  precio_anterior?: number | null
  fecha?: string
}

// ─── facturas_compra ─────────────────────────────────────────────────────────

export type FacturaCompraRow = {
  id: number
  cuenta_id: number | null
  pedido_id: number | null
  proveedor_id: number | null
  fecha: string
  neto: number
  iva_total: number
  total: number
  afecta_precio_venta: boolean
  usuario_id: string | null
  created_at: string
  updated_at: string
}

export type FacturaCompraInsert = {
  id?: number
  cuenta_id?: number | null
  pedido_id?: number | null
  proveedor_id?: number | null
  fecha?: string
  neto?: number
  iva_total?: number
  total?: number
  afecta_precio_venta?: boolean
  usuario_id?: string | null
  created_at?: string
  updated_at?: string
}

export type FacturaCompraUpdate = Partial<FacturaCompraInsert>

export type ItemFacturaCompraRow = {
  id: number
  factura_id: number
  producto_id: number
  cantidad: number
  costo_sin_iva: number
  descuento_porcentaje: number
  iva_compra_porcentaje: number
  costo_con_iva: number
  margen_porcentaje: number
  iva_venta_porcentaje: number
  precio_sin_iva: number
  precio_con_iva: number
}

export type ItemFacturaCompraInsert = {
  id?: number
  factura_id: number
  producto_id: number
  cantidad?: number
  costo_sin_iva?: number
  descuento_porcentaje?: number
  iva_compra_porcentaje?: number
  costo_con_iva?: number
  margen_porcentaje?: number
  iva_venta_porcentaje?: number
  precio_sin_iva?: number
  precio_con_iva?: number
}

export type ItemFacturaCompraUpdate = Partial<ItemFacturaCompraInsert>

// ─── plan_cuentas (contabilidad) ─────────────────────────────────────────────

export type TipoCuentaContable =
  | 'activo'
  | 'pasivo'
  | 'patrimonio'
  | 'ingreso'
  | 'egreso'

export type PlanCuentaRow = {
  id: number
  codigo: string
  nombre: string
  tipo: TipoCuentaContable
  imputable: boolean
  activo: boolean
  created_at: string
  updated_at: string
}

export type PlanCuentaInsert = {
  id?: number
  codigo: string
  nombre: string
  tipo: TipoCuentaContable
  imputable?: boolean
  activo?: boolean
  created_at?: string
  updated_at?: string
}

export type PlanCuentaUpdate = {
  codigo?: string
  nombre?: string
  tipo?: TipoCuentaContable
  imputable?: boolean
  activo?: boolean
  updated_at?: string
}

// ─── asientos contables ──────────────────────────────────────────────────────

export type AsientoRow = {
  id: number
  fecha: string
  descripcion: string
  tipo: string
  origen: string | null
  referencia_id: number | null
  usuario_id: string | null
  anulado: boolean
  created_at: string
}

export type AsientoInsert = {
  id?: number
  fecha?: string
  descripcion: string
  tipo?: string
  origen?: string | null
  referencia_id?: number | null
  usuario_id?: string | null
  anulado?: boolean
  created_at?: string
}

export type AsientoUpdate = {
  fecha?: string
  descripcion?: string
  anulado?: boolean
}

export type AsientoItemRow = {
  id: number
  asiento_id: number
  cuenta_id: number
  debe: number
  haber: number
  orden: number
}

export type AsientoItemInsert = {
  id?: number
  asiento_id: number
  cuenta_id: number
  debe?: number
  haber?: number
  orden?: number
}

export type AsientoItemUpdate = {
  debe?: number
  haber?: number
  orden?: number
}

// ─── activos_fijos ───────────────────────────────────────────────────────────

export type ActivoFijoRow = {
  id: number
  nombre: string
  descripcion: string | null
  fecha_adquisicion: string
  valor_origen: number
  vida_util_meses: number
  valor_residual: number
  estado: string
  fecha_baja: string | null
  usuario_id: string | null
  created_at: string
}

export type ActivoFijoInsert = {
  id?: number
  nombre: string
  descripcion?: string | null
  fecha_adquisicion?: string
  valor_origen?: number
  vida_util_meses?: number
  valor_residual?: number
  estado?: string
  fecha_baja?: string | null
  usuario_id?: string | null
  created_at?: string
}

export type ActivoFijoUpdate = {
  nombre?: string
  descripcion?: string | null
  estado?: string
  fecha_baja?: string | null
}

// ─── Tipo Database (compatible con el cliente de Supabase) ───────────────────

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: '12'
  }
  public: {
    Tables: {
      usuarios: {
        Row: UsuarioRow
        Insert: UsuarioInsert
        Update: UsuarioUpdate
        Relationships: []
      }
      categorias: {
        Row: CategoriaRow
        Insert: CategoriaInsert
        Update: CategoriaUpdate
        Relationships: []
      }
      proveedores: {
        Row: ProveedorRow
        Insert: ProveedorInsert
        Update: ProveedorUpdate
        Relationships: []
      }
      clientes: {
        Row: ClienteRow
        Insert: ClienteInsert
        Update: ClienteUpdate
        Relationships: []
      }
      empleados: {
        Row: EmpleadoRow
        Insert: EmpleadoInsert
        Update: EmpleadoUpdate
        Relationships: []
      }
      novedades_empleado: {
        Row: NovedadEmpleadoRow
        Insert: NovedadEmpleadoInsert
        Update: Partial<NovedadEmpleadoInsert>
        Relationships: []
      }
      liquidaciones: {
        Row: LiquidacionRow
        Insert: Partial<LiquidacionRow>
        Update: Partial<LiquidacionRow>
        Relationships: []
      }
      recibos_sueldo: {
        Row: ReciboSueldoRow
        Insert: Partial<ReciboSueldoRow>
        Update: Partial<ReciboSueldoRow>
        Relationships: []
      }
      proyectos: {
        Row: ProyectoRow
        Insert: ProyectoInsert
        Update: ProyectoUpdate
        Relationships: []
      }
      tableros: {
        Row: TableroRow
        Insert: TableroInsert
        Update: TableroUpdate
        Relationships: []
      }
      tablero_miembros: {
        Row: TableroMiembroRow
        Insert: TableroMiembroInsert
        Update: Partial<TableroMiembroRow>
        Relationships: []
      }
      tareas: {
        Row: TareaRow
        Insert: TareaInsert
        Update: TareaUpdate
        Relationships: []
      }
      subtareas: {
        Row: SubtareaRow
        Insert: SubtareaInsert
        Update: SubtareaUpdate
        Relationships: []
      }
      terminales: {
        Row: TerminalRow
        Insert: TerminalInsert
        Update: TerminalUpdate
        Relationships: []
      }
      productos: {
        Row: ProductoRow
        Insert: ProductoInsert
        Update: ProductoUpdate
        Relationships: [
          {
            foreignKeyName: 'productos_categoria_id_fkey'
            columns: ['categoria_id']
            referencedRelation: 'categorias'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'productos_proveedor_id_fkey'
            columns: ['proveedor_id']
            referencedRelation: 'proveedores'
            referencedColumns: ['id']
          },
        ]
      }
      caja_turnos: {
        Row: CajaTurnoRow
        Insert: CajaTurnoInsert
        Update: CajaTurnoUpdate
        Relationships: []
      }
      ventas: {
        Row: VentaRow
        Insert: VentaInsert
        Update: VentaUpdate
        Relationships: []
      }
      items_venta: {
        Row: ItemVentaRow
        Insert: ItemVentaInsert
        Update: ItemVentaUpdate
        Relationships: []
      }
      pagos_venta: {
        Row: PagoVentaRow
        Insert: PagoVentaInsert
        Update: PagoVentaUpdate
        Relationships: [
          {
            foreignKeyName: 'pagos_venta_venta_id_fkey'
            columns: ['venta_id']
            referencedRelation: 'ventas'
            referencedColumns: ['id']
          },
        ]
      }
      lotes: {
        Row: LoteRow
        Insert: LoteInsert
        Update: LoteUpdate
        Relationships: []
      }
      movimientos_stock: {
        Row: MovimientoStockRow
        Insert: MovimientoStockInsert
        Update: MovimientoStockUpdate
        Relationships: []
      }
      pedidos: {
        Row: PedidoRow
        Insert: PedidoInsert
        Update: PedidoUpdate
        Relationships: []
      }
      items_pedido: {
        Row: ItemPedidoRow
        Insert: ItemPedidoInsert
        Update: ItemPedidoUpdate
        Relationships: []
      }
      egresos: {
        Row: EgresoRow
        Insert: EgresoInsert
        Update: EgresoUpdate
        Relationships: []
      }
      cuentas_a_pagar: {
        Row: CuentaAPagarRow
        Insert: CuentaAPagarInsert
        Update: CuentaAPagarUpdate
        Relationships: []
      }
      cuentas: {
        Row: CuentaRow
        Insert: CuentaInsert
        Update: CuentaUpdate
        Relationships: []
      }
      movimientos_cuenta: {
        Row: MovimientoCuentaRow
        Insert: MovimientoCuentaInsert
        Update: MovimientoCuentaUpdate
        Relationships: [
          {
            foreignKeyName: 'movimientos_cuenta_cuenta_id_fkey'
            columns: ['cuenta_id']
            referencedRelation: 'cuentas'
            referencedColumns: ['id']
          },
        ]
      }
      medios_pago: {
        Row: MedioPagoRow
        Insert: MedioPagoInsert
        Update: MedioPagoUpdate
        Relationships: [
          {
            foreignKeyName: 'medios_pago_cuenta_id_fkey'
            columns: ['cuenta_id']
            referencedRelation: 'cuentas'
            referencedColumns: ['id']
          },
        ]
      }
      ajustes_stock: {
        Row: AjusteStockRow
        Insert: AjusteStockInsert
        Update: AjusteStockUpdate
        Relationships: []
      }
      items_ajuste_stock: {
        Row: ItemAjusteStockRow
        Insert: ItemAjusteStockInsert
        Update: ItemAjusteStockUpdate
        Relationships: [
          {
            foreignKeyName: 'items_ajuste_stock_ajuste_id_fkey'
            columns: ['ajuste_id']
            referencedRelation: 'ajustes_stock'
            referencedColumns: ['id']
          },
        ]
      }
      conteos: {
        Row: ConteoRow
        Insert: ConteoInsert
        Update: ConteoUpdate
        Relationships: []
      }
      conteos_items: {
        Row: ConteoItemRow
        Insert: ConteoItemInsert
        Update: ConteoItemUpdate
        Relationships: [
          {
            foreignKeyName: 'conteos_items_conteo_id_fkey'
            columns: ['conteo_id']
            referencedRelation: 'conteos'
            referencedColumns: ['id']
          },
        ]
      }
      roles: {
        Row: RolRow
        Insert: RolInsert
        Update: RolUpdate
        Relationships: []
      }
      etiquetas_pendientes: {
        Row: EtiquetaPendienteRow
        Insert: EtiquetaPendienteInsert
        Update: EtiquetaPendienteUpdate
        Relationships: [
          {
            foreignKeyName: 'etiquetas_pendientes_producto_id_fkey'
            columns: ['producto_id']
            referencedRelation: 'productos'
            referencedColumns: ['id']
          },
        ]
      }
      facturas_compra: {
        Row: FacturaCompraRow
        Insert: FacturaCompraInsert
        Update: FacturaCompraUpdate
        Relationships: []
      }
      items_factura_compra: {
        Row: ItemFacturaCompraRow
        Insert: ItemFacturaCompraInsert
        Update: ItemFacturaCompraUpdate
        Relationships: [
          {
            foreignKeyName: 'items_factura_compra_factura_id_fkey'
            columns: ['factura_id']
            referencedRelation: 'facturas_compra'
            referencedColumns: ['id']
          },
        ]
      }
      plan_cuentas: {
        Row: PlanCuentaRow
        Insert: PlanCuentaInsert
        Update: PlanCuentaUpdate
        Relationships: []
      }
      asientos: {
        Row: AsientoRow
        Insert: AsientoInsert
        Update: AsientoUpdate
        Relationships: []
      }
      asientos_items: {
        Row: AsientoItemRow
        Insert: AsientoItemInsert
        Update: AsientoItemUpdate
        Relationships: [
          {
            foreignKeyName: 'asientos_items_asiento_id_fkey'
            columns: ['asiento_id']
            referencedRelation: 'asientos'
            referencedColumns: ['id']
          },
        ]
      }
      activos_fijos: {
        Row: ActivoFijoRow
        Insert: ActivoFijoInsert
        Update: ActivoFijoUpdate
        Relationships: []
      }
    }
    Views: {
      vista_clientes: {
        Row: VistaClienteRow
        Relationships: []
      }
      vista_proyectos: {
        Row: VistaProyectoRow
        Relationships: []
      }
      vista_tableros: {
        Row: VistaTableroRow
        Relationships: []
      }
      vista_tableros_usuario: {
        Row: VistaTableroUsuarioRow
        Relationships: []
      }
      vista_tareas: {
        Row: VistaTareaRow
        Relationships: []
      }
    }
    Functions: {
      fn_crear_venta: {
        Args: {
          p_turno_id: number
          p_usuario_id: string
          p_pagos: Json
          p_items: Json
          p_cliente_uuid?: string | null
          p_cliente_id?: number | null
        }
        Returns: VentaRow
      }
      fn_liquidar_periodo: {
        Args: {
          p_periodo: string
          p_aportes_porcentaje: number
          p_usuario_id: string
        }
        Returns: LiquidacionRow
      }
      fn_confirmar_liquidacion: {
        Args: {
          p_liquidacion_id: number
          p_usuario_id: string
        }
        Returns: LiquidacionRow
      }
      fn_pagar_liquidacion: {
        Args: {
          p_liquidacion_id: number
          p_cuenta_id: number
          p_usuario_id: string
        }
        Returns: LiquidacionRow
      }
      fn_anular_venta: {
        Args: {
          p_venta_id: number
          p_usuario_id: string
        }
        Returns: undefined
      }
      fn_recibir_pedido: {
        Args: {
          p_pedido_id: number
          p_proveedor_id: number
          p_usuario_id: string
          p_condicion_pago_dias: number
          p_items: Json
        }
        Returns: { cuenta_a_pagar_id: number; total_recibido: number }
      }
      fn_guardar_factura_compra: {
        Args: {
          p_cuenta_id: number
          p_pedido_id: number
          p_proveedor_id: number | null
          p_fecha: string
          p_afecta_precio_venta: boolean
          p_usuario_id: string
          p_lineas: Json
        }
        Returns: undefined
      }
      fn_aprobar_conteo: {
        Args: {
          p_conteo_id: number
          p_aprobador_id: string
        }
        Returns: undefined
      }
      fn_crear_ajuste_stock: {
        Args: {
          p_usuario_id: string
          p_razon: string
          p_razon_detalle: string | null
          p_items: Json
        }
        Returns: AjusteStockRow
      }
      fn_crear_movimiento: {
        Args: {
          p_cuenta_id: number
          p_tipo: string
          p_monto: number
          p_descripcion: string
          p_categoria: string | null
          p_fecha: string | null
          p_usuario_id: string
        }
        Returns: MovimientoCuentaRow
      }
      fn_crear_transferencia: {
        Args: {
          p_origen_id: number
          p_destino_id: number
          p_monto: number
          p_descripcion: string
          p_fecha: string | null
          p_usuario_id: string
        }
        Returns: string
      }
      fn_crear_asiento: {
        Args: {
          p_fecha: string
          p_descripcion: string
          p_usuario_id: string
          p_lineas: Json
        }
        Returns: AsientoRow
      }
      fn_crear_egreso: {
        Args: {
          p_descripcion: string
          p_monto: number
          p_categoria: string
          p_fecha: string | null
          p_usuario_id: string
          p_turno_id: number | null
        }
        Returns: EgresoRow
      }
      fn_pagar_cuenta: {
        Args: {
          p_cuenta_id: number
          p_usuario_id: string
        }
        Returns: undefined
      }
      fn_crear_activo: {
        Args: {
          p_nombre: string
          p_descripcion: string | null
          p_fecha_adquisicion: string
          p_valor_origen: number
          p_vida_util_meses: number
          p_valor_residual: number
          p_usuario_id: string
        }
        Returns: ActivoFijoRow
      }
    }
    Enums: {
      rol: Rol
      estado_turno: EstadoTurno
      estado_venta: EstadoVenta
      estado_lote: EstadoLote
      tipo_movimiento: TipoMovimiento
      estado_pedido: EstadoPedido
      estado_cuenta_pagar: EstadoCuentaPagar
      tipo_cuenta: TipoCuenta
      tipo_movimiento_cuenta: TipoMovimientoCuenta
    }
    CompositeTypes: { [_ in never]: never }
  }
}
