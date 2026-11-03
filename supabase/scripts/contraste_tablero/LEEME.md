# Contraste del Tablero del dueño

Cinco consultas de **solo lectura** que recalculan cada tarjeta de `/tablero`
desde las tablas crudas (`ventas`, `items_venta`, `pagos_venta`, `productos`,
`costos_producto`, `quiebres_stock`, `lotes`, `alertas`, `caja_turnos`), sin
pasar por `fn_tablero_gerencial` ni sus helpers. Sirven para responder
"¿el tablero refleja la base?" y, con los cierres de caja y los pagos por
medio, "¿la base refleja el negocio?".

## Cómo correrlas

1. SQL Editor del proyecto de **producción** (arriba tiene que decir
   `HEX-V1` · `main PRODUCTION`). Un archivo por vez, completo; la última
   línea de cada uno es `order by orden;`.
2. Abrir `/tablero` en la app con el mismo período (por defecto los scripts
   usan "Este mes": del 1° a hoy, hora de La Rioja). Para otro período,
   cambiar las dos fechas del bloque `params` al principio de cada archivo.
3. Comparar fila por fila con la tabla de abajo. Las filas `CONTROL` tienen
   que dar 0; las filas `AVISO` dicen cuánto del número es estimado.

En el SQL Editor no hay usuario logueado: por eso los scripts no llaman a
ninguna `fn_*` con permiso (y por eso el tablero mismo no se puede invocar
desde ahí).

## Qué tarjeta contrasta cada fila

| Tarjeta del tablero | Script · fila | Tiene que pasar |
|---|---|---|
| Hoy / Ayer / Últimos 7 días / Mes en curso | `01_ventas` · 10–13 | Mismo $ y mismos %. Ventas `completada`, con IVA, por día local |
| Ventas · período (tickets, ticket promedio, vs anterior) | `01_ventas` · 20 | Mismo $ y tickets |
| (no está en el tablero) ventas anuladas | `01_ventas` · 30 | Solo informa: el tablero las excluye |
| Integridad venta ↔ ítems ↔ pagos | `01_ventas` · 40–42 | **0** |
| Margen · ventas netas, IVA | `02_margen` · 12–13 | Mismo $. Netas + IVA + devoluciones = brutos |
| Margen comercial neto de IVA ($ y %) | `02_margen` · 15 | Mismo $ y % |
| Inventario · días de inventario | `02_margen` · 16 | Mismo valor (stock a costo / costo diario del período) |
| "* parcialmente estimado" | `02_margen` · 30–32 | Si 30 > 0 el tablero lo marca; 31 y 32 explican sesgos |
| Ventas vs caja física | `03_caja` · 10–12 | Diferencia acumulada de cierres ≈ 0; turnos abiertos = ventas sin contar |
| Ventas por medio (cruce con Mercado Pago / banco) | `03_caja` · 21+ y 40 | 40 = tarjeta Ventas; tarjeta/QR = reporte de MP del período |
| Inventario a costo | `04_inventario` · 10 | Mismo $ |
| Inmovilizado +45 días | `04_inventario` · 11 | Mismo $ y cantidad |
| Lo que la tarjeta no ve | `04_inventario` · 20–21 | Stock con costo 0 y stock negativo: cuántos y cuánto valdrían |
| Validación física | `04_inventario` · 30 y 40 | Último conteo; los 10 que más pesan, para contarlos en góndola |
| Quiebres · activos ahora / críticos | `05_quiebres` · 10–11 | Mismas cantidades |
| Quiebres vs `stock_actual` | `05_quiebres` · 12–13 | 13 = **0**; 12 explica la brecha con "sin stock" de Inventario |
| Horas sin stock / venta perdida est. | `05_quiebres` · 20–21 | Mismo valor; 21 es una estimación por diseño |
| Lotes por vencer | `05_quiebres` · 30 | Misma cantidad |
| Requiere intervención | `05_quiebres` · 40–41 | Mismas cantidades por regla; 41 = cuándo se evaluaron |
| Costo de lo vendido, abierto por producto | `06_cmv_por_producto` | Fila TOTAL = ventas netas, IVA, CMV y margen de la tarjeta; cada fila trae costo congelado vs. actual y qué líneas son estimadas |

## Qué es dato registrado y qué es estimación

- **Registrado** (sale de operaciones reales): ventas, tickets, IVA (alícuota
  congelada en cada ítem desde la mig 311), devoluciones, stock del sistema,
  eventos de quiebre, lotes, cierres de caja.
- **Depende de que el costo esté bien cargado**: margen, inventario a costo,
  inmovilizado, días de inventario. El costo se congela al vender (mig 171);
  si falta, se usa el actual y el tablero avisa "* parcialmente estimado".
- **Estimación por diseño**: venta perdida (velocidad de 30 días previos ×
  días sin stock × precio actual). Nunca es dato contable.
- **Foto de un momento**: el bloque "Requiere intervención" sale de la última
  evaluación de alertas, no se recalcula al abrir el tablero.

## Cruces con el mundo físico (lo que ninguna consulta puede hacer sola)

1. **Caja**: cada cierre de turno compara lo contado con lo esperado
   (`03_caja` 10–11). Si los cierres cuadran, el efectivo del tablero es real.
2. **Mercado Pago**: lo cobrado por QR/Point (`03_caja` 21+) contra el reporte
   de MP del mismo período, o directamente Contabilidad › Conciliar MP.
3. **Tickets**: elegir 3 ventas al azar en `/ventas` y compararlas con el
   ticket impreso o la cinta de la impresora.
4. **Stock**: contar en góndola los 10 productos de `04_inventario` 40 (son
   los que más pesan en el inventario a costo) y los de "El stock del sistema
   no coincide con la góndola" de Alertas. Un conteo físico por zonas
   (`/inventario/conteo`) es la prueba completa.
5. **Costos**: para esos mismos 10, comparar `costos_producto` con la última
   factura del proveedor (Compras › Facturas).
